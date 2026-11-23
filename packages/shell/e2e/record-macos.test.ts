// How the macOS recorder reads eslogger and tcpdump (record-macos.ts); no macOS needed.
import { describe, expect, it } from "vitest";
import type { EsEvent } from "./record-macos.js";
import {
  droppedByKernel,
  engineProcesses,
  missing,
  onLoopback,
  parseEsLine,
  parsePacket,
  ruleCounters,
  shellTree,
} from "./record-macos.js";

const WEBCONTENT =
  "/System/Volumes/Preboot/Cryptexes/OS/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent";
const proc = (pid: number, path: string, ppid = 1) => ({
  audit_token: { pid },
  ppid,
  executable: { path },
  start_time: "2026-01-01T00:00:01.000000Z",
});

describe("the macOS recorder's eslogger lines", () => {
  it("reads execs, forks, opens for writing, creates and renames", () => {
    const line = (global: number, event: Record<string, unknown>, process = proc(7, "/bin/sh", 5)) =>
      JSON.stringify({
        global_seq_num: global,
        seq_num: global,
        time: "2026-01-01T00:00:02Z",
        process,
        event,
      });
    expect(parseEsLine(line(1, { exec: { target: proc(7, "/bin/ls"), args: ["ls", "-l"] } }))).toMatchObject({
      kind: "exec",
      pid: 7,
      ppid: 5,
      program: "/bin/sh",
      target: { pid: 7, program: "/bin/ls", args: ["ls", "-l"] },
    });
    expect(parseEsLine(line(2, { fork: { child: proc(8, "/bin/sh", 7) } }))?.target).toEqual({
      pid: 8,
      program: "/bin/sh",
      args: [],
    });
    expect(parseEsLine(line(3, { open: { file: { path: "/tmp/a" }, fflag: 0x1 } }))).toMatchObject({
      path: "/tmp/a",
      write: false,
    });
    expect(parseEsLine(line(4, { open: { file: { path: "/tmp/a" }, fflag: 0x602 } }))?.write).toBe(true);
    expect(
      parseEsLine(
        line(5, { create: { destination: { new_path: { dir: { path: "/tmp" }, filename: "b" } } } }),
      ),
    ).toMatchObject({ path: "/tmp/b", write: true });
    expect(
      parseEsLine(
        line(6, {
          rename: { source: { path: "/tmp/b" }, destination: { existing_file: { path: "/tmp/c" } } },
        }),
      ),
    ).toMatchObject({ path: "/tmp/c", write: true });
    expect(parseEsLine(line(7, { exit: { stat: 0 } }))).toMatchObject({ kind: "exit", pid: 7 });
    expect(parseEsLine("not json")).toBeUndefined();
    expect(parseEsLine("{}")).toBeUndefined();
  });

  it("counts the sequence numbers missing between the first and the last event, also per type", () => {
    const at = (kind: string, global: number, seq: number) => ({ kind, global, seq }) as EsEvent;
    expect(missing([at("open", 10, 0), at("exec", 11, 0), at("open", 12, 1)])).toEqual({
      global: 0,
      byKind: { open: 0, exec: 0 },
    });
    expect(missing([at("open", 10, 0), at("open", 14, 3)])).toEqual({ global: 3, byKind: { open: 2 } });
  });
});

describe("the macOS recorder's process tree", () => {
  const at = (global: number, kind: string, pid: number, extra: Partial<EsEvent> = {}): EsEvent => ({
    kind,
    global,
    seq: global,
    time: "",
    pid,
    ppid: -1,
    program: "",
    start: "",
    ...extra,
  });
  const exec = (pid: number, program: string, args: string[] = []) => ({ target: { pid, program, args } });

  it("starts at the shell's exec under sudo, follows forks and execs, and marks the server's subtree", () => {
    const events = [
      at(1, "exec", 50, { ppid: 40, ...exec(50, "/usr/bin/env") }), // sudo's child runs env
      at(2, "exec", 99, { ppid: 1, ...exec(99, "/x/reqseq-shell") }), // another shell, not of this sudo
      at(3, "exec", 50, { ppid: 40, ...exec(50, "/x/reqseq-shell") }),
      at(4, "fork", 50, { target: { pid: 51, program: "/x/reqseq-shell", args: [] } }),
      at(5, "exec", 51, exec(51, "/n/node", ["node", "bin.js", "ui", "--no-open"])),
      at(6, "fork", 51, { target: { pid: 52, program: "/n/node", args: [] } }),
      at(7, "exec", 52, exec(52, "/usr/bin/git", ["git", "rev-parse"])),
      at(8, "exit", 52),
      at(9, "fork", 60, { target: { pid: 52, program: "/bin/sh", args: [] } }), // the ID again, outside the tree
      at(10, "exec", 52, exec(52, "/bin/ls")),
      at(11, "fork", 50, { target: { pid: 53, program: "/x/reqseq-shell", args: [] } }),
      // Another program with the server's arguments is not the server.
      at(12, "exec", 53, exec(53, "/bin/other", ["other", "ui", "--no-open"])),
    ];
    const { shellPid, processes } = shellTree(events, 40, "/x/reqseq-shell", "/n/node");
    expect(shellPid).toBe(50);
    expect(processes.map((p) => [p.pid, p.server, p.programs.map((r) => r.program)])).toEqual([
      [50, false, ["/x/reqseq-shell"]],
      [51, true, ["/x/reqseq-shell", "/n/node"]],
      [52, true, ["/n/node", "/usr/bin/git"]],
      [53, false, ["/x/reqseq-shell", "/bin/other"]],
    ]);
    expect(shellTree(events, 41, "/x/reqseq-shell", "/n/node")).toEqual({
      shellPid: undefined,
      processes: [],
    });
  });

  it("takes every engine process that started while the shell ran, with the arguments of its exec", () => {
    const events = [
      at(1, "open", 70, { program: WEBCONTENT, start: "2026-01-01T00:00:00Z" }), // before the shell
      at(2, "exec", 71, { time: "2026-01-01T00:00:02Z", ...exec(71, WEBCONTENT, ["wc", "-x"]) }),
      at(3, "open", 71, { program: WEBCONTENT, start: "2026-01-01T00:00:02Z" }),
      at(4, "open", 72, { program: WEBCONTENT, start: "2026-01-01T00:00:03Z" }), // its exec is not in the stream
      at(5, "open", 73, { program: "/bin/sh", start: "2026-01-01T00:00:03Z" }),
    ];
    expect(engineProcesses(events, "2026-01-01T00:00:01Z", "2026-01-01T00:00:09Z")).toEqual([
      { pid: 71, program: WEBCONTENT, start: "2026-01-01T00:00:02Z", args: ["wc", "-x"] },
      { pid: 72, program: WEBCONTENT, start: "2026-01-01T00:00:03Z", args: undefined },
    ]);
  });
});

describe("the macOS recorder's packets and pf counters", () => {
  it("reads the process, the effective process and the addresses of a pktap line", () => {
    const dns = parsePacket(
      "20:08:42.851086 (en0, proc mDNSResponder:223, eproc node:3301, svc BE, out, so) IP 192.168.64.13.58916 > 192.168.64.1.53: 7338+ A? x.example.com. (54)",
    );
    expect(dns).toMatchObject({
      iface: "en0",
      pids: [223, 3301],
      source: "192.168.64.13",
      destination: "192.168.64.1",
    });
    // The reset pf sends for a refused connection comes in on lo0, with the addresses of the connection.
    const reset = parsePacket(
      "20:08:43.113401 (lo0, proc node:3350, svc BE, in, so) IP 192.0.2.1.80 > 192.168.64.13.49299: Flags [R.], seq 0, ack 1, win 0, length 0",
    );
    expect(reset).toMatchObject({ iface: "lo0", pids: [3350], source: "192.0.2.1" });
    expect(reset !== undefined && onLoopback(reset)).toBe(false);
    const local = parsePacket(
      "20:08:43.1 (lo0, proc com.apple.WebKit.Networking:3365, svc BE, out, so) IP 127.0.0.1.50000 > 127.0.0.1.49305: Flags [S], length 0",
    );
    expect(local !== undefined && onLoopback(local)).toBe(true);
    const v6 = parsePacket(
      "20:08:43.1 (lo0, proc node:1, svc BE, out, so) IP6 ::1.50000 > ::1.49305: Flags [S], length 0",
    );
    expect(v6 !== undefined && onLoopback(v6)).toBe(true);
    expect(parsePacket("tcpdump: listening on pktap")).toBeUndefined();
  });

  it("reads the rule counters of pfctl and what tcpdump dropped", () => {
    const rules = [
      "block return out log quick inet from any to ! 127.0.0.0/8 group = 4265",
      "  [ Evaluations: 8291      Packets: 1         Bytes: 64          States: 0     ]",
      "block return out log quick inet6 from any to ! ::1 group = 4265",
      "  [ Evaluations: 3878      Packets: 0         Bytes: 0           States: 0     ]",
    ].join("\n");
    expect(ruleCounters(rules)).toEqual([1, 0]);
    expect(
      droppedByKernel("12 packets captured\n15 packets received by filter\n0 packets dropped by kernel\n"),
    ).toBe(0);
    expect(droppedByKernel("")).toBeUndefined();
  });
});
