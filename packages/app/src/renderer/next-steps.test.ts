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

  it("names the selection of a step of element.list by the name of the list it opens, and no other", () => {
    const selection = { where: { verification: ["open"] } };
    expect(
      stepGiven(
        { command: "element.list", input: { selection, limit: 300 }, open: [] },
        "Check workspace · Next steps",
      ),
    ).toEqual([
      { field: "selection", value: selection, label: "Check workspace · Next steps" },
      { field: "limit", value: 300, label: "300" },
    ]);
    expect(
      stepGiven({ command: "baseline.create", input: { selection: { view: "core" } }, open: [] }, "Name"),
    ).toEqual([{ field: "selection", value: { view: "core" }, label: '{"view":"core"}' }]);
  });

  it("says that a step cannot run in its own workspace", () => {
    expect(stepUnavailable("Create element")).toBe("Create element cannot run here");
  });
});

describe("running a chosen next step (SR-226 AK5)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const WORKSPACE_W: RecentWorkspaceEntry = { root: "/w", state: "open" };
  const NEW_OPEN: readonly RecentWorkspaceEntry[] = [{ root: "/new", state: "open" }];
  const setup = (
    first: readonly RecentWorkspaceEntry[],
    answer: () => Promise<OpenWorkspaceResult> = () => Promise.resolve({ ok: true }),
    controls = true,
  ) => {
    const ran: NextStep[] = [];
    const echoed: string[] = [];
    let entries: Promise<readonly RecentWorkspaceEntry[]> = Promise.resolve(first);
    const open = vi.fn<WorkspaceControls["open"]>(answer);
    let read: Promise<void> | undefined;
    const runner = stepRunner({
      workspaces: () => (controls ? { name: "Station", list: () => entries, open } : undefined),
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
      // What main lists from now on, as after a switch.
      listing: (next: readonly RecentWorkspaceEntry[] | Error) => {
        entries = next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      },
    };
  };
  const elsewhere: NextStep = { command: "element.create", input: {}, open: ["type"], workspace: "/new" };
  const other: NextStep = { command: "element.create", input: {}, open: [], workspace: "/third" };

  it("runs a step at once that names no workspace, or the open one, or without workspace controls", async () => {
    const { runner, ran, open } = setup(NEW_OPEN);
    const plain: NextStep = { command: "element.create", input: {}, open: [] };
    runner.choose(plain);
    runner.choose(elsewhere);
    await settle();
    // Not waiting: the next one runs too.
    runner.choose(elsewhere);
    await settle();
    expect(ran).toEqual([plain, elsewhere, elsewhere]);
    expect(open).not.toHaveBeenCalled();
    const without = setup([], undefined, false);
    without.runner.choose(elsewhere);
    expect(without.ran).toEqual([elsewhere]);
  });

  it("opens the step's workspace first, also while none is open, and runs it once that is open and read", async () => {
    for (const entries of [[WORKSPACE_W], []]) {
      const { runner, ran, open, reading, listing } = setup(entries);
      runner.choose(elsewhere);
      await settle();
      // Not listed: opened as a typed folder path.
      expect(open).toHaveBeenCalledExactlyOnceWith("/new", { typed: true });
      // The status of the workspace left changes nothing; the one after the switch runs the step, after the catalog.
      runner.shown(true);
      runner.changed("written");
      expect(ran).toEqual([]);
      runner.changed("opened");
      listing(NEW_OPEN);
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
    const refused = setup([WORKSPACE_W], () => Promise.resolve({ ok: false, reason: "no-workspace" }));
    refused.runner.choose(elsewhere);
    await settle();
    refused.runner.changed("opened");
    refused.runner.shown(true);
    await settle();
    expect(refused.ran).toEqual([]);
    expect(refused.echoed).toEqual(["No workspace in /new or a folder above it; Station stays open"]);
    const gone = setup([WORKSPACE_W, { root: "/new", state: "missing" }]);
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
    // The list cannot be read: nothing opens.
    const unread = setup([]);
    unread.listing(new Error("no list"));
    unread.runner.choose(elsewhere);
    await settle();
    expect(unread.open).not.toHaveBeenCalled();
    expect(unread.echoed).toEqual(["/new could not be opened"]);
    // Nothing waits any more: a later step is chosen again.
    unread.listing([]);
    unread.runner.choose(elsewhere);
    await settle();
    expect(unread.open).toHaveBeenCalledOnce();
  });

  it("runs nothing when core stopped after the open, or another workspace opened after it", async () => {
    // Main answered the open, but the core process did not start: it stops, and a later open is not the step's.
    const stopped = setup([WORKSPACE_W]);
    stopped.runner.choose(elsewhere);
    await settle();
    stopped.runner.changed("stopped");
    stopped.runner.changed("opened");
    stopped.listing(NEW_OPEN);
    stopped.runner.shown(true);
    await settle();
    expect(stopped.ran).toEqual([]);
    // A second open before the first status: the step does not run in that workspace.
    const twice = setup([WORKSPACE_W]);
    twice.runner.choose(elsewhere);
    await settle();
    twice.runner.changed("opened");
    twice.runner.changed("opened");
    twice.runner.shown(true);
    await settle();
    expect(twice.ran).toEqual([]);
    // Another workspace is open when the status arrives: the step does not run there.
    const replaced = setup([WORKSPACE_W]);
    replaced.runner.choose(elsewhere);
    await settle();
    replaced.runner.changed("opened");
    replaced.listing([{ root: "/third", state: "open" }]);
    replaced.runner.shown(true);
    await settle();
    expect(replaced.ran).toEqual([]);
    // The list cannot be read then: nothing runs.
    const unread = setup([WORKSPACE_W]);
    unread.runner.choose(elsewhere);
    await settle();
    unread.runner.changed("opened");
    unread.listing(new Error("no list"));
    unread.runner.shown(true);
    await settle();
    expect(unread.ran).toEqual([]);
  });

  it("keeps the first step while its workspace opens: a second choice runs nothing, and a late answer ends no later wait", async () => {
    const answers: ((result: OpenWorkspaceResult) => void)[] = [];
    const { runner, ran, open, listing } = setup(
      [WORKSPACE_W],
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        }),
    );
    runner.choose(elsewhere);
    // Chosen again before main read the list: ignored.
    runner.choose(other);
    await settle();
    expect(open).toHaveBeenCalledOnce();
    // The core process stopped: the first wait ends, and the next choice waits for its own workspace.
    runner.changed("stopped");
    runner.choose(other);
    await settle();
    expect(open).toHaveBeenCalledTimes(2);
    // The first open's late refusal leaves the second wait alone.
    answers[0]?.({ ok: false, reason: "busy" });
    answers[1]?.({ ok: true });
    await settle();
    runner.changed("opened");
    listing([{ root: "/third", state: "open" }]);
    runner.shown(true);
    await settle();
    expect(ran).toEqual([other]);
  });
});
