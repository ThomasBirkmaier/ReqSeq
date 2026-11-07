// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { pressKey } from "./replay-keys.js";

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

const pressAll = (keys: readonly KeyboardEventInit[]): void => {
  for (const key of keys) {
    pressKey(key);
  }
};

describe("pressing a key a prompt held (#467)", () => {
  it("presses the key on the focused element, and it bubbles to the window", () => {
    const input = focusedInput();
    const pressed: string[] = [];
    input.addEventListener("keydown", (event) => {
      pressed.push(`input ${event.key} ${String(event.ctrlKey)}`);
    });
    const onWindow = (event: KeyboardEvent): void => {
      pressed.push(`window ${event.key}`);
    };
    window.addEventListener("keydown", onWindow);
    try {
      pressKey({ key: "j", ctrlKey: true });
    } finally {
      window.removeEventListener("keydown", onWindow);
    }
    expect(pressed).toEqual(["input j true", "window j"]);
    // A shortcut types nothing.
    expect(input.value).toBe("");
  });

  it("types letters and Backspace into an input with the input event, and nothing a handler took", () => {
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
    pressAll([
      { key: "f" },
      { key: "x" },
      { key: "Backspace" },
      { key: "f" },
      { key: "t" },
      { key: "Enter" },
    ]);
    expect(input.value).toBe("draft");
    expect(inputs).toEqual(["draf", "dra", "draf", "draft"]);
    // A selection is replaced, Backspace at the start deletes nothing, Alt types nothing.
    input.setSelectionRange(0, 5);
    pressAll([{ key: "o" }, { key: "Backspace" }, { key: "Backspace" }, { key: "n", altKey: true }]);
    expect(input.value).toBe("");
  });

  it("types letters and Backspace into the text editor through its view", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({ doc: "Ice", parent });
    view.dispatch({ selection: { anchor: 3 } });
    view.contentDOM.focus();
    pressAll([{ key: "s" }, { key: "Backspace" }, { key: "d" }, { key: "Tab" }, { key: "v", metaKey: true }]);
    expect(view.state.doc.toString()).toBe("Iced");
    view.destroy();
  });

  it("gives a key on another element only the key", () => {
    const box = document.createElement("div");
    box.tabIndex = 0;
    document.body.append(box);
    box.focus();
    const pressed: string[] = [];
    box.addEventListener("keydown", (event) => {
      pressed.push(event.key);
    });
    pressKey({ key: "a" });
    expect(pressed).toEqual(["a"]);
    expect(box.textContent).toBe("");
  });
});
