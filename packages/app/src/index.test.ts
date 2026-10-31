import { describe, expect, it } from "vitest";
import * as app from "./index.js";

describe("@reqseq/app", () => {
  it("exports the parts of the IPC that run without Electron, how the app names commands, and its keys", () => {
    expect(Object.keys(app).sort()).toEqual([
      "SAVE_CHANNEL",
      "SHORTCUT_TABLES",
      "WORKSPACE_CHANNEL",
      "appCommandEntry",
      "commandPromptKey",
      "createBridge",
      "createCoreHost",
      "shortcutReference",
    ]);
  });
});
