// The text of an XHTML value for the import (SR-053), until the conversion to Markdown of SR-095
// takes its place behind the same function (ADR-0013 "Block, parser, conversion"): the text runs in
// document order, a paragraph break around each block element, a line break for `br`, white space
// collapsed, and the Markdown characters that would change the text escaped. Every element other
// than `div`, `p` and `br` is named once in `unconverted`, so the import lists it as a loss
// (`xhtml-element`); its text is kept.
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

/** Characters that would make Markdown of a plain text (emphasis, links, HTML, code). */
const MARKDOWN = /[\\`*_[\]<>]/g;

/** The text of `nodes` (see the file comment). */
export const xhtmlText = (nodes: readonly XhtmlNode[]): XhtmlText => {
  const unconverted = new Set<string>();
  let out = "";
  const walk = (node: XhtmlNode): void => {
    if (typeof node === "string") {
      // A line break in the source is white space like any other (XHTML).
      out += node.replace(/\s+/g, " ").replace(MARKDOWN, "\\$&");
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
  return { text, unconverted: [...unconverted] };
};
