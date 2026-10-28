// @vitest-environment happy-dom
// SR-066: `[[` in the editor asks the app for an element and writes the inline reference of the pick, driven
// by transactions that carry the user events a keyboard, an input method and the clipboard give.
// happy-dom fires `selectionchange` inside a CodeMirror update; the root vitest config loads this setup, a
// run in packages/app needs it too (#460, #573).
import "../../../../../scripts/test-support/dom-selection.mjs";
import { completionStatus } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import type { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./Editor.js";
import { markdownSupport } from "./markdown.js";
import { mergePlugins } from "./plugins.js";
import type { EditorPlugins } from "./plugins.js";
import { awaitingReference } from "./reference-pick.js";
import type { PickOptions, ReferenceRequest } from "./reference-pick.js";
import { referenceSearch, typedBrackets } from "./reference-search.js";
import type { ReferenceTarget } from "./slash-entries.js";
import { slashMenu } from "./slash-menu.js";

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
const options: PickOptions = { pickElement, repository: () => "main" };
const search = referenceSearch(options);
const target: ReferenceTarget = {
  id: "11111111-2222-4333-8444-555555555555",
  title: "The title",
  label: "SR-5555",
  shortId: "SR-5555",
  repository: "main",
};

beforeEach(() => {
  pickElement.mockReset();
});

const render = async (text: string, plugins: EditorPlugins): Promise<void> => {
  await act(async () => {
    root.render(
      createElement(Editor, { text, readOnly: false, onChange: vi.fn(), onEscape: vi.fn(), plugins }),
    );
    await Promise.resolve();
  });
};

const show = async (text: string, plugins: EditorPlugins = search): Promise<EditorView> => {
  await render(text, plugins);
  const found = container.querySelector<HTMLElement>(".cm-editor");
  const view = found === null ? null : EditorView.findFromDOM(found);
  if (view === null) {
    throw new Error("no editor");
  }
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  return view;
};

/** One transaction at the caret with the user event `userEvent`, then the microtasks it queued. */
const input = async (view: EditorView, text: string, userEvent: string): Promise<void> => {
  await act(async () => {
    const head = view.state.selection.main.head;
    view.dispatch({
      changes: { from: head, insert: text },
      selection: { anchor: head + text.length },
      userEvent,
    });
    await Promise.resolve();
  });
};

/** Lets the slash menu answer the query typed so far. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
};

/** Types `text` character by character at the caret, as the keyboard does. */
const type = async (view: EditorView, text: string): Promise<void> => {
  for (const char of text) {
    await input(view, char, "input.type");
  }
};

const doc = (view: EditorView): string => view.state.doc.toString();

/** The request of the last question the editor asked. */
const lastRequest = (): ReferenceRequest => {
  const request = pickElement.mock.lastCall?.[0];
  if (request === undefined) {
    throw new Error("the editor asked for no element");
  }
  return request;
};

describe("typedBrackets", () => {
  const state = (text: string): EditorState =>
    EditorState.create({ doc: text, extensions: [markdownSupport({})] });
  const typing = (text: string, at: number, insert: string, userEvent = "input.type"): Transaction =>
    state(text).update({ changes: { from: at, insert }, userEvent });

  it("[SR-066/AK1] gives the start of a [[ whose second [ was typed", () => {
    expect(typedBrackets(typing("[", 1, "["))).toBe(0);
    expect(typedBrackets(typing("see [", 5, "["))).toBe(4);
    expect(typedBrackets(typing("see [ and", 5, "["))).toBe(4);
    // In a selection that the [ replaces.
    expect(
      typedBrackets(
        state("a [xyz").update({ changes: { from: 3, to: 6, insert: "[" }, userEvent: "input.type" }),
      ),
    ).toBe(2);
  });

  it("[SR-066/AK1] is undefined for one [, a [ before a [, a third [, an escaped or an image bracket, and other text", () => {
    // Only the second of exactly two counts.
    expect(typedBrackets(typing("a [", 3, "["))).toBe(2);
    expect(typedBrackets(typing("", 0, "["))).toBeUndefined();
    expect(typedBrackets(typing("see ", 4, "["))).toBeUndefined();
    expect(typedBrackets(typing("[", 0, "["))).toBeUndefined();
    expect(typedBrackets(typing("[[", 2, "["))).toBeUndefined();
    expect(typedBrackets(typing("\\[", 2, "["))).toBeUndefined();
    expect(typedBrackets(typing("![", 2, "["))).toBeUndefined();
    expect(typedBrackets(typing("[", 1, "[["))).toBeUndefined();
    expect(typedBrackets(typing("[", 1, "x"))).toBeUndefined();
    expect(
      typedBrackets(
        state("[ [").update({
          changes: [
            { from: 1, insert: "[" },
            { from: 3, insert: "[" },
          ],
          userEvent: "input.type",
        }),
      ),
    ).toBeUndefined();
  });

  it("[SR-066/AK1] is undefined for a [ that is pasted, composed by an input method, or not input", () => {
    expect(typedBrackets(typing("[", 1, "[", "input.type"))).toBe(0);
    expect(typedBrackets(typing("[", 1, "[", "input.paste"))).toBeUndefined();
    expect(typedBrackets(typing("[", 1, "[", "input.type.compose"))).toBeUndefined();
    expect(typedBrackets(typing("[", 1, "[", "undo"))).toBeUndefined();
    expect(typedBrackets(state("[").update({ changes: { from: 1, insert: "[" } }))).toBeUndefined();
  });

  it("[SR-066/AK1] is undefined in inline code, a code block, a link, an address and HTML", () => {
    expect(typedBrackets(typing("`a [`", 4, "["))).toBeUndefined();
    expect(typedBrackets(typing("```\n[\n```", 5, "["))).toBeUndefined();
    expect(typedBrackets(typing("    code [", 10, "["))).toBeUndefined();
    expect(typedBrackets(typing("[a [](https://x.org)", 4, "["))).toBeUndefined();
    expect(typedBrackets(typing("see https://x.org/[", 19, "["))).toBeUndefined();
    expect(typedBrackets(typing('<b title="[">', 11, "["))).toBeUndefined();
    // Next to code, it does.
    expect(typedBrackets(typing("`a` [", 5, "["))).toBe(4);
  });
});

describe("[[ asks for an element", () => {
  it("[SR-066/AK1] a typed [[ asks the app for an element and keeps the [[ until one is picked", async () => {
    const view = await show("see ");
    await type(view, "[");
    expect(pickElement).not.toHaveBeenCalled();
    await type(view, "[");
    expect(pickElement).toHaveBeenCalledTimes(1);
    expect(doc(view)).toBe("see [[");
    // Autosave waits meanwhile (SR-105): the [[ is no text to write.
    expect(awaitingReference(view.state)).toBe(true);
  });

  it("[SR-066/AK1] a pasted [[, an undo that brings back [[, one [, \\[[, ![[ and [[ in inline code or a link ask nothing, one typed after them does", async () => {
    const view = await show("");
    await input(view, "[[", "input.paste");
    await input(view, " \\", "input.type");
    await type(view, "[[ ![[ ");
    // In inline code and in the label of a link.
    await input(view, "``", "input.paste");
    act(() => {
      view.dispatch({ selection: { anchor: doc(view).length - 1 } });
    });
    await type(view, "[[");
    act(() => {
      view.dispatch({ selection: { anchor: doc(view).length } });
    });
    await input(view, " [](https://x.org)", "input.paste");
    act(() => {
      view.dispatch({ selection: { anchor: doc(view).length - 16 } });
    });
    await type(view, "[");
    expect(doc(view)).toBe("[[ \\[[ ![[ `[[` [[](https://x.org)");
    act(() => {
      // Only the second [: the undo brings back one [ after a [, as a second typed one would.
      view.dispatch({ changes: { from: 1, to: 2 }, userEvent: "delete" });
    });
    act(() => {
      undo(view);
    });
    await act(() => Promise.resolve());
    expect(doc(view).startsWith("[[ ")).toBe(true);
    expect(pickElement).not.toHaveBeenCalled();
    expect(awaitingReference(view.state)).toBe(false);
    // Typed after all of them, it asks.
    act(() => {
      view.dispatch({ selection: { anchor: doc(view).length } });
    });
    await type(view, " [[");
    expect(pickElement).toHaveBeenCalledTimes(1);
  });

  it("[SR-066/AK1] a [[ typed while an input method composes asks nothing, one typed with the keyboard does", async () => {
    const view = await show("");
    await input(view, "[", "input.type.compose");
    await input(view, "[", "input.type.compose");
    expect(doc(view)).toBe("[[");
    expect(pickElement).not.toHaveBeenCalled();
    // Typed with the keyboard after it, it asks.
    await type(view, " [[");
    expect(pickElement).toHaveBeenCalledTimes(1);
  });

  it("[SR-066/AK1] a [[ typed in a code block asks nothing, one below the block does", async () => {
    const view = await show("```\n\n```");
    act(() => {
      view.dispatch({ selection: { anchor: 4 } });
    });
    await type(view, "[[");
    expect(doc(view)).toBe("```\n[[\n```");
    expect(pickElement).not.toHaveBeenCalled();
    // Below the block, it asks.
    act(() => {
      view.dispatch({
        changes: { from: doc(view).length, insert: "\n\n" },
        selection: { anchor: doc(view).length + 2 },
      });
    });
    await type(view, "[[");
    expect(pickElement).toHaveBeenCalledTimes(1);
  });

  it("[SR-066/AK1] asks once when the editor is configured again while the question is open: the waiting [[ is kept and asks nothing again", async () => {
    const view = await show("");
    await type(view, "[[");
    await render("", mergePlugins(search, { extensions: [EditorView.lineWrapping] }));
    await act(() => Promise.resolve());
    expect(pickElement).toHaveBeenCalledTimes(1);
    expect(awaitingReference(view.state)).toBe(true);
  });

  it("[SR-066/AK1] asks nothing for a [[ typed while a question is open already", async () => {
    const view = await show("");
    await type(view, "[[ ");
    await type(view, "[[");
    expect(pickElement).toHaveBeenCalledTimes(1);
  });
});

describe("the pick", () => {
  const asked = async (before: string): Promise<{ view: EditorView; request: ReferenceRequest }> => {
    const view = await show(before);
    await type(view, "[[");
    return { view, request: lastRequest() };
  };

  it("[SR-066/AK2] writes [title](logreq:<uuid>) in place of the [[, the caret after it, the editor focused", async () => {
    const { view, request } = await asked("see ");
    const focus = vi.spyOn(view, "focus");
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`see [The title](logreq:${target.id})`);
    expect(view.state.selection.main.head).toBe(doc(view).length);
    expect(focus).toHaveBeenCalled();
    expect(awaitingReference(view.state)).toBe(false);
  });

  it("[SR-066/AK2] writes the short ID with ?version=&repository=<name> for a target in another repository", async () => {
    const { view, request } = await asked("");
    act(() => {
      request.insert({ ...target, repository: "other" });
    });
    expect(doc(view)).toBe(`[SR-5555](logreq:${target.id}?version=&repository=other)`);
  });

  it("[SR-066/AK2] keeps what was typed after the [[ before the pick after the reference", async () => {
    const { view, request } = await asked("see ");
    await type(view, "ab");
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`see [The title](logreq:${target.id})ab`);
  });

  it("[SR-066/AK2] follows the [[ when the text before it changed while the question was open", async () => {
    const { view, request } = await asked("see ");
    act(() => {
      view.dispatch({ changes: { from: 0, insert: ">> " } });
    });
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`>> see [The title](logreq:${target.id})`);
  });

  it("[SR-066/AK2] one undo brings back the [[ and asks nothing", async () => {
    const { view, request } = await asked("see ");
    act(() => {
      request.insert(target);
    });
    act(() => {
      undo(view);
    });
    await act(() => Promise.resolve());
    expect(doc(view)).toBe("see [[");
    expect(pickElement).toHaveBeenCalledTimes(1);
    expect(awaitingReference(view.state)).toBe(false);
  });

  it("[SR-066/AK2] writes at the caret when the [[ is gone, and nothing when the editor is gone", async () => {
    const { view, request } = await asked("see ");
    act(() => {
      view.dispatch({ changes: { from: 4, to: 5 }, selection: { anchor: 5 } });
    });
    act(() => {
      request.insert(target);
    });
    expect(doc(view)).toBe(`see [[The title](logreq:${target.id})`);
    const again = await asked("x ");
    const text = doc(again.view);
    act(() => {
      root.unmount();
    });
    again.request.insert(target);
    expect(doc(again.view)).toBe(text);
    root = createRoot(container);
  });

  it("[SR-066/AK1] Escape (cancel) leaves the [[ as typed and gives the editor the focus", async () => {
    const { view, request } = await asked("see ");
    const focus = vi.spyOn(view, "focus");
    act(() => {
      request.cancel();
    });
    expect(doc(view)).toBe("see [[");
    expect(focus).toHaveBeenCalled();
    expect(awaitingReference(view.state)).toBe(false);
    // A third [ after the cancel asks nothing: only exactly two brackets ask.
    await type(view, "[");
    expect(pickElement).toHaveBeenCalledTimes(1);
  });

  it("[SR-066/AK1] a [[ in the query of an open slash menu belongs to the query and asks nothing", async () => {
    const view = await show("", mergePlugins(slashMenu({ ...options, pickImage: vi.fn() }), search));
    await type(view, "/ref");
    await settle();
    await type(view, "[[");
    expect(completionStatus(view.state)).not.toBeNull();
    expect(pickElement).not.toHaveBeenCalled();
    // Once Escape closed the menu, a [[ asks.
    act(() => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await type(view, " [[");
    expect(pickElement).toHaveBeenCalledTimes(1);
  });

  it("[SR-066/AK1] a [[ after a / whose query matches no entry asks: no menu shows", async () => {
    const view = await show("", mergePlugins(slashMenu({ ...options, pickImage: vi.fn() }), search));
    await type(view, "/zzzq");
    await settle();
    expect(completionStatus(view.state)).toBeNull();
    await type(view, "[[");
    expect(pickElement).toHaveBeenCalledOnce();
  });

  it("works beside the slash menu: both share what waits, and each writes its reference", async () => {
    const view = await show("", mergePlugins(slashMenu({ ...options, pickImage: vi.fn() }), search));
    await type(view, "[[");
    act(() => {
      lastRequest().insert(target);
    });
    expect(doc(view)).toBe(`[The title](logreq:${target.id})`);
  });
});
