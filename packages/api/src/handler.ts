// The HTTP side of the local API (ADR-0009): checks Host, Origin and token, then translates a request into
// one `invoke` call and its result or error into a response. No command is named here; routes come from
// the catalog names (ADR-0002 rule 3), and the output is sent as core returns it (SR-080 AK2).
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CommandErrorClass, CommandErrorObject, CommandRuntime, Workspace } from "@logreq/core";
import { CommandError, errorClass } from "@logreq/core";

/** HTTP status of each error class (ADR-0009 "Errors"); documented in schemas/generated/openapi.json. */
export const HTTP_STATUS_BY_CLASS: Readonly<Record<CommandErrorClass, number>> = {
  input: 400,
  "not-found": 404,
  conflict: 409,
  unavailable: 503,
  "not-implemented": 501,
  internal: 500,
};

/**
 * Largest request body. A command run with a larger one gets 413 as soon as it passes the limit; a refusal
 * or the catalog keeps its own status. Either way the answer says `Connection: close` (see DRAIN_BYTES).
 */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** `GET` lists the catalog; `POST <COMMANDS_PATH>/<name>` runs a command. */
export const COMMANDS_PATH = "/v1/commands";

export interface HandlerOptions {
  readonly runtime: CommandRuntime;
  readonly workspace: Workspace;
  /** The bearer token of this server. */
  readonly token: string;
  /** Aborted when the server closes: running commands stop. */
  readonly signal: AbortSignal;
}

export type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

/** Host names of loopback; the Host header must be one of them with the port of the connection. */
const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): void => {
  // Serialised first: a failure here still leaves the headers unsent for the error response.
  const text = `${JSON.stringify(body)}\n`;
  if (response.destroyed) {
    // The client has gone away; nobody reads the answer.
    return;
  }
  response.writeHead(status, { ...HEADERS, ...headers });
  response.end(text);
};

/** An answer that needs no command: a refusal, or the catalog listing. */
interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A refusal before any command runs: always the error object of an `input.invalid`. */
const refusal = (
  status: number,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): Answer => ({
  status,
  body: { code: "input.invalid", message } satisfies CommandErrorObject,
  headers,
});

const TOO_LARGE = refusal(413, `The request body is larger than ${String(MAX_BODY_BYTES)} bytes`);

/**
 * The answer to a request whose body is over MAX_BODY_BYTES, with `connection: close`: the connection is cut
 * after DRAIN_BYTES, so a keep-alive client must not send its next request on it. The whole answer is
 * written at once, but the response ends only when the body has ended: Node closes the connection of a
 * `connection: close` response as soon as it ends, and closing it while the client still sends resets it
 * (see DRAIN_BYTES). `ended` settles when the body has ended; it never does when the connection is cut first.
 */
const answerAndClose = (response: ServerResponse, answer: Answer, ended: Promise<void>): void => {
  const text = `${JSON.stringify(answer.body)}\n`;
  response.writeHead(answer.status, {
    ...HEADERS,
    ...answer.headers,
    connection: "close",
    "content-length": String(Buffer.byteLength(text)),
  });
  response.write(text);
  void ended.then(() => response.end());
};

const sendError = (response: ServerResponse, error: unknown): void => {
  const commandError =
    error instanceof CommandError ? error : new CommandError("internal", "Internal error in the local API");
  send(response, HTTP_STATUS_BY_CLASS[errorClass(commandError.code)], commandError.toJSON());
};

/**
 * After a body grows over MAX_BODY_BYTES, at most this many more bytes are read and dropped, then the
 * connection is cut. Reading on for a while lets the answer (413, or an earlier refusal) reach the client:
 * closing a connection with unread data resets it, and the client may lose the answer.
 */
export const DRAIN_BYTES = MAX_BODY_BYTES;

/**
 * The body as text (empty when `keep` is false: the body is read and dropped), or `undefined` as soon as it is
 * larger than MAX_BODY_BYTES. Nothing beyond the limit is kept; the rest is dropped until DRAIN_BYTES more
 * have come, then the connection is cut.
 */
const readBody = (request: IncomingMessage, keep: boolean): Promise<string | undefined> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) {
        if (keep) {
          chunks.push(chunk);
        }
        return;
      }
      resolve(undefined);
      if (size > MAX_BODY_BYTES + DRAIN_BYTES) {
        request.destroy();
      }
    });
    request.on("end", () => {
      resolve(size > MAX_BODY_BYTES ? undefined : Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
    // After `end` this changes nothing; before it, the client went away while sending.
    request.on("close", () => {
      reject(new Error("The connection closed before the request body ended"));
    });
  });

/** JSON of the body; an empty body is `{}` (commands without input). */
const parseBody = (text: string): unknown => {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  if (trimmed === "") {
    return {};
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new CommandError("input.invalid", "The request body is not valid JSON", undefined, {
      cause: error,
    });
  }
};

/** Equal in constant time, so the token cannot be guessed byte by byte. */
const sameSecret = (given: string, expected: Buffer): boolean => {
  const bytes = Buffer.from(given, "utf8");
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
};

/** The token of an `Authorization: Bearer <token>` header; the scheme is case-insensitive (RFC 9110). */
const bearerToken = (header: string | undefined): string =>
  /^bearer +(\S+) *$/i.exec(header ?? "")?.[1] ?? "";

/** The Host header names loopback and the local port of the connection (DNS rebinding protection). */
const loopbackHost = (request: IncomingMessage): boolean => {
  const host = request.headers.host?.toLowerCase();
  const port = String(request.socket.localPort);
  return LOOPBACK_NAMES.some((name) => host === `${name}:${port}`);
};

const commandName = (pathname: string): string | undefined => {
  try {
    return decodeURIComponent(pathname.slice(COMMANDS_PATH.length + 1));
  } catch {
    return undefined;
  }
};

/** The request handler of one API server. Never throws; every request gets a response. */
export function createRequestHandler(options: HandlerOptions): RequestHandler {
  const token = Buffer.from(options.token, "utf8");

  const run = async (name: string, text: string, response: ServerResponse): Promise<void> => {
    // Aborted when the client goes away before the response is sent, or when the server closes.
    const gone = new AbortController();
    response.once("close", () => {
      if (!response.writableFinished) {
        gone.abort();
      }
    });
    try {
      const input = parseBody(text);
      const signal = AbortSignal.any([gone.signal, options.signal]);
      const output = await options.runtime.invoke(name, input, { workspace: options.workspace, signal });
      send(response, 200, output ?? null);
    } catch (error) {
      sendError(response, error);
    }
  };

  /** What a request asks for: an answer that needs no command, or the name of the command to run. */
  const target = (request: IncomingMessage): Answer | string => {
    if (!loopbackHost(request)) {
      return refusal(403, "The Host header must name the loopback address and port of this API");
    }
    if (request.headers.origin !== undefined) {
      return refusal(403, "Requests from browsers (with an Origin header) are refused");
    }
    if (!sameSecret(bearerToken(request.headers.authorization), token)) {
      return refusal(401, "Missing or wrong token; see api.json in the cache folder", {
        "www-authenticate": "Bearer",
      });
    }
    // A request target that Node accepts but URL does not (e.g. `//[/`) names no endpoint: refused like any
    // other path, after its body (#200).
    const pathname = URL.parse(String(request.url), "http://localhost")?.pathname;
    if (pathname === undefined) {
      return refusal(404, `No endpoint ${String(request.url)}`);
    }
    if (pathname === COMMANDS_PATH) {
      if (request.method !== "GET") {
        return refusal(405, `Use GET ${COMMANDS_PATH}`, { allow: "GET" });
      }
      const commands = options.runtime.contracts.commands.map((entry) => ({
        ...entry,
        implemented: options.runtime.commands.has(entry.name),
      }));
      return { status: 200, body: { commands } };
    }
    const name = pathname.startsWith(`${COMMANDS_PATH}/`) ? commandName(pathname) : undefined;
    if (name === undefined) {
      return refusal(404, `No endpoint ${pathname}`);
    }
    if (request.method !== "POST") {
      return refusal(405, `Use POST ${COMMANDS_PATH}/<name>`, { allow: "POST" });
    }
    return name;
  };

  /**
   * Every answer comes after the body is read, also one that does not need the body (#200). Node's docs ask
   * for an unread body to be read or the socket destroyed; Node itself drops one after the response, but
   * without any bound. So it is read here, with the bound of a command's body, and the connection stays
   * usable for the next request of a keep-alive client.
   */
  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const goal = target(request);
    // Listened for before the body is read, so that its end is never missed.
    const ended = new Promise<void>((resolve) => request.once("end", resolve));
    const text = await readBody(request, typeof goal === "string");
    if (text === undefined) {
      // Answered at once; readBody drops the rest of the body, and cuts the connection after DRAIN_BYTES.
      answerAndClose(response, typeof goal === "string" ? TOO_LARGE : goal, ended);
      return;
    }
    if (typeof goal === "string") {
      await run(goal, text, response);
      return;
    }
    send(response, goal.status, goal.body, goal.headers);
  };

  return (request, response) => {
    route(request, response).catch((error: unknown) => {
      sendError(response, error);
    });
  };
}
