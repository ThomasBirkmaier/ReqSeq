import { describe, expect, it } from "vitest";
import * as app from "./index.js";

describe("@logreq/app", () => {
  it("exports the parts of the IPC that run without Electron", () => {
    expect(Object.keys(app).sort()).toEqual(["WORKSPACE_CHANNEL", "createBridge", "createCoreHost"]);
  });
});
