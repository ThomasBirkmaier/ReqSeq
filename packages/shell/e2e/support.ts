// The driver of the shell's e2e build (ADR-0021, Test seam): starts `reqseq-shell` with the CLI built from the
// checkout, sends commands to its standard input and reads its `e2e <kind> <JSON>` lines; on Linux it can record
// the shell's processes, files and connections with `strace -f` (A8).
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const here = import.meta.dirname;
const root = path.resolve(here, "..", "..", "..");
const exe = process.platform === "win32" ? ".exe" : "";

/** The e2e build of the shell, and the CLI of the checkout. */
export const SHELL = path.join(here, "..", "target", "debug", `reqseq-shell${exe}`);
export const CLI = path.join(root, "packages", "cli", "dist", "bin.js");
export const FAKE_SERVER = path.join(here, "fixtures", "server.mjs");
export const OPENER = path.join(here, "fixtures", "opener.mjs");

export function requireBuilt(): void {
  for (const [file, how] of [
    [SHELL, "pnpm --filter @reqseq/shell build:e2e"],
    [CLI, "pnpm build"],
  ] as const) {
    if (!existsSync(file)) {
      throw new Error(`${file} is missing: run ${how} first`);
    }
  }
}

export interface ShellEvent {
  readonly kind: string;
  readonly value: unknown;
}

export interface StartOptions {
  /** The CLI entry; default the checkout's. */
  readonly cli?: string;
  /** The Node binary; default this one. */
  readonly node?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly args?: readonly string[];
  /** Record processes, files and connections with strace (Linux only). */
  readonly record?: boolean;
}

/** A folder removed after the test. */
export async function tempFolder(prefix: string): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `reqseq-shell-${prefix}-`)));
}

export class Shell {
  readonly child: ChildProcessWithoutNullStreams;
  readonly events: ShellEvent[] = [];
  stdout = "";
  stderr = "";
  /** The strace output file, when recorded. */
  readonly trace: string | undefined;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  private nextId = 1;

  constructor(child: ChildProcessWithoutNullStreams, trace: string | undefined) {
    this.child = child;
    this.trace = trace;
    let partial = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stdout += text;
      partial += text;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^e2e (\S+) (.*)$/.exec(line);
        if (m !== null) {
          this.events.push({ kind: m[1] ?? "", value: JSON.parse(m[2] ?? "null") as unknown });
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr += chunk.toString("utf8");
    });
    this.exited = new Promise((resolve) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });
  }

  /** Waits until `check` gives a value, up to `ms`. */
  async until<T>(what: string, check: () => T | undefined, ms = 30_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = check();
      if (value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Not seen within ${String(ms)} ms: ${what}\nstdout: ${this.stdout}\nstderr: ${this.stderr}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** The first event of `kind` that `match` accepts. */
  event(kind: string, match: (value: unknown) => boolean = () => true, ms?: number): Promise<unknown> {
    return this.until(
      `e2e ${kind}`,
      () => this.events.find((e) => e.kind === kind && match(e.value))?.value,
      ms,
    );
  }

  /** The values of the events of `kind` so far. */
  all(kind: string): unknown[] {
    return this.events.filter((e) => e.kind === kind).map((e) => e.value);
  }

  send(command: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  /** Waits until the page has loaded. */
  async loaded(): Promise<void> {
    await this.event("page-load", (v) => String(v).startsWith("Finished"));
  }

  /**
   * Runs `script` in the page once it has loaded and resolves with its result (a JSON value). A script sent while
   * the page loads gets no answer; it is sent again after `ms`.
   */
  async eval(script: string, ms = 5_000): Promise<unknown> {
    await this.loaded();
    for (let attempt = 1; ; attempt++) {
      const id = this.nextId++;
      this.send({ eval: script, id });
      try {
        const answer = (await this.event("eval", (v) => (v as { id: number }).id === id, ms)) as {
          result: unknown;
        };
        return answer.result;
      } catch (error) {
        if (attempt === 3) {
          throw error;
        }
      }
    }
  }

  /** Runs `script` until it gives a value other than `null` or `false`. */
  async evalUntil(what: string, script: string, ms = 30_000): Promise<unknown> {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = await this.eval(script);
      if (value !== null && value !== false && value !== undefined) {
        return value;
      }
      if (Date.now() > deadline) {
        throw new Error(`Not true within ${String(ms)} ms in the page: ${what}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** The origin the shell showed. */
  async shown(): Promise<string> {
    return (await this.event("shown")) as string;
  }

  /** The port of the shown server. */
  async port(): Promise<number> {
    return Number(new URL(await this.shown()).port);
  }

  async end(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
      await this.exited;
    }
  }
}

const started: Shell[] = [];

/** Starts the e2e build of the shell. */
export async function startShell(options: StartOptions = {}): Promise<Shell> {
  const env = {
    ...process.env,
    REQSEQ_SHELL_E2E_NODE: options.node ?? process.execPath,
    REQSEQ_SHELL_E2E_CLI: options.cli ?? CLI,
    ...options.env,
  };
  let command = SHELL;
  let args = [...(options.args ?? [])];
  let trace: string | undefined;
  if (options.record === true) {
    trace = path.join(await tempFolder("trace"), "trace.txt");
    args = [
      "-f",
      "-qq",
      "-s",
      "4096",
      "-o",
      trace,
      "-e",
      "trace=process,open,openat,creat,connect,sendto,sendmsg",
      SHELL,
      ...args,
    ];
    command = "strace";
  }
  const child = spawn(command, args, { cwd: options.cwd ?? root, env, stdio: "pipe" });
  const shell = new Shell(child, trace);
  started.push(shell);
  return shell;
}

/** Ends every shell a test started that is still running. */
export async function endShells(): Promise<void> {
  await Promise.all(started.splice(0).map((s) => s.end()));
}

/** Whether a TCP connection to `port` on 127.0.0.1 is accepted. */
export const answers = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });

/** Milliseconds until `port` stops answering, or undefined when it still answers after `ms`. */
export async function stopsAnswering(port: number, ms = 5_000): Promise<number | undefined> {
  const start = Date.now();
  while (Date.now() - start <= ms) {
    if (!(await answers(port))) {
      return Date.now() - start;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

/** Opens the workspace at `folder` in the page, as the page does when a person opens it, and waits for it. */
export async function openWorkspace(shell: Shell, folder: string): Promise<void> {
  await shell.evalUntil("the token", "sessionStorage.getItem('reqseq.token') !== null");
  const status = await shell.eval(`(() => {
    window.__opened = null;
    fetch("ui/workspace", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + sessionStorage.getItem("reqseq.token") },
      body: ${JSON.stringify(JSON.stringify({ path: folder }))},
    }).then(async (r) => { window.__generation = (await r.json()).generation; window.__opened = r.status; }, (e) => { window.__opened = String(e); });
    return true;
  })()`);
  if (status !== true) {
    throw new Error(`the open did not start: ${JSON.stringify(status)}`);
  }
  const opened = await shell.evalUntil("the workspace opened", "window.__opened");
  if (opened !== 200) {
    throw new Error(`the workspace did not open: ${JSON.stringify(opened)}`);
  }
}

// --- strace output (Linux) ---

export interface Recorded {
  /** Each successful execve: process ID, program and arguments. */
  readonly execs: readonly { readonly pid: number; readonly program: string; readonly argv: string }[];
  /** Each successful open: process ID, path and whether it was opened for writing. */
  readonly opens: readonly { readonly pid: number; readonly path: string; readonly write: boolean }[];
  /** Each connect or send to an IPv4 or IPv6 address: process ID and address. */
  readonly connections: readonly { readonly pid: number; readonly address: string; readonly line: string }[];
  /** Parent of each process that was created. */
  readonly parents: ReadonlyMap<number, number>;
}

/** The calls of a strace file of `strace -f`, joining the `unfinished ...` and `resumed` halves of each call. */
function traceCalls(text: string): { pid: number; call: string }[] {
  const pending = new Map<number, string>();
  const calls: { pid: number; call: string }[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\d+)\s+(.*)$/.exec(line);
    if (m === null) {
      continue;
    }
    const pid = Number(m[1]);
    const rest = m[2] ?? "";
    if (rest.endsWith("<unfinished ...>")) {
      pending.set(pid, rest.slice(0, -"<unfinished ...>".length));
    } else if (rest.startsWith("<... ")) {
      const resumed = rest.replace(/^<\.\.\. \w+ resumed>/, "");
      calls.push({ pid, call: `${(pending.get(pid) ?? "").trimEnd()}${resumed}`.replace(/\)\s+= /, ") = ") });
      pending.delete(pid);
    } else {
      calls.push({ pid, call: rest.replace(/\)\s+= /, ") = ") });
    }
  }
  return calls;
}

/** Reads a strace file of `strace -f`: the programs, files and connections of each process. */
export async function readTrace(file: string): Promise<Recorded> {
  const calls = traceCalls(await fs.readFile(file, "utf8"));
  const execs: { pid: number; program: string; argv: string }[] = [];
  const opens: { pid: number; path: string; write: boolean }[] = [];
  const connections: { pid: number; address: string; line: string }[] = [];
  const parents = new Map<number, number>();
  for (const { pid, call } of calls) {
    const exec = /^execve\("((?:[^"\\]|\\.)*)", \[(.*)\], .*\) = 0$/.exec(call);
    if (exec !== null) {
      execs.push({ pid, program: exec[1] ?? "", argv: exec[2] ?? "" });
      continue;
    }
    const fork = /^(?:clone3?|fork|vfork)\(.*\) = (\d+)$/.exec(call);
    if (fork !== null) {
      parents.set(Number(fork[1]), pid);
      continue;
    }
    const open = /^(?:open|openat)\((?:AT_FDCWD, |\d+, )?"((?:[^"\\]|\\.)*)", ([A-Z_|]+).*\) = \d+/.exec(
      call,
    );
    if (open !== null) {
      const flags = open[2] ?? "";
      opens.push({ pid, path: open[1] ?? "", write: /O_WRONLY|O_RDWR|O_CREAT/.test(flags) });
      continue;
    }
    if (/^(?:connect|sendto|sendmsg)\(/.test(call)) {
      const v4 = /sin_addr=inet_addr\("([\d.]+)"\)/.exec(call);
      const v6 = /inet_pton\(AF_INET6, "([^"]+)"/.exec(call);
      const address = v4?.[1] ?? v6?.[1];
      if (address !== undefined) {
        connections.push({ pid, address, line: call });
      }
    }
  }
  return { execs, opens, connections, parents };
}

/** Whether `pid` is `ancestor` or one of its descendants. */
export function descends(recorded: Recorded, pid: number, ancestor: number): boolean {
  for (let p: number | undefined = pid; p !== undefined; p = recorded.parents.get(p)) {
    if (p === ancestor) {
      return true;
    }
  }
  return false;
}

/** Whether `address` is a loopback address. */
export const loopback = (address: string): boolean =>
  address.startsWith("127.") || address === "::1" || address.startsWith("::ffff:127.");
