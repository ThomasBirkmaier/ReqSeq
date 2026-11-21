import { describe, expect, it } from "vitest";
import type { Prompt } from "./action-types.js";
import { ACTIONS, commandPrompt } from "./actions.js";
import { elementBuffer, overviewBuffer } from "./buffers.js";
import { askable } from "./catalog-arguments.js";
import { catalogItems } from "./catalog-commands.js";
import { CREATE_METAMODEL } from "./create-test-data.js";
import type { Answer } from "./catalog-commands.test-helper.js";
import {
  CATALOG,
  command,
  flush,
  setup,
  item,
  last,
  refusedWith,
  start,
  hit,
} from "./catalog-commands.test-helper.js";

describe('"Create element": the required properties asked in the command line (SR-064)', () => {
  /** What core gives for a new element: the element of the input, with a hint for each `hints` key. */
  const created =
    (hints: readonly string[] = []) =>
    (input: Record<string, unknown>) => ({
      element: {
        id: "uuid-9",
        type: input["type"],
        repository: "spec",
        file: "report/REP-000009.md",
        shortId: "REP-000009",
        title: input["title"],
        properties: {},
        relations: [],
        text: "",
      },
      files: ["report/REP-000009.md"],
      problems: hints.map((key) => ({
        code: "element.missing-required",
        severity: "warning",
        message: `Required property ${key} has no value`,
      })),
    });

  const creating = (answers: Record<string, (input: Record<string, unknown>) => Answer> = {}) =>
    setup([overviewBuffer()], {
      "metamodel.get": () => CREATE_METAMODEL,
      "element.create": created(),
      "element.search": () => ({ hits: [hit(4)], total: 1 }),
      ...answers,
    });

  /** Starts "Create element" and answers the type and the title; resolves the prompt asked next. */
  const typeAndTitle = async (
    { context, asked }: ReturnType<typeof setup>,
    type: string,
    title: string,
  ): Promise<Prompt> => {
    start(context, "element.create");
    item((await last(asked)).items, type).run();
    (await last(asked)).text?.(title);
    return last(asked);
  };

  it("[SR-064/AK-xjg5] is in the command prompt once, by the title of element.create, and asks the type among the types that can have elements", async () => {
    const running = creating();
    const { context, asked, call } = running;
    const names = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items.map(
      (i) => i.name,
    );
    expect(names.filter((name) => name === "Create element")).toHaveLength(1);
    // The element buffer updates an element ("Save element" covers it).
    expect(names).not.toContain("Update element");
    start(context, "element.create");
    const type = await last(asked);
    expect(type.label).toBe("Create element · type:");
    expect(call).toHaveBeenLastCalledWith("metamodel.get", {});
    // Not the abstract "Item"; in metamodel order, by name.
    expect(type.items.map((i) => i.name)).toEqual([
      "System Requirement",
      "Software Requirement",
      "Decision",
      "Package",
      "Report",
      "Note",
    ]);
  });

  it("[SR-064/AK-xjg5] asks, after the type and the title, only the required properties of the type, one after the other", async () => {
    const running = creating();
    const { asked, call } = running;
    const labels: string[] = [];
    let prompt = await typeAndTitle(running, "Report", "Wind gusts");
    // Each required property but the title, in the order of the type, and none of the optional ones.
    while (prompt.empty !== undefined) {
      labels.push(prompt.label);
      prompt.empty(false);
      if (call.mock.lastCall?.[0] === "element.create") {
        break;
      }
      prompt = await last(asked);
    }
    expect(labels).toEqual([
      "Create element Report Wind gusts · severity:",
      "Create element Report Wind gusts · packages:",
      "Create element Report Wind gusts · component:",
    ]);
    // A type whose only required property is the title asks nothing more and creates the element.
    const decision = creating();
    start(decision.context, "element.create");
    item((await last(decision.asked)).items, "Decision").run();
    (await last(decision.asked)).text?.("Use wind");
    await flush();
    expect(decision.call).toHaveBeenLastCalledWith("element.create", { type: "decision", title: "Use wind" });
    // Only with Ctrl/Cmd+Enter on the title its optional arguments follow: the other properties and the
    // relations of the new element among them (SR-215 AK8).
    const more = creating();
    start(more.context, "element.create");
    item((await last(more.asked)).items, "Decision").run();
    (await last(more.asked)).more?.("Use wind");
    expect((await last(more.asked)).items.map((i) => i.name)).toEqual([
      "Run",
      "text",
      "properties",
      "relations",
      "repository",
      "folder",
      "nextIdentifier",
      "identifierPrefix",
    ]);
  });

  it("[SR-064/AK-yhn7] creates the element with every required property left empty, opens it, and says how many hints core gave", async () => {
    const running = creating({ "element.create": created(["severity", "packages", "component"]) });
    const { asked, call, dispatched, echoed } = running;
    let prompt = await typeAndTitle(running, "Report", "Wind gusts");
    for (let at = 0; at < 3; at += 1) {
      prompt.empty?.(false);
      prompt = await last(asked);
    }
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", { type: "report", title: "Wind gusts" });
    expect(dispatched.at(-1)).toEqual({
      type: "open",
      buffer: { ...elementBuffer("uuid-9", "spec", "REP-000009 Wind gusts"), type: "report" },
    });
    expect(echoed.at(-1)).toBe("Created REP-000009 Wind gusts · 3 hints");
  });

  it("[SR-064/AK-yhn7] creates the element with an empty title too, when the title is left empty", async () => {
    const running = creating({ "element.create": created(["title"]) });
    const { context, asked, call, echoed } = running;
    start(context, "element.create");
    item((await last(asked)).items, "Decision").run();
    (await last(asked)).text?.("");
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", { type: "decision", title: "" });
    expect(echoed.at(-1)).toBe("Created REP-000009 · 1 hint");
  });

  it("takes a text, the targets found among the target types and the choices of the metamodel, a list one value per Enter", async () => {
    const running = creating();
    const { asked, call } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    expect(severity.items).toEqual([]);
    severity.text?.("3");
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts 3 · packages:");
    const found = await packages.find?.("pkg");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "pkg",
      selection: { where: { type: ["package"] } },
      fields: ["id", "title"],
      limit: 20,
    });
    found?.[0]?.run();
    // A list: the same property takes more, Enter on an empty input ends it.
    const morePackages = await last(asked);
    expect(morePackages.label).toBe("Create element Report Wind gusts 3 SR-000004 · packages:");
    morePackages.empty?.(false);
    const component = await last(asked);
    expect(component.label).toBe("Create element Report Wind gusts 3 SR-000004 · component:");
    expect(component.items.map((i) => [i.name, i.hint])).toEqual([
      ["Display", "display"],
      ["Sensor", "sensor"],
    ]);
    item(component.items, "Sensor").run();
    // A choice taken is not offered again.
    const moreComponents = await last(asked);
    expect(moreComponents.items.map((i) => i.name)).toEqual(["Display"]);
    moreComponents.empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "report",
      title: "Wind gusts",
      properties: {
        severity: 3,
        packages: [{ id: "uuid-4", repository: "spec" }],
        component: ["sensor"],
      },
    });
  });

  it("finds any element for a relation property without target types, and none for one that may point at no type", async () => {
    const running = creating();
    const { asked, call } = running;
    const related = await typeAndTitle(running, "Note", "On wind");
    await related.find?.("tit");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "tit",
      fields: ["id", "title"],
      limit: 20,
    });
    // Ctrl/Cmd+Enter on a found element: taken; the optional arguments follow the required properties.
    (await related.find?.("tit"))?.[0]?.more?.();
    const scope = await last(asked);
    expect(scope.label).toBe("Create element Note On wind SR-000004 · scope:");
    expect(scope.find).toBeUndefined();
    scope.empty?.(false);
    const more = await last(asked);
    expect(more.label).toBe("Create element Note On wind SR-000004 · more arguments:");
    // The other properties are offered as `properties` (SR-215 AK8).
    expect(more.items.map((i) => i.name)).toEqual([
      "Run",
      "text",
      "properties",
      "relations",
      "repository",
      "folder",
      "nextIdentifier",
      "identifierPrefix",
    ]);
    item(more.items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "note",
      title: "On wind",
      properties: { related: { id: "uuid-4", repository: "spec" } },
    });
  });

  it("offers the optional arguments after the required properties with Ctrl/Cmd+Enter on a property: on a text, an empty input and a choice", async () => {
    const running = creating();
    const { asked, call } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    severity.more?.("2");
    // The required properties not answered yet come first.
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts 2 · packages:");
    packages.empty?.(true);
    const component = await last(asked);
    // Ctrl/Cmd+Enter on a choice of a list: taken, and the list takes no more.
    item(component.items, "Display").more?.();
    const more = await last(asked);
    expect(more.label).toBe("Create element Report Wind gusts 2 Display · more arguments:");
    item(more.items, "text").run();
    (await last(asked)).text?.("Gusts above 20 m/s.");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "report",
      title: "Wind gusts",
      text: "Gusts above 20 m/s.",
      properties: { severity: 2, component: ["display"] },
    });
  });

  it("goes back one answer with Backspace in an empty input: a property value, a skipped property, then the title", async () => {
    const running = creating();
    const { asked } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    severity.text?.("3");
    (await (await last(asked)).find?.("pkg"))?.[0]?.run();
    (await (await last(asked)).find?.("pkg"))?.[0]?.run();
    const morePackages = await last(asked);
    expect(morePackages.label).toBe("Create element Report Wind gusts 3 SR-000004 SR-000004 · packages:");
    // The target given last goes; the list keeps the one before and takes values again.
    morePackages.back?.();
    const onePackage = await last(asked);
    expect(onePackage.label).toBe("Create element Report Wind gusts 3 SR-000004 · packages:");
    onePackage.back?.();
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts 3 · packages:");
    packages.empty?.(false);
    const component = await last(asked);
    expect(component.label).toBe("Create element Report Wind gusts 3 · component:");
    // The skipped list property is asked again, with no value.
    component.back?.();
    const again = await last(asked);
    expect(again.label).toBe("Create element Report Wind gusts 3 · packages:");
    again.back?.();
    expect((await last(asked)).label).toBe("Create element Report Wind gusts · severity:");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("Create element Report · title:");
  });

  it("asks a property again with core's message when core refuses the input, and says why it cannot create one otherwise", async () => {
    const refusal = Object.assign(new Error("properties.severity: must be a number"), {
      name: "input.invalid",
    });
    const refused = creating({ "element.create": () => refusal });
    let prompt = await typeAndTitle(refused, "Report", "Wind gusts");
    prompt.text?.("high");
    for (let at = 0; at < 2; at += 1) {
      prompt = await last(refused.asked);
      prompt.empty?.(false);
    }
    expect((await last(refused.asked)).label).toBe(
      "properties.severity: must be a number · Create element Report Wind gusts high · component:",
    );
    expect(refused.call).toHaveBeenCalledTimes(2);
    refused.call.mockClear();
    // With the field in core's details, the property it names is asked again, not the one given last.
    const named = creating({
      "element.create": () =>
        refusedWith("properties.severity: must be a number", {
          errors: [{ field: "properties.severity", message: "properties.severity: must be a number" }],
        }),
    });
    prompt = await typeAndTitle(named, "Report", "Wind gusts");
    prompt.text?.("high");
    for (let at = 0; at < 2; at += 1) {
      prompt = await last(named.asked);
      prompt.empty?.(false);
    }
    expect((await last(named.asked)).label).toBe(
      "properties.severity: must be a number · Create element Report Wind gusts · severity:",
    );
    const readOnly = Object.assign(new Error("The workspace is read-only"), { name: "workspace.read-only" });
    const locked = creating({ "element.create": () => readOnly });
    start(locked.context, "element.create");
    item((await last(locked.asked)).items, "Decision").run();
    (await last(locked.asked)).text?.("Use wind");
    await flush();
    expect(locked.echoed.at(-1)).toBe("The workspace is read-only");
    expect(locked.dispatched).toEqual([]);
  });

  it("asks again the property whose value core refused while writing it (details key), not the one given last", async () => {
    // Report with the choice `component` asked before the relation `packages`.
    const metamodel = {
      ...CREATE_METAMODEL,
      types: CREATE_METAMODEL.types.map((type) =>
        type.key === "report" ? { ...type, required: ["title", "component", "packages"] } : type,
      ),
    };
    let refuse = true;
    const running = creating({
      "metamodel.get": () => metamodel,
      "element.create": (input) =>
        refuse
          ? refusedWith("properties.component: Display is not a value of Component; the values are: …", {
              key: "component",
              value: "display",
              reason: "unknown-choice",
              allowed: ["sensor"],
            })
          : created()(input),
    });
    const { asked, call } = running;
    const component = await typeAndTitle(running, "Report", "Wind gusts");
    expect(component.label).toBe("Create element Report Wind gusts · component:");
    item(component.items, "Display").run();
    (await last(asked)).empty?.(false);
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts Display · packages:");
    (await packages.find?.("pkg"))?.[0]?.run();
    (await last(asked)).empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", expect.objectContaining({ type: "report" }));
    // The refused `component` is asked again with core's message; the target of `packages` stays.
    const again = await last(asked);
    expect(again.label).toBe(
      "properties.component: Display is not a value of Component; the values are: … · Create element Report Wind gusts SR-000004 · component:",
    );
    refuse = false;
    item(again.items, "Sensor").run();
    const more = await last(asked);
    // The new value stands where the refused one stood, before the target of `packages`.
    expect(more.label).toBe("Create element Report Wind gusts Sensor SR-000004 · component:");
    more.empty?.(false);
    await flush();
    const input = call.mock.lastCall?.[1];
    expect(call.mock.lastCall?.[0]).toBe("element.create");
    expect(input?.["properties"]).toEqual(
      expect.objectContaining({
        component: ["sensor"],
        packages: [expect.objectContaining({ id: "uuid-4" })],
      }),
    );
  });

  it("asks the type again with its properties when core refuses the type", async () => {
    let refuse = true;
    const running = creating({
      "element.create": (input) =>
        refuse
          ? refusedWith("type: wrong", { errors: [{ field: "type", message: "type: wrong" }] })
          : created()(input),
    });
    const { asked } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    severity.text?.("3");
    for (let at = 0; at < 2; at += 1) {
      (await last(asked)).empty?.(false);
    }
    await flush();
    // The properties belong to the type: they go with it, the title stays.
    const type = await last(asked);
    expect(type.label).toBe("type: wrong · Create element Wind gusts · type:");
    refuse = false;
    item(type.items, "Decision").run();
    await flush();
    expect(running.call).toHaveBeenLastCalledWith("element.create", {
      type: "decision",
      title: "Wind gusts",
    });
  });
});

describe('"Create element": the other properties and the relations built from marks (SR-215 AK8)', () => {
  const created = (input: Record<string, unknown>) => ({
    element: { ...hit(9), type: input["type"], title: input["title"], properties: {}, relations: [] },
    files: ["f9.md"],
    problems: [],
  });

  /**
   * "Create element" of a Software Requirement titled "Wind" with Ctrl/Cmd+Enter, its required `component`
   * skipped (or answered `component`), at the optional argument `field`; resolves the first step.
   */
  const atBuilt = async (
    field: string,
    component?: string,
    answers: Record<string, (input: Record<string, unknown>) => Answer> = {},
  ) => {
    const running = setup([overviewBuffer()], {
      "metamodel.get": () => CREATE_METAMODEL,
      "element.create": created,
      "element.search": () => ({ hits: [hit(4), hit(5)], total: 2 }),
      ...answers,
    });
    const { context, asked } = running;
    start(context, "element.create");
    item((await last(asked)).items, "Software Requirement").run();
    (await last(asked)).more?.("Wind");
    const required = await last(asked);
    if (component === undefined) {
      required.empty?.(true);
    } else {
      item(required.items, component).more?.();
    }
    item((await last(asked)).items, field).run();
    return { ...running, first: await last(asked) };
  };

  const names = (prompt: Prompt): string[] =>
    prompt.items.map((choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`);
  const markLabels = (prompt: Prompt): string[] => (prompt.marks ?? []).map((mark) => mark.label);

  it("[SR-215/AK-tn9x] [SR-215/AK-hnzf] [SR-210/AK-t8sc] offers the properties of the type without a value, a skipped required one too, then their values; each property with its values is one mark", async () => {
    const { asked, call, first } = await atBuilt("properties");
    expect(first.label).toBe("Create element Software Requirement Wind · properties:");
    expect(first.explain?.building).toEqual({ enter: "takes the marked hit", unmark: false, json: false });
    // By name with the key beside; never the title.
    expect(names(first)).toEqual([
      "No properties",
      "Rationale | rationale",
      "Package | packages",
      "Component | component",
    ]);
    item(first.items, "Component").run();
    const component = await last(asked);
    expect(component.label).toBe("Create element Software Requirement Wind · properties · component:");
    expect(names(component)).toEqual(["Display | display", "Sensor | sensor"]);
    item(component.items, "Display").run();
    // A list takes one value per Enter, in the same mark.
    const more = await last(asked);
    expect(markLabels(more)).toEqual(["component: Display"]);
    expect(names(more)).toEqual(["Sensor | sensor"]);
    item(more.items, "Sensor").run();
    (await last(asked)).empty?.(false);
    const second = await last(asked);
    expect(markLabels(second)).toEqual(["component: Display, Sensor"]);
    expect(second.explain?.building?.unmark).toBe(true);
    expect(names(second)).toEqual(["Take 1 property", "Rationale | rationale", "Package | packages"]);
    item(second.items, "Rationale").run();
    (await last(asked)).text?.("Gusts break masts");
    item((await last(asked)).items, "Package").run();
    (await (await last(asked)).find?.("pkg"))?.[0]?.run();
    // The explanation line names the keys of the step (SR-210 AK2).
    expect((await last(asked)).explain?.building?.enter).toBe(
      "adds a value, on an empty input ends the values",
    );
    (await last(asked)).empty?.(false);
    const third = await last(asked);
    expect(markLabels(third)).toEqual([
      "component: Display, Sensor",
      "rationale: Gusts break masts",
      "packages: SR-000004",
    ]);
    expect(names(third)).toEqual(["Take 3 properties"]);
    item(third.items, "Take 3 properties").run();
    const run = await last(asked);
    expect(run.label).toBe(
      "Create element Software Requirement Wind component: Display, Sensor · rationale: Gusts break masts · packages: SR-000004 · more arguments:",
    );
    // The properties built from marks are not offered again.
    expect(run.items.map((choice) => choice.name)).not.toContain("properties");
    item(run.items, "Run").run();
    await flush();
    // Each entry with its value, as the command line takes it (AK10).
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "software-requirement",
      title: "Wind",
      properties: {
        component: ["display", "sensor"],
        rationale: "Gusts break masts",
        packages: [{ id: "uuid-4", repository: "spec" }],
      },
    });
  });

  it("[SR-215/AK-tn9x] [SR-215/AK-hnzf] offers the relation kinds the type may have as source, then the elements of their target types; each relation is one mark", async () => {
    const { asked, call, first } = await atBuilt("relations");
    expect(first.label).toBe("Create element Software Requirement Wind · relations:");
    expect(names(first)).toEqual([
      "No relations",
      "Derives from | derives-from",
      "Replaces | replaces",
      "Delegates to | delegates-to",
      "Based on | based-on",
      "Concerns | concerns",
      "Refines | refines",
    ]);
    item(first.items, "Derives from").run();
    const target = await last(asked);
    expect(target.label).toBe("Create element Software Requirement Wind · relations · derives-from:");
    const found = await target.find?.("tit");
    expect(call.mock.lastCall?.[1]).toMatchObject({
      selection: { where: { type: ["requirement", "software-requirement"] } },
    });
    found?.[0]?.run();
    item((await last(asked)).items, "Derives from").run();
    (await (await last(asked)).find?.("tit"))?.[1]?.run();
    item((await last(asked)).items, "Based on").run();
    (await (await last(asked)).find?.("tit"))?.[0]?.run();
    const taken = await last(asked);
    expect(markLabels(taken)).toEqual([
      "derives-from: SR-000004",
      "derives-from: SR-000005",
      "based-on: SR-000004",
    ]);
    item(taken.items, "Take 3 relations").run();
    item((await last(asked)).items, "Run").run();
    await flush();
    // A kind with several targets as a list, with one as its reference (AK10).
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "software-requirement",
      title: "Wind",
      relations: { "derives-from": ["uuid-4", "uuid-5"], "based-on": "uuid-4" },
    });
  });

  it("[SR-215/AK-fm4s] the finishing hit is marked first: without a mark it skips the argument, with marks it takes them; Ctrl/Cmd+Enter offers the optional arguments", async () => {
    const { asked, call, first } = await atBuilt("relations");
    expect(first.items[0]?.name).toBe("No relations");
    first.items[0]?.run();
    const skipped = await last(asked);
    expect(skipped.label).toBe("Create element Software Requirement Wind · more arguments:");
    item(skipped.items, "properties").run();
    item((await last(asked)).items, "Rationale").run();
    (await last(asked)).text?.("Gusts");
    const marked = await last(asked);
    expect(marked.items[0]?.name).toBe("Take 1 property");
    // With a mark, Ctrl/Cmd+Enter on any hit takes the marks.
    item(marked.items, "Package").more?.();
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "software-requirement",
      title: "Wind",
      properties: { rationale: "Gusts" },
    });
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] an × removes its mark; Backspace removes the last mark where the property or kind is chosen; Escape keeps the marks, which stand again", async () => {
    const { asked, first } = await atBuilt("relations");
    expect(first.unmark).toBe(true);
    item(first.items, "Based on").run();
    const target = await last(asked);
    // Choosing the target: Backspace and Escape go back to the kinds, no mark goes.
    expect(target.unmark).toBeUndefined();
    target.back?.();
    item((await last(asked)).items, "Based on").run();
    (await (await last(asked)).find?.("tit"))?.[0]?.run();
    item((await last(asked)).items, "Refines").run();
    (await (await last(asked)).find?.("tit"))?.[1]?.run();
    const two = await last(asked);
    expect(markLabels(two)).toEqual(["based-on: SR-000004", "refines: SR-000005"]);
    two.marks?.[0]?.remove();
    const one = await last(asked);
    expect(markLabels(one)).toEqual(["refines: SR-000005"]);
    // Escape goes back an argument (the property skipped last) with the marks, which stand again later.
    one.back?.();
    const skipped = await last(asked);
    expect(skipped.label).toBe("Create element Software Requirement Wind · component:");
    skipped.empty?.(true);
    item((await last(asked)).items, "relations").run();
    expect(markLabels(await last(asked))).toEqual(["refines: SR-000005"]);
    // Back to the type: the marks go with it, a new type has other kinds.
    for (let at = 0; at < 3; at += 1) {
      (await last(asked)).back?.();
    }
    item((await last(asked)).items, "Decision").run();
    (await last(asked)).more?.("Wind");
    item((await last(asked)).items, "relations").run();
    expect(markLabels(await last(asked))).toEqual([]);
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] at a property's values Escape goes back to the properties with the values given so far; an × removes a mark in each step", async () => {
    const { asked, first } = await atBuilt("properties");
    item(first.items, "Component").run();
    item((await last(asked)).items, "Display").run();
    const values = await last(asked);
    expect(values.unmark).toBeUndefined();
    values.back?.();
    const properties = await last(asked);
    expect(properties.label).toBe("Create element Software Requirement Wind · properties:");
    expect(markLabels(properties)).toEqual(["component: Display"]);
    // An empty text adds nothing; an × in a later step removes the mark and asks the first step.
    item(properties.items, "Rationale").run();
    (await last(asked)).text?.(" ");
    item((await last(asked)).items, "Rationale").run();
    (await last(asked)).marks?.[0]?.remove();
    const none = await last(asked);
    expect(none.label).toBe("Create element Software Requirement Wind · properties:");
    expect(markLabels(none)).toEqual([]);
  });

  it("[SR-215/AK-rx2z] a property core refuses is asked again with its message and the marks back", async () => {
    let refuse = true;
    const { asked, call, first } = await atBuilt("properties", undefined, {
      "element.create": (input) =>
        refuse ? refusedWith("Too long", { key: "rationale", value: "Gusts" }) : created(input),
    });
    item(first.items, "Rationale").run();
    (await last(asked)).text?.("Gusts");
    item((await last(asked)).items, "Take 1 property").run();
    item((await last(asked)).items, "Run").run();
    await flush();
    const again = await last(asked);
    expect(again.label).toBe("Too long · Create element Software Requirement Wind · properties:");
    expect(markLabels(again)).toEqual(["rationale: Gusts"]);
    refuse = false;
    item(again.items, "Take 1 property").run();
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call.mock.lastCall?.[1]).toMatchObject({ properties: { rationale: "Gusts" } });
  });
});

describe("the dry run of create and update (SR-246)", () => {
  it("is not offered by the prompt: its criteria name the CLI, the API and the MCP server only", () => {
    for (const name of ["element.create", "element.update"]) {
      expect(command(name).arguments.some((arg) => arg.field === "dryRun")).toBe(true);
      expect(askable(command(name)).some((arg) => arg.field === "dryRun")).toBe(false);
    }
  });
});
