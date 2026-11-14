import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  INIT_WORKSPACE_COMMAND,
  OPEN_WORKSPACE_ACTION,
  initHint,
  noWorkspaceMessage,
  stoppedMessage,
} from "./open-hint.js";
import { ACTIONS } from "../renderer/actions.js";

describe("the hint how to open a workspace", () => {
  it("names the keys of the folder dialog and the command prompt, not the menu that Windows and Linux hide", () => {
    expect(noWorkspaceMessage(false)).toBe(
      "No workspace is open. Press Ctrl+O to choose a folder, or Ctrl+Shift+P for Open workspace.",
    );
    expect(noWorkspaceMessage(true)).toBe(
      "No workspace is open. Press ⌘O to choose a folder, or ⌘⇧P for Open workspace.",
    );
    expect(stoppedMessage(false)).toBe(
      "The background process of the app keeps stopping. Press Ctrl+O to open the workspace again.",
    );
    expect(stoppedMessage(true)).toBe(
      "The background process of the app keeps stopping. Press ⌘O to open the workspace again.",
    );
  });

  it("names the action and the catalog command by the titles the command prompt shows", () => {
    expect(ACTIONS.find((action) => action.id === "open-workspace")?.title).toBe(OPEN_WORKSPACE_ACTION);
    const init = JSON.parse(
      fs.readFileSync(new URL("../../../../schemas/commands/workspace.init.json", import.meta.url), "utf8"),
    ) as { readonly title: string };
    expect(init.title).toBe(INIT_WORKSPACE_COMMAND);
    expect(initHint(false)).toBe("To create one here, press Ctrl+Shift+P for Initialise workspace.");
  });
});
