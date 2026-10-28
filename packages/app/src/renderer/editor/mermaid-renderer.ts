// Diagrams drawn by Mermaid (SR-096, #108), bundled with the app and loaded on the first diagram (its
// chunks come from the app's own files, `app:`; nothing is loaded from elsewhere, SR-078).
//
// What Mermaid draws is never put into the page as markup: its SVG becomes the `data:` URL of an `<img>`,
// in which nothing can run, load, receive events or style the page (ADR-0010: nothing from a file is
// interpreted as HTML). While it draws, Mermaid builds a temporary SVG in the DOM to measure the text; it
// builds it in a container of its own, out of view, that is emptied after each drawing. The barrier for
// that temporary DOM is the CSP (`script-src 'self'`, no inline handlers) and the sandboxed renderer;
// `securityLevel: "strict"` (label texts sanitized, no click handlers) is defence in depth.
import type mermaidApi from "mermaid";
import type { MermaidConfig } from "mermaid";

export type DiagramResult =
  | {
      readonly ok: true;
      /** The drawing as `data:image/svg+xml`. */
      readonly url: string;
      readonly width: number;
      readonly height: number;
      /** The accessible title of the diagram (`accTitle`), or "Diagram". */
      readonly title: string;
    }
  | { readonly ok: false; readonly message: string };

/** The colours and the font a diagram is drawn with: greys from the tokens of the app (D-062). */
export interface DiagramTheme {
  readonly dark: boolean;
  readonly text: string;
  readonly muted: string;
  readonly rule: string;
  readonly edge: string;
  readonly sheet: string;
  readonly raised: string;
  readonly fontFamily: string;
}

/**
 * Bounds against a diagram that would hold the editor up: its text, its statements (lines or parts of a
 * line between `;`), the edges of a flowchart.
 */
export const MAX_TEXT_SIZE = 50_000;
export const MAX_STATEMENTS = 500;
export const MAX_EDGES = 500;

/**
 * The configuration keys a diagram cannot change with an `%%{init: …}%%` directive: Mermaid's own list
 * (security level, limits, error rendering) and the look, which stays the app's (D-062).
 */
export const SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "theme",
  "themeVariables",
  "themeCSS",
  "htmlLabels",
  "fontFamily",
  "deterministicIds",
  "darkMode",
] as const;

export const mermaidConfig = (theme: DiagramTheme): MermaidConfig => ({
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  suppressErrorRendering: true,
  // Labels as SVG text, not HTML in a `foreignObject`: measured with the app's font, drawn the same in the image.
  htmlLabels: false,
  maxTextSize: MAX_TEXT_SIZE,
  maxEdges: MAX_EDGES,
  theme: "base",
  darkMode: theme.dark,
  fontFamily: theme.fontFamily,
  themeVariables: {
    darkMode: theme.dark,
    fontFamily: theme.fontFamily,
    background: theme.sheet,
    primaryColor: theme.raised,
    primaryTextColor: theme.text,
    primaryBorderColor: theme.edge,
    secondaryColor: theme.sheet,
    secondaryTextColor: theme.text,
    secondaryBorderColor: theme.edge,
    tertiaryColor: theme.sheet,
    tertiaryTextColor: theme.text,
    tertiaryBorderColor: theme.rule,
    mainBkg: theme.raised,
    nodeBorder: theme.edge,
    clusterBkg: theme.sheet,
    clusterBorder: theme.rule,
    lineColor: theme.muted,
    textColor: theme.text,
    titleColor: theme.text,
    edgeLabelBackground: theme.sheet,
    noteBkgColor: theme.sheet,
    noteTextColor: theme.text,
    noteBorderColor: theme.rule,
    actorBkg: theme.raised,
    actorBorder: theme.edge,
    actorTextColor: theme.text,
    actorLineColor: theme.muted,
    signalColor: theme.text,
    signalTextColor: theme.text,
    labelBoxBkgColor: theme.raised,
    labelBoxBorderColor: theme.edge,
    labelTextColor: theme.text,
    loopTextColor: theme.text,
    activationBkgColor: theme.rule,
    activationBorderColor: theme.edge,
    sequenceNumberColor: theme.sheet,
    labelColor: theme.text,
    altBackground: theme.rule,
    stateBkg: theme.raised,
    stateLabelColor: theme.text,
    compositeBackground: theme.sheet,
    compositeTitleBackground: theme.raised,
    transitionColor: theme.muted,
    transitionLabelColor: theme.text,
    specialStateColor: theme.muted,
    errorBkgColor: theme.raised,
    errorTextColor: theme.text,
  },
  secure: [...SECURE_KEYS],
});

/** The message of what Mermaid threw: an Error, or the hash object of its Jison parsers. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    // The edge limit's message goes on to tell a developer how to raise it; the user sees its first line.
    return error.message.startsWith("Edge limit exceeded.")
      ? error.message.replace(/\n[^]*$/, "")
      : error.message;
  }
  if (typeof error === "object" && error !== null && "str" in error) {
    return String(error.str);
  }
  return String(error);
};

/** Why `source` is not drawn at all, before Mermaid sees it; undefined when it is within the bounds. */
export const overLimit = (source: string): string | undefined => {
  if (source.length > MAX_TEXT_SIZE) {
    return `Diagram too large: ${String(source.length)} characters, at most ${String(MAX_TEXT_SIZE)}.`;
  }
  // A `;` separates statements as a line break does; one inside a quoted label only makes the bound stricter.
  const statements = source.split(/[\n;]/).filter((part) => part.trim() !== "").length;
  return statements > MAX_STATEMENTS
    ? `Diagram too large: ${String(statements)} statements, at most ${String(MAX_STATEMENTS)}.`
    : undefined;
};

const ROOT = /<svg\b[^>]*>/;

/**
 * The drawing as an image: the root of Mermaid's SVG gets the size of its `viewBox` (Mermaid writes
 * `width="100%"`, which an image has no width for), and the SVG becomes a `data:` URL.
 */
export const asImage = (svg: string, title: string): DiagramResult => {
  const root = ROOT.exec(svg)?.[0] ?? "<svg>";
  const box =
    /\bviewBox="([^"]*)"/
      .exec(root)?.[1]
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  const [width = 0, height = 0] = box
    .slice(2)
    .map((value) => (Number.isFinite(value) ? Math.ceil(value) : 0));
  const sized = root
    .replace(/\s(?:width|height)="[^"]*"/g, "")
    .replace(/\sstyle="[^"]*"/, "")
    .replace(/^<svg\b/, `<svg width="${String(width)}" height="${String(height)}"`);
  return {
    ok: true,
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(root, () => sized))}`,
    width,
    height,
    title: title.trim() === "" ? "Diagram" : title.trim(),
  };
};

/** The `accTitle` of a diagram's source, if it has one. */
export const accessibleTitle = (source: string): string =>
  /^\s*accTitle\s*:\s*(.*)$/m.exec(source)?.[1] ?? "";

type Mermaid = typeof mermaidApi;

let loaded: Promise<Mermaid> | undefined;
/** Mermaid, loaded once on the first diagram (lazy chunk of the bundle). */
const mermaidModule = (): Promise<Mermaid> => {
  loaded ??= import("mermaid").then((module) => module.default);
  return loaded;
};

let container: HTMLElement | undefined;
/**
 * Where Mermaid builds its temporary SVG: out of view but laid out (`display: none` would leave the text
 * unmeasured), outside the sheet, so it neither flashes nor adds a scroll bar.
 */
export const measuringContainer = (): HTMLElement => {
  if (container?.isConnected !== true) {
    container = document.createElement("div");
    container.className = "lr-diagram-measure";
    container.setAttribute("aria-hidden", "true");
    Object.assign(container.style, {
      position: "fixed",
      left: "-10000px",
      top: "0",
      visibility: "hidden",
      contain: "layout style",
    });
    document.body.append(container);
  }
  return container;
};

let queue: Promise<unknown> = Promise.resolve();
let next = 0;
let configured = "";

const draw = async (source: string, theme: DiagramTheme): Promise<DiagramResult> => {
  const limit = overLimit(source);
  if (limit !== undefined) {
    return { ok: false, message: limit };
  }
  const into = measuringContainer();
  try {
    const mermaid = await mermaidModule();
    const config = JSON.stringify(theme);
    if (config !== configured) {
      mermaid.initialize(mermaidConfig(theme));
      configured = config;
    }
    await mermaid.parse(source);
    next += 1;
    const { svg } = await mermaid.render(`lr-diagram-${String(next)}`, source, into);
    return asImage(svg, accessibleTitle(source));
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  } finally {
    into.replaceChildren();
  }
};

const TOKENS = ["text", "muted", "rule", "edge", "sheet", "raised"] as const;

/**
 * The theme of the page as it is now: each colour token resolved to a concrete colour (the tokens are
 * `light-dark()`, which Mermaid cannot compute with) through a probe, the scheme, and the page's font.
 */
export const pageTheme = (): DiagramTheme => {
  const probe = document.createElement("span");
  document.body.append(probe);
  const colours = Object.fromEntries(
    TOKENS.map((token) => {
      probe.style.color = `var(--${token})`;
      return [token, getComputedStyle(probe).color];
    }),
  ) as Record<(typeof TOKENS)[number], string>;
  probe.remove();
  const root = document.documentElement;
  const scheme = root.dataset["theme"];
  return {
    ...colours,
    dark: scheme === undefined ? matchMedia("(prefers-color-scheme: dark)").matches : scheme === "dark",
    fontFamily: getComputedStyle(root).fontFamily,
  };
};

/**
 * The diagram `source` drawn in `theme`, or the message of its error. One drawing at a time: Mermaid's
 * state (its configuration, its diagram database) is global.
 */
export const renderDiagram = (source: string, theme: DiagramTheme): Promise<DiagramResult> => {
  const result = queue.then(() => draw(source, theme));
  queue = result;
  return result;
};
