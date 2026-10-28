// @vitest-environment happy-dom
// SR-129: the slash menu in the whole editor (its keymap included), driven by transactions that carry the
// user events a keyboard and the clipboard give, and by the key handlers of CodeMirror.
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (#460, #573).
import "../../../../../scripts/test-support/dom-selection.mjs";
import { completionStatus, currentCompletions, selectedCompletion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorProps } from "./Editor.js";
import { Editor } from "./Editor.js";
import { mergePlugins } from "./plugins.js";
import { awaitingReference, slashMenu } from "./slash-menu.js";
import type { ImageRequest, ReferenceRequest, SlashMenuOptions } from "./slash-menu.js";
import type { ReferenceTarget } from "./slash-entries.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

const pickElement = vi.fn<(request: ReferenceRequest) => void>();
const pickImage = vi.fn<(request: ImageRequest) => void>();
const options: SlashMenuOptions = { pickElement, pickImage, repository: () => "main" };
const onEscape = vi.fn();

const show = async (text: string, extra: Partial<EditorProps> = {}): Promise<EditorView> => {
  await act(async () => {
    root.render(
      createElement(Editor, {
        text,
        readOnly: false,
        onChange: vi.fn(),
        onEscape,
        plugins: mergePlugins(slashMenu(options)),
        ...extra,
      }),
    );
    await Promise.resolve();
  });
  const found = container.querySelector<HTMLElement>(".cm-editor");
  const view = found === null ? null : EditorView.findFromDOM(found);
  if (view === null) {
    throw new Error("no editor");
  }
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  return view;
};

const tick = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

/** Types `text` character by character at the caret, as the keyboard does, and lets the menu answer. */
const type = async (view: EditorView, text: string): Promise<void> => {
  for (const char of text) {
    const head = view.state.selection.main.head;
    act(() => {
      view.dispatch({
        changes: { from: head, insert: char },
        selection: { anchor: head + 1 },
        userEvent: "input.type",
      });
    });
    await tick();
  }
};

/** A key press in the editor, through its DOM handlers: handled is whether the editor prevented the default. */
const press = (view: EditorView, init: KeyboardEventInit): { handled: boolean; event: KeyboardEvent } => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    view.contentDOM.dispatchEvent(event);
  });
  return { handled: event.defaultPrevented, event };
};

/** Types `text` in one transaction, as the keyboard does, without letting the menu answer. */
const typeAtOnceHere = (view: EditorView, text: string): void => {
  const head = view.state.selection.main.head;
  act(() => {
    view.dispatch({
      changes: { from: head, insert: text },
      selection: { anchor: head + text.length },
      userEvent: "input.type",
    });
  });
};

const labels = (view: EditorView): string[] => currentCompletions(view.state).map((option) => option.label);
const selected = (view: EditorView): string | undefined => selectedCompletion(view.state)?.label;
const doc = (view: EditorView): string => view.state.doc.toString();

describe("the slash menu opens", () => {
  it("[SR-129/AK1] when / is typed at an empty line: next to the caret, with the elements of the criterion in order", async () => {
    const view = await show("");
    await type(view, "/");
    expect(completionStatus(view.state)).toBe("active");
    expect(labels(view)).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Normal text",
      "Bullet list",
      "Numbered list",
      "Task list",
      "Quote",
      "Code block",
      "Table",
      "Link",
      "Reference to element",
      "Image",
      "Math block",
      "Diagram",
      "Bold",
      "Italic",
    ]);
    expect(selected(view)).toBe("Heading 1");
    expect(container.querySelectorAll(".cm-tooltip-autocomplete li")).toHaveLength(20);
    expect(container.querySelector(".cm-tooltip-autocomplete")?.classList.contains("cm-lr-slash")).toBe(true);
  });

  it.each([["text "], ["- "], ["> "], ["1. "]])("[SR-129/AK1] when / is typed after %j", async (before) => {
    const view = await show(before);
    await type(view, "/");
    expect(completionStatus(view.state)).toBe("active");
  });

  it("[SR-129/AK1] shows the Markdown of an entry as its detail, muted", async () => {
    const view = await show("");
    await type(view, "/");
    const row = container.querySelectorAll(".cm-tooltip-autocomplete li")[1];
    expect(row?.querySelector(".cm-completionLabel")?.textContent).toBe("Heading 2");
    expect(row?.querySelector(".cm-completionDetail")?.textContent).toBe("## ");
  });

  it.each([
    ["inside a word", "a", "/"],
    ["in a fenced code block", "```\n", "/"],
    ["in inline code", "`code ", "/`"],
    ["in the text of a link", "[label ", "/](https://example.org)"],
  ])("[SR-129/AK1] does not open %s", async (_where, before, typed) => {
    const view = await show(before);
    await type(view, typed);
    expect(completionStatus(view.state)).toBeNull();
    await type(view, "h");
    expect(completionStatus(view.state)).toBeNull();
  });

  it("[SR-129/AK1] shows only the inline entries and the reference in a table row", async () => {
    const view = await show("| a | b |\n| --- | --- |\n| x | ");
    await type(view, "/");
    expect(labels(view)).toEqual(["Link", "Reference to element", "Image", "Bold", "Italic"]);
  });

  it("[SR-129/AK1] does not open for a pasted /x when typing goes on", async () => {
    const view = await show("");
    act(() => {
      view.dispatch({
        changes: { from: 0, insert: "/x" },
        selection: { anchor: 2 },
        userEvent: "input.paste",
      });
    });
    await type(view, "y");
    expect(completionStatus(view.state)).toBeNull();
  });

  it("[SR-129/AK1] does not open again for a /query that undo brought back when typing goes on", async () => {
    const view = await show("");
    await type(view, "/h1");
    press(view, { key: "Enter" });
    expect(doc(view)).toBe("# ");
    act(() => {
      undo(view);
    });
    expect(doc(view)).toBe("/h1");
    await type(view, "x");
    expect(completionStatus(view.state)).toBeNull();
    expect(doc(view)).toBe("/h1x");
  });

  it("[SR-129/AK1] closes when the query has a space, when nothing matches, and when the caret leaves", async () => {
    const view = await show("");
    await type(view, "/h1 ");
    expect(completionStatus(view.state)).toBeNull();
    act(() => {
      view.dispatch({ changes: { from: 0, to: 4, insert: "" }, selection: { anchor: 0 } });
    });
    await type(view, "/zzzzz");
    expect(completionStatus(view.state)).toBeNull();
    act(() => {
      view.dispatch({ changes: { from: 0, to: 6, insert: "" }, selection: { anchor: 0 } });
    });
    await type(view, "/h");
    expect(completionStatus(view.state)).toBe("active");
    act(() => {
      view.dispatch({ selection: { anchor: 0 } });
    });
    expect(completionStatus(view.state)).toBeNull();
  });

  it("[SR-129/AK1] closes when the / is deleted and does not open on a second /", async () => {
    const view = await show("");
    await type(view, "/h");
    act(() => {
      view.dispatch({ changes: { from: 0, to: 1 }, userEvent: "delete.backward" });
    });
    await tick();
    expect(completionStatus(view.state)).toBeNull();
    act(() => {
      view.dispatch({ changes: { from: 0, to: 1 }, userEvent: "delete.backward" });
    });
    await type(view, "a/");
    expect(completionStatus(view.state)).toBeNull();
  });

  it("[SR-129/AK1] follows a / that moves when text is inserted before it", async () => {
    const view = await show("a");
    await type(view, " /h");
    act(() => {
      view.dispatch({ changes: { from: 0, insert: "xx" } });
    });
    await type(view, "2");
    expect(completionStatus(view.state)).toBe("active");
    expect(selected(view)).toBe("Heading 2");
  });
});

describe("the slash menu narrows and chooses", () => {
  it.each([
    ["/nl", "Numbered list"],
    ["/cb", "Code block"],
    ["/h2", "Heading 2"],
    ["/tsk", "Task list"],
    ["/qoute", "Quote"],
    ["/ref", "Reference to element"],
  ])("[SR-129/AK2] %s finds %s first, as the command line does", async (typed, first) => {
    const view = await show("");
    await type(view, typed);
    expect(completionStatus(view.state)).toBe("active");
    expect(selected(view)).toBe(first);
  });

  it("[SR-129/AK2] marks the letters that matched", async () => {
    const view = await show("");
    await type(view, "/nl");
    const marked = [
      ...container.querySelectorAll(".cm-tooltip-autocomplete li:first-child .cm-completionMatchedText"),
    ];
    expect(marked.map((node) => node.textContent)).toEqual(["N", "l"]);
  });

  it("[SR-129/AK2] a fast /h2 and Enter takes Heading 2", async () => {
    const view = await show("");
    await type(view, "/h2");
    expect(press(view, { key: "Enter" }).handled).toBe(true);
    expect(doc(view)).toBe("## ");
  });

  it("[SR-129/AK2] an Enter right after the typing, before the menu has answered, takes the first entry and adds no new line", async () => {
    const view = await show("");
    for (const char of "/h2") {
      const head = view.state.selection.main.head;
      act(() => {
        view.dispatch({
          changes: { from: head, insert: char },
          selection: { anchor: head + 1 },
          userEvent: "input.type",
        });
      });
    }
    expect(completionStatus(view.state)).toBe("pending");
    expect(press(view, { key: "Enter" }).handled).toBe(true);
    expect(doc(view)).toBe("## ");
    await tick();
    expect(doc(view)).toBe("## ");
    expect(completionStatus(view.state)).toBeNull();
  });

  /** Types without letting the menu answer. */
  const typeAtOnce = (view: EditorView, text: string): void => {
    for (const char of text) {
      const head = view.state.selection.main.head;
      act(() => {
        view.dispatch({
          changes: { from: head, insert: char },
          selection: { anchor: head + 1 },
          userEvent: "input.type",
        });
      });
    }
  };

  it("[SR-129/AK2] an Enter before the menu has answered takes Reference to element for /ref", async () => {
    const view = await show("");
    typeAtOnce(view, "/ref");
    pickElement.mockClear();
    press(view, { key: "Enter" });
    expect(pickElement).toHaveBeenCalledTimes(1);
    expect(doc(view)).toBe("/ref");
  });

  it("[SR-129/AK2] an Enter before the menu has answered is the editor's own when nothing matches", async () => {
    const view = await show("x\n");
    typeAtOnce(view, "/zzzz");
    expect(completionStatus(view.state)).toBe("pending");
    press(view, { key: "Enter" });
    expect(doc(view)).toBe("x\n/zzzz\n");
  });

  it("[SR-129/AK2] ArrowDown, Tab and Ctrl+N move down; ArrowUp and Ctrl+P move up", async () => {
    const view = await show("");
    await type(view, "/");
    expect(press(view, { key: "ArrowDown" }).handled).toBe(true);
    expect(selected(view)).toBe("Heading 2");
    expect(press(view, { key: "Tab" }).handled).toBe(true);
    expect(selected(view)).toBe("Heading 3");
    expect(press(view, { key: "n", ctrlKey: true }).handled).toBe(true);
    expect(selected(view)).toBe("Heading 4");
    expect(press(view, { key: "ArrowUp" }).handled).toBe(true);
    expect(selected(view)).toBe("Heading 3");
    expect(press(view, { key: "p", ctrlKey: true }).handled).toBe(true);
    expect(selected(view)).toBe("Heading 2");
    expect(view.state.selection.main.head).toBe(1);
  });

  it("[SR-129/AK2] Ctrl+P while the menu is open is handled, so the window does not open Go to", async () => {
    const view = await show("");
    await type(view, "/");
    const { handled, event } = press(view, { key: "p", ctrlKey: true });
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("[SR-129/AK2] Enter takes the chosen entry", async () => {
    const view = await show("");
    await type(view, "/");
    press(view, { key: "ArrowDown" });
    press(view, { key: "ArrowDown" });
    press(view, { key: "Enter" });
    expect(doc(view)).toBe("### ");
    expect(completionStatus(view.state)).toBeNull();
  });

  it("[SR-129/AK2] a click takes an entry", async () => {
    const view = await show("");
    await type(view, "/");
    const row = container.querySelectorAll<HTMLElement>(".cm-tooltip-autocomplete li")[11];
    act(() => {
      row?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    expect(doc(view)).toBe("```\n\n```");
  });

  it("[SR-129/AK2] puts the selection back on the first entry when the query changes", async () => {
    const view = await show("");
    await type(view, "/h");
    press(view, { key: "ArrowDown" });
    expect(selected(view)).toBe("Heading 2");
    await type(view, "e");
    expect(selected(view)).toBe("Heading 1");
  });

  it("[SR-129/AK2] leaves the keys to the editor while the menu is closed: Ctrl+N, Ctrl+P, Tab, the arrows and Enter", async () => {
    const view = await show("one\ntwo");
    act(() => {
      view.dispatch({ selection: { anchor: 1 } });
    });
    // Not bound in the standard keymap off macOS (there Ctrl+N and Ctrl+P move the caret, as Emacs does).
    expect(press(view, { key: "Tab" }).handled).toBe(false);
    expect(press(view, { key: "ArrowDown" }).handled).toBe(true);
    // (The test DOM has no layout, so only that the caret moved can be seen.)
    expect(view.state.selection.main.head).toBeGreaterThan(1);
    act(() => {
      view.dispatch({ selection: { anchor: 1 } });
    });
    const emacs = press(view, { key: "n", ctrlKey: true }).handled;
    expect(view.state.selection.main.head > 1).toBe(emacs);
    act(() => {
      view.dispatch({ selection: { anchor: 7 } });
    });
    press(view, { key: "Enter" });
    expect(doc(view)).toBe("one\ntwo\n");
  });
});

describe("Escape", () => {
  it("[SR-129/AK3] closes the menu and leaves the / and the query as typed, without leaving the editor", async () => {
    onEscape.mockClear();
    const view = await show("");
    await type(view, "/h");
    expect(press(view, { key: "Escape" }).handled).toBe(true);
    expect(completionStatus(view.state)).toBeNull();
    expect(doc(view)).toBe("/h");
    expect(view.state.selection.main.head).toBe(2);
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("[SR-129/AK3] does not open again while typing goes on after that /, and opens for a new /", async () => {
    const view = await show("");
    await type(view, "/h");
    press(view, { key: "Escape" });
    await type(view, "e");
    expect(completionStatus(view.state)).toBeNull();
    expect(doc(view)).toBe("/he");
    await type(view, " /");
    expect(completionStatus(view.state)).toBe("active");
  });

  it("[SR-129/AK3] is the editor's own Escape when the menu is closed", async () => {
    onEscape.mockClear();
    const view = await show("text");
    expect(press(view, { key: "Escape" }).handled).toBe(true);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("[SR-131/AK3] is the editor's own Escape right after typing that is no / query, while the source is still asked", async () => {
    onEscape.mockClear();
    const view = await show("text");
    // Any typing asks the menu's source: until it answers, the completion is pending.
    typeAtOnceHere(view, " typed");
    expect(completionStatus(view.state)).toBe("pending");
    expect(press(view, { key: "Escape" }).handled).toBe(true);
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(doc(view)).toBe("text typed");
    // A `/` that was dismissed is no menu either.
    onEscape.mockClear();
    await type(view, " /h");
    press(view, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
    typeAtOnceHere(view, "x");
    expect(completionStatus(view.state)).toBe("pending");
    press(view, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe("taking an entry", () => {
  it("[SR-129/AK4] replaces the / and its query: a heading, a table, a link and bold", async () => {
    const view = await show("intro\n\n");
    await type(view, "/h2");
    press(view, { key: "Enter" });
    expect(doc(view)).toBe("intro\n\n## ");
    act(() => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "intro\n\n" },
        selection: { anchor: 7 },
      });
    });
    await type(view, "/table");
    press(view, { key: "Enter" });
    expect(doc(view)).toBe("intro\n\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |");
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "Column 1",
    );
  });

  it.each([
    ["/table", "| Column 1 | Column 2 |\n| --- | --- |\n|  |  |"],
    ["/h1", "# "],
    ["/cb", "```\n\n```"],
  ])(
    "[SR-129/AK4] takes one undo step for %s: one Ctrl+Z gives back the text with the query",
    async (typed, written) => {
      const view = await show("intro\n\n");
      await type(view, typed);
      press(view, { key: "Enter" });
      expect(doc(view)).toBe(`intro\n\n${written}`);
      act(() => {
        undo(view);
      });
      expect(doc(view)).toBe(`intro\n\n${typed}`);
      expect(completionStatus(view.state)).toBeNull();
    },
  );

  it("[SR-129/AK4] keeps the undo step apart from typing that follows at once", async () => {
    const view = await show("");
    await type(view, "/h1");
    press(view, { key: "Enter" });
    await type(view, "x");
    expect(doc(view)).toBe("# x");
    act(() => {
      undo(view);
    });
    expect(doc(view)).toBe("# ");
    act(() => {
      undo(view);
    });
    expect(doc(view)).toBe("/h1");
  });
});

describe("the reference to an element", () => {
  const target: ReferenceTarget = {
    id: "11111111-2222-4333-8444-555555555555",
    title: "The title",
    label: "SR-036",
    shortId: "SR-5555",
    repository: "main",
  };

  const ask = async (
    text: string,
    typed: string,
  ): Promise<{ view: EditorView; request: ReferenceRequest }> => {
    pickElement.mockClear();
    const view = await show(text);
    await type(view, typed);
    press(view, { key: "Enter" });
    const request = pickElement.mock.calls[0]?.[0];
    if (request === undefined) {
      throw new Error("the app was not asked");
    }
    return { view, request };
  };

  it("[SR-129/AK4] asks the app and keeps the / and the query until an element is picked", async () => {
    const { view, request } = await ask("see ", "/ref");
    expect(doc(view)).toBe("see /ref");
    expect(completionStatus(view.state)).toBeNull();
    // Autosave waits meanwhile (SR-105): the query is no text to write.
    expect(awaitingReference(view.state)).toBe(true);
    act(() => {
      request.insert(target);
    });
    expect(awaitingReference(view.state)).toBe(false);
    expect(awaitingReference(EditorState.create())).toBe(false);
  });

  it("[SR-129/AK4] writes the reference in place of the / and its query, and the editor takes the focus", async () => {
    const { view, request } = await ask("see ", "/ref");
    const focus = vi.spyOn(view, "focus");
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`see [The title](logreq:${target.id})`);
    expect(view.state.selection.main.head).toBe(doc(view).length);
    expect(focus).toHaveBeenCalled();
  });

  it("[SR-129/AK4] writes the short ID and the repository for a target in another repository", async () => {
    const { view, request } = await ask("", "/ref");
    act(() => {
      request.insert({ ...target, repository: "other" });
    });
    expect(doc(view)).toBe(`[SR-5555](logreq:${target.id}?version=&repository=other)`);
  });

  it("[SR-129/AK4] follows the / when the text before it changed while the question was open", async () => {
    const { view, request } = await ask("see ", "/ref");
    act(() => {
      view.dispatch({ changes: { from: 0, insert: ">> " } });
    });
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`>> see [The title](logreq:${target.id})`);
  });

  it("[SR-129/AK4] writes at the caret when the / and its query are gone", async () => {
    const { view, request } = await ask("see ", "/ref");
    act(() => {
      view.dispatch({ changes: { from: 4, to: 8, insert: "other" }, selection: { anchor: 9 } });
    });
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`see other[The title](logreq:${target.id})`);
  });

  it("[SR-129/AK4] takes one undo step", async () => {
    const { view, request } = await ask("", "/ref");
    act(() => {
      request.insert(target);
    });
    act(() => {
      undo(view);
    });
    expect(doc(view)).toBe("/ref");
    expect(completionStatus(view.state)).toBeNull();
  });

  it("[SR-129/AK3] leaves the / and the query as typed when the question is cancelled, and gives the editor the focus", async () => {
    const { view, request } = await ask("see ", "/ref");
    const focus = vi.spyOn(view, "focus");
    act(() => {
      request.cancel();
    });
    expect(doc(view)).toBe("see /ref");
    expect(focus).toHaveBeenCalled();
    // A pick after the cancel (a late answer) finds no pending range and writes at the caret.
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`see /ref[The title](logreq:${target.id})`);
  });

  it("[SR-129/AK4] does nothing when the editor is gone", async () => {
    const { view, request } = await ask("see ", "/ref");
    const text = doc(view);
    act(() => {
      root.unmount();
    });
    request.insert(target);
    expect(view.state.doc.toString()).toBe(text);
    root = createRoot(container);
  });
});

describe("the image", () => {
  const MARKDOWN = "![wind](N-0000000000ed/wind.png)";

  const ask = async (text: string): Promise<{ view: EditorView; request: ImageRequest }> => {
    pickImage.mockClear();
    const view = await show(text);
    await type(view, "/image");
    press(view, { key: "Enter" });
    const request = pickImage.mock.calls[0]?.[0];
    if (request === undefined) {
      throw new Error("the app was not asked");
    }
    return { view, request };
  };

  it("[SR-097/AK1] asks the app for the file, keeps the / until it answers and writes the Markdown in its place", async () => {
    const { view, request } = await ask("see ");
    expect(doc(view)).toBe("see /image");
    expect(completionStatus(view.state)).toBeNull();
    // Autosave waits meanwhile (SR-105), as for a reference.
    expect(awaitingReference(view.state)).toBe(true);
    const focus = vi.spyOn(view, "focus");
    act(() => {
      request.insert(MARKDOWN);
    });
    expect(doc(view)).toBe(`see ${MARKDOWN}`);
    expect(awaitingReference(view.state)).toBe(false);
    expect(focus).toHaveBeenCalled();
    act(() => {
      undo(view);
    });
    expect(doc(view)).toBe("see /image");
  });

  it("[SR-129/AK4] writes an image as CommonMark with GitHub extensions where /im stood (micromark)", async () => {
    pickImage.mockClear();
    const view = await show("see ");
    await type(view, "/im");
    press(view, { key: "Enter" });
    const request = pickImage.mock.calls[0]?.[0];
    act(() => {
      request?.insert(MARKDOWN);
    });
    expect(doc(view)).not.toContain("/im");
    const html = micromark(doc(view), { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
    expect(html.trim()).toBe('<p>see <img src="N-0000000000ed/wind.png" alt="wind" /></p>');
  });

  it("[SR-129/AK3] leaves the / and the query when the question is cancelled", async () => {
    const { view, request } = await ask("see ");
    act(() => {
      request.cancel();
    });
    expect(doc(view)).toBe("see /image");
    expect(awaitingReference(view.state)).toBe(false);
  });
});

describe("accessibility", () => {
  it("[SR-129/AK1] is a listbox of options that the keyboard operates, labelled for screen readers", async () => {
    const view = await show("");
    await type(view, "/");
    const content = container.querySelector(".cm-content");
    expect(content?.getAttribute("aria-label")).toBe("Text");
    expect(content?.getAttribute("aria-autocomplete")).toBe("list");
    expect(content?.getAttribute("aria-haspopup")).toBe("listbox");
    const list = container.querySelector(".cm-tooltip-autocomplete ul");
    expect(list?.getAttribute("role")).toBe("listbox");
    expect(list?.getAttribute("aria-label")).toBe("Insert menu");
    expect(content?.getAttribute("aria-controls")).toBe(list?.id);
    expect(content?.getAttribute("aria-activedescendant")).toBe(
      container.querySelector("li[aria-selected]")?.id,
    );
    expect(container.querySelectorAll('li[role="option"]')).toHaveLength(20);
    expect(container.querySelector('li[aria-selected="true"]')?.textContent).toContain("Heading 1");
  });
});
