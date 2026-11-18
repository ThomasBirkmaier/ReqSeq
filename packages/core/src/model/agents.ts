// Agent connections of the copy (SR-228): each MCP server process records its connection in its own
// file `agent-<process>.json` in the cache folder of the copy (ADR-0008), and every access reads them
// with `workspace.agents`; the app's status line shows them (#1894). Docs: docs/model-store.md,
// "Agent connections".
//
// One file per process, so that several MCP servers of one copy never share a file or a lock. The
// file is written once when the client is connected (`recordAgentConnection`)
// and once more with `ended` when the connection ends; in between a worker thread renews its
// modification time every `AGENT_BEAT_MS` (agent-beat.ts), so a blocked main thread does not end the
// connection. A connection is live while `ended` is null and the modification time is at most
// `AGENT_LIVE_MS` from now; a crashed process stops counting `AGENT_LIVE_MS` after its last beat.
// Files are written only through `files` (`writeCacheFile`), only into a cache folder outside every
// repository (`usableCacheFolder`), so they never land in a working tree or in Git (D-036). Nothing
// waits for the element store; no socket, pipe or listener is involved (SR-228 AK5, SR-079). All
// failures of recording are silent, as for the activity (model/activity.ts).
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { errorCode } from "../files/index.js";
import type { AgentConnectionFile } from "../generated/types.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { readCacheFile, removeCacheFile, workspaceLayoutState, writeCacheFile } from "../workspace/index.js";
import type { BeatData } from "./agent-beat.js";
import { AGENT_BEAT_WORKER } from "./agent-beat.js";
import { usableCacheFolder } from "./model-cache.js";

/** How often a running MCP server renews its connection file. */
export const AGENT_BEAT_MS = 1000;

/** How long after its last renewal a connection without `ended` still counts as connected. */
export const AGENT_LIVE_MS = 3000;

/** The newest connection files read; older ones are not looked at (and are pruned). */
export const AGENT_MAX_FILES = 64;

/** A larger connection file is not ReqSeq's and is ignored. */
export const AGENT_MAX_BYTES = 4096;

/** The length a client name is cut to, in user-perceived characters (grapheme clusters). */
export const CLIENT_MAX_CHARACTERS = 40;

/** A bound in UTF-16 code units, so that 40 characters of many marks each still fit the file. */
const CLIENT_MAX_UNITS = 400;

/** The names of connection files: `agent-<process>.json`, the `process` form of the file. */
const AGENT_FILE = /^agent-([0-9]+-[0-9a-f]{8})\.json$/;

/** Tabs, line breaks and other white space: each run becomes one space. */
const SPACES = /[\s\p{Zl}\p{Zp}\u0085]+/gu;

/**
 * Control, format and surrogate characters: no text of a name. The joiners (U+200C, U+200D) are
 * format characters that join an emoji or a word, so they stay.
 */
const NOT_TEXT = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Cs}]/gu;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The client name as text (SR-228 AK1): white space runs as one space, control and format characters
 * removed, trimmed, cut to
 * `CLIENT_MAX_CHARACTERS` user-perceived characters (never inside one, and fewer when they hold more
 * than `CLIENT_MAX_UNITS` UTF-16 code units); null when `name` is no string or nothing is left.
 */
export const clientName = (name: unknown): string | null => {
  if (typeof name !== "string") {
    return null;
  }
  let cut = "";
  let characters = 0;
  for (const { segment } of segmenter.segment(
    name.replace(SPACES, " ").replace(NOT_TEXT, "").replace(SPACES, " ").trim(),
  )) {
    if (characters === CLIENT_MAX_CHARACTERS || cut.length + segment.length > CLIENT_MAX_UNITS) {
      break;
    }
    cut += segment;
    characters += 1;
  }
  cut = cut.trim();
  return cut === "" ? null : cut;
};

/** A connection that is live: its client, since when, and until when it counts without a new beat (ms). */
export interface LiveAgent {
  readonly client: string | null;
  readonly since: string;
  readonly until: number;
}

/** A connection that ended: its client and when it was connected last. */
export interface EndedAgent {
  readonly client: string | null;
  readonly at: string;
}

/** The connections of a copy (`agentConnections`). */
export interface AgentConnections {
  /** false when the copy has no usable cache folder or it cannot be read. */
  readonly recorded: boolean;
  /** The live connections, the one connected first first. */
  readonly connected: readonly LiveAgent[];
  /** The connection that ended last, null when none has. */
  readonly last: EndedAgent | null;
}

const UNRECORDED: AgentConnections = { recorded: false, connected: [], last: null };

/** One connection file as read, with its name and modification time. */
interface Found {
  readonly name: string;
  readonly mtimeMs: number;
  readonly file: AgentConnectionFile;
}

let validConnection: ReturnType<typeof fileSchemaValidator> | undefined;

/** The connection file `name` in `folder` (modified at `mtimeMs`) when it is valid and its `process` matches its name. */
const readConnection = async (folder: string, name: string, mtimeMs: number): Promise<Found | undefined> => {
  try {
    const text = await readCacheFile(folder, name, AGENT_MAX_BYTES);
    const data: unknown = text === undefined ? undefined : JSON.parse(text);
    validConnection ??= fileSchemaValidator("agent-connection.schema.json");
    if (!validConnection(data)) {
      return undefined;
    }
    const file = data as AgentConnectionFile;
    return AGENT_FILE.exec(name)?.[1] === file.process ? { name, mtimeMs, file } : undefined;
  } catch {
    // Gone meanwhile, a folder in its place, or no JSON: not a connection.
    return undefined;
  }
};

/** The modification time of `name` in `folder`, -Infinity when it cannot be read. */
const mtimeOf = async (folder: string, name: string): Promise<number> => {
  try {
    return (await fs.stat(path.join(folder, name))).mtimeMs;
  } catch {
    return Number.NEGATIVE_INFINITY;
  }
};

/** What a scan of `folder` found: every connection file name, and the connections of the newest. */
interface Scan {
  readonly names: readonly string[];
  readonly live: readonly Found[];
  readonly last: Found | undefined;
}

const liveAt = (found: Found, now: number): boolean =>
  found.file.ended === null && Math.abs(now - found.mtimeMs) <= AGENT_LIVE_MS;

const endOf = (found: Found): string => found.file.ended ?? new Date(found.mtimeMs).toISOString();

/** Scans `folder`; undefined when it cannot be read, no names when it does not exist. */
const scan = async (folder: string, now: number): Promise<Scan | undefined> => {
  let names: string[];
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    names = entries.filter((e) => e.isFile() && AGENT_FILE.test(e.name)).map((e) => e.name);
  } catch (error) {
    return errorCode(error) === "ENOENT" ? { names: [], live: [], last: undefined } : undefined;
  }
  const times = await Promise.all(names.map(async (name) => [name, await mtimeOf(folder, name)] as const));
  const newest = times
    .filter(([, mtime]) => mtime !== Number.NEGATIVE_INFINITY)
    .sort(([, a], [, b]) => b - a)
    .slice(0, AGENT_MAX_FILES);
  const found = (
    await Promise.all(newest.map(([name, mtime]) => readConnection(folder, name, mtime)))
  ).filter((f): f is Found => f !== undefined);
  const live = found
    .filter((f) => liveAt(f, now))
    .sort((a, b) => Date.parse(a.file.since) - Date.parse(b.file.since) || a.name.localeCompare(b.name));
  const last = found
    .filter((f) => !liveAt(f, now))
    .reduce<Found | undefined>(
      (latest, f) => (latest === undefined || Date.parse(endOf(f)) > Date.parse(endOf(latest)) ? f : latest),
      undefined,
    );
  return { names, live, last };
};

/**
 * The connections recorded in the cache folder `folder` of a copy at `now` (ms): `recorded: false`
 * when `folder` is undefined (no usable cache folder) or cannot be read; a folder that does not exist
 * holds none. At most the `AGENT_MAX_FILES` newest files are read; broken ones are skipped. Each live
 * connection carries `until`, when it stops counting without a new beat. Never rejects.
 */
export const agentConnections = async (
  folder: string | undefined,
  now: number = Date.now(),
): Promise<AgentConnections> => {
  const found = folder === undefined ? undefined : await scan(folder, now);
  if (found === undefined) {
    return UNRECORDED;
  }
  return {
    recorded: true,
    connected: found.live.map((f) => ({
      client: clientName(f.file.client),
      since: f.file.since,
      until: f.mtimeMs + AGENT_LIVE_MS,
    })),
    last:
      found.last === undefined ? null : { client: clientName(found.last.file.client), at: endOf(found.last) },
  };
};

/** The connections of the copy of `workspace` (`workspace.agents`), from its cache folder only. */
export const connectedAgents = async (workspace: Workspace): Promise<AgentConnections> =>
  agentConnections(usableCacheFolder(workspace, await workspace.get(workspaceLayoutState)));

/** A recorded connection (`recordAgentConnection`). */
export interface AgentRecording {
  /**
   * Ends the connection: stops the beat and writes `ended`. Idempotent; never rejects. Closing the
   * workspace ends it too.
   */
  end(): Promise<void>;
}

export interface AgentRecordingOptions {
  /** Default `AGENT_BEAT_MS`. */
  readonly beatMs?: number;
  /** The worker script of the beat; default `agent-beat-worker.js` (tests pass a broken one). */
  readonly beatEntry?: URL;
  /** Default `AGENT_STOP_MS`. */
  readonly stopMs?: number;
}

const BEAT_ENTRY = new URL("./agent-beat-worker.js", import.meta.url);

/** How long `end()` waits for the beat thread to stop before it terminates it. */
export const AGENT_STOP_MS = 2000;

/**
 * Starts the beat thread of `file`; the returned function stops it and resolves once it has ended,
 * terminating it after `stopMs` (a file call that hangs must not hold the end of the process).
 */
const startBeat = (
  file: string,
  text: string,
  everyMs: number,
  entry: URL,
  stopMs: number,
): (() => Promise<void>) => {
  const data: BeatData = { marker: AGENT_BEAT_WORKER, file, text, everyMs };
  const worker = new Worker(entry, { workerData: data });
  // The beat never keeps the process alive: a process that ends without `end()` is a crash.
  worker.unref();
  const exited = new Promise<void>((resolve) => {
    worker.once("exit", () => {
      resolve();
    });
  });
  // A worker that fails ends with `exit` as well; the connection then stops counting.
  worker.on("error", () => undefined);
  return async () => {
    // Kept alive until it has ended: otherwise a process with nothing else to do would exit first.
    worker.ref();
    worker.postMessage("stop");
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => {
        resolve("late");
      }, stopMs);
    });
    if ((await Promise.race([exited, late])) === "late") {
      await worker.terminate();
    }
    clearTimeout(timer);
  };
};

/** What a recording started with. */
interface Started {
  readonly folder: string;
  readonly name: string;
  readonly file: AgentConnectionFile;
  readonly stop: () => Promise<void>;
  readonly pruned: Promise<void>;
}

/**
 * Removes the connection files of `folder` that do not count any more: all but the live ones, the
 * one that ended last and `own`. The cache is safe to remove (ADR-0008); a live file removed by a
 * race is written again by its own beat. Never rejects.
 */
const prune = async (folder: string, own: string, now: number): Promise<void> => {
  const found = await scan(folder, now);
  if (found === undefined) {
    return;
  }
  const keep = new Set([own, ...found.live.map((f) => f.name), ...(found.last ? [found.last.name] : [])]);
  await Promise.all(
    found.names
      .filter((name) => !keep.has(name))
      .map((name) => removeCacheFile(folder, name).catch(() => undefined)),
  );
};

const fileText = (file: AgentConnectionFile): string => `${JSON.stringify(file)}\n`;

class Recording implements AgentRecording {
  readonly #started: Promise<Started | undefined>;
  #ended: Promise<void> | undefined;

  constructor(workspace: Workspace, client: unknown, options: AgentRecordingOptions) {
    this.#started = this.#start(workspace, client, options);
  }

  async #start(
    workspace: Workspace,
    client: unknown,
    options: AgentRecordingOptions,
  ): Promise<Started | undefined> {
    const since = new Date().toISOString();
    try {
      // The layout only (the workspace file), never the element store (SR-228 AK5).
      const folder = usableCacheFolder(workspace, await workspace.get(workspaceLayoutState));
      if (folder === undefined) {
        return undefined;
      }
      const token = `${String(process.pid)}-${randomBytes(4).toString("hex")}`;
      const name = `agent-${token}.json`;
      const file: AgentConnectionFile = {
        version: 1,
        process: token,
        client: clientName(client),
        since,
        ended: null,
      };
      const text = fileText(file);
      const written = await writeCacheFile(folder, name, text);
      const pruned = prune(folder, name, Date.now());
      let stop = (): Promise<void> => Promise.resolve();
      try {
        stop = startBeat(
          written,
          text,
          options.beatMs ?? AGENT_BEAT_MS,
          options.beatEntry ?? BEAT_ENTRY,
          options.stopMs ?? AGENT_STOP_MS,
        );
      } catch {
        // No thread (a worker script that cannot be started): the file stops counting after
        // AGENT_LIVE_MS, and `end()` still writes `ended`.
      }
      return { folder, name, file, stop, pruned };
    } catch {
      // A closed workspace, a workspace file that cannot be read, a cache folder that cannot be written.
      return undefined;
    }
  }

  end(): Promise<void> {
    this.#ended ??= this.#end();
    return this.#ended;
  }

  async #end(): Promise<void> {
    const started = await this.#started;
    if (started === undefined) {
      return;
    }
    // The beat ends first, so it cannot write the file again without `ended` afterwards.
    await started.stop();
    await started.pruned;
    try {
      await writeCacheFile(
        started.folder,
        started.name,
        fileText({ ...started.file, ended: new Date().toISOString() }),
      );
    } catch {
      // The cache folder cannot be written: the connection stops counting after AGENT_LIVE_MS.
    }
  }
}

const recordingsState = defineWorkspaceState("agent-connections", (): Set<AgentRecording> => new Set(), {
  dispose: async (recordings) => {
    await Promise.all([...recordings].map((r) => r.end()));
  },
});

const NOT_RECORDED: AgentRecording = { end: () => Promise.resolve() };

/**
 * Records a connection of the MCP server whose client gave `client` as its name (SR-228), in the
 * background: the file at once, the beat until `end()` or `workspace.close()`. Only the MCP server
 * calls it, once the client is connected (`LineTransport`). Returns at once and never
 * throws; a closed workspace, or one without a usable cache folder, records nothing (SR-228 AK4).
 */
export const recordAgentConnection = (
  workspace: Workspace,
  client: unknown,
  options: AgentRecordingOptions = {},
): AgentRecording => {
  let recordings: Set<AgentRecording>;
  try {
    recordings = workspace.get(recordingsState);
  } catch {
    return NOT_RECORDED;
  }
  const recording = new Recording(workspace, client, options);
  recordings.add(recording);
  return recording;
};
