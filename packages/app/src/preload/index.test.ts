import { describe, expect, it, vi } from "vitest";
import { SAVE_CHANNEL, WORKSPACE_CHANNEL } from "../shared/protocol.js";

const exposeInMainWorld = vi.fn();
const on = vi.fn();
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { on } }));

describe("preload entry", () => {
  it("exposes the bridge as window.reqseq, and nothing else", async () => {
    await import("./index.js");
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const [name, bridge] = exposeInMainWorld.mock.calls[0] as [string, object];
    expect(name).toBe("reqseq");
    expect(Object.keys(bridge).sort()).toEqual([
      "commands",
      "copyText",
      "invoke",
      "on",
      "onSave",
      "openWorkspace",
      "recentWorkspaces",
    ]);
    expect(on.mock.calls.map((call) => call[0] as unknown)).toEqual([WORKSPACE_CHANNEL, SAVE_CHANNEL]);
  });
});
