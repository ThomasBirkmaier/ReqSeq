// The HTTP side of the local API (ADR-0009): checks Host, Origin and token, then translates a request into
// one `invoke` call and its result or error into a response. No command is named here; routes come from
// the catalog names (ADR-0002 rule 3), and the output is sent as core returns it (SR-080 AK2).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CommandRuntime, Workspace } from "@reqseq/core";
import type { CatalogEntry } from "@reqseq/core";
import { jsonLines } from "@reqseq/core";
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
  sendChunks,
  sendError,
} from "./http-parts.js";
import { loopbackHost } from "./loopback.js";

export { DRAIN_BYTES, HTTP_STATUS_BY_CLASS, MAX_BODY_BYTES } from "./http-parts.js";

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
      await sendError(response, error, options.workspace);
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
    // other path, after its body (ThomasBirkmaier/ReqSeq-archive#200).
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
   * Every answer comes after the body is read, also one that does not need the body (ThomasBirkmaier/ReqSeq-archive#200). Node's docs ask
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
    route(request, response).catch((error: unknown) => sendError(response, error, options.workspace));
  };
}
