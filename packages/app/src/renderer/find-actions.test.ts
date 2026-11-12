// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside the call (ThomasBirkmaier/ReqSeq-archive#460).
import "../../../../scripts/test-support/dom-selection.mjs";
// SR-189: the prompts of find and replace, on a real editor of the text.
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Command } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionContext, Prompt } from "./actions.js";
import { ACTIONS } from "./actions.js";
import { FIND_ACTIONS, findAction, replaceAction, replaceAllAction } from "./find-actions.js";
import { findMarks, searchOf } from "./editor/find.js";

const views: EditorView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => {
    view.destroy();
  });
});

/** An element buffer whose text is `doc` with the caret at `caret`; the prompts asked and what was said. */
const setup = (doc: string, caret = 0) => {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: caret }, extensions: [history(), findMarks] }),
    parent: document.body,
  });
  views.push(view);
  const prompts: Prompt[] = [];
  const focused: boolean[] = [];
  const reads: boolean[] = [];
  const notify = vi.fn();
  const context = {
    buffers: [{ kind: "element" }],
    element: {
      text: (
        command: Command,
        _none: string,
        options?: { readonly focus?: boolean; readonly read?: boolean },
      ) => {
        focused.push(options?.focus ?? true);
        reads.push(options?.read ?? false);
        command(view);
      },
    },
    ask: (prompt: Prompt) => {
      prompts.push(prompt);
    },
    echo: vi.fn(),
    notify,
  } as unknown as ActionContext;
  const last = (): Prompt => {
    const prompt = prompts.at(-1);
    if (prompt === undefined) {
      throw new Error("no prompt");
    }
    return prompt;
  };
  return { view, context, last, notify, focused, reads, doc: () => view.state.doc.toString() };
};

describe("find and replace in the element", () => {
  it("are in the command prompt on an element with a text; Find in element has Ctrl/Cmd+F", () => {
    expect(FIND_ACTIONS.every((action) => ACTIONS.includes(action))).toBe(true);
    const { context } = setup("x");
    expect(FIND_ACTIONS.every((action) => action.available(context))).toBe(true);
    expect(
      findAction.available({ ...context, buffers: [{ kind: "list" }] } as unknown as ActionContext),
    ).toBe(false);
    expect(findAction.shortcut).toEqual({ mod: true, shift: false, key: "f" });
  });

  it("[SR-189/AK-ctc8] typing marks the hits, Enter and Shift+Enter step through them, Escape leaves the caret at the hit", () => {
    const { view, context, last, notify, focused, reads } = setup("ab x ab x ab", 3);
    findAction.run(context);
    const prompt = last();
    expect(prompt.label).toBe("Find in element");
    prompt.typing?.("a");
    prompt.typing?.("ab");
    expect(notify).toHaveBeenLastCalledWith("2 of 3");
    expect(searchOf(view.state).hits).toHaveLength(3);
    prompt.step?.("ab", false);
    expect(notify).toHaveBeenLastCalledWith("3 of 3");
    prompt.step?.("ab", true);
    prompt.step?.("ab", true);
    expect(notify).toHaveBeenLastCalledWith("1 of 3");
    // Find only reads: it runs in a read-only element too.
    expect(reads.every((read) => read)).toBe(true);
    // The focus stayed in the minibuffer while it searched.
    expect(focused.every((focus) => !focus)).toBe(true);
    prompt.cancel?.();
    expect(focused.at(-1)).toBe(true);
    expect(searchOf(view.state).hits).toHaveLength(0);
    expect(view.state.selection.main.head).toBe(0);
    // No hit: nothing to step through, and no status beyond "no match".
    findAction.run(context);
    last().typing?.("zz");
    expect(notify).toHaveBeenLastCalledWith("no match");
    notify.mockClear();
    last().step?.("zz", false);
    expect(notify).not.toHaveBeenCalled();
    last().typing?.("");
  });

  it("[SR-189/AK-jm2n] Replace asks for the search (the last one first) and the replacement, replaces the current hit and goes to the next", () => {
    const { context, last, notify, doc, reads } = setup("cat dog cat dog", 0);
    findAction.run(context);
    last().typing?.("cat");
    replaceAction.run(context);
    expect(last().label).toBe("Replace");
    expect(last().initial).toBe("cat");
    last().text?.("");
    expect(last().label).toBe("Replace");
    last().text?.("dog");
    expect(last().label).toBe("Replace “dog” with");
    expect(notify).toHaveBeenLastCalledWith("1 of 2");
    last().step?.("bird", false);
    expect(doc()).toBe("cat bird cat dog");
    expect(notify).toHaveBeenLastCalledWith("1 of 1");
    // Shift+Enter skips a hit.
    last().step?.("bird", true);
    last().step?.("bird", false);
    expect(doc()).toBe("cat bird cat bird");
    last().step?.("bird", false);
    expect(notify).toHaveBeenLastCalledWith("No more hits of “dog”");
    last().cancel?.();
    // Only the search runs where the element takes no input; the replace asks for the lock.
    expect(reads.at(-2)).toBe(false);
    // No hit of the search: no prompt for the replacement.
    replaceAction.run(context);
    last().text?.("zebra");
    expect(notify).toHaveBeenLastCalledWith("No hit of “zebra”");
    expect(last().label).toBe("Replace");
  });

  it("[SR-189/AK-byc1] Replace all replaces every hit and says how many in the status line", () => {
    const { view, context, last, notify, doc, focused } = setup("a1 a2 a3", 0);
    replaceAllAction.run(context);
    last().text?.("a");
    expect(last().label).toBe("Replace all “a” with");
    last().text?.("b");
    expect(doc()).toBe("b1 b2 b3");
    expect(notify).toHaveBeenLastCalledWith("Replaced 3 hits");
    expect(focused.at(-1)).toBe(true);
    replaceAllAction.run(context);
    last().text?.("b1");
    last().text?.("c");
    expect(notify).toHaveBeenLastCalledWith("Replaced 1 hit");
    replaceAllAction.run(context);
    last().text?.("q");
    last().text?.("c");
    expect(notify).toHaveBeenLastCalledWith("No hit of “q”");
    // [SR-189/AK-mt6q] in `editor/find.test.ts`; here the whole of it through the prompts: one undo each.
    undo(view);
    expect(doc()).toBe("b1 b2 b3");
  });

  it("says the status in the minibuffer where the window has no modeline notice", () => {
    const { context, last } = setup("a", 0);
    const echo = vi.fn();
    const bare = { ...context, notify: undefined, echo } as unknown as ActionContext;
    findAction.run(bare);
    last().typing?.("a");
    expect(echo).toHaveBeenCalledWith("1 of 1");
  });
});
