// The HTTP parts the local API (`handler.ts`, ADR-0009) and the UI server (`ui-server.ts`, ADR-0020) share:
// the status codes by error class and the error body, the body limits, JSON answers in chunks, and the
// token comparison and the parsing of the bearer header.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CommandErrorClass, CommandErrorObject, Workspace } from "@reqseq/core";
import { CommandError, errorClass, internalError, jsonChunks } from "@reqseq/core";

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

/** The headers of every JSON answer. */
export const JSON_HEADERS = {
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
export const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<void> => sendChunks(response, status, bodyChunks(body), headers);

/** `send` for any text in chunks: JSON, or JSON Lines with their own content type (#319). */
export const sendChunks = async (
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
  response.writeHead(status, { ...JSON_HEADERS, ...headers });
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

/** An answer that needs no command: a refusal, or the catalog listing. */
export interface Answer {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A refusal before any command runs: always the error object of an `input.invalid`. */
export const refusal = (
  status: number,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): Answer => ({
  status,
  body: { code: "input.invalid", message } satisfies CommandErrorObject,
  headers,
});

export const TOO_LARGE = refusal(413, `The request body is larger than ${String(MAX_BODY_BYTES)} bytes`);

/**
 * The answer to a request whose body is over MAX_BODY_BYTES, with `connection: close`: the connection is cut
 * after DRAIN_BYTES, so a keep-alive client must not send its next request on it. The whole answer is
 * written at once, but the response ends only when the body has ended: Node closes the connection of a
 * `connection: close` response as soon as it ends, and closing it while the client still sends resets it
 * (see DRAIN_BYTES). `ended` settles when the body has ended; it never does when the connection is cut first.
 */
export const answerAndClose = (response: ServerResponse, answer: Answer, ended: Promise<void>): void => {
  const text = `${JSON.stringify(answer.body)}\n`;
  response.writeHead(answer.status, {
    ...JSON_HEADERS,
    ...answer.headers,
    connection: "close",
    "content-length": String(Buffer.byteLength(text)),
  });
  response.write(text);
  void ended.then(() => response.end());
};

/** The error object of `error` with the status of its class; any other failure is `internal`. */
export const sendError = (
  response: ServerResponse,
  error: unknown,
  workspace: Workspace,
  headers: Readonly<Record<string, string>> = {},
): Promise<void> => {
  const commandError =
    error instanceof CommandError
      ? error
      : internalError("Internal error in the local API", error, { workspace });
  return send(response, HTTP_STATUS_BY_CLASS[errorClass(commandError.code)], commandError.toJSON(), headers);
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
export const readBody = (request: IncomingMessage, keep: boolean): Promise<string | undefined> =>
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
export const parseBody = (text: string): unknown => {
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
export const sameSecret = (given: string, expected: Buffer): boolean => {
  const bytes = Buffer.from(given, "utf8");
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
};

/** The token of an `Authorization: Bearer <token>` header; the scheme is case-insensitive (RFC 9110). */
export const bearerToken = (header: string | undefined): string =>
  /^bearer +(\S+) *$/i.exec(header ?? "")?.[1] ?? "";
