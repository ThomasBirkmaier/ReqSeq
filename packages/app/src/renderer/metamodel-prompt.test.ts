import { describe, expect, it } from "vitest";
import type { MetamodelGetOutput } from "@reqseq/core";
import type { Prompt } from "./action-types.js";
import { ACTIONS } from "./actions.js";
import { elementBuffer } from "./buffers.js";
import { catalogItems, startCommand } from "./catalog-commands.js";
import {
  CATALOG,
  command,
  flush,
  item,
  last,
  refusedWith,
  setup,
  start,
} from "./catalog-commands.test-helper.js";
import { metamodelGiven } from "./metamodel-menu.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";
import type { CatalogContext } from "./catalog-arguments.js";

/** The metamodel of the fixture, with `uses` changed. */
const used = (uses: Partial<MetamodelGetOutput["uses"]>): MetamodelGetOutput => ({
  ...FIXTURE_METAMODEL,
  uses: { ...FIXTURE_METAMODEL.uses, ...uses },
});

/** `list` of `uses` with the number of `key` set to `count`. */
const withCount = (list: MetamodelGetOutput["uses"]["types"], key: string, count: number) =>
  list.map((entry) => (entry.key === key ? { key, count } : entry));

/** A context over the overview whose `metamodel.get` gives `metamodel`, and the answers of the other commands. */
const ready = (
  answers: Record<string, (input: Record<string, unknown>) => unknown> = {},
  metamodel: MetamodelGetOutput = FIXTURE_METAMODEL,
) =>
  setup([{ kind: "overview", key: "overview" } as never], {
    "metamodel.get": () => metamodel,
    ...answers,
  });

/** Chooses the hit `name` of the last prompt. */
const choose = async (asked: readonly Prompt[], name: string): Promise<void> => {
  item((await last(asked)).items, name).run();
  await flush();
};

/** Types `text` into the last prompt and presses Enter. */
const type = async (asked: readonly Prompt[], text: string): Promise<void> => {
  const prompt = await last(asked);
  const literal = prompt.literal?.(text);
  if (literal === undefined) {
    prompt.text?.(text);
  } else {
    literal.run();
  }
  await flush();
};

/** Presses Enter on an empty input of the last prompt. */
const enter = async (asked: readonly Prompt[]): Promise<void> => {
  const prompt = await last(asked);
  if (prompt.empty === undefined) {
    prompt.text?.("");
  } else {
    prompt.empty(false);
  }
  await flush();
};

/** The input the command `name` ran with, the last time. */
const ranWith = (call: ReturnType<typeof setup>["call"], name: string): unknown =>
  call.mock.calls.filter(([called]) => called === name).at(-1)?.[1];

const OK = { answer: "Changed.", files: ["metamodel/standard-model.yaml"], problems: [] };

describe("the metamodel commands in the command prompt (SR-236)", () => {
  it("[SR-236/AK-q76q] asks the definition, the field to change and its new value, and skips what the place gives", async () => {
    const { context, asked, call } = ready({ "metamodel.changeType": () => OK });
    start(context, "metamodel.changeType");
    await flush();
    expect((await last(asked)).label).toBe("Change type definition · Type:");
    await choose(asked, "Decision");
    const what = await last(asked);
    expect(what.label).toBe("Change type definition Decision · Change:");
    expect(what.items.map((hit) => hit.name)).toEqual([
      "Name",
      "Description",
      "Prefix",
      "Parent type",
      "Abstract",
      "Meaning",
    ]);
    await choose(asked, "Name");
    // The new value starts with the current one.
    expect((await last(asked)).initial).toBe("Decision");
    await type(asked, "Ruling");
    expect(ranWith(call, "metamodel.changeType")).toEqual({ type: "decision", name: "Ruling" });

    // A type given by the place (the context menu, SR-199 AK5) is not asked.
    const given = ready({ "metamodel.changeType": () => OK });
    startCommand(given.context, command("metamodel.changeType"), false, [
      { field: "type", value: "decision", label: "Decision" },
    ]);
    await flush();
    expect((await last(given.asked)).label).toBe("Change type definition Decision · Change:");
    await choose(given.asked, "Parent type");
    await choose(given.asked, "No parent type");
    expect(ranWith(given.call, "metamodel.changeType")).toEqual({ type: "decision", extends: null });
    // With every step given by the place, the command runs at once.
    const again = ready();
    startCommand(again.context, command("metamodel.removeType"), false, [
      { field: "type", value: "decision", label: "Decision" },
    ]);
    await flush();
    expect(again.call.mock.calls.some(([name]) => name === "metamodel.removeType")).toBe(true);
  });

  it("[SR-236/AK-q76q] asks several types as marks with Any type, and a minimum and maximum per target type as a number or empty", async () => {
    const { context, asked, call } = ready({ "metamodel.addRelationKind": () => OK });
    start(context, "metamodel.addRelationKind");
    await flush();
    await type(asked, "Verified by");
    await type(asked, "verified-by");
    await enter(asked);
    // Any type writes no list.
    const sources = await last(asked);
    expect(sources.items[0]?.name).toBe("Any type");
    await choose(asked, "Any type");
    await choose(asked, "Decision");
    const marked = await last(asked);
    expect(marked.marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    expect(marked.items[0]?.name).toBe("Take 1 type");
    await choose(asked, "Package");
    await choose(asked, "Take 2 types");
    // The target types for limits are marks from every type, then a minimum and a maximum per marked type.
    expect((await last(asked)).label).toBe(
      "Add relation kind Verified by verified-by Decision, Package · Limits for:",
    );
    expect((await last(asked)).items[0]?.name).toBe("No limits");
    await choose(asked, "Decision");
    await choose(asked, "Package");
    await choose(asked, "Take 2 types");
    expect((await last(asked)).label).toBe(
      "Add relation kind Verified by verified-by Decision, Package Decision, Package · At least, to Decision:",
    );
    await type(asked, "1");
    await enter(asked);
    await enter(asked);
    await type(asked, "3");
    expect(ranWith(call, "metamodel.addRelationKind")).toEqual({
      name: "Verified by",
      key: "verified-by",
      targetTypes: ["decision", "package"],
      limits: [
        { "target-type": "decision", min: 1 },
        { "target-type": "package", max: 3 },
      ],
    });

    // A change: Any type removes the list, and empty limits remove them.
    const change = ready({ "metamodel.changeRelationKind": () => OK });
    start(change.context, "metamodel.changeRelationKind");
    await flush();
    await choose(change.asked, "Replaces");
    await choose(change.asked, "Source types");
    await choose(change.asked, "Any type");
    expect(ranWith(change.call, "metamodel.changeRelationKind")).toEqual({
      kind: "replaces",
      sourceTypes: null,
    });
    start(change.context, "metamodel.changeRelationKind");
    await flush();
    await choose(change.asked, "Replaces");
    await choose(change.asked, "Limits");
    await choose(change.asked, "No limits");
    expect(ranWith(change.call, "metamodel.changeRelationKind")).toEqual({ kind: "replaces", limits: null });

    // Every limit for any source type is shown with its target type marked, a subtype of a target type too; a
    // limit for one source type stays as it is; a refused limit asks the limits again with core's message.
    const limited: MetamodelGetOutput = {
      ...FIXTURE_METAMODEL,
      relations: FIXTURE_METAMODEL.relations.map((kind) =>
        kind.key === "replaces"
          ? {
              ...kind,
              limits: [
                { "target-type": "requirement", max: 4 },
                { "target-type": "software-requirement", max: 2 },
                { "source-type": "software-requirement", "target-type": "requirement", min: 1 },
              ],
            }
          : kind,
      ),
    };
    let refuse = true;
    const limits = ready(
      {
        "metamodel.changeRelationKind": () => {
          const answer = refuse
            ? refusedWith("A limit is not a number", { reason: "metamodel-invalid", field: "limits" })
            : OK;
          refuse = false;
          return answer;
        },
      },
      limited,
    );
    start(limits.context, "metamodel.changeRelationKind");
    await flush();
    await choose(limits.asked, "Replaces");
    await choose(limits.asked, "Limits");
    expect((await last(limits.asked)).marks?.map((mark) => mark.label)).toEqual([
      "type: requirement, software-requirement",
    ]);
    await choose(limits.asked, "Take 2 types");
    expect((await last(limits.asked)).initial).toBeUndefined();
    await enter(limits.asked);
    expect((await last(limits.asked)).initial).toBe("4");
    await type(limits.asked, "4x");
    await enter(limits.asked);
    expect((await last(limits.asked)).initial).toBe("2");
    await type(limits.asked, "2");
    expect((await last(limits.asked)).label).toBe(
      "A limit is not a number · Change relation kind Replaces Limits System Requirement, Software Requirement · At least, to System Requirement:",
    );
    await type(limits.asked, "2");
    await type(limits.asked, "5");
    await enter(limits.asked);
    expect((await last(limits.asked)).initial).toBe("2");
    await type(limits.asked, "2");
    expect(ranWith(limits.call, "metamodel.changeRelationKind")).toEqual({
      kind: "replaces",
      limits: [
        { "target-type": "requirement", min: 2, max: 5 },
        { "target-type": "software-requirement", max: 2 },
        { "source-type": "software-requirement", "target-type": "requirement", min: 1 },
      ],
    });
    // Unmarking a target type removes its limit.
    start(limits.context, "metamodel.changeRelationKind");
    await flush();
    await choose(limits.asked, "Replaces");
    await choose(limits.asked, "Limits");
    (await last(limits.asked)).marks?.[0]?.remove();
    await flush();
    await choose(limits.asked, "No limits");
    expect(ranWith(limits.call, "metamodel.changeRelationKind")).toEqual({
      kind: "replaces",
      limits: [{ "source-type": "software-requirement", "target-type": "requirement", min: 1 }],
    });
    // A new kind and a kind open to any type get limits to the types marked.
    start(context, "metamodel.addRelationKind");
    await flush();
    await type(asked, "Touches");
    await type(asked, "touches");
    await enter(asked);
    await choose(asked, "Any type");
    await choose(asked, "Any type");
    await choose(asked, "No limits");
    expect(ranWith(call, "metamodel.addRelationKind")).toEqual({ name: "Touches", key: "touches" });
    start(change.context, "metamodel.changeRelationKind");
    await flush();
    await choose(change.asked, "Refines");
    await choose(change.asked, "Limits");
    await choose(change.asked, "Package");
    await choose(change.asked, "Take 1 type");
    await type(change.asked, "1");
    await enter(change.asked);
    expect(ranWith(change.call, "metamodel.changeRelationKind")).toEqual({
      kind: "refines",
      limits: [{ "target-type": "package", min: 1 }],
    });
  });

  it("[SR-215/AK-rx2z] keeps the marks of types and fixed values when Escape goes back, and shows them when the step is asked again", async () => {
    const { context, asked, call } = ready({
      "metamodel.changeRelationKind": () => OK,
      "metamodel.changeProperty": () => OK,
    });
    start(context, "metamodel.changeRelationKind");
    await flush();
    await choose(asked, "Replaces");
    await choose(asked, "Source types");
    await choose(asked, "Decision");
    (await last(asked)).back?.();
    await flush();
    expect((await last(asked)).label).toBe("Change relation kind Replaces · Change:");
    await choose(asked, "Source types");
    expect((await last(asked)).marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    // A step answered and asked again shows the marks it took.
    await choose(asked, "Take 1 type");
    expect(ranWith(call, "metamodel.changeRelationKind")).toEqual({
      kind: "replaces",
      sourceTypes: ["decision"],
    });
    start(context, "metamodel.changeRelationKind");
    await flush();
    await choose(asked, "Replaces");
    await choose(asked, "Limits");
    await choose(asked, "Package");
    await choose(asked, "Take 1 type");
    (await last(asked)).back?.();
    await flush();
    expect((await last(asked)).marks?.map((mark) => mark.label)).toEqual(["type: package"]);

    // Fixed values: Escape goes back with the mark, Backspace removes it (`unmark`).
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Component");
    await choose(asked, "Add fixed values");
    await type(asked, "Motor");
    await type(asked, "motor");
    (await last(asked)).back?.();
    await flush();
    expect((await last(asked)).label).toBe("Change property definition Component · Change:");
    await choose(asked, "Add fixed values");
    const marked = await last(asked);
    expect(marked.marks?.map((mark) => mark.label)).toEqual(["Motor · motor"]);
    expect(marked.unmark).toBe(true);

    // A mark removed stays removed: "Any type" taken after it, and an empty mark left with Escape.
    start(context, "metamodel.addRelationKind");
    await flush();
    await type(asked, "Touches");
    await type(asked, "touches");
    await enter(asked);
    await choose(asked, "Decision");
    (await last(asked)).back?.();
    await flush();
    await enter(asked);
    expect((await last(asked)).marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    (await last(asked)).marks?.[0]?.remove();
    await flush();
    await choose(asked, "Any type");
    expect((await last(asked)).label).toBe("Add relation kind Touches touches · Target types:");
    (await last(asked)).back?.();
    await flush();
    expect((await last(asked)).label).toBe("Add relation kind Touches touches · Source types:");
    expect((await last(asked)).marks).toEqual([]);
    let refuse = true;
    const limited = ready(
      {
        "metamodel.changeRelationKind": () => {
          const given = refuse
            ? refusedWith("A limit is wrong", { reason: "metamodel-invalid", field: "limits" })
            : OK;
          refuse = false;
          return given;
        },
      },
      {
        ...FIXTURE_METAMODEL,
        relations: FIXTURE_METAMODEL.relations.map((kind) =>
          kind.key === "replaces"
            ? {
                ...kind,
                limits: [
                  { "source-type": "software-requirement", "target-type": "requirement", min: 1 },
                  { "target-type": "requirement", max: 4 },
                ],
              }
            : kind,
        ),
      },
    );
    start(limited.context, "metamodel.changeRelationKind");
    await flush();
    await choose(limited.asked, "Replaces");
    await choose(limited.asked, "Limits");
    (await last(limited.asked)).marks?.[0]?.remove();
    await flush();
    (await last(limited.asked)).back?.();
    await flush();
    await choose(limited.asked, "Limits");
    expect((await last(limited.asked)).marks).toEqual([]);
    // A refused limit without a number asked asks the target types again.
    await choose(limited.asked, "No limits");
    expect((await last(limited.asked)).label).toBe(
      "A limit is wrong · Change relation kind Replaces Limits · Limits for:",
    );
    // Each limit keeps its place in the list.
    await choose(limited.asked, "System Requirement");
    await choose(limited.asked, "Take 1 type");
    await enter(limited.asked);
    await type(limited.asked, "5");
    expect(ranWith(limited.call, "metamodel.changeRelationKind")).toEqual({
      kind: "replaces",
      limits: [
        { "source-type": "software-requirement", "target-type": "requirement", min: 1 },
        { "target-type": "requirement", max: 5 },
      ],
    });
  });

  it("[SR-236/AK-q76q] asks fixed values one by one with name and key as marks, and the most entries as a number or empty", async () => {
    const { context, asked, call } = ready({
      "metamodel.addProperty": () => OK,
      "metamodel.changeProperty": () => OK,
    });
    start(context, "metamodel.addProperty");
    await flush();
    await choose(asked, "Decision");
    // The properties the type does not have, or a typed name of a new one.
    expect((await last(asked)).items.map((hit) => hit.name)).toEqual([
      "Rationale",
      "Component",
      "Package",
      "Severity",
    ]);
    await type(asked, "Risk level");
    expect((await last(asked)).initial).toBe("risk-level");
    await enter(asked);
    // An empty key is asked again; the typed key is taken.
    await type(asked, "risk-level");
    await choose(asked, "choice");
    await type(asked, "Very high");
    expect((await last(asked)).initial).toBe("very-high");
    await type(asked, "very-high");
    await type(asked, "Low");
    await type(asked, "lo");
    const marks = await last(asked);
    expect(marks.marks?.map((mark) => mark.label)).toEqual(["Very high · very-high", "Low · lo"]);
    await choose(asked, "Take 2 fixed values");
    await choose(asked, "no");
    await choose(asked, "yes");
    expect(ranWith(call, "metamodel.addProperty")).toEqual({
      type: "decision",
      required: true,
      name: "Risk level",
      key: "risk-level",
      kind: "choice",
      choices: [
        { name: "Very high", key: "very-high" },
        { name: "Low", key: "lo" },
      ],
    });

    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Component");
    await choose(asked, "Most entries");
    await enter(asked);
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({ property: "component", maxItems: null });
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Component");
    await choose(asked, "Rename fixed value");
    await choose(asked, "Sensor");
    await type(asked, "Probe");
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({
      property: "component",
      changeChoices: [{ choice: "sensor", name: "Probe" }],
    });
  });

  it("[SR-236/AK-q76q] asks the steps of every other metamodel command, and goes back one step at a time", async () => {
    const { context, asked, call, reopened, echoed } = ready(
      Object.fromEntries(
        [
          "metamodel.removeProperty",
          "metamodel.removeRelationKind",
          "metamodel.addStatus",
          "metamodel.changeStatus",
          "metamodel.changeType",
          "metamodel.addProperty",
          "metamodel.changeProperty",
        ].map((name) => [name, () => OK]),
      ),
    );
    start(context, "metamodel.removeProperty");
    await flush();
    await choose(asked, "Software Requirement");
    expect((await last(asked)).items.map((hit) => hit.name)).toEqual([
      "Title",
      "Rationale",
      "Component",
      "Package",
    ]);
    await choose(asked, "Component");
    expect(ranWith(call, "metamodel.removeProperty")).toEqual({
      type: "software-requirement",
      property: "component",
    });

    start(context, "metamodel.removeRelationKind");
    await flush();
    await choose(asked, "Blocks");
    expect(ranWith(call, "metamodel.removeRelationKind")).toEqual({ kind: "blocks" });

    // An existing status, or a new one with its key and whether it is invalid.
    start(context, "metamodel.addStatus");
    await flush();
    await choose(asked, "Decision");
    expect((await last(asked)).items.map((hit) => hit.name)).toEqual(["Draft", "Approved", "Retired"]);
    await choose(asked, "Retired");
    expect(ranWith(call, "metamodel.addStatus")).toEqual({ type: "decision", status: "retired" });
    start(context, "metamodel.addStatus");
    await flush();
    await choose(asked, "Decision");
    expect((await last(asked)).literal?.("  ")).toBeUndefined();
    await type(asked, "On hold");
    await type(asked, "on-hold");
    await choose(asked, "yes");
    expect(ranWith(call, "metamodel.addStatus")).toEqual({
      type: "decision",
      name: "On hold",
      key: "on-hold",
      invalid: true,
    });

    // An empty description removes it; the meaning is one of the catalog's, or none.
    start(context, "metamodel.changeStatus");
    await flush();
    await choose(asked, "Open");
    await choose(asked, "Description");
    await enter(asked);
    expect(ranWith(call, "metamodel.changeStatus")).toEqual({ status: "open", description: null });
    start(context, "metamodel.changeType");
    await flush();
    await choose(asked, "Package");
    await choose(asked, "Meaning");
    await choose(asked, "No meaning");
    expect(ranWith(call, "metamodel.changeType")).toEqual({ type: "package", meaning: null });

    // A required property in a type; target types of a new relation property; most entries of several values.
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Rationale");
    await choose(asked, "Required in a type");
    expect((await last(asked)).items.map((hit) => hit.name)).toEqual([
      "System Requirement",
      "Software Requirement",
    ]);
    await choose(asked, "System Requirement");
    await choose(asked, "yes");
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({
      property: "rationale",
      type: "requirement",
      required: true,
    });
    start(context, "metamodel.addProperty");
    await flush();
    await choose(asked, "Decision");
    await type(asked, "Affects");
    await type(asked, "affects");
    await choose(asked, "relation");
    await choose(asked, "Package");
    // The × of the mark removes it.
    (await last(asked)).marks?.[0]?.remove();
    await flush();
    expect((await last(asked)).marks).toEqual([]);
    await choose(asked, "Package");
    await choose(asked, "Take 1 type");
    await choose(asked, "yes");
    await choose(asked, "no");
    expect(ranWith(call, "metamodel.addProperty")).toEqual({
      type: "decision",
      required: false,
      name: "Affects",
      key: "affects",
      kind: "relation",
      targetTypes: ["package"],
      many: true,
    });
    start(context, "metamodel.addProperty");
    await flush();
    await choose(asked, "Decision");
    await type(asked, "Notes");
    await type(asked, "notes");
    await choose(asked, "text");
    await choose(asked, "yes");
    await type(asked, "five");
    await choose(asked, "no");
    // Text that is no number goes in as it is typed, and core says what is wrong with it.
    expect(ranWith(call, "metamodel.addProperty")).toMatchObject({ many: true, maxItems: "five" });

    // Backspace: the step before, a fixed value's key back to its name, a mark, then the command prompt.
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Component");
    await choose(asked, "Add fixed values");
    await type(asked, "Motor");
    (await last(asked)).back?.();
    await flush();
    expect((await last(asked)).label).toBe(
      "Change property definition Component Add fixed values · Fixed value:",
    );
    await type(asked, "Motor");
    await type(asked, "motor");
    (await last(asked)).marks?.[0]?.remove();
    await flush();
    // Without a mark, Enter on an empty input asks again: a change without a fixed value changes nothing.
    await enter(asked);
    expect((await last(asked)).label).toBe(
      "Change property definition Component Add fixed values · Fixed value:",
    );
    await type(asked, "Motor");
    await type(asked, "motor");
    await enter(asked);
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({
      property: "component",
      addChoices: [{ name: "Motor", key: "motor" }],
    });
    // A fixed value's description; empty removes it.
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Component");
    await choose(asked, "Describe fixed value");
    await choose(asked, "Display");
    await enter(asked);
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({
      property: "component",
      changeChoices: [{ choice: "display", description: null }],
    });
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Component");
    await choose(asked, "Add fixed values");
    await type(asked, "Motor");
    await enter(asked);
    expect((await last(asked)).label).toBe(
      "Change property definition Component Add fixed values · Fixed value:",
    );
    (await last(asked)).back?.();
    await flush();
    expect((await last(asked)).label).toBe("Change property definition Component · Change:");
    (await last(asked)).back?.();
    await flush();
    (await last(asked)).back?.();
    await flush();
    expect(reopened()).toBe(1);
    // In the types step, back goes to the step before.
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Package");
    await choose(asked, "Target types");
    (await last(asked)).back?.();
    await flush();
    expect((await last(asked)).label).toBe("Change property definition Package · Change:");
    // An empty name is asked again.
    start(context, "metamodel.addType");
    await flush();
    await enter(asked);
    expect((await last(asked)).label).toBe("Add type · Name:");
    // Each command that ran said core's answer (SR-223 AK8).
    expect(new Set(echoed)).toEqual(new Set(["Changed."]));
  });

  it("says why the metamodel cannot be read, and does not run while an input cannot be saved", async () => {
    const failing = setup([], {
      "metamodel.get": () =>
        Object.assign(new Error("The metamodel cannot be read"), { name: "workspace.read-only" }),
    });
    startCommand(failing.context, command("metamodel.removeType"), false);
    // The first step opens at once and says why it has no hits; Backspace goes back to the command prompt.
    const opened = await last(failing.asked);
    expect(opened.label).toBe("The metamodel cannot be read · Remove type · Type:");
    opened.back?.();
    expect(failing.reopened()).toBe(1);
    // With every step given, the command runs once the metamodel is read, and a failed read is said.
    startCommand(failing.context, command("metamodel.removeType"), false, [
      { field: "type", value: "decision", label: "Decision" },
    ]);
    await flush();
    expect(failing.echoed).toEqual(["The metamodel cannot be read"]);
    // A refusal that names nothing asked, of a value the place gave, is said.
    const given = ready({
      "metamodel.removeType": () => refusedWith("Type decision is used by 1 element", { reason: "in-use" }),
    });
    startCommand(given.context, command("metamodel.removeType"), false, [
      { field: "type", value: "decision", label: "Decision" },
    ]);
    await flush();
    await flush();
    expect(given.echoed).toEqual(["Type decision is used by 1 element"]);
    // A refused name of a new status asks the status step again; a type the place gives goes in only with `required`.
    const taken = ready({
      "metamodel.addStatus": () =>
        refusedWith("Another status has the name", { reason: "taken", field: "name" }),
      "metamodel.changeProperty": () => OK,
    });
    startCommand(taken.context, command("metamodel.addStatus"), false);
    await flush();
    await choose(taken.asked, "Decision");
    await type(taken.asked, "Draft");
    await type(taken.asked, "draft-2");
    await choose(taken.asked, "no");
    expect((await last(taken.asked)).label).toBe(
      "Another status has the name · Add status to type Decision · Status:",
    );
    startCommand(taken.context, command("metamodel.changeProperty"), false, [
      { field: "type", value: "requirement", label: "System Requirement" },
      { field: "property", value: "rationale", label: "Rationale" },
    ]);
    await flush();
    await choose(taken.asked, "Name");
    await type(taken.asked, "Reason");
    expect(ranWith(taken.call, "metamodel.changeProperty")).toEqual({
      property: "rationale",
      name: "Reason",
    });
    // Not a metamodel command: nothing starts.
    const other = ready();
    const { startMetamodelCommand } = await import("./metamodel-prompt.js");
    startMetamodelCommand(other.context, command("element.get"));
    await flush();
    expect(other.call).not.toHaveBeenCalled();
    // An unsaved buffer that cannot be saved keeps the command from running.
    const drafted = ready({ "metamodel.removeType": () => OK });
    const context: CatalogContext = {
      ...drafted.context,
      drafted: () => true,
      saveDraft: () => Promise.resolve(false),
    };
    startCommand(context, command("metamodel.removeType"), false);
    await flush();
    await choose(drafted.asked, "Decision");
    await flush();
    expect(drafted.call.mock.calls.some(([name]) => name === "metamodel.removeType")).toBe(false);
  });

  it("[SR-236/AK-n13v] prefills the key made from the name and the initials as the prefix, which can be changed before it runs", async () => {
    const { context, asked, call } = ready({
      "metamodel.addType": (input) =>
        input["key"] === "x"
          ? refusedWith("Give a key: the key made from the name, x, is already the key of a type", {
              reason: "key-required",
              key: "x",
            })
          : OK,
    });
    start(context, "metamodel.addType");
    await flush();
    await type(asked, "Use Case");
    expect((await last(asked)).initial).toBe("use-case");
    await type(asked, "x");
    expect((await last(asked)).initial).toBe("UC");
    await type(asked, "UC");
    await choose(asked, "No parent type");
    await choose(asked, "yes");
    // Core refuses the key: the key step is asked again with its message, then the steps after it.
    const again = await last(asked);
    expect(again.label).toBe(
      "Give a key: the key made from the name, x, is already the key of a type · Add type Use Case · Key:",
    );
    expect(again.initial).toBe("use-case");
    await type(asked, "use-case");
    await type(asked, "UC");
    await choose(asked, "No parent type");
    await choose(asked, "yes");
    expect(ranWith(call, "metamodel.addType")).toEqual({
      name: "Use Case",
      key: "use-case",
      prefix: "UC",
      abstract: true,
    });

    // A prefix another type has, or no valid one, is not suggested.
    start(context, "metamodel.addType");
    await flush();
    await type(asked, "Software Rule");
    await type(asked, "software-rule");
    expect((await last(asked)).initial).toBeUndefined();
  });

  it("[SR-236/AK-wq1x] shows a field the use locks as locked with the number of elements, and does not choose it", async () => {
    const { context, asked, call } = ready(
      { "metamodel.changeProperty": () => OK },
      used({
        types: withCount(FIXTURE_METAMODEL.uses.types, "decision", 4),
        properties: withCount(FIXTURE_METAMODEL.uses.properties, "component", 3),
        values: [
          { property: "component", value: "display", count: 2 },
          { property: "component", value: "sensor", count: 0 },
        ],
      }),
    );
    start(context, "metamodel.changeProperty");
    await flush();
    await choose(asked, "Component");
    const fields = await last(asked);
    for (const name of ["Value kind", "Several values"]) {
      expect(item(fields.items, name)).toMatchObject({ hint: "locked: 3 elements", inert: true });
    }
    expect(item(fields.items, "Name").inert).toBeUndefined();
    await choose(asked, "Remove fixed value");
    const values = await last(asked);
    expect(item(values.items, "Display")).toMatchObject({ hint: "locked: 2 elements", inert: true });
    expect(item(values.items, "Sensor")).toMatchObject({ hint: "sensor" });
    await choose(asked, "Sensor");
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({
      property: "component",
      removeChoices: ["sensor"],
    });

    start(context, "metamodel.changeType");
    await flush();
    await choose(asked, "Decision");
    const type = await last(asked);
    expect(item(type.items, "Prefix")).toMatchObject({ hint: "locked: 4 elements", inert: true });
    expect(item(type.items, "Abstract")).toMatchObject({ hint: "locked: 4 elements", inert: true });
    // Removing the abstract mark of a used type always works (SR-237 AK3).
    const abstract = ready({}, used({ types: withCount(FIXTURE_METAMODEL.uses.types, "item", 2) }));
    start(abstract.context, "metamodel.changeType");
    await flush();
    await choose(abstract.asked, "Item");
    const item2 = await last(abstract.asked);
    expect(item(item2.items, "Prefix")).toMatchObject({ hint: "locked: 2 elements", inert: true });
    expect(item(item2.items, "Abstract").inert).toBeUndefined();
    // Unused: nothing is locked.
    const free = ready();
    start(free.context, "metamodel.changeType");
    await flush();
    await choose(free.asked, "Package");
    expect((await last(free.asked)).items.some((hit) => hit.inert === true)).toBe(false);
  });

  it("[SR-236/AK-cv7t] offers the commands while the metamodel repository is read-only and says core's refusal; while the metamodel does not read they are not offered", async () => {
    const refused = Object.assign(new Error("The metamodel repository system cannot be written"), {
      name: "file.read-only",
    });
    const { context, asked, echoed } = ready({ "metamodel.removeStatus": () => refused });
    const offered = catalogItems(context, CATALOG, ACTIONS).map((hit) => hit.name);
    expect(offered).toEqual(
      expect.arrayContaining(["Add type", "Change property definition", "Remove relation kind"]),
    );
    start(context, "metamodel.removeStatus");
    await flush();
    await choose(asked, "Decision");
    expect((await last(asked)).items.map((hit) => hit.name)).toEqual(["Open", "Decided"]);
    await choose(asked, "Decided");
    expect(echoed).toEqual(["The metamodel repository system cannot be written"]);
    // A metamodel that does not read makes the workspace read-only (SR-133 AK1).
    const faulty = setup([elementBuffer("uuid-1", "spec", "SR-1")]);
    const names = catalogItems({ ...faulty.context, readOnly: true }, CATALOG, ACTIONS).map(
      (hit) => hit.name,
    );
    expect(names).not.toContain("Add type");
    expect(names).not.toContain("Remove status");
  });

  it("[SR-199/AK-gh1p] [SR-199/AK-xd26] asks only what the context menu does not give: the source type of a new relation kind, the type of a property", async () => {
    const { context, asked, call } = ready({
      "metamodel.addRelationKind": () => OK,
      "metamodel.changeProperty": () => OK,
    });
    startCommand(context, command("metamodel.addRelationKind"), false, [
      { field: "sourceTypes", value: ["decision"], label: "Decision" },
    ]);
    await flush();
    expect((await last(asked)).label).toBe("Add relation kind Decision · Name:");
    await type(asked, "Touches");
    await type(asked, "touches");
    await enter(asked);
    // The source types are given: the next step is the target types.
    expect((await last(asked)).label).toBe("Add relation kind Decision Touches touches · Target types:");
    await choose(asked, "Any type");
    await choose(asked, "No limits");
    expect(ranWith(call, "metamodel.addRelationKind")).toEqual({
      name: "Touches",
      key: "touches",
      sourceTypes: ["decision"],
    });
    // A property with the type that has it: "Required in a type" asks no type.
    startCommand(context, command("metamodel.changeProperty"), false, [
      { field: "property", value: "rationale", label: "Rationale" },
      { field: "type", value: "requirement", label: "System Requirement" },
    ]);
    await flush();
    expect((await last(asked)).label).toBe(
      "Change property definition Rationale System Requirement · Change:",
    );
    await choose(asked, "Required in a type");
    await choose(asked, "yes");
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({
      property: "rationale",
      type: "requirement",
      required: true,
    });
    // Another field leaves the given type out of the input.
    startCommand(context, command("metamodel.changeProperty"), false, [
      { field: "property", value: "rationale", label: "Rationale" },
      { field: "type", value: "requirement", label: "System Requirement" },
    ]);
    await flush();
    await choose(asked, "Name");
    await type(asked, "Reason");
    expect(ranWith(call, "metamodel.changeProperty")).toEqual({ property: "rationale", name: "Reason" });
  });

  it("[SR-130/AK-wb12] reports a metamodel command that succeeded with its output, for the marks of the last change", async () => {
    const { context, call } = ready({ "metamodel.removeType": () => OK });
    const changed: [string, unknown][] = [];
    const reporting: CatalogContext = {
      ...context,
      metamodelChanged: (name, output) => changed.push([name, output]),
    };
    startCommand(reporting, command("metamodel.removeType"), false, [
      { field: "type", value: "decision", label: "Decision" },
    ]);
    await flush();
    expect(call.mock.calls.some(([name]) => name === "metamodel.removeType")).toBe(true);
    expect(changed).toEqual([["metamodel.removeType", OK]]);
  });
});

/** A press in the metamodel's graph on a place marked `data-menu="<place>"` with the `data-given-*` attributes. */
const pressedOn = (place: string, attributes: Record<string, string>): Element =>
  ({
    closest: (selector: string) =>
      selector === `[data-menu="${place}"]`
        ? { getAttribute: (name: string) => attributes[name] ?? null }
        : null,
  }) as unknown as Element;

/** The four Remove entries of the graph's menus: the place pressed, the command, and the input it runs with. */
const REMOVE_ENTRIES = [
  {
    entry: "Remove type",
    place: "metamodel-type",
    attributes: { "data-given-type": "package", "data-given-type-name": "Package" },
    name: "metamodel.removeType",
    input: { type: "package" },
  },
  {
    entry: "Remove property from type",
    place: "metamodel-property",
    attributes: {
      "data-given-type": "software-requirement",
      "data-given-type-name": "Software Requirement",
      "data-given-property": "component",
      "data-given-property-name": "Component",
    },
    name: "metamodel.removeProperty",
    input: { type: "software-requirement", property: "component" },
  },
  {
    entry: "Remove status from type",
    place: "metamodel-status",
    attributes: {
      "data-given-type": "decision",
      "data-given-type-name": "Decision",
      "data-given-status": "decided",
      "data-given-status-name": "Decided",
    },
    name: "metamodel.removeStatus",
    input: { type: "decision", status: "decided" },
  },
  {
    entry: "Remove relation kind",
    place: "metamodel-kind",
    attributes: { "data-given-kind": "blocks", "data-given-kind-name": "Blocks" },
    name: "metamodel.removeRelationKind",
    input: { kind: "blocks" },
  },
] as const;

type RemoveEntry = (typeof REMOVE_ENTRIES)[number];

/** Starts the Remove entry `of` as the menu does: the command with the arguments its place gives. */
const removeFromMenu = (context: CatalogContext, of: RemoveEntry): void => {
  const given = metamodelGiven(of.place, pressedOn(of.place, of.attributes))?.[of.name];
  expect(given).toBeDefined();
  expect(command(of.name).title).toBe(of.entry);
  startCommand(context, command(of.name), false, given);
};

describe("the Remove entries of the metamodel graph's menus (SR-199 AK8)", () => {
  for (const of of REMOVE_ENTRIES) {
    it(`[SR-199/AK-r608] "${of.entry}" runs at once with the definition the place gives, and says core's answer`, async () => {
      const { context, asked, call, echoed } = ready({ [of.name]: () => OK });
      removeFromMenu(context, of);
      await flush();
      await flush();
      // No step and no confirmation: the command prompt asks nothing.
      expect(asked).toEqual([]);
      expect(call.mock.calls.filter(([name]) => name === of.name)).toHaveLength(1);
      expect(ranWith(call, of.name)).toEqual(of.input);
      expect(echoed).toEqual(["Changed."]);
    });
  }

  it("[SR-199/AK-r608] says why core refuses a removal, an inherited status, a type a definition names or a use, and asks nothing", async () => {
    // Core's message and the reason in its details, per entry.
    const reasons: Record<RemoveEntry["name"], readonly [string, string]> = {
      "metamodel.removeStatus": [
        "Type software-requirement has the status retired from the status list of type item; remove it there",
        "inherited",
      ],
      "metamodel.removeType": [
        "Type package cannot be removed: property packages has it as target type",
        "in-use",
      ],
      "metamodel.removeProperty": [
        "Property title stays in type decision while elements hold it: property title: 1 element (D-d0000000130)",
        "in-use",
      ],
      "metamodel.removeRelationKind": [
        "Relation kind blocks cannot be removed: relation blocks: 1 element (SR-b0000000130)",
        "in-use",
      ],
    };
    for (const of of REMOVE_ENTRIES) {
      const [reason, kind] = reasons[of.name];
      const { context, asked, call, echoed } = ready({
        [of.name]: () => refusedWith(reason, { reason: kind }),
      });
      removeFromMenu(context, of);
      await flush();
      await flush();
      expect(asked).toEqual([]);
      expect(call.mock.calls.filter(([name]) => name === of.name)).toHaveLength(1);
      expect(echoed).toEqual([reason]);
    }
  });

  it("[SR-199/AK-r608] says why a removal fails that core does not refuse, such as a metamodel file that cannot be written", async () => {
    const failed = Object.assign(new Error("The metamodel repository system cannot be written"), {
      name: "file.read-only",
    });
    const of = REMOVE_ENTRIES[3];
    const { context, asked, echoed } = ready({ [of.name]: () => failed });
    removeFromMenu(context, of);
    await flush();
    await flush();
    expect(asked).toEqual([]);
    expect(echoed).toEqual(["The metamodel repository system cannot be written"]);
  });
});
