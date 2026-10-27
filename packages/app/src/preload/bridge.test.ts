import { MessageChannel } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import type { AgentActivity, WorkspaceChange, WorkspaceMessage } from "../shared/protocol.js";
import {
  COPY_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  RECENT_WORKSPACES_CHANNEL,
  SAVED_CHANNEL,
  SAVE_CHANNEL,
  WORKSPACE_CHANNEL,
} from "../shared/protocol.js";
import type { IpcRendererLike } from "./bridge.js";
import { createBridge } from "./bridge.js";

type Listener = Parameters<IpcRendererLike["on"]>[1];

/** The main process's side of the preload: sends the workspace of the window, and asks it to save. */
class FakeIpc implements IpcRendererLike {
  readonly channels: string[] = [];
  /** The calls of `invoke`, and what it answers (a rejection when it is an Error). */
  readonly invoked: { channel: string; args: readonly unknown[] }[] = [];
  /** The messages of `send`. */
  readonly sent: { channel: string; args: readonly unknown[] }[] = [];
  answer: unknown = true;
  readonly #listeners = new Map<string, Listener>();

  on(channel: string, listener: Listener): this {
    this.channels.push(channel);
    this.#listeners.set(channel, listener);
    return this;
  }

  invoke(channel: string, ...args: readonly unknown[]): Promise<unknown> {
    this.invoked.push({ channel, args });
    return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer);
  }

  send(channel: string, ...args: readonly unknown[]): void {
    this.sent.push({ channel, args });
  }

  /** Main sends the workspace of the window. */
  post(message: WorkspaceMessage, ports: readonly MessagePort[] = []): void {
    this.#listeners.get(WORKSPACE_CHANNEL)?.({ ports }, message);
  }

  /** Main asks the window to save. */
  askToSave(message: unknown): void {
    this.#listeners.get(SAVE_CHANNEL)?.({ ports: [] }, message);
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

/** An access as `workspace.activity` gives it. */
const ACTIVITY: AgentActivity = {
  access: "mcp",
  command: "element.update",
  effect: "write-files",
  at: "2026-10-27T09:30:00.123Z",
  element: { id: "0f3c6a1e-2b4d-4e8f-9a1b-46fb54e88fb3", repository: "system" },
};

describe("createBridge", () => {
  it("listens on the workspace channel; calls wait for the first message", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    expect(ipc.channels).toEqual([WORKSPACE_CHANNEL, SAVE_CHANNEL]);
    const early = bridge.invoke("workspace.status");
    ipc.post({ open: false });
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
    ipc.post({ open: true }, [port]);
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
    ipc.post({ open: true }, [port]);
    expect(await bridge.invoke("workspace.status")).toEqual(STOPPED);
    expect(await bridge.commands()).toEqual([]);
  });

  it("ends waiting calls when the port closes", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const { port, core } = fakeCore(() => undefined);
    ipc.post({ open: true }, [port]);
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
    ipc.post({ open: true }, [first.port]);
    const pending = bridge.invoke("workspace.status");
    await vi.waitFor(() => {
      expect(first.requests).toHaveLength(1);
    });
    const second = fakeCore((request) => ({ id: request.id, result: { ok: true, output: "second" } }));
    ipc.post({ open: true, reason: "opened" }, [second.port]);
    expect(await pending).toEqual(STOPPED);
    expect(await bridge.invoke("workspace.status")).toEqual({ ok: true, output: "second" });
    ipc.post({ open: false, reason: "stopped" });
    expect(await bridge.invoke("workspace.status")).toEqual(NO_WORKSPACE);
    // A page load (no reason) and a message that claims a port without one tell nobody.
    ipc.post({ open: true });
    expect(await bridge.invoke("workspace.status")).toEqual(NO_WORKSPACE);
    expect(changes).toEqual([{ reason: "opened" }, { reason: "stopped" }]);
    unsubscribe();
    ipc.post({ open: false, reason: "opened" });
    expect(changes).toHaveLength(2);
  });

  it("passes the core process's events on, and ignores what is no message", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const listener = vi.fn();
    const twice = bridge.on("workspace-changed", listener);
    bridge.on("workspace-changed", listener);
    const { port, core } = fakeCore(() => undefined);
    ipc.post({ open: true }, [port]);
    core.postMessage("noise");
    core.postMessage({ id: 99, result: { ok: true, output: 1 } });
    core.postMessage({ event: "workspace-changed", data: { reason: "written" } });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(2);
    });
    expect(listener).toHaveBeenCalledWith({ reason: "written" });
    twice();
    core.postMessage({ event: "workspace-changed", data: { reason: "written" } });
    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledTimes(3);
    });
  });

  it("passes an agent's access to the listeners of agent-activity only, each event to its own", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const { port, core } = fakeCore(() => undefined);
    ipc.post({ open: true }, [port]);
    const changes: WorkspaceChange[] = [];
    bridge.on("workspace-changed", (change) => changes.push(change));
    // Nobody listens to agent-activity yet: the access goes nowhere.
    core.postMessage({ event: "agent-activity", data: ACTIVITY });
    core.postMessage({ event: "workspace-changed", data: { reason: "written" } });
    await vi.waitFor(() => {
      expect(changes).toHaveLength(1);
    });
    const activities: AgentActivity[] = [];
    const off = bridge.on("agent-activity", (activity) => activities.push(activity));
    core.postMessage({ event: "agent-activity", data: { ...ACTIVITY, effect: "delete" } });
    core.postMessage({ event: "agent-activity", data: ACTIVITY });
    core.postMessage({ event: "workspace-changed", data: { reason: "written" } });
    await vi.waitFor(() => {
      expect(changes).toHaveLength(2);
    });
    expect(activities).toEqual([ACTIVITY]);
    expect(changes).toEqual([{ reason: "written" }, { reason: "written" }]);
    off();
    core.postMessage({ event: "agent-activity", data: ACTIVITY });
    core.postMessage({ event: "workspace-changed", data: { reason: "written" } });
    await vi.waitFor(() => {
      expect(changes).toHaveLength(3);
    });
    expect(activities).toEqual([ACTIVITY]);
  });

  it("has no other events", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const listener = vi.fn();
    // The renderer may pass any name.
    const on = (name: string, listener: () => void): (() => void) =>
      (bridge.on as (event: string, listener: () => void) => () => void)(name, listener);
    const offs = ["element-deleted", "follow-mode", "toString", "__proto__"].map((name) =>
      on(name, listener),
    );
    const { port, core } = fakeCore(() => undefined);
    ipc.post({ open: true }, [port]);
    const heard = vi.fn();
    bridge.on("workspace-changed", heard);
    for (const event of ["element-deleted", "follow-mode", "toString", "__proto__"]) {
      core.postMessage({ event, data: { reason: "written" } });
    }
    core.postMessage({ event: "workspace-changed", data: { reason: "written" } });
    await vi.waitFor(() => {
      expect(heard).toHaveBeenCalledTimes(1);
    });
    ipc.post({ open: false, reason: "stopped" });
    expect(heard).toHaveBeenCalledTimes(2);
    for (const off of offs) {
      off();
    }
    expect(listener).not.toHaveBeenCalled();
  });

  it("[SR-128/AK2] copyText asks the main process over the copy channel, and says whether it was copied", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    expect(await bridge.copyText("one\ntwo")).toBe(true);
    expect(ipc.invoked).toEqual([{ channel: COPY_CHANNEL, args: ["one\ntwo"] }]);
    // Only the main process's `true` is a copy; a refusal, anything else and a failure never reject.
    ipc.answer = false;
    expect(await bridge.copyText("x")).toBe(false);
    ipc.answer = "yes";
    expect(await bridge.copyText("x")).toBe(false);
    ipc.answer = new Error("No handler registered");
    expect(await bridge.copyText("x")).toBe(false);
  });

  it("recentWorkspaces and openWorkspace go to main, never reject, and drop answers of the wrong shape", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const entries = [
      { root: "/req/buoy", state: "found" },
      { root: "/req/station", state: "open" },
    ];
    ipc.answer = entries;
    expect(await bridge.recentWorkspaces()).toEqual(entries);
    ipc.answer = { ok: true };
    expect(await bridge.openWorkspace("/req/buoy")).toEqual({ ok: true });
    expect(ipc.invoked).toEqual([
      { channel: RECENT_WORKSPACES_CHANNEL, args: [] },
      { channel: OPEN_WORKSPACE_CHANNEL, args: ["/req/buoy"] },
    ]);
    ipc.answer = { ok: false, reason: "missing" };
    expect(await bridge.openWorkspace("/req/gone")).toEqual({ ok: false, reason: "missing" });
    // Another shape, and a failure, are an empty list and a refusal.
    ipc.answer = "nonsense";
    expect(await bridge.recentWorkspaces()).toEqual([]);
    expect(await bridge.openWorkspace("/req/buoy")).toEqual({ ok: false, reason: "refused" });
    ipc.answer = new Error("No handler registered");
    expect(await bridge.recentWorkspaces()).toEqual([]);
    expect(await bridge.openWorkspace("/req/buoy")).toEqual({ ok: false, reason: "refused" });
  });

  it("[SR-131/AK5] openWorkspace passes a typed folder path to main as typed", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    ipc.answer = { ok: false, reason: "no-workspace" };
    expect(await bridge.openWorkspace("~/req", { typed: true })).toEqual({
      ok: false,
      reason: "no-workspace",
    });
    ipc.answer = { ok: true };
    expect(await bridge.openWorkspace("/req/buoy", { typed: false })).toEqual({ ok: true });
    expect(ipc.invoked).toEqual([
      { channel: OPEN_WORKSPACE_CHANNEL, args: ["~/req", { typed: true }] },
      { channel: OPEN_WORKSPACE_CHANNEL, args: ["/req/buoy"] },
    ]);
  });

  it("[SR-131/AK3] answers main's request to save with what the window's saver gives; without one, saved", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
    // No saver yet: nothing is unsaved.
    ipc.askToSave({ id: 1 });
    await settle();
    const save = vi.fn(() => Promise.resolve(true));
    const unset = bridge.onSave(save);
    ipc.askToSave({ id: 2 });
    await settle();
    save.mockResolvedValueOnce(false);
    ipc.askToSave({ id: 3 });
    await settle();
    save.mockRejectedValueOnce(new Error("gone"));
    ipc.askToSave({ id: 4 });
    await settle();
    // The renderer is not trusted to keep to the types, and a saver that throws has not saved.
    save.mockResolvedValueOnce("yes" as unknown as boolean);
    ipc.askToSave({ id: 5 });
    await settle();
    save.mockImplementationOnce(() => {
      throw new Error("sync");
    });
    ipc.askToSave({ id: 6 });
    await settle();
    // A request of another shape is no request.
    ipc.askToSave({ id: "7" });
    await settle();
    expect(save).toHaveBeenCalledTimes(5);
    // Another saver replaces it; unsetting the replaced one changes nothing.
    const other = vi.fn(() => Promise.resolve(false));
    const unsetOther = bridge.onSave(other);
    unset();
    ipc.askToSave({ id: 8 });
    await settle();
    expect(other).toHaveBeenCalledOnce();
    unsetOther();
    ipc.askToSave({ id: 9 });
    await settle();
    expect(ipc.sent).toEqual(
      [
        [1, true],
        [2, true],
        [3, false],
        [4, false],
        [5, false],
        [6, false],
        [8, false],
        [9, true],
      ].map(([id, saved]) => ({ channel: SAVED_CHANNEL, args: [{ id, saved }] })),
    );
  });

  it("[SR-131/AK3] a request main gave up on tells the save-expired listeners, and asks the saver nothing", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const save = vi.fn(() => Promise.resolve(true));
    bridge.onSave(save);
    const expired = vi.fn();
    const off = bridge.on("save-expired", expired);
    ipc.askToSave({ id: 1, expired: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(expired).toHaveBeenCalledExactlyOnceWith({});
    expect(save).not.toHaveBeenCalled();
    expect(ipc.sent).toEqual([]);
    off();
    ipc.askToSave({ id: 2, expired: true });
    expect(expired).toHaveBeenCalledOnce();
  });
});
