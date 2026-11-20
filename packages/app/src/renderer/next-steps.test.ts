import { describe, expect, it, vi } from "vitest";
import type { CommandListing, OpenWorkspaceResult, RecentWorkspaceEntry } from "../shared/protocol.js";
import { CONNECT_AGENT_ACTION } from "./connect-agent.js";
import type { NextStep } from "./next-steps.js";
import type { WorkspaceControls } from "./workspaces.js";
import {
  isStepList,
  nextStepsOf,
  stepRunner,
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

  it("says that a step cannot run in its own workspace", () => {
    expect(stepUnavailable("Create element")).toBe("Create element cannot run here");
  });
});

describe("running a chosen next step (SR-226 AK5)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const setup = (
    entries: readonly RecentWorkspaceEntry[],
    answer: OpenWorkspaceResult = { ok: true },
    controls = true,
  ) => {
    const ran: NextStep[] = [];
    const echoed: string[] = [];
    const open = vi.fn<WorkspaceControls["open"]>(() => Promise.resolve(answer));
    let read: Promise<void> | undefined;
    const runner = stepRunner({
      workspaces: () =>
        controls ? { name: "Station", list: () => Promise.resolve(entries), open } : undefined,
      echo: (message) => echoed.push(message),
      catalogRead: () => read,
      run: (step) => ran.push(step),
    });
    return {
      runner,
      ran,
      echoed,
      open,
      reading: (promise: Promise<void>) => {
        read = promise;
      },
    };
  };
  const elsewhere: NextStep = { command: "element.create", input: {}, open: ["type"], workspace: "/new" };

  it("runs a step at once that names no workspace, or the open one, or without workspace controls", async () => {
    const { runner, ran, open } = setup([{ root: "/new", state: "open" }]);
    const plain: NextStep = { command: "element.create", input: {}, open: [] };
    runner.choose(plain);
    runner.choose(elsewhere);
    await settle();
    expect(ran).toEqual([plain, elsewhere]);
    expect(open).not.toHaveBeenCalled();
    const without = setup([], { ok: true }, false);
    without.runner.choose(elsewhere);
    expect(without.ran).toEqual([elsewhere]);
  });

  it("opens the step's workspace first, also while none is open, and runs it once that is open and read", async () => {
    for (const entries of [[{ root: "/w", state: "open" }], []] as const) {
      const { runner, ran, open, reading } = setup(entries);
      runner.choose(elsewhere);
      await settle();
      // Not listed: opened as a typed folder path.
      expect(open).toHaveBeenCalledExactlyOnceWith("/new", { typed: true });
      // The status of the workspace left changes nothing; the one after the switch runs the step, after the catalog.
      runner.shown(true);
      runner.changed("written");
      expect(ran).toEqual([]);
      runner.changed("opened");
      let done = (): void => undefined;
      reading(
        new Promise((resolve) => {
          done = resolve;
        }),
      );
      runner.shown(true);
      await settle();
      expect(ran).toEqual([]);
      done();
      await settle();
      expect(ran).toEqual([elsewhere]);
      // Once only.
      runner.shown(true);
      await settle();
      expect(ran).toEqual([elsewhere]);
    }
  });

  it("runs nothing when the workspace does not open, and says what the open flow says", async () => {
    const refused = setup([{ root: "/w", state: "open" }], { ok: false, reason: "no-workspace" });
    refused.runner.choose(elsewhere);
    await settle();
    refused.runner.changed("opened");
    refused.runner.shown(true);
    await settle();
    expect(refused.ran).toEqual([]);
    expect(refused.echoed).toEqual(["No workspace in /new or a folder above it; Station stays open"]);
    const gone = setup([
      { root: "/w", state: "open" },
      { root: "/new", state: "missing" },
    ]);
    gone.runner.choose(elsewhere);
    await settle();
    expect(gone.open).not.toHaveBeenCalled();
    expect(gone.echoed).toEqual(["/new is not found; Station stays open"]);
    // Opened, but core could not open the workspace: its status says why, the step does not run.
    const failed = setup([]);
    failed.runner.choose(elsewhere);
    await settle();
    failed.runner.changed("opened");
    failed.runner.shown(false);
    failed.runner.shown(true);
    await settle();
    expect(failed.ran).toEqual([]);
  });
});
