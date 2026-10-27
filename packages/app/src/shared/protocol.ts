// The messages between the three processes of the app (ADR-0010): the renderer (through the preload
// bridge), the main process and the core process. They carry only catalog calls and their results, so
// the app gives what CLI, API and MCP give (ADR-0002, SR-080). The renderer reaches the core process
// over a MessagePort that the main process hands over; the main process talks to the core process over
// the utility process's parent port.
import type { CatalogEntry, CommandErrorObject } from "@logreq/core";

/** Main to preload: the workspace of the window, with the port to its core process when one is open. */
export const WORKSPACE_CHANNEL = "logreq:workspace";

/**
 * Renderer to main: the text to put on the system clipboard (SR-128). The one channel from the renderer
 * to the main process; `ipcMain.handle` answers `true` when the text was copied, else `false`.
 */
export const COPY_CHANNEL = "logreq:copy";

/** The longest text the main process copies, in characters (16 Mi). */
export const MAX_COPY_LENGTH = 16 * 1024 * 1024;

/** Why the workspace of the window changed (`window.logreq.on("workspace-changed", ...)`). */
export type WorkspaceChangeReason =
  /** Another workspace was opened (File > Open Workspace). */
  | "opened"
  /** The core process stopped unexpectedly and was started again on the same workspace. */
  | "restarted"
  /** The core process stopped again and again; it is not started again. */
  | "stopped"
  /** A write command of this window changed files. */
  | "written";

export interface WorkspaceChange {
  readonly reason: WorkspaceChangeReason;
}

/** The body of a WORKSPACE_CHANNEL message; with `open`, the message carries the port. */
export interface WorkspaceMessage {
  readonly open: boolean;
  /** Absent on the first message after a page load. */
  readonly reason?: WorkspaceChangeReason;
}

/** A catalog entry as the bridge lists it, as `GET /v1/commands` of the API does (ADR-0009). */
export type CommandListing = CatalogEntry & { readonly implemented: boolean };

/** What `window.logreq.invoke` resolves to: the command output, or the error object of every access. */
export type InvokeResult =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly error: CommandErrorObject };

/**
 * `window.logreq` (preload, `contextBridge`). Generic over the catalog like the CLI, API and MCP
 * adapters: no command has a function of its own, and nothing else reaches the core (SR-099: the
 * catalog offers no delete).
 */
export interface LogReqBridge {
  /** Runs a catalog command in the core process; never rejects. */
  invoke(name: string, input?: unknown): Promise<InvokeResult>;
  /** Every catalog command, for the command palette (SR-073 AK2). */
  commands(): Promise<readonly CommandListing[]>;
  /** Calls `listener` whenever the workspace changed; returns the function that unsubscribes it. */
  on(event: "workspace-changed", listener: (change: WorkspaceChange) => void): () => void;
  /**
   * Puts `text` on the system clipboard (SR-128); resolves `false` when it could not, never rejects. A
   * facility of the window like the theme, so it is no catalog command (CLI, API and MCP give the values
   * with `element get`).
   */
  copyText(text: string): Promise<boolean>;
}

/** Renderer to core process, over the port. */
export type PortRequest =
  | { readonly id: number; readonly kind: "invoke"; readonly name: string; readonly input: unknown }
  | { readonly id: number; readonly kind: "commands" };

/** Core process to renderer, over the port: the answer to request `id`, or an event. */
export type PortMessage =
  | { readonly id: number; readonly result: InvokeResult }
  | { readonly id: number; readonly commands: readonly CommandListing[] }
  | { readonly event: "workspace-changed"; readonly change: WorkspaceChange };

/**
 * Main to core process, over the parent port. `open` comes first and once; `connect` carries the port
 * of one window; `stop` closes the workspace and ends the process.
 */
export type CoreRequest =
  | { readonly type: "open"; readonly folder: string }
  | { readonly type: "connect" }
  | { readonly type: "file"; readonly id: number; readonly url: string }
  | { readonly type: "stop" };

/** A file of the workspace for the `logreq-file:` protocol, or why there is none. */
export type FileAnswer =
  | { readonly status: 200; readonly mimeType: string; readonly data: Uint8Array<ArrayBuffer> }
  | { readonly status: 404 };

/** Core process to main, over the parent port. */
export type CoreMessage =
  | { readonly type: "ready"; readonly root: string }
  | ({ readonly type: "file"; readonly id: number } & FileAnswer);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/** `value` as a request from the renderer, or undefined when it is none (the renderer is not trusted). */
export const portRequest = (value: unknown): PortRequest | undefined => {
  if (!isRecord(value) || typeof value["id"] !== "number") {
    return undefined;
  }
  const id = value["id"];
  if (value["kind"] === "invoke" && typeof value["name"] === "string") {
    // The input goes to core as it came, as the API passes its body: core's validation decides.
    return { id, kind: "invoke", name: value["name"], input: value["input"] };
  }
  return value["kind"] === "commands" ? { id, kind: "commands" } : undefined;
};

/** `value` as a request from the main process, or undefined. */
export const coreRequest = (value: unknown): CoreRequest | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (value["type"]) {
    case "open":
      return typeof value["folder"] === "string" ? { type: "open", folder: value["folder"] } : undefined;
    case "file":
      return typeof value["id"] === "number" && typeof value["url"] === "string"
        ? { type: "file", id: value["id"], url: value["url"] }
        : undefined;
    case "connect":
    case "stop":
      return { type: value["type"] };
    default:
      return undefined;
  }
};

/** `value` as a message from the core process (trusted, but typed only here), or undefined. */
export const coreMessage = (value: unknown): CoreMessage | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["type"] === "ready") {
    return typeof value["root"] === "string" ? { type: "ready", root: value["root"] } : undefined;
  }
  if (value["type"] !== "file" || typeof value["id"] !== "number") {
    return undefined;
  }
  const id = value["id"];
  return value["status"] === 200 &&
    typeof value["mimeType"] === "string" &&
    value["data"] instanceof Uint8Array
    ? {
        type: "file",
        id,
        status: 200,
        mimeType: value["mimeType"],
        // Structured clone gives a Uint8Array on an ArrayBuffer of its own.
        data: value["data"] as Uint8Array<ArrayBuffer>,
      }
    : { type: "file", id, status: 404 };
};

/** `value` as a message from the core process on the port, or undefined. */
export const portMessage = (value: unknown): PortMessage | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["event"] === "workspace-changed") {
    return isRecord(value["change"])
      ? { event: "workspace-changed", change: value["change"] as unknown as WorkspaceChange }
      : undefined;
  }
  if (typeof value["id"] !== "number") {
    return undefined;
  }
  if (Array.isArray(value["commands"])) {
    return { id: value["id"], commands: value["commands"] as readonly CommandListing[] };
  }
  return isRecord(value["result"])
    ? { id: value["id"], result: value["result"] as unknown as InvokeResult }
    : undefined;
};
