// @vitest-environment happy-dom
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { act, createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorHandle, EditorProps } from "./Editor.js";
import { Editor } from "./Editor.js";
import type { PreviewRule } from "./plugins.js";

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
    given.focus();
    expect(view().hasFocus).toBe(true);
    given.focus("end");
    expect(view().state.selection.main.head).toBe(13);
    given.replace("# Title\n\nbody\n");
    expect(given.doc()).toBe("# Title\n\nbody\n");
    expect(undo(view())).toBe(false);
    act(() => {
      root.unmount();
    });
    expect(handle).toHaveBeenLastCalledWith(undefined);
    root = createRoot(container);
  });

  it("sets everything while it has no focus", async () => {
    await render();
    expect(container.querySelector(".cm-content")?.textContent).toBe("Titlebody");
  });
});
