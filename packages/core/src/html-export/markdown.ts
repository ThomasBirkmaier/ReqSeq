// The HTML of a text or Markdown property in the HTML export (SR-235 AK4, AK5; ADR-0002: rendered in
// core at export time, so the page runs nothing). `mdast-util-from-markdown` with GFM, then the mdast
// is made safe, then `mdast-util-to-hast`, then our own writer with an allowlist of elements and
// attributes that escapes every text and attribute value; an element outside the list keeps only its
// content. What would run, load or link outside the export is the place as written, as text, and a
// finding: raw HTML, a link with another scheme than http, https or mailto, an image with a scheme
// (the network, `data:`) or outside the element's repository. A link without a scheme (another file of
// the repository, an anchor) and a `reqseq:` reference keep their link text without a link (until the
// references are linked, #1963). An image of the repository is what `image` gives: a copy in the
// export, or why it was not copied. A Mermaid block stays code; one with a click action, an HTML label
// or its own configuration is reported (the bundled renderer of #1963 draws none of them).
import type { Element, ElementContent, Properties, Root as HastRoot, RootContent } from "hast";
import type { Nodes, Parent, Root, RootContent as MdastContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import type { ImageLink } from "../model/index.js";
import { imageLink } from "../model/index.js";

/** A finding of one text: its code and what it says. */
export interface TextFinding {
  readonly code: "html.unsafe-content" | "html.image-not-copied";
  readonly message: string;
  /** The line in the text, counted from 1. */
  readonly line: number;
}

/** What became of an image of the repository: its address in the page, or why it is not there. */
export type ImageOutcome =
  { readonly src: string } | { readonly code: TextFinding["code"]; readonly reason: string };

export interface TextContext {
  /** The element file, relative to its repository with `/`. */
  readonly elementFile: string;
  /** The `ignore` globs of the workspace (`ignoredBy`). */
  readonly ignored: (relativePath: string) => boolean;
  readonly image: (link: ImageLink) => Promise<ImageOutcome>;
}

export interface RenderedText {
  readonly html: string;
  readonly findings: readonly TextFinding[];
}

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const LINK_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto"]);

/** The scheme of `url` in lower case, `""` for none; a URL with whitespace or a control character counts as `unsafe`. */
const schemeOf = (url: string): string => {
  // eslint-disable-next-line no-control-regex -- control characters are what the test looks for
  if (/[\s\u0000-\u001f\u007f]/u.test(url)) {
    return "unsafe";
  }
  return SCHEME.exec(url)?.[1]?.toLowerCase() ?? "";
};

/** A click action, an HTML label or a configuration of a Mermaid diagram, or undefined for none. */
export const mermaidRisk = (source: string): string | undefined => {
  if (/^\s*(?:click|link|links|callback|href)\b/imu.test(source)) {
    return "a click action";
  }
  if (/<\s*\/?[A-Za-z!]|#lt;|&lt;|&#|#\d+;/u.test(source)) {
    return "an HTML label";
  }
  if (/%%\s*\{|^\s*---\s*$/mu.test(source)) {
    return "its own configuration";
  }
  return undefined;
};

/** Text or an attribute value as HTML: `&`, `<`, `>` and `"` escaped. */
export const escapeHtml = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const ELEMENTS: ReadonlySet<string> = new Set(
  "p h1 h2 h3 h4 h5 h6 em strong del code pre blockquote ul ol li table thead tbody tr th td a img br hr input sup section".split(
    " ",
  ),
);
const VOID: ReadonlySet<string> = new Set(["br", "hr", "img", "input"]);
const CLASS = /^[a-z][a-z0-9-]*$/;

type Attribute = readonly [string, string | true];

const text = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;
const words = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);
const aligned = (p: Properties): Attribute[] =>
  /^(left|center|right)$/.test(String(p.align)) ? [["align", String(p.align)]] : [];

/** The attributes an element keeps by its name, besides the common ones; `sources` are the images this export made. */
const KEPT: Readonly<Record<string, (p: Properties, sources: ReadonlySet<string>) => Attribute[]>> = {
  a: (p) => {
    const href = text(p.href);
    if (href?.startsWith("#") === true) {
      return [["href", href]];
    }
    return href !== undefined && LINK_SCHEMES.has(schemeOf(href))
      ? [
          ["href", href],
          ["rel", "noopener noreferrer"],
        ]
      : [];
  },
  img: (p, sources) => {
    const src = text(p.src);
    return src !== undefined && sources.has(src)
      ? [
          ["src", src],
          ["alt", String(p.alt)],
        ]
      : [];
  },
  input: (p) =>
    p.type === "checkbox"
      ? [
          ["type", "checkbox"],
          ["disabled", true],
          ...(p.checked === true ? [["checked", true] as const] : []),
        ]
      : [],
  th: aligned,
  td: aligned,
  ol: (p) => {
    const start = p.start;
    return typeof start === "number" && Number.isInteger(start) ? [["start", String(start)]] : [];
  },
};

/** The attributes any element keeps: its id, classes, footnote marks and ARIA names. */
const common = (p: Properties): Attribute[] => {
  const out: Attribute[] = [];
  const id = text(p.id);
  if (id !== undefined) {
    out.push(["id", id]);
  }
  const classes = words(p.className).filter((c) => CLASS.test(c));
  if (classes.length > 0) {
    out.push(["class", classes.join(" ")]);
  }
  for (const [property, name] of [
    ["dataFootnotes", "data-footnotes"],
    ["dataFootnoteRef", "data-footnote-ref"],
    ["dataFootnoteBackref", "data-footnote-backref"],
  ] as const) {
    if (p[property] === true || p[property] === "") {
      out.push([name, true]);
    }
  }
  const described = words(p.ariaDescribedBy);
  if (described.length > 0) {
    out.push(["aria-describedby", described.join(" ")]);
  }
  const label = text(p.ariaLabel);
  if (label !== undefined) {
    out.push(["aria-label", label]);
  }
  return out;
};

/** The attributes `element` keeps, written; `sources` are the image addresses this export made. */
const attributes = (element: Element, sources: ReadonlySet<string>): string =>
  [...common(element.properties), ...(KEPT[element.tagName]?.(element.properties, sources) ?? [])]
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`))
    .join("");

/** Writes the hast `nodes` as HTML (see the file comment), without recursion. */
export const writeHast = (root: HastRoot, sources: ReadonlySet<string>): string => {
  const parts: string[] = [];
  const pending: (RootContent | ElementContent | string)[] = [...root.children].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node === "string") {
      parts.push(node);
    } else if (node.type === "text") {
      parts.push(escapeHtml(node.value));
    } else if (node.type === "element") {
      const known = ELEMENTS.has(node.tagName);
      if (known) {
        parts.push(`<${node.tagName}${attributes(node, sources)}>`);
      }
      if (known && !VOID.has(node.tagName)) {
        pending.push(`</${node.tagName}>`);
      }
      if (!VOID.has(node.tagName)) {
        pending.push(...[...node.children].reverse());
      }
    }
    // Comments, doctypes and raw nodes are never written; raw HTML became text before.
  }
  return parts.join("");
};

type Replacement = readonly MdastContent[];
/** What a node becomes: other nodes, its own children, or a link with its own children. */
type Change =
  | { readonly kind: "nodes"; readonly nodes: Replacement }
  | { readonly kind: "unwrap" }
  | { readonly kind: "link"; readonly url: string };

/** The source of `node` in `text`, as written (the parser gives every node its position). */
const sourceOf = (text: string, node: Nodes): string =>
  text.slice(node.position?.start.offset, node.position?.end.offset);

const asText = (value: string): Replacement => [{ type: "text", value }];

/** Renders `text` (see the file comment). */
export const renderMarkdown = async (text: string, context: TextContext): Promise<RenderedText> => {
  try {
    return await rendered(text, context);
  } catch (error) {
    if (!(error instanceof RangeError) || !/call stack/iu.test(error.message)) {
      throw error;
    }
    // The Markdown libraries recurse; a text nested too deeply for the stack is shown as written.
    return {
      html: `<pre>${escapeHtml(text)}</pre>`,
      findings: [
        {
          code: "html.unsafe-content",
          message: "the text is nested too deeply to be checked; it is shown as written",
          line: 1,
        },
      ],
    };
  }
};

/** The parents of `tree` in the order of the text, each before its own, and the addresses of its definitions by identifier. */
const walk = (tree: Root): { parents: Parent[]; definitions: Map<string, string> } => {
  const definitions = new Map<string, string>();
  const parents: Parent[] = [];
  const stack: Nodes[] = [tree];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === "definition") {
      definitions.set(node.identifier, node.url);
    }
    if ("children" in node) {
      parents.push(node);
      // Reversed, so the walk meets the nodes in the order of the text.
      stack.push(...[...node.children].reverse());
    }
  }
  return { parents, definitions };
};

type Handlers = { readonly [K in MdastContent["type"]]?: (node: Extract<MdastContent, { type: K }>) => void };

/** The changes of the nodes of one text and its findings, by their place in the text. */
const changesOf = (text: string, context: TextContext, definitions: ReadonlyMap<string, string>) => {
  const found: { readonly at: number; readonly finding: TextFinding }[] = [];
  const images: Promise<void>[] = [];
  const replaced = new Map<Nodes, Change>();
  const report = (node: Nodes, code: TextFinding["code"], message: string): void => {
    // The parser gives every node its position.
    const start = node.position?.start;
    found.push({ at: Number(start?.offset), finding: { code, message, line: Number(start?.line) } });
  };
  const shown = (node: Nodes): Change => ({ kind: "nodes", nodes: asText(sourceOf(text, node)) });
  // The parser makes a reference only where a definition has its label.
  const urlOf = (identifier: string): string => String(definitions.get(identifier));
  const linkOutcome = (node: Nodes, url: string): Change | undefined => {
    const scheme = schemeOf(url);
    if (LINK_SCHEMES.has(scheme)) {
      return undefined;
    }
    if (scheme === "" || scheme === "reqseq") {
      return { kind: "unwrap" };
    }
    const what = scheme === "unsafe" ? "a space or control character" : `the scheme ${scheme}`;
    report(node, "html.unsafe-content", `a link with ${what} is shown as text`);
    return shown(node);
  };
  const imageOutcome = (node: Nodes, url: string, alt: string): void => {
    // A one-letter scheme is a drive of Windows: a path outside the repository.
    const scheme = /^[a-z]$/u.test(schemeOf(url)) ? "drive" : schemeOf(url);
    const link = scheme === "" ? imageLink(context.elementFile, url, context.ignored) : undefined;
    if (link === undefined) {
      const where =
        scheme === "data"
          ? "a data: address"
          : scheme === "" || scheme === "drive"
            ? "a path outside the element's repository"
            : "an address in the network";
      report(node, "html.unsafe-content", `an image with ${where} is shown as text`);
      replaced.set(node, shown(node));
      return;
    }
    images.push(
      context.image(link).then((outcome) => {
        if ("src" in outcome) {
          replaced.set(node, {
            kind: "nodes",
            nodes: [{ type: "image", url: outcome.src, alt, title: null }],
          });
        } else {
          report(node, outcome.code, `the image ${link.path} ${outcome.reason}; it is shown as text`);
          replaced.set(node, shown(node));
        }
      }),
    );
  };
  // The parser gives every image its alt text.
  const handlers: Handlers = {
    html: (node) => {
      report(node, "html.unsafe-content", "raw HTML is shown as text");
      replaced.set(node, { kind: "nodes", nodes: asText(node.value) });
    },
    link: (node) => {
      const outcome = linkOutcome(node, node.url);
      if (outcome !== undefined) {
        replaced.set(node, outcome);
      }
    },
    linkReference: (node) => {
      const url = urlOf(node.identifier);
      replaced.set(node, linkOutcome(node, url) ?? { kind: "link", url });
    },
    image: (node) => {
      imageOutcome(node, node.url, String(node.alt));
    },
    imageReference: (node) => {
      imageOutcome(node, urlOf(node.identifier), String(node.alt));
    },
    definition: (node) => {
      replaced.set(node, { kind: "nodes", nodes: [] });
    },
    code: (node) => {
      const risk = node.lang?.toLowerCase() === "mermaid" ? mermaidRisk(node.value) : undefined;
      if (risk !== undefined) {
        report(node, "html.unsafe-content", `a Mermaid diagram with ${risk} is shown as text`);
      }
    },
  };
  return {
    visit: (node: MdastContent): void => {
      (handlers[node.type] as ((node: MdastContent) => void) | undefined)?.(node);
    },
    /** The changes, once every image is read, and the findings in text order. */
    done: async (): Promise<{ replaced: ReadonlyMap<Nodes, Change>; findings: TextFinding[] }> => {
      await Promise.all(images);
      return { replaced, findings: found.sort((a, b) => a.at - b.at).map((f) => f.finding) };
    },
  };
};

/** `parent`'s children with their changes; the image addresses the changes add go into `sources`. */
const changedChildren = (
  parent: Parent,
  replaced: ReadonlyMap<Nodes, Change>,
  sources: Set<string>,
): MdastContent[] =>
  parent.children.flatMap((child): MdastContent[] => {
    const change = replaced.get(child);
    if (change === undefined) {
      return [child];
    }
    const children = "children" in child ? (child.children as MdastContent[]) : [];
    if (change.kind === "unwrap") {
      return children;
    }
    if (change.kind === "link") {
      return [{ type: "link", url: change.url, children } as MdastContent];
    }
    for (const node of change.nodes) {
      if (node.type === "image") {
        sources.add(node.url);
      }
    }
    return [...change.nodes];
  });

const rendered = async (text: string, context: TextContext): Promise<RenderedText> => {
  const tree: Root = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const { parents, definitions } = walk(tree);
  const changes = changesOf(text, context, definitions);
  for (const parent of parents) {
    for (const node of parent.children) {
      changes.visit(node);
    }
  }
  const { replaced, findings } = await changes.done();
  const sources = new Set<string>();
  // Deepest first, so a node that keeps its children gets them already changed.
  for (const parent of [...parents].reverse()) {
    parent.children = changedChildren(parent, replaced, sources);
  }
  return { html: writeHast(toHast(tree) as HastRoot, sources), findings };
};
