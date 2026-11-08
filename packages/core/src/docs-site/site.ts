// The offline documentation site of a delivery (SR-141, ADR-0017): which file a request names, its media type,
// and the headers of every response. It imports only `node:*`, so every way in (`reqseq serve docs`, the app)
// serves the same bytes by the same rule. Nothing here writes a file.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** The folder of the command pages in the site. */
export const COMMANDS_FOLDER = "reference/commands";

/**
 * The name of a command's page in the lower case of the site's URLs: `element.setStatus` →
 * `element-set-status`.
 */
export const commandSlug = (name: string): string =>
  name
    .replaceAll(".", "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

/** The path of a command's reference page below the site root: `reference/commands/element-get/`. */
export const commandPagePath = (name: string): string => `${COMMANDS_FOLDER}/${commandSlug(name)}/`;

/** Largest file served; a larger one is answered like a missing one. The largest file of the site is below 1 MB. */
export const MAX_DOCS_FILE_BYTES = 16 * 1024 * 1024;

/** Media type of HTML pages. */
export const HTML_TYPE = "text/html; charset=utf-8";

/** Media type of plain text, also of the short answers without a page. */
export const TEXT_TYPE = "text/plain; charset=utf-8";

/** Media type per file extension (lower case). A file with any other extension is not served. */
export const DOCS_MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".html": HTML_TYPE,
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": TEXT_TYPE,
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  // Pagefind's index, fragments and compressed wasm, which its script fetches and decodes itself.
  ".pagefind": "application/octet-stream",
  ".pf_meta": "application/octet-stream",
  ".pf_index": "application/octet-stream",
  ".pf_fragment": "application/octet-stream",
  ".pf_filter": "application/octet-stream",
};

/**
 * The Content-Security-Policy of a response. Scripts come only from the site, and an inline script runs only
 * when it is one of the page's own (`inlineScripts`, by hash), so a script put into the page later does not;
 * `'wasm-unsafe-eval'` lets Pagefind compile its wasm. Starlight sets CSS variables in `style` attributes,
 * hence `style-src-attr`; its CSS uses `data:` images.
 */
export const docsContentSecurityPolicy = (inlineScripts: readonly string[] = []): string =>
  [
    "default-src 'self'",
    `script-src ${["'self'", "'wasm-unsafe-eval'", ...new Set(inlineScripts.map(scriptHash))].join(" ")}`,
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

const scriptHash = (text: string): string =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

/** The text of every `<script>` without `src` in an HTML page. */
export const inlineScripts = (html: string): string[] =>
  [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => String(match[1]));

/** Headers of every response of a docs server, besides the content type and length. */
export const docsHeaders = (inline: readonly string[] = []): Readonly<Record<string, string>> => ({
  "x-content-type-options": "nosniff",
  "content-security-policy": docsContentSecurityPolicy(inline),
  "referrer-policy": "no-referrer",
  "cache-control": "no-cache",
});

/** The answer to one request: status, all headers and the body (sent for GET, left out for HEAD). */
export interface DocsResponse {
  readonly status: 200 | 404;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

export interface DocsSite {
  /** The site folder, symbolic links resolved. */
  readonly root: string;
  /** The answer to a request target as the request line has it (`/start/?q=1`). Never rejects. */
  respond(target: string): Promise<DocsResponse>;
}

/** A segment that may name nothing: empty, `.`, `..`, a hidden file, or one with `\`, `:` or a control character. */
const refusedSegment = (segment: string): boolean =>
  segment === "" || segment.startsWith(".") || /[\\:\p{Cc}]/u.test(segment);

/**
 * The path segments of the file a request target names, or `undefined` when it names none. The path is
 * decoded once; a folder (a trailing `/`, or no extension in the last segment) means its `index.html`.
 */
export function siteSegments(target: string): string[] | undefined {
  const end = target.search(/[?#]/);
  const raw = end < 0 ? target : target.slice(0, end);
  if (!raw.startsWith("/")) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.slice(1));
  } catch {
    return undefined;
  }
  const relative = decoded === "" || decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const segments = relative.split("/");
  if (segments.some(refusedSegment)) {
    return undefined;
  }
  return path.posix.extname(relative) === "" ? [...segments, "index.html"] : segments;
}

/** `file` lies below `root` (both absolute). */
const inside = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..";
};

/**
 * The site in `folder`, or `undefined` when the folder has no `index.html`. Each request is answered with
 * the file it names when that is a regular file with an allowed extension below the site root, also after
 * symbolic links are resolved, and not larger than MAX_DOCS_FILE_BYTES; anything else gets `404.html` (or a
 * short text when the site has none) with status 404.
 */
export async function openDocsSite(folder: string): Promise<DocsSite | undefined> {
  let root: string;
  try {
    root = await fs.realpath(folder);
  } catch {
    return undefined;
  }

  /** The bytes of `file` when it may be served. */
  const read = async (file: string): Promise<Buffer | undefined> => {
    try {
      const real = await fs.realpath(file);
      if (!inside(root, file) || !inside(root, real)) {
        return undefined;
      }
      const handle = await fs.open(real, "r");
      try {
        const stat = await handle.stat();
        return stat.isFile() && stat.size <= MAX_DOCS_FILE_BYTES ? await handle.readFile() : undefined;
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
  };

  const answer = (status: 200 | 404, type: string, body: Buffer): DocsResponse => ({
    status,
    headers: {
      "content-type": type,
      "content-length": String(body.length),
      ...docsHeaders(type === HTML_TYPE ? inlineScripts(body.toString("utf8")) : []),
    },
    body,
  });

  const notFound = async (): Promise<DocsResponse> => {
    const page = await read(path.join(root, "404.html"));
    return page === undefined
      ? answer(404, TEXT_TYPE, Buffer.from("Not found\n"))
      : answer(404, HTML_TYPE, page);
  };

  const respond = async (target: string): Promise<DocsResponse> => {
    const segments = siteSegments(target);
    const file = segments === undefined ? undefined : path.join(root, ...segments);
    const type = file === undefined ? undefined : DOCS_MEDIA_TYPES[path.extname(file).toLowerCase()];
    const body = file === undefined || type === undefined ? undefined : await read(file);
    return type === undefined || body === undefined ? notFound() : answer(200, type, body);
  };

  return (await read(path.join(root, "index.html"))) === undefined ? undefined : { root, respond };
}
