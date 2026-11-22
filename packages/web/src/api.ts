// Calls catalog commands through the UI server (ADR-0020, Requests): `POST api/<command>` with the JSON input,
// the token as a bearer header and the generation of the open workspace in `X-ReqSeq-Workspace`. Every answer is
// ReqSeq's own; nothing is computed here.
import type { CommandTypes } from "@reqseq/core";

export type CommandName = keyof CommandTypes;
/** The input of a command as a page passes it: the fields with a default may be left out. */
export type InputOf<K extends CommandName> = Partial<CommandTypes[K]["input"]>;
export type OutputOf<K extends CommandName> = CommandTypes[K]["output"];

/** A refusal of ReqSeq or of the server, with the error body of ADR-0009. */
export class ReqSeqError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly command: string;

  constructor(
    status: number,
    body: { code?: unknown; message?: unknown; details?: unknown },
    command: string,
  ) {
    super(typeof body.message === "string" ? body.message : `ReqSeq answered ${String(status)}`);
    this.status = status;
    this.code = typeof body.code === "string" ? body.code : "unknown";
    this.details = body.details;
    this.command = command;
  }
}

/** Raised on the window when the server refused the token (401) or the workspace was switched (409). */
export const TOKEN_REFUSED = "reqseq:token-refused";
export const WORKSPACE_CHANGED = "reqseq:workspace-changed";

let token = "";
let generation: number | undefined;
let resolveKnown: (() => void) | undefined;
// Commands wait until the generation of the open workspace is known: the first `workspace` event gives it.
const known = new Promise<void>((resolve) => {
  resolveKnown = resolve;
});

/** The token every request carries. */
export function useToken(value: string): void {
  token = value;
}

/** The generation of the open workspace, from a `workspace` event. */
export function setGeneration(value: number): void {
  generation = value;
  resolveKnown?.();
}

const parse = (text: string): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return { message: text };
  }
};

/** Runs the catalog command `name` with `input` and resolves with its output. */
export async function call<K extends CommandName>(name: K, input: InputOf<K> = {}): Promise<OutputOf<K>> {
  await known;
  let response: Response;
  try {
    response = await fetch(`api/${name}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-reqseq-workspace": String(generation ?? 0),
      },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch {
    throw new ReqSeqError(
      0,
      { code: "ui.offline", message: "The server of this page does not answer." },
      name,
    );
  }
  const body = parse(await response.text());
  if (!response.ok) {
    const error = new ReqSeqError(response.status, body, name);
    if (response.status === 401) {
      window.dispatchEvent(new Event(TOKEN_REFUSED));
    } else if (error.code === "workspace.changed") {
      window.dispatchEvent(new Event(WORKSPACE_CHANGED));
    }
    throw error;
  }
  return body as OutputOf<K>;
}

/** Opens or switches the workspace of the server (`POST ui/workspace`); the answer gives its generation. */
export async function openWorkspace(
  path: string,
): Promise<{ readonly generation: number; readonly root: string }> {
  await known;
  let response: Response;
  try {
    response = await fetch("ui/workspace", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ path }),
      cache: "no-store",
    });
  } catch {
    throw new ReqSeqError(
      0,
      { code: "ui.offline", message: "The server of this page does not answer." },
      "open",
    );
  }
  const body = parse(await response.text());
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(TOKEN_REFUSED));
    }
    throw new ReqSeqError(response.status, body, "open");
  }
  const opened = body as { generation: number; root: string };
  setGeneration(opened.generation);
  return opened;
}

/** Plain words for the errors people meet, and ReqSeq's own text under "Details". */
export interface Explained {
  readonly what: string;
  readonly todo: string;
  readonly detail: string;
}

const PLAIN: Readonly<Record<string, readonly [string, string]>> = {
  "ref.unknown": ["There is no element with that ID.", "Check the ID, or open the element from a list."],
  "ref.ambiguous": ["More than one element matches that ID.", "Open the element from a list."],
  "ui.offline": [
    "The server of this page does not answer.",
    "Start reqseq ui again and open the address it prints.",
  ],
  "workspace.not-found": ["No workspace is open.", "Open or create one under Workspaces."],
  "workspace.changed": ["Another workspace was opened.", "The page now shows the workspace that is open."],
  "ui.no-workspace-here": [
    "There is no workspace in this folder.",
    "Name the folder that holds reqseq-workspace.yaml, or create a workspace there.",
  ],
  "file.folder-missing": [
    "The folder to write into does not exist.",
    "Create it, or name a folder that exists.",
  ],
  "server.stopping": ["reqseq ui is stopping.", "Start it again and open the address it prints."],
};

const detailOf = (error: ReqSeqError): string =>
  [error.code, error.message, error.details === undefined ? "" : JSON.stringify(error.details, null, 2)]
    .filter((part) => part !== "")
    .join("\n");

/** What went wrong, in plain words. */
export function explain(error: unknown): Explained {
  if (!(error instanceof ReqSeqError)) {
    return {
      what: "Something went wrong on this page.",
      todo: "Reload the page and try again.",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const plain = PLAIN[error.code];
  if (plain !== undefined) {
    return { what: plain[0], todo: plain[1], detail: detailOf(error) };
  }
  return {
    what: "ReqSeq could not answer this.",
    todo: error.message.replace(/\.?$/, "."),
    detail: detailOf(error),
  };
}
