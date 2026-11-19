import { describe, expect, it } from "vitest";
import type { Prompt } from "./action-types.js";
import { ACTIONS, commandPrompt } from "./actions.js";
import type { Buffers } from "./buffers.js";
import { elementBuffer, listBuffer, overviewBuffer, perspectiveBuffer, withQuery } from "./buffers.js";
import { typeStep } from "./list-filters.js";
import { catalogItems, startBuilder, withExplanations } from "./catalog-commands.js";
import { coveredCommand } from "./command-entry.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";
import type { Answer } from "./catalog-commands.test-helper.js";
import { CATALOG, flush, setup, command, item, last, refusedWith } from "./catalog-commands.test-helper.js";

describe("New perspective and New saved filter ask every step before they save (SR-219, #1746)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const FACETS = { total: 1, types: [], statuses: [{ key: "draft", count: 1 }], properties: [] };
  const RAIN = { name: "Rain", file: "perspectives/rain.yaml", where: { all: [] } };
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => FACETS,
    "element.list": () => ({ elements: [], total: 0 }),
    "perspective.list": () => ({ perspectives: [RAIN] }),
    "filter.list": () => ({ filters: [{ name: "Open needs", file: "filters/open-needs.yaml", where: {} }] }),
    "perspective.save": () => ({ files: ["perspectives/rain.yaml"] }),
    "filter.save": () => ({ files: ["filters/open.yaml"] }),
  };

  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map((choice) => choice.name);

  const saves = (call: ReturnType<typeof setup>["call"], name = "perspective.save") =>
    call.mock.calls.filter(([called]) => called === name);

  /** "New perspective" (or `name`) started over `buffers`. */
  const begin = (
    buffers: Buffers = [shown],
    extra: Record<string, (input: Record<string, unknown>) => Answer> = {},
    name: "perspective.save" | "filter.save" = "perspective.save",
  ) => {
    const run = setup(buffers, { ...answers, ...extra });
    startBuilder(run.context, name, CATALOG);
    return run;
  };

  it("[SR-219/AK-v80n] the command prompt has New perspective and New saved filter, which run perspective.save and filter.save, and no Save perspective or Save filter; they fit the overview and a list", () => {
    const context = { ...setup([shown]).context, build: () => undefined };
    const entries = (buffers: Buffers) =>
      withExplanations(
        commandPrompt(
          { ...context, buffers },
          undefined,
          catalogItems({ ...context, buffers }, CATALOG, ACTIONS),
        ),
        CATALOG,
      ).items;
    for (const buffers of [[shown], [listBuffer("All elements")]] as Buffers[]) {
      const titles = entries(buffers).map((entry) => entry.name);
      expect(titles).toContain("New perspective");
      expect(titles).toContain("New saved filter");
      expect(titles).not.toContain("Save perspective");
      expect(titles).not.toContain("Save filter");
    }
    const builders = ACTIONS.filter((action) =>
      ["New perspective", "New saved filter"].includes(action.title),
    );
    expect(builders.map((action) => coveredCommand(action, CATALOG)?.name)).toEqual([
      "perspective.save",
      "filter.save",
    ]);
    // Their explanation line is the summary of the command they run (SR-210 AK5).
    const newPerspective = entries([shown]).find((entry) => entry.name === "New perspective");
    expect(newPerspective?.explain?.summary).toBe(command("perspective.save").summary);
    // They fit the overview and a list, not an element.
    const fitting = (buffers: Buffers) =>
      entries(buffers)
        .filter((entry) => entry.name.startsWith("New "))
        .map((entry) => entry.fits);
    expect(fitting([shown])).toEqual([false, false]);
    expect(fitting([listBuffer("All elements")])).toEqual([true, true]);
    expect(fitting([overviewBuffer()])).toEqual([true, true]);
    // Not in a read-only workspace, and not where the window cannot start them.
    const readOnly = { ...context, readOnly: true };
    expect(builders.some((action) => action.available(readOnly))).toBe(false);
    const { build: _build, ...without } = context;
    expect(builders.some((action) => action.available(without))).toBe(false);
    // The action hands its context to the window.
    const started: unknown[] = [];
    builders[0]?.run({ ...context, build: (name, from) => started.push([name, from.buffers]) });
    expect(started).toEqual([["perspective.save", [shown]]]);
  });

  it("[SR-219/AK-tbwz] New perspective asks name, condition, grouping and sort in turn, the first hit marked, and saves only with Save, without keys sorted by type and ID", async () => {
    const run = begin();
    const name = await last(run.asked);
    expect(name.label).toBe("New perspective · name:");
    name.text?.("Open work");
    // The condition starts without a mark and without a hit for the shown list.
    expect((await last(run.asked)).label).toBe("New perspective Open work · where:");
    expect((await names(run.asked))[0]).toBe("No condition: all elements");
    await choose(run.asked, "Type", "Decision", "Take 1 type");
    expect((await names(run.asked))[0]).toBe("Next: grouping");
    await choose(run.asked, "Next: grouping");
    // The grouping, without Ctrl/Cmd+Enter: "No grouping" first, then the groupings.
    expect((await last(run.asked)).label).toBe("New perspective Open work · group:");
    expect((await names(run.asked)).slice(0, 2)).toEqual(["No grouping", "Type"]);
    await choose(run.asked, "Status");
    // The sort: "Save" first.
    expect((await last(run.asked)).label).toBe("New perspective Open work · sort:");
    expect((await names(run.asked))[0]).toBe("Save");
    expect(saves(run.call)).toHaveLength(0);
    await choose(run.asked, "Save");
    expect(saves(run.call)).toEqual([
      [
        "perspective.save",
        {
          name: "Open work",
          where: { all: [{ type: ["decision"] }] },
          group: "status",
          sort: [
            { by: "type", order: "asc" },
            { by: "identifier", order: "asc" },
          ],
        },
      ],
    ]);
    // "No condition: all elements" and "No grouping" go on as well; chosen keys are saved as chosen.
    const plain = begin();
    (await last(plain.asked)).text?.("All");
    await choose(plain.asked, "No condition: all elements", "No grouping", "Title", "descending", "Save");
    expect(saves(plain.call).at(-1)).toEqual([
      "perspective.save",
      { name: "All", where: { all: [] }, sort: [{ by: "title", order: "desc" }] },
    ]);
  });

  it("[SR-219/AK-kv63] New saved filter asks name, condition and sort; its take hit is Next: sort, and Save without keys saves no sort", async () => {
    const run = begin([shown], {}, "filter.save");
    (await last(run.asked)).text?.("Drafts");
    await choose(run.asked, "Status", "Draft");
    expect((await names(run.asked))[0]).toBe("Next: sort");
    await choose(run.asked, "Next: sort");
    expect((await last(run.asked)).label).toBe("New saved filter Drafts · sort:");
    await choose(run.asked, "Save");
    expect(saves(run.call, "filter.save")).toEqual([
      ["filter.save", { name: "Drafts", where: { all: [{ status: ["draft"] }] } }],
    ]);
  });

  it("[SR-219/AK-vnsd] the name step shows the saved ones as hits and says when the typed name replaces one, and that a modified buffer loses its changes", async () => {
    const run = begin();
    const name = await last(run.asked);
    expect(name.preview).toBe(true);
    expect(name.items.map((choice) => choice.name)).toEqual(["Rain"]);
    expect(name.explain?.note?.("Sun")).toBeUndefined();
    // Ignoring case and Unicode normal form, as core compares names.
    expect(name.explain?.note?.(" rain ")).toBe("Replaces the perspective Rain");
    const perspective = perspectiveBuffer({ name: "Rain", saved: { where: { all: [] } } });
    const modified = withQuery(perspective, { steps: [...perspective.steps, typeStep("need")] });
    const changed = begin([modified]);
    expect((await last(changed.asked)).explain?.note?.("RAIN")).toBe(
      "Replaces the perspective Rain; the changes of its modified buffer are lost",
    );
    // A hit chosen takes its name.
    (await last(run.asked)).items[0]?.run();
    expect((await last(run.asked)).label).toBe("New perspective Rain · where:");
    // The saved filters for a saved filter; "Café" is "Café".
    const filter = begin(
      [shown],
      { "filter.list": () => ({ filters: [{ name: "Café", file: "f.yaml" }] }) },
      "filter.save",
    );
    expect((await last(filter.asked)).explain?.note?.("café")).toBe("Replaces the saved filter Café");
    // An empty name is asked again; a list that cannot be read says why.
    (await last(filter.asked)).text?.("  ");
    expect((await last(filter.asked)).label).toBe("New saved filter · name:");
    const failing = begin([shown], { "perspective.list": () => new Error("The perspectives are faulty") });
    expect((await last(failing.asked)).label).toBe("The perspectives are faulty · New perspective · name:");
  });

  it("[SR-219/AK-wsw0] Ctrl/Cmd+Enter in a step saves nothing, offers the optional arguments that are no step, then goes on with the next step", async () => {
    const run = begin();
    (await last(run.asked)).more?.("rain");
    const more = await last(run.asked);
    expect(more.label).toBe("New perspective rain · more arguments:");
    expect(more.items.map((choice) => choice.name)).toEqual(["Next: condition", "description", "filter"]);
    await choose(run.asked, "description");
    (await last(run.asked)).text?.("For the review");
    // After the optional argument, the next step.
    expect((await last(run.asked)).label).toBe("New perspective rain For the review · where:");
    item((await last(run.asked)).items, "No condition: all elements").more?.();
    expect(await names(run.asked)).toEqual(["Next: grouping", "filter"]);
    await choose(run.asked, "filter", "Open needs");
    expect((await last(run.asked)).label).toBe("New perspective rain For the review Open needs · group:");
    item((await last(run.asked)).items, "No grouping").more?.();
    expect(await names(run.asked)).toEqual(["Next: sort"]);
    await choose(run.asked, "Next: sort");
    expect(saves(run.call)).toHaveLength(0);
    // In the last step Ctrl/Cmd+Enter offers them with Save first.
    item((await last(run.asked)).items, "Save").more?.();
    expect(await names(run.asked)).toEqual(["Save"]);
    await choose(run.asked, "Save");
    expect(saves(run.call)).toEqual([
      [
        "perspective.save",
        {
          name: "rain",
          description: "For the review",
          filter: "Open needs",
          where: { all: [] },
          sort: [
            { by: "type", order: "asc" },
            { by: "identifier", order: "asc" },
          ],
        },
      ],
    ]);
    // The explanation line names Ctrl/Cmd+Enter while such an argument is left.
    const filter = begin([shown], {}, "filter.save");
    expect((await last(filter.asked)).explain?.more).toBe(true);
  });

  it("[SR-219/AK-pqry] Escape goes back a step with its answers and marks; each step shows the marks of the steps before without ×", async () => {
    const run = begin();
    (await last(run.asked)).text?.("rain");
    await choose(run.asked, "Type", "Decision", "Take 1 type", "Next: grouping");
    expect((await last(run.asked)).earlier).toEqual(["type: decision"]);
    await choose(run.asked, "Status", "Title", "ascending");
    const sort = await last(run.asked);
    expect(sort.earlier).toEqual(["type: decision", "grouped by Status"]);
    expect(sort.marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    // The sort's marks are its own; Escape goes back to the grouping, whose answer stands first and marked, so
    // Enter keeps it.
    sort.back?.();
    const group = await last(run.asked);
    expect(group.label).toBe("New perspective rain · group:");
    expect((await names(run.asked)).slice(0, 2)).toEqual(["Status", "No grouping"]);
    (await last(run.asked)).items[0]?.run();
    await flush();
    const sortAgain = await last(run.asked);
    expect(sortAgain.earlier).toEqual(["type: decision", "grouped by Status"]);
    expect(sortAgain.marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    // Back to the grouping, then to the condition with its marks.
    sortAgain.back?.();
    (await last(run.asked)).back?.();
    const where = await last(run.asked);
    expect(where.label).toBe("New perspective rain · where:");
    expect(where.marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    expect(where.earlier).toEqual([]);
    // Forward again: the sort's marks stand again.
    await choose(run.asked, "Next: grouping", "No grouping");
    expect((await last(run.asked)).marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    expect((await last(run.asked)).earlier).toEqual(["type: decision"]);
    // Back to the name, which stands again, and before it the command prompt.
    const back = begin();
    (await last(back.asked)).text?.("rain");
    (await last(back.asked)).back?.();
    expect((await last(back.asked)).initial).toBe("rain");
    (await last(back.asked)).back?.();
    expect(back.reopened()).toBe(1);
    expect(saves(run.call)).toHaveLength(0);
  });

  it("[SR-219/AK-k5p2] after Save New perspective opens the perspective as saved and says so, New saved filter only says so; a refusal shows its step with the message and every answer again", async () => {
    const opened: string[] = [];
    const run = setup([shown], answers);
    const context = {
      ...run.context,
      perspectives: { used: () => [], opened: (name: string) => opened.push(name) },
    };
    startBuilder(context, "perspective.save", CATALOG);
    (await last(run.asked)).text?.("Rain");
    await choose(run.asked, "No condition: all elements", "No grouping", "Save");
    expect(run.dispatched.at(-1)).toMatchObject({ type: "open", buffer: { perspective: { name: "Rain" } } });
    expect(opened).toEqual(["Rain"]);
    expect(run.echoed.at(-1)).toBe("Saved perspective Rain");
    // Saved but not opened: it says so, and why.
    let faulty = false;
    const unopened = begin([shown], {
      "perspective.list": () =>
        faulty ? new Error("The perspectives are faulty") : answers["perspective.list"](),
      "perspective.save": () => {
        faulty = true;
        return { files: ["perspectives/rain.yaml"] };
      },
    });
    (await last(unopened.asked)).text?.("Rain");
    await choose(unopened.asked, "No condition: all elements", "No grouping", "Save");
    expect(unopened.echoed.at(-1)).toBe("Saved perspective Rain · The perspectives are faulty");

    const filter = begin([shown], {}, "filter.save");
    (await last(filter.asked)).text?.("Open");
    await choose(filter.asked, "No condition: all elements", "Save");
    expect(filter.echoed.at(-1)).toBe("Saved filter Open");
    expect(filter.dispatched).toEqual([]);

    // A refused name: the name step with core's message, then every answer again, until Save.
    const refusal = refusedWith("name: too long", { errors: [{ field: "name" }] });
    let refuse = true;
    const refused = begin([shown], {
      "perspective.save": () => (refuse ? refusal : { files: ["perspectives/x.yaml"] }),
    });
    (await last(refused.asked)).text?.("x");
    await choose(
      refused.asked,
      "Type",
      "Decision",
      "Take 1 type",
      "Next: grouping",
      "Status",
      "Title",
      "ascending",
      "Save",
    );
    const name = await last(refused.asked);
    expect(name.label).toBe("name: too long · New perspective · name:");
    expect(name.initial).toBe("x");
    refuse = false;
    name.text?.("y");
    expect((await last(refused.asked)).marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    await choose(refused.asked, "Next: grouping");
    // The grouping given stands first and marked: Enter keeps it.
    expect((await names(refused.asked))[0]).toBe("Status");
    (await last(refused.asked)).items[0]?.run();
    await flush();
    expect((await last(refused.asked)).marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    await choose(refused.asked, "Save");
    expect(saves(refused.call).at(-1)).toEqual([
      "perspective.save",
      {
        name: "y",
        where: { all: [{ type: ["decision"] }] },
        group: "status",
        sort: [{ by: "title", order: "asc" }],
      },
    ]);
    // A refusal that names no step shows the last step; one of an optional argument asks that again first.
    const other = begin([shown], { "perspective.save": () => new Error("The workspace is read-only") });
    (await last(other.asked)).text?.("z");
    await choose(other.asked, "No condition: all elements", "No grouping", "Save");
    expect((await last(other.asked)).label).toBe("The workspace is read-only · New perspective z · sort:");
    const described = refusedWith("description: too long", { errors: [{ field: "description" }] });
    const optional = begin([shown], { "perspective.save": () => described });
    (await last(optional.asked)).more?.("z");
    await choose(optional.asked, "description");
    (await last(optional.asked)).text?.("long");
    await choose(optional.asked, "No condition: all elements", "No grouping", "Save");
    expect((await last(optional.asked)).label).toBe(
      "description: too long · New perspective z · description:",
    );
    (await last(optional.asked)).text?.("short");
    expect((await last(optional.asked)).label).toBe("New perspective z short · sort:");
  });
});
