// @vitest-environment happy-dom
import "../../../../../scripts/test-support/dom-selection.mjs";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { BUILT_IN_RULES, focusState, livePreview } from "./preview.js";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
  document.body.replaceChildren();
});

/** Waits past CodeMirror's 10 ms check of a focus change. */
const settled = (): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, 30);
  });

const viewOf = (doc: string): EditorView => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [markdownSupport({}), livePreview(BUILT_IN_RULES)] }),
  });
  views.push(view);
  return view;
};

describe("the focus of the live preview", () => {
  it("follows the editor that gets the focus back in the task that changes its text (#1308)", async () => {
    const view = viewOf("a");
    const other = document.createElement("input");
    document.body.append(other);
    view.focus();
    await settled();
    expect(view.state.field(focusState)).toBe(true);
    // A prompt takes the focus, and its answer comes before the editor's check of the blur ran: the text
    // changes while the editor has no focus, and the editor takes it back at once.
    other.focus();
    view.dispatch({ changes: { from: 1, insert: "\n![x](a/x.png)" }, selection: { anchor: 15 } });
    view.focus();
    expect(view.hasFocus).toBe(true);
    await settled();
    expect(view.state.field(focusState)).toBe(true);
    // A blur is still followed.
    other.focus();
    await settled();
    expect(view.state.field(focusState)).toBe(false);
  });

  it("asks nothing of an editor that is gone", async () => {
    const view = viewOf("a");
    view.focus();
    // An update before the focus is reported, and the editor goes in the same task.
    view.dispatch({ selection: { anchor: 1 } });
    view.destroy();
    await settled();
    expect(view.state.field(focusState)).toBe(false);
  });
});
