// The frame of every page of the HTML export (SR-231 AK2, AK4, AK9; SR-235 AK4): the docs' page frame and
// stylesheet (`docs-theme.generated.ts`, from the offline docs build) with the export's content in its slots, and a
// Content-Security-Policy that lets a page load only the export's own styles, scripts, fonts and images and never
// connect, frame, post or change its base; so even content the writer let through runs nothing. A page with a
// formula also takes the fonts of `assets/katex.css`, which are `data:` URLs; a page with a diagram also takes
// inline styles, since Mermaid measures text in a temporary SVG with a `<style>` element (the app has the same
// rule). Content never yields a `<style>`. `noindex` asks search engines not to take the page. Every address is
// relative and names a file of the folder.
import {
  DOCS_BODY_ATTRIBUTES,
  DOCS_FRAME,
  DOCS_HTML_ATTRIBUTES,
  DOCS_SIDEBAR_SCOPE,
  DOCS_STYLESHEET,
} from "./docs-theme.generated.js";
import { ELEMENT_PAGE_CSS } from "./element-page.js";
import { escapeHtml } from "./markdown.js";

/** The files every page links, relative to the export folder. */
export const ASSETS = {
  docs: "assets/docs.css",
  own: "assets/reqseq.css",
  katex: "assets/katex.css",
  theme: "assets/theme.js",
  page: "assets/reqseq.js",
  mermaid: "assets/mermaid.js",
} as const;

/** The docs' stylesheet, as the export writes it. */
export const DOCS_CSS = DOCS_STYLESHEET;

/** The export's own styles, after the docs' ones: errors in the docs' grey, diagrams, formulas, the element page, the search field hidden until its script runs. */
export const OWN_CSS = [
  ".rq-render-error { color: var(--sl-color-gray-3); }",
  ".rq-render-error-label { font-weight: 600; }",
  "div.rq-render-error { margin-top: 0.5rem; }",
  ".rq-diagram-image { display: block; max-width: 100%; height: auto; }",
  ".sl-markdown-content .katex-display { overflow-x: auto; overflow-y: hidden; }",
  ...ELEMENT_PAGE_CSS,
  "reqseq-search[hidden], .rq-search-more[hidden] { display: none; }",
  "",
].join("\n");

/** The policy of a page, as the meta tag gives it (`frame-ancestors` only works as a header). */
export const pagePolicy = ({ formulas, diagrams }: { formulas: boolean; diagrams: boolean }): string =>
  [
    "default-src 'none'",
    "script-src 'self'",
    diagrams ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    formulas ? "font-src 'self' data:" : "font-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

export interface PageInput {
  readonly title: string;
  /** The name of the workspace, the site title of every page. */
  readonly siteTitle: string;
  /** How many folders below the export folder the page lies (0 for `index.html`). */
  readonly depth: number;
  /** The content, already HTML. */
  readonly body: string;
  /** The footer, already HTML. */
  readonly footer: string;
  readonly formulas: boolean;
  readonly diagrams: boolean;
  /** Further scripts of the folder the page loads after the page script, relative to the export folder. */
  readonly scripts?: readonly string[];
}

/** The sidebar: the start page, marked as the current page on itself. */
const sidebar = (up: string, current: boolean): string => {
  const scope = DOCS_SIDEBAR_SCOPE;
  const here = current ? ' aria-current="page"' : "";
  return `<ul class="top-level ${scope}"><li class="${scope}"><a href="${up}index.html"${here} class="large ${scope}"><span class="${scope}">Start page</span></a></li></ul>`;
};

/** The page as HTML. */
export const page = (input: PageInput): string => {
  const up = "../".repeat(input.depth);
  const slots: Readonly<Record<string, string>> = {
    home: `${up}index.html`,
    siteTitle: escapeHtml(input.siteTitle),
    sidebar: sidebar(up, input.depth === 0),
    title: escapeHtml(input.title),
    content: input.body,
    footer: input.footer,
  };
  // The frame alternates text and slot names, beginning with text (`export-theme.ts`).
  const frame = DOCS_FRAME.map((part, index) => (index % 2 === 0 ? part : String(slots[part]))).join("");
  return [
    "<!doctype html>",
    `<html ${DOCS_HTML_ATTRIBUTES}>`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${pagePolicy(input)}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(input.title)} | ${escapeHtml(input.siteTitle)}</title>`,
    `<link rel="stylesheet" href="${up}${ASSETS.docs}">`,
    ...(input.formulas ? [`<link rel="stylesheet" href="${up}${ASSETS.katex}">`] : []),
    `<link rel="stylesheet" href="${up}${ASSETS.own}">`,
    `<script src="${up}${ASSETS.theme}"></script>`,
    "</head>",
    `<body ${DOCS_BODY_ATTRIBUTES}>${frame}`,
    ...(input.diagrams ? [`<script src="${up}${ASSETS.mermaid}"></script>`] : []),
    `<script src="${up}${ASSETS.page}"></script>`,
    ...(input.scripts ?? []).map((script) => `<script src="${up}${script}"></script>`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
};
