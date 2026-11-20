import { describe, expect, it } from "vitest";
import type { CommandListing, RecentWorkspaceEntry } from "../shared/protocol.js";
import { CONNECT_AGENT_ACTION } from "./connect-agent.js";
import {
  isStepList,
  nextStepsOf,
  openRoot,
  stepEntry,
  stepGiven,
  stepItemId,
  stepUnavailable,
} from "./next-steps.js";

const listing = (name: string, title: string): CommandListing =>
  ({ name, title, arguments: [], input: { type: "object" } }) as unknown as CommandListing;

const CATALOG = [
  listing("element.create", "Create element"),
  listing("workspace.connectAgent", "Connect AI agent"),
];

describe("next steps of an output (SR-226 AK5)", () => {
  it("takes the steps of `next` only when each names a command", () => {
    const step = { command: "element.create", input: {}, open: ["type", "title"] };
    expect(nextStepsOf({ answer: "Done", next: [step] })).toEqual([step]);
    expect(nextStepsOf({ next: "Paste the setup" })).toEqual([]);
    expect(nextStepsOf({ next: [{ input: {} }] })).toEqual([]);
    expect(nextStepsOf([step])).toEqual([]);
    expect(isStepList([])).toBe(false);
  });

  it("names a step by the entry of the command prompt, with its key where it has one", () => {
    expect(stepEntry("element.create", CATALOG, false)).toEqual({ name: "Create element", key: "Ctrl+K E" });
    expect(stepEntry("workspace.connectAgent", CATALOG, true)).toEqual({ name: "Connect AI agent" });
    expect(stepEntry("test.unknown", CATALOG, false)).toEqual({ name: "test.unknown" });
  });

  it("runs the action that covers the step's command, else the command", () => {
    const step = (command: string) => ({ command, input: {}, open: [] });
    expect(stepItemId(step("workspace.connectAgent"), CATALOG)).toBe(CONNECT_AGENT_ACTION);
    expect(stepItemId(step("element.create"), CATALOG)).toBe("command:element.create");
    expect(stepItemId(step("test.unknown"), CATALOG)).toBe("command:test.unknown");
  });

  it("gives the known inputs as given arguments, a value that is no text by its JSON", () => {
    expect(
      stepGiven({ command: "baseline.create", input: { name: "R1", selection: { view: "core" } }, open: [] }),
    ).toEqual([
      { field: "name", value: "R1", label: "R1" },
      { field: "selection", value: { view: "core" }, label: '{"view":"core"}' },
    ]);
  });

  it("says why a step cannot run: open its workspace first only while another one or none is open", () => {
    const here = { command: "x", input: {}, open: [], workspace: "/w" };
    expect(stepUnavailable({ command: "x", input: {}, open: [] }, "Create element", "/w")).toBe(
      "Create element cannot run here",
    );
    expect(stepUnavailable(here, "Create element", undefined)).toBe(
      "Create element runs in the workspace /w: open it first",
    );
    expect(stepUnavailable(here, "Create element", "/other")).toBe(
      "Create element runs in the workspace /w: open it first",
    );
    // Its own workspace is open, read-only: no entry runs the write command, and opening it would not help.
    expect(stepUnavailable(here, "Create element", "/w")).toBe("Create element cannot run here");
  });

  it("finds the root of the open workspace in the list of recent workspaces", async () => {
    const list = (entries: readonly RecentWorkspaceEntry[]) => ({
      name: undefined,
      list: () => Promise.resolve(entries),
      open: () => Promise.resolve({ ok: true as const }),
    });
    expect(
      await openRoot(
        list([
          { root: "/w", state: "open" },
          { root: "/v", state: "found" },
        ]),
      ),
    ).toBe("/w");
    expect(await openRoot(list([{ root: "/v", state: "found" }]))).toBeUndefined();
    expect(await openRoot(undefined)).toBeUndefined();
  });
});
