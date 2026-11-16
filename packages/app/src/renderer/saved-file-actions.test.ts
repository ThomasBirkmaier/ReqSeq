// "Rename perspective", "Delete perspective", "Rename saved filter" and "Delete saved filter" (SR-218): the
// prompts of each step, the calls they send, what the command prompt says, and how the buffers follow a rename
// or a delete. The actions run against a context that records what they dispatch, ask and echo.
import { describe, expect, it, vi } from "vitest";
import { ACTIONS, runAction } from "./actions.js";
import type { ActionContext, Prompt } from "./actions.js";
import type { Buffers, ListBuffer, SearchBuffer } from "./buffers.js";
import {
  listBuffer,
  overviewBuffer,
  perspectiveBuffer,
  perspectiveKey,
  perspectiveModified,
  reduceBuffers,
  searchBuffer,
  withQuery,
} from "./buffers.js";
import type { Call } from "./call.js";
import type { CommandListing } from "../shared/protocol.js";
import { savedStep, statusStep } from "./list-filters.js";
import { NONE } from "./perspective-actions.js";
import { renamedPerspective } from "./perspective-recent.js";
import { NO } from "./confirmation.js";
import { NO_FILTERS, YES_DELETE } from "./saved-file-actions.js";
import { reduceWindow } from "./window-layout.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const ok = (output: unknown) => ({ ok: true, output });
const refused = (code: string, message: string, details?: unknown) => ({ ok: false, code, message, details });

type Answers = Record<string, (input: Record<string, unknown>) => unknown>;

const DRAFTS = {
  name: "Drafts",
  file: "perspectives/drafts.yaml",
  filter: "Sensors",
  where: { status: ["draft"] },
};
const APPROVED = { name: "Approved", file: "perspectives/approved.yaml", where: { status: ["approved"] } };
const BY_TYPE = { name: "By type", file: "perspectives/by-type.yaml", filter: "sensors", where: { all: [] } };

/** The catalog entries the explanation lines read. */
const CATALOG = [
  {
    name: "perspective.rename",
    input: {
      properties: { name: { description: "The perspective." }, newName: { description: "The new name." } },
    },
  },
  { name: "perspective.delete", input: { properties: { confirm: { description: "Delete the file." } } } },
] as unknown as readonly CommandListing[];

const draftsBuffer = (): ListBuffer =>
  perspectiveBuffer({ name: "Drafts", saved: { where: DRAFTS.where, filter: "Sensors" } });

/** A context that shows `shown` and answers the commands with `answers`; a missing answer fails. */
const start = (answers: Answers, shown: Buffers = [overviewBuffer()], more: Partial<ActionContext> = {}) => {
  let buffers: Buffers = shown;
  const asked: Prompt[] = [];
  const echoed: string[] = [];
  const discarded: string[] = [];
  const renamed: [string, string][] = [];
  const call = vi.fn((name: string, input: Record<string, unknown>) =>
    Promise.resolve(answers[name]?.(input) ?? refused("x.failed", `${name} failed`)),
  );
  const context: ActionContext = {
    workspace: true,
    buffers,
    mac: false,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: call as unknown as Call,
    dispatch: (action) => {
      buffers = reduceBuffers(buffers, action);
      (context as { buffers: Buffers }).buffers = buffers;
    },
    ask: (prompt) => asked.push(prompt),
    echo: (message) => echoed.push(message),
    modified: false,
    closeArmed: () => false,
    armClose: () => undefined,
    discard: (key) => discarded.push(key),
    drafted: () => false,
    cycleOrder: [],
    cycled: () => undefined,
    leaveEditor: () => undefined,
    catalog: () => CATALOG,
    perspectives: {
      used: () => ["Approved"],
      opened: () => undefined,
      renamed: (from, to) => renamed.push([from, to]),
    },
    ...more,
  };
  const last = (): Prompt => {
    const prompt = asked.at(-1);
    if (prompt === undefined) {
      throw new Error("nothing asked");
    }
    return prompt;
  };
  return { context, asked, echoed, discarded, renamed, call, last, buffers: () => buffers };
};

const action = (title: string) => {
  const found = ACTIONS.find((candidate) => candidate.title === title);
  if (found === undefined) {
    throw new Error(title);
  }
  return found;
};

/** Chooses the row named `name` of `prompt`. */
const choose = (prompt: Prompt, name: string): void => {
  const row = prompt.items.find((item) => item.name === name);
  if (row === undefined || row.inert === true) {
    throw new Error(`no row ${name}`);
  }
  row.run();
};

const perspectives = () => ok({ perspectives: [DRAFTS, APPROVED, BY_TYPE] });

describe("the four actions", () => {
  it("cover the four catalog commands under their titles, only while the workspace can be written", () => {
    const { context } = start({});
    for (const [title, command] of [
      ["Rename perspective", "perspective.rename"],
      ["Delete perspective", "perspective.delete"],
      ["Rename saved filter", "filter.rename"],
      ["Delete saved filter", "filter.delete"],
    ] as const) {
      expect(action(title).covers).toEqual([command]);
      expect(action(title).available(context)).toBe(true);
      expect(action(title).available({ ...context, readOnly: true })).toBe(false);
      expect(action(title).available({ ...context, workspace: false })).toBe(false);
    }
  });
});

describe("the first step (SR-218 AK1)", () => {
  it("offers the perspectives in the order of use, the one of the shown buffer first, faulty files not choosable", async () => {
    const run = start(
      {
        "perspective.list": () =>
          ok({
            perspectives: [DRAFTS, APPROVED, BY_TYPE],
            problems: [{ code: "file.faulty", message: "not YAML", file: "perspectives/broken.yaml" }],
            incomplete: true,
          }),
      },
      [perspectiveBuffer({ name: "By type", saved: { where: { all: [] } } })],
    );
    action("Rename perspective").run(run.context);
    await flush();
    const prompt = run.last();
    expect(prompt.label).toBe("Rename perspective · name:");
    expect(prompt.explain).toMatchObject({ name: "name", description: "The perspective." });
    expect(prompt.items.map((item) => [item.name, item.inert === true])).toEqual([
      ["By type", false],
      ["Approved", false],
      ["Drafts", false],
      ["perspectives/broken.yaml: not YAML", true],
      [expect.any(String), true],
    ]);
  });

  it("says that there are none, and offers the saved filters by name", async () => {
    const none = start({
      "perspective.list": () => ok({ perspectives: [] }),
      "filter.list": () => ok({ filters: [] }),
    });
    action("Delete perspective").run(none.context);
    action("Delete saved filter").run(none.context);
    await flush();
    expect(none.echoed).toEqual([NONE, NO_FILTERS]);
    expect(none.asked).toEqual([]);

    const filters = start({
      "filter.list": () =>
        ok({
          filters: [{ name: "sensors" }, { name: "Actuators" }],
          problems: [{ code: "file.faulty", message: "filters/x.yaml: not YAML", file: "filters/x.yaml" }],
          incomplete: true,
        }),
    });
    action("Rename saved filter").run(filters.context);
    await flush();
    expect(filters.last().items.map((item) => [item.name, item.inert === true])).toEqual([
      ["Actuators", false],
      ["sensors", false],
      ["filters/x.yaml: not YAML", true],
      [expect.any(String), true],
    ]);

    const faulty = start({
      "filter.list": () => ok({ filters: [], problems: [{ code: "file.faulty", message: "bad" }] }),
    });
    action("Rename saved filter").run(faulty.context);
    await flush();
    expect(faulty.last().items.map((item) => item.name)).toEqual([NO_FILTERS, "bad"]);
  });

  it("says why it cannot list them", async () => {
    const run = start({});
    action("Rename perspective").run(run.context);
    action("Rename saved filter").run(run.context);
    await flush();
    expect(run.echoed).toEqual(["perspective.list failed", "filter.list failed"]);
  });
});

describe("Rename perspective and Rename saved filter (SR-218 AK2, AK4, AK5)", () => {
  it("asks the new name with the old one in the input; Enter renames, and the buffer follows at its place", async () => {
    const drafts = withQuery(draftsBuffer(), { steps: [...draftsBuffer().steps, statusStep("draft")] });
    const run = start(
      {
        "perspective.list": perspectives,
        "perspective.rename": () =>
          ok({
            files: ["perspectives/ready.yaml"],
            renamed: [{ from: DRAFTS.file, to: "perspectives/ready.yaml" }],
          }),
      },
      [overviewBuffer(), drafts, listBuffer("All elements")],
    );
    action("Rename perspective").run(run.context);
    await flush();
    choose(run.last(), "Drafts");
    const asked = run.last();
    expect(asked.label).toBe("Rename perspective Drafts · newName:");
    expect(asked.initial).toBe("Drafts");
    expect(asked.items).toEqual([]);
    expect(asked.explain).toMatchObject({ name: "newName", description: "The new name." });
    asked.text?.("  Ready ");
    await flush();
    expect(run.call).toHaveBeenLastCalledWith("perspective.rename", { name: "Drafts", newName: "Ready" });
    expect(run.echoed).toEqual(["Renamed perspective Drafts to Ready"]);
    expect(run.renamed).toEqual([["Drafts", "Ready"]]);
    const [, renamed] = run.buffers();
    expect(renamed?.key).toBe(perspectiveKey("Ready"));
    expect(renamed?.kind === "list" && renamed.perspective?.name).toBe("Ready");
    expect(renamed?.kind === "list" && renamed.label).toBe("perspective: Ready · status: draft");
    expect(renamed?.kind === "list" && perspectiveModified(renamed)).toBe(true);
  });

  it("asks again on an empty name, a refusal of the new name and of the name, and says any other refusal", async () => {
    let answer: unknown = refused("input.invalid", "newName: taken", { fields: ["newName"] });
    const run = start({ "perspective.list": perspectives, "perspective.rename": () => answer });
    action("Rename perspective").run(run.context);
    await flush();
    choose(run.last(), "Approved");
    run.last().text?.(" ");
    expect(run.last().label).toBe("Rename perspective Approved · newName:");
    run.last().text?.("Drafts");
    await flush();
    expect(run.last().label).toBe("newName: taken · Rename perspective Approved · newName:");
    expect(run.last().initial).toBe("Drafts");
    answer = refused("input.invalid", "name: gone", { fields: ["name"] });
    run.last().text?.("Other");
    await flush();
    expect(run.last().label).toBe("name: gone · Rename perspective · name:");
    choose(run.last(), "Approved");
    answer = refused("input.invalid", "newName: must match", { errors: [{ field: "newName" }] });
    run.last().text?.("x");
    await flush();
    expect(run.last().label).toBe("newName: must match · Rename perspective Approved · newName:");
    answer = refused("file.changed-on-disk", "changed on disk");
    run.last().text?.("y");
    await flush();
    expect(run.echoed).toEqual(["changed on disk"]);
    answer = ok({ files: [], renamed: [] });
    run.last().back?.();
    await flush();
    expect(run.last().label).toBe("Rename perspective · name:");
    choose(run.last(), "Approved");
    run.last().text?.("Approved");
    await flush();
    expect(run.echoed.at(-1)).toBe("Nothing changed: the perspective Approved has this name");
    expect(run.renamed).toEqual([]);
  });

  it("shows the perspectives that name the filter as rows with their count; the lists and perspectives follow", async () => {
    const drafts = draftsBuffer();
    const list = withQuery(listBuffer("All elements"), {
      steps: [savedStep("SENSORS"), statusStep("draft")],
    });
    const search: SearchBuffer = { ...searchBuffer("pump"), steps: [savedStep("Sensors")] };
    const run = start(
      {
        "filter.list": () => ok({ filters: [{ name: "Sensors" }] }),
        "perspective.list": perspectives,
        "filter.rename": () =>
          ok({
            files: ["perspectives/drafts.yaml", "filters/sensor.yaml"],
            renamed: [],
            perspectives: [
              { name: "Drafts", file: DRAFTS.file },
              { name: "By type", file: BY_TYPE.file },
            ],
            problems: [{ code: "x", message: "a warning", severity: "warning" }],
          }),
      },
      [drafts, list, search],
    );
    action("Rename saved filter").run(run.context);
    await flush();
    choose(run.last(), "Sensors");
    await flush();
    const asked = run.last();
    expect(asked.items.map((item) => [item.name, item.inert])).toEqual([
      ["2 perspectives name this saved filter and change with it", true],
      ["Drafts", true],
      ["By type", true],
    ]);
    expect(await asked.seek?.("Sensor")).toEqual({ choices: asked.items, alone: true });
    asked.text?.("Sensor");
    await flush();
    expect(run.echoed).toEqual([
      "Renamed saved filter Sensors to Sensor; changed with it: Drafts, By type · a warning",
    ]);
    const [shownDrafts, shownList, shownSearch] = run.buffers() as [ListBuffer, ListBuffer, SearchBuffer];
    expect(shownDrafts.perspective?.saved?.filter).toBe("Sensor");
    expect(shownDrafts.steps[0]?.selection.filter).toBe("Sensor");
    expect(perspectiveModified(shownDrafts)).toBe(false);
    expect(shownList.label).toBe("filter: Sensor · status: draft");
    expect(shownList.selection?.filter).toBe("Sensor");
    expect(shownSearch.steps[0]?.label).toBe("filter: Sensor");
    expect(shownSearch.selection).toEqual({ filter: "Sensor" });
  });

  it("names one perspective in the singular, and none when perspective.list fails", async () => {
    const one = start({
      "filter.list": () => ok({ filters: [{ name: "Sensors" }] }),
      "perspective.list": () => ok({ perspectives: [DRAFTS] }),
    });
    action("Rename saved filter").run(one.context);
    await flush();
    choose(one.last(), "Sensors");
    await flush();
    expect(one.last().items[0]?.name).toBe("1 perspective names this saved filter and change with it");

    const failing = start({ "filter.list": () => ok({ filters: [{ name: "Sensors" }] }) });
    action("Rename saved filter").run(failing.context);
    await flush();
    choose(failing.last(), "Sensors");
    await flush();
    expect(failing.last().items).toEqual([]);
  });

  it("saves the input of the open buffers first and does not rename when one cannot be saved", async () => {
    const run = start({ "perspective.list": perspectives }, [overviewBuffer()], {
      drafted: () => true,
      saveDraft: () => Promise.resolve(false),
    });
    action("Rename perspective").run(run.context);
    await flush();
    choose(run.last(), "Drafts");
    run.last().text?.("Ready");
    await flush();
    expect(run.echoed).toEqual(["Overview could not be saved: Rename perspective did not run"]);
    expect(run.call).not.toHaveBeenCalledWith("perspective.rename", expect.anything());
  });
});

describe("Delete perspective and Delete saved filter (SR-218 AK3, AK6)", () => {
  const deleting = {
    name: "Drafts",
    file: "perspectives/drafts.yaml",
    fileSha256: "a".repeat(64),
    deleted: false,
    files: [],
  };

  it("asks the confirmation at once, No first: it names name and file, No and Escape go back, Yes and Ctrl+Enter delete only that file", async () => {
    const drafts = withQuery(draftsBuffer(), { steps: [...draftsBuffer().steps, statusStep("draft")] });
    const run = start(
      {
        "perspective.list": perspectives,
        "perspective.delete": (input) =>
          input["confirm"] === true
            ? ok({ ...deleting, deleted: true, files: [deleting.file] })
            : ok({
                ...deleting,
                problems: [{ code: "x", message: "another file has the name", severity: "warning" }],
              }),
      },
      [drafts, overviewBuffer()],
    );
    action("Delete perspective").run(run.context);
    await flush();
    expect(run.last().items[0]?.name).toBe("Drafts");
    choose(run.last(), "Drafts");
    await flush();
    expect(run.call).toHaveBeenLastCalledWith("perspective.delete", { name: "Drafts" });
    const confirm = run.last();
    expect(confirm.label).toBe("Delete perspective Drafts · confirm:");
    expect(confirm.items.map((item) => item.name)).toEqual([NO, YES_DELETE]);
    expect(confirm.explain).toMatchObject({
      name: "confirm",
      description:
        "Deletes the perspective Drafts, file perspectives/drafts.yaml; a file Git does not track does not come back; the changes of its modified buffer are lost · another file has the name",
      more: true,
      moreDoes: "deletes",
    });
    // No and Escape go back to the choice, and delete nothing.
    choose(confirm, NO);
    await flush();
    expect(run.last().label).toBe("Delete perspective · name:");
    choose(run.last(), "Drafts");
    await flush();
    run.last().back?.();
    await flush();
    expect(run.last().label).toBe("Delete perspective · name:");
    expect(run.call.mock.calls.filter(([, input]) => input["confirm"] === true)).toEqual([]);
    // Ctrl/Cmd+Enter confirms, whichever hit is marked.
    choose(run.last(), "Drafts");
    await flush();
    run.last().confirm?.();
    await flush();
    expect(run.call).toHaveBeenLastCalledWith("perspective.delete", {
      name: "Drafts",
      confirm: true,
      file: "perspectives/drafts.yaml",
      expectedFileSha256: "a".repeat(64),
    });
    expect(run.discarded).toEqual([perspectiveKey("Drafts")]);
    expect(run.buffers().map((buffer) => buffer.key)).toEqual(["overview"]);
    expect(run.echoed).toEqual(["Deleted perspective Drafts (perspectives/drafts.yaml)"]);
  });

  it("shows a refusal at the first step, and says the refusal of the confirmed call", async () => {
    let confirmed: unknown = refused("file.changed-on-disk", "changed since");
    const run = start({
      "filter.list": () => ok({ filters: [{ name: "Sensors" }, { name: "Old" }] }),
      "filter.delete": (input) =>
        input["confirm"] === true
          ? confirmed
          : input["name"] === "Sensors"
            ? refused("input.invalid", "name: Drafts names it", { reason: "referenced" })
            : ok({ ...deleting, name: "Old", file: "filters/old.yaml" }),
    });
    action("Delete saved filter").run(run.context);
    await flush();
    choose(run.last(), "Sensors");
    await flush();
    expect(run.last().label).toBe("name: Drafts names it · Delete saved filter · name:");
    choose(run.last(), "Old");
    await flush();
    expect(run.last().explain?.description).toBe(
      "Deletes the saved filter Old, file filters/old.yaml; a file Git does not track does not come back",
    );
    choose(run.last(), YES_DELETE);
    await flush();
    expect(run.echoed).toEqual(["changed since"]);
    confirmed = ok({ ...deleting, name: "Old", file: "filters/old.yaml" });
    choose(run.last(), YES_DELETE);
    await flush();
    expect(run.echoed.at(-1)).toBe("Nothing was deleted: saved filter Old");
  });

  it("deletes a perspective without an open buffer, and not when an input cannot be saved", async () => {
    const answers = {
      "perspective.list": perspectives,
      "perspective.delete": (input: Record<string, unknown>) =>
        input["confirm"] === true ? ok({ ...deleting, deleted: true, files: [deleting.file] }) : ok(deleting),
    };
    const run = start(answers);
    action("Delete perspective").run(run.context);
    await flush();
    choose(run.last(), "Drafts");
    await flush();
    choose(run.last(), YES_DELETE);
    await flush();
    expect(run.discarded).toEqual([]);
    expect(run.echoed).toEqual(["Deleted perspective Drafts (perspectives/drafts.yaml)"]);

    const unsaved = start(answers, [overviewBuffer()], {
      drafted: () => true,
      saveDraft: () => Promise.resolve(false),
    });
    action("Delete perspective").run(unsaved.context);
    await flush();
    choose(unsaved.last(), "Drafts");
    await flush();
    choose(unsaved.last(), YES_DELETE);
    await flush();
    expect(unsaved.echoed).toEqual(["Overview could not be saved: Delete perspective did not run"]);
  });
});

describe("Escape in the first step (SR-134 AK1, AK2)", () => {
  it("goes where it went the first time, also when the step is asked again after a step back", async () => {
    const first = vi.fn();
    const run = start({ "perspective.list": perspectives });
    runAction(action("Rename perspective"), run.context, first);
    await flush();
    expect(run.last().previous).toBe(first);
    choose(run.last(), "Drafts");
    run.last().back?.();
    await flush();
    expect(run.last().label).toBe("Rename perspective · name:");
    expect(run.last().previous).toBe(first);
    // Not chosen in the command prompt: Escape ends the prompt, also after a step back.
    const alone = start({ "perspective.list": perspectives });
    runAction(action("Rename perspective"), alone.context);
    await flush();
    choose(alone.last(), "Drafts");
    alone.last().back?.();
    await flush();
    expect(alone.last().label).toBe("Rename perspective · name:");
    expect(alone.last().previous).toBeUndefined();
    expect(alone.last().back).toBeUndefined();
  });
});

describe("the buffers after a rename (SR-218 AK4, AK5)", () => {
  it("close another perspective's buffer under the new name, keep a case-only rename, and ignore unknown names", () => {
    const stale = perspectiveBuffer({ name: "Ready", error: "only a faulty file" });
    const buffers: Buffers = [draftsBuffer(), stale, overviewBuffer()];
    const renamed = reduceBuffers(buffers, { type: "perspective-renamed", from: "Drafts", to: "Ready" });
    expect(renamed.map((buffer) => buffer.key)).toEqual([perspectiveKey("Ready"), "overview"]);
    const cased = reduceBuffers(buffers, { type: "perspective-renamed", from: "Drafts", to: "DRAFTS" });
    expect(cased.map((buffer) => buffer.key)).toEqual(buffers.map((buffer) => buffer.key));
    expect(reduceBuffers(buffers, { type: "perspective-renamed", from: "Other", to: "X" })).toBe(buffers);
    // Without an open buffer of the renamed perspective, the buffer under the new name closes all the same.
    const notOpen: Buffers = [stale, overviewBuffer()];
    expect(
      reduceBuffers(notOpen, { type: "perspective-renamed", from: "Other", to: "Ready" }).map(
        (buffer) => buffer.key,
      ),
    ).toEqual(["overview"]);
    expect(reduceBuffers([overviewBuffer()], { type: "perspective-renamed", from: "a", to: "A" })).toEqual([
      overviewBuffer(),
    ]);
    expect(reduceBuffers(buffers, { type: "filter-renamed", from: "Other", to: "X" })).toBe(buffers);
  });

  it("keep a renamed perspective in the inactive area under its new key", () => {
    const state = {
      buffers: [overviewBuffer(), draftsBuffer()] as Buffers,
      layout: { active: "left" as const, other: perspectiveKey("Drafts") },
    };
    expect(reduceWindow(state, { type: "perspective-renamed", from: "Drafts", to: "Ready" }).layout).toEqual({
      active: "left",
      other: perspectiveKey("Ready"),
    });
    const shown = {
      buffers: [
        draftsBuffer(),
        perspectiveBuffer({ name: "Ready", error: "gone" }),
        overviewBuffer(),
      ] as Buffers,
      layout: { active: "left" as const, other: perspectiveKey("Ready") },
    };
    expect(reduceWindow(shown, { type: "perspective-renamed", from: "Drafts", to: "Ready" }).layout).toEqual({
      active: "left",
      other: "overview",
    });
    const elsewhere = { ...state, layout: { active: "left" as const, other: perspectiveKey("Drafts") } };
    expect(reduceWindow(elsewhere, { type: "perspective-renamed", from: "Other", to: "X" }).layout).toEqual(
      elsewhere.layout,
    );
  });

  it("keep the place of a renamed perspective in the order of use", () => {
    expect(renamedPerspective(["Approved", "drafts", "Ready"], "Drafts", "Ready")).toEqual([
      "Approved",
      "Ready",
    ]);
    const used = ["Approved"];
    expect(renamedPerspective(used, "Drafts", "Ready")).toBe(used);
  });
});
