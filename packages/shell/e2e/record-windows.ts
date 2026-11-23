// The recorders of the shell's e2e suite on Windows (ADR-0021, Test seam, A8): process creation with command lines
// (Security event 4688), the files each process creates, opens and writes (the ETW provider Microsoft-Windows-Kernel-File
// through `logman`), the connections the firewall permits (5156) and those its program rules refuse (5157), plus name
// lookups (DNS client event 3006). The system calls are in record-windows.ps1; this module starts them, runs the control and reads the result.
//
// The recording needs an elevated session with the audit set up (the CI step `Shell - recorders (Windows)` does that and
// sets REQSEQ_SHELL_E2E_RECORD=windows). In CI (`CI` set) a missing setup fails the recorded tests; elsewhere they skip.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { SHELL } from "./support.js";

const run = promisify(execFile);
const SCRIPT = path.join(import.meta.dirname, "record-windows.ps1");
const SESSION = "reqseq-shell-e2e";
const GROUP = "reqseq-shell-e2e";
/** The address the network control connects to (TEST-NET-1, RFC 5737). */
export const CONTROL_ADDRESS = "192.0.2.1";
/** The folder of the engine's data (ADR-0021, Engine data), named after the app id of toolchain/packaging/names.json. */
const APP_ID = "io.github.thomasbirkmaier.reqseq";

/** Whether the recorded tests run, skip (local, no setup) or fail (CI, no setup). */
export function recordingMode(): "run" | "skip" | "fail" {
  if (process.env["REQSEQ_SHELL_E2E_RECORD"] === "windows") {
    return "run";
  }
  return (process.env["CI"] ?? "") === "" ? "skip" : "fail";
}

/** Runs one action of record-windows.ps1 and gives what it wrote to its output file. */
async function ps(dir: string, action: string, args: Record<string, string> = {}): Promise<string> {
  const out = path.join(dir, `${action}-${String(Date.now())}.out`);
  const argv = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT];
  argv.push("-Action", action, "-Out", out);
  for (const [name, value] of Object.entries(args)) {
    argv.push(`-${name}`, value);
  }
  try {
    await run("powershell.exe", argv, { maxBuffer: 16 * 1024 * 1024, timeout: 180_000 });
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message: string };
    throw new Error(
      `record-windows.ps1 ${action} failed: ${e.message}\n${e.stdout ?? ""}\n${e.stderr ?? ""}`,
      {
        cause: error,
      },
    );
  }
  // record-windows.ps1 writes UTF-8 without a byte order mark.
  return fs.readFile(out, "utf8").catch(() => "");
}

const asList = <T>(value: T | T[] | null | undefined): T[] =>
  value === null || value === undefined ? [] : Array.isArray(value) ? value : [value];
/** A number as the events give it: decimal or `0x` hexadecimal. */
const numberOf = (text: string | undefined): number => {
  const t = (text ?? "").trim();
  return /^0x/i.test(t) ? Number.parseInt(t, 16) : Number(t);
};

/** An event as record-windows.ps1 exports it: its fields by name, plus `_time`, `_record` and `_pid`. */
type EventRow = Record<string, string | undefined>;

export interface Setup {
  readonly elevated: boolean;
  readonly processCreation: string;
  readonly commandLine: boolean;
  readonly connectionAudit: string;
  readonly dnsLog: boolean;
  readonly profiles:
    | { readonly name: string; readonly enabled: string }
    | readonly { readonly name: string; readonly enabled: string }[];
  readonly engines: string | string[] | null;
}

/** What the setup lacks for the recording. */
function missingSetup(setup: Setup): string[] {
  const profiles = asList(setup.profiles as { name: string; enabled: string }[]);
  return [
    setup.elevated ? "" : "an elevated session",
    setup.processCreation.includes("Success") ? "" : "the audit of process creation (Success)",
    setup.commandLine ? "" : "command lines in process creation events",
    setup.connectionAudit === "Success and Failure"
      ? ""
      : "the audit of Filtering Platform Connection (Success and Failure)",
    setup.dnsLog ? "" : "the DNS client log",
    profiles.length > 0 && profiles.every((p) => p.enabled === "True") ? "" : "every firewall profile on",
    asList(setup.engines).length > 0 ? "" : "an installed WebView2 runtime",
  ].filter((m) => m !== "");
}

/** One process of the shell's tree (4688). */
export interface Started {
  readonly pid: number;
  readonly parent: number;
  /** The program as recorded, and normalized (long path, lower case). */
  readonly program: string;
  readonly normalized: string;
  readonly commandLine: string;
  /** Whether it is the server or one of its descendants. */
  readonly server: boolean;
}

/** One Kernel-File event; `path` is normalized, and undefined when the trace names no file on a drive. */
export interface FileEvent {
  readonly pid: number;
  readonly path: string | undefined;
  readonly raw: string;
  /** A Write (16) event, not a Create or CreateNewFile that may write. */
  readonly write: boolean;
  /** Whether the trace gave no name at all for the write's file object or file key. */
  readonly unnamed: boolean;
}

export interface WindowsRecord {
  readonly shellPid: number;
  readonly serverPid: number | undefined;
  /** Every process of the shell's tree, the shell included. */
  readonly processes: readonly Started[];
  /** Files created or opened (Create, CreateNewFile) and files written (Write, and creates that may write). */
  readonly opens: readonly FileEvent[];
  readonly writes: readonly FileEvent[];
  /** Connections of the tree refused (5157) and permitted (5156), and its name lookups (3006). */
  readonly refused: readonly {
    readonly pid: number;
    readonly application: string;
    readonly address: string;
  }[];
  readonly connections: readonly Connection[];
  readonly lookups: readonly { readonly pid: number; readonly name: string }[];
  /** Completeness: what the trace lost, and how many events it has. */
  readonly lost: {
    readonly buffersLost: number;
    readonly eventsLost: number;
    readonly eventsProcessed: number;
  };
  /** The control as recorded: its process event, its refused connection and its lookup. */
  readonly control: {
    readonly started: boolean;
    readonly refused: readonly { readonly application: string; readonly address: string }[];
    readonly lookedUp: boolean;
  };
  /** The programs the firewall rules refuse, the engine programs on the machine and the engine's data folder. */
  readonly rules: readonly string[];
  readonly engines: readonly string[];
  readonly engineData: string;
  /** Normalizes a path the way the record's paths are. */
  readonly normalize: (p: string) => string;
}

/** A connection the firewall permitted (5156): the local and the remote address, as the event names them. */
export interface Connection {
  readonly pid: number;
  readonly application: string;
  readonly source: string;
  readonly address: string;
  readonly port: number;
}

export interface Created {
  /** The time of the process creation event (UTC, ISO 8601 with 7 decimals). */
  readonly time: string;
  readonly pid: number;
  readonly parent: number;
  readonly program: string;
  readonly commandLine: string;
}

/**
 * The processes of `created` (in record order) that descend from the one at `root`, `root` included, as indexes.
 * Windows reuses process IDs, so a parent is the process that held the parent's ID when the child started, not any
 * process that ever had it.
 */
export function descendants(created: readonly Created[], root: number): Set<number> {
  const holder = new Map<number, number>();
  const tree = new Set<number>();
  created.forEach((p, i) => {
    const parent = holder.get(p.parent);
    if (i === root || (parent !== undefined && tree.has(parent))) {
      tree.add(i);
    }
    holder.set(p.pid, i);
  });
  return tree;
}

/**
 * Whether the process that held `pid` at `time` is one of `tree` (indexes into `created`): the last process created
 * with that ID at or before `time`. An event of a process ID before the tree's process got it is not the tree's.
 */
export function heldByTree(
  created: readonly Created[],
  tree: ReadonlySet<number>,
  pid: number,
  time: string,
): boolean {
  const holder = created.findLastIndex((p) => p.pid === pid && p.time <= time);
  return holder >= 0 && tree.has(holder);
}

export interface FileLine {
  readonly id: number;
  readonly pid: number;
  readonly fileObject: string;
  readonly fileKey: string;
  readonly createOptions: string;
  readonly name: string;
}

export const parseFileLines = (text: string): FileLine[] =>
  text
    .split(/\r?\n/)
    .filter((l) => l !== "")
    .map((l) => {
      const [id, pid, fileObject, fileKey, createOptions, ...name] = l.split("\t");
      return {
        id: Number(id),
        pid: Number(pid),
        fileObject: fileObject ?? "",
        fileKey: fileKey ?? "",
        createOptions: createOptions ?? "",
        name: name.join("\t"),
      };
    });

/** Names a file object after its Create; a Create without a name leaves the write to its file key. */
function nameObject(byObject: Map<string, string>, l: FileLine): void {
  if (l.name === "") {
    byObject.delete(l.fileObject);
  } else {
    byObject.set(l.fileObject, l.name);
  }
}

/**
 * Opens and writes of the tree's processes, from the lines in record order. The kernel reuses file objects and file
 * keys after a close, so a write is named from the names known when it happened: the last Create or CreateNewFile with
 * that file object, else the last NameCreate of its file key. A file object is one kernel object in every process
 * that holds a handle to it, so the Create of another process names it too (the test runner creates the pipes of the
 * shell's standard input and output, which the shell inherits); the lines hold the Creates of every process.
 */
export function fileEvents(
  lines: readonly FileLine[],
  tree: ReadonlySet<number>,
  named: (raw: string) => string | undefined,
): { opens: FileEvent[]; writes: FileEvent[] } {
  const byObject = new Map<string, string>();
  const byKey = new Map<string, string>();
  const opens: FileEvent[] = [];
  const writes: FileEvent[] = [];
  for (const l of lines) {
    if (l.id === 10 && l.name !== "") {
      byKey.set(l.fileKey, l.name);
    } else if (l.id === 12 || l.id === 30) {
      nameObject(byObject, l);
      if (!tree.has(l.pid)) {
        continue;
      }
      const event = { pid: l.pid, path: named(l.name), raw: l.name, write: false, unnamed: false };
      opens.push(event);
      // The disposition (bits 24-31 of the options): anything but FILE_OPEN (1) may create or overwrite.
      if (l.id === 30 || ((numberOf(l.createOptions) >>> 24) & 0xff) !== 1) {
        writes.push(event);
      }
    } else if (l.id === 16 && tree.has(l.pid)) {
      const raw = byObject.get(l.fileObject) ?? byKey.get(l.fileKey);
      writes.push({
        pid: l.pid,
        path: raw === undefined ? undefined : named(raw),
        raw: raw ?? `(FileObject ${l.fileObject}, FileKey ${l.fileKey})`,
        write: true,
        unnamed: raw === undefined || raw === "",
      });
    }
  }
  return { opens, writes };
}

/**
 * Paths in one form: device paths (`\Device\HarddiskVolume3\...`) to drive letters, 8.3 names (`RUNNER~1`) to long
 * names, alternate data streams to their file, then lower case. The trace, the event logs and the test's own paths use
 * different forms.
 */
class Paths {
  private readonly prefixes: (readonly [string, string])[];
  private readonly longOf = new Map<string, string>();

  constructor(devices: Record<string, string>) {
    this.prefixes = Object.entries(devices)
      .map(([letter, device]) => [device.toLowerCase(), letter] as const)
      .sort((a, b) => b[0].length - a[0].length);
  }

  /** The path on its drive letter, or undefined for a device that is no drive (a pipe, the console). */
  toDrive(p: string): string | undefined {
    const lower = p.toLowerCase();
    if (/^[a-z]:\\/.test(lower)) {
      return p;
    }
    const hit = this.prefixes.find(([device]) => lower === device || lower.startsWith(`${device}\\`));
    return hit === undefined ? undefined : `${hit[1]}${p.slice(hit[0].length)}`;
  }

  /** Learns the long names of the paths that hold an 8.3 name. */
  async learn(dir: string, paths: Iterable<string>): Promise<void> {
    const short = [
      ...new Set([...paths].map((p) => this.toDrive(p)).filter((p) => p?.includes("~") === true)),
    ];
    if (short.length === 0) {
      return;
    }
    const input = path.join(dir, "short.txt");
    await fs.writeFile(input, (short as string[]).join("\r\n"), "utf8");
    const long = (await ps(dir, "long", { In: input })).split(/\r?\n/);
    if (long.length < short.length || long.slice(0, short.length).includes("")) {
      throw new Error(
        `record-windows.ps1 long gave ${String(long.length)} lines for ${String(short.length)} paths`,
      );
    }
    short.forEach((p, i) => this.longOf.set(p ?? "", long[i] ?? ""));
  }

  normalize = (p: string): string => {
    const drive = this.toDrive(p);
    if (drive === undefined) {
      return p.toLowerCase();
    }
    let s = (this.longOf.get(drive) ?? drive).toLowerCase();
    const stream = s.indexOf(":", 2);
    if (stream > 0) {
      s = s.slice(0, stream);
    }
    return s.length > 3 ? s.replace(/\\+$/, "") : s;
  };

  /** The normalized path of a file on a drive, or undefined. */
  named = (raw: string): string | undefined =>
    this.toDrive(raw) === undefined ? undefined : this.normalize(raw);
}

/** The recording of one shell run: set up, control, and the record read back. */
export class WindowsRecorder {
  readonly dir: string;
  /** A copy of this Node for the server and the control, so that its firewall rule does not touch the test runner. */
  readonly node: string;
  readonly setup: Setup;
  private readonly since: Date;
  private readonly etl: string;
  private rules: string[] = [];
  private control = { pid: -1, name: "" };

  private constructor(dir: string, setup: Setup) {
    this.dir = dir;
    this.setup = setup;
    this.node = path.join(dir, "node.exe");
    this.etl = path.join(dir, "kf.etl");
    // The events are read from this time on; the margin covers the clocks of the event logs.
    this.since = new Date(Date.now() - 2_000);
  }

  private get engines(): string[] {
    return asList(this.setup.engines);
  }

  /** Checks the setup, adds the firewall rules and starts the Kernel-File trace. */
  static async start(): Promise<WindowsRecorder> {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-shell-record-")));
    const setup = JSON.parse(await ps(dir, "check")) as Setup;
    const missing = missingSetup(setup);
    if (missing.length > 0) {
      throw new Error(`The recording on Windows needs ${missing.join(", ")}: ${JSON.stringify(setup)}`);
    }
    const recorder = new WindowsRecorder(dir, setup);
    try {
      await fs.copyFile(process.execPath, recorder.node);
      // The first start of a new program file can be slow on Windows (the virus scanner reads it); one recorded run
      // showed no window within 30 s. So the copy starts once before the shell needs it.
      await run(recorder.node, ["-e", "0"], { timeout: 120_000 });
      const programs = [SHELL, recorder.node, ...recorder.engines];
      const rules = JSON.parse(await ps(dir, "rules-add", { Group: GROUP, Programs: programs.join("|") })) as
        string | string[] | null;
      recorder.rules = asList(rules);
      await ps(dir, "trace-start", { Session: SESSION, Etl: recorder.etl });
    } catch (error) {
      await recorder.cleanup();
      throw error;
    }
    return recorder;
  }

  /**
   * The control: the Node copy connects to a documentation address, which its rule refuses, and looks up a name of
   * its own. Both must be in the record, so an empty record cannot pass. Gives how the connection ended.
   */
  async runControl(): Promise<string> {
    const name = `reqseq-e2e-control-${String(process.pid)}-${String(Date.now())}.example.com`;
    const script = `
      const net = require("node:net");
      const dns = require("node:dns");
      const s = net.connect({ host: ${JSON.stringify(CONTROL_ADDRESS)}, port: 80 });
      const done = (what) => { s.destroy(); dns.lookup(${JSON.stringify(name)}, () => { console.log(what); }); };
      s.setTimeout(5000, () => done("timeout"));
      s.once("connect", () => done("connected"));
      s.once("error", (e) => done("error " + e.code));`;
    const child = spawn(this.node, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    await new Promise((resolve) => child.once("exit", resolve));
    this.control = { pid: child.pid ?? -1, name };
    return out.trim();
  }

  /** Stops the trace and reads the record of the shell that ran as `shellPid`. */
  async stop(shellPid: number): Promise<WindowsRecord> {
    // The last buffers of the trace and the event logs are written a moment after the shell ends.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const lost = JSON.parse(
      await ps(this.dir, "trace-stop", { Session: SESSION, Etl: this.etl }),
    ) as WindowsRecord["lost"];
    const events = JSON.parse(await ps(this.dir, "events", { Since: this.since.toISOString() })) as Record<
      "processes" | "refused" | "permitted" | "lookups",
      EventRow | EventRow[] | null
    >;
    const paths = new Paths(JSON.parse(await ps(this.dir, "devices")) as Record<string, string>);

    // Get-WinEvent gives the newest event first; the tree is built from the oldest on, in the log's record order.
    const created: Created[] = asList(events.processes)
      .map((e) => ({
        record: numberOf(e["_record"]),
        time: e["_time"] ?? "",
        pid: numberOf(e["NewProcessId"]),
        parent: numberOf(e["ProcessId"]),
        program: e["NewProcessName"] ?? "",
        commandLine: e["CommandLine"] ?? "",
      }))
      .sort((a, b) => a.record - b.record)
      .map(({ record: _, ...p }) => p);
    // The shell's own event: the last start of the shell's program under its process ID.
    const root = created.findLastIndex(
      (p) =>
        p.pid === shellPid && path.basename(p.program).toLowerCase() === path.basename(SHELL).toLowerCase(),
    );
    const treeIndexes = root < 0 ? new Set<number>() : descendants(created, root);
    const server = [...treeIndexes].find(
      (i) => created[i]?.parent === shellPid && created[i].commandLine.includes("ui --no-open"),
    );
    const serverTree = server === undefined ? new Set<number>() : descendants(created, server);
    // The file events and lookups name only a process ID; those of the tree's processes count.
    const tree = new Set([shellPid, ...[...treeIndexes].map((i) => created[i]?.pid ?? -1)]);
    const lines = parseFileLines(await ps(this.dir, "files", { Etl: this.etl, Pids: [...tree].join(",") }));
    const refused = asList(events.refused).map((e) => ({
      time: e["_time"] ?? "",
      pid: numberOf(e["ProcessID"]),
      application: e["Application"] ?? "",
      address: e["DestAddress"] ?? "",
    }));
    const permitted = asList(events.permitted).map((e) => ({
      time: e["_time"] ?? "",
      pid: numberOf(e["ProcessID"]),
      application: e["Application"] ?? "",
      source: e["SourceAddress"] ?? "",
      address: e["DestAddress"] ?? "",
      port: numberOf(e["DestPort"]),
    }));
    const lookups = asList(events.lookups).map((e) => ({
      time: e["_time"] ?? "",
      pid: numberOf(e["_pid"]),
      name: e["QueryName"] ?? "",
    }));
    // Refusals, connections and lookups name a process ID and a time; they count for the process that held the ID.
    const ofTree = (e: { pid: number; time: string }): boolean =>
      heldByTree(created, treeIndexes, e.pid, e.time);
    const engineData = path.join(process.env["LOCALAPPDATA"] ?? "", APP_ID);
    await paths.learn(this.dir, [
      ...[this.node, SHELL, engineData, ...this.engines, ...this.rules],
      ...lines.map((l) => l.name),
      ...refused.map((r) => r.application),
      ...permitted.map((r) => r.application),
      ...created.map((p) => p.program),
    ]);
    const { normalize } = paths;
    return {
      shellPid,
      serverPid: server === undefined ? undefined : created[server]?.pid,
      processes: created
        .map((p, i) => ({ ...p, normalized: normalize(p.program), server: serverTree.has(i), i }))
        .filter((p) => treeIndexes.has(p.i))
        .map(({ i: _, ...p }) => p),
      ...fileEvents(lines, tree, paths.named),
      refused: refused
        .filter(ofTree)
        .map(({ time: _, ...e }) => ({ ...e, application: normalize(e.application) })),
      connections: permitted
        .filter(ofTree)
        .map(({ time: _, ...e }) => ({ ...e, application: normalize(e.application) })),
      lookups: lookups.filter(ofTree).map(({ time: _, ...e }) => e),
      lost,
      control: {
        started: created.some((p) => p.pid === this.control.pid),
        refused: refused
          .filter((e) => e.pid === this.control.pid && !ofTree(e))
          .map((e) => ({ application: normalize(e.application), address: e.address })),
        lookedUp: lookups.some(
          (e) => e.pid === this.control.pid && !ofTree(e) && e.name.toLowerCase() === this.control.name,
        ),
      },
      rules: this.rules.map(normalize),
      engines: this.engines.map(normalize),
      engineData: normalize(engineData),
      normalize,
    };
  }

  /** Removes the firewall rules, stops the trace if it still runs and removes the record. */
  async cleanup(): Promise<void> {
    await ps(this.dir, "rules-remove", { Group: GROUP }).catch(() => "");
    await run("logman", ["stop", SESSION, "-ets"]).catch(() => undefined);
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Whether `file` (a normalized path) is `folder` or lies inside it. */
export const inside = (file: string | undefined, folder: string): boolean =>
  file !== undefined && (file === folder || file.startsWith(`${folder}\\`));

/** Whether `file` holds `token` as UTF-8 or UTF-16 text: false when it is gone or no file, undefined when unreadable. */
export async function holds(file: string, token: string): Promise<boolean | undefined> {
  const stat = await fs.stat(file).catch(() => undefined);
  if (stat?.isFile() !== true) {
    return false;
  }
  const content = await fs.readFile(file).catch(() => undefined);
  if (content === undefined) {
    return undefined;
  }
  return content.includes(Buffer.from(token, "utf8")) || content.includes(Buffer.from(token, "utf16le"));
}
