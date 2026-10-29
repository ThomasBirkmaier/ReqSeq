// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside the call; CodeMirror then updates while it updates (#460).
import "../../../../../scripts/test-support/dom-selection.mjs";
// The commands that act on a key read the whole syntax tree, also when CodeMirror's first parse stopped
// early (a busy machine, #542). A state "cut short" is made with a clock that runs 30 ms on every look, so
// the first parse stops after one step, as it does when the machine is slow.
import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownSupport } from "./markdown.js";
import { parsedFirst, parsedTree } from "./parsed.js";
import { referenceAt, referencesIn } from "./references.js";
import { opensMenu } from "./slash-entries.js";

const ID = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
const REFERENCE = `[D-017](reqseq:${ID}?version=n1:1aac78aad3b5e6a8)`;
/** Blocks before the place a test is about, so a parse cut short does not reach it. */
const BEFORE = "One.\n\nTwo.\n\nThree.\n\n";

/** `run` with a clock that runs 30 ms on every look: every parse slice stops after its first step. */
const slowly = <T>(run: () => T): T => {
  let clock = 0;
  const slow = vi.spyOn(Date, "now").mockImplementation(() => (clock += 30));
  try {
    return run();
  } finally {
    slow.mockRestore();
  }
};

/** A state whose first parse stopped after its first step, with the caret at `anchor` (default: the end). */
const cutShort = (
  doc: string,
  extensions: Extension = markdownSupport({}),
  anchor = doc.length,
): EditorState => {
  const state = slowly(() => EditorState.create({ doc, selection: { anchor }, extensions }));
  // The premise: the tree the state holds does not reach the end of the document.
  expect(syntaxTree(state).length).toBeLessThan(doc.length);
  return state;
};

let views: EditorView[] = [];
afterEach(() => {
  for (const view of views) {
    view.destroy();
  }
  views = [];
});

const viewOf = (state: EditorState): EditorView => {
  const view = new EditorView({ state, parent: document.body });
  views.push(view);
  return view;
};

/** A key pressed in the editor, through its keymap. */
const press = (view: EditorView, key: string): void => {
  view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
};

describe("parsedTree", () => {
  it("is the tree of the whole document, also when the first parse stopped early", () => {
    const state = cutShort(`${BEFORE}Four.`);
    expect(parsedTree(state).length).toBe(state.doc.length);
  });

  it("reaches past the block of the caret: a header row is a table only with the line after it", () => {
    const doc = `${BEFORE}| a | b |\n| - | - |\n\nAfter.`;
    const at = `${BEFORE}| a`.length;
    const names: string[] = [];
    for (
      let node: SyntaxNode | null = parsedTree(cutShort(doc), at).resolveInner(at, -1);
      node;
      node = node.parent
    ) {
      names.push(node.name);
    }
    expect(names).toContain("Table");
  });

  it("needs no block on the empty line between two blocks", () => {
    const state = cutShort(`${BEFORE}Four.`);
    expect(parsedTree(state, BEFORE.length - 1).length).toBeGreaterThanOrEqual(BEFORE.length - 1);
  });

  it("is the empty tree of a state without a language", () => {
    expect(parsedTree(EditorState.create({ doc: "x" })).length).toBe(0);
  });
});

describe("parsedFirst", () => {
  it("runs the command on a state that holds the tree past the block of the caret", () => {
    const view = viewOf(cutShort(`${BEFORE}Four.`));
    const command = vi.fn((target: EditorView) => syntaxTree(target.state).length);
    parsedFirst((target) => command(target) > 0)(view);
    expect(command).toHaveReturnedWith(view.state.doc.length);
  });
});

describe("the keys and commands of the text before the parse is done", () => {
  it("Enter at the end of a list item continues the list", () => {
    const view = viewOf(cutShort(`${BEFORE}- a`));
    press(view, "Enter");
    expect(view.state.doc.toString()).toBe(`${BEFORE}- a\n- `);
  });

  it("Enter in an ordered list numbers the items after the caret on", () => {
    const doc = `${BEFORE}1. a\n2. b\n3. c\n\nAfter.`;
    const view = viewOf(cutShort(doc, markdownSupport({}), `${BEFORE}1. a`.length));
    // Still slow: the transaction of the key does not finish the parse on its own.
    slowly(() => {
      press(view, "Enter");
    });
    expect(view.state.doc.toString()).toBe(`${BEFORE}1. a\n2. \n3. b\n4. c\n\nAfter.`);
  });

  it("Enter in a loose list keeps it loose", () => {
    const view = viewOf(cutShort(`${BEFORE}- a\n\n- b`, markdownSupport({}), `${BEFORE}- a`.length));
    slowly(() => {
      press(view, "Enter");
    });
    expect(view.state.doc.toString()).toBe(`${BEFORE}- a\n\n- \n\n- b`);
  });

  it("Backspace after an empty list marker removes the marker, not one character", () => {
    const view = viewOf(cutShort(`${BEFORE}- a\n- `));
    press(view, "Backspace");
    expect(view.state.doc.toString()).toBe(`${BEFORE}- a\n  `);
  });

  it("Follow reference finds the reference at the cursor and in the document", () => {
    const state = cutShort(`${BEFORE}See ${REFERENCE}`);
    expect(referenceAt(state, state.doc.length - 2)?.id).toBe(ID);
    expect(referencesIn(cutShort(`${BEFORE}See ${REFERENCE}`)).map((found) => found.id)).toEqual([ID]);
  });

  it("[SR-129/AK1] a / in a code block opens no slash menu", () => {
    const doc = `${BEFORE}\`\`\`\ncode /`;
    expect(opensMenu(cutShort(doc), doc.length - 1)).toBe(false);
  });
});
