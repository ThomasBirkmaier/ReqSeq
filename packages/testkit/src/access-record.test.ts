import { createHook, executionAsyncResource } from "node:async_hooks";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { AccessRecord, RecorderModules } from "./index.js";
import {
  accessViolations,
  frameStep,
  installAccessRecorder,
  isBelow,
  parseAccessRecords,
  stepOfStack,
} from "./index.js";

const ROOT = path.resolve("/checkout");
const at = (fn: string, file: string, async = false): string =>
  `    at ${async ? "async " : ""}${fn} (${pathToFileURL(path.join(ROOT, file)).href}:10:5)`;
const stackOf = (...frames: string[]): string => ["Error", ...frames].join("\n");

/** The frames of the UI server's request handler, from the socket to `handle`. */
const SERVER = [
  at("handle", "packages/api/dist/ui-server.js", true),
  at("Server.<anonymous>", "packages/api/dist/ui-server.js"),
];
/** A Git call of core's reader, below the frames given. */
const git = (...below: string[]): string =>
  stackOf(
    at("run", "packages/core/dist/git/reader.js"),
    at("status", "packages/core/dist/git/reader.js", true),
    ...below,
  );

describe("stepOfStack", () => {
  it("names the step of the innermost frame that names one", () => {
    expect(
      stepOfStack(git(at("run", "packages/core/dist/commands/workspace/status.js", true), ...SERVER)),
    ).toBe("command");
    expect(stepOfStack(git(at("invoke", "packages/core/dist/runtime/invoke.js", true), ...SERVER))).toBe(
      "command",
    );
    expect(stepOfStack(git(at("openChecked", "packages/api/dist/ui-server.js", true), ...SERVER))).toBe(
      "open",
    );
    expect(stepOfStack(git(at("warmWorkspace", "packages/core/dist/runtime/warm.js", true)))).toBe("open");
    expect(stepOfStack(git(at("take", "packages/core/dist/model/watch-change.js")))).toBe("watcher");
    expect(
      stepOfStack(
        git(
          at("load", "packages/core/dist/model/watch.js"),
          at("run", "packages/core/dist/commands/element/get.js"),
        ),
      ),
    ).toBe("watcher");
  });

  it("names no step for a git status that the UI server starts by itself (#2312)", () => {
    expect(stepOfStack(git(...SERVER))).toBeUndefined();
    expect(frameStep(git(...SERVER))).toBeNull();
    // Another function of the server file is not the workspace open, and the first line is the message.
    expect(stepOfStack(git(at("streamEvents", "packages/api/dist/ui-server.js"), ...SERVER))).toBeUndefined();
    expect(frameStep(`Error: ${at("run", "packages/core/dist/commands/x.js")}`)).toBeUndefined();
    expect(frameStep(git())).toBeUndefined();
  });

  it("names no step for the server's own code that core calls back into, as its change listener", () => {
    const listener = git(
      at("broadcast", "packages/api/dist/ui-server.js"),
      at("emit", "packages/core/dist/model/watch.js"),
      at("take", "packages/core/dist/model/watch-change.js", true),
    );
    expect(frameStep(listener)).toBeNull();
    // A command the server's handler runs is the command's.
    expect(frameStep(git(at("run", "packages/core/dist/commands/element/get.js", true), ...SERVER))).toBe(
      "command",
    );
  });
});

/** Fake modules that answer with the name of the call, and a hook whose current resource the test sets. */
const fakes = () => {
  const lines: string[] = [];
  const calls: string[] = [];
  const answer =
    (name: string) =>
    (...args: unknown[]): string => {
      calls.push(`${name} ${String(args[0])}`);
      return name;
    };
  class Worker {
    readonly threadId: number;
    constructor(id: number) {
      this.threadId = id;
    }
  }
  const hooks: {
    init?: (asyncId: number, type: string, trigger: number, resource: object) => void;
    enabled: boolean;
    current: object;
  } = { enabled: false, current: {} };
  const modules: RecorderModules = {
    childProcess: { spawn: answer("spawn"), execFile: answer("execFile"), fork: answer("fork") },
    fs: {
      readFile: answer("readFile"),
      openSync: answer("openSync"),
      renameSync: answer("renameSync"),
      constants: {},
    },
    fsPromises: { open: answer("open") },
    workerThreads: { Worker },
    asyncHooks: {
      createHook: (callbacks) => {
        hooks.init = callbacks.init;
        return {
          enable: () => (hooks.enabled = true),
          disable: () => (hooks.enabled = false),
        };
      },
      executionAsyncResource: () => hooks.current,
    },
  };
  return { lines, calls, modules, hooks, Worker };
};

describe("installAccessRecorder", () => {
  it("records each program and file call with its step and passes it on unchanged", () => {
    const { lines, calls, modules, hooks, Worker } = fakes();
    let stack = git(at("run", "packages/core/dist/commands/workspace/status.js"));
    const uninstall = installAccessRecorder(modules, {
      write: (line) => lines.push(line),
      pid: 7,
      thread: 0,
      execPath: "/node",
      cwd: () => ROOT,
      stack: () => stack,
    });
    expect(hooks.enabled).toBe(true);
    type Calls = Record<string, (x: unknown) => unknown>;
    const childProcess = modules.childProcess as Calls;
    const fs = modules.fs as Calls;
    const fsPromises = modules.fsPromises as Calls;
    expect(childProcess["spawn"]?.("/usr/bin/git")).toBe("spawn");
    stack = git(...SERVER);
    expect(childProcess["execFile"]?.("git")).toBe("execFile");
    childProcess["fork"]?.("worker.js");
    fs["readFile"]?.("ws/a.md");
    fs["openSync"]?.(pathToFileURL(path.join(ROOT, "ws", "b.md")));
    fs["readFile"]?.(Buffer.from("ws/c.md"));
    fsPromises["open"]?.(7);
    (fs["renameSync"] as (a: string, b: string) => unknown)("ws/d.tmp", "ws/d.md");
    const worker = new modules.workerThreads.Worker(...([3] as never[]));
    expect(worker).toBeInstanceOf(Worker);
    expect(calls).toEqual([
      "spawn /usr/bin/git",
      "execFile git",
      "fork worker.js",
      "readFile ws/a.md",
      `openSync ${pathToFileURL(path.join(ROOT, "ws", "b.md")).href}`,
      "readFile ws/c.md",
      "open 7",
      "renameSync ws/d.tmp",
    ]);
    const records = parseAccessRecords(`${lines.join("")}\n\n`);
    expect(records.map((r) => ("step" in r ? [r.kind, r.step, "stack" in r] : [r.kind]))).toEqual([
      ["process"],
      ["program", "command", false],
      ["program", null, true],
      ["program", null, true],
      ["file", null, true],
      ["file", null, true],
      ["file", null, true],
      ["file", null, true],
      ["file", null, true],
      ["file", null, true],
      ["worker", null, false],
    ]);
    expect(records.every((r) => r.pid === 7)).toBe(true);
    expect(
      records.map((r) => (r.kind === "file" ? r.file : r.kind === "program" ? r.program : undefined)),
    ).toEqual([
      undefined,
      "/usr/bin/git",
      "git",
      "/node",
      path.join(ROOT, "ws", "a.md"),
      path.join(ROOT, "ws", "b.md"),
      path.join(ROOT, "ws", "c.md"),
      null,
      path.join(ROOT, "ws", "d.tmp"),
      path.join(ROOT, "ws", "d.md"),
      undefined,
    ]);
    uninstall();
    expect(hooks.enabled).toBe(false);
    expect(modules.workerThreads.Worker).toBe(Worker);
    childProcess["spawn"]?.("git");
    expect(lines).toHaveLength(11);
  });

  it("gives a resource the step of the stack at its creation, else that of the resource it is created in", () => {
    const { lines, modules, hooks } = fakes();
    /** Core's own frames only: no step and no server code. */
    const CORE = git(at("load", "packages/core/dist/model/store.js"));
    let stack = CORE;
    installAccessRecorder(modules, {
      write: (line) => lines.push(line),
      pid: 7,
      thread: 0,
      execPath: "/node",
      cwd: () => ROOT,
      stack: () => stack,
    });
    const init = hooks.init ?? (() => undefined);
    const spawn = (): void => {
      (modules.childProcess as Record<string, (x: string) => void>)["spawn"]?.("git");
    };
    const unknown = {};
    init(1, "PROMISE", 0, unknown);
    stack = git(at("run", "packages/core/dist/commands/element/get.js"));
    const command = {};
    init(2, "Timeout", 0, command);
    // Created inside the command's resource where only core's frames show: it keeps the command's step.
    stack = CORE;
    hooks.current = command;
    const inner = {};
    init(3, "PROMISE", 0, inner);
    hooks.current = inner;
    spawn();
    // The server's own code in the command's resource: no step, and none for what it creates.
    stack = git(at("broadcast", "packages/api/dist/ui-server.js"));
    spawn();
    const server = {};
    init(4, "Timeout", 0, server);
    stack = CORE;
    hooks.current = server;
    spawn();
    hooks.current = unknown;
    spawn();
    expect(parseAccessRecords(lines.join("")).map((r) => ("step" in r ? r.step : r.kind))).toEqual([
      "process",
      "command",
      null,
      null,
      null,
    ]);
  });

  it("records nothing the write itself calls, and wraps only the calls a module has", () => {
    const { lines, modules, hooks } = fakes();
    const fs = modules.fs as Record<string, (x: string) => void>;
    let hookCalls = 0;
    installAccessRecorder(modules, {
      write: (line) => {
        lines.push(line);
        // As `fs.appendFileSync` does: it calls the wrapped `writeFileSync`, here `readFile`.
        fs["readFile"]?.("inner");
        hooks.init?.(9, "PROMISE", 0, {});
        hookCalls += 1;
      },
      pid: 7,
      thread: 1,
      execPath: "/node",
      cwd: () => ROOT,
      stack: () => {
        hooks.init?.(8, "PROMISE", 0, {});
        return git(...SERVER);
      },
    });
    fs["readFile"]?.("outer");
    expect(lines).toHaveLength(2);
    expect(hookCalls).toBe(2);
    expect(modules.fs["writeFile"]).toBeUndefined();
    expect(modules.fs["constants"]).toEqual({});
  });

  it("takes the stack of the call when none is given", () => {
    const { lines, modules } = fakes();
    installAccessRecorder(modules, {
      write: (line) => lines.push(line),
      pid: 7,
      thread: 0,
      execPath: "/node",
      cwd: () => ROOT,
    });
    (modules.childProcess as Record<string, (x: string) => void>)["spawn"]?.("git");
    const [, record] = parseAccessRecords(lines.join(""));
    expect(record).toMatchObject({
      kind: "program",
      step: null,
      stack: expect.stringContaining("at stepOfCall") as unknown,
    });
  });

  it("follows real asynchronous resources: Git the server starts during a command or on a change has no step", async () => {
    // The stack the recorder sees, from the real one: each function named below becomes a frame of its place;
    // every other frame is dropped, as core's own frames name no step.
    const PLACES: Readonly<Record<string, string>> = {
      commandWork: "packages/core/dist/commands/workspace/status.js",
      watchWork: "packages/core/dist/model/watch.js",
      serverWork: "packages/api/dist/ui-server.js",
    };
    const stack = (): string =>
      stackOf(
        ...String(new Error().stack)
          .split("\n")
          .flatMap((line) => {
            const name = Object.keys(PLACES).find((n) => line.includes(n));
            return name === undefined ? [] : [at(name, PLACES[name] ?? "")];
          }),
      );
    const modules = fakes().modules;
    const lines: string[] = [];
    // As the preload does: the frame that names a step may lie far below the call.
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = Infinity;
    const uninstall = installAccessRecorder(
      { ...modules, asyncHooks: { createHook, executionAsyncResource } },
      { write: (line) => lines.push(line), pid: 7, thread: 0, execPath: "/node", cwd: () => ROOT, stack },
    );
    const spawn = (modules.childProcess as Record<string, (x: string) => void>)["spawn"] ?? (() => undefined);
    const later = (run: () => void, ms: number): Promise<void> =>
      new Promise((resolve) =>
        setTimeout(() => {
          run();
          resolve();
        }, ms),
      );
    try {
      // The command starts its Git from a timer, when its own frames are gone from the stack.
      const commandWork = (): Promise<void> =>
        later(() => {
          spawn("command-git");
        }, 5);
      const command = commandWork();
      // Meanwhile the server starts Git from its own timer, and after awaiting the command.
      const serverWork = (then: Promise<void>): Promise<void> =>
        Promise.all([
          later(() => {
            spawn("server-git");
          }, 1),
          then.then(() => {
            spawn("after-command-git");
          }),
        ]).then(() => undefined);
      await serverWork(command);
      // The watcher calls back into the server's listener, which starts Git at once and from a timer.
      const watchWork = (listener: () => Promise<void>): Promise<void> => {
        spawn("watcher-git");
        return listener();
      };
      await watchWork(function serverWorkOnChange() {
        spawn("listener-git");
        return later(() => {
          spawn("listener-timer-git");
        }, 1);
      });
    } finally {
      uninstall();
      Error.stackTraceLimit = limit;
    }
    const steps = Object.fromEntries(
      parseAccessRecords(lines.join(""))
        .filter((r) => r.kind === "program")
        .map((r) => [r.program, r.step]),
    );
    expect(steps).toEqual({
      "command-git": "command",
      "server-git": null,
      "after-command-git": null,
      "watcher-git": "watcher",
      "listener-git": null,
      "listener-timer-git": null,
    });
  });
});

describe("accessViolations", () => {
  const ws = path.join(ROOT, "ws");
  const records: AccessRecord[] = [
    { kind: "process", pid: 7, thread: 0, execPath: "/node" },
    { kind: "program", pid: 7, thread: 0, call: "spawn", program: "/usr/bin/git", step: "command" },
    { kind: "program", pid: 7, thread: 0, call: "execFile", program: "git", step: null },
    { kind: "program", pid: 7, thread: 0, call: "fork", program: "/node", step: null },
    { kind: "file", pid: 7, thread: 0, call: "readFile", file: path.join(ws, "a.md"), step: null },
    { kind: "file", pid: 7, thread: 0, call: "readFile", file: ws, step: null },
    {
      kind: "file",
      pid: 7,
      thread: 0,
      call: "readFile",
      file: path.join(ROOT, "cache", "a.json"),
      step: null,
    },
    { kind: "file", pid: 7, thread: 0, call: "readFile", file: path.join(ROOT, "wsx", "a.md"), step: null },
    { kind: "file", pid: 7, thread: 0, call: "readFile", file: null, step: null },
    { kind: "file", pid: 7, thread: 0, call: "readFile", file: path.join(ws, "b.md"), step: "watcher" },
    { kind: "worker", pid: 7, thread: 0, worker: 2, step: "open" },
    { kind: "worker", pid: 7, thread: 0, worker: 3, step: null },
    { kind: "file", pid: 7, thread: 2, call: "readFileSync", file: path.join(ws, "c.md"), step: null },
    { kind: "file", pid: 7, thread: 3, call: "readFileSync", file: path.join(ws, "d.md"), step: null },
    { kind: "file", pid: 7, thread: 4, call: "readFileSync", file: path.join(ws, "e.md"), step: null },
  ];

  it("names each program and each workspace file without a step, the tool's own Node excepted", () => {
    expect(accessViolations(records, [ws])).toEqual([
      records[2],
      records[4],
      records[5],
      records[13],
      records[14],
    ]);
    expect(accessViolations(records, [])).toEqual([records[2]]);
    // A worker of another process is not this one's.
    const otherProcess: AccessRecord[] = [
      { kind: "worker", pid: 7, thread: 0, worker: 2, step: "open" },
      { kind: "file", pid: 8, thread: 2, call: "readFileSync", file: path.join(ws, "c.md"), step: null },
    ];
    expect(accessViolations(otherProcess, [ws])).toEqual([otherProcess[1]]);
    expect(isBelow(path.join(ws, "a"), ws)).toBe(true);
    expect(isBelow(path.join(ROOT, "wsx"), ws)).toBe(false);
  });
});
