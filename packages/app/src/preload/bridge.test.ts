import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentActivity, WorkspaceChange, WorkspaceMessage } from "../shared/protocol.js";
import {
  COPY_CHANNEL,
  DOCS_CHANNEL,
  EDIT_CHANNEL,
  HELP_CHANNEL,
  LIST_FOLDER_CHANNEL,
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

  /** Help > ReqSeq Documentation was chosen. */
  help(): void {
    this.#listeners.get(HELP_CHANNEL)?.({ ports: [] }, undefined);
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
    message: "No workspace is open. Press Ctrl+O to choose a folder, or Ctrl+Shift+P for Open workspace.",
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listens on the workspace channel; calls wait for the first message", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc, false);
    expect(ipc.channels).toEqual([WORKSPACE_CHANNEL, HELP_CHANNEL, SAVE_CHANNEL]);
    const early = bridge.invoke("workspace.status");
    ipc.post({ open: false });
    expect(await early).toEqual(NO_WORKSPACE);
    expect(await bridge.commands()).toEqual([]);
  });

  it("names the keys of macOS without a workspace there, and of this window's platform by default", async () => {
    const mac = new FakeIpc();
    const onMac = createBridge(mac, true);
    mac.post({ open: false });
    expect(await onMac.invoke("workspace.status")).toEqual({
      ok: false,
      error: {
        code: "workspace.not-found",
        message: "No workspace is open. Press ⌘O to choose a folder, or ⌘⇧P for Open workspace.",
      },
    });
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const linux = new FakeIpc();
    const onLinux = createBridge(linux);
    linux.post({ open: false });
    expect(await onLinux.invoke("workspace.status")).toEqual(NO_WORKSPACE);
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
    const bridge = createBridge(ipc, false);
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

  it("[SR-195/AK3] pasteText asks the main process over the edit channel for a paste, and gets no content back", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    expect(await bridge.pasteText()).toBe(true);
    expect(ipc.invoked).toEqual([{ channel: EDIT_CHANNEL, args: ["paste"] }]);
    // Only the main process's `true` is a paste; a refusal, anything else and a failure never reject.
    ipc.answer = false;
    expect(await bridge.pasteText()).toBe(false);
    ipc.answer = "text";
    expect(await bridge.pasteText()).toBe(false);
    ipc.answer = new Error("No handler registered");
    expect(await bridge.pasteText()).toBe(false);
  });

  it("openDocs sends main only a topic string, never rejects, and keeps only an answer of the known shape", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    ipc.answer = { ok: true, url: "http://example.com" };
    expect(await bridge.openDocs()).toEqual({ ok: true });
    expect(await bridge.openDocs("relation.options")).toEqual({ ok: true });
    // A renderer that does not keep to the type sends nothing but a string.
    expect(await bridge.openDocs({ path: "/x" } as unknown as string)).toEqual({ ok: true });
    expect(ipc.invoked).toEqual([
      { channel: DOCS_CHANNEL, args: [] },
      { channel: DOCS_CHANNEL, args: ["relation.options"] },
      { channel: DOCS_CHANNEL, args: [] },
    ]);
    ipc.answer = { ok: false, message: "No documentation in /opt/docs", extra: 1 };
    expect(await bridge.openDocs()).toEqual({ ok: false, message: "No documentation in /opt/docs" });
    const failed = { ok: false, message: "The documentation could not be opened" };
    for (const answer of [{ ok: false }, "yes", null, new Error("No handler registered")]) {
      ipc.answer = answer;
      expect(await bridge.openDocs()).toEqual(failed);
    }
  });

  it("onHelp hears Help > ReqSeq Documentation until it unsubscribes", () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const listener = vi.fn();
    const unsubscribe = bridge.onHelp(listener);
    const again = bridge.onHelp(listener);
    ipc.help();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    again();
    ipc.help();
    expect(listener).toHaveBeenCalledTimes(2);
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

  it("listFolder goes to main, never rejects, and keeps only the fields of a listing (SR-143)", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const listing = { folder: "/home/u", name: "pro", entries: [{ name: "projects", kind: "folder" }] };
    ipc.answer = { ...listing, extra: 1, truncated: true };
    expect(await bridge.listFolder("~/pro")).toEqual({ ...listing, truncated: true });
    expect(ipc.invoked).toEqual([{ channel: LIST_FOLDER_CHANNEL, args: ["~/pro"] }]);
    ipc.answer = new Error("No handler registered");
    expect(await bridge.listFolder("~/pro")).toEqual({ name: "", entries: [], problem: "invalid" });
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

  it("[SR-105/AK1] tells the window's saver whether main asks before the window closes or before a switch", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const save = vi.fn(() => Promise.resolve(true));
    bridge.onSave(save);
    ipc.askToSave({ id: 1, closing: true });
    ipc.askToSave({ id: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save.mock.calls).toEqual([[{ closing: true }], [{ closing: false }]]);
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
    // Main gave up waiting before the window closes (SR-105 AK1).
    ipc.askToSave({ id: 3, expired: true, closing: true });
    expect(expired).toHaveBeenLastCalledWith({ closing: true });
    off();
    ipc.askToSave({ id: 2, expired: true });
    expect(expired).toHaveBeenCalledTimes(2);
  });

  it("[SR-131/AK3] a save-expired from the core process's port is dropped: only main sends it", async () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    const expired = vi.fn();
    bridge.on("save-expired", expired);
    const heard = vi.fn();
    bridge.on("workspace-changed", heard);
    const { port, core } = fakeCore(() => undefined);
    ipc.post({ open: true }, [port]);
    core.postMessage({ event: "save-expired", data: {} });
    core.postMessage({ event: "workspace-changed", data: { reason: "written" } });
    await vi.waitFor(() => {
      expect(heard).toHaveBeenCalledOnce();
    });
    expect(expired).not.toHaveBeenCalled();
  });
});

describe("what the renderer can reach", () => {
  it("[SR-080/AK4] gets the values of the workspace only from catalog commands; the rest is the window's own state", () => {
    const ipc = new FakeIpc();
    const bridge = createBridge(ipc);
    // `invoke` and `commands` go to the core process, which runs the catalog as CLI, API and MCP do.
    // The others are the window's operation (clipboard, the workspaces opened last, opening one,
    // saving before a switch, the folders of a path typed in "Open workspace", which main lists with the
    // core function of `workspace.listFolder`, SR-143) and the events that tell it to ask again; none
    // carries a value of a file.
    // Outside the bridge, `reqseq-file:` (main's protocol) only draws the images a text names, files of
    // the repositories whose paths `element.get` gives; the recent elements of the overview live in the
    // window's storage. Both are display (AK1: „Zustand der Bedienung“).
    expect(Object.keys(bridge).sort()).toEqual([
      "commands",
      "copyText",
      "invoke",
      "listFolder",
      "on",
      "onHelp",
      "onSave",
      "openDocs",
      "openWorkspace",
      "pasteText",
      "recentWorkspaces",
    ]);
    expect(ipc.channels.sort()).toEqual([HELP_CHANNEL, SAVE_CHANNEL, WORKSPACE_CHANNEL].sort());
  });
});
