import fs from "node:fs/promises";
import path from "node:path";
import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import type { CommandRuntime } from "@logreq/core";
import { CommandError, Workspace, createCommandRuntime, defineWorkspaceState } from "@logreq/core";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentActivity, PortMessage } from "../shared/protocol.js";
import type { Channel, CoreHostOptions, WatchedChange } from "./host.js";
import { FILE_HOST, createCoreHost, lexicalTarget } from "./host.js";

const runtime = createCommandRuntime();

/** The host's end of a Node MessageChannel. */
const nodeChannel = (port: MessagePort): Channel => ({
  post: (message) => {
    port.postMessage(message);
  },
  onMessage: (listener) => {
    port.on("message", listener);
  },
  onClose: (listener) => {
    port.on("close", listener);
  },
  close: () => {
    port.close();
  },
});

/** The window's end: sends requests and collects what comes back. */
class Window {
  readonly received: PortMessage[] = [];
  readonly #port: MessagePort;
  readonly #waiting: (() => void)[] = [];

  constructor(port: MessagePort) {
    this.#port = port;
    port.on("message", (message: PortMessage) => {
      this.received.push(message);
      for (const wake of this.#waiting.splice(0)) {
        wake();
      }
    });
  }

  send(message: unknown): void {
    this.#port.postMessage(message);
  }

  /** The answer to request `id`. */
  async answer(id: number): Promise<PortMessage> {
    for (;;) {
      const found = this.received.find((m) => "id" in m && m.id === id);
      if (found !== undefined) {
        return found;
      }
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
  }

  close(): void {
    this.#port.close();
  }
}

const fixtures: FixtureWorkspace[] = [];
const workspaces: Workspace[] = [];
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((w) => w.close()));
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const setup = async (
  options: {
    runtime?: CommandRuntime;
    files?: Record<string, string | Uint8Array>;
    activity?: CoreHostOptions["activity"];
    changes?: CoreHostOptions["changes"];
  } = {},
) => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { "images/dot.png": PNG, "images/notes.txt": "text", ...options.files },
  });
  fixtures.push(fixture);
  const workspace = new Workspace(fixture.root);
  workspaces.push(workspace);
  const host = createCoreHost({
    runtime: options.runtime ?? runtime,
    workspace,
    ...(options.activity === undefined ? {} : { activity: options.activity }),
    ...(options.changes === undefined ? {} : { changes: options.changes }),
  });
  const connect = (): Window => {
    const { port1, port2 } = new MessageChannel();
    host.connect(nodeChannel(port1));
    return new Window(port2);
  };
  return { fixture, workspace, host, connect };
};

describe("createCoreHost: catalog calls", () => {
  it("answers an invoke with what core gives, output or error object (SR-080 AK2)", async () => {
    const { workspace, connect } = await setup();
    const window = connect();
    window.send({ id: 1, kind: "invoke", name: "element.get", input: { ref: "SR-e88fb3" } });
    window.send({ id: 2, kind: "invoke", name: "element.get", input: { ref: "SR-ffffff" } });
    window.send({ id: 3, kind: "invoke", name: "workspace.status", input: {} });
    // The input goes to core as it came, as the API passes `null`: core refuses it.
    window.send({ id: 4, kind: "invoke", name: "workspace.status", input: null });
    const expected = await runtime.invoke("element.get", { ref: "SR-e88fb3" }, { workspace });
    expect(await window.answer(1)).toEqual({ id: 1, result: { ok: true, output: expected } });
    const refused = await window.answer(2);
    expect(refused).toEqual({
      id: 2,
      result: { ok: false, error: expect.objectContaining({ code: "ref.unknown" }) as unknown },
    });
    expect(await window.answer(4)).toMatchObject({
      id: 4,
      result: { ok: false, error: { code: "input.invalid" } },
    });
    expect(await window.answer(3)).toMatchObject({
      id: 3,
      result: { ok: true, output: { name: "Weather station" } },
    });
    window.close();
  });

  it("lists the catalog as the API does, each command with whether it is implemented", async () => {
    const { connect } = await setup();
    const window = connect();
    window.send({ id: 7, kind: "commands" });
    const answer = await window.answer(7);
    expect(answer).toEqual({
      id: 7,
      commands: runtime.contracts.commands.map((entry) => ({
        ...entry,
        implemented: runtime.commands.has(entry.name),
      })),
    });
    window.close();
  });

  it("ignores what is no request", async () => {
    const { connect } = await setup();
    const window = connect();
    window.send({ kind: "invoke", name: "workspace.status" });
    window.send("delete everything");
    window.send({ id: 2, kind: "commands" });
    await window.answer(2);
    expect(window.received).toHaveLength(1);
    window.close();
  });

  it("tells every window after a write command, and no window after a read", async () => {
    const { connect } = await setup();
    const writer = connect();
    const other = connect();
    writer.send({ id: 1, kind: "invoke", name: "workspace.status", input: {} });
    await writer.answer(1);
    writer.send({
      id: 2,
      kind: "invoke",
      name: "element.create",
      input: {
        type: "system-requirement",
        title: "Show gusts",
        properties: { "requirement-type": "functional", "acceptance-criteria": ["Shown."] },
      },
    });
    const created = await writer.answer(2);
    expect(created).toMatchObject({ id: 2, result: { ok: true } });
    await waitUntil(() => other.received.length === 1 && writer.received.length === 3);
    expect(other.received).toEqual([{ event: "workspace-changed", data: { reason: "written" } }]);
    expect(writer.received.at(-1)).toEqual({ event: "workspace-changed", data: { reason: "written" } });
    writer.close();
    other.close();
  });

  it("maps a failure that is no CommandError to internal", async () => {
    const failing: CommandRuntime = {
      ...runtime,
      invoke: () => Promise.reject(new Error("secret /home/me/file")),
    };
    const { connect } = await setup({ runtime: failing });
    const window = connect();
    window.send({ id: 1, kind: "invoke", name: "workspace.status", input: {} });
    expect(await window.answer(1)).toEqual({
      id: 1,
      result: { ok: false, error: { code: "internal", message: "Internal error in the app" } },
    });
    window.close();
  });

  it("aborts the running commands of a window whose port closes, and does not answer it", async () => {
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted: AbortSignal | undefined;
    const waiting: CommandRuntime = {
      ...runtime,
      invoke: (_name, _input, ctx) => {
        aborted = ctx.signal;
        started();
        return new Promise((_resolve, reject) => {
          ctx.signal?.addEventListener("abort", () => {
            reject(new CommandError("internal", "aborted", { aborted: true }));
          });
        });
      },
    };
    const { connect } = await setup({ runtime: waiting });
    const window = connect();
    window.send({ id: 1, kind: "invoke", name: "workspace.status", input: {} });
    await running;
    window.close();
    await waitUntil(() => aborted?.aborted === true);
    expect(window.received).toEqual([]);
  });

  it("closes every port and the workspace on close", async () => {
    const { host, connect, workspace } = await setup();
    const window = connect();
    let closed = false;
    window.send({ id: 1, kind: "commands" });
    await window.answer(1);
    const { port1, port2 } = new MessageChannel();
    port2.on("close", () => {
      closed = true;
    });
    host.connect(nodeChannel(port1));
    await host.close();
    await waitUntil(() => closed);
    expect(() => workspace.get(defineWorkspaceState("probe", () => 1))).toThrow();
  });
});

describe("createCoreHost: access and agent activity (SR-117)", () => {
  const ACTIVITY: AgentActivity = {
    access: "mcp",
    command: "element.get",
    effect: "read",
    at: "2026-10-27T09:30:00.123Z",
    element: { id: "0f3c6a1e-2b4d-4e8f-9a1b-46fb54e88fb3", repository: "system" },
  };

  it("calls core with the access app (ADR-0002 rule 4), reads, writes and its own status alike", async () => {
    const accesses: [string, unknown][] = [];
    const recording: CommandRuntime = {
      ...runtime,
      invoke: (name, input, ctx) => {
        accesses.push([name, ctx.access]);
        return runtime.invoke(name, input, ctx);
      },
    };
    const { host, connect } = await setup({ runtime: recording });
    const window = connect();
    window.send({ id: 1, kind: "invoke", name: "element.get", input: { ref: "SR-e88fb3" } });
    window.send({ id: 2, kind: "invoke", name: "element.create", input: {} });
    await window.answer(1);
    await window.answer(2);
    expect(await host.file("logreq-file://workspace/system/images/dot.png")).toMatchObject({ status: 200 });
    expect(accesses.sort()).toEqual([
      ["element.create", "app"],
      ["element.get", "app"],
      ["workspace.status", "app"],
    ]);
    window.close();
  });

  it("sends each access an agent made to every window, past a port that is gone", async () => {
    let report: (activity: AgentActivity) => void = () => undefined;
    const close = vi.fn();
    const { host, connect } = await setup({
      activity: (onAccess) => {
        report = onAccess;
        return { close };
      },
    });
    const first = connect();
    const second = connect();
    const gone: Channel = {
      post: () => {
        throw new Error("The port is closed");
      },
      onMessage: () => undefined,
      onClose: () => undefined,
      close: () => undefined,
    };
    host.connect(gone);
    report(ACTIVITY);
    await waitUntil(() => first.received.length === 1 && second.received.length === 1);
    expect(first.received).toEqual([{ event: "agent-activity", data: ACTIVITY }]);
    expect(second.received).toEqual(first.received);
    expect(close).not.toHaveBeenCalled();
    await host.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("without a watch, closes as before", async () => {
    const { host, connect } = await setup();
    const window = connect();
    await host.close();
    expect(window.received).toEqual([]);
  });
});

describe("createCoreHost: files for logreq-file:", () => {
  it("serves images inside an available repository", async () => {
    const { host } = await setup();
    expect(await host.file("logreq-file://workspace/system/images/dot.png")).toEqual({
      status: 200,
      mimeType: "image/png",
      data: PNG,
    });
    expect(await host.file("logreq-file://workspace/system/images/dot%2Epng")).toEqual({
      status: 200,
      mimeType: "image/png",
      data: PNG,
    });
  });

  it("serves nothing else: other protocols, other types, unknown repositories, folders, missing files", async () => {
    const { host, fixture } = await setup();
    await fs.mkdir(path.join(fixture.root, "images", "folder.png"));
    for (const url of [
      "app://logreq/images/dot.png",
      "not a url",
      "logreq-file://workspace/system/images/notes.txt",
      "logreq-file://workspace/system/images/%E0%A4%A.png",
      "logreq-file://workspace/vault/images/dot.png",
      "logreq-file://workspace/system/images/missing.png",
      "logreq-file://workspace/system/images/folder.png",
      "logreq-file://workspace/system/..%2F..%2Fdot.png",
      // The repository is the first name of the path; the host is always `workspace`.
      "logreq-file://system/images/dot.png",
      "logreq-file://workspace/dot.png",
      "logreq-file://workspace//images/dot.png",
    ]) {
      expect([url, await host.file(url)]).toEqual([url, { status: 404 }]);
    }
  });

  it("asks the file system nothing for a path that is not plainly inside the repository", async () => {
    const { host } = await setup();
    // Warm the repository folders (workspace.status may resolve paths itself).
    await host.file("logreq-file://workspace/system/images/dot.png");
    const realpath = vi.spyOn(fs, "realpath");
    const stat = vi.spyOn(fs, "stat");
    try {
      for (const url of [
        // A UNC path (Windows opens the SMB share), a drive, a stream name, NUL.
        "logreq-file://workspace/system/%5C%5Cattacker%5Cshare%5Cx.png",
        "logreq-file://workspace/system/C:%2Fx.png",
        "logreq-file://workspace/system/images/dot.png:stream.png",
        "logreq-file://workspace/system/images/dot%00.png",
        // Out of the repository (on macOS, /net/<host> mounts NFS).
        "logreq-file://workspace/system/..%2F..%2F..%2F..%2F..%2Fnet%2Fhost%2Fx.png",
        "logreq-file://workspace/system/%2Fnet%2Fhost%2Fx.png",
      ]) {
        expect([url, await host.file(url)]).toEqual([url, { status: 404 }]);
      }
      expect(realpath).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
    } finally {
      realpath.mockRestore();
      stat.mockRestore();
    }
  });

  it("serves no file that a link inside the repository points outside of", async () => {
    const { host, fixture } = await setup();
    const outside = path.join(path.dirname(fixture.root), `${path.basename(fixture.root)}-outside.png`);
    await fs.writeFile(outside, PNG);
    try {
      await fs.symlink(outside, path.join(fixture.root, "images", "link.png"), "file");
      expect(await host.file("logreq-file://workspace/system/images/link.png")).toEqual({ status: 404 });
    } finally {
      await fs.rm(outside, { force: true });
    }
  });

  it("finds repositories again after a write and after a failed status", async () => {
    let status: "fail" | "fake" | "real" = "fail";
    const calls: string[] = [];
    const switching: CommandRuntime = {
      ...runtime,
      invoke: (name, input, ctx) => {
        calls.push(name);
        if (name !== "workspace.status" || status === "real") {
          return runtime.invoke(name, input, ctx);
        }
        return status === "fail"
          ? Promise.reject(new CommandError("workspace.not-found", "none"))
          : Promise.resolve({
              name: "x",
              readOnly: false,
              metamodel: { repository: "system", path: "metamodel", valid: true },
              repositories: [
                { name: "system", available: true },
                { name: "vault", available: false, path: "../vault" },
              ],
            });
      },
    };
    const { host, connect } = await setup({ runtime: switching });
    expect(await host.file("logreq-file://workspace/system/images/dot.png")).toEqual({ status: 404 });
    status = "fake";
    // A repository without a path, and one that is not here, serve nothing.
    expect(await host.file("logreq-file://workspace/system/images/dot.png")).toEqual({ status: 404 });
    expect(await host.file("logreq-file://workspace/vault/images/dot.png")).toEqual({ status: 404 });
    status = "real";
    expect(await host.file("logreq-file://workspace/system/images/dot.png")).toEqual({ status: 404 });
    const window = connect();
    window.send({ id: 1, kind: "invoke", name: "element.create", input: { type: "nope", title: "x" } });
    await window.answer(1);
    // A failed write keeps what was found.
    expect(await host.file("logreq-file://workspace/system/images/dot.png")).toEqual({ status: 404 });
    window.send({
      id: 2,
      kind: "invoke",
      name: "element.create",
      input: {
        type: "system-requirement",
        title: "Show gusts",
        properties: { "requirement-type": "functional", "acceptance-criteria": ["Shown."] },
      },
    });
    await window.answer(2);
    expect((await host.file("logreq-file://workspace/system/images/dot.png")).status).toBe(200);
    expect(calls.filter((name) => name === "workspace.status")).toHaveLength(3);
    window.close();
  });
});

describe("createCoreHost: changes from outside (SR-116, SR-106)", () => {
  /** A watcher whose batches the test sends with `emit`. */
  const fakeWatcher = () => {
    const listeners = new Set<(change: WatchedChange) => void>();
    const unsubscribed = vi.fn();
    const changes: CoreHostOptions["changes"] = (listener) => {
      listeners.add(listener);
      return () => {
        unsubscribed();
        listeners.delete(listener);
      };
    };
    const emit = (change: WatchedChange): void => {
      for (const listener of listeners) {
        listener(change);
      }
    };
    return { changes, emit, unsubscribed, listeners };
  };
  const lists = (changed: readonly string[] = []) => ({ added: [], changed, removed: [] });

  it("sends each batch of the watcher to every window as workspace-changed external, and stops on close", async () => {
    const watcher = fakeWatcher();
    const { connect, host } = await setup({ changes: watcher.changes });
    const one = connect();
    const two = connect();
    watcher.emit({ scope: "elements", elements: { added: ["a"], changed: ["b"], removed: ["c"] } });
    watcher.emit({ scope: "workspace", elements: lists() });
    await waitUntil(() => one.received.length === 2 && two.received.length === 2);
    for (const window of [one, two]) {
      expect(window.received).toEqual([
        {
          event: "workspace-changed",
          data: {
            reason: "external",
            scope: "elements",
            elements: { added: ["a"], changed: ["b"], removed: ["c"] },
          },
        },
        { event: "workspace-changed", data: { reason: "external", scope: "workspace", elements: lists() } },
      ]);
    }
    await host.close();
    expect(watcher.unsubscribed).toHaveBeenCalledOnce();
    expect(watcher.listeners.size).toBe(0);
  });

  it("sends more than 1,000 UUIDs as a change of the workspace with empty lists (N-036)", async () => {
    const watcher = fakeWatcher();
    const { connect } = await setup({ changes: watcher.changes });
    const window = connect();
    watcher.emit({ scope: "elements", elements: lists(Array.from({ length: 1001 }, (_, at) => String(at))) });
    await waitUntil(() => window.received.length === 1);
    expect(window.received[0]).toEqual({
      event: "workspace-changed",
      data: { reason: "external", scope: "workspace", elements: lists() },
    });
    window.close();
  });

  it("finds the repositories again after a change of the metamodel or the workspace, not of elements", async () => {
    const watcher = fakeWatcher();
    const calls: string[] = [];
    const counting: CommandRuntime = {
      ...runtime,
      invoke: (name, input, ctx) => {
        calls.push(name);
        return runtime.invoke(name, input, ctx);
      },
    };
    const { host } = await setup({ runtime: counting, changes: watcher.changes });
    const status = (): number => calls.filter((name) => name === "workspace.status").length;
    const image = "logreq-file://workspace/system/images/dot.png";
    expect((await host.file(image)).status).toBe(200);
    watcher.emit({ scope: "elements", elements: lists(["a"]) });
    expect((await host.file(image)).status).toBe(200);
    expect(status()).toBe(1);
    watcher.emit({ scope: "metamodel", elements: lists() });
    expect((await host.file(image)).status).toBe(200);
    expect(status()).toBe(2);
    watcher.emit({ scope: "workspace", elements: lists() });
    expect((await host.file(image)).status).toBe(200);
    expect(status()).toBe(3);
  });
});

describe("lexicalTarget", () => {
  it("names a file inside the folder, on POSIX and on Windows", () => {
    expect(FILE_HOST).toBe("workspace");
    expect(lexicalTarget("/ws/system", "images/a.png", path.posix)).toBe("/ws/system/images/a.png");
    expect(lexicalTarget("C:\\ws\\system", "images/a.png", path.win32)).toBe("C:\\ws\\system\\images\\a.png");
  });

  it("refuses backslashes, colons, NUL and anything outside the folder, on POSIX and on Windows", () => {
    for (const [paths, folder] of [
      [path.posix, "/ws/system"],
      [path.win32, "C:\\ws\\system"],
    ] as const) {
      for (const relative of [
        "\\\\attacker\\share\\x.png",
        "//attacker/share/x.png",
        "C:/x.png",
        "c:x.png",
        "a.png:stream",
        "a\0.png",
        "../x.png",
        "images/../../x.png",
        "/net/host/x.png",
        "",
        ".",
      ]) {
        expect([paths.sep, relative, lexicalTarget(folder, relative, paths)]).toEqual([
          paths.sep,
          relative,
          undefined,
        ]);
      }
    }
  });
});

describe("createCoreHost: shutdown", () => {
  /** A runtime whose write command waits until `finish` is called; reads wait for their abort. */
  const slowRuntime = () => {
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const signals: (AbortSignal | undefined)[] = [];
    const slow: CommandRuntime = {
      ...runtime,
      invoke: async (name, _input, ctx) => {
        signals.push(ctx.signal);
        if (name === "element.create") {
          await finished;
          return { done: true };
        }
        return new Promise((_resolve, reject) => {
          ctx.signal?.addEventListener("abort", () => {
            reject(new CommandError("internal", "aborted", { aborted: true }));
          });
        });
      },
    };
    return {
      slow,
      finish: () => {
        finish();
      },
      signals,
    };
  };

  it("lets a write run to its end when its window goes away, and tells the other windows", async () => {
    const { slow, finish, signals } = slowRuntime();
    const { connect } = await setup({ runtime: slow });
    const writer = connect();
    const other = connect();
    writer.send({ id: 1, kind: "invoke", name: "element.create", input: {} });
    await waitUntil(() => signals.length === 1);
    expect(signals).toEqual([undefined]);
    writer.close();
    finish();
    await waitUntil(() => other.received.length === 1);
    expect(other.received).toEqual([{ event: "workspace-changed", data: { reason: "written" } }]);
    other.close();
  });

  it("aborts reads, waits for running writes, then closes the ports and the workspace", async () => {
    const { slow, finish, signals } = slowRuntime();
    const { connect, host, workspace } = await setup({ runtime: slow });
    const window = connect();
    window.send({ id: 1, kind: "invoke", name: "workspace.status", input: {} });
    window.send({ id: 2, kind: "invoke", name: "element.create", input: {} });
    await waitUntil(() => signals.length === 2);
    let closed = false;
    const closing = host.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(signals[0]?.aborted).toBe(true);
    expect(closed).toBe(false);
    expect(() => workspace.get(defineWorkspaceState("open", () => 1))).not.toThrow();
    finish();
    await closing;
    expect(() => workspace.get(defineWorkspaceState("closed", () => 1))).toThrow();
  });
});

/** Waits until `condition` holds (a few seconds at most). */
const waitUntil = async (condition: () => boolean): Promise<void> => {
  const end = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > end) {
      throw new Error("condition did not hold");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
