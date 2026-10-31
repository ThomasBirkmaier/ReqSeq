// The text of an XHTML value for the import (SR-053), until the conversion to Markdown of SR-095
// takes its place behind the same function (ADR-0013 "Block, parser, conversion"): the text runs in
// document order, a paragraph break around each block element, a line break for `br`, white space
// collapsed. Every element other than `div`, `p` and `br` is named once in `unconverted`, so the
// import lists it as a loss (`xhtml-element`); its text is kept. For a Markdown target (the text, a
// property with `markdown: true`) the text is escaped by `markdownText`, so it reads back as written;
// for a plain one (the title, other properties) it stays as it is.
import type { XhtmlNode } from "./model.js";

/** What `xhtmlText` gives. */
export interface XhtmlText {
  readonly text: string;
  /** Local names of the elements whose form was not taken over, once each, in document order. */
  readonly unconverted: readonly string[];
}

/** Elements whose form plain paragraphs keep. */
const PLAIN: ReadonlySet<string> = new Set(["div", "p", "br"]);

/** Elements that start a paragraph of their own. */
const BLOCKS: ReadonlySet<string> = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "tr",
  "pre",
  "blockquote",
  "object",
]);

/** Characters that make Markdown anywhere in a line (emphasis, code, links, HTML, entities, tables). */
const INLINE = /[\\`*_[\]<>&|~]/g;

/** A line start that makes Markdown: a heading, list item, setext underline or ordered list item. */
const LINE_START = /^(?:([#+=-])|(\d+)([.)]))/;

/**
 * `text` escaped for a Markdown body or value: every character of `INLINE` and the line starts of
 * `LINE_START` get a backslash (CommonMark escapes), so the text renders as written.
 */
export const markdownText = (text: string): string =>
  text
    .split("\n")
    .map((line) =>
      line
        .replace(INLINE, "\\$&")
        .replace(LINE_START, (_all, mark: string | undefined, digits: string, dot: string) =>
          mark === undefined ? `${digits}\\${dot}` : `\\${mark}`,
        ),
    )
    .join("\n");

/** The text of `nodes` (see the file comment), escaped for Markdown when `markdown`. */
export const xhtmlText = (nodes: readonly XhtmlNode[], markdown: boolean): XhtmlText => {
  const unconverted = new Set<string>();
  let out = "";
  const walk = (node: XhtmlNode): void => {
    if (typeof node === "string") {
      // A line break in the source is white space like any other (XHTML).
      out += node.replace(/\s+/g, " ");
      return;
    }
    if (!PLAIN.has(node.name)) {
      unconverted.add(node.name);
    }
    if (node.name === "br") {
      out += "\n";
      return;
    }
    const block = BLOCKS.has(node.name);
    out += block ? "\n\n" : "";
    node.children.forEach(walk);
    out += block ? "\n\n" : "";
  };
  nodes.forEach(walk);
  const text = out
    .split("\n")
    .map((line) => line.replace(/ {2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: markdown ? markdownText(text) : text, unconverted: [...unconverted] };
};
