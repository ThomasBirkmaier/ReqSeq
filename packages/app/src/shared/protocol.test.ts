import { describe, expect, it } from "vitest";
import { coreMessage, coreRequest, portMessage, portRequest } from "./protocol.js";

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
    expect(coreMessage({ type: "ready", root: "/w" })).toEqual({ type: "ready", root: "/w" });
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
  it("takes results, the catalog and the workspace-changed event", () => {
    expect(portMessage({ id: 1, result: { ok: true, output: {} } })).toEqual({
      id: 1,
      result: { ok: true, output: {} },
    });
    expect(portMessage({ id: 2, commands: [] })).toEqual({ id: 2, commands: [] });
    expect(portMessage({ event: "workspace-changed", change: { reason: "written" } })).toEqual({
      event: "workspace-changed",
      change: { reason: "written" },
    });
  });

  it("drops anything else", () => {
    for (const value of [
      null,
      { event: "workspace-changed" },
      { result: { ok: true } },
      { id: 1 },
      { id: 1, result: "ok" },
    ]) {
      expect(portMessage(value)).toBeUndefined();
    }
  });
});
