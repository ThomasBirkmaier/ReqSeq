import { describe, expect, it } from "vitest";
import { ACTIONS } from "./actions.js";
import { appCommandEntry, commandPromptKey, coveringAction } from "./command-entry.js";

describe("appCommandEntry", () => {
  it("names the action that covers a command, with its shortcut", () => {
    expect(appCommandEntry({ name: "trace.graph", title: "Graph" }, false)).toEqual({
      name: "Show graph",
      action: true,
      key: "Ctrl+Shift+G",
    });
  });

  it("names a command no action covers by its catalog title, with its key after the prefix key", () => {
    expect(appCommandEntry({ name: "element.create", title: "Create element" }, false)).toEqual({
      name: "Create element",
      action: false,
      key: "Ctrl+K E",
    });
  });

  it("leaves the key out where there is none", () => {
    expect(appCommandEntry({ name: "test.none", title: "No such command" }, true)).toEqual({
      name: "No such command",
      action: false,
    });
    const keyless = ACTIONS.find((action) => action.shortcut === undefined);
    expect(keyless).toBeDefined();
    expect(appCommandEntry({ name: "test.none", title: keyless?.title ?? "" }, true)).toEqual({
      name: keyless?.title,
      action: true,
    });
  });

  it("finds a covering action by title too", () => {
    expect(coveringAction({ name: "test.none", title: "Show graph" })?.covers).toEqual(["trace.graph"]);
  });

  it("names the key of the command prompt", () => {
    expect(commandPromptKey(false)).toBe("Ctrl+Shift+P");
  });
});
