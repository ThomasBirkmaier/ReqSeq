// @vitest-environment happy-dom
// The editor's keys under Windows (#304). CodeMirror reads the platform once, when its view module loads,
// so this file sets `navigator.platform` before it imports the editor.
import "../../../../../scripts/test-support/dom-selection.mjs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("[SR-105/AK2] under Windows Ctrl+Shift+Z redoes as Ctrl+Y does; CodeMirror binds it only on Linux and macOS", async () => {
  Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
  const { EditorView } = await import("@codemirror/view");
  const { Editor } = await import("./Editor.js");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(Editor, { text: "body", readOnly: false, onChange: vi.fn(), onEscape: vi.fn() }),
    );
    await Promise.resolve();
  });
  const editor = container.querySelector<HTMLElement>(".cm-editor");
  const view = editor === null ? null : EditorView.findFromDOM(editor);
  if (view === null) {
    throw new Error("no editor");
  }
  // As a browser sends it: `key` is the shifted letter, `keyCode` the key (CodeMirror reads the base from it).
  const press = (key: string, keyCode: number, shiftKey = false): void => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        keyCode,
        ctrlKey: true,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  };
  const steps: string[] = [];
  act(() => {
    view.dispatch({ changes: { from: 4, insert: "!" }, userEvent: "input.type" });
    press("z", 90);
    steps.push(view.state.doc.toString());
    press("Z", 90, true);
    steps.push(view.state.doc.toString());
    press("z", 90);
    press("y", 89);
    steps.push(view.state.doc.toString());
  });
  expect(steps).toEqual(["body", "body!", "body!"]);
  act(() => {
    root.unmount();
  });
  container.remove();
});
