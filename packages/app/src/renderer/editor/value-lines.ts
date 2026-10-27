// The Markdown language of a property box (SR-104, SR-127): every line is its own paragraph. A box holds
// the values of a property, one per line, so a mark must never pair across two values (`*a*` and `b*` are
// no emphasis), and the block syntax of a text (headings, lists, quotes, code, tables, HTML, link
// references, rules) means nothing in a value: `- x` and `# x` stay paragraphs with their source. Only
// the inline syntax remains: emphasis, code, links and references.
import type { MarkdownConfig } from "@lezer/markdown";

/** The block parsers of CommonMark and the GitHub extensions that the editor's parser has. */
const BLOCKS = [
  "LinkReference",
  "IndentedCode",
  "FencedCode",
  "Blockquote",
  "HorizontalRule",
  "BulletList",
  "OrderedList",
  "ATXHeading",
  "HTMLBlock",
  "SetextHeading",
  "Table",
  "TaskList",
];

export const valueLines: MarkdownConfig = {
  remove: BLOCKS,
  // A paragraph ends before every further line, so the next line starts a paragraph of its own.
  parseBlock: [{ name: "ValueLine", endLeaf: () => true }],
};
