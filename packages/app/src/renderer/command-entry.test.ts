import { describe, expect, it } from "vitest";
import { ACTIONS } from "./actions.js";
import {
  appCommandEntry,
  commandPromptKey,
  coveredCommand,
  coveringAction,
  SHOWN_IN,
  shownIn,
} from "./command-entry.js";

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

  it("names the action whose covers names a command before one that only shares its title (#2201)", () => {
    const get = { name: "element.get", title: "Show element" };
    expect(appCommandEntry(get, false)).toEqual({
      name: "Go to element or buffer",
      action: true,
      key: "Ctrl+P",
    });
    expect(appCommandEntry({ name: "element.list", title: "List elements" }, false)).toEqual({
      name: "List all elements",
      action: true,
    });
    // The actions titled "Show element" on a graph, a neighbourhood and an entry run no catalog command.
    const sameTitle = ACTIONS.filter((action) => action.title === get.title);
    expect(sameTitle.map((action) => action.id)).toEqual(["neighbourhood-back", "graph-back", "entry-show"]);
    expect(sameTitle.map((action) => coveredCommand(action, [get]))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(coveringAction({ name: "test.none", title: "Show element" })).toBeUndefined();
  });

  it("names the place that shows the output of a command without an entry of its own, and no key", () => {
    expect(appCommandEntry({ name: "filter.list", title: "List saved filters" }, false)).toEqual({
      name: "List saved filters",
      action: false,
      shownIn: '"Filter list", "Save list as saved filter"',
    });
    expect(Object.keys(SHOWN_IN)).toHaveLength(7);
    expect(shownIn({ name: "element.get", title: "Show element" })).toBeUndefined();
    expect(shownIn({ name: "toString", title: "" })).toBeUndefined();
  });

  it("names the key of the command prompt", () => {
    expect(commandPromptKey(false)).toBe("Ctrl+Shift+P");
  });
});
