// How inline Markdown nodes are drawn: which range gets which style class, and which ranges are only
// markup (the source characters the preview hides). The live preview and the table cells use the same
// description, so a cell looks like the same text outside a table.
import type { SyntaxNode } from "@lezer/common";

export interface Styled {
  readonly from: number;
  readonly to: number;
  readonly className: string;
}

export interface Hidden {
  readonly from: number;
  readonly to: number;
}

export interface InlineMarkup {
  readonly styled: readonly Styled[];
  readonly hidden: readonly Hidden[];
}

const NONE: InlineMarkup = { styled: [], hidden: [] };

const STYLES: Readonly<Record<string, { readonly className: string; readonly marks: string }>> = {
  Emphasis: { className: "cm-lr-em", marks: "EmphasisMark" },
  StrongEmphasis: { className: "cm-lr-strong", marks: "EmphasisMark" },
  Strikethrough: { className: "cm-lr-strike", marks: "StrikethroughMark" },
  InlineCode: { className: "cm-lr-code", marks: "CodeMark" },
};

/** The node names `inlineMarkup` describes. */
export const INLINE_NODES: readonly string[] = [...Object.keys(STYLES), "Link", "Autolink", "URL"];

const span = (node: { readonly from: number; readonly to: number }): Hidden => ({
  from: node.from,
  to: node.to,
});

/** The style and the hidden markup of one inline node; nothing for any other node. */
export const inlineMarkup = (node: SyntaxNode): InlineMarkup => {
  const style = STYLES[node.name];
  if (style !== undefined) {
    return {
      styled: [{ from: node.from, to: node.to, className: style.className }],
      hidden: node.getChildren(style.marks).map(span),
    };
  }
  if (node.name === "Link") {
    // `[text](url "title")`: the text is the link, everything after its closing bracket is markup.
    const marks = node.getChildren("LinkMark");
    return {
      styled: marks
        .slice(0, 1)
        .flatMap((open) =>
          marks.slice(1, 2).map((close) => ({ from: open.to, to: close.from, className: "cm-lr-link" })),
        ),
      hidden: [
        ...marks.slice(0, 1).map(span),
        ...marks.slice(1, 2).map((close) => ({ from: close.from, to: node.to })),
      ],
    };
  }
  if (node.name === "Autolink") {
    return {
      styled: node.getChildren("URL").map((url) => ({ from: url.from, to: url.to, className: "cm-lr-link" })),
      hidden: node.getChildren("LinkMark").map(span),
    };
  }
  if (node.name === "URL") {
    // A bare URL (GitHub autolink); inside a link, an image or an autolink it is markup of that node.
    return ["Link", "Image", "Autolink"].some((parent) => node.matchContext([parent]))
      ? NONE
      : { styled: [{ from: node.from, to: node.to, className: "cm-lr-link" }], hidden: [] };
  }
  return NONE;
};
