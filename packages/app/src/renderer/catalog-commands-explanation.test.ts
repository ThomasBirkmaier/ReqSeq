import { describe, expect, it, vi } from "vitest";
import type { Choice } from "./action-types.js";
import { ACTIONS, commandPrompt } from "./actions.js";
import { elementBuffer } from "./buffers.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { catalogItems, withExplanations } from "./catalog-commands.js";
import { coveredCommand, SHOWN_IN, shownIn } from "./command-entry.js";
import { shortcutReference } from "./shortcut-reference.js";
import {
  CATALOG,
  setup,
  command,
  item,
  last,
  KINDS,
  WITH_KINDS,
  start,
  OPTIONS,
  HINTS,
} from "./catalog-commands.test-helper.js";

describe("the explanation line of the command prompt (SR-210)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  /** The command prompt as the window builds it: the actions, the catalog commands, each with its explanation. */
  const entries = (context: CatalogContext): readonly Choice[] =>
    withExplanations(
      commandPrompt(context, undefined, catalogItems(context, WITH_KINDS, ACTIONS)),
      WITH_KINDS,
    ).items;
  /** The description of `field` in the input schema of `name`, as the catalog has it. */
  const described = (name: string, field: string): unknown =>
    (command(name).input as { properties: Record<string, { description?: unknown }> }).properties[field]
      ?.description;

  it("[SR-210/AK-gqgt] a marked catalog command has its catalog summary and the number of its optional arguments; the prompt keeps the line", () => {
    const { context } = setup([shown]);
    const prompt = withExplanations(
      commandPrompt(context, undefined, catalogItems(context, WITH_KINDS, ACTIONS)),
      WITH_KINDS,
    );
    // The line keeps its place whatever is marked, also an entry without an explanation.
    expect(prompt.explains).toBe(true);
    const items = prompt.items;
    expect(item(items, "Show kinds").explain).toEqual({
      summary: KINDS.summary,
      optional: 1,
    });
    // A write command without a required argument asks its first one; the others are optional.
    expect(item(items, "Confirm hints").explain).toEqual({
      summary: command("hint.confirm").summary,
      optional: 5,
    });
    // No arguments at all.
    expect(item(items, "List baselines").explain).toEqual({
      summary: command("baseline.list").summary,
      optional: 0,
    });
    // An argument given before the prompt asks (as the matrix gives one, SR-199) is not asked: not counted.
    const given = { "test.kinds": [{ field: "kind", value: "refines", label: "Refines" }] };
    expect(item(entries({ ...context, given }), "Show kinds").explain?.optional).toBe(0);
  });

  it("[SR-210/AK-r2d2] an action of the app has its own description; one that runs one catalog command that command's summary; an element has none", () => {
    const { context } = setup([shown]);
    const items = entries({ ...context, docs: () => undefined });
    // An action that runs no catalog command: its description, and as the command help its title with it.
    const docs = ACTIONS.find((action) => action.id === "open-documentation");
    expect(docs?.description).toMatch(/^[A-Z][^.]*\.$/);
    expect(item(items, "Open documentation").explain).toEqual({ summary: docs?.description });
    // Its key as the prompt shows it (F1, bound to it), and F1 opens its row of the keyboard reference.
    expect(item(items, "Open documentation").help).toEqual({
      title: "Open documentation",
      summary: docs?.description,
      ...(item(items, "Open documentation").hint === undefined
        ? {}
        : { key: item(items, "Open documentation").hint }),
      keyReference: true,
    });
    // By the same title, and by `covers`: the command's summary, without its arguments.
    expect(item(items, "List all elements").explain).toEqual({ summary: command("element.list").summary });
    expect(item(items, "Go to element or buffer").explain).toEqual({
      summary: command("element.get").summary,
    });
    // Its command help too: the summary, but no arguments and no call on the command line.
    expect(item(items, "Go to element or buffer").help).toEqual({
      title: "Go to element or buffer",
      summary: command("element.get").summary,
    });
    // An action that covers several commands runs one of them by the view: its own description.
    const both = {
      id: "both",
      title: "Both",
      description: "Does one or the other.",
      covers: ["trace.mermaid", "metamodel.mermaid"],
      available: () => true,
      run: vi.fn(),
    };
    const several = withExplanations(
      { label: "Command", items: [{ id: "both", name: "Both", run: vi.fn() }] },
      CATALOG,
      [both],
    );
    expect(several.items[0]?.explain).toEqual({ summary: "Does one or the other." });
    // Its command help names its key and the catalog commands it runs, with the display it runs each in.
    const runs = [
      { where: "in the graph of an element", command: "trace.mermaid" },
      { where: "in the graph of the metamodel", command: "metamodel.mermaid" },
    ];
    const keyed = withExplanations(
      { label: "Command", items: [{ id: "both", name: "Both", hint: "Ctrl+M", run: vi.fn() }] },
      CATALOG,
      [{ ...both, runs }],
    );
    expect(keyed.items[0]?.help).toEqual({
      title: "Both",
      summary: "Does one or the other.",
      key: "Ctrl+M",
      runs,
      keyReference: true,
    });
    // "Copy graph as Mermaid" is such an action of the app.
    expect(ACTIONS.find((action) => action.id === "copy-mermaid")?.covers).toHaveLength(2);
    // An action that runs one command has no description of its own, so the line cannot show another text.
    for (const action of ACTIONS) {
      expect(action.description === undefined, action.id).toBe(coveredCommand(action, CATALOG) !== undefined);
    }
    // An entry no action and no catalog command has, such as an element or a buffer, gets none.
    const other = withExplanations(
      { label: "Command", items: [{ id: "uuid-1", name: "SR-1", run: vi.fn() }] },
      CATALOG,
    );
    expect(other.items[0]?.explain).toBeUndefined();
    expect(other.items[0]?.help).toBeUndefined();
  });

  it("[SR-210/AK-r2d2] an action that runs a catalog command only to show its output as hits (SR-133 AK4) has its own description", () => {
    // No action covers one of them, so none takes over a summary of theirs.
    for (const action of ACTIONS) {
      expect(
        (action.covers ?? []).filter((name) => Object.hasOwn(SHOWN_IN, name)),
        action.id,
      ).toEqual([]);
    }
    const carrying = [
      ["Open workspace", "workspace.recent"],
      ["Follow agent", "workspace.activity"],
      ["Filter list", "filter.list"],
      ["Open perspective", "perspective.list"],
      ["Save list as perspective", "perspective.list"],
    ] as const;
    const actions = carrying.map(([title]) => ACTIONS.find((candidate) => candidate.title === title));
    const feeding = withExplanations(
      {
        label: "Command",
        items: actions.map((action) => ({ id: action?.id ?? "", name: action?.title ?? "", run: vi.fn() })),
      },
      CATALOG,
    );
    carrying.forEach(([title, shows], at) => {
      const action = actions[at];
      expect(action?.description, title).toMatch(/^[A-Z][^.]*\.$/);
      expect(shownIn(command(shows))).toContain(`"${title}"`);
      expect(feeding.items[at]?.explain).toEqual({ summary: action?.description });
      expect(feeding.items[at]?.explain?.summary).not.toBe(command(shows).summary);
    });
  });

  it("[SR-210/AK-r2d2] the actions that set what a shown list or graph shows name the catalog commands of each display", () => {
    const runsOf = (id: string) => ACTIONS.find((action) => action.id === id)?.runs;
    expect(runsOf("filter")).toEqual([
      { where: "in the list", command: "element.list" },
      { where: "in the traceability matrix", command: "trace.matrix" },
      { where: "on the package page", command: "element.list" },
      { where: "in the list of search hits", command: "element.search" },
    ]);
    expect(runsOf("sort")?.map(({ command }) => command)).toEqual([
      "element.list",
      "trace.matrix",
      "element.list",
    ]);
    expect(runsOf("group")?.map(({ command }) => command)).toEqual(["element.list", "element.search"]);
    expect(runsOf("matrix-list")).toEqual([{ where: "in the list", command: "element.list" }]);
    expect(runsOf("graph-depth")).toEqual([{ where: "in the graph", command: "trace.graph" }]);
    expect(runsOf("list-value")).toEqual([{ where: "in the list", command: "element.list" }]);
    expect(runsOf("copy-mermaid")).toEqual([
      { where: "in the graph of an element", command: "trace.mermaid" },
      { where: "in the graph of the metamodel", command: "metamodel.mermaid" },
    ]);
    // Every catalog command an action names is in the catalog.
    for (const action of ACTIONS) {
      for (const { command: name } of action.runs ?? []) {
        expect(
          CATALOG.some((entry) => entry.name === name),
          `${action.id} ${name}`,
        ).toBe(true);
      }
    }
  });

  it("[SR-210/AK-cbzd] an action of the app shows the text the keyboard reference gives it, without references to the specification", () => {
    const rows = shortcutReference(CATALOG).flatMap((section) => section.rows);
    const all = withExplanations(
      {
        label: "Command",
        items: ACTIONS.map((action) => ({ id: action.id, name: action.title, run: vi.fn() })),
      },
      CATALOG,
    ).items;
    let own = 0;
    for (const action of ACTIONS) {
      const shown = all.find((entry) => entry.id === action.id);
      if (action.description === undefined) {
        // Its catalog command's summary, as the catalog has it.
        expect(shown?.explain?.summary, action.id).toBe(coveredCommand(action, CATALOG)?.summary);
        continue;
      }
      own += 1;
      const row = rows.find((candidate) => candidate.actions?.includes(action.id) === true);
      expect(shown?.explain?.summary, action.id).toBe(action.description);
      expect(shown?.help?.summary, action.id).toBe(action.description);
      expect(row?.description, action.id).toContain(action.description);
      // One English sentence, without an ID of the specification (#1428 names the terms).
      expect(action.description, action.id).toMatch(/^[A-Z][^.]*\.$/);
      expect(action.description, action.id).not.toMatch(/\b(SR|D|N|ADR)-\d/);
    }
    expect(own).toBeGreaterThan(60);
  });

  it("[SR-210/AK-cbzd] All commands… shows the sentence of its row in the keyboard reference", () => {
    const rows = shortcutReference(CATALOG).flatMap((section) => section.rows);
    const row = rows.find((candidate) => candidate.does.startsWith("On “All commands…”"));
    const { context } = setup([shown]);
    const prompt = commandPrompt(context, undefined, [], undefined, vi.fn());
    const last =
      prompt.opening === undefined || prompt.opening === "as-given" ? undefined : prompt.opening.last;
    expect(last?.name).toBe("All commands…");
    expect(row?.keys).toEqual(["Enter"]);
    expect(row?.description).toBe("Show every command you can run here, by name.");
    expect(last?.explain).toEqual({ summary: row?.description, enter: true });
    // No command help, no key and no optional arguments of its own (SR-210 AK5).
    expect(last?.help).toBeUndefined();
    expect(last?.hint).toBeUndefined();
    expect(last?.more).toBeUndefined();
  });

  it("[SR-210/AK-wz9v] a catalog command has the command help: the catalog's texts and the call on the command line", () => {
    const { context } = setup([shown]);
    const items = entries({ ...context, docs: () => undefined });
    const get = command("element.get");
    const help = withExplanations(
      { label: "Command", items: [{ ...item(catalogItems(context, [get], []), get.title) }] },
      [get],
      [],
    ).items[0]?.help;
    expect(help).toEqual({
      title: get.title,
      summary: get.summary,
      ...(get.details === undefined ? {} : { details: get.details }),
      arguments: get.arguments.map(({ field }) => ({
        name: field,
        required: field === "ref",
        ...(typeof described("element.get", field) === "string"
          ? { description: described("element.get", field) }
          : {}),
      })),
      cli: "reqseq element get <ref> [options]",
    });
    // Every argument named in the catalog, with its description where the catalog has one.
    expect(help?.arguments?.map((arg) => arg.name)).toEqual(get.arguments.map((arg) => arg.field));
    expect(help?.arguments?.find((arg) => arg.name === "versionDate")?.description).toBe(
      described("element.get", "versionDate"),
    );
    expect(item(items, "Show kinds").help?.arguments).toContainEqual(
      expect.objectContaining({ name: "kind", required: false }),
    );
    // A command with details on its reference page shows them.
    const detailed = CATALOG.find((entry) => entry.details !== undefined && entry.implemented);
    expect(detailed).toBeDefined();
    expect(item(items, detailed?.title ?? "").help?.details).toBe(detailed?.details);
    // An action of the app has no arguments and no call on the command line (AK5).
    expect(item(items, "Open documentation").help).not.toHaveProperty("cli");
    expect(item(items, "Open documentation").help).not.toHaveProperty("arguments");
  });

  it("[SR-210/AK-t8sc] an asked argument has its name, its catalog description and the keys of its step", async () => {
    const { context, asked } = setup([shown], { "relation.options": () => OPTIONS });
    start(context, "test.kinds");
    // A required argument, while the command has an optional one.
    const ref = await last(asked);
    expect(ref.explain).toEqual({
      name: "ref",
      description: described("relation.options", "ref"),
      list: false,
      ends: false,
      skips: false,
      more: true,
    });
    item(ref.items, "SR-000001 (SR-1) Title 1").more?.();
    item((await last(asked)).items, "kind").run();
    // The last optional argument: Ctrl/Cmd+Enter offers no other.
    expect((await last(asked)).explain).toMatchObject({ name: "kind", more: false });
  });

  it("[SR-210/AK-t8sc] a list argument adds a value per Enter and, once one is given, ends with Enter on an empty input; an optional one a write command asks is skipped so", async () => {
    const list = setup([shown]);
    start(list.context, "hint.list", true);
    item((await last(list.asked)).items, "kind").run();
    const kind = await last(list.asked);
    expect(kind.explain).toEqual({
      name: "kind",
      description: described("hint.list", "kind"),
      list: true,
      ends: false,
      skips: false,
      more: true,
    });
    item(kind.items, "relation.outdated").run();
    expect((await last(list.asked)).explain).toMatchObject({
      name: "kind",
      list: true,
      ends: true,
      skips: false,
    });

    const confirm = setup([shown], { "hint.list": () => HINTS });
    start(confirm.context, "hint.confirm");
    (await last(confirm.asked)).items[0]?.run();
    expect((await last(confirm.asked)).explain).toMatchObject({ name: "hintIds", ends: false, skips: true });
  });
});
