import { describe, expect, it, vi } from "vitest";
import type { ActionContext, Prompt } from "./action-types.js";
import { ACTIONS } from "./actions.js";
import { elementBuffer, listBuffer } from "./buffers.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { askable, fits } from "./catalog-arguments.js";
import { catalogItems, startBuilder } from "./catalog-commands.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";
import type { Answer } from "./catalog-commands.test-helper.js";
import {
  CATALOG,
  flush,
  setup,
  command,
  item,
  last,
  refusedWith,
  start,
  OPTIONS,
  hit,
  HINTS,
} from "./catalog-commands.test-helper.js";

describe("write commands in the command prompt (SR-073 AK2, ThomasBirkmaier/ReqSeq-archive#85)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const titles = (context: CatalogContext): string[] =>
    catalogItems(context, CATALOG, ACTIONS).map((choice) => choice.name);

  /** The implemented write commands of the catalog. */
  const writes = CATALOG.filter((entry) => entry.implemented && entry.effect !== "read");

  it("offers every implemented write command by its title, but element.update and element.addAttachment, which the element buffer does, the two saves the builders run (SR-219 AK1), and the renames and deletes the app's actions run (SR-218)", () => {
    expect(writes.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["filter.save", "workspace.init", "relation.add", "hint.confirm"]),
    );
    // element.update is the element buffer's: "Save element" covers it.
    expect(ACTIONS.find((action) => action.title === "Save element")?.covers).toEqual(["element.update"]);
    // element.addAttachment too: "Insert image" puts its Markdown into the text (SR-097).
    expect(ACTIONS.find((action) => action.title === "Insert image")?.covers).toEqual([
      "element.addAttachment",
    ]);
    const { context } = setup([list]);
    const offered = titles(context);
    expect(writes.filter((entry) => !offered.includes(entry.title)).map((entry) => entry.name)).toEqual([
      "element.update",
      "element.addAttachment",
      "filter.save",
      "filter.rename",
      "filter.delete",
      "perspective.save",
      "perspective.rename",
      "perspective.delete",
    ]);
    // Renaming and deleting perspectives and saved filters are app actions under the commands' titles (SR-218).
    for (const name of ["perspective.rename", "perspective.delete", "filter.rename", "filter.delete"]) {
      const covering = ACTIONS.find((action) => action.covers?.includes(name) === true);
      expect(covering?.title).toBe(CATALOG.find((entry) => entry.name === name)?.title);
    }
  });

  it("asks every offered write command but hint.confirm and tool.guide for a required argument", () => {
    expect(
      writes
        .filter((entry) => entry.name !== "element.update")
        .filter((entry) => (entry.input as { required?: unknown }).required === undefined)
        .map((entry) => entry.name),
    ).toEqual(["tool.guide", "hint.confirm"]);
  });

  it("runs Agent guide, a write command since it can write the skill file, and shows the guide text", async () => {
    const guide = "# Working with ReqSeq\n\nReqSeq keeps needs.\n";
    const { context, asked, call, dispatched } = setup([list], { "tool.guide": () => ({ guide }) });
    start(context, "tool.guide");
    // As a write command without a required argument it asks its first one, `names`, first.
    const names = await last(asked);
    expect(names.label).toBe("Agent guide · names:");
    item(names.items, "cli").run();
    await flush();
    expect(call).toHaveBeenCalledWith("tool.guide", { names: "cli" });
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { kind: "result", command: "tool.guide", output: { guide } },
    });
  });

  it("offers no write command that a read-only workspace refuses, and still the read commands", () => {
    const { context } = setup([list]);
    const readOnly = titles({ ...context, readOnly: true });
    for (const entry of writes) {
      expect(readOnly.includes(entry.title)).toBe(
        entry.whileReadOnly !== "refuse" && entry.name !== "element.update",
      );
    }
    expect(readOnly).toContain("Create workspace");
    expect(readOnly).toContain("Show trace chain");
    expect(titles({ ...context, readOnly: false })).toContain("Create relation");
  });

  it("offers only Create workspace while a folder without a workspace is open, and asks its path and name", async () => {
    const { context, asked, call, dispatched } = setup([], {
      "workspace.init": () => ({ root: "/station", files: ["reqseq-workspace.yaml"] }),
    });
    const bare = { ...context, workspace: false };
    expect(titles(bare)).toEqual(["Create workspace"]);
    start(bare, "workspace.init");
    (await last(asked)).text?.(".");
    const name = await last(asked);
    expect(name.label).toBe("Create workspace . · name:");
    name.text?.("Station");
    await flush();
    expect(call).toHaveBeenLastCalledWith("workspace.init", { path: ".", name: "Station" });
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { written: true } });
  });

  it("saves a filter by its name, with its condition built from hits (#1645)", async () => {
    const { context, asked, call } = setup([list], {
      "metamodel.get": () => FIXTURE_METAMODEL,
      "filter.list": () => ({ filters: [] }),
      "filter.save": () => ({ files: ["filters/open.yaml"] }),
    });
    startBuilder(context, "filter.save", CATALOG);
    (await last(asked)).text?.("open");
    (await last(asked)).literal?.('{"status":["draft"]}')?.run();
    item((await last(asked)).items, "Next: sort").run();
    item((await last(asked)).items, "Save").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ status: ["draft"] }] },
    });
  });

  it("Confirm hints: Enter, Enter, Enter on a shown element confirms its hints, and the output is never asked again", async () => {
    const { context, asked, call, dispatched } = setup([shown], {
      "hint.confirm": () => ({ confirmed: ["h1"], files: ["f1.md"], problems: [] }),
      "hint.list": () => HINTS,
    });
    // Without a required argument it asks its first one, so it fits the shown element.
    expect(fits(context, command("hint.confirm"))).toBe(true);
    start(context, "hint.confirm");
    const ref = await last(asked);
    expect(ref.label).toBe("Confirm hints · ref:");
    expect(ref.empty).toBeUndefined();
    ref.items[0]?.run();
    // `hintIds` reads `ref`: asked next; Enter on an empty input skips it.
    const hintIds = await last(asked);
    expect(hintIds.label).toBe("Confirm hints SR-000001 (SR-1) · hintIds:");
    hintIds.empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { kind: "result", name: "Confirm hints SR-000001 (SR-1)", written: true },
    });
  });

  it("takes the values of an optional argument read from a given one, and offers a skipped one again with Ctrl/Cmd+Enter", async () => {
    const { context, asked, call } = setup([shown], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "Relation Refines is outdated").run();
    const second = await last(asked);
    expect(second.label).toBe("Confirm hints SR-000001 (SR-1) Relation Refines is outdated · hintIds:");
    // A hint taken is not offered again.
    expect(second.items).toEqual([]);
    second.empty?.(false);
    await flush();
    // The chosen hints take the place of `ref` (`replaces`): only they are confirmed, not every hint of SR-1 (#291).
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { hintIds: ["h1"] });
    // Skipped with Ctrl/Cmd+Enter: the optional arguments follow, the skipped one among them.
    const again = setup([shown], { "hint.confirm": () => ({ confirmed: [] }), "hint.list": () => HINTS });
    start(again.context, "hint.confirm");
    (await last(again.asked)).items[0]?.run();
    (await last(again.asked)).empty?.(true);
    const more = await last(again.asked);
    expect(more.items.map((i) => i.name)).toEqual(["Run", "target", "all", "kind", "expected", "hintIds"]);
    // Backspace on it asks the skipped one again.
    more.back?.();
    expect((await last(again.asked)).label).toBe("Confirm hints SR-000001 (SR-1) · hintIds:");
  });

  it("confirms the hints of a kind in the whole workspace with all yes, not those of the shown element (#644)", async () => {
    const { context, asked, call } = setup([shown], {
      "hint.confirm": () => ({ confirmed: ["h1"], files: ["f1.md"], problems: [] }),
      "hint.list": () => HINTS,
    });
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(true);
    item((await last(asked)).items, "all").run();
    item((await last(asked)).items, "yes").more?.();
    item((await last(asked)).items, "kind").run();
    // The problem codes of the catalog are offered (#1575).
    item((await last(asked)).items, "relation.outdated").more?.();
    item((await last(asked)).items, "expected").run();
    (await last(asked)).more?.("3");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.confirm", {
      all: true,
      kind: ["relation.outdated"],
      expected: 3,
    });
  });

  it("leaves every field hintIds replaces out of the input, target and kind too (#291)", async () => {
    const { context, asked, call } = setup([shown], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(true);
    item((await last(asked)).items, "target").run();
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "hintIds").run();
    item((await last(asked)).items, "Relation Refines is outdated").run();
    (await last(asked)).empty?.(false);
    item((await last(asked)).items, "Run").run();
    await flush();
    // Given were ref and target SR-000001 (SR-1) and the hint h1: only h1 is confirmed, not every hint pointing at SR-000001 (SR-1).
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { hintIds: ["h1"] });
  });

  it("asks no optional argument that reads one not given: Supersede element runs without successor and relation", async () => {
    const { context, asked, call } = setup([shown], {
      "element.supersede": () => ({ files: [] }),
      "element.get": () => ({ element: { ...hit(1), type: "requirement" } }),
      "metamodel.get": () => FIXTURE_METAMODEL,
    });
    start(context, "element.supersede");
    (await last(asked)).items[0]?.run();
    // Only the invalid statuses of the element's type.
    const status = await last(asked);
    expect(status.items.map((i) => i.name)).toEqual(["Retired"]);
    status.items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.supersede", { ref: "uuid-1", status: "retired" });
  });

  it("saves every open buffer's input before a write command runs, and does not run it when one cannot be saved", async () => {
    const other = elementBuffer("uuid-2", "spec", "SR-000002 (SR-2) Title 2");
    const saved: string[] = [];
    const running = setup([shown, other], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    const context = {
      ...running.context,
      drafted: () => true,
      saveDraft: (key: string) => {
        saved.push(key);
        return Promise.resolve(true);
      },
    };
    start(context, "hint.confirm");
    (await last(running.asked)).items[0]?.run();
    (await last(running.asked)).empty?.(false);
    await flush();
    // The shown buffer last, as a workspace switch saves.
    expect(saved).toEqual([other.key, shown.key]);
    expect(running.call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    // Input that cannot be saved stops the command before it is sent.
    const stopped = setup([shown, other], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    const tried: string[] = [];
    const failing = {
      ...stopped.context,
      drafted: () => true,
      saveDraft: (key: string) => {
        tried.push(key);
        return Promise.resolve(key !== other.key);
      },
    };
    start(failing, "hint.confirm");
    (await last(stopped.asked)).items[0]?.run();
    (await last(stopped.asked)).empty?.(false);
    await flush();
    expect(stopped.call).not.toHaveBeenCalledWith("hint.confirm", expect.anything());
    // The first that cannot be saved stops the saving too.
    expect(tried).toEqual([other.key]);
    expect(stopped.echoed.at(-1)).toBe(
      "SR-000002 (SR-2) Title 2 could not be saved: Confirm hints did not run",
    );
    // Without saveDraft nothing is saved, and the command runs; a read command saves nothing.
    const unsaving = setup([shown], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
      "test.kinds": () => OPTIONS,
    });
    const plain = { ...unsaving.context, drafted: () => true };
    start(plain, "hint.confirm");
    (await last(unsaving.asked)).items[0]?.run();
    (await last(unsaving.asked)).empty?.(false);
    await flush();
    expect(unsaving.call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    const saveDraft = vi.fn(() => Promise.resolve(true));
    start({ ...unsaving.context, drafted: () => true, saveDraft }, "test.kinds");
    (await last(unsaving.asked)).items[0]?.run();
    await flush();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(unsaving.call).toHaveBeenLastCalledWith("test.kinds", { ref: "uuid-1" });
  });
});

// SR-071 AK5: after the last argument of a bulk update the prompt shows the preview and asks the confirmation; it
// writes the plan of the shown preview (AK2, #158).
describe("a bulk update shows its preview and asks the confirmation next (SR-071 AK5)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const PLAN = `p1:${"a".repeat(64)}`;
  const PREVIEW = {
    selection: { where: { type: ["need"] } },
    property: "rationale",
    operation: "set",
    value: "Why",
  };
  const skipped = { id: "uuid-9", shortId: "SR-9", reason: "not-a-property", message: "no rationale" };
  const preview = {
    applied: false,
    count: 2,
    affected: [],
    unchanged: 0,
    skipped: [skipped],
    files: [],
    problems: [],
    plan: PLAN,
  };
  const written = { ...preview, applied: true, files: ["a.md", "b.md"] };
  const answers = (bulkUpdate: (input: Record<string, unknown>) => Answer) => ({
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.bulkUpdate": bulkUpdate,
  });
  const bulkCalls = (call: ReturnType<typeof setup>["call"]) =>
    call.mock.calls.filter(([name]) => name === "element.bulkUpdate").map(([, input]) => input);

  /** Runs "Bulk update elements" rationale set "Why" up to the step after the last argument. */
  const answer = async (
    context: ActionContext & CatalogContext,
    asked: readonly Prompt[],
  ): Promise<Prompt> => {
    start(context, "element.bulkUpdate");
    item((await last(asked)).items, "Rationale").run();
    item((await last(asked)).items, "set").run();
    (await last(asked)).text?.("Why");
    return last(asked);
  };

  it("opens the preview, then asks No first and Yes, apply, with the counts and that Ctrl+Enter writes", async () => {
    const { context, asked, call, dispatched, echoed } = setup(
      [list],
      answers(() => preview),
    );
    const confirm = await answer(context, asked);
    expect(bulkCalls(call)).toEqual([PREVIEW]);
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { command: "element.bulkUpdate", input: PREVIEW, output: preview, written: true },
    });
    expect(confirm.label).toBe("Bulk update elements Rationale set Why · confirm:");
    expect(confirm.items.map((hit) => hit.name)).toEqual(["No", "Yes, apply"]);
    expect(confirm.explain).toMatchObject({
      name: "confirm",
      description: "Writes 2 elements, skips 1 element",
      more: true,
      moreDoes: "writes",
    });
    expect(confirm.confirm).toBeDefined();
    expect(echoed).toEqual([]);
  });

  it("goes back to the last argument on No and Escape, keeps the preview, and writes nothing", async () => {
    const { context, asked, call, dispatched } = setup(
      [list],
      answers(() => preview),
    );
    const confirm = await answer(context, asked);
    const opened = dispatched.length;
    item(confirm.items, "No").run();
    const back = await last(asked);
    expect(back.label).toBe("Bulk update elements Rationale set · value:");
    back.text?.("Why");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("Bulk update elements Rationale set · value:");
    expect(bulkCalls(call).filter((input) => input["confirm"] === true)).toEqual([]);
    // The preview buffer stays: nothing closes it, only the new previews open.
    expect(dispatched.slice(opened).map((action) => action.type)).toEqual(["open"]);
  });

  it("writes the plan of the shown preview on Yes, apply and on Ctrl/Cmd+Enter", async () => {
    const yes = setup(
      [list],
      answers((input) => (input["confirm"] === true ? written : preview)),
    );
    item((await answer(yes.context, yes.asked)).items, "Yes, apply").run();
    await flush();
    expect(yes.call).toHaveBeenLastCalledWith("element.bulkUpdate", {
      ...PREVIEW,
      confirm: true,
      plan: PLAN,
    });
    expect(yes.dispatched.at(-1)).toMatchObject({ buffer: { output: written } });
    const more = setup(
      [list],
      answers((input) => (input["confirm"] === true ? written : preview)),
    );
    (await answer(more.context, more.asked)).confirm?.();
    await flush();
    expect(bulkCalls(more.call)).toEqual([PREVIEW, { ...PREVIEW, confirm: true, plan: PLAN }]);
  });

  it("shows the new preview and asks again when core refuses the plan, and says another refusal", async () => {
    const changed = { ...preview, count: 3, skipped: [], plan: `p1:${"b".repeat(64)}` };
    let previews = 0;
    const refused = setup(
      [list],
      answers((input) => {
        if (input["confirm"] === true) {
          return input["plan"] === PLAN
            ? refusedWith("plan: the change now writes other elements", { reason: "plan-changed" })
            : written;
        }
        previews += 1;
        return previews === 1 ? preview : changed;
      }),
    );
    item((await answer(refused.context, refused.asked)).items, "Yes, apply").run();
    await flush();
    expect(refused.dispatched.at(-1)).toMatchObject({ buffer: { input: PREVIEW, output: changed } });
    const again = await last(refused.asked);
    expect(again.label).toBe(
      "Something changed since the preview, so nothing was written; this is the new preview · Bulk update elements Rationale set Why · confirm:",
    );
    expect(again.explain?.description).toBe("Writes 3 elements, skips 0 elements");
    item(again.items, "Yes, apply").run();
    await flush();
    expect(refused.call).toHaveBeenLastCalledWith("element.bulkUpdate", {
      ...PREVIEW,
      confirm: true,
      plan: changed.plan,
    });
    // A new preview that writes no element asks nothing and says why it was made.
    const emptied = setup(
      [list],
      answers((input) =>
        input["confirm"] === true
          ? refusedWith("plan: changed", { reason: "plan-changed" })
          : bulkCalls(emptied.call).length === 1
            ? preview
            : { ...preview, count: 0 },
      ),
    );
    item((await answer(emptied.context, emptied.asked)).items, "Yes, apply").run();
    await flush();
    expect(emptied.echoed.at(-1)).toBe(
      "Something changed since the preview, so nothing was written; this is the new preview · Bulk update elements writes no element (skips 1 element), so there is nothing to confirm",
    );
    // A failing new preview, and another refusal of the confirmed call, are said.
    const failing = setup(
      [list],
      answers((input) => {
        if (input["confirm"] === true) {
          return refusedWith("plan: changed", { reason: "plan-changed" });
        }
        previews += 1;
        return previews === 3 ? preview : Object.assign(new Error("Workspace is read-only"), { name: "x" });
      }),
    );
    item((await answer(failing.context, failing.asked)).items, "Yes, apply").run();
    await flush();
    expect(failing.echoed.at(-1)).toBe("Workspace is read-only");
    const other = setup(
      [list],
      answers((input) =>
        input["confirm"] === true
          ? Object.assign(new Error("a.md is read-only"), { name: "file.read-only" })
          : preview,
      ),
    );
    item((await answer(other.context, other.asked)).items, "Yes, apply").run();
    await flush();
    expect(other.echoed.at(-1)).toBe("a.md is read-only");
  });

  it("does not ask when the change writes no element, and says so", async () => {
    const none = { ...preview, count: 0 };
    const { context, asked, call, dispatched, echoed } = setup(
      [list],
      answers(() => none),
    );
    const after = await answer(context, asked);
    expect(after.label).toBe("Bulk update elements Rationale set · value:");
    expect(bulkCalls(call)).toEqual([PREVIEW]);
    expect(dispatched.at(-1)).toMatchObject({ buffer: { output: none } });
    expect(echoed).toEqual([
      "Bulk update elements writes no element (skips 1 element), so there is nothing to confirm",
    ]);
  });

  it("asks a refused argument of the preview again, and does not write when a buffer cannot be saved", async () => {
    const { context, asked } = setup(
      [list],
      answers(() => refusedWith("value: not a text", { errors: [{ field: "value" }] })),
    );
    const again = await answer(context, asked);
    expect(again.label).toContain("value: not a text");
    let saves = 0;
    const stopped = setup(
      [list],
      answers(() => preview),
    );
    const saving = {
      ...stopped.context,
      drafted: () => true,
      saveDraft: () => {
        saves += 1;
        return Promise.resolve(saves === 1);
      },
    };
    item((await answer(saving, stopped.asked)).items, "Yes, apply").run();
    await flush();
    expect(bulkCalls(stopped.call)).toEqual([PREVIEW]);
    expect(stopped.echoed.at(-1)).toBe("type: need could not be saved: Bulk update elements did not run");
  });

  it("[SR-215/AK-qpq7] asks no confirm, plan or expected: Ctrl/Cmd+Enter offers only Run after the value", async () => {
    const { context, asked } = setup(
      [list],
      answers(() => preview),
    );
    start(context, "element.bulkUpdate");
    item((await last(asked)).items, "Rationale").run();
    item((await last(asked)).items, "set").run();
    const value = await last(asked);
    expect(value.explain?.more).toBe(false);
    value.more?.("Why");
    expect((await last(asked)).items.map((hit) => hit.name)).toEqual(["Run"]);
    expect(askable(command("element.bulkUpdate")).map((arg) => arg.field)).toEqual([
      "property",
      "operation",
      "value",
    ]);
  });
});
