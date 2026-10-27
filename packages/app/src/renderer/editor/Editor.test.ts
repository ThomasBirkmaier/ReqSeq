// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside the call; CodeMirror then updates while it updates. The root vitest
// config loads this setup, but a run without it (`pnpm vitest run <file>` in packages/app) needs it too (#460).
import "../../../../../scripts/test-support/dom-selection.mjs";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle, EditorProps } from "./Editor.js";
import { Editor } from "./Editor.js";
import type { PreviewRule } from "./plugins.js";
import type { Reference } from "./references.js";
import { focusEffect } from "./preview.js";
import { followOnMouseDown, outdatedKey, references } from "./references.js";

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

const props = (extra: Partial<EditorProps> = {}): EditorProps => ({
  text: "# Title\n\nbody",
  readOnly: false,
  onChange: vi.fn(),
  onEscape: vi.fn(),
  ...extra,
});

const render = async (extra: Partial<EditorProps> = {}): Promise<void> => {
  await act(async () => {
    root.render(createElement(Editor, props(extra)));
    await Promise.resolve();
  });
};

const handleOf = (handle: { readonly mock: { readonly calls: unknown[][] } }): EditorHandle => {
  const given = handle.mock.calls[0]?.[0];
  if (given === undefined) {
    throw new Error("no handle given");
  }
  return given as EditorHandle;
};

const element = (selector: string): HTMLElement => {
  const found = container.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`nothing matches ${selector}`);
  }
  return found;
};

const view = (): EditorView => {
  const found = EditorView.findFromDOM(element(".cm-editor"));
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};

describe("Editor", () => {
  it("shows the text as the document, with a label, and the live preview", async () => {
    await render();
    expect(view().state.doc.toString()).toBe("# Title\n\nbody");
    const content = container.querySelector(".cm-content");
    expect(content?.getAttribute("aria-label")).toBe("Text");
    expect(content?.getAttribute("contenteditable")).toBe("true");
    expect(container.querySelector(".cm-lr-h1")).not.toBeNull();
    // Not focused: the mark of the heading is hidden.
    expect(container.querySelector(".cm-content")?.textContent).toBe("Titlebody");
  });

  it("reports a change of the document and nothing else", async () => {
    const onChange = vi.fn();
    await render({ onChange });
    act(() => {
      view().dispatch({ changes: { from: 13, insert: "!" } });
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("# Title\n\nbody!");
    act(() => {
      view().dispatch({ selection: { anchor: 2 } });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("shows a draft instead of the text when created with one", async () => {
    await render({ initial: "draft" });
    expect(view().state.doc.toString()).toBe("draft");
    await render({ initial: "draft", text: "other text" });
    expect(view().state.doc.toString()).toBe("draft");
  });

  it("follows a changed text when there is no unsaved input, keeps the cursor, and adds no undo step", async () => {
    await render();
    act(() => {
      view().dispatch({ selection: { anchor: 11 } });
    });
    await render({ text: "# Title\n\nbody text" });
    expect(view().state.doc.toString()).toBe("# Title\n\nbody text");
    expect(view().state.selection.main.head).toBe(11);
    expect(undo(view())).toBe(false);
  });

  it("keeps the document when it has unsaved input", async () => {
    await render();
    act(() => {
      view().dispatch({ changes: { from: 13, insert: "!" } });
    });
    await render({ text: "changed on disk" });
    expect(view().state.doc.toString()).toBe("# Title\n\nbody!");
    // The text it is compared with is the latest one: when the document is that text again, it follows.
    await render({ text: "changed on disk 2" });
    expect(view().state.doc.toString()).toBe("# Title\n\nbody!");
  });

  it("is editable, or not when read-only, and switches without being created again", async () => {
    await render();
    const content = container.querySelector(".cm-content");
    expect(content?.getAttribute("contenteditable")).toBe("true");
    await render({ readOnly: true });
    expect(container.querySelector(".cm-content")).toBe(content);
    expect(content?.getAttribute("contenteditable")).toBe("false");
    expect(view().state.readOnly).toBe(true);
    await render({ readOnly: true });
    await render({ readOnly: false });
    expect(view().state.readOnly).toBe(false);
  });

  it("reconfigures when the plugins change: a rule, and the extensions", async () => {
    const rule: PreviewRule = { nodes: ["ATXHeading1"], decorate: vi.fn(() => []) };
    await render({ plugins: { rules: [rule] } });
    expect(rule.decorate).toHaveBeenCalled();
    const marker = EditorView.contentAttributes.of({ "data-plugin": "yes" });
    await render({ plugins: { extensions: [marker] } });
    expect(container.querySelector(".cm-content")?.getAttribute("data-plugin")).toBe("yes");
  });

  it("calls onEscape on Escape and handles no other key", async () => {
    const onEscape = vi.fn();
    await render({ onEscape });
    const content = element(".cm-content");
    act(() => {
      content.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("undoes the input with Mod-z in one step", async () => {
    await render();
    const content = element(".cm-content");
    act(() => {
      view().dispatch({ changes: { from: 13, insert: "!" }, userEvent: "input.type" });
      content.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(view().state.doc.toString()).toBe("# Title\n\nbody");
  });

  it("gives a handle to focus, read and replace the document, and takes it back on unmount", async () => {
    const handle = vi.fn<(handle: EditorHandle | undefined) => void>();
    await render({ handle });
    const given = handleOf(handle);
    expect(given.doc()).toBe("# Title\n\nbody");
    expect(given.hasFocus()).toBe(false);
    given.focus();
    expect(view().hasFocus).toBe(true);
    expect(given.hasFocus()).toBe(true);
    given.focus("end");
    expect(view().state.selection.main.head).toBe(13);
    given.focus("start");
    expect(view().state.selection.main.head).toBe(0);
    given.replace("# Title\n\nbody\n");
    expect(given.doc()).toBe("# Title\n\nbody\n");
    expect(undo(view())).toBe(false);
    act(() => {
      root.unmount();
    });
    expect(handle).toHaveBeenLastCalledWith(undefined);
    root = createRoot(container);
  });

  it("sets the document as an edit that can be undone", async () => {
    const handle = vi.fn<(handle: EditorHandle | undefined) => void>();
    const onChange = vi.fn();
    await render({ handle, onChange });
    const given = handleOf(handle);
    act(() => {
      given.set("");
    });
    expect(given.doc()).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
    act(() => {
      expect(undo(view())).toBe(true);
    });
    expect(given.doc()).toBe("# Title\n\nbody");
  });

  it("sets everything while it has no focus", async () => {
    await render();
    expect(container.querySelector(".cm-content")?.textContent).toBe("Titlebody");
  });

  it("gives the state of the editor with the handle", async () => {
    const handle = vi.fn<(handle: EditorHandle | undefined) => void>();
    await render({ handle });
    expect(handleOf(handle).state()).toBe(view().state);
  });

  describe("inline references", () => {
    const ID = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
    const TEXT = `Before [D-017](logreq:${ID}?version=n1:aa) after\n\nsecond line`;
    const follow = vi.fn<(reference: Reference) => void>();
    const mousedown = (target: Element, init: MouseEventInit = {}): MouseEvent => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    };
    const mount = (outdated: ReadonlyMap<string, string> = new Map()) =>
      render({ text: TEXT, plugins: references({ outdated, follow }) });

    it("follows a reference on a press on its label when the line shows no source", async () => {
      follow.mockClear();
      await mount();
      const label = element(".cm-lr-ref");
      expect(label.textContent).toBe("D-017");
      const event = mousedown(label);
      expect(event.defaultPrevented).toBe(true);
      expect(follow).toHaveBeenCalledExactlyOnceWith({
        id: ID,
        version: "n1:aa",
        from: 7,
        to: 7 + `[D-017](logreq:${ID}?version=n1:aa)`.length,
      });
    });

    // The handler is called on its own where CodeMirror's own handling of the press would follow.
    const press = (target: EventTarget, init: MouseEventInit = {}): boolean => {
      const event = new MouseEvent("mousedown", { cancelable: true, button: 0, ...init });
      Object.defineProperty(event, "target", { value: target });
      return followOnMouseDown(follow)(event, view());
    };

    it("ignores other buttons, presses elsewhere and presses that do not hit an element", async () => {
      follow.mockClear();
      await mount();
      expect(press(element(".cm-lr-ref"), { button: 1 })).toBe(false);
      expect(press(element(".cm-line"))).toBe(false);
      expect(press(document)).toBe(false);
      expect(follow).not.toHaveBeenCalled();
      expect(press(element(".cm-lr-ref"))).toBe(true);
      expect(follow).toHaveBeenCalledTimes(1);
    });

    it("on a line that shows its source, a plain press places the cursor and Ctrl or Cmd with it follows", async () => {
      follow.mockClear();
      await mount();
      act(() => {
        view().dispatch({ effects: focusEffect.of(true), selection: { anchor: 3 } });
      });
      const label = element(".cm-lr-ref");
      expect(press(label)).toBe(false);
      expect(follow).not.toHaveBeenCalled();
      expect(press(label, { ctrlKey: true })).toBe(true);
      expect(press(label, { metaKey: true })).toBe(true);
      expect(follow).toHaveBeenCalledTimes(2);
      // The cursor on another line: the label is set again and a plain press follows.
      act(() => {
        view().dispatch({ selection: { anchor: view().state.doc.length } });
      });
      expect(press(element(".cm-lr-ref"))).toBe(true);
      expect(follow).toHaveBeenCalledTimes(3);
    });

    it("does not follow a label whose position is no reference", async () => {
      follow.mockClear();
      await mount();
      const stray = document.createElement("span");
      stray.className = "cm-lr-ref";
      element(".cm-line").append(stray);
      expect(press(stray)).toBe(false);
      expect(follow).not.toHaveBeenCalled();
    });

    it("marks an outdated reference with the accent, the word and the hint on request", async () => {
      await mount(new Map([[outdatedKey(ID, "n1:aa"), "points to an older version"]]));
      const label = element(".cm-lr-outdated");
      expect(label.getAttribute("title")).toBe("points to an older version");
      expect(element(".cm-lr-outdated-word").textContent).toBe(" outdated");
      expect(element(".cm-content").textContent).toBe("Before D-017 outdated after" + "second line");
    });
  });
});
