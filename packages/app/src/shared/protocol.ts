// The messages between the three processes of the app (ADR-0010): the renderer (through the preload
// bridge), the main process and the core process. They carry only catalog calls and their results, so
// the app gives what CLI, API and MCP give (ADR-0002, SR-080). The renderer reaches the core process
// over a MessagePort that the main process hands over; the main process talks to the core process over
// the utility process's parent port.
import type { ActivityAccess, CatalogEntry, CommandErrorObject } from "@logreq/core";

/** Main to preload: the workspace of the window, with the port to its core process when one is open. */
export const WORKSPACE_CHANNEL = "logreq:workspace";

/**
 * Renderer to main: the text to put on the system clipboard (SR-128); `ipcMain.handle` answers `true`
 * when the text was copied, else `false`. One of the three channels from the renderer to the main
 * process, each with the sender check of `main/sender.ts`.
 */
export const COPY_CHANNEL = "logreq:copy";

/**
 * Renderer to main: the workspaces opened last (SR-131), answered with `RecentWorkspaceEntry[]`. Main
 * reads them, because without an open workspace there is no core process and no port.
 */
export const RECENT_WORKSPACES_CHANNEL = "logreq:recent-workspaces";

/**
 * Renderer to main: open this root of the list of recent workspaces in the window (SR-131), answered
 * with `OpenWorkspaceResult`. Switching the workspace of the window is main's job (ADR-0010).
 */
export const OPEN_WORKSPACE_CHANNEL = "logreq:open-workspace";

/** The longest root the main process accepts from the renderer, in characters. */
export const MAX_ROOT_LENGTH = 4096;

/** A workspace of the list: `open` in this window, `found`, or `missing` (no workspace there, SR-131 AK4). */
export type RecentWorkspaceStatus = "open" | "found" | "missing";

/** One entry of the list of recent workspaces, the most recent first. */
export interface RecentWorkspaceEntry {
  readonly root: string;
  readonly state: RecentWorkspaceStatus;
}

/**
 * What opening a recent workspace gave: opened, or not because its root holds no workspace any more
 * (`missing`, the open workspace stays) or the request was refused (not a root of the list).
 */
export type OpenWorkspaceResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "missing" | "refused" };

/** The longest text the main process copies, in characters (16 Mi). */
export const MAX_COPY_LENGTH = 16 * 1024 * 1024;

/** Why the workspace of the window changed (`window.logreq.on("workspace-changed", ...)`). */
export type WorkspaceChangeReason =
  /** Another workspace was opened (File > Open Workspace, "Open workspace"). */
  | "opened"
  /** The core process stopped unexpectedly and was started again on the same workspace. */
  | "restarted"
  /** The core process stopped again and again; it is not started again. */
  | "stopped"
  /** A write command of this window changed files. */
  | "written"
  /**
   * Files changed outside the app (CLI, API, MCP, another editor, Git): a batch of core's watcher
   * (`watchWorkspace(...).onChange`, #331), with its `scope` and `elements` (SR-116, SR-106).
   */
  | "external";

/** The elements a change from outside names by UUID, as core's watcher gives them (`ChangedElements`). */
export interface ChangedElements {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

/** What a change from outside reached: elements only, the metamodel, or the whole workspace. */
export type ChangeScope = "elements" | "metamodel" | "workspace";

export interface WorkspaceChange {
  readonly reason: WorkspaceChangeReason;
  /** `external` only: what the batch reached (core's `WorkspaceChange.scope`). */
  readonly scope?: ChangeScope;
  /** `external` only: the elements the batch names, at most `MAX_CHANGED_IDS` UUIDs in all. */
  readonly elements?: ChangedElements;
}

/**
 * The most UUIDs a change from outside names (N-036). A batch with more, such as a pull of a thousand
 * files, is sent as `workspace` with empty lists: every view reads again and nothing is highlighted.
 */
export const MAX_CHANGED_IDS = 1000;

const NONE: ChangedElements = { added: [], changed: [], removed: [] };

/** A batch of core's watcher as the event the windows get, with the UUIDs capped (`MAX_CHANGED_IDS`). */
export const externalChange = (change: {
  readonly scope: ChangeScope;
  readonly elements: ChangedElements;
}): WorkspaceChange => {
  const { added, changed, removed } = change.elements;
  return added.length + changed.length + removed.length > MAX_CHANGED_IDS
    ? { reason: "external", scope: "workspace", elements: NONE }
    : { reason: "external", scope: change.scope, elements: { added, changed, removed } };
};
/**
 * An element an agent read or changed through the API or the MCP server of this copy (SR-117): the
 * access as `workspace.activity` gives it (`schemas/activity.schema.json#/$defs/access`), no content.
 */
export type AgentActivity = ActivityAccess;

/**
 * The events the core process and the main process send a window, by name, with what the listeners of
 * `window.logreq.on(name, ...)` get. One channel for every event: a new one is one entry here and one
 * check in `EVENT_DATA`, and the bridge keeps its six functions (ADR-0010).
 */
export interface BridgeEvents {
  /** The workspace of the window changed (`WorkspaceChangeReason`). */
  readonly "workspace-changed": WorkspaceChange;
  /** An agent read or changed an element through the API or MCP (SR-117); sent as it arrives. */
  readonly "agent-activity": AgentActivity;
}

export type BridgeEvent = keyof BridgeEvents;

/** An event on the port: its name and what its listeners get. */
export type PortEvent = {
  readonly [E in BridgeEvent]: { readonly event: E; readonly data: BridgeEvents[E] };
}[BridgeEvent];

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
  /**
   * Calls `listener` with each `event` (`BridgeEvents`): `workspace-changed` whenever the workspace
   * changed, `agent-activity` whenever an agent read or changed an element through the API or MCP
   * (SR-117). Returns the function that unsubscribes it; any other name subscribes nothing.
   */
  on<E extends BridgeEvent>(event: E, listener: (data: BridgeEvents[E]) => void): () => void;
  /**
   * Puts `text` on the system clipboard (SR-128); resolves `false` when it could not, never rejects. A
   * facility of the window like the theme, so it is no catalog command (CLI, API and MCP give the values
   * with `element get`).
   */
  copyText(text: string): Promise<boolean>;
  /**
   * The workspaces opened last, the most recent first, each `open`, `found` or `missing` (SR-131); an
   * empty list when there are none or they cannot be read, never rejects. From the main process, since
   * no core process runs while no workspace is open.
   */
  recentWorkspaces(): Promise<readonly RecentWorkspaceEntry[]>;
  /**
   * Opens `root`, a root of `recentWorkspaces()`, in this window in place of the open workspace (SR-131
   * AK2); never rejects. The window learns it as `workspace-changed` with `opened`.
   */
  openWorkspace(root: string): Promise<OpenWorkspaceResult>;
}

/** Renderer to core process, over the port. */
export type PortRequest =
  | { readonly id: number; readonly kind: "invoke"; readonly name: string; readonly input: unknown }
  | { readonly id: number; readonly kind: "commands" };

/** Core process to renderer, over the port: the answer to request `id`, or an event. */
export type PortMessage =
  | { readonly id: number; readonly result: InvokeResult }
  | { readonly id: number; readonly commands: readonly CommandListing[] }
  | PortEvent;

/**
 * Main to core process, over the parent port. `open` comes first and once; `connect` carries the port
 * of one window; `stop` closes the workspace and ends the process. An `exact` open (a root of the list of
 * recent workspaces) opens the folder itself as the root and fails when it holds no workspace file;
 * otherwise the root is found upwards (File > Open Workspace, `--workspace`).
 */
export type CoreRequest =
  | { readonly type: "open"; readonly folder: string; readonly exact?: boolean }
  | { readonly type: "connect" }
  | { readonly type: "file"; readonly id: number; readonly url: string }
  | { readonly type: "stop" };

/** A file of the workspace for the `logreq-file:` protocol, or why there is none. */
export type FileAnswer =
  | { readonly status: 200; readonly mimeType: string; readonly data: Uint8Array<ArrayBuffer> }
  | { readonly status: 404 };

/** Core process to main, over the parent port. */
export type CoreMessage =
  /** The workspace is open: its root, and its key in the list of recent workspaces (`workspaceKey`). */
  | { readonly type: "ready"; readonly root: string; readonly key: string }
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
      return typeof value["folder"] === "string"
        ? { type: "open", folder: value["folder"], ...(value["exact"] === true ? { exact: true } : {}) }
        : undefined;
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
    return typeof value["root"] === "string" && typeof value["key"] === "string"
      ? { type: "ready", root: value["root"], key: value["key"] }
      : undefined;
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

const REASONS: readonly unknown[] = [
  "opened",
  "restarted",
  "stopped",
  "written",
  "external",
] satisfies readonly WorkspaceChangeReason[];

const SCOPES: readonly unknown[] = ["elements", "metamodel", "workspace"] satisfies readonly ChangeScope[];

const isIds = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((id) => typeof id === "string");

/** The lists of a change from outside, rebuilt from the three fields; undefined when one is no list of strings or there are too many. */
const changedElements = (value: unknown): ChangedElements | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const { added, changed, removed } = value;
  return isIds(added) &&
    isIds(changed) &&
    isIds(removed) &&
    added.length + changed.length + removed.length <= MAX_CHANGED_IDS
    ? { added, changed, removed }
    : undefined;
};

/** `value` as the data of `workspace-changed`, with only its fields; undefined when it is none. */
const workspaceChange = (value: unknown): WorkspaceChange | undefined => {
  if (!isRecord(value) || !REASONS.includes(value["reason"])) {
    return undefined;
  }
  const reason = value["reason"] as WorkspaceChangeReason;
  if (reason !== "external") {
    return { reason };
  }
  const elements = changedElements(value["elements"]);
  return SCOPES.includes(value["scope"]) && elements !== undefined
    ? { reason, scope: value["scope"] as ChangeScope, elements }
    : undefined;
};

// The checks of `schemas/activity.schema.json#/$defs/access`, kept here because the preload and the
// renderer bundle no part of core.
const ACCESSES: readonly unknown[] = [
  "cli",
  "api",
  "mcp",
  "app",
] satisfies readonly AgentActivity["access"][];
const EFFECTS: readonly unknown[] = ["read", "write-files"] satisfies readonly AgentActivity["effect"][];
const COMMAND = /^[a-z]+\.[a-z][A-Za-z]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** An RFC 3339 date and time (`common.schema.json#/$defs/dateTime`). */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

const isText = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);

/** `value` as an agent's access, with only the fields of the schema; undefined when it is none. */
const agentActivity = (value: unknown): AgentActivity | undefined => {
  if (!isRecord(value) || !isRecord(value["element"])) {
    return undefined;
  }
  const { access, command, effect, at } = value;
  const { id, repository } = value["element"];
  return ACCESSES.includes(access) &&
    isText(command, COMMAND) &&
    EFFECTS.includes(effect) &&
    isText(at, DATE_TIME) &&
    isText(id, UUID) &&
    typeof repository === "string" &&
    repository !== ""
    ? {
        access: access as AgentActivity["access"],
        command,
        effect: effect as AgentActivity["effect"],
        at,
        element: { id, repository },
      }
    : undefined;
};

/** What each event carries, checked; a new event needs its entry here. */
const EVENT_DATA: { readonly [E in BridgeEvent]: (value: unknown) => BridgeEvents[E] | undefined } = {
  "workspace-changed": workspaceChange,
  "agent-activity": agentActivity,
};

/** The names of the bridge's events, in the order of `EVENT_DATA`. */
export const BRIDGE_EVENTS = Object.keys(EVENT_DATA) as readonly BridgeEvent[];

/** Whether `name` is an event of the bridge (the renderer is not trusted to keep to the types). */
export const isBridgeEvent = (name: unknown): name is BridgeEvent =>
  typeof name === "string" && Object.hasOwn(EVENT_DATA, name);

/** `value` as a message from the core process on the port, or undefined. */
export const portMessage = (value: unknown): PortMessage | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["event"] !== undefined) {
    const event = value["event"];
    const data = isBridgeEvent(event) ? EVENT_DATA[event](value["data"]) : undefined;
    return data === undefined ? undefined : ({ event, data } as PortEvent);
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

const STATUSES: readonly unknown[] = ["open", "found", "missing"] satisfies readonly RecentWorkspaceStatus[];

/** `value` as main's list of recent workspaces, with only their fields; anything else is the empty list. */
export const recentWorkspaceEntries = (value: unknown): readonly RecentWorkspaceEntry[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const entries: readonly unknown[] = value;
  return entries.every(
    (entry) => isRecord(entry) && typeof entry["root"] === "string" && STATUSES.includes(entry["state"]),
  )
    ? (entries as readonly RecentWorkspaceEntry[]).map(({ root, state }) => ({ root, state }))
    : [];
};

/** `value` as main's answer to an open; anything else is a refusal. */
export const openWorkspaceResult = (value: unknown): OpenWorkspaceResult => {
  if (isRecord(value) && value["ok"] === true) {
    return { ok: true };
  }
  return isRecord(value) && value["ok"] === false && value["reason"] === "missing"
    ? { ok: false, reason: "missing" }
    : { ok: false, reason: "refused" };
};
