// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { replayKeys } from "./replay-keys.js";

afterEach(() => {
  document.body.replaceChildren();
});

const focusedInput = (value = ""): HTMLInputElement => {
  const input = document.createElement("input");
  input.value = value;
  document.body.append(input);
  input.focus();
  input.setSelectionRange(value.length, value.length);
  return input;
};

describe("replaying the keys a prompt held (#467)", () => {
  it("presses each key on the focused element, in order, after the render of the one before", async () => {
    const first = focusedInput();
    const second = document.createElement("input");
    document.body.append(second);
    const pressed: string[] = [];
    first.addEventListener("keydown", (event) => {
      pressed.push(`first ${event.key} ${String(event.ctrlKey)}`);
      // The shortcut opens another prompt, which takes the focus.
      event.preventDefault();
      second.focus();
    });
    second.addEventListener("keydown", (event) => {
      pressed.push(`second ${event.key}`);
    });
    let waits = 0;
    await replayKeys([{ key: "P", ctrlKey: true, shiftKey: true }, { key: "d" }, { key: "Enter" }], () => {
      waits += 1;
      return Promise.resolve();
    });
    expect(pressed).toEqual(["first P true", "second d", "second Enter"]);
    expect(waits).toBe(3);
    // The letter no handler took is typed into the input that has the focus; Enter types nothing.
    expect(second.value).toBe("d");
    expect(first.value).toBe("");
  });

  it("types letters and Backspace into an input with the input event, and nothing a handler took", async () => {
    const input = focusedInput("dra");
    const inputs: string[] = [];
    input.addEventListener("input", () => {
      inputs.push(input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "x") {
        event.preventDefault();
      }
    });
    await replayKeys([{ key: "f" }, { key: "x" }, { key: "Backspace" }, { key: "f" }, { key: "t" }]);
    expect(input.value).toBe("draft");
    expect(inputs).toEqual(["draf", "dra", "draf", "draft"]);
    // A selection is replaced, Backspace at the start deletes nothing, a shortcut types nothing.
    input.setSelectionRange(0, 5);
    await replayKeys([{ key: "o" }, { key: "Backspace" }, { key: "Backspace" }, { key: "a", ctrlKey: true }]);
    expect(input.value).toBe("");
  });

  it("gives a key on another element than an input only the key", async () => {
    const editor = document.createElement("div");
    editor.tabIndex = 0;
    document.body.append(editor);
    editor.focus();
    const pressed: string[] = [];
    editor.addEventListener("keydown", (event) => {
      pressed.push(event.key);
    });
    await replayKeys([{ key: "a" }]);
    expect(pressed).toEqual(["a"]);
    expect(editor.textContent).toBe("");
  });
});
