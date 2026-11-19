// How formulas and diagrams are set, the same in the app's editor preview (SR-096) and in the HTML export
// (SR-231 AK5): KaTeX's options and Mermaid's settings, limits and colours. Exported as
// `@reqseq/core/render-options` for the app's renderer, so it imports nothing.

/**
 * KaTeX's options without `displayMode` and `errorColor`: `trust: false` draws the commands that could link, load
 * or style anything (`\href`, `\url`, `\includegraphics`, `\htmlClass`, …) as their source text; warnings about
 * LaTeX KaTeX accepts anyway (Unicode text in math mode) are no errors; no box above 20em and no macro bomb; the
 * MathML part carries the source for assistive technology and copying.
 */
export const KATEX_OPTIONS = {
  throwOnError: true,
  trust: false,
  strict: "ignore",
  maxSize: 20,
  maxExpand: 1000,
  output: "htmlAndMathml",
} as const;

/** Bounds against a diagram that would hold the page up: its text, its statements, the edges of a flowchart. */
export const MAX_TEXT_SIZE = 50_000;
export const MAX_STATEMENTS = 500;
export const MAX_EDGES = 500;

/**
 * The configuration keys a diagram cannot change with an `%%{init: …}%%` directive: Mermaid's own list (security
 * level, limits, error rendering) and the look.
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

/**
 * Mermaid's settings besides the look: no drawing on load, label texts sanitized and no click handlers, labels as
 * SVG text rather than HTML in a `foreignObject`, the limits above.
 */
export const MERMAID_SETTINGS = {
  startOnLoad: false,
  securityLevel: "strict",
  deterministicIds: true,
  suppressErrorRendering: true,
  htmlLabels: false,
  maxTextSize: MAX_TEXT_SIZE,
  maxEdges: MAX_EDGES,
  theme: "base",
} as const;

/** The greys a diagram is drawn with, by their role (D-062). */
export type DiagramToken = "text" | "muted" | "rule" | "edge" | "sheet" | "raised";

/** Each colour variable of Mermaid's `base` theme and the role whose grey it takes. */
export const DIAGRAM_COLOURS: Readonly<Record<string, DiagramToken>> = {
  background: "sheet",
  primaryColor: "raised",
  primaryTextColor: "text",
  primaryBorderColor: "edge",
  secondaryColor: "sheet",
  secondaryTextColor: "text",
  secondaryBorderColor: "edge",
  tertiaryColor: "sheet",
  tertiaryTextColor: "text",
  tertiaryBorderColor: "rule",
  mainBkg: "raised",
  nodeBorder: "edge",
  clusterBkg: "sheet",
  clusterBorder: "rule",
  lineColor: "muted",
  textColor: "text",
  titleColor: "text",
  edgeLabelBackground: "sheet",
  noteBkgColor: "sheet",
  noteTextColor: "text",
  noteBorderColor: "rule",
  actorBkg: "raised",
  actorBorder: "edge",
  actorTextColor: "text",
  actorLineColor: "muted",
  signalColor: "text",
  signalTextColor: "text",
  labelBoxBkgColor: "raised",
  labelBoxBorderColor: "edge",
  labelTextColor: "text",
  loopTextColor: "text",
  activationBkgColor: "rule",
  activationBorderColor: "edge",
  sequenceNumberColor: "sheet",
  labelColor: "text",
  altBackground: "rule",
  stateBkg: "raised",
  stateLabelColor: "text",
  compositeBackground: "sheet",
  compositeTitleBackground: "raised",
  transitionColor: "muted",
  transitionLabelColor: "text",
  specialStateColor: "muted",
  errorBkgColor: "raised",
  errorTextColor: "text",
};

/** Why `source` is not drawn at all, before Mermaid sees it; undefined when it is within the bounds. */
export const diagramOverLimit = (source: string): string | undefined => {
  if (source.length > MAX_TEXT_SIZE) {
    return `Diagram too large: ${String(source.length)} characters, at most ${String(MAX_TEXT_SIZE)}.`;
  }
  // A `;` separates statements as a line break does, except the one that ends an entity such as `#35;`, of which
  // the Mermaid text of a graph puts many into its labels (SR-151 AK3).
  const statements = source
    .replace(/#(?:\d+|[A-Za-z]+);/g, "")
    .split(/[\n;]/)
    .filter((part) => part.trim() !== "").length;
  return statements > MAX_STATEMENTS
    ? `Diagram too large: ${String(statements)} statements, at most ${String(MAX_STATEMENTS)}.`
    : undefined;
};
