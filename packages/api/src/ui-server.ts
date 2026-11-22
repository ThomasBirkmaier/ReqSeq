// The UI server of `reqseq ui` (ADR-0020): the page files of the web UI and the catalog commands for them,
// on loopback only, with a token that is new on every start. It opens the workspace in its own process and
// switches it on request; every command is one call of the command runner with the access `ui`. Checks on
// every request, in this order: Host, Origin, `Sec-Fetch-Site`, token. Body limits, the bearer header and the
// error body are those of the API (`http-parts.ts`); its routes and the Origin rule are its own.
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { CommandRuntime, InvokeContext, WorkspaceChange } from "@reqseq/core";
import {
  CommandError,
  Workspace,
  cacheFolder,
  getCommandRuntime,
  warmWorkspace,
  watchWorkspace,
  workspaceLayoutState,
} from "@reqseq/core";
import type { Answer } from "./http-parts.js";
import {
  TOO_LARGE,
  answerAndClose,
  bearerToken,
  parseBody,
  readBody,
  refusal,
  sameSecret,
  send,
  sendError,
} from "./http-parts.js";
import { checkPort, closeServer, listenOnAll } from "./listen.js";
import { loopbackHost } from "./loopback.js";
import { LOOPBACK_HOSTS, urlOf } from "./server.js";

/** What runs a catalog command: core's runtime, or a test's runner with given outputs (ADR-0020 "Test seam"). */
export type CommandRunner = Pick<CommandRuntime, "contracts" | "invoke">;

export interface UiServerOptions {
  /** The folder of the built page files (`packages/web/dist`, `lib/web/` of the delivery). */
  readonly pages: string;
  /** Default: the runtime of this process (`getCommandRuntime()`). */
  readonly runner?: CommandRunner;
  /** The root of the workspace to open at start; without it the server starts with none. */
  readonly workspace?: string;
  /** TCP port, 0 (default) for any free one. */
  readonly port?: number;
  /** The folder a relative path of `POST /ui/workspace` and the commands without a workspace start from. */
  readonly cwd?: string;
  /**
   * Gets a problem that does not stop the server: the workspace it opened could not be marked as opened
   * (`workspace.markOpened`). Default: none is reported.
   */
  readonly report?: (message: string) => void;
}

export interface UiServer {
  readonly port: number;
  /** The token every request but a page file carries. */
  readonly token: string;
  /** The address to open: `http://127.0.0.1:<port>/#token=<token>`. */
  readonly url: string;
  /** Base URL per address: 127.0.0.1, and ::1 where the machine has IPv6. */
  readonly urls: readonly string[];
  /** Stops listening, aborts running reads, waits for running writes and closes the workspace. */
  close(): Promise<void>;
}

/** The prefix of `POST /api/<command>`. */
export const UI_COMMANDS_PATH = "/api/";
/** Opens or switches the workspace. */
export const UI_WORKSPACE_PATH = "/ui/workspace";
/** The event stream. */
export const UI_EVENTS_PATH = "/api/events";
/** The generation number of the open workspace, which every command request carries. */
export const WORKSPACE_HEADER = "x-reqseq-workspace";

/** The only commands that run while no workspace is open (ADR-0020 "Workspaces"). */
export const NO_WORKSPACE_COMMANDS: readonly string[] = [
  "tool.info",
  "tool.guide",
  "workspace.recent",
  "workspace.listFolder",
  "workspace.init",
];

/** The fixed `Content-Type` of each extension served; a file with another one is not served. */
const PAGE_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/** On every answer (SR-247 AK9: no `Access-Control-Allow-*`). */
const COMMON_HEADERS = {
  "x-content-type-options": "nosniff",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "frame-ancestors 'none'",
} as const;

/** The CSP of the pages (ADR-0020 "Response headers"). */
export const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; " +
  "font-src 'self'; connect-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PAGE_HEADERS = {
  ...COMMON_HEADERS,
  "content-security-policy": PAGE_CSP,
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
} as const;

/** The answer to a request of another workspace than the open one, or a read a switch stopped. */
const CHANGED = {
  code: "workspace.changed",
  message: "The workspace was switched; read the open workspace again",
} as const;

/** The answer to a read the closing server stopped. */
const STOPPING = { code: "server.stopping", message: "The UI server is stopping" } as const;

interface PageFile {
  readonly type: string;
  readonly body: Buffer;
}

/**
 * The manifest of the page files: every regular file below `folder` with a type of PAGE_TYPES, by its URL
 * path, read once at start. Links are not followed. Rejects with `file.folder-missing` without `index.html`.
 */
const readManifest = async (folder: string): Promise<ReadonlyMap<string, PageFile>> => {
  const missing = (): CommandError =>
    new CommandError(
      "file.folder-missing",
      `No web UI in ${folder}: the folder or its index.html is missing`,
      {
        folder,
      },
    );
  const unreadable = (file: string, error: unknown): CommandError =>
    new CommandError("internal", `Cannot read the web UI file ${file}`, { file }, { cause: error });
  const manifest = new Map<string, PageFile>();
  let entries;
  try {
    entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  } catch (error) {
    throw ["ENOENT", "ENOTDIR"].includes(String((error as NodeJS.ErrnoException).code))
      ? missing()
      : unreadable(folder, error);
  }
  for (const entry of entries) {
    const type = PAGE_TYPES[path.extname(entry.name).toLowerCase()];
    if (entry.isFile() && type !== undefined) {
      const file = path.join(entry.parentPath, entry.name);
      const url = `/${path.relative(folder, file).split(path.sep).join("/")}`;
      const body = await fs.readFile(file).catch((error: unknown) => {
        throw unreadable(file, error);
      });
      manifest.set(url, { type, body });
    }
  }
  if (!manifest.has("/index.html")) {
    throw missing();
  }
  return manifest;
};

/** One open workspace: its generation, what aborts its reads, and its watcher. */
interface Session {
  readonly workspace: Workspace;
  readonly generation: number;
  readonly reads: AbortController;
  readonly unsubscribe: () => void;
}

/**
 * Opens the workspace at `root` as `reqseq serve api` does (model cache, watcher before the load) once its
 * workspace file is read; rejects with core's error (`workspace.not-found`, `file.faulty`) otherwise.
 */
const openChecked = async (root: string): Promise<Workspace> => {
  const workspace = new Workspace(root, { cacheFolder: cacheFolder(root) });
  try {
    // The watcher starts before the load, so a change during the load is seen (ADR-0008); `close` stops it.
    await watchWorkspace(workspace).ready;
    await workspace.get(workspaceLayoutState);
  } catch (error) {
    await workspace.close();
    throw error;
  }
  return workspace;
};

/** The path of the request target without its query, or undefined when it is no origin form. */
const pathOf = (url: string | undefined): string | undefined => {
  const target = String(url);
  const end = target.search(/[?#]/u);
  const pathname = end < 0 ? target : target.slice(0, end);
  return pathname.startsWith("/") ? pathname : undefined;
};

/** The page path of the request target, percent-decoded; undefined for a broken escape. */
const pagePathOf = (pathname: string | undefined): string | undefined => {
  try {
    return pathname === undefined ? undefined : decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
};

/** One server-sent event. */
const eventText = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** What a request asks for after the checks. */
type Goal =
  | { readonly kind: "command"; readonly name: string }
  | { readonly kind: "workspace" }
  | { readonly kind: "events" };

/** The route of a request that passed the checks, or undefined for anything else (404). */
const goalOf = (method: string | undefined, pathname: string | undefined): Goal | undefined => {
  if (pathname === UI_EVENTS_PATH) {
    return method === "GET" ? { kind: "events" } : undefined;
  }
  if (method !== "POST" || pathname === undefined) {
    return undefined;
  }
  if (pathname === UI_WORKSPACE_PATH) {
    return { kind: "workspace" };
  }
  if (!pathname.startsWith(UI_COMMANDS_PATH)) {
    return undefined;
  }
  try {
    return { kind: "command", name: decodeURIComponent(pathname.slice(UI_COMMANDS_PATH.length)) };
  } catch {
    // A broken escape names no command.
    return undefined;
  }
};

/**
 * Start the UI server: read the manifest of `pages`, open `workspace` if given (a missing or unreadable one
 * rejects before anything listens), and listen on LOOPBACK_HOSTS.
 */
export async function createUiServer(options: UiServerOptions): Promise<UiServer> {
  const requested = checkPort(options.port ?? 0);
  const runner = options.runner ?? getCommandRuntime();
  const cwd = options.cwd ?? process.cwd();
  const manifest = await readManifest(options.pages);
  const token = randomBytes(32).toString("base64url");
  const secret = Buffer.from(token, "utf8");
  const closing = new AbortController();
  const streams = new Set<ServerResponse>();
  let generation = 0;
  let session: Session | undefined;
  // Switches run one after the other; a command waits for the one that runs.
  let switching: Promise<unknown> = Promise.resolve();
  // The running writes, with or without a workspace: a switch and `close` wait for them.
  const writes = new Set<Promise<unknown>>();
  // The command requests being answered: `close` lets them answer before it closes the connections.
  const answering = new Set<Promise<void>>();

  const broadcast = (text: string): void => {
    for (const stream of streams) {
      stream.write(text);
    }
  };

  /**
   * Marks the opened workspace first in `workspace.recent` (SR-247 AK12, SR-250). A refusal is reported and
   * leaves the workspace open: the list of recent workspaces is a convenience of the user, not of the workspace.
   */
  const markOpened = async (workspace: Workspace): Promise<void> => {
    try {
      await runner.invoke("workspace.markOpened", {}, { workspace, access: "ui" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.report?.(`The workspace was not marked as opened: ${message}`);
    }
  };

  const begin = async (workspace: Workspace): Promise<Session> => {
    const watcher = watchWorkspace(workspace);
    await watcher.ready;
    const unsubscribe = watcher.onChange((change: WorkspaceChange) => {
      broadcast(eventText("change", { scope: change.scope, elements: change.elements }));
    });
    void warmWorkspace(workspace);
    generation += 1;
    return { workspace, generation, reads: new AbortController(), unsubscribe };
  };

  const end = async (old: Session | undefined): Promise<void> => {
    if (old === undefined) {
      await Promise.allSettled(writes);
      return;
    }
    old.reads.abort();
    old.unsubscribe();
    await Promise.allSettled(writes);
    await old.workspace.close();
  };

  const open = async (root: string): Promise<{ readonly generation: number; readonly root: string }> => {
    const workspace = await openChecked(path.resolve(cwd, root));
    const old = session;
    session = undefined;
    await end(old);
    session = await begin(workspace);
    await markOpened(workspace);
    broadcast(eventText("workspace", { generation }));
    return { generation, root: workspace.root };
  };

  if (options.workspace !== undefined) {
    session = await begin(await openChecked(path.resolve(cwd, options.workspace)));
  }
  // Where the commands without a workspace run: they use its root only for a relative path.
  const placeholder = new Workspace(cwd);

  const runCommand = async (
    name: string,
    request: IncomingMessage,
    text: string,
    response: ServerResponse,
  ): Promise<void> => {
    // Listened for first: a client that goes away while a switch runs aborts its read too.
    const gone = new AbortController();
    response.once("close", () => {
      if (!response.writableFinished) {
        gone.abort();
      }
    });
    await switching.catch(() => undefined);
    const current = session;
    if (request.headers[WORKSPACE_HEADER] !== String(generation)) {
      await send(response, 409, CHANGED, COMMON_HEADERS);
      return;
    }
    if (current === undefined && !NO_WORKSPACE_COMMANDS.includes(name)) {
      throw new CommandError("workspace.not-found", `No workspace is open; ${name} needs one`, {
        command: name,
      });
    }
    const input = parseBody(text);
    const workspace = current?.workspace ?? placeholder;
    const write = runner.contracts.entry(name)?.effect === "write-files";
    // A write runs to its end (ADR-0020: a switch lets running writes finish); a read stops when its client
    // goes away, the workspace is switched or the server closes.
    const context: InvokeContext = write
      ? { workspace, access: "ui" }
      : {
          workspace,
          access: "ui",
          signal: AbortSignal.any([gone.signal, closing.signal, ...(current ? [current.reads.signal] : [])]),
        };
    const running = runner.invoke(name, input, context);
    if (write) {
      writes.add(running);
      void running.finally(() => writes.delete(running)).catch(() => undefined);
    }
    let output: unknown;
    try {
      output = await running;
    } catch (error) {
      // A read the server stopped: the answer says why, not `internal` (aborted).
      if (closing.signal.aborted) {
        await send(response, 503, STOPPING, COMMON_HEADERS);
        return;
      }
      if (current?.reads.signal.aborted === true) {
        await send(response, 409, CHANGED, COMMON_HEADERS);
        return;
      }
      throw error;
    }
    await send(response, 200, output ?? null, COMMON_HEADERS);
  };

  const switchWorkspace = async (text: string, response: ServerResponse): Promise<void> => {
    const input = parseBody(text) as { readonly path?: unknown } | null;
    const root = typeof input === "object" && input !== null ? input.path : undefined;
    if (typeof root !== "string" || root === "") {
      throw new CommandError("input.invalid", 'The body must be { "path": "<folder of the workspace>" }');
    }
    const opened = switching.catch(() => undefined).then(() => open(root));
    switching = opened;
    await send(response, 200, await opened, COMMON_HEADERS);
  };

  const streamEvents = (response: ServerResponse): void => {
    response.writeHead(200, {
      ...COMMON_HEADERS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
    });
    response.write(eventText("workspace", { generation }));
    streams.add(response);
    response.once("close", () => streams.delete(response));
  };

  /** The page file a request gets, or undefined when it asks for none. */
  const pageOf = (request: IncomingMessage, pathname: string | undefined): PageFile | undefined => {
    const page = pagePathOf(pathname);
    return (request.method === "GET" || request.method === "HEAD") && page !== undefined
      ? manifest.get(page === "/" ? "/index.html" : page)
      : undefined;
  };

  /** The refusal of a request, or its page file, or what it asks to run. */
  const target = (request: IncomingMessage): Answer | PageFile | Goal => {
    const forbidden = (message: string): Answer => refusal(403, message, COMMON_HEADERS);
    if (!loopbackHost(request)) {
      return forbidden("The Host header must name the loopback address and port of this server");
    }
    const { origin } = request.headers;
    if (
      origin !== undefined &&
      origin.toLowerCase() !== `http://${String(request.headers.host).toLowerCase()}`
    ) {
      return forbidden("Requests from other origins are refused");
    }
    const pathname = pathOf(request.url);
    const page = pageOf(request, pathname);
    if (page !== undefined) {
      return page;
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      return forbidden("Requests from other sites are refused");
    }
    if (!sameSecret(bearerToken(request.headers.authorization), secret)) {
      return refusal(401, "Missing or wrong token; open the address that reqseq ui printed", {
        ...COMMON_HEADERS,
        "www-authenticate": "Bearer",
      });
    }
    return (
      goalOf(request.method, pathname) ??
      refusal(404, `No endpoint ${String(pathname ?? request.url)}`, COMMON_HEADERS)
    );
  };

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const goal = target(request);
    if ("type" in goal) {
      response.writeHead(200, {
        ...PAGE_HEADERS,
        "content-type": goal.type,
        "content-length": String(goal.body.length),
      });
      response.end(request.method === "HEAD" ? undefined : goal.body);
      return;
    }
    const ended = new Promise<void>((resolve) => request.once("end", resolve));
    const runs = "kind" in goal && goal.kind !== "events";
    const text = await readBody(request, runs);
    if (text === undefined) {
      answerAndClose(response, "kind" in goal ? { ...TOO_LARGE, headers: COMMON_HEADERS } : goal, ended);
      return;
    }
    if (!("kind" in goal)) {
      await send(response, goal.status, goal.body, goal.headers);
      return;
    }
    if (goal.kind === "events") {
      streamEvents(response);
      return;
    }
    if (goal.kind === "workspace") {
      await switchWorkspace(text, response);
      return;
    }
    const answer = runCommand(goal.name, request, text, response);
    answering.add(answer);
    try {
      await answer;
    } finally {
      answering.delete(answer);
    }
  };

  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    route(request, response).catch((error: unknown) =>
      sendError(response, error, session?.workspace ?? placeholder, COMMON_HEADERS, "the UI server"),
    );
  };

  const { servers, port } = await listenOnAll(LOOPBACK_HOSTS, requested, handler).catch(
    async (error: unknown) => {
      await end(session);
      await placeholder.close();
      throw error;
    },
  );
  // Marked only once the server listens: a start that fails opened nothing (SR-247 AK3).
  if (session !== undefined) {
    await markOpened(session.workspace);
  }
  return {
    port,
    token,
    url: `http://127.0.0.1:${String(port)}/#token=${token}`,
    urls: servers.map((server) => urlOf(server.address() as AddressInfo)),
    close: async () => {
      closing.abort();
      // Stopped reads answer 503 and writes run to their end before the connections close.
      await Promise.allSettled(answering);
      await Promise.all(servers.map(closeServer));
      await switching.catch(() => undefined);
      const last = session;
      session = undefined;
      await end(last);
      await placeholder.close();
    },
  };
}
