// Formatting the selection (SR-186): bold, italic and inline code toggle their Markdown marks around the
// selection or the word at the caret, and "Link" writes a Markdown link with a typed address. Pure changes
// of the editor state over the syntax tree (`parsed.ts`), wrapped as CodeMirror commands; the actions of the
// command prompt run them on the text (`text-actions.ts`), and the keys Ctrl/Cmd+B and Ctrl/Cmd+I run them in
// the editor with the focus (`formatting`). Each is one transaction kept apart in the undo history, so one
// undo takes the whole formatting back (AK6). The editor writes only Markdown of CommonMark and GFM (D-074).
import { isolateHistory } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import type { EditorState, SelectionRange, TransactionSpec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { Command, EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { parsedTree } from "./parsed.js";
import type { EditorPlugins } from "./plugins.js";

export type Format = "bold" | "italic" | "code";

/** The node of the syntax tree each format makes, and the mark it writes (AK1). */
const NODE: Readonly<Record<Format, string>> = {
  bold: "StrongEmphasis",
  italic: "Emphasis",
  code: "InlineCode",
};
const MARK: Readonly<Record<Format, string>> = { bold: "**", italic: "*", code: "`" };

/** Where the text of a formatted node lies, between its opening and its closing mark. */
const contentOf = (node: SyntaxNode): { readonly from: number; readonly to: number } => ({
  from: node.firstChild?.to ?? node.from,
  to: node.lastChild?.from ?? node.to,
});

/**
 * The node of `format` the range is in: its text holds the range, or the range is the node with its marks.
 * The nearest one, so `***x***` finds the bold and the italic around `x`.
 */
const formattedAround = (
  state: EditorState,
  range: SelectionRange,
  format: Format,
): SyntaxNode | undefined => {
  const tree = parsedTree(state, range.to);
  // A caret also counts when it touches the marks from outside (`**word**‸`): from both sides of it.
  const starts = range.empty
    ? [tree.resolveInner(range.from, 1), tree.resolveInner(range.from, -1)]
    : [tree.resolveInner(range.from, 1)];
  for (const start of starts) {
    for (let node: SyntaxNode | null = start; node !== null; node = node.parent) {
      if (node.name === NODE[format]) {
        const content = contentOf(node);
        const inside = content.from <= range.from && range.to <= content.to;
        const touching = range.empty && node.from <= range.from && range.from <= node.to;
        if (inside || touching || (node.from === range.from && node.to === range.to)) {
          return node;
        }
      }
    }
  }
  return undefined;
};

/** The marks of an inline code span around `text`: one backtick more than its longest run, padded when needed. */
const codeMarks = (text: string): { readonly open: string; readonly close: string } => {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return { open: fence + pad, close: pad + fence };
};

const marksFor = (format: Format, text: string): { readonly open: string; readonly close: string } =>
  format === "code" ? codeMarks(text) : { open: MARK[format], close: MARK[format] };

/** The marks are taken off `node`; the range keeps its text. */
const unwrap = (range: SelectionRange, node: SyntaxNode) => {
  const content = contentOf(node);
  const removed = content.from - node.from;
  const mapped = (pos: number): number =>
    pos <= content.from ? Math.max(node.from, pos - removed) : Math.min(pos, content.to) - removed;
  return {
    changes: [
      { from: node.from, to: content.from },
      { from: content.to, to: node.to },
    ],
    range: EditorSelection.range(mapped(range.anchor), mapped(range.head)),
  };
};

/** The marks go around `from` to `to`; the selection lies on the text again (`select`), else the caret moves with its character. */
const wrap = (
  state: EditorState,
  range: SelectionRange,
  from: number,
  to: number,
  format: Format,
  select: boolean,
) => {
  const { open, close } = marksFor(format, state.sliceDoc(from, to));
  return {
    changes: [
      { from, insert: open },
      { from: to, insert: close },
    ],
    range: select
      ? EditorSelection.range(from + open.length, to + open.length)
      : EditorSelection.cursor(range.head + open.length),
  };
};

/** An empty pair of the marks right around the caret (`**‸**`), which the format typed again takes away. */
const emptyPairAt = (state: EditorState, pos: number, format: Format): boolean => {
  const mark = MARK[format];
  const before = state.sliceDoc(Math.max(0, pos - mark.length - 1), pos);
  const after = state.sliceDoc(pos, pos + mark.length + 1);
  // `*‸*` of italic is not the middle of a bold pair `**‸**`, which the italic would cut in half.
  const char = mark.charAt(0);
  const exact = (side: string, at: "start" | "end"): boolean =>
    at === "end"
      ? side.endsWith(mark) && !side.slice(0, -mark.length).endsWith(char)
      : side.startsWith(mark) && !side.slice(mark.length).startsWith(char);
  return exact(before, "end") && exact(after, "start");
};

const rangeChange = (state: EditorState, range: SelectionRange, format: Format) => {
  const node = formattedAround(state, range, format);
  if (node !== undefined) {
    return unwrap(range, node);
  }
  const text = state.sliceDoc(range.from, range.to);
  if (text.trim() !== "") {
    // White space at the edges stays outside: `** word**` would be no emphasis (CommonMark flanking).
    const from = range.from + (text.length - text.trimStart().length);
    const to = range.to - (text.length - text.trimEnd().length);
    return wrap(state, range, from, to, format, true);
  }
  const pos = range.head;
  if (range.empty && emptyPairAt(state, pos, format)) {
    const { length } = MARK[format];
    return {
      changes: [{ from: pos - length, to: pos + length }],
      range: EditorSelection.cursor(pos - length),
    };
  }
  const word = range.empty ? state.wordAt(pos) : null;
  if (word !== null) {
    return wrap(state, range, word.from, word.to, format, false);
  }
  const { open, close } = marksFor(format, "");
  return {
    changes: [{ from: range.from, to: range.to, insert: open + close }],
    range: EditorSelection.cursor(range.from + open.length),
  };
};

/**
 * The change that toggles `format` at every range of the selection (AK1, AK3, AK4): a range in a node of the
 * format loses its marks; a selection gets them around its text and stays on it; a caret puts them around
 * its word, or writes an empty pair with the caret between them.
 */
export const formatChange = (state: EditorState, format: Format): TransactionSpec =>
  state.changeByRange((range) => rangeChange(state, range, format));

/** A link destination as CommonMark reads it: in angle brackets when it holds white space or parentheses. */
const destination = (address: string): string => {
  const escaped = address.replace(/[<>]/g, (char) => encodeURIComponent(char));
  return /[\s()]/.test(escaped) ? `<${escaped}>` : escaped;
};

const escapeLabel = (label: string): string => label.replace(/[\\[\]]/g, (char) => `\\${char}`);

/**
 * The change that writes a link to `address` (AK5): a selection becomes its text and stays selected; at a
 * caret the address is the text too, and the caret goes after the link.
 */
export const linkChange = (state: EditorState, address: string): TransactionSpec => {
  const target = destination(address.trim());
  return state.changeByRange((range) => {
    if (range.empty) {
      const link = `[${escapeLabel(address.trim())}](${target})`;
      return {
        changes: { from: range.from, insert: link },
        range: EditorSelection.cursor(range.from + link.length),
      };
    }
    // A bracket of the selected text that is not escaped would end the label early (`[a]b](x)`).
    const text = state.sliceDoc(range.from, range.to).replace(/(?<!\\)[[\]]/g, (char) => `\\${char}`);
    return {
      changes: { from: range.from, to: range.to, insert: `[${text}](${target})` },
      range: EditorSelection.range(range.from + 1, range.from + 1 + text.length),
    };
  });
};

/** `spec` as one step of the undo history of its own (AK6), not joined with the typing before it. */
const dispatchStep = (view: EditorView, spec: TransactionSpec): boolean => {
  if (view.state.readOnly) {
    return false;
  }
  view.dispatch(spec, { userEvent: "input.format", annotations: isolateHistory.of("full") });
  return true;
};

/** The command that toggles `format` (AK1, AK3, AK4); false in a read-only editor. */
export const toggleFormat =
  (format: Format): Command =>
  (view) =>
    dispatchStep(view, formatChange(view.state, format));

/** The command that writes a link to `address` (AK5); false for an empty address or a read-only editor. */
export const insertLink =
  (address: string): Command =>
  (view) =>
    address.trim() !== "" && dispatchStep(view, linkChange(view.state, address));

/** The keys of the formats in the editors that hold Markdown, as CodeMirror names them (Mod: Cmd on macOS, SR-145). */
export const FORMAT_KEYS = { bold: "Mod-b", italic: "Mod-i" } as const;

const swallow: Command = () => true;

/**
 * The formats' keys (AK2) in an editor: the editor with the focus takes them, so the window's shortcut of the
 * action reaches the text only from outside an editor. `markdown`: the text and the Markdown property boxes,
 * which format; elsewhere (the title, a plain box) the keys do nothing, rather than format the text out of
 * sight. A read-only editor leaves them to the window, which says why the text takes no input. On macOS the
 * physical Ctrl+B stays CodeMirror's Emacs key (one character back).
 */
export const formatKeys = (markdown: boolean): EditorPlugins => ({
  extensions: [
    keymap.of([
      { key: FORMAT_KEYS.bold, run: markdown ? toggleFormat("bold") : swallow },
      { key: FORMAT_KEYS.italic, run: markdown ? toggleFormat("italic") : swallow },
    ]),
  ],
});
