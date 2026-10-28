// The entries of the slash menu (SR-129) and what taking one writes into the text. Pure functions over the
// editor state: the menu itself (`slash-menu.ts`) only lists, ranks and calls `applyEntry`. The menu edits
// the Markdown source and nothing else; the file is saved by the existing `element.update` (ADR-0002).
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorSelection } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import { nth } from "../lists.js";
import { parsedTree } from "./parsed.js";

/** Where the caret or the selection lands in the inserted text: a line (0 = the first), a column, a length. */
interface Caret {
  readonly line: number;
  readonly column: number;
  readonly length: number;
}

interface Base {
  readonly id: string;
  /** What the menu lists and what the query is matched against. */
  readonly name: string;
  /** The Markdown the entry writes, shown muted at the right of the name. */
  readonly detail: string;
}

export type SlashEntry =
  /** Sets the kind of the line: its own block marker is replaced by `marker`. */
  | (Base & { readonly kind: "line"; readonly marker: string; readonly keepIndent: boolean })
  /** Whole lines of their own (a table, a fence). */
  | (Base & { readonly kind: "block"; readonly lines: readonly string[]; readonly caret: Caret })
  /** A piece of the line, at the place of the `/` and its query. */
  | (Base & { readonly kind: "inline"; readonly text: string; readonly caret: Caret })
  /** Asks for an element; the editor writes the reference when one is picked. */
  | (Base & { readonly kind: "reference" });

const heading = (level: number): SlashEntry => ({
  kind: "line",
  id: `heading-${String(level)}`,
  name: `Heading ${String(level)}`,
  detail: `${"#".repeat(level)} `,
  marker: `${"#".repeat(level)} `,
  keepIndent: false,
});

const line = (id: string, name: string, marker: string, keepIndent: boolean): SlashEntry => ({
  kind: "line",
  id,
  name,
  detail: marker,
  marker,
  keepIndent,
});

const fenced = (id: string, name: string, open: string, close: string): SlashEntry => ({
  kind: "block",
  id,
  name,
  detail: open,
  lines: [open, "", close],
  caret: { line: 1, column: 0, length: 0 },
});

/** The entries in the order of SR-129 AK1, then the two inline formats (assumption A3). */
export const SLASH_ENTRIES: readonly SlashEntry[] = [
  heading(1),
  heading(2),
  heading(3),
  heading(4),
  heading(5),
  heading(6),
  line("text", "Normal text", "", false),
  line("bullet-list", "Bullet list", "- ", true),
  line("numbered-list", "Numbered list", "1. ", true),
  line("task-list", "Task list", "- [ ] ", true),
  line("quote", "Quote", "> ", false),
  fenced("code-block", "Code block", "```", "```"),
  {
    kind: "block",
    id: "table",
    name: "Table",
    detail: "| a | b |",
    lines: ["| Column 1 | Column 2 |", "| --- | --- |", "|  |  |"],
    caret: { line: 0, column: 2, length: 8 },
  },
  {
    kind: "inline",
    id: "link",
    name: "Link",
    detail: "[](url)",
    text: "[]()",
    caret: { line: 0, column: 1, length: 0 },
  },
  { kind: "reference", id: "reference", name: "Reference to element", detail: "[Title](logreq:…)" },
  {
    kind: "inline",
    id: "image",
    name: "Image",
    detail: "![](url)",
    text: "![]()",
    caret: { line: 0, column: 2, length: 0 },
  },
  fenced("math-block", "Math block", "$$", "$$"),
  fenced("diagram", "Diagram", "```mermaid", "```"),
  {
    kind: "inline",
    id: "bold",
    name: "Bold",
    detail: "**…**",
    text: "****",
    caret: { line: 0, column: 2, length: 0 },
  },
  {
    kind: "inline",
    id: "italic",
    name: "Italic",
    detail: "*…*",
    text: "**",
    caret: { line: 0, column: 1, length: 0 },
  },
];

/** What a block would break: the entries a table row offers are the inline ones and the reference. */
export const entriesFor = (inTable: boolean): readonly SlashEntry[] =>
  inTable
    ? SLASH_ENTRIES.filter((entry) => entry.kind === "inline" || entry.kind === "reference")
    : SLASH_ENTRIES;

// Where a `/` does not open the menu and `[[` no search: code, links, addresses, HTML. Formulas (`$…$`) have
// no node yet; their nodes go here when #108 adds them.
const NOT_IN = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "Link",
  "Image",
  "Autolink",
  "URL",
  "HTMLBlock",
  "HTMLTag",
  "CommentBlock",
  "Comment",
]);
const TABLE = new Set(["Table", "TableHeader", "TableRow"]);

const ancestors = (state: EditorState, pos: number): string[] => {
  const names: string[] = [];
  for (
    let node: SyntaxNode | null = parsedTree(state, pos).resolveInner(pos, -1);
    node !== null;
    node = node.parent
  ) {
    names.push(node.name);
  }
  return names;
};

/** Whether the character at `pos` stands in code, a link, an address or HTML (the `/` menu and `[[`, SR-066). */
export const inMarkup = (state: EditorState, pos: number): boolean =>
  ancestors(state, pos + 1).some((name) => NOT_IN.has(name));

/**
 * Whether a `/` at `pos` (already in the document) may open the menu (assumption A1): at the start of a
 * line or after whitespace, and not in code, a link, an address or HTML. So `a/b`, `and/or`, `https://`
 * and paths never open it.
 */
export const opensMenu = (state: EditorState, pos: number): boolean => {
  const before = pos === 0 ? "\n" : state.sliceDoc(pos - 1, pos);
  return /\s/.test(before) && !inMarkup(state, pos);
};

/** The `/` and its query: from the `/` to the caret, and whether it stands in a table row. */
export interface SlashRange {
  readonly from: number;
  readonly to: number;
  /** The characters after the `/`. */
  readonly query: string;
  readonly inTable: boolean;
}

/**
 * The menu's range for the `/` at `slash` with the caret at `head`, or undefined when there is none: the
 * `/` is gone, the caret left the line or stands before it, or the query holds white space or a `/`.
 */
export const slashRange = (state: EditorState, slash: number, head: number): SlashRange | undefined => {
  if (slash >= head || head > state.doc.lineAt(slash).to || state.sliceDoc(slash, slash + 1) !== "/") {
    return undefined;
  }
  const query = state.sliceDoc(slash + 1, head);
  if (/[\s/]/.test(query)) {
    return undefined;
  }
  return {
    from: slash,
    to: head,
    query,
    inTable: ancestors(state, slash + 1).some((name) => TABLE.has(name)),
  };
};

// One block marker at the start of a line (after its indentation).
const MARKER = /^(?:(#{1,6})[ \t]+|([-*+]|\d{1,9}[.)])[ \t]+(\[[ xX]\][ \t]+)?|>[ \t]?)/;

interface Marker {
  readonly text: string;
  /** The text a continuation line of this container starts with; undefined for a marker that is no container. */
  readonly continuation: string | undefined;
}

/** The indentation and the block markers a line starts with (`> - [ ] `). */
const prefixOf = (
  text: string,
): { readonly indent: string; readonly markers: readonly Marker[]; readonly length: number } => {
  const indent = text.slice(0, text.length - text.replace(/^[ \t]+/, "").length);
  const markers: Marker[] = [];
  let at = indent.length;
  for (let match = MARKER.exec(text.slice(at)); match !== null; match = MARKER.exec(text.slice(at))) {
    const [whole, hashes, bullet] = match;
    at += whole.length;
    if (hashes !== undefined) {
      markers.push({ text: whole, continuation: undefined });
    } else if (bullet === undefined) {
      markers.push({ text: whole, continuation: "> " });
    } else {
      // The content of the item starts after the bullet, the box is part of its first paragraph.
      markers.push({
        text: whole,
        continuation: " ".repeat(whole.length - (match[3]?.length ?? 0)),
      });
    }
  }
  return { indent, markers, length: at };
};

/** The line with the `/` and its query taken out, and the caret in what is left. */
const withoutQuery = (
  before: string,
  after: string,
): { readonly content: string; readonly caret: number } => {
  if (after.trim() === "") {
    const content = before.trimEnd();
    return { content, caret: content.length };
  }
  if (before.trim() === "") {
    return { content: after.trimStart(), caret: 0 };
  }
  const gap = /\s$/.test(before) && /^\s/.test(after) ? after.slice(1) : after;
  return { content: before + gap, caret: before.length };
};

const isBlank = (text: string, continuation: string): boolean =>
  text.trim() === "" || text.trim() === continuation.trim();

const lineChange = (
  state: EditorState,
  from: number,
  to: number,
  entry: SlashEntry & { readonly kind: "line" },
): TransactionSpec => {
  const at = state.doc.lineAt(from);
  const before = state.sliceDoc(at.from, from);
  const prefix = prefixOf(before);
  const { content, caret } = withoutQuery(before.slice(prefix.length), state.sliceDoc(to, at.to));
  const head = `${entry.keepIndent ? prefix.indent : ""}${entry.marker}`;
  return {
    changes: { from: at.from, to: at.to, insert: head + content },
    selection: EditorSelection.cursor(at.from + head.length + caret),
  };
};

/** How the line of the `/` is built: what it starts with, what the text of the line is, and the lines below it. */
const blockContext = (
  state: EditorState,
  from: number,
  to: number,
): {
  readonly typed: string;
  readonly rest: string;
  readonly continuation: string;
  readonly empty: boolean;
  readonly inList: boolean;
} => {
  const at = state.doc.lineAt(from);
  const before = state.sliceDoc(at.from, from);
  const prefix = prefixOf(before);
  const rest = withoutQuery(before.slice(prefix.length), state.sliceDoc(to, at.to)).content;
  const containers = prefix.markers.filter((marker) => marker.continuation !== undefined);
  // A heading or a task box belongs to the text of the line: a line with one is not empty.
  const plain =
    prefix.markers.length === containers.length &&
    !prefix.markers.some((marker) => marker.text.includes("["));
  return {
    typed: before.slice(0, prefix.length),
    rest,
    continuation: prefix.indent + containers.map((marker) => marker.continuation).join(""),
    empty: rest === "" && plain,
    inList: containers.some((marker) => marker.continuation?.trim() === ""),
  };
};

const blockChange = (
  state: EditorState,
  from: number,
  to: number,
  entry: SlashEntry & { readonly kind: "block" },
): TransactionSpec => {
  const at = state.doc.lineAt(from);
  const { typed, rest, continuation, empty, inList } = blockContext(state, from, to);
  // An empty line takes the template itself; otherwise it goes below the line, set off by a blank line.
  const first = empty ? typed : continuation;
  const previous = at.number > 1 ? state.doc.line(at.number - 1).text : undefined;
  const next = at.number < state.doc.lines ? state.doc.line(at.number + 1).text : undefined;
  const space = continuation.trimEnd();
  const above = empty ? previous !== undefined && !inList && !isBlank(previous, continuation) : true;
  const below = next !== undefined && !isBlank(next, continuation) && (!empty || !inList);
  const indents = entry.lines.map((_, index) => (index === 0 ? first : continuation));
  const template = entry.lines.map((text, index) => nth(indents, index) + text);
  const written = [
    ...(empty ? [] : [typed + rest]),
    ...(above ? [space] : []),
    ...template,
    ...(below ? [space] : []),
  ];
  const lead = written.length - template.length - (below ? 1 : 0);
  const anchor =
    at.from +
    written.slice(0, lead + entry.caret.line).reduce((sum, text) => sum + text.length + 1, 0) +
    nth(indents, entry.caret.line).length +
    entry.caret.column;
  return {
    changes: { from: at.from, to: at.to, insert: written.join("\n") },
    selection: EditorSelection.range(anchor, anchor + entry.caret.length),
  };
};

const inlineChange = (
  from: number,
  to: number,
  entry: SlashEntry & { readonly kind: "inline" },
): TransactionSpec => ({
  changes: { from, to, insert: entry.text },
  selection: EditorSelection.range(from + entry.caret.column, from + entry.caret.column + entry.caret.length),
});

/**
 * The change that takes `entry` for the `/` and its query in `from` to `to` (a reference is written by
 * `referenceChange` once an element is picked). One transaction, so one undo restores the text as it was
 * before the entry was taken.
 */
export const applyEntry = (
  state: EditorState,
  from: number,
  to: number,
  entry: Exclude<SlashEntry, { readonly kind: "reference" }>,
): TransactionSpec => {
  switch (entry.kind) {
    case "line":
      return lineChange(state, from, to, entry);
    case "block":
      return blockChange(state, from, to, entry);
    case "inline":
      return inlineChange(from, to, entry);
  }
};

/** The element a reference is written for, as the search gives it. */
export interface ReferenceTarget {
  readonly id: string;
  readonly title: string;
  /** The identifier, else the short ID. */
  readonly label: string;
  readonly shortId: string;
  /** The repository of the target. */
  readonly repository: string;
}

const escapeLabel = (label: string): string => label.replace(/[\\[\]`]/g, (char) => `\\${char}`);

/**
 * `[label](logreq:<uuid>)` (ADR-0004): the title within the repository of the source, else the short ID
 * with `?version=&repository=<name>` (D-058). Core fills `version` when the text is saved. An empty title falls back
 * to the identifier, so the label is never empty.
 */
export const referenceMarkdown = (target: ReferenceTarget, sourceRepository: string): string => {
  const same = target.repository === sourceRepository;
  const label =
    same && target.title.trim() !== "" ? target.title.trim() : same ? target.label : target.shortId;
  // The empty `version=` is set by core on save and keeps its place, so the saved link has the order of
  // ADR-0004, `?version=<version>&repository=<name>`; without it core would append the version last.
  const parameters = same ? "" : `?version=&repository=${encodeURIComponent(target.repository)}`;
  return `[${escapeLabel(label)}](logreq:${target.id}${parameters})`;
};
