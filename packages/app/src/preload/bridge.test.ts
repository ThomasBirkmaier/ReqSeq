import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceChange, WorkspaceMessage } from "../shared/protocol.js";
import { WORKSPACE_CHANNEL } from "../shared/protocol.js";
import type { IpcRendererLike } from "./bridge.js";
import { createBridge } from "./bridge.js";

type Listener = Parameters<IpcRendererLike["on"]>[1];

/** The main process's side of the preload: sends the workspace of the window. */
class FakeIpc implements IpcRendererLike {
  readonly channels: string[] = [];
  #listener: Listener | undefined;

  on(channel: string, listener: Listener): this {
    this.channels.push(channel);
    this.#listener = listener;
    return this;
  }

  send(message: WorkspaceMessage, ports: readonly MessagePort[] = []): void {
    this.#listener?.({ ports }, message);
  }
}

/** A core process stand-in on the other end of the port: answers each request with `answer`. */
const fakeCore = (answer: (request: { id: number; kind: string; name?: string }) => unknown) => {
  const { port1, port2 } = new MessageChannel();
  const requests: unknown[] = [];
  port1.on("message", (request: { id: number; kind: string; name?: string }) => {
    requests.push(request);
    const reply = answer(request);
    if (reply !== undefined) {
      port1.postMessage(reply);
    }
  });
  return { port: port2 as unknown as MessagePort, core: port1, requests };
};

const NO_WORKSPACE = {
  ok: false,
  error: {
    code: "workspace.not-found",
    message: "No workspace is open. Open one with File > Open Workspace.",
  },
};

const STOPPED = {
  ok: false,
  error: {
    code: "internal",
    message: "The core process stopped before it answered",
    details: { aborted: true },
  },
};

describe("createBridge", () => {
  it("listens on the workspace channel; calls wait for the first message", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    expect(ipc.channels).toEqual([WORKSPACE_CHANNEL]);
    const early = bridge.invoke("workspace.status");
    ipc.send({ open: false });
    expect(await early).toEqual(NO_WORKSPACE);
    expect(await bridge.commands()).toEqual([]);
  });

  it("calls the core process over the port: invoke with {} by default, and the catalog", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const { port, requests } = fakeCore((request) =>
      request.kind === "commands"
        ? { id: request.id, commands: [{ name: "workspace.status", implemented: true }] }
        : { id: request.id, result: { ok: true, output: { name: request.name } } },
    );
    ipc.send({ open: true }, [port]);
    expect(await bridge.invoke("workspace.status")).toEqual({
      ok: true,
      output: { name: "workspace.status" },
    });
    expect(await bridge.invoke("element.get", { ref: "SR-1" })).toEqual({
      ok: true,
      output: { name: "element.get" },
    });
    expect(await bridge.commands()).toEqual([{ name: "workspace.status", implemented: true }]);
    expect(requests).toEqual([
      { kind: "invoke", name: "workspace.status", input: {}, id: 1 },
      { kind: "invoke", name: "element.get", input: { ref: "SR-1" }, id: 2 },
      { kind: "commands", id: 3 },
    ]);
  });

  it("treats an answer of the wrong kind as no answer", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const { port } = fakeCore((request) =>
      request.kind === "commands"
        ? { id: request.id, result: { ok: true, output: 1 } }
        : { id: request.id, commands: [] },
    );
    ipc.send({ open: true }, [port]);
    expect(await bridge.invoke("workspace.status")).toEqual(STOPPED);
    expect(await bridge.commands()).toEqual([]);
  });

  it("ends waiting calls when the port closes", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const { port, core } = fakeCore(() => undefined);
    ipc.send({ open: true }, [port]);
    const pending = bridge.invoke("workspace.status");
    core.close();
    expect(await pending).toEqual(STOPPED);
  });

  it("switches to the port of another workspace, ends the calls of the old one and tells the listeners", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const changes: WorkspaceChange[] = [];
    const unsubscribe = bridge.on("workspace-changed", (change) => changes.push(change));
    const first = fakeCore(() => undefined);
    ipc.send({ open: true }, [first.port]);
    const pending = bridge.invoke("workspace.status");
    await vi.waitFor(() => {
      expect(first.requests).toHaveLength(1);
    });
    const second = fakeCore((request) => ({ id: request.id, result: { ok: true, output: "second" } }));
    ipc.send({ open: true, reason: "opened" }, [second.port]);
    expect(await pending).toEqual(STOPPED);
    expect(await bridge.invoke("workspace.status")).toEqual({ ok: true, output: "second" });
    ipc.send({ open: false, reason: "stopped" });
    expect(await bridge.invoke("workspace.status")).toEqual(NO_WORKSPACE);
    // A page load (no reason) and a message that claims a port without one tell nobody.
    ipc.send({ open: true });
    expect(await bridge.invoke("workspace.status")).toEqual(NO_WORKSPACE);
    expect(changes).toEqual([{ reason: "opened" }, { reason: "stopped" }]);
    unsubscribe();
    ipc.send({ open: false, reason: "opened" });
    expect(changes).toHaveLength(2);
  });

  it("passes the core process's events on, and ignores what is no message", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const listener = vi.fn();
    const twice = bridge.on("workspace-changed", listener);
    bridge.on("workspace-changed", listener);
    const { port, core } = fakeCore(() => undefined);
    ipc.send({ open: true }, [port]);
    core.postMessage("noise");
    core.postMessage({ id: 99, result: { ok: true, output: 1 } });
    core.postMessage({ event: "workspace-changed", change: { reason: "written" } });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(2);
    });
    expect(listener).toHaveBeenCalledWith({ reason: "written" });
    twice();
    core.postMessage({ event: "workspace-changed", change: { reason: "written" } });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(3);
    });
  });

  it("has no other events", () => {
    const bridge = createBridge(new FakeIpc());
    const listener = vi.fn();
    const off = (bridge.on as (event: string, listener: () => void) => () => void)(
      "element-deleted",
      listener,
    );
    off();
    expect(listener).not.toHaveBeenCalled();
  });
});
