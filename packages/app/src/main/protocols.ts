// The app's own protocols (ADR-0010): `app:` serves the bundled renderer, `logreq-file:` the images of
// the workspace, which the core process reads (only files inside a repository of the workspace).
import fs from "node:fs/promises";
import path from "node:path";
import type { FileAnswer } from "../shared/protocol.js";
import { decodedPath, isInside } from "../shared/paths.js";
import { CONTENT_SECURITY_POLICY } from "./security.js";

/** The schemes the app registers before it is ready: standard and secure, like `https:`. */
export const APP_SCHEMES = [
  { scheme: "app", privileges: { standard: true, secure: true } },
  { scheme: "logreq-file", privileges: { standard: true, secure: true } },
];

/** The host of the bundled renderer; the origin of the window is `app://logreq`. */
const RENDERER_HOST = "logreq";
export const RENDERER_URL = `app://${RENDERER_HOST}/index.html`;

/** Media types of the bundled renderer's files; any other file is not served. */
const RENDERER_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const notFound = (): Response => new Response(null, { status: 404 });

/** The `app:` handler: files of `folder` (the bundled renderer), each with the content security policy. */
export const rendererFiles =
  (folder: string) =>
  async (request: { readonly url: string }): Promise<Response> => {
    const url = URL.parse(request.url);
    const relative = url?.host === RENDERER_HOST ? decodedPath(url) : undefined;
    const target = relative === undefined ? undefined : path.resolve(folder, relative);
    const type = target === undefined ? undefined : RENDERER_TYPES[path.extname(target).toLowerCase()];
    if (target === undefined || type === undefined || !isInside(folder, target)) {
      return notFound();
    }
    try {
      return new Response(new Uint8Array(await fs.readFile(target)), {
        headers: {
          "content-type": type,
          "content-security-policy": CONTENT_SECURITY_POLICY,
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return notFound();
    }
  };

/**
 * The `logreq-file:` handler: asks the core process for the file. An image is never a document, so
 * even an SVG opened on its own runs no script.
 */
export const workspaceFiles =
  (read: (url: string) => Promise<FileAnswer>) =>
  async (request: { readonly url: string }): Promise<Response> => {
    const answer = await read(request.url);
    return answer.status === 200
      ? new Response(answer.data, {
          headers: {
            "content-type": answer.mimeType,
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "x-content-type-options": "nosniff",
          },
        })
      : notFound();
  };
