// The frame of every page of the HTML export (SR-231 AK2, AK4, AK9; SR-235 AK4): the docs' page frame and
// stylesheet (`docs-theme.generated.ts`, from the offline docs build) with the export's content in its slots, and a
// Content-Security-Policy that lets a page load only the export's own styles, scripts, fonts and images and never
// connect, frame, post or change its base; so even content the writer let through runs nothing. A page with a
// formula also takes the fonts of `assets/katex.css`, which are `data:` URLs; a page with a diagram also takes
// inline styles, since Mermaid measures text in a temporary SVG with a `<style>` element (the app has the same
// rule). Content never yields a `<style>`. `noindex` asks search engines not to take the page. Every address is
// relative and names a file of the folder. Every page has the docs' right column "On this page", with "Overview" and a
// link to each section, shown on wide screens as on the docs site, without a script (#2139); so content and header keep
// one position on every page (#2181).
import {
  DOCS_BODY_ATTRIBUTES,
  DOCS_FRAME,
  DOCS_HTML_ATTRIBUTES,
  DOCS_SIDEBAR_SCOPE,
  DOCS_STYLESHEET,
  DOCS_TOC,
  DOCS_TOC_SCOPE,
} from "./docs-theme.generated.js";
import { BASELINE_PAGE_CSS } from "./baselines.js";
import { ELEMENT_PAGE_CSS } from "./element-page.js";
import { LIST_CSS } from "./list-page.js";
import { START_PAGE_CSS } from "./start-page.js";
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

/** The table of contents takes no room below the docs' wide breakpoint, where the docs show it only with a script. */
const TOC_CSS = ["@media (width < 72rem) { :root[data-has-toc] { --sl-mobile-toc-height: 0rem; } }"];

/** The docs' stylesheet, as the export writes it. */
export const DOCS_CSS = DOCS_STYLESHEET;

/** The export's own styles, after the docs' ones: errors in the docs' grey, diagrams, formulas, the element page, the search field hidden until its script runs, the lists, the start page, the baseline pages and the table of contents. */
export const OWN_CSS = [
  ".rq-render-error { color: var(--sl-color-gray-3); }",
  ".rq-render-error-label { font-weight: 600; }",
  "div.rq-render-error { margin-top: 0.5rem; }",
  ".rq-diagram-image { display: block; max-width: 100%; height: auto; }",
  ".sl-markdown-content .katex-display { overflow-x: auto; overflow-y: hidden; }",
  ...ELEMENT_PAGE_CSS,
  "reqseq-search[hidden], .rq-search-more[hidden] { display: none; }",
  ...LIST_CSS,
  ...START_PAGE_CSS,
  ...BASELINE_PAGE_CSS,
  ...TOC_CSS,
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
  /** The content, already HTML. */
  readonly body: string;
  /** The footer, already HTML. */
  readonly footer: string;
  readonly formulas: boolean;
  readonly diagrams: boolean;
  /** Further scripts of the folder the page loads after the page script, relative to the export folder. */
  readonly scripts: readonly string[];
  /** The page relative to the export folder, `/` as separator: the sidebar marks it as the current page. */
  readonly path: string;
  /** The groups of the sidebar below the start page (SR-233 AK4). */
  readonly navigation: Navigation;
}

/** A link of the sidebar: a page relative to the export folder and its label. */
export interface NavigationLink {
  readonly path: string;
  readonly label: string;
}

/** The groups of the sidebar, each with its links, in the order shown. */
export type Navigation = readonly { readonly label: string; readonly links: readonly NavigationLink[] }[];

const CARET =
  '<svg aria-hidden="true" class="caret" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="m14.83 11.29-4.24-4.24a1 1 0 1 0-1.42 1.41L12.71 12l-3.54 3.54a1 1 0 0 0 0 1.41 1 1 0 0 0 .71.29 1 1 0 0 0 .71-.29l4.24-4.24a1.002 1.002 0 0 0 0-1.42Z"/></svg>';

/**
 * The sidebar: the start page, then each group of `navigation` open with its links (Starlight's markup of a group),
 * the link of the page `path` marked as the current page.
 */
const sidebar = (up: string, path: string, navigation: Navigation): string => {
  const scope = DOCS_SIDEBAR_SCOPE;
  const link = ({ path: target, label }: NavigationLink, large: boolean): string =>
    `<li class="${scope}"><a href="${up}${escapeHtml(target)}"${target === path ? ' aria-current="page"' : ""} class="${large ? "large " : ""}${scope}"><span class="${scope}">${escapeHtml(label)}</span></a></li>`;
  const groups = navigation
    .filter((group) => group.links.length > 0)
    .map(
      (group) =>
        `<li class="${scope}"><details open class="${scope}"><summary class="${scope}"><span class="group-label ${scope}"><span class="large ${scope}">${escapeHtml(group.label)}</span></span>${CARET.replace('class="caret"', `class="caret ${scope}"`)}</summary><ul class="${scope}">${group.links.map((l) => link(l, false)).join("")}</ul></details></li>`,
    );
  return `<ul class="top-level ${scope}">${link({ path: "index.html", label: "Start page" }, true)}${groups.join("")}</ul>`;
};

/**
 * The sections of `body` for the table of contents: each `<h2>` with an `id` and no other attribute, as the export's
 * sections write them (a heading of an element's text has no `id`, a footnote heading also a class), its text the label.
 */
const sectionsOf = (body: string): { readonly id: string; readonly label: string }[] =>
  [...body.matchAll(/<h2 id="([^"]+)">([^]*?)<\/h2>/gu)].map((m) => ({
    id: String(m[1]),
    label: String(m[2]).replaceAll(/<[^>]*>/gu, ""),
  }));

/**
 * The right column "On this page" of the docs (`DOCS_TOC`), with "Overview" and then each section of `body`; a page
 * without sections has "Overview" alone, so every page has the same layout.
 */
const tocOf = (body: string): string => {
  const sections = sectionsOf(body);
  const scope = DOCS_TOC_SCOPE;
  const entry = ({ id, label }: { readonly id: string; readonly label: string }): string =>
    `<li style="--depth: 0;" class="${scope}"><a href="#${id}" style="--depth: 0;" class="${scope}"><span style="--depth: 0;" class="${scope}">${label}</span></a></li>`;
  return `${DOCS_TOC[0]}${[{ id: "_top", label: "Overview" }, ...sections].map(entry).join("")}${DOCS_TOC[1]}`;
};

/** The page as HTML. */
export const page = (input: PageInput): string => {
  const up = "../".repeat(input.path.split("/").length - 1);
  const toc = tocOf(input.body);
  const slots: Readonly<Record<string, string>> = {
    home: `${up}index.html`,
    siteTitle: escapeHtml(input.siteTitle),
    sidebar: sidebar(up, input.path, input.navigation),
    toc,
    title: escapeHtml(input.title),
    content: input.body,
    footer: input.footer,
  };
  // The frame alternates text and slot names, beginning with text (`export-theme.ts`).
  const frame = DOCS_FRAME.map((part, index) => (index % 2 === 0 ? part : String(slots[part]))).join("");
  return [
    "<!doctype html>",
    `<html ${DOCS_HTML_ATTRIBUTES} data-has-toc>`,
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
    ...input.scripts.map((script) => `<script src="${up}${script}"></script>`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
};
