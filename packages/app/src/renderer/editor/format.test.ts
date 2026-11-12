// @vitest-environment happy-dom
// happy-dom fires `selectionchange` inside the call (ThomasBirkmaier/ReqSeq-archive#460).
import "../../../../../scripts/test-support/dom-selection.mjs";
// SR-186: formatting the selection. The state shows the caret as ‸ and a selection as ‹…›; the result is
// parsed by micromark with the GitHub extensions, the independent reference parser, as in `round-trip.test.ts`.
import { history, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { afterEach, describe, expect, it } from "vitest";
import { formatChange, formatKeys, insertLink, linkChange, toggleFormat } from "./format.js";
import type { Format } from "./format.js";
import { markdownSupport } from "./markdown.js";

/** A state from text with ‸ or ‹…› (several selections allowed). */
const stateOf = (marked: string, extensions: readonly unknown[] = []): EditorState => {
  const ranges: { anchor: number; head: number }[] = [];
  let doc = "";
  let open = -1;
  for (const char of marked) {
    if (char === "‸") {
      ranges.push({ anchor: doc.length, head: doc.length });
    } else if (char === "‹") {
      open = doc.length;
    } else if (char === "›") {
      ranges.push({ anchor: open, head: doc.length });
    } else {
      doc += char;
    }
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map((range) => EditorSelection.range(range.anchor, range.head))),
    extensions: [markdownSupport({}), EditorState.allowMultipleSelections.of(true), ...(extensions as [])],
  });
};

const shown = (state: EditorState): string => {
  const doc = state.doc.toString();
  let out = "";
  let at = 0;
  for (const range of state.selection.ranges) {
    out += doc.slice(at, range.from) + (range.empty ? "‸" : `‹${doc.slice(range.from, range.to)}›`);
    at = range.to;
  }
  return out + doc.slice(at);
};

const formatted = (marked: string, format: Format): string => {
  const state = stateOf(marked);
  return shown(state.update(formatChange(state, format)).state);
};

const html = (markdown: string): string =>
  micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] }).trim();

const views: EditorView[] = [];
const viewOf = (marked: string, readOnly = false): EditorView => {
  const view = new EditorView({
    state: stateOf(marked, [history(), EditorState.readOnly.of(readOnly), formatKeys(true).extensions ?? []]),
    parent: document.body,
  });
  views.push(view);
  return view;
};
afterEach(() => {
  views.splice(0).forEach((view) => {
    view.destroy();
  });
});

describe("formatting the selection", () => {
  it("[SR-186/AK-vzm9] puts the marked text between **, * or ` and keeps the selection on it", () => {
    expect(formatted("a ‹word› b", "bold")).toBe("a **‹word›** b");
    expect(formatted("a ‹word› b", "italic")).toBe("a *‹word›* b");
    expect(formatted("a ‹word› b", "code")).toBe("a `‹word›` b");
    expect(html("a **word** b")).toBe("<p>a <strong>word</strong> b</p>");
    // White space at the edges stays outside, so the result is emphasis.
    expect(formatted("a‹ two words ›b", "bold")).toBe("a **‹two words›** b");
    expect(html("a **two words** b")).toContain("<strong>two words</strong>");
    // Backticks in the code: a longer fence, padded where the text starts or ends with one.
    expect(formatted("‹a`b›", "code")).toBe("``‹a`b›``");
    expect(formatted("‹`x›", "code")).toBe("`` ‹`x› ``");
    expect(html("`` `x ``")).toBe("<p><code>`x</code></p>");
    // Every selection.
    expect(formatted("‹a› and ‹b›", "italic")).toBe("*‹a›* and *‹b›*");
  });

  it("[SR-186/AK-ykwj] Ctrl/Cmd+B and Ctrl/Cmd+I in the editor do what Bold and Italic do", () => {
    const view = viewOf("a ‹word› b");
    const key = (key: string): void => {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: !navigator.platform.includes("Mac"),
          metaKey: navigator.platform.includes("Mac"),
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    key("b");
    expect(shown(view.state)).toBe("a **‹word›** b");
    key("i");
    expect(shown(view.state)).toBe("a ***‹word›*** b");
  });

  it("[SR-186/AK-njft] the same format again takes the marks off", () => {
    expect(formatted("a **‹word›** b", "bold")).toBe("a ‹word› b");
    expect(formatted("a ‹**word**› b", "bold")).toBe("a ‹word› b");
    expect(formatted("a *‹word›* b", "italic")).toBe("a ‹word› b");
    expect(formatted("a _‹word›_ b", "italic")).toBe("a ‹word› b");
    expect(formatted("a `‹word›` b", "code")).toBe("a ‹word› b");
    expect(formatted("``‹a`b›``", "code")).toBe("‹a`b›");
    // Bold and italic together: each takes off its own marks.
    expect(formatted("***‹x›***", "bold")).toBe("*‹x›*");
    expect(formatted("***‹x›***", "italic")).toBe("**‹x›**");
    // Italic on bold text adds italic; bold on italic text adds bold.
    expect(formatted("**‹x›**", "italic")).toBe("***‹x›***");
    // A part of a formatted text: the format around it goes.
    expect(formatted("**a ‹b› c**", "bold")).toBe("a ‹b› c");
  });

  it("[SR-186/AK-ddb8] without a selection, the marks go around the word at the caret, or an empty pair in white space", () => {
    expect(formatted("a wo‸rd b", "bold")).toBe("a **wo‸rd** b");
    expect(formatted("a wo‸rd b", "code")).toBe("a `wo‸rd` b");
    expect(formatted("a ‸ b", "italic")).toBe("a *‸* b");
    expect(formatted("‸", "bold")).toBe("**‸**");
    expect(formatted("‸", "code")).toBe("`‸`");
    // Again on the word or the empty pair: taken back.
    expect(formatted("a **wo‸rd** b", "bold")).toBe("a wo‸rd b");
    expect(formatted("a **‸** b", "bold")).toBe("a ‸ b");
    expect(formatted("a *‸* b", "italic")).toBe("a ‸ b");
    // Italic in an empty bold pair is no half of it.
    expect(formatted("a **‸** b", "italic")).toBe("a ***‸*** b");
    // A caret touching the marks from outside takes them off too.
    expect(formatted("a **word**‸ x", "bold")).toBe("a word‸ x");
    expect(formatted("a ‸**word** x", "bold")).toBe("a ‸word x");
    expect(formatted("a `‸` b", "code")).toBe("a ‸ b");
    // A selection of white space only is an empty pair in its place.
    expect(formatted("a‹ ›b", "bold")).toBe("a**‸**b");
  });

  it("[SR-186/AK-gbzd] Link writes the selection as a Markdown link with the address, or the address as text at the caret", () => {
    const linked = (marked: string, address: string): string => {
      const state = stateOf(marked);
      return shown(state.update(linkChange(state, address)).state);
    };
    expect(linked("see ‹the spec› now", "https://example.org/a")).toBe(
      "see [‹the spec›](https://example.org/a) now",
    );
    expect(html("see [the spec](https://example.org/a) now")).toBe(
      '<p>see <a href="https://example.org/a">the spec</a> now</p>',
    );
    expect(linked("see ‸ now", " https://example.org ")).toBe(
      "see [https://example.org](https://example.org)‸ now",
    );
    // Spaces and parentheses: the destination in angle brackets.
    expect(linked("‹x›", "docs/a b (1).md")).toBe("[‹x›](<docs/a b (1).md>)");
    expect(html("[x](<docs/a b (1).md>)")).toBe('<p><a href="docs/a%20b%20(1).md">x</a></p>');
    // Brackets of the selected text are escaped, so the label does not end early.
    expect(linked("‹a]b›", "x")).toBe("[‹a\\]b›](x)");
    expect(linked("‹a\\]b›", "x")).toBe("[‹a\\]b›](x)");
    expect(linked("‸", "a<b>[c]")).toBe("[a<b>\\[c\\]](a%3Cb%3E[c])‸");
  });

  it("[SR-186/AK-tbd1] one undo takes the whole formatting back, also right after typing", () => {
    const view = viewOf("a ‸");
    view.dispatch({
      changes: { from: 2, insert: "word" },
      selection: { anchor: 6 },
      userEvent: "input.type",
    });
    expect(toggleFormat("bold")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a **word**");
    undo(view);
    expect(view.state.doc.toString()).toBe("a word");
    view.dispatch({ selection: { anchor: 2, head: 6 } });
    expect(insertLink("https://x.org")(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("a [word](https://x.org)");
    undo(view);
    expect(view.state.doc.toString()).toBe("a word");
  });

  it("writes nothing in a read-only editor or for an empty address", () => {
    const view = viewOf("‹a›", true);
    expect(toggleFormat("bold")(view)).toBe(false);
    expect(insertLink("x")(view)).toBe(false);
    expect(insertLink("  ")(viewOf("‹a›"))).toBe(false);
    expect(view.state.doc.toString()).toBe("a");
  });
});
