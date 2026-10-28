import { describe, expect, it } from "vitest";
import type { AgentActivity } from "./protocol.js";
import {
  BRIDGE_EVENTS,
  PORT_EVENTS,
  MAX_ROOT_LENGTH,
  MAX_CHANGED_IDS,
  coreMessage,
  coreRequest,
  externalChange,
  isBridgeEvent,
  openWorkspaceResult,
  portMessage,
  portRequest,
  recentWorkspaceEntries,
  saveAnswer,
  saveRequest,
} from "./protocol.js";
import { MAX_ROOT_LENGTH as CORE_MAX_ROOT_LENGTH } from "@logreq/core/recent-workspaces";

/** An access as `workspace.activity` gives it. */
const ACTIVITY: AgentActivity = {
  access: "mcp",
  command: "element.get",
  effect: "read",
  at: "2026-10-27T09:30:00.123Z",
  element: { id: "0f3c6a1e-2b4d-4e8f-9a1b-46fb54e88fb3", repository: "system" },
};

describe("portRequest: what the renderer may ask", () => {
  it("takes an invoke with its input as it came, and the catalog", () => {
    expect(portRequest({ id: 1, kind: "invoke", name: "element.get", input: { ref: "SR-1" } })).toEqual({
      id: 1,
      kind: "invoke",
      name: "element.get",
      input: { ref: "SR-1" },
    });
    expect(portRequest({ id: 2, kind: "invoke", name: "workspace.status" })).toEqual({
      id: 2,
      kind: "invoke",
      name: "workspace.status",
      input: undefined,
    });
    expect(portRequest({ id: 2, kind: "invoke", name: "workspace.status", input: null })).toMatchObject({
      input: null,
    });
    expect(portRequest({ id: 3, kind: "commands" })).toEqual({ id: 3, kind: "commands" });
  });

  it("drops anything else", () => {
    for (const value of [
      undefined,
      null,
      "invoke",
      { kind: "invoke", name: "x" },
      { id: "1", kind: "commands" },
      { id: 1, kind: "invoke", name: 3 },
      { id: 1, kind: "delete" },
    ]) {
      expect(portRequest(value)).toBeUndefined();
    }
  });
});

describe("coreRequest: what the main process sends the core process", () => {
  it("takes open, connect, file and stop", () => {
    expect(coreRequest({ type: "open", folder: "/w" })).toEqual({ type: "open", folder: "/w" });
    // An exact open: a root of the list of recent workspaces (SR-131); only `true` counts.
    expect(coreRequest({ type: "open", folder: "/w", exact: true })).toEqual({
      type: "open",
      folder: "/w",
      exact: true,
    });
    expect(coreRequest({ type: "open", folder: "/w", exact: "yes" })).toEqual({ type: "open", folder: "/w" });
    expect(coreRequest({ type: "connect", extra: 1 })).toEqual({ type: "connect" });
    expect(coreRequest({ type: "file", id: 4, url: "logreq-file://a/b.png" })).toEqual({
      type: "file",
      id: 4,
      url: "logreq-file://a/b.png",
    });
    expect(coreRequest({ type: "stop" })).toEqual({ type: "stop" });
  });

  it("drops anything else", () => {
    for (const value of [
      null,
      7,
      { type: "open" },
      { type: "file", id: 1 },
      { type: "file", url: "x" },
      { type: "restart" },
    ]) {
      expect(coreRequest(value)).toBeUndefined();
    }
  });
});

describe("coreMessage: what the core process sends the main process", () => {
  it("takes ready and file answers; a file answer without data is not found", () => {
    const data = new Uint8Array([1, 2]);
    expect(coreMessage({ type: "ready", root: "/w", key: "/real/w" })).toEqual({
      type: "ready",
      root: "/w",
      key: "/real/w",
    });
    expect(coreMessage({ type: "ready", root: "/w" })).toBeUndefined();
    expect(coreMessage({ type: "ready", key: "/w" })).toBeUndefined();
    expect(coreMessage({ type: "file", id: 1, status: 200, mimeType: "image/png", data })).toEqual({
      type: "file",
      id: 1,
      status: 200,
      mimeType: "image/png",
      data,
    });
    expect(coreMessage({ type: "file", id: 2, status: 404 })).toEqual({ type: "file", id: 2, status: 404 });
    expect(coreMessage({ type: "file", id: 3, status: 200, mimeType: "image/png" })).toEqual({
      type: "file",
      id: 3,
      status: 404,
    });
    expect(coreMessage({ type: "file", id: 3, status: 200, data })).toEqual({
      type: "file",
      id: 3,
      status: 404,
    });
  });

  it("drops anything else", () => {
    for (const value of [null, "ready", { type: "ready" }, { type: "file" }, { type: "stopped" }]) {
      expect(coreMessage(value)).toBeUndefined();
    }
  });
});

describe("portMessage: what the core process sends a window", () => {
  it("takes results, the catalog and the two events", () => {
    expect(portMessage({ id: 1, result: { ok: true, output: {} } })).toEqual({
      id: 1,
      result: { ok: true, output: {} },
    });
    expect(portMessage({ id: 2, commands: [] })).toEqual({ id: 2, commands: [] });
    for (const reason of ["opened", "restarted", "stopped", "written"]) {
      expect(portMessage({ event: "workspace-changed", data: { reason } })).toEqual({
        event: "workspace-changed",
        data: { reason },
      });
    }
    expect(portMessage({ event: "agent-activity", data: ACTIVITY })).toEqual({
      event: "agent-activity",
      data: ACTIVITY,
    });
    const write = {
      ...ACTIVITY,
      access: "api",
      command: "element.addAttachment",
      effect: "write-files",
      at: "2026-10-27T11:30:00+02:00",
    };
    expect(portMessage({ event: "agent-activity", data: write })).toEqual({
      event: "agent-activity",
      data: write,
    });
  });

  it("[SR-117/AK4] the port carries only the two events, and no mode with them", () => {
    expect(PORT_EVENTS).toEqual(["workspace-changed", "agent-activity"]);
    expect(BRIDGE_EVENTS.filter(isBridgeEvent)).toEqual(BRIDGE_EVENTS);
    for (const name of ["follow-mode", "follow", "mode", "toString", "__proto__", 1, undefined]) {
      expect(isBridgeEvent(name)).toBe(false);
      expect(portMessage({ event: name, data: { on: true } })).toBeUndefined();
    }
    // What an event carries is rebuilt from the fields of its schema: nothing else reaches a window.
    expect(
      portMessage({
        event: "agent-activity",
        data: { ...ACTIVITY, mode: "on", following: true, element: { ...ACTIVITY.element, title: "x" } },
      }),
    ).toEqual({ event: "agent-activity", data: ACTIVITY });
    expect(portMessage({ event: "workspace-changed", data: { reason: "written", mode: "on" } })).toEqual({
      event: "workspace-changed",
      data: { reason: "written" },
    });
  });

  it("drops an agent's access that the schema does not allow", () => {
    const { element } = ACTIVITY;
    for (const data of [
      undefined,
      "element.get",
      { ...ACTIVITY, element: undefined },
      { ...ACTIVITY, access: "renderer" },
      { ...ACTIVITY, command: "element get" },
      { ...ACTIVITY, command: 7 },
      { ...ACTIVITY, effect: "write" },
      { ...ACTIVITY, at: "yesterday" },
      { ...ACTIVITY, at: 1_761_557_400_000 },
      { ...ACTIVITY, element: { ...element, id: "SR-e88fb3" } },
      { ...ACTIVITY, element: { ...element, id: element.id.toUpperCase() } },
      { ...ACTIVITY, element: { ...element, repository: "" } },
      { ...ACTIVITY, element: { id: element.id } },
    ]) {
      expect(portMessage({ event: "agent-activity", data })).toBeUndefined();
    }
  });

  it("takes a change from outside with its scope and the three lists, and only those fields (SR-116)", () => {
    const elements = { added: ["a"], changed: ["b", "c"], removed: [] };
    expect(
      portMessage({
        event: "workspace-changed",
        data: { reason: "external", scope: "elements", elements: { ...elements, moved: ["x"] }, extra: 1 },
      }),
    ).toEqual({ event: "workspace-changed", data: { reason: "external", scope: "elements", elements } });
    for (const scope of ["metamodel", "workspace"]) {
      expect(
        portMessage({
          event: "workspace-changed",
          data: { reason: "external", scope, elements: { added: [], changed: [], removed: [] } },
        }),
      ).toMatchObject({ data: { scope } });
    }
    // The other reasons carry nothing else.
    expect(
      portMessage({ event: "workspace-changed", data: { reason: "opened", scope: "elements" } }),
    ).toEqual({ event: "workspace-changed", data: { reason: "opened" } });
  });

  it("drops a malformed change: an unknown reason or scope, lists that are no lists of strings, too many UUIDs", () => {
    const lists = { added: [], changed: [], removed: [] };
    const many = Array.from({ length: MAX_CHANGED_IDS + 1 }, (_, at) => String(at));
    for (const change of [
      { reason: "deleted" },
      { reason: "external" },
      { reason: "external", scope: "elements" },
      { reason: "external", scope: "files", elements: lists },
      { reason: "external", scope: "elements", elements: "all" },
      { reason: "external", scope: "elements", elements: { ...lists, added: "a" } },
      { reason: "external", scope: "elements", elements: { ...lists, changed: [1] } },
      { reason: "external", scope: "elements", elements: { added: [], changed: [] } },
      { reason: "external", scope: "elements", elements: { ...lists, removed: many } },
    ]) {
      expect(
        portMessage({ event: "workspace-changed", data: change }),
        JSON.stringify(change),
      ).toBeUndefined();
    }
  });

  it("drops anything else", () => {
    for (const value of [
      null,
      { event: "workspace-changed" },
      { event: "workspace-changed", data: { reason: "deleted" } },
      { event: "workspace-changed", change: { reason: "written" } },
      { event: "agent-activity", id: 1, result: { ok: true } },
      { result: { ok: true } },
      { id: 1 },
      { id: 1, result: "ok" },
    ]) {
      expect(portMessage(value)).toBeUndefined();
    }
  });
});

describe("the answers of the main process about recent workspaces (SR-131)", () => {
  it("recentWorkspaceEntries and openWorkspaceResult accept only their shapes", () => {
    const entries = [
      { root: "/a", state: "open" },
      { root: "/b", state: "found" },
      { root: "/c", state: "missing" },
    ];
    expect(recentWorkspaceEntries(entries)).toEqual(entries);
    // Only the fields of an entry are kept.
    expect(recentWorkspaceEntries([{ root: "/a", state: "open", key: "/x" }])).toEqual([
      { root: "/a", state: "open" },
    ]);
    expect(recentWorkspaceEntries([])).toEqual([]);
    for (const value of [
      undefined,
      null,
      "x",
      { root: "/a", state: "open" },
      [{ root: "/a", state: "gone" }],
      [{ root: 1, state: "open" }],
      [null],
      [...entries, "x"],
    ]) {
      expect(recentWorkspaceEntries(value)).toEqual([]);
    }
    expect(openWorkspaceResult({ ok: true })).toEqual({ ok: true });
    for (const reason of ["missing", "unsaved", "timeout", "busy", "no-workspace"]) {
      expect(openWorkspaceResult({ ok: false, reason, more: 1 })).toEqual({ ok: false, reason });
    }
    for (const value of [
      { ok: false, reason: "refused" },
      { ok: false, reason: "other" },
      { ok: false },
      { ok: "true" },
      true,
      undefined,
      null,
    ]) {
      expect(openWorkspaceResult(value)).toEqual({ ok: false, reason: "refused" });
    }
  });
});

describe("externalChange: a batch of the watcher as the event of the windows", () => {
  it("keeps the scope and the lists up to MAX_CHANGED_IDS UUIDs in all", () => {
    const ids = Array.from({ length: MAX_CHANGED_IDS - 2 }, (_, at) => `id-${String(at)}`);
    expect(
      externalChange({ scope: "metamodel", elements: { added: ["a"], changed: ids, removed: ["r"] } }),
    ).toEqual({
      reason: "external",
      scope: "metamodel",
      elements: { added: ["a"], changed: ids, removed: ["r"] },
    });
  });

  it("sends more than MAX_CHANGED_IDS UUIDs as a change of the workspace with empty lists (N-036)", () => {
    const ids = Array.from({ length: MAX_CHANGED_IDS }, (_, at) => `id-${String(at)}`);
    const change = externalChange({
      scope: "elements",
      elements: { added: ["a"], changed: ids, removed: [] },
    });
    expect(change).toEqual({
      reason: "external",
      scope: "workspace",
      elements: { added: [], changed: [], removed: [] },
    });
    // What the host sends passes the check of the window.
    expect(portMessage({ event: "workspace-changed", data: change })).toEqual({
      event: "workspace-changed",
      data: change,
    });
  });

  it("saveRequest and saveAnswer accept only their shapes", () => {
    expect(saveRequest({ id: 3, more: true })).toEqual({ id: 3 });
    expect(saveRequest({ id: 3, expired: true })).toEqual({ id: 3, expired: true });
    expect(saveRequest({ id: 3, expired: "yes" })).toEqual({ id: 3 });
    expect(saveRequest({ id: 3, closing: true })).toEqual({ id: 3, closing: true });
    expect(saveRequest({ id: 3, closing: 1 })).toEqual({ id: 3 });
    for (const value of [{ id: "3" }, { id: 1.5 }, { id: Number.MAX_VALUE }, {}, null, 3]) {
      expect(saveRequest(value)).toBeUndefined();
    }
    expect(saveAnswer({ id: 3, saved: true, more: 1 })).toEqual({ id: 3, saved: true });
    expect(saveAnswer({ id: 4, saved: false })).toEqual({ id: 4, saved: false });
    for (const value of [
      { id: 3, saved: "true" },
      { id: 3 },
      { saved: true },
      { id: -0.5, saved: true },
      null,
    ]) {
      expect(saveAnswer(value)).toBeUndefined();
    }
  });

  it("the longest root main takes from the renderer is the longest root core's list holds", () => {
    expect(MAX_ROOT_LENGTH).toBe(CORE_MAX_ROOT_LENGTH);
  });

  it("[SR-131/AK3] save-expired is an event of the window from the main process, never one of the port", () => {
    expect(BRIDGE_EVENTS).toEqual(["workspace-changed", "agent-activity", "save-expired"]);
    expect(isBridgeEvent("save-expired")).toBe(true);
    expect(PORT_EVENTS).not.toContain("save-expired");
    for (const data of [{}, { closing: true }, { more: 1 }, "x"]) {
      expect(portMessage({ event: "save-expired", data })).toBeUndefined();
    }
  });
});
