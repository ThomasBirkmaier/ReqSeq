// Pasted formatted text as Markdown (SR-190 AK1, D-074): the HTML a browser or a word processor puts on
// the clipboard, as our XHTML node tree (the app builds it from an inert `DOMParser` document, nothing
// else), goes through the conversion of the ReqIF import (`xhtml-markdown.ts`: hast,
// `hast-util-to-mdast`, `mdast-util-to-markdown` with GFM, in the editor's style). This module prepares
// the tree first and sets what a paste needs:
//
// - Office styles: a `style` with a bold weight or italics becomes `strong` or `em`; a `b` or `strong`
//   with a normal weight is no emphasis (Google Docs wraps a whole paste in one); Word's list
//   paragraphs (`mso-list: l0 level2`) become nested `ul`/`ol` items, without their marker spans.
// - Links only to `http:`, `https:`, `mailto:` and `reqseq:` (any other, such as `javascript:`, is its
//   text); images only with `http:` or `https:` (the editor never loads them, SR-184 AK3). Other images
//   (`data:`, `file:`, `blob:`) are their alt text, and their number is given back.
// - Nothing is written as HTML: a line end in a table cell is a space. `$` is escaped, which the
//   editor reads as a formula (SR-096).
// - HTML without any formatting, and styled code (`white-space: pre`, as code editors copy), give
//   undefined: the caller pastes the plain text then, so copied Markdown source stays as it is.
//
// Pure: no file, no network. The app imports it as `@reqseq/core/pasted-markdown`.
import type { XhtmlElement, XhtmlNode } from "./model.js";
import { XHTML_NAMESPACE } from "./model.js";
import { prepareMarkdown } from "./xhtml-markdown.js";

export type { XhtmlElement, XhtmlNode } from "./model.js";
export { XHTML_NAMESPACE } from "./model.js";

export interface PastedMarkdown {
  readonly markdown: string;
  /** Images left out because their address is neither `http:` nor `https:`. */
  readonly droppedImages: number;
}

/** Elements whose content is never text of the paste. */
const DROPPED: ReadonlySet<string> = new Set(
  "script style head title meta link template noscript iframe object embed svg math".split(" "),
);

/** Elements that make a paste formatted; without one (and without a bold or italic style) it is plain text. */
const FORMATTING: ReadonlySet<string> = new Set(
  "h1 h2 h3 h4 h5 h6 strong b em i ul ol table a img blockquote pre code del s strike hr".split(" "),
);

const LINK = /^(?:https?|mailto|reqseq):/i;
const WEB_IMAGE = /^https?:/i;
/** Nesting kept; deeper elements keep their text (the conversion stops at 256 too). */
const MAX_DEPTH = 200;

const attributeOf = (element: XhtmlElement, name: string): string | undefined => {
  for (let i = 0; i < element.attributes.length; i += 2) {
    if (element.attributes[i]?.toLowerCase() === name) {
      return element.attributes[i + 1];
    }
  }
  return undefined;
};

const element = (
  name: string,
  children: readonly XhtmlNode[],
  attributes: readonly string[] = [],
): XhtmlElement => ({
  name,
  namespace: XHTML_NAMESPACE,
  attributes,
  children,
});

/** The declarations of a `style` attribute, by property in lower case. */
const styleOf = (node: XhtmlElement): ReadonlyMap<string, string> => {
  const style = new Map<string, string>();
  for (const declaration of (attributeOf(node, "style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0) {
      style.set(
        declaration.slice(0, colon).trim().toLowerCase(),
        declaration
          .slice(colon + 1)
          .trim()
          .toLowerCase(),
      );
    }
  }
  return style;
};

const isBold = (weight: string | undefined): boolean =>
  weight === "bold" || weight === "bolder" || Number(weight) >= 600;
const isNormal = (weight: string | undefined): boolean =>
  weight === "normal" || weight === "lighter" || Number(weight) < 600;

const textOf = (nodes: readonly XhtmlNode[]): string =>
  nodes.map((node) => (typeof node === "string" ? node : textOf(node.children))).join("");

/** The level of a Word list paragraph (`mso-list: l0 level2 lfo1`), or undefined. */
const listLevel = (node: XhtmlElement): number | undefined => {
  const list = styleOf(node).get("mso-list");
  const level = list === undefined ? undefined : /level(\d+)/.exec(list)?.[1];
  return level === undefined || node.name !== "p" ? undefined : Number(level);
};

/** Whether a node is the marker Word writes before a list paragraph's text (`mso-list: Ignore`). */
const isListMarker = (node: XhtmlNode): node is XhtmlElement =>
  typeof node !== "string" && styleOf(node).get("mso-list") === "ignore";

/** A list being built from Word's list paragraphs: its level, its items, and the content of each. */
interface OpenList {
  readonly level: number;
  readonly list: XhtmlNode[];
  readonly items: XhtmlNode[][];
}

class Preparer {
  droppedImages = 0;
  formatted = false;
  code = false;

  nodes(nodes: readonly XhtmlNode[], depth: number): XhtmlNode[] {
    return this.lists(nodes, depth);
  }

  private element(node: XhtmlElement, depth: number): XhtmlNode[] {
    const name = node.name.toLowerCase();
    if (DROPPED.has(name)) {
      return [];
    }
    const style = styleOf(node);
    if (style.get("white-space")?.startsWith("pre") === true && name !== "pre") {
      this.code = true;
    }
    if (depth >= MAX_DEPTH) {
      return [textOf(node.children)];
    }
    if (name === "img") {
      return this.image(node);
    }
    const children = this.nodes(node.children, depth + 1);
    const struck = style.get("text-decoration")?.includes("line-through") === true;
    const kept = struck ? ["style", "text-decoration: line-through"] : [];
    let result: XhtmlNode = this.kept(node, name, children, kept);
    if (name !== "b" && name !== "strong" && isBold(style.get("font-weight"))) {
      result = element("strong", [result]);
      this.formatted = true;
    }
    if (name !== "i" && name !== "em" && style.get("font-style") === "italic") {
      result = element("em", [result]);
      this.formatted = true;
    }
    return [result];
  }

  /** The element itself, with only the attributes the conversion needs. */
  private kept(
    node: XhtmlElement,
    name: string,
    children: XhtmlNode[],
    style: readonly string[],
  ): XhtmlElement {
    if ((name === "b" || name === "strong") && isNormal(styleOf(node).get("font-weight"))) {
      return element("span", children);
    }
    if (name === "a") {
      const href = attributeOf(node, "href")?.trim();
      if (href === undefined || !LINK.test(href)) {
        return element("span", children);
      }
      this.formatted = true;
      return element("a", children, ["href", href]);
    }
    if (FORMATTING.has(name)) {
      this.formatted = true;
    }
    const attributes = [...style];
    for (const attribute of ["start", "colspan", "rowspan"]) {
      const value = attributeOf(node, attribute);
      if (value !== undefined) {
        attributes.push(attribute, value);
      }
    }
    // The case of the name as the conversion knows it; unknown elements keep their content there.
    return element(name, children, attributes);
  }

  private image(node: XhtmlElement): XhtmlNode[] {
    const src = attributeOf(node, "src")?.trim() ?? "";
    const alt = attributeOf(node, "alt") ?? "";
    if (!WEB_IMAGE.test(src)) {
      this.droppedImages += 1;
      return alt === "" ? [] : [alt];
    }
    this.formatted = true;
    return [element("img", [], ["src", src, "alt", alt])];
  }

  /** Runs of Word list paragraphs as nested lists, ordered when the first marker is a number or letter. */
  private lists(nodes: readonly XhtmlNode[], depth: number): XhtmlNode[] {
    const out: XhtmlNode[] = [];
    // The open lists, outermost first.
    const open: OpenList[] = [];
    for (const node of nodes) {
      const level = typeof node === "string" ? undefined : listLevel(node);
      if (typeof node === "string" || level === undefined) {
        if (typeof node !== "string" || node.trim() !== "") {
          open.length = 0;
        }
        if (open.length === 0) {
          out.push(...(typeof node === "string" ? [node] : this.element(node, depth)));
        }
      } else {
        this.formatted = true;
        this.item(node, level, depth, open, out);
      }
    }
    return out;
  }

  /** One Word list paragraph as an item: of the open list of its level, or of a new one. */
  private item(node: XhtmlElement, level: number, depth: number, open: OpenList[], out: XhtmlNode[]): void {
    const marker = node.children.find(isListMarker);
    const item = this.nodes(
      node.children.filter((child) => !isListMarker(child)),
      depth + 1,
    );
    for (let top = open.at(-1); top !== undefined && top.level > level; top = open.at(-1)) {
      open.pop();
    }
    const current = open.at(-1);
    if (current?.level === level) {
      current.items.push(item);
      current.list.push(element("li", item));
      return;
    }
    const ordered = marker !== undefined && /^\s*[0-9a-z]+[.)]/i.test(textOf(marker.children));
    const list: XhtmlNode[] = [element("li", item)];
    const listElement = element(ordered ? "ol" : "ul", list);
    if (current === undefined) {
      out.push(listElement);
    } else {
      current.items.at(-1)?.push(listElement);
    }
    open.push({ level, list, items: [item] });
  }
}

/**
 * The Markdown of pasted HTML (`nodes`: the content of its `body`), or undefined when it is plain text or
 * styled code and the caller should paste the plain text instead.
 */
export const pastedMarkdown = (nodes: readonly XhtmlNode[]): PastedMarkdown | undefined => {
  const preparer = new Preparer();
  const prepared = preparer.nodes(nodes, 0);
  if (preparer.code || !preparer.formatted) {
    return undefined;
  }
  const markdown = prepareMarkdown(prepared, { cellBreak: "space", unsafe: [{ character: "$" }] }).markdown();
  return { markdown, droppedImages: preparer.droppedImages };
};
