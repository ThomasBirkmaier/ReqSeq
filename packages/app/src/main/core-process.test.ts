import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreRequest, WorkspaceMessage } from "../shared/protocol.js";
import { WORKSPACE_CHANNEL } from "../shared/protocol.js";
import type { CoreChild, TransferablePort, WorkspaceTarget } from "./core-process.js";
import { CoreProcess, MAX_RESTARTS, RESTART_WINDOW_MS, STOP_TIMEOUT_MS } from "./core-process.js";

class FakeChild extends EventEmitter implements CoreChild {
  readonly sent: { message: CoreRequest; transfer: TransferablePort[] | undefined }[] = [];
  killed = false;

  postMessage(message: CoreRequest, transfer?: TransferablePort[]): void {
    this.sent.push({ message, transfer });
  }

  kill(): boolean {
    this.killed = true;
    this.emit("exit", 15);
    return true;
  }

  /** The child ends as it does after `stop`. */
  exit(code = 0): void {
    this.emit("exit", code);
  }
}

class FakeTarget implements WorkspaceTarget {
  readonly sent: { channel: string; message: WorkspaceMessage; transfer: TransferablePort[] | undefined }[] =
    [];
  destroyed = false;

  postMessage(channel: string, message: WorkspaceMessage, transfer?: TransferablePort[]): void {
    this.sent.push({ channel, message, transfer });
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

const setup = () => {
  const children: FakeChild[] = [];
  const log = vi.fn<(line: string) => void>();
  let pairs = 0;
  const core = new CoreProcess({
    fork: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    channel: () => {
      pairs++;
      return { port1: { side: 1, pair: pairs }, port2: { side: 2, pair: pairs } };
    },
    log,
  });
  return { core, children, log };
};

/** Lets `stop` see the child end once it was asked to. */
const exitOnStop = (child: FakeChild): void => {
  const post = child.postMessage.bind(child);
  child.postMessage = (message, transfer) => {
    post(message, transfer);
    if (message.type === "stop") {
      queueMicrotask(() => {
        child.exit();
      });
    }
  };
};

describe("CoreProcess", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells a window without a workspace that none is open", () => {
    const { core } = setup();
    const target = new FakeTarget();
    core.attach(target);
    expect(core.running).toBe(false);
    expect(target.sent).toEqual([
      { channel: WORKSPACE_CHANNEL, message: { open: false }, transfer: undefined },
    ]);
  });

  it("opens a workspace in a core process and hands each window load a port to it", async () => {
    const { core, children } = setup();
    await core.open("/ws");
    expect(core.running).toBe(true);
    const [child] = children;
    expect(child?.sent).toEqual([{ message: { type: "open", folder: "/ws" }, transfer: undefined }]);
    const target = new FakeTarget();
    core.attach(target);
    core.attach(target);
    expect(child?.sent.slice(1)).toEqual([
      { message: { type: "connect" }, transfer: [{ side: 1, pair: 1 }] },
      { message: { type: "connect" }, transfer: [{ side: 1, pair: 2 }] },
    ]);
    expect(target.sent).toEqual([
      { channel: WORKSPACE_CHANNEL, message: { open: true }, transfer: [{ side: 2, pair: 1 }] },
      { channel: WORKSPACE_CHANNEL, message: { open: true }, transfer: [{ side: 2, pair: 2 }] },
    ]);
  });

  it("stops the current core process before another workspace opens, and tells the window", async () => {
    const { core, children } = setup();
    const target = new FakeTarget();
    core.attach(target);
    await core.open("/one");
    const first = children[0];
    if (first === undefined) {
      throw new Error("no child");
    }
    exitOnStop(first);
    await core.open("/two");
    expect(first.sent.at(-1)?.message).toEqual({ type: "stop" });
    expect(first.killed).toBe(false);
    expect(children[1]?.sent[0]?.message).toEqual({ type: "open", folder: "/two" });
    expect(target.sent.map((s) => s.message)).toEqual([
      { open: false },
      { open: true, reason: "opened" },
      { open: true, reason: "opened" },
    ]);
  });

  it("opens one workspace after the other, so no core process is left behind", async () => {
    const { core, children } = setup();
    const opened = [core.open("/one"), core.open("/two")];
    await vi.waitFor(() => {
      expect(children).toHaveLength(1);
    });
    children[0]?.exit();
    await Promise.all(opened);
    expect(children.map((c) => c.sent[0]?.message)).toEqual([
      { type: "open", folder: "/one" },
      { type: "open", folder: "/two" },
    ]);
    expect(children[0]?.sent.at(-1)?.message).toEqual({ type: "stop" });
    expect(core.running).toBe(true);
  });

  it("kills a core process that does not end within the stop timeout", async () => {
    const { core, children } = setup();
    await core.open("/ws");
    const stopped = core.stop();
    await vi.advanceTimersByTimeAsync(STOP_TIMEOUT_MS);
    await stopped;
    expect(children[0]?.killed).toBe(true);
    expect(core.running).toBe(false);
    await core.stop();
  });

  it("relays file requests and their answers; without a core process, or when it ends, nothing is found", async () => {
    const { core, children } = setup();
    expect(await core.file("logreq-file://workspace/system/a.png")).toEqual({ status: 404 });
    await core.open("/ws");
    const child = children[0];
    const first = core.file("logreq-file://workspace/system/a.png");
    const second = core.file("logreq-file://workspace/system/b.png");
    expect(child?.sent.slice(1).map((s) => s.message)).toEqual([
      { type: "file", id: 1, url: "logreq-file://workspace/system/a.png" },
      { type: "file", id: 2, url: "logreq-file://workspace/system/b.png" },
    ]);
    const data = new Uint8Array([7]);
    child?.emit("message", { type: "file", id: 1, status: 200, mimeType: "image/png", data });
    child?.emit("message", { type: "file", id: 99, status: 404 });
    child?.emit("message", { type: "ready", root: "/ws" });
    child?.emit("message", "noise");
    expect(await first).toEqual({ status: 200, mimeType: "image/png", data });
    child?.exit(1);
    expect(await second).toEqual({ status: 404 });
  });

  it("starts a core process again when it stops by itself, and gives up when it keeps stopping", async () => {
    const { core, children, log } = setup();
    const target = new FakeTarget();
    await core.open("/ws");
    core.attach(target);
    for (let stop = 1; stop <= MAX_RESTARTS; stop++) {
      children.at(-1)?.exit(5);
      expect(children).toHaveLength(stop + 1);
      expect(children.at(-1)?.sent[0]?.message).toEqual({ type: "open", folder: "/ws" });
    }
    children.at(-1)?.exit(5);
    expect(children).toHaveLength(MAX_RESTARTS + 1);
    expect(core.running).toBe(false);
    expect(target.sent.map((s) => s.message)).toEqual([
      { open: true },
      ...Array.from({ length: MAX_RESTARTS }, () => ({ open: true, reason: "restarted" })),
      { open: false, reason: "stopped" },
    ]);
    expect(log.mock.calls.at(0)).toEqual(["The core process stopped with exit code 5; starting it again"]);
    expect(log.mock.calls.at(-1)).toEqual([
      "The core process stopped with exit code 5 again; it is not started again",
    ]);
  });

  it("counts only the stops within the restart window", async () => {
    const { core, children } = setup();
    await core.open("/ws");
    for (let stop = 0; stop < MAX_RESTARTS * 2; stop++) {
      children.at(-1)?.exit(5);
      vi.advanceTimersByTime(RESTART_WINDOW_MS);
    }
    expect(core.running).toBe(true);
    expect(children).toHaveLength(MAX_RESTARTS * 2 + 1);
  });

  it("logs a workspace that cannot be opened, tells the window, and opens the next one", async () => {
    const children: FakeChild[] = [];
    const log = vi.fn<(line: string) => void>();
    let fail: unknown = new Error("spawn failed");
    const core = new CoreProcess({
      fork: () => {
        if (fail !== undefined) {
          // A string as well, as a dependency might throw one.
          throw fail as Error;
        }
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      channel: () => ({ port1: {}, port2: {} }),
      log,
    });
    const target = new FakeTarget();
    core.attach(target);
    await core.open("/broken");
    fail = "odd";
    await core.open("/broken");
    fail = undefined;
    await core.open("/ws");
    expect(log.mock.calls).toEqual([
      ["The workspace could not be opened: spawn failed"],
      ["The workspace could not be opened: odd"],
    ]);
    expect(target.sent.map((s) => s.message)).toEqual([
      { open: false },
      { open: false, reason: "stopped" },
      { open: false, reason: "stopped" },
      { open: true, reason: "opened" },
    ]);
    expect(children).toHaveLength(1);
  });

  it("keeps going when the window cannot be told", async () => {
    const { core, children, log } = setup();
    const target = new FakeTarget();
    core.attach(target);
    target.postMessage = () => {
      throw new Error("Render frame was disposed");
    };
    await core.open("/ws");
    expect(log).toHaveBeenCalledWith("The workspace could not be opened: Render frame was disposed");
    expect(core.running).toBe(true);
    expect(children).toHaveLength(1);
  });

  it("sends nothing to a destroyed window", async () => {
    const { core } = setup();
    const target = new FakeTarget();
    target.destroyed = true;
    core.attach(target);
    await core.open("/ws");
    expect(target.sent).toEqual([]);
  });
});
