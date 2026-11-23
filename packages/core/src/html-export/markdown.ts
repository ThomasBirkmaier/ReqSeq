// The HTML of a text or Markdown property in the HTML export (SR-231 AK5, AK6; SR-235 AK4, AK5; ADR-0002: rendered
// in core at export time, so the page runs nothing but the bundled Mermaid). `mdast-util-from-markdown` with GFM and
// the formula syntax (`math-syntax.ts`), then the mdast is made safe, then `mdast-util-to-hast`, then our own writer
// with an allowlist of elements and attributes that escapes every text and attribute value; an element outside the
// list keeps only its content. What would run, load or link outside the export is the place as written, as text, and
// a finding: raw HTML, a link with another scheme than http, https or mailto, an image with a scheme (the network,
// `data:`) or outside the element's repository. A link without a scheme (another file of the repository, an anchor)
// keeps its link text without a link. An image of the repository is what `image` gives: a copy in the export, or why
// it was not copied.
//
// - A `reqseq:` reference is what `reference` gives (SR-231 AK6): a link to the page of its target, its link text
//   with a note on an inaccessible target, or its link text alone.
// - A formula (`$…$`, `$$…$$`, a `$$` block, a fenced `math` block) is set by KaTeX (`formula.ts`). One with an error
//   shows its source as code, then "Error" and KaTeX's message in grey, and is `html.formula-error`; one
//   whose HTML is outside the grammar is its source and `html.unsafe-content`.
// - A Mermaid block with a click action, an HTML label or its own configuration is code without its language and a
//   finding; any other is marked `data-rq-diagram` for the page script to draw, unless it is over the bounds, which
//   shows its source and the error.
// - A quote whose first line is only `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]` (any case,
//   D-074) is Starlight's aside with that word as its title; only the nodes this pass makes carry its classes.
import type { Element, ElementContent, Properties, Root as HastRoot, RootContent } from "hast";
import type { Blockquote, Nodes, Parent, Root, RootContent as MdastContent, Text } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { Raw, State } from "mdast-util-to-hast";
import { toHast } from "mdast-util-to-hast";
import { gfm } from "micromark-extension-gfm";
import type { ImageLink } from "../model/image-link.js";
import { imageLink } from "../model/image-link.js";
import { referenceRepository } from "../model/reference-query.js";
import { isUuid } from "../model/uuid.js";
import { isFormulaHtml, setFormula } from "./formula.js";
import type { MathNode } from "./math-syntax.js";
import { mathFromMarkdown, mathSyntax } from "./math-syntax.js";
import { diagramOverLimit } from "./render-options.js";

/** A finding of one text: its code and what it says. */
export interface TextFinding {
  readonly code: "html.unsafe-content" | "html.image-not-copied" | "html.formula-error";
  readonly message: string;
  /** The line in the text, counted from 1. */
  readonly line: number;
}

/** What became of an image of the repository: its address in the page, or why it is not there. */
export type ImageOutcome =
  { readonly src: string } | { readonly code: TextFinding["code"]; readonly reason: string };

/**
 * What became of an inline reference: a link to the page of its target, its link text and a note after it (an
 * inaccessible target), or its link text alone.
 */
export type ReferenceOutcome =
  { readonly href: string } | { readonly note: string } | { readonly text: true };

export interface TextContext {
  /** The element file, relative to its repository with `/`. */
  readonly elementFile: string;
  /** The `ignore` globs of the workspace (`ignoredBy`). */
  readonly ignored: (relativePath: string) => boolean;
  readonly image: (link: ImageLink) => Promise<ImageOutcome>;
  /** The outcome of a `reqseq:` reference to the element with the UUID `id`, in `repository` when it names one. */
  readonly reference: (target: { readonly id: string; readonly repository?: string }) => ReferenceOutcome;
}

export interface RenderedText {
  readonly html: string;
  readonly findings: readonly TextFinding[];
  /** Whether the HTML holds a set formula, so the page needs KaTeX's stylesheet. */
  readonly formulas: boolean;
  /** Whether the HTML holds a diagram for the page script to draw. */
  readonly diagrams: boolean;
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
  "p h1 h2 h3 h4 h5 h6 em strong del code pre blockquote ul ol li table thead tbody tr th td a img br hr input sup section aside div".split(
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

/**
 * The attributes an element keeps by its name, besides the common ones; `made` are the addresses this export made
 * (image copies and the pages of references).
 */
const KEPT: Readonly<Record<string, (p: Properties, made: ReadonlySet<string>) => Attribute[]>> = {
  a: (p, made) => {
    const href = text(p.href);
    if (href?.startsWith("#") === true || (href !== undefined && made.has(href))) {
      return [["href", href]];
    }
    return href !== undefined && LINK_SCHEMES.has(schemeOf(href))
      ? [
          ["href", href],
          ["rel", "noopener noreferrer"],
        ]
      : [];
  },
  img: (p, made) => {
    const src = text(p.src);
    return src !== undefined && made.has(src) && !src.endsWith(".html")
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

/**
 * The nodes this pass made, which the writer writes as they are: the HTML of a formula, a diagram or an error
 * (raw nodes), and the elements of an aside with their fixed attributes.
 */
export interface Trusted {
  readonly raw: WeakSet<Raw>;
  readonly elements: WeakMap<Element, string>;
}

/** The attributes `element` keeps, written; `made` are the addresses this export made. */
const attributes = (element: Element, made: ReadonlySet<string>, trusted: Trusted): string =>
  trusted.elements.get(element) ??
  [...common(element.properties), ...(KEPT[element.tagName]?.(element.properties, made) ?? [])]
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`))
    .join("");

/** Writes the hast `nodes` as HTML (see the file comment), without recursion. */
export const writeHast = (
  root: HastRoot,
  made: ReadonlySet<string>,
  trusted: Trusted = { raw: new WeakSet(), elements: new WeakMap() },
): string => {
  const parts: string[] = [];
  const pending: (RootContent | ElementContent | string)[] = [...root.children].reverse();
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (typeof node === "string") {
      parts.push(node);
    } else if (node.type === "text") {
      parts.push(escapeHtml(node.value));
    } else if (node.type === "raw" && trusted.raw.has(node)) {
      parts.push(node.value);
    } else if (node.type === "element") {
      const known = ELEMENTS.has(node.tagName);
      if (known) {
        parts.push(`<${node.tagName}${attributes(node, made, trusted)}>`);
      }
      if (known && !VOID.has(node.tagName)) {
        pending.push(`</${node.tagName}>`);
      }
      if (!VOID.has(node.tagName)) {
        pending.push(...[...node.children].reverse());
      }
    }
    // Comments, doctypes and other raw nodes are never written; raw HTML became text before.
  }
  return parts.join("");
};

type Replacement = readonly MdastContent[];
/** What a node becomes: other nodes, its own children, or a link with its own children. */
type Change =
  | { readonly kind: "nodes"; readonly nodes: Replacement }
  | { readonly kind: "unwrap" }
  | { readonly kind: "link"; readonly url: string; readonly made?: true }
  | { readonly kind: "append"; readonly text: string }
  | { readonly kind: "raw"; readonly html: string }
  | { readonly kind: "aside"; readonly aside: AsideKind };

/** The kinds of Starlight's aside, and the word of each callout (D-074): its title. */
interface AsideKind {
  readonly kind: "note" | "tip" | "caution" | "danger";
  readonly title: string;
}
type CalloutName = "note" | "tip" | "important" | "warning" | "caution";
const CALLOUTS: Readonly<Record<CalloutName, AsideKind>> = {
  note: { kind: "note", title: "Note" },
  tip: { kind: "tip", title: "Tip" },
  important: { kind: "note", title: "Important" },
  warning: { kind: "caution", title: "Warning" },
  caution: { kind: "danger", title: "Caution" },
};
const CALLOUT = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/iu;

/** The node types this pass makes, which `toHast` passes to `unknownHandler`. */
const RAW = "rqRaw";
const ASIDE = "rqAside";

/** An error of a formula or a diagram after its source, in grey. */
const errorHtml = (source: string, message: string, block: boolean): string => {
  const error = `<span class="rq-render-error-label">Error</span> ${escapeHtml(message)}`;
  return block
    ? `<pre><code>${escapeHtml(source)}</code></pre><div class="rq-render-error">${error}</div>`
    : `<code>${escapeHtml(source)}</code> <span class="rq-render-error">${error}</span>`;
};

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
      formulas: false,
      diagrams: false,
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
  const referenceOutcome = (url: string): Change => {
    const rest = url.slice("reqseq:".length);
    const query = rest.indexOf("?");
    const id = query < 0 ? rest : rest.slice(0, query);
    // The repository as the store reads it (`model/references.ts`), so both name the same one.
    const repository = referenceRepository(url);
    if (!isUuid(id)) {
      return { kind: "unwrap" };
    }
    const outcome = context.reference({ id, ...(repository === undefined ? {} : { repository }) });
    if ("href" in outcome) {
      return { kind: "link", url: outcome.href, made: true };
    }
    return "note" in outcome ? { kind: "append", text: ` (${outcome.note})` } : { kind: "unwrap" };
  };
  const linkOutcome = (node: Nodes, url: string): Change | undefined => {
    const scheme = schemeOf(url);
    if (LINK_SCHEMES.has(scheme)) {
      return undefined;
    }
    if (scheme === "reqseq") {
      return referenceOutcome(url);
    }
    if (scheme === "") {
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
      const language = node.lang?.toLowerCase();
      if (language === "math") {
        formula(node, node.value, true, true);
      } else if (language === "mermaid") {
        diagram(node, node.value);
      }
    },
    blockquote: (node) => {
      callout(node);
    },
  };
  const features = { formulas: false, diagrams: false };
  const formula = (node: Nodes, source: string, display: boolean, block: boolean): void => {
    const set = setFormula(source, display);
    if ("error" in set) {
      report(node, "html.formula-error", `a formula with an error is shown as its source: ${set.error}`);
      replaced.set(node, { kind: "raw", html: errorHtml(source, set.error, block) });
    } else if (isFormulaHtml(set.html)) {
      features.formulas = true;
      replaced.set(node, {
        kind: "raw",
        html: block ? `<div class="rq-formula">${set.html}</div>` : set.html,
      });
    } else {
      report(node, "html.unsafe-content", "a formula KaTeX set to unexpected HTML is shown as text");
      replaced.set(node, shown(node));
    }
  };
  const diagram = (node: Nodes, source: string): void => {
    const risk = mermaidRisk(source);
    if (risk !== undefined) {
      report(node, "html.unsafe-content", `a Mermaid diagram with ${risk} is shown as text`);
      replaced.set(node, { kind: "nodes", nodes: [{ type: "code", lang: null, meta: null, value: source }] });
      return;
    }
    const limit = diagramOverLimit(source);
    if (limit !== undefined) {
      replaced.set(node, { kind: "raw", html: errorHtml(source, limit, true) });
      return;
    }
    features.diagrams = true;
    replaced.set(node, {
      kind: "raw",
      html: `<pre class="rq-diagram" data-rq-diagram><code class="language-mermaid">${escapeHtml(source)}</code></pre>`,
    });
  };
  const callout = (node: Blockquote): void => {
    const [first] = node.children;
    const [lead] = first?.type === "paragraph" ? first.children : [];
    const match = lead?.type === "text" ? CALLOUT.exec(lead.value) : null;
    if (first?.type !== "paragraph" || match === null) {
      return;
    }
    // The marker is the whole first line: a line ending follows it in its text, or the text ends the paragraph or a
    // hard break ends the line.
    const [, next] = first.children;
    const lineEnds = match[0].endsWith("\n") || next === undefined || next.type === "break";
    if (!lineEnds) {
      return;
    }
    // The marker line goes, with its hard break; a paragraph that held only it goes too.
    (lead as Text).value = (lead as Text).value.slice(match[0].length);
    if ((lead as Text).value === "") {
      first.children = first.children.slice(next?.type === "break" ? 2 : 1);
    }
    if (first.children.length === 0) {
      node.children = node.children.slice(1);
    }
    replaced.set(node, { kind: "aside", aside: CALLOUTS[String(match[1]).toLowerCase() as CalloutName] });
  };
  return {
    visit: (node: MdastContent): void => {
      const type = node.type as string;
      if (type === "inlineMath" || type === "math") {
        const math = node as unknown as MathNode;
        formula(node, math.value, math.display, type === "math");
        return;
      }
      (handlers[node.type] as ((node: MdastContent) => void) | undefined)?.(node);
    },
    /** The changes, once every image is read, the findings in text order, and what the page needs. */
    done: async (): Promise<{
      replaced: ReadonlyMap<Nodes, Change>;
      findings: TextFinding[];
      features: { formulas: boolean; diagrams: boolean };
    }> => {
      await Promise.all(images);
      return { replaced, findings: found.sort((a, b) => a.at - b.at).map((f) => f.finding), features };
    },
  };
};

/** The nodes this pass makes in the mdast, before `toHast` turns them into trusted hast nodes. */
export interface Made {
  readonly raw: WeakSet<object>;
  readonly asides: WeakMap<object, AsideKind>;
}

/** `parent`'s children with their changes; the addresses the changes add go into `made`. */
const changedChildren = (
  parent: Parent,
  replaced: ReadonlyMap<Nodes, Change>,
  made: Set<string>,
  nodes: Made,
): MdastContent[] =>
  parent.children.flatMap((child): MdastContent[] => {
    const change = replaced.get(child);
    if (change === undefined) {
      return [child];
    }
    const children = "children" in child ? (child.children as MdastContent[]) : [];
    switch (change.kind) {
      case "unwrap":
        return children;
      case "append":
        return [...children, { type: "text", value: change.text }];
      case "link":
        if (change.made === true) {
          made.add(change.url);
        }
        return [{ type: "link", url: change.url, children } as MdastContent];
      case "raw": {
        const node = { type: RAW, value: change.html };
        nodes.raw.add(node);
        return [node as unknown as MdastContent];
      }
      case "aside": {
        const node = { type: ASIDE, children };
        nodes.asides.set(node, change.aside);
        return [node as unknown as MdastContent];
      }
      case "nodes":
        for (const node of change.nodes) {
          if (node.type === "image") {
            made.add(node.url);
          }
        }
        return [...change.nodes];
    }
  });

/** The hast of the nodes this pass made, registered in `trusted` (see `Trusted`). */
export const madeToHast =
  (nodes: Made, trusted: Trusted) =>
  (state: State, node: { type: string; value?: string }): ElementContent | undefined => {
    if (node.type === RAW && nodes.raw.has(node)) {
      const raw: Raw = { type: "raw", value: String(node.value) };
      trusted.raw.add(raw);
      return raw;
    }
    const aside = nodes.asides.get(node);
    if (node.type !== ASIDE || aside === undefined) {
      // No other node of an unknown type reaches the tree.
      return undefined;
    }
    const title: Raw = {
      type: "raw",
      value: `<p class="starlight-aside__title" aria-hidden="true">${aside.title}</p>`,
    };
    trusted.raw.add(title);
    const content: Element = {
      type: "element",
      tagName: "div",
      properties: {},
      children: state.all(node as unknown as Nodes),
    };
    trusted.elements.set(content, ' class="starlight-aside__content"');
    const element: Element = {
      type: "element",
      tagName: "aside",
      properties: {},
      children: [title, content],
    };
    trusted.elements.set(
      element,
      ` aria-label="${aside.title}" class="starlight-aside starlight-aside--${aside.kind}"`,
    );
    return element;
  };

const rendered = async (text: string, context: TextContext): Promise<RenderedText> => {
  const tree: Root = fromMarkdown(text, {
    extensions: [gfm(), mathSyntax()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  });
  const { parents, definitions } = walk(tree);
  const changes = changesOf(text, context, definitions);
  for (const parent of parents) {
    for (const node of parent.children) {
      changes.visit(node);
    }
  }
  const { replaced, findings, features } = await changes.done();
  const made = new Set<string>();
  const nodes: Made = { raw: new WeakSet(), asides: new WeakMap() };
  // Deepest first, so a node that keeps its children gets them already changed.
  for (const parent of [...parents].reverse()) {
    parent.children = changedChildren(parent, replaced, made, nodes);
  }
  const trusted: Trusted = { raw: new WeakSet(), elements: new WeakMap() };
  const hast = toHast(tree, { unknownHandler: madeToHast(nodes, trusted) }) as HastRoot;
  return { html: writeHast(hast, made, trusted), findings, ...features };
};

// The word-level difference of two wordings, for the web UI through this subpath (ADR-0020). It uses `escapeHtml`
// only when called, so the cycle with `word-diff.ts` is safe.
export { wordDiff } from "./word-diff.js";
