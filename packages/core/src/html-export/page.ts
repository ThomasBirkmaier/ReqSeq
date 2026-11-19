// The frame of every page of the HTML export (SR-231, SR-235 AK4): a static HTML5 document with a
// Content-Security-Policy that lets it load only the export's own styles, scripts, fonts and images
// and never connect, frame, post or change its base; so even content the writer let through runs
// nothing. `noindex` asks search engines not to take the page. The look comes with #1963.
import { escapeHtml } from "./markdown.js";

/** The stylesheet of the export, relative to its folder. */
export const STYLESHEET_FILE = "assets/reqseq.css";

/** The skeleton stylesheet until the look of the docs comes (#1963). */
export const STYLESHEET = [
  "body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0 auto; max-width: 50rem; padding: 1rem; }",
  "img { max-width: 100%; }",
  "pre { overflow-x: auto; }",
  ".rq-facts { color: #555; }",
  "",
].join("\n");

/** The policy of every page, as the meta tag gives it (`frame-ancestors` only works as a header). */
export const PAGE_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export interface PageInput {
  readonly title: string;
  /** How many folders below the export folder the page lies (0 for `index.html`). */
  readonly depth: number;
  /** The content, already HTML. */
  readonly body: string;
}

/** The page as HTML. */
export const page = ({ title, depth, body }: PageInput): string => {
  const up = "../".repeat(depth);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="stylesheet" href="${up}${STYLESHEET_FILE}">`,
    "</head>",
    `<body><main>${body}</main></body>`,
    "</html>",
    "",
  ].join("\n");
};
