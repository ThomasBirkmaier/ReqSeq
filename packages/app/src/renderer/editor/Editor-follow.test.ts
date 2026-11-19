// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside the call; CodeMirror then updates while it updates. The root vitest
// config loads this setup, but a run without it (`pnpm vitest run <file>` in packages/app) needs it too (ThomasBirkmaier/ReqSeq-archive#460).
import "../../../../../scripts/test-support/dom-selection.mjs";
// The editor follows the text from outside (the file was saved or changed) while a save answers in a task of its own
// (#1940): a save that answers after a render was committed and before its effects ran must not make the editor take
// the text of that render, which is older than the save.
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { Fragment, act, createElement, useLayoutEffect } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EditorHandle } from "./Editor.js";
import { Editor } from "./Editor.js";
import { replaceAll } from "./find.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  afterCommit = undefined;
  handle.mockClear();
  act(() => {
    root.unmount();
  });
  container.remove();
});

const TYPED = "Quarz eins, Quarz zwei, Quarz drei";
const REPLACED = "Wind eins, Wind zwei, Wind drei";

/**
 * What runs in the commit of the next render after the editor's layout effects and before the passive effects of
 * that render: where the answer of a save lands that comes in a task of its own between the two.
 */
let afterCommit: (() => void) | undefined;
const Commit = (): null => {
  useLayoutEffect(() => {
    const run = afterCommit;
    afterCommit = undefined;
    run?.();
  });
  return null;
};

const handle = vi.fn<(given: EditorHandle | undefined) => void>();
const show = async (text: string): Promise<void> => {
  await act(async () => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(Editor, { text, readOnly: false, onChange: vi.fn(), onEscape: vi.fn(), handle }),
        createElement(Commit),
      ),
    );
    await Promise.resolve();
  });
};

const view = (): EditorView => {
  const found = EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor") ?? document.body);
  if (found === null) {
    throw new Error("no editor");
  }
  return found;
};

it("[SR-189/AK-mt6q] a save that answers between a render and its effects leaves Replace all one undo step", async () => {
  await show("");
  const editor = handle.mock.calls[0]?.[0];
  if (editor === undefined) {
    throw new Error("no handle given");
  }
  act(() => {
    view().dispatch({ changes: { from: 0, insert: TYPED } });
  });
  // A save of the typed text runs; meanwhile "Replace all" changes every hit.
  act(() => {
    expect(replaceAll(view(), "Quarz", "Wind")).toBe(3);
  });
  // That save answers: the file holds the typed text (the editor holds input, so it keeps its document).
  editor.rebase(`${TYPED}\n`);
  // The render with the saved text is committed, and before its effects run the next save, of the replaced text,
  // answers: the editor shows what the file holds now and compares with it (`settle` in `element-file.ts`).
  afterCommit = () => {
    editor.replace(`${REPLACED}\n`);
    editor.rebase(`${REPLACED}\n`);
  };
  await show(`${TYPED}\n`);
  await show(`${REPLACED}\n`);
  expect(view().state.doc.toString()).toBe(`${REPLACED}\n`);
  act(() => {
    undo(view());
  });
  expect(view().state.doc.toString()).toBe(`${TYPED}\n`);
});
