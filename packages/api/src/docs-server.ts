// `reqseq serve docs` (SR-141, ADR-0017): the documentation site of a delivery over `node:http`, on
// 127.0.0.1 only. It needs no workspace and no token and writes nothing; which file a request gets, its
// headers and the CSP are the rule of `@reqseq/core/docs-site`, so the app serves the same bytes.
import type { IncomingMessage, ServerResponse } from "node:http";
import { CommandError } from "@reqseq/core";
import type { DocsResponse } from "@reqseq/core/docs-site";
import { TEXT_TYPE, docsHeaders, openDocsSite } from "@reqseq/core/docs-site";
import { loopbackHost } from "./loopback.js";
import { checkPort, closeServer, listenOnAll } from "./server.js";

/** The only address the docs server listens on; there is no option for another one. */
export const DOCS_HOST = "127.0.0.1";

export interface DocsServerOptions {
  /** The folder of the built site: the `docs` folder of the delivery. */
  readonly folder: string;
  /** TCP port, 0 (default) for any free one. */
  readonly port?: number;
}

export interface DocsServer {
  readonly port: number;
  /** `http://127.0.0.1:<port>/`. */
  readonly url: string;
  /** Stops listening and closes all connections. */
  close(): Promise<void>;
}

/** What a request gets: a file of the site, or a refusal. */
type Reply = Omit<DocsResponse, "status"> & { readonly status: number };

/** A refusal in plain text, with the headers of every docs response. */
const refusal = (status: number, text: string, extra: Readonly<Record<string, string>> = {}): Reply => {
  const body = Buffer.from(`${text}\n`);
  return {
    status,
    headers: {
      "content-type": TEXT_TYPE,
      "content-length": String(body.length),
      ...docsHeaders(),
      ...extra,
    },
    body,
  };
};

/**
 * Start the docs server for the site in `options.folder`. Rejects with `file.folder-missing` when the folder
 * holds no site (no `index.html`), and as the API does when the port is no TCP port or cannot be used.
 */
export async function startDocsServer(options: DocsServerOptions): Promise<DocsServer> {
  const requested = checkPort(options.port ?? 0);
  const site = await openDocsSite(options.folder);
  if (site === undefined) {
    throw new CommandError(
      "file.folder-missing",
      `No documentation in ${options.folder}: the folder or its index.html is missing`,
      { folder: options.folder },
    );
  }
  const answer = async (request: IncomingMessage): Promise<Reply> => {
    if (!loopbackHost(request)) {
      return refusal(403, "The Host header must name the loopback address and port of this server");
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return refusal(405, "Use GET or HEAD", { allow: "GET, HEAD" });
    }
    return site.respond(String(request.url));
  };
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    void answer(request)
      .catch(() => refusal(500, "Internal error of the documentation server"))
      .then(({ status, headers, body }) => {
        response.writeHead(status, headers);
        response.end(request.method === "HEAD" ? undefined : body);
      });
  };
  const { servers, port } = await listenOnAll([DOCS_HOST], requested, handler);
  return {
    port,
    url: `http://${DOCS_HOST}:${String(port)}/`,
    close: async () => {
      await Promise.all(servers.map(closeServer));
    },
  };
}
