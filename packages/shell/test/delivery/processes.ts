// What the delivery tests of the desktop shell read from the operating system (#2379): the processes with their
// parents and arguments, the current folder and open files of a process, and the TCP connections with their owners.
// The release build has no test driver (ADR-0021), so the tests see the shell only from outside.
import type { ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";

export interface Process {
  readonly pid: number;
  readonly ppid: number;
  /** The arguments, the program first: exact on Linux and Windows, split at spaces on macOS. */
  readonly args: readonly string[];
}

export interface Connection {
  readonly pid: number;
  readonly state: "LISTEN" | "ESTABLISHED" | "OTHER";
  readonly localPort: number;
  readonly remotePort: number;
}

const run = (command: string, args: readonly string[]): string =>
  execFileSync(command, [...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const powershell = (script: string): string =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);

/** The arguments of a Windows command line, split by the rules of `CommandLineToArgvW`. */
export function windowsArgs(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let any = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\") {
      let count = 0;
      while (line[i] === "\\") {
        count += 1;
        i += 1;
      }
      if (line[i] === '"') {
        current += "\\".repeat(Math.floor(count / 2));
        if (count % 2 === 1) {
          current += '"';
        } else {
          quoted = !quoted;
        }
        any = true;
      } else {
        current += "\\".repeat(count);
        i -= 1;
      }
    } else if (char === '"') {
      quoted = !quoted;
      any = true;
    } else if ((char === " " || char === "\t") && !quoted) {
      if (any || current !== "") {
        args.push(current);
      }
      current = "";
      any = false;
    } else {
      current += char ?? "";
    }
  }
  if (any || current !== "") {
    args.push(current);
  }
  return args;
}

/** Every process of the system that this user can see. */
export function processes(): Process[] {
  if (process.platform === "linux") {
    return readdirSync("/proc")
      .filter((name) => /^\d+$/.test(name))
      .flatMap((name) => {
        try {
          const stat = readFileSync(`/proc/${name}/stat`, "utf8");
          const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
          const args = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0").slice(0, -1);
          return [{ pid: Number(name), ppid, args }];
        } catch {
          return [];
        }
      });
  }
  if (process.platform === "darwin") {
    return run("ps", ["-A", "-ww", "-o", "pid=,ppid=,command="])
      .split("\n")
      .flatMap((line) => {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return m === null ? [] : [{ pid: Number(m[1]), ppid: Number(m[2]), args: (m[3] ?? "").split(" ") }];
      });
  }
  return powershell(
    'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }',
  )
    .split(/\r?\n/)
    .flatMap((line) => {
      const [pid, ppid, ...rest] = line.split("\t");
      return pid === undefined || ppid === undefined || pid === ""
        ? []
        : [{ pid: Number(pid), ppid: Number(ppid), args: windowsArgs(rest.join("\t")) }];
    });
}

/** The processes below `pid`, its children first. */
export function descendants(all: readonly Process[], pid: number): Process[] {
  const found: Process[] = [];
  const queue = [pid];
  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift()) {
    for (const child of all.filter((p) => p.ppid === parent)) {
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

/** The current folder and the open files of `pid` (Linux and macOS); undefined on Windows, which has no reader. */
export function folderAndFiles(pid: number): { readonly cwd: string; readonly files: string[] } | undefined {
  if (process.platform === "linux") {
    const files = readdirSync(`/proc/${String(pid)}/fd`).flatMap((fd) => {
      try {
        return [readlinkSync(`/proc/${String(pid)}/fd/${fd}`)];
      } catch {
        return [];
      }
    });
    return { cwd: readlinkSync(`/proc/${String(pid)}/cwd`), files };
  }
  if (process.platform === "darwin") {
    const names = (fd: string): string[] =>
      run("lsof", ["-a", "-p", String(pid), "-d", fd, "-Fn"])
        .split("\n")
        .filter((line) => line.startsWith("n"))
        .map((line) => line.slice(1));
    return { cwd: names("cwd")[0] ?? "", files: names("0-65535") };
  }
  return undefined;
}

const portOf = (address: string): number => Number(/:(\d+)$/.exec(address)?.[1] ?? 0);

/** The TCP connections of the system with the process that owns each end. */
export function connections(): Connection[] {
  if (process.platform === "linux") {
    return run("ss", ["-H", "-t", "-a", "-n", "-p"])
      .split("\n")
      .flatMap((line) => {
        const [state, , , local, remote, ...rest] = line.trim().split(/\s+/);
        const pid = /pid=(\d+)/.exec(rest.join(" "))?.[1];
        if (state === undefined || local === undefined || remote === undefined || pid === undefined) {
          return [];
        }
        const kind = state === "LISTEN" ? "LISTEN" : state === "ESTAB" ? "ESTABLISHED" : "OTHER";
        return [{ pid: Number(pid), state: kind, localPort: portOf(local), remotePort: portOf(remote) }];
      });
  }
  if (process.platform === "darwin") {
    const found: Connection[] = [];
    let pid = 0;
    let name = "";
    for (const line of run("lsof", ["-nP", "-iTCP", "-Ts", "-FpnT"]).split("\n")) {
      if (line.startsWith("p")) {
        pid = Number(line.slice(1));
      } else if (line.startsWith("n")) {
        name = line.slice(1);
      } else if (line.startsWith("TST=")) {
        const [local = "", remote = ""] = name.split("->");
        const state = line.slice(4);
        found.push({
          pid,
          state: state === "LISTEN" ? "LISTEN" : state === "ESTABLISHED" ? "ESTABLISHED" : "OTHER",
          localPort: portOf(local),
          remotePort: portOf(remote),
        });
      }
    }
    return found;
  }
  return powershell(
    'Get-NetTCPConnection | ForEach-Object { "$($_.OwningProcess)`t$($_.State)`t$($_.LocalPort)`t$($_.RemotePort)" }',
  )
    .split(/\r?\n/)
    .flatMap((line) => {
      const [pid, state, local, remote] = line.split("\t");
      return pid === undefined || state === undefined || pid === ""
        ? []
        : [
            {
              pid: Number(pid),
              state: state === "Listen" ? "LISTEN" : state === "Established" ? "ESTABLISHED" : "OTHER",
              localPort: Number(local),
              remotePort: Number(remote),
            },
          ];
    });
}

/** Calls `probe` until it gives a value, at most `ms` milliseconds. */
export async function waitFor<T>(probe: () => T | undefined, ms: number, what: string): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > until) {
      throw new Error(`timed out after ${String(ms)} ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The exit code and the standard error of a child, once it ended and its output is read. */
export const ended = (child: ChildProcess): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolve) => {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });

/** A path as the operating system names it, so that a short or linked spelling compares equal. */
export const real = (file: string): string => {
  try {
    const resolved = realpathSync.native(file);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  } catch {
    return file;
  }
};

/** The UI server of a release: a process that runs its `lib/dist/bin.js`, named by `cli`. */
export const serverOf = (all: readonly Process[], cli: string): Process | undefined =>
  all.find((p) => p.args.slice(1).some((arg) => real(arg) === real(cli)));
