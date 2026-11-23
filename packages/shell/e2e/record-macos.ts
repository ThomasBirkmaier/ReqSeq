// The recorders of the shell's e2e suite on macOS (ADR-0021, Test seam, A8): the programs each process starts and the
// files it opens, creates and renames (Endpoint Security through `eslogger`), every packet with the process that sent
// or received it (`tcpdump -k` on the `pktap` interface), and pf rules in an anchor under `com.apple/` that refuse
// every connection of the test group to an address other than loopback. The shell and its server run in that group
// (`sudo -u <user> -g reqseq-e2e`); the engine's processes do not, because launchd starts them (#2479), so their
// packets are recorded, not refused.
//
// The recording needs password-free sudo with a runas group and the group itself (the CI step `Shell - recorders
// (macOS)` sets them up and sets REQSEQ_SHELL_E2E_RECORD=macos). In CI (`CI` set) a missing setup fails the recorded
// tests; elsewhere they skip.
import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";
import { CONTROL_ADDRESS } from "./record-windows.js";
import { SHELL, loopback } from "./support.js";

const run = promisify(execFile);
/** The test group: pf refuses its connections to every address but loopback. */
export const GROUP = "reqseq-e2e";
const ANCHOR = "com.apple/reqseq-shell-e2e";
/** Where WKWebView's processes live: the framework, and the cryptex the system loads it from. */
const WEBKIT = [
  "/System/Library/Frameworks/WebKit.framework/",
  "/System/Volumes/Preboot/Cryptexes/OS/System/Library/Frameworks/WebKit.framework/",
];
/** The event types of the record; `exit` shows that the stream reaches the shell's end. */
const EVENTS = ["exec", "fork", "exit", "open", "create", "rename"];
/** The flag of an open for writing (`FWRITE` in `<sys/fcntl.h>`). */
const FWRITE = 0x2;

/** Whether the recorded tests run, skip (local, no setup) or fail (CI, no setup). */
export function macRecordingMode(): "run" | "skip" | "fail" {
  if (process.env["REQSEQ_SHELL_E2E_RECORD"] === "macos") {
    return "run";
  }
  return (process.env["CI"] ?? "") === "" ? "skip" : "fail";
}

/** One line of the eslogger stream, reduced to what the record reads. */
export interface EsEvent {
  readonly kind: string;
  readonly global: number;
  readonly seq: number;
  readonly time: string;
  /** The process the event is about. */
  readonly pid: number;
  readonly ppid: number;
  readonly program: string;
  readonly start: string;
  /** exec: the new program and its arguments; fork: the child. */
  readonly target?: { readonly pid: number; readonly program: string; readonly args: readonly string[] };
  /** open, create, rename: the path, and for open whether it was for writing. */
  readonly path?: string;
  readonly write?: boolean;
}

interface EsProcessJson {
  audit_token?: { pid?: number };
  ppid?: number;
  executable?: { path?: string };
  start_time?: string;
}
interface EsFileJson {
  path?: string;
}
interface EsJson {
  global_seq_num?: number;
  seq_num?: number;
  time?: string;
  process?: EsProcessJson;
  event?: {
    exec?: { target?: EsProcessJson; args?: string[] };
    fork?: { child?: EsProcessJson };
    exit?: unknown;
    open?: { file?: EsFileJson; fflag?: number };
    create?: {
      destination?: { existing_file?: EsFileJson; new_path?: { dir?: EsFileJson; filename?: string } };
    };
    rename?: {
      destination?: { existing_file?: EsFileJson; new_path?: { dir?: EsFileJson; filename?: string } };
    };
  };
}

interface EsDestination {
  existing_file?: EsFileJson;
  new_path?: { dir?: EsFileJson; filename?: string };
}

/** The path a create or rename writes: the file that exists, or the new name in its folder. */
function destination(d: EsDestination | undefined): string {
  if (d?.existing_file?.path !== undefined) {
    return d.existing_file.path;
  }
  return path.posix.join(d?.new_path?.dir?.path ?? "", d?.new_path?.filename ?? "");
}

/** A process of an event: its ID and program. */
const processOf = (p: EsProcessJson | undefined): { pid: number; program: string } => ({
  pid: p?.audit_token?.pid ?? -1,
  program: p?.executable?.path ?? "",
});

/** What an event of `kind` is about beyond its process: the program it runs or the path it touches. */
function detail(
  event: NonNullable<EsJson["event"]>,
  pid: number,
): Pick<EsEvent, "target" | "path" | "write"> {
  const { exec, fork, open, create, rename } = event;
  if (exec !== undefined) {
    const t = processOf(exec.target);
    return { target: { pid: t.pid < 0 ? pid : t.pid, program: t.program, args: exec.args ?? [] } };
  }
  if (fork !== undefined) {
    return { target: { ...processOf(fork.child), args: [] } };
  }
  if (open !== undefined) {
    return { path: open.file?.path ?? "", write: ((open.fflag ?? 0) & FWRITE) !== 0 };
  }
  const written = create ?? rename;
  return written === undefined ? {} : { path: destination(written.destination), write: true };
}

/** Reads one line of `eslogger --format json`; undefined for a line that is no event. */
export function parseEsLine(line: string): EsEvent | undefined {
  let m: EsJson;
  try {
    m = JSON.parse(line) as EsJson;
  } catch {
    return undefined;
  }
  const kind = Object.keys(m.event ?? {})[0];
  if (kind === undefined || m.event === undefined) {
    return undefined;
  }
  const p = m.process;
  const { pid, program } = processOf(p);
  return {
    kind,
    global: m.global_seq_num ?? -1,
    seq: m.seq_num ?? -1,
    time: m.time ?? "",
    pid,
    ppid: p?.ppid ?? -1,
    program,
    start: p?.start_time ?? "",
    ...detail(m.event, pid),
  };
}

/**
 * The sequence numbers missing between the first and the last event: in `global_seq_num`, and per event type in
 * `seq_num`. Endpoint Security counts both per client, so a gap is an event the kernel dropped for eslogger.
 */
export function missing(events: readonly EsEvent[]): { global: number; byKind: Record<string, number> } {
  const gapsOf = (numbers: number[]): number => {
    const sorted = numbers.filter((n) => n >= 0).sort((a, b) => a - b);
    let gaps = 0;
    for (let i = 1; i < sorted.length; i++) {
      gaps += Math.max(0, (sorted[i] ?? 0) - (sorted[i - 1] ?? 0) - 1);
    }
    return gaps;
  };
  const kinds = [...new Set(events.map((e) => e.kind))];
  return {
    global: gapsOf(events.map((e) => e.global)),
    byKind: Object.fromEntries(
      kinds.map((k) => [k, gapsOf(events.filter((e) => e.kind === k).map((e) => e.seq))]),
    ),
  };
}

/** One process of the shell's tree, with each program it ran. */
export interface Started {
  readonly pid: number;
  readonly parent: number;
  readonly programs: readonly { readonly program: string; readonly args: readonly string[] }[];
  /** Whether it is the server or one of its descendants. */
  readonly server: boolean;
}

interface TreeNode {
  pid: number;
  parent: number;
  programs: { program: string; args: readonly string[] }[];
  server: boolean;
}

/** The shell's exec: the first exec of `shell` by `starter` or a child of it. */
const isRoot = (e: EsEvent, starter: number, shell: string): boolean =>
  e.kind === "exec" && e.target?.program === shell && (e.ppid === starter || e.pid === starter);

/**
 * The tree of the shell that `starter` (the process the test spawned, sudo) started: the shell's exec, its forks
 * and their execs, in stream order. A process ID taken again after an exit counts for the new process only. The
 * server is the shell's child that runs `ui --no-open`, with its descendants.
 */
export function shellTree(
  events: readonly EsEvent[],
  starter: number,
  shell: string,
): { shellPid: number | undefined; processes: Started[] } {
  const ordered = [...events].sort((a, b) => a.global - b.global);
  const rootAt = ordered.findIndex((e) => isRoot(e, starter, shell));
  const root = ordered[rootAt]?.target;
  if (root === undefined) {
    return { shellPid: undefined, processes: [] };
  }
  const live = new Map<number, TreeNode>([
    [
      root.pid,
      { pid: root.pid, parent: starter, programs: [{ program: shell, args: root.args }], server: false },
    ],
  ]);
  const all: TreeNode[] = [...live.values()];
  for (const e of ordered.slice(rootAt + 1)) {
    const node = live.get(e.pid);
    if (node === undefined || (e.kind !== "exit" && e.target === undefined)) {
      continue;
    }
    if (e.kind === "exit") {
      live.delete(e.pid);
    } else if (e.kind === "fork" && e.target !== undefined) {
      // A fork runs its parent's program until it runs one of its own.
      const child = {
        pid: e.target.pid,
        parent: e.pid,
        programs: node.programs.slice(-1),
        server: node.server,
      };
      live.set(child.pid, child);
      all.push(child);
    } else if (e.kind === "exec" && e.target !== undefined) {
      node.programs.push({ program: e.target.program, args: e.target.args });
      node.server ||= node.parent === root.pid && e.target.args.join(" ").includes("ui --no-open");
    }
  }
  return { shellPid: root.pid, processes: all.map((n) => ({ ...n })) };
}

/** One packet as `tcpdump -n -k` prints it on `pktap`: interface, process and effective process, addresses. */
export interface Packet {
  readonly line: string;
  readonly iface: string;
  readonly pids: readonly number[];
  readonly source: string;
  readonly destination: string;
}

/** The address of `a.b.c.d.port` or `v6addr.port` without the port. */
const host = (endpoint: string): string => endpoint.replace(/\.[^.:]+$/, "").replace(/:$/, "");

/** Reads one line of `tcpdump -n -k -i pktap,all`; undefined for a line that is no IP packet. */
export function parsePacket(line: string): Packet | undefined {
  const m = /^\S+ \(([^,)]+)((?:, [^)]*)?)\) IP6? (\S+) > (\S+?):? /.exec(line);
  if (m === null) {
    return undefined;
  }
  const meta = m[2] ?? "";
  const pids = [...meta.matchAll(/\b(?:e?proc) [^,:]*:(\d+)/g)].map((p) => Number(p[1]));
  return { line, iface: m[1] ?? "", pids, source: host(m[3] ?? ""), destination: host(m[4] ?? "") };
}

/** Whether both ends of a packet are loopback addresses. */
export const onLoopback = (p: Packet): boolean => loopback(p.source) && loopback(p.destination);

/** Whether `program` is one of WKWebView's own processes. */
export const isEngine = (program: string): boolean =>
  WEBKIT.some((w) => program.startsWith(w)) && /\/com\.apple\.WebKit\.[A-Za-z.]+$/.test(program);

/** One of WKWebView's processes, with the arguments of its exec when the stream has it. */
export interface EngineProcess {
  readonly pid: number;
  readonly program: string;
  readonly start: string;
  readonly args: readonly string[] | undefined;
}

/**
 * WKWebView's processes that started from `from` to `to` (ISO times): launchd starts them, not the shell (#2479), so
 * every one that started while the shell ran counts as the shell's, also one another app asked for.
 */
export function engineProcesses(events: readonly EsEvent[], from: string, to: string): EngineProcess[] {
  const found = new Map<number, EngineProcess>();
  const during = (time: string): boolean => time >= from && time <= to;
  for (const e of events) {
    if (e.kind === "exec" && e.target !== undefined && isEngine(e.target.program) && during(e.time)) {
      found.set(e.target.pid, {
        pid: e.target.pid,
        program: e.target.program,
        start: e.time,
        args: e.target.args,
      });
    } else if (isEngine(e.program) && during(e.start) && !found.has(e.pid)) {
      found.set(e.pid, { pid: e.pid, program: e.program, start: e.start, args: undefined });
    }
  }
  return [...found.values()];
}

/** The packet counters of the anchor's rules, in rule order. */
export function ruleCounters(text: string): number[] {
  return [...text.matchAll(/Packets: (\d+)/g)].map((m) => Number(m[1]));
}

/** What tcpdump says it dropped at its end, or undefined when it said nothing. */
export function droppedByKernel(stderr: string): number | undefined {
  const m = /(\d+) packets? dropped by kernel/.exec(stderr);
  return m === null ? undefined : Number(m[1]);
}

export interface MacRecord {
  readonly shellPid: number | undefined;
  /** Every process of the shell's tree, the shell included. */
  readonly processes: readonly Started[];
  /** WKWebView's processes that started while the shell ran (they have launchd as parent). */
  readonly engine: readonly EngineProcess[];
  /** The opens, creates and renames of the tree outside the server and of the engine. */
  readonly files: readonly EsEvent[];
  /** The opens of the server's processes. */
  readonly serverFiles: readonly EsEvent[];
  /** Completeness: sequence numbers missing, and whether the stream has the shell's exit and the end marker. */
  readonly missing: { readonly global: number; readonly byKind: Record<string, number> };
  readonly events: number;
  readonly shellExit: boolean;
  readonly marker: boolean;
  /** Every packet with a process of the tree or of the engine, and what tcpdump dropped. */
  readonly packets: readonly Packet[];
  readonly dropped: number | undefined;
  /** The anchor's rules and their packet counters after the control and at the end. */
  readonly rules: string;
  readonly counters: { readonly control: readonly number[]; readonly end: readonly number[] };
  readonly control: Control;
}

export interface Control {
  /** How the connections of the two controls ended: outside the group (recorded) and in it (refused). */
  readonly outside: string;
  readonly inside: string;
  readonly outsidePid: number;
  readonly insidePid: number;
  readonly name: string;
  /** Whether the stream has the exec of each control, and pktap the outside control's packet and its lookup. */
  readonly started: boolean;
  readonly packet: boolean;
  readonly lookedUp: boolean;
  /** Whether pktap has the reset of the refused connection, with the inside control's process. */
  readonly reset: boolean;
}

/** Runs `sudo -n` with `args` and gives its standard output. */
async function sudo(args: readonly string[]): Promise<string> {
  const { stdout } = await run("sudo", ["-n", ...args], { maxBuffer: 16 * 1024 * 1024, timeout: 60_000 });
  return stdout;
}

/** Spawns a recorder through sudo with its output in `file`, and resolves when it has ended. */
async function recorder(
  args: readonly string[],
  file: string,
  errors: string,
): Promise<{ child: ChildProcess; ended: Promise<void> }> {
  const out = await fs.open(file, "w");
  const err = await fs.open(errors, "w");
  // A process group of its own: eslogger leaves out the events of its own process group, which would otherwise be
  // the test runner's and the shell's.
  const child = spawn("sudo", ["-n", ...args], { stdio: ["ignore", out.fd, err.fd], detached: true });
  const ended = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
    child.once("error", () => {
      resolve();
    });
  }).finally(async () => {
    await out.close();
    await err.close();
  });
  return { child, ended };
}

/** The recording of one shell run: set up, controls, and the record read back. */
export class MacRecorder {
  readonly dir: string;
  /** A copy of this Node for the server and the controls, so that the selected programs leave out the test runner. */
  readonly node: string;
  /** The command that starts the shell in the test group. */
  readonly wrap: readonly [string, ...string[]];
  private readonly es: string;
  private readonly pktap: string;
  private recorders: { child: ChildProcess; ended: Promise<void>; errors: string }[] = [];
  private pfToken = "";
  private control: Omit<Control, "started" | "packet" | "lookedUp" | "reset"> | undefined;
  private controlCounters: number[] = [];

  private constructor(dir: string) {
    this.dir = dir;
    this.node = path.join(dir, "node", "bin", "node");
    this.es = path.join(dir, "es.json");
    this.pktap = path.join(dir, "pktap.txt");
    this.wrap = ["sudo", "-n", "-u", os.userInfo().username, "-g", GROUP];
  }

  /** Checks the setup, loads the pf rules and starts eslogger and tcpdump. */
  static async start(): Promise<MacRecorder> {
    const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-shell-record-")));
    const recorder = new MacRecorder(dir);
    try {
      await recorder.begin();
    } catch (error) {
      await recorder.cleanup();
      throw error;
    }
    return recorder;
  }

  private async begin(): Promise<void> {
    const group = (
      await run("sudo", ["-n", "-u", os.userInfo().username, "-g", GROUP, "id", "-gn"]).catch(
        (e: unknown) => ({ stdout: `(${String(e)})` }),
      )
    ).stdout.trim();
    if (group !== GROUP) {
      throw new Error(
        `The recording on macOS needs password-free sudo with the runas group ${GROUP} (got ${JSON.stringify(group)})`,
      );
    }
    await fs.mkdir(path.dirname(this.node), { recursive: true });
    await fs.copyFile(process.execPath, this.node);
    await fs.chmod(this.node, 0o755);
    // The folder is the test's own; the shell runs as the same user, so it reads and writes it.
    const rules = path.join(this.dir, "anchor.conf");
    await fs.writeFile(
      rules,
      [
        `block return out log quick inet from any to ! 127.0.0.0/8 group ${GROUP}`,
        `block return out log quick inet6 from any to ! ::1 group ${GROUP}`,
        "",
      ].join("\n"),
    );
    await sudo(["pfctl", "-q", "-a", ANCHOR, "-f", rules]);
    const enabled = await run("sudo", ["-n", "pfctl", "-E"]).then(
      (r) => `${r.stdout}${r.stderr}`,
      (e: unknown) => {
        const { stdout = "", stderr = "" } = e as { stdout?: string; stderr?: string };
        return `${stdout}${stderr}`;
      },
    );
    this.pfToken = /Token : (\d+)/.exec(enabled)?.[1] ?? "";
    if (this.pfToken === "") {
      throw new Error(`pfctl -E gave no token: ${enabled}`);
    }
    // Only the events of these programs: without a selection, Endpoint Security drops events of a busy runner (#2465).
    // xpcproxy is the program launchd runs first for each of the engine's processes; its exec names their arguments.
    const selected = [
      path.dirname(SHELL),
      path.dirname(path.dirname(this.node)),
      ...WEBKIT,
      "/usr/bin/sudo",
      "/usr/bin/env",
      "/usr/libexec/xpcproxy",
    ].flatMap((p) => ["--select", p]);
    const es = await recorder(["eslogger", ...EVENTS, ...selected], this.es, `${this.es}.err`);
    const tcpdump = await recorder(
      ["tcpdump", "-n", "-l", "-k", "-i", "pktap,all"],
      this.pktap,
      `${this.pktap}.err`,
    );
    this.recorders = [
      { ...es, errors: `${this.es}.err` },
      { ...tcpdump, errors: `${this.pktap}.err` },
    ];
    // eslogger writes its first events once it is subscribed; the selected programs include sudo, which runs here.
    for (let i = 0; i < 100; i++) {
      await sudo(["true"]);
      const size = (await fs.stat(this.es)).size;
      if (size > 0 && (await fs.stat(this.pktap)).size >= 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`eslogger wrote nothing within 10 s: ${await fs.readFile(`${this.es}.err`, "utf8")}`);
  }

  /**
   * The controls: the Node copy connects to a documentation address and looks up a name of its own, once outside the
   * test group (pktap records it) and once in it (pf refuses it and counts it). Both must be in the record, so an
   * empty record cannot pass.
   */
  async runControls(): Promise<void> {
    const name = `reqseq-e2e-control-${String(process.pid)}-${String(Date.now())}.example.com`;
    const script = `
      const net = require("node:net");
      const dns = require("node:dns");
      const s = net.connect({ host: ${JSON.stringify(CONTROL_ADDRESS)}, port: 80 });
      const done = (what) => { s.destroy(); dns.lookup(${JSON.stringify(name)}, () => { console.log(process.pid + " " + what); }); };
      s.setTimeout(1500, () => done("timeout"));
      s.once("connect", () => done("connected"));
      s.once("error", (e) => done("error " + e.code));`;
    const once = async (prefix: readonly [string, ...string[]]): Promise<{ pid: number; how: string }> => {
      const [command, ...args] = [...prefix, this.node, "-e", script];
      const { stdout } = await run(command, args, { timeout: 30_000 });
      const [pid = "-1", ...how] = stdout.trim().split(" ");
      return { pid: Number(pid), how: how.join(" ") };
    };
    // Through env, a selected program: the exec of a process the test runner forks is not in the stream.
    const outside = await once(["/usr/bin/env"]);
    const inside = await once(this.wrap);
    this.control = {
      outside: outside.how,
      inside: inside.how,
      outsidePid: outside.pid,
      insidePid: inside.pid,
      name,
    };
    this.controlCounters = ruleCounters(await sudo(["pfctl", "-a", ANCHOR, "-s", "rules", "-v"]));
  }

  /**
   * Stops the recorders after a marker process and reads the record of the shell that `starter` (the spawned sudo)
   * started.
   */
  async stop(starter: number): Promise<MacRecord> {
    const rules = await sudo(["pfctl", "-a", ANCHOR, "-s", "rules", "-v"]);
    // A selected program that runs after the shell ended: its exec shows that the stream reaches past the session.
    const marker = await run("sudo", ["-n", this.node, "-e", "console.log(process.pid)"]);
    const markerPid = Number(marker.stdout.trim());
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await this.halt();
    const events: EsEvent[] = [];
    const lines = readline.createInterface({ input: createReadStream(this.es, { encoding: "utf8" }) });
    for await (const line of lines) {
      const e = parseEsLine(line);
      if (e !== undefined) {
        events.push(e);
      }
    }
    const { shellPid, processes } = shellTree(events, starter, SHELL);
    const server = new Set(processes.filter((p) => p.server).map((p) => p.pid));
    const tree = new Set(processes.map((p) => p.pid));
    const shellEvents = events.filter((e) => e.pid === shellPid);
    const from = shellEvents[0]?.time ?? "";
    const to = events.find((e) => e.kind === "exit" && e.pid === shellPid)?.time ?? "~";
    const engine = new Map(engineProcesses(events, from, to).map((p) => [p.pid, p]));
    const watched = new Set([...[...tree].filter((p) => !server.has(p)), ...engine.keys()]);
    const packets = (await fs.readFile(this.pktap, "utf8"))
      .split("\n")
      .map(parsePacket)
      .filter((p): p is Packet => p !== undefined);
    const control = this.control ?? { outside: "", inside: "", outsidePid: -1, insidePid: -1, name: "" };
    const ofControl = (pid: number) => packets.filter((p) => p.pids.includes(pid));
    return {
      shellPid,
      processes,
      engine: [...engine.values()],
      files: events.filter((e) => e.path !== undefined && watched.has(e.pid)),
      serverFiles: events.filter((e) => e.path !== undefined && server.has(e.pid)),
      missing: missing(events),
      events: events.length,
      shellExit: events.some((e) => e.kind === "exit" && e.pid === shellPid),
      marker: events.some((e) => e.kind === "exec" && e.target?.pid === markerPid),
      packets: packets.filter((p) => p.pids.some((pid) => tree.has(pid) || engine.has(pid))),
      dropped: droppedByKernel(await fs.readFile(`${this.pktap}.err`, "utf8")),
      rules,
      counters: { control: this.controlCounters, end: ruleCounters(rules) },
      control: {
        ...control,
        started: [control.outsidePid, control.insidePid].every((pid) =>
          events.some((e) => e.kind === "exec" && e.target?.pid === pid),
        ),
        packet: ofControl(control.outsidePid).some((p) => p.destination === CONTROL_ADDRESS),
        lookedUp: ofControl(control.outsidePid).some((p) => p.line.includes(`${control.name}.`)),
        reset: ofControl(control.insidePid).some((p) => p.source === CONTROL_ADDRESS),
      },
    };
  }

  /** Ends eslogger and tcpdump through sudo and waits until they have written their last lines. */
  private async halt(): Promise<void> {
    for (const r of this.recorders) {
      if (r.child.pid !== undefined) {
        // eslogger ignores SIGINT; tcpdump prints what it dropped on either.
        await sudo(["pkill", "-TERM", "-P", String(r.child.pid)]).catch(() => "");
      }
    }
    const ended = Promise.all(this.recorders.map((r) => r.ended));
    const late = await Promise.race([
      ended.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(resolve, 30_000, true)),
    ]);
    if (late) {
      for (const r of this.recorders) {
        if (r.child.pid !== undefined) {
          await sudo(["pkill", "-KILL", "-P", String(r.child.pid)]).catch(() => "");
        }
      }
      throw new Error("eslogger or tcpdump did not end within 30 s of SIGINT");
    }
    this.recorders = [];
  }

  /** Stops the recorders if they still run, removes the pf rules and the record. */
  async cleanup(): Promise<void> {
    await this.halt().catch(() => undefined);
    await sudo(["pfctl", "-q", "-a", ANCHOR, "-F", "all"]).catch(() => "");
    if (this.pfToken !== "") {
      await sudo(["pfctl", "-q", "-X", this.pfToken]).catch(() => "");
    }
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
