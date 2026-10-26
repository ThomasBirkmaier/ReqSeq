import { describe, expect, it, vi } from "vitest";
import { WORKSPACE_CHANNEL } from "../shared/protocol.js";

const exposeInMainWorld = vi.fn();
const on = vi.fn();
vi.mock("electron", () => ({ contextBridge: { exposeInMainWorld }, ipcRenderer: { on } }));

describe("preload entry", () => {
  it("exposes the bridge as window.logreq, and nothing else", async () => {
    await import("./index.js");
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const [name, bridge] = exposeInMainWorld.mock.calls[0] as [string, object];
    expect(name).toBe("logreq");
    expect(Object.keys(bridge).sort()).toEqual(["commands", "invoke", "on"]);
    expect(on.mock.calls.map((call) => call[0] as unknown)).toEqual([WORKSPACE_CHANNEL]);
  });
});
