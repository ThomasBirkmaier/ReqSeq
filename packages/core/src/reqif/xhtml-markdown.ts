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
/** Blocks that end a line in a table cell; their content goes on as lines joined with `<br>`. */
const CELL_LINE_ENDS: ReadonlySet<string> = new Set(
  "address blockquote caption dd div dl dt h1 h2 h3 h4 h5 h6 hr li ol p pre table tbody td tfoot th thead tr ul".split(
    " ",
  ),
);
const LINE_BREAKS: ReadonlySet<string> = new Set(["br"]);
/** Blocks a table cell cannot hold: their text stays, the structure is a loss. */
const CELL_BLOCKS: ReadonlySet<string> = new Set(
  "ul ol dl table pre blockquote hr h1 h2 h3 h4 h5 h6".split(" "),
);
/** Elements whose children are rows or items, so a `del` cannot wrap them. */
const STRUCTURE: ReadonlySet<string> = new Set("table thead tbody tfoot tr ul ol dl".split(" "));
/** The one `style` declaration Markdown holds (ReqIF 1.2 §10.8.20 names it): `~~`. */
const LINE_THROUGH = /^text-decoration\s*:\s*line-through$/i;
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

type Lost = (code: XhtmlLoss["code"], reason: string) => void;

/** Pushes `items` in reverse onto a stack, one by one (a spread would overflow on wide values). */
const pushReversed = <T, U>(stack: U[], items: readonly T[], map: (item: T) => U): void => {
  for (const item of [...items].reverse()) {
    stack.push(map(item));
  }
};
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
  const pending: XhtmlNode[] = [];
  pushReversed(pending, nodes, (node) => node);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (typeof next === "string") {
      text += next;
    } else {
      pushReversed(pending, next.children, (node) => node);
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
const xhtml = (name: string, children: readonly XhtmlNode[]): XhtmlElement => ({
  name,
  namespace: XHTML_NAMESPACE,
  attributes: [],
  children,
});
const isXhtml = (node: XhtmlElement, names: ReadonlySet<string>): boolean =>
  node.namespace === XHTML_NAMESPACE && names.has(node.name);

/** A line break inside a table cell, written as `<br>` (GFM has no other). */
const CELL_BREAK: XhtmlElement = xhtml("br", []);

interface CellFrame {
  readonly children: readonly XhtmlNode[];
  index: number;
  readonly into: XhtmlNode[];
  readonly pre: boolean;
  readonly block: boolean;
}

/**
 * The content of a table cell as one line of inline content, at every depth: blocks and `br` end a
 * line (`<br>`), text runs collapse their white space (a `pre` keeps its lines), and blocks a cell
 * cannot hold are a loss. Walked without recursion.
 */
class CellFlattener {
  private readonly out: XhtmlNode[] = [];
  /** Content since the last break. */
  private open = false;
  /** A break due before the next content. */
  private pending = false;
  private readonly frames: CellFrame[];
  private readonly lost: Lost;

  constructor(cell: readonly XhtmlNode[], lost: Lost) {
    this.lost = lost;
    this.frames = [{ children: cell, index: 0, into: this.out, pre: false, block: false }];
  }

  run(): XhtmlNode[] {
    for (let frame = this.frames.at(-1); frame !== undefined; frame = this.frames.at(-1)) {
      const child = frame.children[frame.index];
      frame.index += 1;
      if (child === undefined) {
        this.frames.pop();
        if (frame.block) {
          this.lineEnd();
        }
      } else if (typeof child === "string") {
        this.text(frame, child);
      } else {
        this.element(frame, child);
      }
    }
    return this.out;
  }

  private lineEnd(): void {
    this.pending ||= this.open;
  }

  private place(into: XhtmlNode[], node: XhtmlNode): void {
    if (this.pending) {
      into.push(CELL_BREAK);
      this.pending = false;
      this.open = false;
    }
    into.push(node);
  }

  private text(frame: CellFrame, text: string): void {
    const lines = frame.pre ? text.split(/\r?\n/) : [text.replace(/[ \t\r\n]+/g, " ")];
    for (const [i, line] of lines.entries()) {
      if (i > 0) {
        this.lineEnd();
      }
      // White space alone is layout at the start of a line.
      if (line.trim() !== "" || (this.open && !this.pending && !frame.pre)) {
        this.place(frame.into, line);
        this.open = true;
      }
    }
  }

  private element(frame: CellFrame, child: XhtmlElement): void {
    if (isXhtml(child, LINE_BREAKS)) {
      this.lineEnd();
    } else if (isXhtml(child, CELL_LINE_ENDS)) {
      if (CELL_BLOCKS.has(child.name)) {
        this.lost("xhtml-cell-block", `<${child.name}> in a table cell`);
      }
      this.lineEnd();
      const pre = frame.pre || child.name === "pre";
      this.frames.push({ children: child.children, index: 0, into: frame.into, pre, block: true });
    } else {
      // Inline: kept with its own content flattened; an image is content of its own.
      const children: XhtmlNode[] = [];
      this.place(frame.into, { ...child, children });
      this.open ||= child.name === "object" || child.name === "img";
      this.frames.push({ children: child.children, index: 0, into: children, pre: frame.pre, block: false });
    }
  }
}

/** GFM has no caption: a table's captions go before it as paragraphs; undefined without one. */
const withoutCaption = (table: XhtmlElement, children: readonly XhtmlNode[]): XhtmlNode[] | undefined => {
  const paragraphs: XhtmlNode[] = [];
  const rows: XhtmlNode[] = [];
  for (const child of children) {
    if (typeof child !== "string" && child.name === "caption") {
      paragraphs.push(xhtml("p", child.children));
    } else {
      rows.push(child);
    }
  }
  return paragraphs.length === 0 ? undefined : [...paragraphs, { ...table, attributes: [], children: rows }];
};

interface Converted {
  readonly element?: HastElement;
  readonly children: readonly XhtmlNode[];
  readonly before: ElementContent[];
}

/** Our node tree to hast, noting the losses; walked without recursion (a value may nest deeply). */
class ToHast {
  readonly images: XhtmlImage[] = [];
  /** Each entry of `images` with its hast `img` and alt text. */
  readonly imageNodes: { readonly image: XhtmlImage; readonly node: HastElement; readonly alt: string }[] =
    [];
  private readonly losses = new Map<string, XhtmlLoss>();
  private readonly lost: Lost = (code, reason) => {
    this.losses.set(`${code} ${reason}`, { code, reason });
  };

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
      pushReversed(pending, children, (node) => ({ node, into, depth }));
    };
    push(nodes, root.children, 0);
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const { node, into, depth } = next;
      const last = into.at(-1);
      if (typeof node === "string" && last?.type === "text") {
        // One text node per run: hast-util-to-mdast joins adjacent ones in quadratic time.
        last.value += node;
      } else if (typeof node === "string") {
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
  private element(node: XhtmlElement): Converted {
    const { name } = node;
    if (node === CELL_BREAK) {
      return { element: hastElement("br", { dataCell: true }, []), children: [], before: [] };
    }
    const children = this.styled(node);
    if (node.namespace !== XHTML_NAMESPACE || !LOSSLESS.has(name)) {
      this.lost("xhtml-element", `<${name}> in ${node.namespace || "no namespace"}`);
      return { children, before: [] };
    }
    if (name === "object" || name === "img") {
      return this.image(node);
    }
    if (name === "span") {
      // A container only; unwrapped here so its text joins the run around it.
      return { children, before: [] };
    }
    const captioned = name === "table" ? withoutCaption(node, children) : undefined;
    if (captioned !== undefined) {
      return { children: captioned, before: [] };
    }
    const properties = this.properties(node);
    return {
      element: hastElement(name, properties, []),
      children: name === "td" || name === "th" ? new CellFlattener(children, this.lost).run() : children,
      before: [],
    };
  }

  /** The hast properties hast-util-to-mdast reads; spanned cells are a loss. */
  private properties(node: XhtmlElement): Properties {
    const { name } = node;
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
    return properties;
  }

  /** The children of an element under its `style`: line-through becomes `del`, the rest is a loss. */
  private styled(node: XhtmlElement): readonly XhtmlNode[] {
    const style = attributeOf(node, "style");
    if (style === undefined) {
      return node.children;
    }
    const declarations = style
      .split(";")
      .map((declaration) => declaration.trim())
      .filter((declaration) => declaration !== "");
    const struck =
      !STRUCTURE.has(node.name) && declarations.some((declaration) => LINE_THROUGH.test(declaration));
    if (declarations.length > (struck ? 1 : 0)) {
      this.lost("xhtml-style", `<${node.name} style="${style}">`);
    }
    return struck ? [xhtml("del", node.children)] : node.children;
  }

  /** An image (`object` of an image type, or `img`) as hast `img`; another object keeps its content. */
  private image(node: XhtmlElement): Converted {
    const img = node.name === "img";
    const attribute = img ? "src" : "data";
    const data = attributeOf(node, attribute) ?? "";
    const type = attributeOf(node, "type") ?? typeOf(data);
    const alt = img ? (attributeOf(node, "alt") ?? "") : textOf(node.children).trim();
    if (data === "") {
      this.lost("xhtml-element", `<${node.name}> without ${attribute}`);
      return { children: img ? [alt] : node.children, before: [] };
    }
    if (!img && !(type?.startsWith("image/") ?? false)) {
      this.lost("xhtml-element", `<object data="${data}" type="${String(type)}">`);
      return { children: node.children, before: [] };
    }
    const image: XhtmlImage = { data, ...(type === undefined ? {} : { type }) };
    this.images.push(image);
    const imgNode = hastElement("img", { src: data, alt }, []);
    this.imageNodes.push({ image, node: imgNode, alt });
    return { children: [], before: [imgNode] };
  }
}

/** Emphasis, strong and strike-through that Markdown joins when written next to each other. */
const ATTENTION: ReadonlySet<string> = new Set(["emphasis", "strong", "delete"]);

/**
 * Joins runs of the same emphasis (`<b>a</b><b>b</b>` is `**ab**`): mdast-util-to-markdown pairs
 * adjacent attention markers in more than quadratic time (4,000 adjacent `b` take a minute).
 */
const joinAttention = (tree: MdastNodes): void => {
  const pending: MdastNodes[] = [tree];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if ("children" in next) {
      const parent: MdastParent = next;
      parent.children = joinRuns(parent.children) as typeof parent.children;
      pushReversed(pending, parent.children, (child) => child);
    }
  }
};
type Attention = Extract<MdastNodes, { type: "emphasis" | "strong" | "delete" }>;
const isAttention = (node: MdastNodes): node is Attention => ATTENTION.has(node.type);
/** Emphasis of white space alone: Markdown has no form for it (`* *` is no emphasis). */
const isBlank = (node: Attention): boolean =>
  node.children.every((child) => child.type === "text" && child.value.trim() === "");
const joinRuns = (children: readonly MdastNodes[]): MdastNodes[] => {
  const joined: MdastNodes[] = [];
  for (const child of children) {
    const last = joined.at(-1);
    if (isAttention(child) && isBlank(child)) {
      for (const inner of child.children) {
        joined.push(inner);
      }
    } else if (isAttention(child) && last !== undefined && isAttention(last) && last.type === child.type) {
      const into = last.children as MdastNodes[];
      for (const inner of child.children) {
        into.push(inner);
      }
    } else {
      joined.push(child);
    }
  }
  return joined;
};

/** An XHTML value converted up to its links: its images and losses, and then its Markdown. */
export interface PreparedMarkdown {
  /** In the order of the text, as written. */
  readonly images: readonly XhtmlImage[];
  /** One per code and reason. */
  readonly losses: readonly XhtmlLoss[];
  /**
   * The Markdown, with the link `image` gives for each entry of `images` (as written by default).
   * Where it gives none, the image becomes its alt text, else its file name, without a link (an
   * image the import does not copy, SR-095 AK2). Call it once.
   */
  readonly markdown: (image?: (image: XhtmlImage, at: number) => string | undefined) => string;
}

/**
 * Converts an XHTML value (`THE-VALUE` of `ATTRIBUTE-VALUE-XHTML`) once: the images and losses are
 * known before the links are chosen, so the import reads the images first (SR-095 AK2).
 */
export const prepareMarkdown = (value: readonly XhtmlNode[]): PreparedMarkdown => {
  const converter = new ToHast();
  const hast = converter.convert(value);
  const markdown = (image: (image: XhtmlImage, at: number) => string | undefined = (i) => i.data): string => {
    converter.imageNodes.forEach(({ image: entry, node, alt }, at) => {
      const link = image(entry, at);
      if (link === undefined) {
        node.tagName = "span";
        node.properties = {};
        // The file name: the part of `data` after its last `/` or `\`.
        const name = entry.data.slice(entry.data.search(/[^/\\]*$/));
        node.children = [{ type: "text", value: alt === "" ? name : alt }];
      } else {
        node.properties.src = link;
      }
    });
    const mdast = toMdast(hast, {
      handlers: {
        br: (state, node: HastElement) =>
          node.properties["dataCell"] === undefined
            ? defaultHandlers.br(state, node)
            : ({ type: "html", value: "<br>" } satisfies Html),
      },
    });
    joinAttention(mdast);
    const text = toMarkdown(mdast, {
      extensions: [gfmToMarkdown()],
      bullet: "-",
      emphasis: "*",
      strong: "*",
      fences: true,
      rule: "-",
    });
    return text.replace(/\n$/, "");
  };
  return { images: converter.images, losses: converter.allLosses(), markdown };
};

/** The Markdown of an XHTML value with its images (linked as written) and losses (`prepareMarkdown`). */
export const xhtmlToMarkdown = (value: readonly XhtmlNode[]): MarkdownOfXhtml => {
  const prepared = prepareMarkdown(value);
  return { markdown: prepared.markdown(), images: prepared.images, losses: prepared.losses };
};

/** The image type of each extension the conversion knows, by type (the import names a copy by it). */
export const IMAGE_TYPE_EXTENSIONS: ReadonlyMap<string, string> = new Map(
  // Reversed, so the first extension of a type wins (`.jpg`).
  [...IMAGE_EXTENSIONS].reverse().map(([extension, type]) => [type, `.${extension}`]),
);

/**
 * Elements the export writes, from the XHTML modules ReqIF 1.2 §10.8.20 names (Text, List,
 * Hypertext, Edit, Presentation, Basic Tables, Object); others keep only their content (`thead` and
 * `tbody` are not in Basic Tables).
 */
const DRIVER: ReadonlySet<string> = new Set(
  "div p span br hr h1 h2 h3 h4 h5 h6 strong em code pre blockquote ul ol li table tr th td a del".split(" "),
);
/**
 * Attributes the export keeps, by hast property. `class` must not be used (§10.8.20), `start` is not
 * in the List module (the numbers of an ordered list start at 1), and `id` would repeat in a file.
 */
const ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["href", "href"],
  ["title", "title"],
  ["align", "align"],
]);
/** Parents whose newline text between children is layout only. */
const BLOCKS: ReadonlySet<string> = new Set("root div ul ol li table thead tbody tr blockquote".split(" "));

export interface XhtmlOptions {
  /** The `data` of an image link, for example its path as copied next to the export; as written by default. */
  readonly image?: (url: string) => string;
}

/** One node of the Markdown tree as the export writes it (see `asText`). */
const plain = (node: MdastNodes): MdastNodes[] => {
  if (node.type === "html") {
    return [/^<br\s*\/?>$/i.test(node.value) ? { type: "break" } : { type: "text", value: node.value }];
  }
  if (node.type === "footnoteReference") {
    return [{ type: "text", value: `[^${String(node.label)}]` }];
  }
  if (node.type === "footnoteDefinition") {
    const marker: MdastNodes = { type: "text", value: `[^${String(node.label)}]: ` };
    const [first, ...rest] = node.children;
    return first?.type === "paragraph"
      ? [{ ...first, children: [marker, ...first.children] }, ...rest]
      : [{ type: "paragraph", children: [marker] }, ...node.children];
  }
  return [node];
};

/**
 * Raw HTML in the text is text for ReqSeq (the editor interprets none): it stays as written, only
 * `<br>` (a line break in a table cell) is a break. Footnotes stay as written (`[^1]`, `[^1]: …`),
 * so the export adds no heading, back link or `id` of its own.
 */
const asText = (tree: MdastRoot): void => {
  const pending: MdastNodes[] = [tree];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if ("children" in next) {
      const parent: MdastParent = next;
      parent.children = parent.children.flatMap(plain) as typeof parent.children;
      pushReversed(pending, parent.children, (child) => child);
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
  } catch (error) {
    if (!(error instanceof RangeError)) {
      throw error;
    }
    // The Markdown libraries recurse; a text nested too deeply for the stack is kept as written.
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
  asText(mdast);
  // A root gives a root (mdast-util-to-hast).
  const hast = toHast(mdast) as HastRoot;
  const div: XhtmlElement = { name: "div", namespace: XHTML_NAMESPACE, attributes: [], children: [] };
  const pending: { readonly node: Exported; readonly into: XhtmlNode[]; readonly parent: string }[] = [];
  const push = (
    children: readonly (RootContent | ElementContent)[],
    into: XhtmlNode[],
    parent: string,
  ): void => {
    pushReversed(pending, children.filter(isExported), (node) => ({ node, into, parent }));
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
    // `thead`, `tbody`: only their content.
    return [node.children, into, tagName];
  }
  const attributes: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const name = ATTRIBUTES.get(key);
    if (name !== undefined && value !== undefined && value !== null && value !== false) {
      attributes.push(name, String(value));
    }
  }
  const element: XhtmlElement = { name: tagName, namespace: XHTML_NAMESPACE, attributes, children: [] };
  into.push(element);
  return [node.children, element.children as XhtmlNode[], tagName];
};
