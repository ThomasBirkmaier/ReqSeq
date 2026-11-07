import { describe, expect, it, vi } from "vitest";
import type { ActionContext, ElementControls } from "./actions.js";
import { ACTIONS } from "./actions.js";
import { TEXT_ACTIONS, hasText, textAction } from "./text-actions.js";
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
});
