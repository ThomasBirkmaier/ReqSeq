import { describe, expect, it, vi } from "vitest";
import type { LogReqBridge } from "../shared/protocol.js";
import { callOn } from "./call.js";

describe("callOn", () => {
  it("gives the output of a command, or the code and message of its error", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, output: { total: 1 } })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "ref.unknown", message: "No such element", details: {} },
      });
    const call = callOn({ invoke } as unknown as LogReqBridge);
    expect(await call("element.list", { limit: 1 })).toEqual({ ok: true, output: { total: 1 } });
    expect(invoke).toHaveBeenCalledWith("element.list", { limit: 1 });
    expect(await call("element.get", { ref: "x" })).toEqual({
      ok: false,
      code: "ref.unknown",
      message: "No such element",
    });
  });
});
