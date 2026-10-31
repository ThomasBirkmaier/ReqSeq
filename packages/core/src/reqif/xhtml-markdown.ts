// XHTML of an `ATTRIBUTE-VALUE-XHTML` to the Markdown of an element text and back (SR-095,
// ADR-0013). Import: our node tree to hast, then `hast-util-to-mdast` and `mdast-util-to-markdown`
// with GFM, in the editor's style (`-` bullets, `*em*`, `**strong**`). What Markdown cannot hold is
// a loss with its `reqifLoss` code, and its text is kept. Export: `mdast-util-from-markdown` with
// GFM and `mdast-util-to-hast`, then our own mapping to the elements and attributes of the XHTML
// modules of the ReqIF driver schema, in one `div`; images become `<object data type>`.
// Details in packages/core/docs/reqif.md.
import type {
  Element as HastElement,
  ElementContent,
  Properties,
  Root as HastRoot,
  RootContent,
  Text as HastText,
} from "hast";
import { defaultHandlers, toMdast } from "hast-util-to-mdast";
import type { Html, Nodes as MdastNodes, Parent as MdastParent, Root as MdastRoot } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { toMarkdown } from "mdast-util-to-markdown";
import { gfm } from "micromark-extension-gfm";
import type { ReqifLoss } from "../generated/types.js";
import type { XhtmlElement, XhtmlNode } from "./model.js";
import { XHTML_NAMESPACE } from "./model.js";

/** A loss of the conversion, with the `reqifLoss` code; the import adds the object it belongs to. */
export interface XhtmlLoss {
  readonly code: Extract<ReqifLoss["code"], `xhtml-${string}`>;
  readonly reason: string;
}

/** An image the text embeds: `data` as written in the file, `type` when the file names one. */
export interface XhtmlImage {
  readonly data: string;
  readonly type?: string;
}

export interface MarkdownOfXhtml {
  readonly markdown: string;
  /** In the order of the text; the import copies them and rewrites their links (SR-095 AK2). */
  readonly images: readonly XhtmlImage[];
  /** One per code and reason. */
  readonly losses: readonly XhtmlLoss[];
}

/** Elements Markdown holds without loss (`span` and `div` only as containers). */
const LOSSLESS: ReadonlySet<string> = new Set(
  "div p span br hr h1 h2 h3 h4 h5 h6 strong b em i code pre blockquote ul ol li table thead tbody tfoot tr th td a img object del s".split(
    " ",
  ),
);
/** Blocks a table cell may hold: joined with `<br>`, nothing is lost. */
const CELL_LINES: ReadonlySet<string> = new Set(["p", "div"]);
/** Blocks a table cell cannot hold: their text stays, the structure is a loss. */
const CELL_BLOCKS: ReadonlySet<string> = new Set(
  "ul ol table pre blockquote hr h1 h2 h3 h4 h5 h6".split(" "),
);
/** The nesting the Markdown libraries convert; a few hundred is far beyond any real text. */
const MAX_DEPTH = 256;
const IMAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["svg", "image/svg+xml"],
  ["webp", "image/webp"],
]);

const attributeOf = (element: XhtmlElement, name: string): string | undefined => {
  const { attributes } = element;
  for (let i = 0; i < attributes.length; i += 2) {
    if (attributes[i] === name) {
      return attributes[i + 1];
    }
  }
  return undefined;
};
const textOf = (nodes: readonly XhtmlNode[]): string => {
  let text = "";
  const pending = [...nodes].reverse();
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === "string") {
      text += next;
    } else {
      pending.push(...[...next.children].reverse());
    }
  }
  return text;
};
const typeOf = (data: string): string | undefined =>
  IMAGE_EXTENSIONS.get(String(/\.([A-Za-z0-9]+)$/.exec(data)?.[1]).toLowerCase());
const hastElement = (tagName: string, properties: Properties, children: ElementContent[]): HastElement => ({
  type: "element",
  tagName,
  properties,
  children,
});

/** Our node tree to hast, noting the losses; walked without recursion (a value may nest deeply). */
class ToHast {
  readonly images: XhtmlImage[] = [];
  private readonly losses = new Map<string, XhtmlLoss>();

  lost(code: XhtmlLoss["code"], reason: string): void {
    this.losses.set(`${code} ${reason}`, { code, reason });
  }

  allLosses(): XhtmlLoss[] {
    return [...this.losses.values()];
  }

  convert(nodes: readonly XhtmlNode[]): HastRoot {
    const root: HastRoot = { type: "root", children: [] };
    const pending: {
      readonly node: XhtmlNode;
      readonly into: (RootContent | ElementContent)[];
      readonly depth: number;
    }[] = [];
    const push = (
      children: readonly XhtmlNode[],
      into: (RootContent | ElementContent)[],
      depth: number,
    ): void => {
      pending.push(...[...children].reverse().map((node) => ({ node, into, depth })));
    };
    push(nodes, root.children, 0);
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const { node, into, depth } = next;
      if (typeof node === "string") {
        into.push({ type: "text", value: node });
      } else if (depth === MAX_DEPTH) {
        // hast-util-to-mdast and mdast-util-to-markdown recurse: deeper elements keep only their text.
        this.lost("xhtml-element", `elements nested deeper than ${String(MAX_DEPTH)}`);
        push(node.children, into, depth);
      } else {
        const converted = this.element(node);
        into.push(...converted.before);
        if (converted.element === undefined) {
          push(converted.children, into, depth);
        } else {
          into.push(converted.element);
          push(converted.children, converted.element.children, depth + 1);
        }
      }
    }
    return root;
  }

  /** One element: its hast element (none to keep only its content) and the children to convert into it. */
  private element(node: XhtmlElement): {
    readonly element?: HastElement;
    readonly children: readonly XhtmlNode[];
    readonly before: ElementContent[];
  } {
    const { name } = node;
    if (node === CELL_BREAK) {
      return { element: hastElement("br", { dataCell: true }, []), children: [], before: [] };
    }
    const style = attributeOf(node, "style");
    if (style !== undefined) {
      this.lost("xhtml-style", `<${name} style="${style}">`);
    }
    if (node.namespace !== XHTML_NAMESPACE || !LOSSLESS.has(name)) {
      this.lost("xhtml-element", `<${name}> in ${node.namespace || "no namespace"}`);
      return { children: node.children, before: [] };
    }
    if (name === "object" || name === "img") {
      return this.image(node);
    }
    const properties: Properties = {};
    for (const [attribute, key] of [
      ["href", "href"],
      ["title", "title"],
      ["start", "start"],
      ["rowspan", "rowSpan"],
      ["colspan", "colSpan"],
    ] as const) {
      const value = attributeOf(node, attribute);
      if (value !== undefined) {
        properties[key] = value;
      }
    }
    for (const [attribute, code] of [
      ["rowspan", "xhtml-rowspan"],
      ["colspan", "xhtml-colspan"],
    ] as const) {
      if (Number(attributeOf(node, attribute) ?? "1") > 1) {
        this.lost(code, `<${name} ${attribute}="${String(attributeOf(node, attribute))}">`);
      }
    }
    return {
      element: hastElement(name, properties, []),
      children: name === "td" || name === "th" ? this.cell(node) : node.children,
      before: [],
    };
  }

  /** An image (`object` of an image type, or `img`) as hast `img`; another object keeps its content. */
  private image(node: XhtmlElement): {
    readonly element?: HastElement;
    readonly children: readonly XhtmlNode[];
    readonly before: ElementContent[];
  } {
    const data = attributeOf(node, node.name === "img" ? "src" : "data") ?? "";
    const type = attributeOf(node, "type") ?? typeOf(data);
    if (node.name === "object" && !(type?.startsWith("image/") ?? false)) {
      this.lost("xhtml-element", `<object data="${data}" type="${String(type)}">`);
      return { children: node.children, before: [] };
    }
    this.images.push({ data, ...(type === undefined ? {} : { type }) });
    const alt = node.name === "img" ? (attributeOf(node, "alt") ?? "") : textOf(node.children).trim();
    return { children: [], before: [hastElement("img", { src: data, alt }, [])] };
  }

  /** The content of a table cell: its blocks as lines joined with `<br>`; other blocks are a loss. */
  private cell(node: XhtmlElement): readonly XhtmlNode[] {
    const lines = node.children.filter((child) => typeof child !== "string" && CELL_LINES.has(child.name));
    for (const child of node.children) {
      if (typeof child !== "string" && CELL_BLOCKS.has(child.name)) {
        this.lost("xhtml-cell-block", `<${child.name}> in a table cell`);
      }
    }
    if (lines.length === 0) {
      return node.children;
    }
    const joined: XhtmlNode[] = [];
    let afterLine = true;
    for (const child of node.children) {
      if (typeof child !== "string" && CELL_LINES.has(child.name)) {
        if (joined.length > 0) {
          joined.push(CELL_BREAK);
        }
        joined.push(...child.children);
        afterLine = true;
      } else if (!(afterLine && typeof child === "string" && child.trim() === "")) {
        // Inline content after a line starts a new line; the space between lines is layout.
        if (afterLine && joined.length > 0) {
          joined.push(CELL_BREAK);
        }
        joined.push(child);
        afterLine = false;
      }
    }
    return joined;
  }
}

/** A line break inside a table cell, written as `<br>` (GFM has no other). */
const CELL_BREAK: XhtmlElement = { name: "br", namespace: XHTML_NAMESPACE, attributes: [], children: [] };

/** The Markdown of an XHTML value (`THE-VALUE` of `ATTRIBUTE-VALUE-XHTML`), with its images and losses. */
export const xhtmlToMarkdown = (value: readonly XhtmlNode[]): MarkdownOfXhtml => {
  const converter = new ToHast();
  const mdast = toMdast(converter.convert(value), {
    handlers: {
      br: (state, node: HastElement) =>
        node.properties["dataCell"] === undefined
          ? defaultHandlers.br(state, node)
          : ({ type: "html", value: "<br>" } satisfies Html),
    },
  });
  const markdown = toMarkdown(mdast, {
    extensions: [gfmToMarkdown()],
    bullet: "-",
    emphasis: "*",
    strong: "*",
    fences: true,
    rule: "-",
  });
  return { markdown: markdown.replace(/\n$/, ""), images: converter.images, losses: converter.allLosses() };
};

/** Elements of the XHTML modules of the ReqIF driver schema the export writes. */
const DRIVER: ReadonlySet<string> = new Set(
  "div p span br hr h1 h2 h3 h4 h5 h6 strong em code pre blockquote ul ol li table thead tbody tr th td a del sup".split(
    " ",
  ),
);
/** Attributes the export keeps, by hast property; the others are dropped. */
const ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["href", "href"],
  ["title", "title"],
  ["start", "start"],
  ["align", "align"],
  ["className", "class"],
  ["id", "id"],
]);
/** Parents whose newline text between children is layout only. */
const BLOCKS: ReadonlySet<string> = new Set(
  "root div ul ol li table thead tbody tr blockquote section".split(" "),
);

export interface XhtmlOptions {
  /** The `data` of an image link, for example its path as copied next to the export; as written by default. */
  readonly image?: (url: string) => string;
}

/**
 * Raw HTML in the text is text for ReqSeq (the editor interprets none): it stays as written, only
 * `<br>` (a line break in a table cell) is a break.
 */
const literalHtml = (tree: MdastRoot): void => {
  const pending: MdastNodes[] = [tree];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if ("children" in next) {
      const parent: MdastParent = next;
      parent.children = parent.children.map((child) =>
        child.type === "html"
          ? /^<br\s*\/?>$/i.test(child.value)
            ? { type: "break" }
            : { type: "text", value: child.value }
          : child,
      );
      pending.push(...parent.children);
    }
  }
};
type Exported = HastText | HastElement;
const isExported = (node: RootContent | ElementContent): node is Exported =>
  node.type === "text" || node.type === "element";

export interface XhtmlOfMarkdown {
  /** One `div`, for `THE-VALUE`. */
  readonly value: XhtmlElement;
  /**
   * True when the Markdown nests too deeply for the Markdown libraries (they recurse): the value then
   * holds the text as written, in one `pre`, and the export names it.
   */
  readonly asWritten: boolean;
}

/** The XHTML of an element text (ADR-0013). */
export const markdownToXhtml = (markdown: string, options: XhtmlOptions = {}): XhtmlOfMarkdown => {
  try {
    return { value: converted(markdown, options), asWritten: false };
  } catch {
    // Only a stack overflow of the libraries is expected here; any failure keeps the text as written.
    const pre: XhtmlElement = {
      name: "pre",
      namespace: XHTML_NAMESPACE,
      attributes: [],
      children: [markdown],
    };
    return {
      value: { name: "div", namespace: XHTML_NAMESPACE, attributes: [], children: [pre] },
      asWritten: true,
    };
  }
};

const converted = (markdown: string, options: XhtmlOptions): XhtmlElement => {
  const mdast = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  literalHtml(mdast);
  // A root gives a root (mdast-util-to-hast).
  const hast = toHast(mdast) as HastRoot;
  const div: XhtmlElement = { name: "div", namespace: XHTML_NAMESPACE, attributes: [], children: [] };
  const pending: { readonly node: Exported; readonly into: XhtmlNode[]; readonly parent: string }[] = [];
  const push = (
    children: readonly (RootContent | ElementContent)[],
    into: XhtmlNode[],
    parent: string,
  ): void => {
    pending.push(
      ...children
        .filter(isExported)
        .reverse()
        .map((node) => ({ node, into, parent })),
    );
  };
  push(hast.children, div.children as XhtmlNode[], "root");
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, into, parent } = next;
    if (node.type === "element") {
      push(...exported(node, into, options));
    } else if (!(BLOCKS.has(parent) && node.value === "\n")) {
      // The newlines mdast-util-to-hast puts between blocks are layout only.
      into.push(node.value);
    }
  }
  return div;
};

/** An image of the text as `<object data type>`, its alternative text as the fallback content. */
const imageObject = ({ properties }: HastElement, options: XhtmlOptions): XhtmlElement => {
  const data = (options.image ?? ((url: string) => url))(String(properties.src));
  const type = typeOf(data);
  const alt = String(properties.alt);
  return {
    name: "object",
    namespace: XHTML_NAMESPACE,
    attributes: ["data", data, ...(type === undefined ? [] : ["type", type])],
    children: alt === "" ? [] : [alt],
  };
};

/** One hast element of the export: what it writes into `into`, and where its children go. */
const exported = (
  node: HastElement,
  into: XhtmlNode[],
  options: XhtmlOptions,
): [readonly ElementContent[], XhtmlNode[], string] => {
  const { tagName, properties } = node;
  if (tagName === "img") {
    into.push(imageObject(node, options));
    return [[], into, tagName];
  }
  if (tagName === "input") {
    // The box of a task list item; Markdown's own spelling keeps it readable.
    into.push(properties.checked === true ? "[x]" : "[ ]");
    return [[], into, tagName];
  }
  if (!DRIVER.has(tagName)) {
    // `section` of footnotes: only its content.
    return [node.children, into, tagName];
  }
  const attributes: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const name = ATTRIBUTES.get(key);
    if (name !== undefined && value !== undefined && value !== null && value !== false) {
      attributes.push(name, Array.isArray(value) ? value.join(" ") : String(value));
    }
  }
  const element: XhtmlElement = { name: tagName, namespace: XHTML_NAMESPACE, attributes, children: [] };
  into.push(element);
  return [node.children, element.children as XhtmlNode[], tagName];
};
