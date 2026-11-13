import { describe, expect, it } from "vitest";
import * as app from "./index.js";

describe("@reqseq/app", () => {
  it("exports the parts of the IPC that run without Electron, how the app names commands and their call on the command line, and its keys", () => {
    expect(Object.keys(app).sort()).toEqual([
      "HELP_CHANNEL",
      "SAVE_CHANNEL",
      "SHORTCUT_TABLES",
      "SWIPE_CHANNEL",
      "WORKSPACE_CHANNEL",
      "appCommandEntry",
      "cliUsage",
      "commandPromptKey",
      "createBridge",
      "createCoreHost",
      "shortcutReference",
    ]);
  });
});
