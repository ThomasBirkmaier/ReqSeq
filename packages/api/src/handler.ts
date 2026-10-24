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
  internal: 500,
};

/** Largest request body; a larger one gets 413 as soon as it passes the limit (see DRAIN_BYTES). */
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

/** A refusal before any command runs: always the error object of an `input.invalid`. */
const refuse = (
  response: ServerResponse,
  status: number,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): void => {
  const body: CommandErrorObject = { code: "input.invalid", message };
  send(response, status, body, headers);
};

const sendError = (response: ServerResponse, error: unknown): void => {
  const commandError =
    error instanceof CommandError ? error : new CommandError("internal", "Internal error in the local API");
  send(response, HTTP_STATUS_BY_CLASS[errorClass(commandError.code)], commandError.toJSON());
};

/**
 * After a body grows over MAX_BODY_BYTES, at most this many more bytes are read and dropped, then the
 * connection is cut. Reading on for a while lets the 413 reach the client: closing a connection with unread
 * data resets it, and the client may lose the answer.
 */
export const DRAIN_BYTES = MAX_BODY_BYTES;

/**
 * The body as text, or `undefined` as soon as it is larger than MAX_BODY_BYTES. Nothing beyond the limit is
 * kept; the rest is dropped until DRAIN_BYTES more have come, then the connection is cut.
 */
const readBody = (request: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) {
        chunks.push(chunk);
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

  const run = async (name: string, request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const text = await readBody(request);
    if (text === undefined) {
      // Answered at once; readBody drops the rest of the body, and cuts the connection after DRAIN_BYTES.
      refuse(response, 413, `The request body is larger than ${String(MAX_BODY_BYTES)} bytes`);
      return;
    }
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

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!loopbackHost(request)) {
      refuse(response, 403, "The Host header must name the loopback address and port of this API");
      return;
    }
    if (request.headers.origin !== undefined) {
      refuse(response, 403, "Requests from browsers (with an Origin header) are refused");
      return;
    }
    if (!sameSecret(bearerToken(request.headers.authorization), token)) {
      refuse(response, 401, "Missing or wrong token; see api.json in the cache folder", {
        "www-authenticate": "Bearer",
      });
      return;
    }
    const pathname = new URL(String(request.url), "http://localhost").pathname;
    if (pathname === COMMANDS_PATH) {
      if (request.method !== "GET") {
        refuse(response, 405, `Use GET ${COMMANDS_PATH}`, { allow: "GET" });
        return;
      }
      const commands = options.runtime.contracts.commands.map((entry) => ({
        ...entry,
        implemented: options.runtime.commands.has(entry.name),
      }));
      send(response, 200, { commands });
      return;
    }
    const name = pathname.startsWith(`${COMMANDS_PATH}/`) ? commandName(pathname) : undefined;
    if (name === undefined) {
      refuse(response, 404, `No endpoint ${pathname}`);
      return;
    }
    if (request.method !== "POST") {
      refuse(response, 405, `Use POST ${COMMANDS_PATH}/<name>`, { allow: "POST" });
      return;
    }
    await run(name, request, response);
  };

  return (request, response) => {
    route(request, response).catch((error: unknown) => {
      sendError(response, error);
    });
  };
}
