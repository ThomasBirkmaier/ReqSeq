import { describe, expect, it, vi } from "vitest";
import type { ActionContext, ElementControls } from "./actions.js";
import { ACTIONS } from "./actions.js";
import { TEXT_ACTIONS, hasText, linkAction, textAction } from "./text-actions.js";
import { toggleTask } from "./editor/tasks.js";

const contextOf = (kind: string, text?: ElementControls["text"]): ActionContext =>
  ({
    buffers: [{ kind }],
    ...(text === undefined ? {} : { element: { text } }),
  }) as unknown as ActionContext;

describe("text actions", () => {
  it("are in the command prompt, on an element whose text takes commands only", () => {
    const text = vi.fn();
    expect(ACTIONS.filter((action) => TEXT_ACTIONS.includes(action))).toHaveLength(TEXT_ACTIONS.length);
    expect(hasText(contextOf("element", text))).toBe(true);
    expect(hasText(contextOf("element"))).toBe(false);
    expect(hasText(contextOf("list", text))).toBe(false);
  });

  it("[SR-185/AK3] Toggle task runs the toggle on the text, and says when there is no task on the line", () => {
    const text = vi.fn();
    const action = TEXT_ACTIONS.find((entry) => entry.title === "Toggle task");
    action?.run(contextOf("element", text));
    expect(text).toHaveBeenCalledWith(toggleTask, "No task on this line");
  });

  it("carries a shortcut when it has one", () => {
    const command = vi.fn(() => true);
    const shortcut = { mod: true, shift: false, key: "b" } as const;
    expect(textAction({ id: "x", title: "X", command, none: "n", shortcut }).shortcut).toEqual(shortcut);
    expect(textAction({ id: "x", title: "X", command, none: "n" }).shortcut).toBeUndefined();
  });

  it("[SR-186/AK1] Bold, Italic and Inline code run their format on the text", () => {
    const text = vi.fn();
    const named = (title: string) => TEXT_ACTIONS.find((entry) => entry.title === title);
    for (const title of ["Bold", "Italic", "Inline code"]) {
      named(title)?.run(contextOf("element", text));
    }
    expect(text).toHaveBeenCalledTimes(3);
  });

  it("[SR-186/AK2] Bold and Italic have Ctrl/Cmd+B and Ctrl/Cmd+I outside an editor, Inline code no key", () => {
    const named = (title: string) => TEXT_ACTIONS.find((entry) => entry.title === title);
    expect(named("Bold")?.shortcut).toEqual({ mod: true, shift: false, key: "b" });
    expect(named("Italic")?.shortcut).toEqual({ mod: true, shift: false, key: "i" });
    expect(named("Inline code")?.shortcut).toBeUndefined();
  });

  it("[SR-186/AK5] Link asks for the address and writes the link with it; an empty address writes nothing", () => {
    const text = vi.fn();
    const ask = vi.fn();
    linkAction.run({ ...contextOf("element", text), ask });
    const prompt = ask.mock.calls[0]?.[0] as { label: string; text: (address: string) => void };
    expect(prompt.label).toBe("Link address");
    prompt.text("  ");
    expect(text).not.toHaveBeenCalled();
    prompt.text("https://example.org");
    expect(text).toHaveBeenCalledTimes(1);
    expect(linkAction.available(contextOf("element", text))).toBe(true);
  });
});
