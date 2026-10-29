// The HTTP side of the local API (ADR-0009): checks Host, Origin and token, then translates a request into
// one `invoke` call and its result or error into a response. No command is named here; routes come from
// the catalog names (ADR-0002 rule 3), and the output is sent as core returns it (SR-080 AK2).
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CommandErrorClass, CommandErrorObject, CommandRuntime, Workspace } from "@logreq/core";
import type { CatalogEntry } from "@logreq/core";
import { CommandError, errorClass, jsonChunks, jsonLines } from "@logreq/core";

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

/** Compact JSON of `body` and a line break, in chunks of about 1 MB (`jsonChunks` of core). */
function* bodyChunks(body: unknown): Generator<string, void, undefined> {
  yield* jsonChunks(body, { indent: 0 });
  yield "\n";
}

/** Whether nobody reads the answer any more: the client went away, or it was ended or cut. */
const gone = (response: ServerResponse): boolean => response.destroyed || response.writableEnded;

/**
 * Resolves when `response` takes more after a write returned false, or at once when it is gone or
 * when it closes or fails meanwhile; its listeners are removed either way. (`writable` stays true on a
 * destroyed response, so it cannot tell.)
 */
const drained = (response: ServerResponse): Promise<void> =>
  new Promise((resolve) => {
    if (gone(response)) {
      resolve();
      return;
    }
    const done = (): void => {
      response.off("drain", done);
      response.off("close", done);
      response.off("error", done);
      resolve();
    };
    response.on("drain", done);
    response.on("close", done);
    response.on("error", done);
  });

/**
 * Sends `body` as compact JSON and a line break, chunk by chunk (about 1 MB each, #277) with
 * back-pressure, and stops when the client goes away. Node sends such an answer with chunked transfer
 * encoding, as it did the whole text before. The first chunk (the whole of a small answer) is
 * serialised before the headers, so a failure there still gets the error response; a failure later
 * can only cut the connection.
 */
const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<void> => sendChunks(response, status, bodyChunks(body), headers);

/** `send` for any text in chunks: JSON, or JSON Lines with their own content type (#319). */
const sendChunks = async (
  response: ServerResponse,
  status: number,
  chunks: Iterator<string, void>,
  headers: Readonly<Record<string, string>>,
): Promise<void> => {
  const first = chunks.next();
  if (response.destroyed) {
    // The client has gone away; nobody reads the answer.
    return;
  }
  response.writeHead(status, { ...HEADERS, ...headers });
  try {
    for (let next = first; next.done !== true; next = chunks.next()) {
      if (gone(response)) {
        // The client has gone away (or the connection failed): stop serialising.
        return;
      }
      if (!response.write(next.value)) {
        await drained(response);
      }
    }
  } catch (error) {
    response.destroy(error instanceof Error ? error : undefined);
    return;
  }
  response.end();
};

/** The media type of JSON Lines (#319, ADR-0009). */
export const JSON_LINES_TYPE = "application/x-ndjson";

const LINES_HEADERS = { "content-type": `${JSON_LINES_TYPE}; charset=utf-8` } as const;

/** The media ranges of an `Accept` header with their weight (RFC 9110 12.5.1); a broken `q` counts as 1. */
const mediaRanges = (accept: string): Map<string, number> => {
  const ranges = new Map<string, number>();
  for (const part of accept.split(",")) {
    const [range = "", ...params] = part.split(";").map((p) => p.trim().toLowerCase());
    const q = params.find((p) => p.startsWith("q="))?.slice(2);
    const weight = q === undefined || !/^[01](\.\d{0,3})?$/.test(q) ? 1 : Number(q);
    if (range !== "") {
      ranges.set(range, Math.max(weight, ranges.get(range) ?? 0));
    }
  }
  return ranges;
};

/** Whether `ranges` accept JSON: `application/json` when named, else `application/*` or `*\/*`. */
const acceptsJson = (ranges: ReadonlyMap<string, number>): boolean =>
  (ranges.get("application/json") ?? ranges.get("application/*") ?? ranges.get("*/*") ?? 0) > 0;

/** What a command answers with: its output as JSON, or as JSON Lines by the catalog's `jsonLines`. */
type Form =
  | { readonly kind: "json" }
  | { readonly kind: "lines"; readonly spec: NonNullable<CatalogEntry["jsonLines"]> };

const JSON_FORM: Form = { kind: "json" };

/** A command to run, and the form of its answer. */
interface Run {
  readonly run: true;
  readonly name: string;
  readonly form: Form;
}

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

const sendError = (response: ServerResponse, error: unknown): Promise<void> => {
  const commandError =
    error instanceof CommandError ? error : new CommandError("internal", "Internal error in the local API");
  return send(response, HTTP_STATUS_BY_CLASS[errorClass(commandError.code)], commandError.toJSON());
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

  const run = async (goal: Run, text: string, response: ServerResponse): Promise<void> => {
    const { name, form } = goal;
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
      const output = await options.runtime.invoke(name, input, {
        workspace: options.workspace,
        signal,
        access: "api",
      });
      // Inside the try: a serialiser failure before the headers is answered as an error.
      await (form.kind === "lines"
        ? sendChunks(response, 200, jsonLines(output, form.spec), LINES_HEADERS)
        : send(response, 200, output ?? null));
    } catch (error) {
      await sendError(response, error);
    }
  };

  /**
   * The form of a command's answer (#319): only an `Accept` that names JSON Lines with q > 0 is
   * negotiated. A command with `jsonLines` then answers with lines; another one with JSON when JSON is
   * acceptable too, else 406. Any other request is answered with JSON as before, whatever `Accept` says,
   * and an unknown command is left to `invoke`.
   */
  const formOf = (request: IncomingMessage, name: string): Form | Answer => {
    const ranges = mediaRanges(request.headers.accept ?? "");
    const entry = options.runtime.contracts.entry(name);
    if ((ranges.get(JSON_LINES_TYPE) ?? 0) === 0 || entry === undefined) {
      return JSON_FORM;
    }
    if (entry.jsonLines !== undefined) {
      return { kind: "lines", spec: entry.jsonLines };
    }
    return acceptsJson(ranges)
      ? JSON_FORM
      : refusal(406, `${name} answers only with application/json, not with ${JSON_LINES_TYPE}`);
  };

  /** What a request asks for: an answer that needs no command, or the command to run and its form. */
  const target = (request: IncomingMessage): Answer | Run => {
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
    const form = formOf(request, name);
    return "kind" in form ? { run: true, name, form } : form;
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
    const text = await readBody(request, "run" in goal);
    if (text === undefined) {
      // Answered at once; readBody drops the rest of the body, and cuts the connection after DRAIN_BYTES.
      answerAndClose(response, "run" in goal ? TOO_LARGE : goal, ended);
      return;
    }
    if ("run" in goal) {
      await run(goal, text, response);
      return;
    }
    await send(response, goal.status, goal.body, goal.headers);
  };

  return (request, response) => {
    route(request, response).catch((error: unknown) => sendError(response, error));
  };
}
