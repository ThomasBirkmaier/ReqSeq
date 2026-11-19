import { describe, expect, it } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import type { Prompt } from "./action-types.js";
import { ACTIONS } from "./actions.js";
import type { Buffers } from "./buffers.js";
import { elementBuffer, filteredList, listBuffer } from "./buffers.js";
import { savedStep, typeStep } from "./list-filters.js";
import { askable, contextField } from "./catalog-arguments.js";
import { catalogItems, startBuilder } from "./catalog-commands.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";
import { contextOf } from "../../../../scripts/contracts/catalog-checks.mjs";
import type { Answer } from "./catalog-commands.test-helper.js";
import {
  PLATFORM_SEP,
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
} from "./catalog-commands.test-helper.js";

describe("the fixed values of SR-215 AK1 as hits (#1644)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const ADDED = new Set([
    "criterion",
    "evidenceLocation",
    "elementFile",
    "metamodelLocation",
    "group",
    "condition",
    "sort",
    "searchField",
    "properties",
    "relations",
  ]);

  /** A copy of `name` that asks only `fields`, all required, in their catalog order, titled "Ask it". */
  const only = (name: string, ...fields: readonly string[]): CommandListing => {
    const listing = command(name);
    return {
      ...listing,
      title: "Ask it",
      arguments: listing.arguments.filter((arg) => fields.includes(arg.field)),
      input: { ...listing.input, required: [...fields] },
    };
  };

  /** The name and the key beside it of each hit of the last prompt. */
  const hits = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map((choice) => `${choice.name} | ${choice.hint ?? ""}`);

  const CRITERIA = {
    property: "acceptance-criteria",
    criteria: [
      { criterion: 1, key: "kone", text: "Given a list,\n  when it opens" },
      { criterion: 2, text: "Without a key" },
      { criterion: 3, key: "k3x9", text: "Third" },
    ],
  };

  it("lists the new sources on the arguments the plan names, and a meaning only on element arguments", () => {
    const named = CATALOG.flatMap((entry) =>
      entry.arguments
        .filter((arg) => ADDED.has(arg.complete) || arg.meaning !== undefined)
        .map(
          (arg) =>
            `${entry.name} ${arg.field} ${arg.complete}${arg.meaning === undefined ? "" : `/${arg.meaning}`}`,
        ),
    );
    expect(named.sort()).toEqual(
      [
        "element.addAttachment file elementFile",
        "element.create properties properties",
        "element.create relations relations",
        "element.get file elementFile",
        "element.list group group",
        "element.list sort sort",
        "element.resolve file elementFile",
        "element.search fields searchField",
        "element.search group group",
        "evidence.list file elementFile",
        "evidence.record criteria criterion",
        "evidence.record folder evidenceLocation",
        "evidence.record variant element/variant",
        "filter.save sort sort",
        "filter.save where condition",
        "hint.list package element/package",
        "hint.list variant element/variant",
        "perspective.save group group",
        "perspective.save sort sort",
        "perspective.save where condition",
        "trace.affected file elementFile",
        "trace.chain file elementFile",
        "trace.matrix sort sort",
        "variant.diff variant element/variant",
        "variant.exclude variant element/variant",
        "workspace.init metamodel metamodelLocation",
      ].sort(),
    );
  });

  it("[SR-215/AK-fj75] shows types, statuses, properties, relation kinds and choices by name with the key beside", async () => {
    const { context, asked } = setup([shown], {
      "element.get": () => ({
        element: { ...hit(1), type: "software-requirement", properties: {}, relations: [] },
      }),
      "metamodel.get": () => FIXTURE_METAMODEL,
      "relation.options": () => OPTIONS,
    });
    catalogItems(context, [only("element.create", "type")], [])[0]?.run();
    expect(await hits(asked)).toEqual([
      "System Requirement | requirement",
      "Software Requirement | software-requirement",
      "Decision | decision",
      "Package | package",
    ]);
    catalogItems(context, [only("element.setStatus", "refs", "status")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(false);
    expect(await hits(asked)).toEqual(["Draft | draft", "Approved | approved", "Retired | retired"]);
    catalogItems(context, [only("element.bulkUpdate", "property", "value")], [])[0]?.run();
    expect(await hits(asked)).toContain("Component | component");
    item((await last(asked)).items, "Component").run();
    expect(await hits(asked)).toEqual(["Display | display", "Sensor | sensor"]);
    catalogItems(context, [only("relation.add", "source", "kind")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual(["derives from | derives-from", "refines | "]);
    // A value whose name is its key (a choice of the catalog, a repository) shows it once.
    catalogItems(context, [only("element.get", "versionDate")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["yes | ", "no | "]);
  });

  it("[SR-216/AK-s99w] offers the fields of element.searchFields by name with the key beside, without those taken", async () => {
    const { context, asked, call } = setup([shown], {
      "element.searchFields": () => ({
        fields: [
          { key: "title", name: "Title" },
          { key: "text", name: "Text" },
          { key: "id", name: "IDs" },
          { key: "properties", name: "All properties" },
          { key: "rationale", name: "Rationale" },
        ],
      }),
      "element.search": () => ({ hits: [], total: 0 }),
    });
    catalogItems(context, [only("element.search", "fields")], [])[0]?.run();
    expect(await hits(asked)).toEqual([
      "Title | title",
      "Text | text",
      "IDs | id",
      "All properties | properties",
      "Rationale | rationale",
    ]);
    item((await last(asked)).items, "Rationale").run();
    expect(await hits(asked)).toEqual([
      "Title | title",
      "Text | text",
      "IDs | id",
      "All properties | properties",
    ]);
    (await last(asked)).empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.search", { fields: ["rationale"] });
  });

  it("[SR-215/AK-fj75] offers the saved filters, the variants and the packages as hits and puts in what the command expects", async () => {
    const { context, asked, call } = setup([shown], {
      "filter.list": () => ({ filters: [{ name: "open needs", file: "f.yaml", where: {} }], problems: [] }),
      "metamodel.get": () => ({
        ...FIXTURE_METAMODEL,
        types: [...FIXTURE_METAMODEL.types, { key: "variant", name: "Variant", meaning: "variant" }],
      }),
      "element.list": (input) => ({
        elements: JSON.stringify(input).includes('"variant"')
          ? [{ ...hit(7), shortId: "VAR-1", identifier: "VAR-001", title: "Coast" }]
          : [{ ...hit(8), shortId: "PKG-1", title: "App" }],
      }),
    });
    catalogItems(context, [only("perspective.save", "filter")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["open needs | "]);
    item((await last(asked)).items, "open needs").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("perspective.save", { filter: "open needs" });
    catalogItems(context, [only("hint.list", "package", "variant")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["PKG-1 App | "]);
    expect(call).toHaveBeenCalledWith("element.list", {
      selection: { where: { type: ["package"] } },
      limit: 5000,
    });
    (await last(asked)).items[0]?.run();
    // The line names a hit by its ID, as an element found by search.
    expect((await last(asked)).label).toBe("Ask it PKG-1 · variant:");
    expect(await hits(asked)).toEqual(["VAR-1 (VAR-001) Coast | "]);
    (await last(asked)).items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.list", { package: "uuid-8", variant: "uuid-7" });
    // A metamodel without a type of the meaning offers none, and a failed read says why.
    const none = setup([shown], { "metamodel.get": () => FIXTURE_METAMODEL });
    catalogItems(none.context, [only("variant.diff", "variant")], [])[0]?.run();
    expect(await hits(none.asked)).toEqual([]);
    const broken = setup([shown], { "metamodel.get": () => new Error("No metamodel") });
    catalogItems(broken.context, [only("variant.diff", "variant")], [])[0]?.run();
    expect((await last(broken.asked)).label).toBe("No metamodel · Ask it · variant:");
  });

  it("[SR-215/AK-fj75] offers the acceptance criteria of the element that have a key, by number and text with the key beside, and puts in the key", async () => {
    const { context, asked, call } = setup([shown], {
      "element.get": () => ({ element: hit(1), criterionReferences: CRITERIA }),
      "evidence.record": () => ({ files: ["e.md"] }),
    });
    catalogItems(context, [only("evidence.record", "ref", "criteria")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(call).toHaveBeenCalledWith("element.get", { ref: "uuid-1" });
    expect(await hits(asked)).toEqual(["AK1 Given a list, when it opens | kone", "AK3 Third | k3x9"]);
    item((await last(asked)).items, "AK3 Third").run();
    // A list takes one per Enter, without those taken; the line names a criterion by number and key.
    expect((await last(asked)).label).toBe("Ask it SR-000001 (SR-1) AK3 (k3x9) · criteria:");
    expect(await hits(asked)).toEqual(["AK1 Given a list, when it opens | kone"]);
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual([]);
    (await last(asked)).empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", { ref: "uuid-1", criteria: ["k3x9", "kone"] });
    // Without an element they are typed, and a failed read says why.
    const alone = setup([shown], { "evidence.record": () => ({ files: [] }) });
    catalogItems(alone.context, [only("evidence.record", "criteria")], [])[0]?.run();
    expect((await last(alone.asked)).text).toBeDefined();
    const broken = setup([shown], { "element.get": () => new Error("No such element") });
    catalogItems(broken.context, [only("evidence.record", "ref", "criteria")], [])[0]?.run();
    (await last(broken.asked)).items[0]?.run();
    expect((await last(broken.asked)).label).toBe("No such element · Ask it SR-000001 (SR-1) · criteria:");
  });

  it("[SR-215/AK-fj75] offers the evidence locations evidence.record takes with the repository beside, and typed text for a folder below one", async () => {
    const { context, asked, call } = setup([shown], {
      "workspace.status": () => ({
        repositories: [
          { name: "spec", available: true },
          { name: "tests", available: true },
          { name: "far", available: false },
        ],
        evidence: [
          { repository: "spec", path: "evidence", available: true, folder: "evidence" },
          { repository: "tests", path: "out", available: false, folder: "../tests/out" },
          { repository: "spec", path: "evidence", available: true, folder: "evidence" },
          { repository: "far", path: "ev", available: false, folder: "../far/ev" },
          { repository: "unlisted", path: "ev", available: false },
        ],
      }),
      "evidence.record": () => ({ files: [] }),
    });
    catalogItems(context, [only("evidence.record", "folder")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["evidence | spec", "../tests/out | tests"]);
    item((await last(asked)).items, "../tests/out").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", { folder: "../tests/out" });
    catalogItems(context, [only("evidence.record", "folder")], [])[0]?.run();
    const prompt = await last(asked);
    // A folder below a location comes first as itself; a text below none has no such row.
    expect(prompt.literal?.("evidence/manual")?.name).toBe("Use evidence/manual");
    expect(prompt.literal?.("evidently")).toBeUndefined();
    prompt.literal?.("evidence/manual")?.more?.();
    expect((await last(asked)).label).toBe("Ask it evidence/manual · more arguments:");
    catalogItems(context, [only("evidence.record", "folder")], [])[0]?.run();
    (await last(asked)).text?.("elsewhere");
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", { folder: "elsewhere" });
  });

  it("[SR-215/AK-fj75] offers the file of the element, or the files of an ambiguous reference with the repository beside", async () => {
    const ambiguous = Object.assign(new Error("ref names 2 elements"), {
      name: "ref.ambiguous",
      details: {
        ref: "uuid-1",
        candidates: [
          { id: "uuid-1", repository: "spec", file: "a/SR-1.md" },
          { id: "uuid-1", repository: "copy", file: "b/SR-1.md" },
          { id: "uuid-1" },
        ],
      },
    });
    let answer: unknown = { element: hit(1) };
    const { context, asked, call } = setup([shown], {
      "element.get": (input) => (input["file"] === undefined ? answer : { element: hit(1) }),
    });
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual(["f1.md | spec"]);
    answer = ambiguous;
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual(["a/SR-1.md | spec", "b/SR-1.md | copy"]);
    item((await last(asked)).items, "b/SR-1.md").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", { ref: "uuid-1", file: "b/SR-1.md" });
    // A reference element.get does not read, or a refusal without candidates: typed, core checks it.
    answer = new Error("No such element");
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect((await last(asked)).text).toBeDefined();
    answer = Object.assign(new Error("ambiguous"), { name: "ref.ambiguous" });
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect((await last(asked)).text).toBeDefined();
  });

  it("[SR-215/AK-fj75] gives the repository with a file two repositories hold, and offers only the files of a repository given before", async () => {
    const ambiguous = Object.assign(new Error("ref names 3 elements"), {
      name: "ref.ambiguous",
      details: {
        candidates: [
          { id: "uuid-1", repository: "spec", file: "x/SR-1.md" },
          { id: "uuid-1", repository: "copy", file: "x/SR-1.md" },
          { id: "uuid-1", repository: "copy", file: "y/SR-1.md" },
        ],
      },
    });
    const { context, asked, call } = setup([shown], {
      "element.get": (input) => (input["file"] === undefined ? ambiguous : { element: hit(1) }),
      "workspace.status": () => ({ repositories: [{ name: "copy", available: true }] }),
    });
    // `repository` is an optional argument of the command, not asked here.
    const get = only("element.get", "ref", "repository", "file");
    const files = { ...get, input: { ...get.input, required: ["ref", "file"] } };
    catalogItems(context, [files], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    const offered = (await last(asked)).items;
    expect(new Set(offered.map((choice) => choice.id)).size).toBe(3);
    expect(offered.map((choice) => `${choice.name} | ${choice.hint ?? ""}`)).toEqual([
      "x/SR-1.md | spec",
      "x/SR-1.md | copy",
      "y/SR-1.md | copy",
    ]);
    offered[1]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", {
      ref: "uuid-1",
      repository: "copy",
      file: "x/SR-1.md",
    });
    offered[2]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", { ref: "uuid-1", file: "y/SR-1.md" });
    catalogItems(context, [only("element.get", "ref", "repository", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "copy").run();
    expect(await hits(asked)).toEqual(["x/SR-1.md | copy", "y/SR-1.md | copy"]);
  });

  it("[SR-215/AK-fj75] asks the metamodel location in two steps: the main repository or a typed one, then the path, completed below the new workspace's folder", async () => {
    const { context, asked, call } = setup([], {
      "workspace.listFolder": () => ({ entries: [{ name: "model", kind: "folder" }] }),
      "workspace.init": () => ({ files: [], problems: [] }),
    });
    const init = only("workspace.init", "path", "metamodel");
    catalogItems(context, [init], [])[0]?.run();
    (await last(asked)).text?.("work/new/");
    const repository = await last(asked);
    expect(repository.label).toBe("Ask it work/new/ · metamodel:");
    expect(repository.items.map((choice) => `${choice.name} | ${choice.hint ?? ""}`)).toEqual([
      "Main repository | default",
    ]);
    expect(repository.literal?.("")).toBeUndefined();
    repository.items[0]?.run();
    const path = await last(asked);
    expect(path.label).toBe("Ask it work/new/ · metamodel · path in the main repository:");
    const found = await path.seek?.("");
    expect(call).toHaveBeenLastCalledWith("workspace.listFolder", { path: "work/new/", files: false });
    expect(found?.choices.map((choice) => choice.complete)).toEqual([`model${PLATFORM_SEP}`]);
    // Backspace goes back to the repository.
    path.back?.();
    expect((await last(asked)).label).toBe("Ask it work/new/ · metamodel:");
    (await last(asked)).items[0]?.run();
    (await last(asked)).text?.("model");
    await flush();
    expect(call).toHaveBeenLastCalledWith("workspace.init", {
      path: "work/new/",
      metamodel: { path: "model" },
    });
  });

  it("[SR-215/AK-fj75] asks the path of a metamodel in another repository, typed by its name, as typed text", async () => {
    const { context, asked, call } = setup([], { "workspace.init": () => ({ files: [], problems: [] }) });
    const init = only("workspace.init", "path", "metamodel");
    catalogItems(context, [init], [])[0]?.run();
    (await last(asked)).text?.("work/new");
    (await last(asked)).literal?.(" shared ")?.more?.();
    const other = await last(asked);
    expect(other.label).toBe("Ask it work/new · metamodel · path in shared:");
    expect(other.seek).toBeUndefined();
    other.text?.("mm");
    expect((await last(asked)).label).toBe("Ask it work/new shared:mm · more arguments:");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("workspace.init", {
      path: "work/new",
      metamodel: { repository: "shared", path: "mm" },
    });
  });

  it("reads the field `CONTEXT` of catalog-checks.mjs names for every argument of the catalog, never one with a meaning", () => {
    for (const entry of CATALOG) {
      entry.arguments.forEach((arg, at) => {
        expect(contextField(entry.arguments, at), `${entry.name} ${arg.field}`).toBe(
          contextOf(entry.arguments, at),
        );
      });
    }
    const record = command("evidence.record").arguments;
    const at = (field: string): number => record.findIndex((arg) => arg.field === field);
    expect(at("variant")).toBeLessThan(at("criteria"));
    expect(contextField(record, at("criteria"))).toBe("ref");
    const create = command("element.create").arguments;
    expect(
      contextField(
        create,
        create.findIndex((arg) => arg.field === "relations"),
      ),
    ).toBe("type");
    const init = command("workspace.init").arguments;
    expect(
      contextField(
        init,
        init.findIndex((arg) => arg.field === "metamodel"),
      ),
    ).toBe("path");
  });

  it("asks nothing new after the required arguments of Record evidence", async () => {
    const { context, asked, call } = setup([shown], { "evidence.record": () => ({ files: ["e.md"] }) });
    start(context, "evidence.record");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "verification").run();
    item((await last(asked)).items, "passed").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", {
      ref: "uuid-1",
      kind: "verification",
      result: "passed",
    });
  });

  it("drops the criteria of a refused reference with it, keeps the variant, and offers the criteria again", async () => {
    let refuse = true;
    const { context, asked, call } = setup([shown], {
      "element.search": () => ({ hits: [hit(2)], total: 1 }),
      "element.get": () => ({ element: hit(1), criterionReferences: CRITERIA }),
      "metamodel.get": () => ({ types: [{ key: "variant", name: "Variant", meaning: "variant" }] }),
      "element.list": () => ({ elements: [{ ...hit(7), shortId: "VAR-1", title: "Coast" }] }),
      "evidence.record": () =>
        refuse
          ? refusedWith("ref: wrong", { errors: [{ field: "ref", message: "ref: wrong" }] })
          : { files: ["e.md"] },
    });
    start(context, "evidence.record");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "verification").run();
    item((await last(asked)).items, "passed").more?.();
    item((await last(asked)).items, "variant").run();
    (await last(asked)).items[0]?.more?.();
    item((await last(asked)).items, "criteria").run();
    item((await last(asked)).items, "AK1 Given a list, when it opens").run();
    (await last(asked)).empty?.(true);
    item((await last(asked)).items, "Run").run();
    const again = await last(asked);
    expect(again.label).toMatch(/^ref: wrong · Record evidence .*· ref:$/);
    refuse = false;
    again.items[0]?.more?.();
    expect((await last(asked)).items.map((i) => i.name)).toContain("criteria");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", {
      ref: "uuid-1",
      kind: "verification",
      result: "passed",
      variant: "uuid-7",
    });
  });
});

describe("a condition built step by step from hits (SR-215 AK3, AK4, AK6, AK9, AK10, #1645)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const FACETS = {
    total: 3,
    types: [],
    statuses: [{ key: "draft", count: 2 }],
    properties: [
      {
        key: "component",
        name: "Component",
        kind: "choice",
        count: 2,
        missing: 1,
        distinct: 1,
        values: [{ value: "display", name: "Display", count: 2 }],
      },
      { key: "rationale", name: "Rationale", kind: "text", count: 3, missing: 0, distinct: 3 },
    ],
  };
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => FACETS,
    "filter.list": () => ({ filters: [] }),
    "filter.save": () => ({ files: ["filters/open.yaml"] }),
  };

  /** "New saved filter" asked up to its condition: the name given. */
  const atWhere = async (extra: Record<string, (input: Record<string, unknown>) => Answer> = {}) => {
    const run = setup([shown], { ...answers, ...extra });
    startBuilder(run.context, "filter.save", CATALOG);
    (await last(run.asked)).text?.("open");
    return run;
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map(
      (choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`,
    );

  const marks = async (asked: readonly Prompt[]): Promise<(string | undefined)[]> =>
    ((await last(asked)).marks ?? []).map((mark) => mark.label);

  /** Chooses `kind`, then the value `value`, in the steps of the condition. */
  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  const KINDS = [
    "Type | type",
    "Status | status",
    "Property | property",
    "Verification status | verification",
    "Validation status | validation",
    "Validity | validFor",
    "Relation | relation",
    "Text search | text",
  ];

  it("[SR-215/AK-dt5s] offers the kinds, then their values; each chosen condition is a mark with the label of its list filter step, and the hits keep their place", async () => {
    const { asked, call } = await atWhere();
    const first = await last(asked);
    expect(first.label).toBe("New saved filter open · where:");
    expect(await names(asked)).toEqual(["No condition: all elements", ...KINDS]);
    // Types by their name in the metamodel, the key beside; the mark is the list's "type: <key>".
    await choose(asked, "Type");
    expect((await last(asked)).label).toBe("New saved filter open · where · Type:");
    expect(await names(asked)).toContain("System Requirement | requirement");
    await choose(asked, "System Requirement", "Take 1 type");
    expect(await marks(asked)).toEqual(["type: requirement"]);
    // The hits keep their place: only the finishing hit changes.
    expect(await names(asked)).toEqual(["Next: sort", ...KINDS]);
    // Statuses of the elements the marks select, by their name in the metamodel.
    await choose(asked, "Status");
    expect(call).toHaveBeenCalledWith("element.facets", {
      selection: { where: { all: [{ type: ["requirement"] }] } },
    });
    expect(await names(asked)).toEqual(["Draft | draft"]);
    await choose(asked, "Draft");
    // Properties whose values can be chosen (SR-124 AK2, AK3: free text is left out), then their values.
    await choose(asked, "Property");
    expect(await names(asked)).toEqual(["Component | component"]);
    await choose(asked, "Component");
    expect(await names(asked)).toEqual(["Display | display", "(no value)"]);
    await choose(asked, "(no value)");
    expect(await marks(asked)).toEqual(["type: requirement", "status: draft", "component: (no value)"]);
    // Verification and validation statuses from the condition's schema in the catalog.
    await choose(asked, "Verification status");
    expect(await names(asked)).toEqual(["open", "verified", "indirect", "failed", "outdated"]);
    await choose(asked, "failed");
    await choose(asked, "Validation status");
    expect(await names(asked)).toContain("open");
    await choose(asked, "open");
    // Validity: the views, the core first.
    await choose(asked, "Validity", "Core");
    // Relations: the ends of a derivation and evidence, then each relation kind and relation property.
    await choose(asked, "Relation");
    expect((await names(asked)).slice(0, 7)).toEqual([
      "without child",
      "with child",
      "without parent",
      "with parent",
      "without evidence",
      "with evidence",
      "without Derives from | derives-from",
    ]);
    expect(await names(asked)).toContain("with Package | packages");
    await choose(asked, "without child");
    // A text search takes the typed words; an empty input asks again.
    await choose(asked, "Text search");
    (await last(asked)).text?.("  ");
    expect((await last(asked)).label).toBe("New saved filter open · where · Text search:");
    (await last(asked)).text?.("brake");
    expect(await marks(asked)).toEqual([
      "type: requirement",
      "status: draft",
      "component: (no value)",
      "verification: failed",
      "validation: open",
      "validity: Core",
      "relation: without child",
      "text: brake",
    ]);
    expect(await names(asked)).toEqual(["Next: sort", ...KINDS]);
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: {
        all: [
          { type: ["requirement"] },
          { status: ["draft"] },
          { property: "component", op: "missing" },
          { verification: ["failed"] },
          { validation: ["open"] },
          { validFor: "core" },
          { relation: { meaning: "derivation", direction: "down" }, exists: false },
          { text: "brake" },
        ],
      },
    });
  });

  it("[SR-215/AK-fm4s] [SR-219/AK-kv63] the finishing hit is marked first: without a mark it goes on with no condition, with marks it is Next: sort; Ctrl/Cmd+Enter offers the optional arguments", async () => {
    const none = await atWhere();
    expect((await last(none.asked)).items[0]?.name).toBe("No condition: all elements");
    (await last(none.asked)).items[0]?.run();
    await flush();
    // It goes on to the sort and saves nothing yet.
    expect((await last(none.asked)).label).toBe("New saved filter open · sort:");
    expect(none.call.mock.calls.some(([name]) => name === "filter.save")).toBe(false);
    await choose(none.asked, "Save");
    expect(none.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    const some = await atWhere();
    await choose(some.asked, "Type", "Decision", "Take 1 type");
    await choose(some.asked, "Status", "Draft");
    expect((await last(some.asked)).items[0]?.name).toBe("Next: sort");
    // Ctrl/Cmd+Enter on any hit of this step takes the marks and offers the optional arguments.
    item((await last(some.asked)).items, "Status").more?.();
    const more = await last(some.asked);
    expect(more.label).toBe("New saved filter open · more arguments:");
    expect(more.earlier).toEqual(["type: decision", "status: draft"]);
    await choose(some.asked, "Next: sort", "Save");
    expect(some.call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ type: ["decision"] }, { status: ["draft"] }] },
    });
  });

  it("[SR-215/AK-z4bq] text that starts with { is one condition in JSON as a mark; a refused condition is asked again with core's message and the marks back", async () => {
    const refusal = refusedWith("where.all[1]: must be an object", { errors: [{ field: "where.all[1]" }] });
    const { asked, call } = await atWhere({ "filter.save": () => refusal });
    await choose(asked, "Type", "Decision", "Take 1 type");
    const prompt = await last(asked);
    // No hit for other text: Enter does nothing.
    expect(prompt.literal?.("type")).toBeUndefined();
    expect(prompt.text).toBeUndefined();
    const json = prompt.literal?.(' {"any":[{"status":["draft"]},{"not":{"type":["need"]}}]}');
    expect(json?.name).toBe("Add the condition in JSON");
    json?.run();
    expect(await marks(asked)).toEqual([
      "type: decision",
      '{"any":[{"status":["draft"]},{"not":{"type":["need"]}}]}',
    ]);
    // Text that is no JSON goes in as it is: core says what is wrong with it.
    (await last(asked)).literal?.("{a")?.run();
    expect(await marks(asked)).toContain("{a");
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: {
        all: [{ type: ["decision"] }, { any: [{ status: ["draft"] }, { not: { type: ["need"] } }] }, "{a"],
      },
    });
    const again = await last(asked);
    expect(again.label).toBe("where.all[1]: must be an object · New saved filter open · where:");
    expect(await marks(asked)).toHaveLength(3);
    // The message is said once: the next step has the plain label.
    await choose(asked, "Type");
    expect((await last(asked)).label).toBe("New saved filter open · where · Type:");
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] an × removes its mark; Backspace removes the last mark only where the kind is chosen; Escape keeps the marks, which stand again when the prompt returns to the argument", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Type", "Decision", "Take 1 type");
    await choose(asked, "Status", "Draft");
    await choose(asked, "Validity", "Core");
    const kinds = await last(asked);
    expect(kinds.unmark).toBe(true);
    // The × of the middle mark.
    kinds.marks?.[1]?.remove();
    expect(await marks(asked)).toEqual(["type: decision", "validity: Core"]);
    // In a step of the values Backspace goes back to the kinds (`back`) and removes no mark; its × does.
    await choose(asked, "Status");
    const values = await last(asked);
    expect(values.unmark).toBeUndefined();
    values.back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    await choose(asked, "Property", "Component");
    (await last(asked)).marks?.[0]?.remove();
    // A property's values go back to the properties, read anew for the marks left.
    expect((await last(asked)).label).toBe("New saved filter open · where · Property:");
    expect(await marks(asked)).toEqual(["validity: Core"]);
    (await last(asked)).back?.();
    // Ctrl/Cmd+Enter takes the marks; Escape (back) from the optional arguments returns to the condition, marks and all.
    (await last(asked)).items[0]?.more?.();
    expect((await last(asked)).label).toBe("New saved filter open · more arguments:");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual(["validity: Core"]);
    // Without a mark, back goes to the step before.
    (await last(asked)).marks?.[0]?.remove();
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter · name:");
  });

  it("[SR-215/AK-rx2z] Escape at the kinds keeps the marks: they stand again when the prompt returns to the condition, also after a refusal", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Type", "Decision", "Take 1 type");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter · name:");
    (await last(asked)).text?.("open");
    expect(await marks(asked)).toEqual(["type: decision"]);

    const refusal = refusedWith("where.all[0]: must be an object", { errors: [{ field: "where.all[0]" }] });
    const refused = await atWhere({ "filter.save": () => refusal });
    (await last(refused.asked)).literal?.("{a")?.run();
    await choose(refused.asked, "Next: sort", "Save");
    expect(await marks(refused.asked)).toEqual(["{a"]);
    (await last(refused.asked)).back?.();
    (await last(refused.asked)).text?.("open");
    expect((await last(refused.asked)).label).toBe("New saved filter open · where:");
    expect(await marks(refused.asked)).toEqual(["{a"]);
  });

  it("[SR-134/AK-trng] Escape after a refused condition goes back one step without core's message, which names the condition", async () => {
    const refusal = refusedWith("where.all[0]: must be an object", { errors: [{ field: "where.all[0]" }] });
    const { asked, call } = await atWhere({ "filter.save": () => refusal });
    (await last(asked)).literal?.("{a")?.run();
    await choose(asked, "Next: sort", "Save");
    expect((await last(asked)).label).toBe(
      "where.all[0]: must be an object · New saved filter open · where:",
    );
    const saves = () => call.mock.calls.filter(([name]) => name === "filter.save").length;
    const saved = saves();
    // Escape goes back to the name, the step before, with the plain label and the name given.
    (await last(asked)).back?.();
    const name = await last(asked);
    expect(name.label).toBe("New saved filter · name:");
    expect(name.initial).toBe("open");
    expect(saves()).toBe(saved);
  });

  it("[SR-215/AK-hnzf] the input is the marks in their order under all, as the command line takes it", async () => {
    const { asked, call } = await atWhere();
    await choose(asked, "Status", "Draft");
    await choose(asked, "Property", "Component", "Display");
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ status: ["draft"] }, { property: "component", op: "eq", value: "display" }] },
    });
  });

  const TYPES = [
    "Item | item",
    "System Requirement | requirement",
    "Software Requirement | software-requirement",
    "Decision | decision",
    "Package | package",
  ];

  it("[SR-215/AK-w8q6] a chosen type goes into one type mark and the step stays; Take N types comes first and takes the mark, which selects the elements of one of the types", async () => {
    const { asked, call } = await atWhere();
    await choose(asked, "Type");
    // No type yet: the types alone, no hit that takes.
    expect(await names(asked)).toEqual(TYPES);
    expect(await marks(asked)).toEqual([]);
    await choose(asked, "Decision");
    const one = await last(asked);
    expect(one.label).toBe("New saved filter open · where · Type:");
    expect(await marks(asked)).toEqual(["type: decision"]);
    // "Take 1 type" first, so it is the marked hit; the chosen type is no longer offered.
    expect(await names(asked)).toEqual([
      "Take 1 type",
      ...TYPES.filter((name) => !name.startsWith("Decision")),
    ]);
    await choose(asked, "System Requirement");
    expect(await marks(asked)).toEqual(["type: decision, requirement"]);
    expect((await names(asked))[0]).toBe("Take 2 types");
    expect(await names(asked)).not.toContain("System Requirement | requirement");
    await choose(asked, "Take 2 types");
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual(["type: decision, requirement"]);
    // The other marks still all hold: the statuses are those of the elements of one of the types.
    await choose(asked, "Status");
    expect(call).toHaveBeenCalledWith("element.facets", {
      selection: { where: { all: [{ type: ["decision", "requirement"] }] } },
    });
    await choose(asked, "Draft");
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ type: ["decision", "requirement"] }, { status: ["draft"] }] },
    });
  });

  it("[SR-215/AK-w8q6] a condition has one type mark: choosing Type again continues it in its place, without the types in it", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Type", "Decision", "Take 1 type");
    await choose(asked, "Status", "Draft");
    await choose(asked, "Type");
    expect(await marks(asked)).toEqual(["type: decision", "status: draft"]);
    expect(await names(asked)).toEqual([
      "Take 1 type",
      ...TYPES.filter((name) => !name.startsWith("Decision")),
    ]);
    await choose(asked, "Package");
    expect(await marks(asked)).toEqual(["type: decision, package", "status: draft"]);
    await choose(asked, "Take 2 types");
    expect(await marks(asked)).toEqual(["type: decision, package", "status: draft"]);
  });

  it("[SR-215/AK-w8q6] Escape and Backspace on an empty input go back to the kinds and the mark stays; its × removes it", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Status", "Draft");
    await choose(asked, "Type", "Decision");
    const types = await last(asked);
    // Backspace on an empty input does what Escape does here (`back`): it removes no mark.
    expect(types.unmark).toBeUndefined();
    types.back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual(["status: draft", "type: decision"]);
    // Back in the step, the × of the type mark removes it, and the step is asked again without it.
    await choose(asked, "Type");
    (await last(asked)).marks?.[1]?.remove();
    expect((await last(asked)).label).toBe("New saved filter open · where · Type:");
    expect(await marks(asked)).toEqual(["status: draft"]);
    expect(await names(asked)).toEqual(TYPES);
    // The × of another mark keeps the type mark.
    await choose(asked, "Package");
    (await last(asked)).marks?.[0]?.remove();
    expect(await marks(asked)).toEqual(["type: package"]);
    expect((await names(asked))[0]).toBe("Take 1 type");
    // Without a type, Escape goes back to the kinds with no type mark.
    (await last(asked)).marks?.[0]?.remove();
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual([]);
  });

  it("[SR-210/AK-t8sc] each step of a condition names the argument and the keys of the step: Enter, Backspace for the last mark where it removes one, and { for JSON", async () => {
    const { asked } = await atWhere();
    const first = (await last(asked)).explain;
    expect(first).toMatchObject({
      name: "where",
      description: (command("filter.save").input as { properties: Record<string, { description?: unknown }> })
        .properties["where"]?.description,
      building: { enter: "takes the marked hit; all conditions must hold", unmark: false, json: true },
    });
    await choose(asked, "Status");
    expect((await last(asked)).explain).toMatchObject({
      name: "where",
      more: false,
      building: { enter: "adds the condition", unmark: false, json: false },
    });
    await choose(asked, "Draft");
    expect((await last(asked)).explain?.building?.unmark).toBe(true);
    await choose(asked, "Type");
    expect((await last(asked)).explain).toMatchObject({
      name: "where",
      more: false,
      building: { enter: "adds the type to the mark, or takes the mark", unmark: false, json: false },
    });
    (await last(asked)).back?.();
    await choose(asked, "Text search");
    expect((await last(asked)).explain?.building?.enter).toBe("adds the text search");
  });

  it("says why the values of a kind cannot be read", async () => {
    const failing = new Error("The metamodel is faulty");
    const { asked } = await atWhere({
      "metamodel.get": () => failing,
      "element.facets": () => failing,
    });
    for (const kind of ["Type", "Status", "Property", "Validity", "Relation"]) {
      await choose(asked, kind);
      expect((await last(asked)).label).toBe(
        `The metamodel is faulty · New saved filter open · where · ${kind}:`,
      );
      (await last(asked)).back?.();
    }
    // Statuses need the names of the metamodel too.
    const named = await atWhere({ "metamodel.get": () => failing });
    await choose(named.asked, "Status");
    expect((await last(named.asked)).label).toBe(
      "The metamodel is faulty · New saved filter open · where · Status:",
    );
  });
});

describe("a sort built step by step from hits (SR-215 AK4, AK7, AK9, AK10, #1646)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => ({ total: 0, types: [], statuses: [], properties: [] }),
    "element.list": () => ({ elements: [], total: 0 }),
    "filter.list": () => ({ filters: [] }),
    "filter.save": () => ({ files: ["filters/open.yaml"] }),
  };

  /** "New saved filter open" with no condition, asked up to its sort, the last step. */
  const atSort = async (extra: Record<string, (input: Record<string, unknown>) => Answer> = {}) => {
    const run = setup([shown], { ...answers, ...extra });
    startBuilder(run.context, "filter.save", CATALOG);
    (await last(run.asked)).text?.("open");
    item((await last(run.asked)).items, "No condition: all elements").run();
    return run;
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map(
      (choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`,
    );

  const marks = async (asked: readonly Prompt[]): Promise<string[]> =>
    ((await last(asked)).marks ?? []).map((mark) => mark.label);

  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  /** The keys: the `by` enum by name, then the properties that hold no relations and no fixed key names. */
  const KEYS = [
    "ID | identifier",
    "Short ID | id",
    "Title | title",
    "Type | type",
    "Status | status",
    "Rationale | rationale",
    "Component | component",
    "Severity | severity",
  ];

  const LINE = "New saved filter open · sort";

  it("[SR-215/AK-q4fs] [SR-215/AK-hnzf] a key asks Order and is a mark with its direction; the keys sort in their order, a key chosen again replaces its mark", async () => {
    const { asked, call } = await atSort();
    expect((await last(asked)).label).toBe(`${LINE}:`);
    expect(await names(asked)).toEqual(["Save", "Hierarchy (tree) | hierarchy", ...KEYS, "Workspace order"]);
    await choose(asked, "Title");
    const order = await last(asked);
    expect(order.label).toBe(`${LINE} · Title · Order:`);
    expect(await names(asked)).toEqual(["ascending | asc", "descending | desc"]);
    await choose(asked, "descending");
    expect(await marks(asked)).toEqual(["Title descending"]);
    // With a mark the hierarchy is gone; the other hits keep their place.
    expect(await names(asked)).toEqual(["Save", ...KEYS, "Workspace order"]);
    await choose(asked, "Component", "ascending");
    await choose(asked, "ID", "descending");
    // The same key again replaces its mark in its place.
    await choose(asked, "Title", "ascending");
    expect(await marks(asked)).toEqual(["Title ascending", "Component ascending", "ID descending"]);
    await choose(asked, "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [] },
      sort: [
        { by: "title", order: "asc" },
        { by: "component", order: "asc" },
        { by: "identifier", order: "desc" },
      ],
    });
  });

  it("[SR-215/AK-q4fs] [SR-215/AK-hnzf] [SR-219/AK-tbwz] the hierarchy only comes first and sorts ascending; Workspace order is a mark of the empty sort in place of the keys", async () => {
    const tree = await atSort();
    await choose(tree.asked, "Hierarchy (tree)");
    expect(await marks(tree.asked)).toEqual(["Hierarchy (tree)"]);
    expect(await names(tree.asked)).not.toContain("Hierarchy (tree) | hierarchy");
    await choose(tree.asked, "Short ID", "descending", "Save");
    expect(tree.call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [] },
      sort: [
        { by: "hierarchy", order: "asc" },
        { by: "id", order: "desc" },
      ],
    });
    // Workspace order sets a mark and stays in the step; a key takes its place, and it takes theirs.
    const none = await atSort();
    await choose(none.asked, "Title", "ascending", "Workspace order");
    expect((await last(none.asked)).label).toBe(`${LINE}:`);
    expect(await marks(none.asked)).toEqual(["Workspace order"]);
    await choose(none.asked, "Status", "descending");
    expect(await marks(none.asked)).toEqual(["Status descending"]);
    await choose(none.asked, "Workspace order", "Save");
    expect(none.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] }, sort: [] });
  });

  it("[SR-215/AK-fm4s] [SR-219/AK-kv63] Save is marked first: without a mark a saved filter saves no sort, with marks their keys; Ctrl/Cmd+Enter offers the optional arguments, Save first", async () => {
    const none = await atSort();
    expect((await last(none.asked)).items[0]?.name).toBe("Save");
    await choose(none.asked, "Save");
    expect(none.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    const skipped = await atSort();
    item((await last(skipped.asked)).items, "Save").more?.();
    const more = await last(skipped.asked);
    expect(more.label).toBe("New saved filter open · more arguments:");
    expect(more.items.map((choice) => choice.name)).toEqual(["Save", "description", "view"]);
    await choose(skipped.asked, "Save");
    expect(skipped.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    // Ctrl/Cmd+Enter on a key without a mark takes no empty sort either.
    const key = await atSort();
    item((await last(key.asked)).items, "Title").more?.();
    await choose(key.asked, "Save");
    expect(key.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    const some = await atSort();
    await choose(some.asked, "Type", "ascending");
    expect((await last(some.asked)).items[0]?.name).toBe("Save");
    // Ctrl/Cmd+Enter on any hit of this step takes the marks.
    item((await last(some.asked)).items, "Status").more?.();
    await choose(some.asked, "Save");
    expect(some.call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [] },
      sort: [{ by: "type", order: "asc" }],
    });
  });

  it("[SR-215/AK-fm4s] outside a builder the finishing hit skips the sort without a mark and takes the marks with one; Workspace order takes the empty sort at once", async () => {
    const listed: CommandListing = { ...command("element.list"), title: "Ask it" };
    const atListSort = async () => {
      const run = setup([shown], answers);
      catalogItems(run.context, [listed], [])[0]?.more?.();
      await choose(run.asked, "sort");
      return run;
    };
    const none = await atListSort();
    expect((await names(none.asked))[0]).toBe("No sort");
    await choose(none.asked, "No sort", "Run");
    expect(none.call).toHaveBeenLastCalledWith("element.list", {});
    const some = await atListSort();
    await choose(some.asked, "Title", "ascending");
    expect((await names(some.asked))[0]).toBe("Take 1 sort key");
    await choose(some.asked, "Take 1 sort key", "Run");
    expect(some.call).toHaveBeenLastCalledWith("element.list", { sort: [{ by: "title", order: "asc" }] });
    const workspace = await atListSort();
    await choose(workspace.asked, "Workspace order", "Run");
    expect(workspace.call).toHaveBeenLastCalledWith("element.list", { sort: [] });
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] an × removes its mark; Backspace removes the last mark only where the key is chosen; Escape keeps the marks, which stand again when the prompt returns to the sort", async () => {
    const { asked } = await atSort();
    await choose(asked, "Title", "ascending");
    await choose(asked, "Status", "descending");
    await choose(asked, "ID", "ascending");
    const keys = await last(asked);
    expect(keys.unmark).toBe(true);
    keys.marks?.[1]?.remove();
    expect(await marks(asked)).toEqual(["Title ascending", "ID ascending"]);
    // In "Order" Backspace and Escape go back to the keys with the marks; its × removes one and asks it again.
    await choose(asked, "Type");
    const order = await last(asked);
    expect(order.unmark).toBeUndefined();
    order.marks?.[0]?.remove();
    expect((await last(asked)).label).toBe(`${LINE} · Type · Order:`);
    expect(await marks(asked)).toEqual(["ID ascending"]);
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe(`${LINE}:`);
    expect(await marks(asked)).toEqual(["ID ascending"]);
    // Escape at the keys goes back a step and keeps the marks: they stand again at the sort.
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    await choose(asked, "No condition: all elements");
    expect(await marks(asked)).toEqual(["ID ascending"]);
    // Taken with Ctrl/Cmd+Enter, then asked again by going back from the optional arguments: the marks stand again.
    item((await last(asked)).items, "Save").more?.();
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe(`${LINE}:`);
    expect(await marks(asked)).toEqual(["ID ascending"]);
  });

  it("[SR-215/AK-rx2z] a sort core refuses is asked again with its message and the marks back", async () => {
    const refusal = refusedWith("sort[0].by: no such property", { errors: [{ field: "sort[0].by" }] });
    const { asked } = await atSort({ "filter.save": () => refusal });
    await choose(asked, "Rationale", "ascending", "Save");
    expect((await last(asked)).label).toBe(`sort[0].by: no such property · ${LINE}:`);
    expect(await marks(asked)).toEqual(["Rationale ascending"]);
    // The message is said once.
    await choose(asked, "Title");
    expect((await last(asked)).label).toBe(`${LINE} · Title · Order:`);
  });

  it("[SR-210/AK-t8sc] each step of a sort names the argument and the keys of the step: Enter, and Backspace for the last mark where it removes one", async () => {
    const { asked } = await atSort();
    expect((await last(asked)).explain).toMatchObject({
      name: "sort",
      description: (command("filter.save").input as { properties: Record<string, { description?: unknown }> })
        .properties["sort"]?.description,
      building: {
        enter: "takes the marked hit; Save saves with the keys in their order",
        unmark: false,
        json: false,
      },
    });
    await choose(asked, "Title");
    expect((await last(asked)).explain).toMatchObject({
      name: "sort",
      more: false,
      building: { enter: "adds the sort key", unmark: false, json: false },
    });
    await choose(asked, "ascending");
    expect((await last(asked)).explain?.building?.unmark).toBe(true);
  });

  it("reads the keys once for the argument, not again in each step", async () => {
    const { asked, call } = await atSort();
    const before = call.mock.calls.filter(([name]) => name === "metamodel.get").length;
    await choose(asked, "Title", "ascending");
    (await last(asked)).marks?.[0]?.remove();
    expect(await names(asked)).toContain("Title | title");
    expect(call.mock.calls.filter(([name]) => name === "metamodel.get")).toHaveLength(before);
  });

  it("offers the fixed keys and says why when the metamodel cannot be read", async () => {
    const { asked } = await atSort({ "metamodel.get": () => new Error("The metamodel is faulty") });
    expect((await last(asked)).label).toBe(`The metamodel is faulty · ${LINE}:`);
    expect(await names(asked)).toEqual([
      "Save",
      "Hierarchy (tree) | hierarchy",
      ...KEYS.slice(0, 5),
      "Workspace order",
    ]);
  });
});

describe("a grouping chosen from hits (SR-215 AK1, #1647)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const FACETS = {
    total: 3,
    types: [],
    statuses: [{ key: "draft", count: 2 }],
    properties: [
      {
        key: "component",
        name: "Component",
        kind: "choice",
        count: 2,
        missing: 1,
        distinct: 1,
        values: [{ value: "display", name: "Display", count: 2 }],
      },
      {
        key: "packages",
        name: "Packages",
        kind: "relation",
        count: 1,
        missing: 2,
        distinct: 1,
        values: [{ value: "PKG-1", count: 1 }],
      },
      { key: "rationale", name: "Rationale", kind: "text", count: 3, missing: 0, distinct: 3 },
    ],
  };
  const PERSPECTIVE = { name: "Mine", file: "perspectives/mine.yaml", where: { status: ["draft"] } };
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => FACETS,
    "element.list": () => ({ elements: [], total: 0 }),
    "filter.list": () => ({ filters: [{ name: "open needs", file: "f.yaml", where: {} }], problems: [] }),
    "perspective.list": () => ({
      perspectives: [PERSPECTIVE, { ...PERSPECTIVE, name: "Other", filter: "x" }],
    }),
    "perspective.save": () => ({ files: ["perspectives/rain.yaml"] }),
  };

  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map(
      (choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`,
    );

  const facetCalls = (call: ReturnType<typeof setup>["call"]): unknown[] =>
    call.mock.calls.filter(([name]) => name === "element.facets").map(([, input]) => input);

  /** "New perspective rain" with the condition type Decision, asked up to its grouping, `filter` given before. */
  const atGroup = async (
    extra: Record<string, (input: Record<string, unknown>) => Answer> = {},
    filter = false,
    beforeGroup = (): void => undefined,
  ) => {
    const run = setup([shown], { ...answers, ...extra });
    startBuilder(run.context, "perspective.save", CATALOG);
    (await last(run.asked)).text?.("rain");
    await choose(run.asked, "Type", "Decision", "Take 1 type");
    const before = facetCalls(run.call).length;
    beforeGroup();
    if (filter) {
      item((await last(run.asked)).items, "Next: grouping").more?.();
      await choose(run.asked, "filter", "open needs");
    } else {
      await choose(run.asked, "Next: grouping");
    }
    return { ...run, before };
  };

  const KEYS = ["Type | type", "Status | status", "Package | package", "Component | component"];

  it("[SR-215/AK-fj75] offers type, status, package and the properties with values of the elements where and filter select, by name with the key beside, from one element.facets", async () => {
    const { asked, call, before } = await atGroup({}, true);
    expect((await last(asked)).label).toBe("New perspective rain open needs · group:");
    // "No grouping" first (SR-219 AK2); not the property of the packages, which "Package" groups by, nor free text.
    expect(await names(asked)).toEqual(["No grouping", ...KEYS]);
    const facets = facetCalls(call).slice(before);
    expect(facets).toHaveLength(1);
    await choose(asked, "Component", "Save");
    const [name, saved] = call.mock.calls.filter(([called]) => called === "perspective.save").at(-1) ?? [];
    expect(name).toBe("perspective.save");
    expect(saved).toMatchObject({ name: "rain", filter: "open needs", group: "component" });
    expect(facets[0]).toEqual({ selection: { where: saved?.["where"], filter: "open needs" } });
  });

  it("[SR-215/AK-fj75] after a refused where the grouping is offered again for the new condition, and the other answers stand", async () => {
    const refusal = refusedWith("where: unknown type", { errors: [{ field: "where" }] });
    const { asked, call } = await atGroup({ "perspective.save": () => refusal }, true);
    await choose(asked, "Status", "Save");
    expect(call).toHaveBeenLastCalledWith("perspective.save", expect.objectContaining({ group: "status" }));
    expect((await last(asked)).label).toBe("where: unknown type · New perspective rain open needs · where:");
    const before = facetCalls(call).length;
    await choose(asked, "Next: grouping");
    expect((await last(asked)).label).toBe("New perspective rain open needs · group:");
    expect(facetCalls(call)).toHaveLength(before + 1);
    await choose(asked, "Status", "Save");
    expect(call).toHaveBeenLastCalledWith(
      "perspective.save",
      expect.objectContaining({ filter: "open needs", group: "status" }),
    );
  });

  it("[SR-215/AK-fj75] of a list command, the groupings of the shown selection and the perspective's, whose saved filter counts where the list has none", async () => {
    const list = filteredList([savedStep("Sensors"), typeStep("need")]);
    const listed: CommandListing = { ...command("element.list"), title: "Ask it" };
    const ofList = async (buffers: Buffers, perspective: string) => {
      const run = setup(buffers, answers);
      catalogItems(run.context, [listed], [])[0]?.more?.();
      await choose(run.asked, "perspective");
      item((await last(run.asked)).items, perspective).more?.();
      await choose(run.asked, "group");
      return facetCalls(run.call).at(-1);
    };
    expect(await ofList([list], "Other")).toEqual({
      selection: { filter: "Sensors", where: { all: [list.selection?.where, PERSPECTIVE.where] } },
    });
    expect(await ofList([shown], "Other")).toEqual({ selection: { where: PERSPECTIVE.where, filter: "x" } });
    // Without a selection: every element.
    const bare = setup([shown], answers);
    catalogItems(bare.context, [listed], [])[0]?.more?.();
    await choose(bare.asked, "group");
    expect(facetCalls(bare.call).at(-1)).toEqual({});
    // Outside a builder there is no "No grouping".
    expect(await names(bare.asked)).toEqual(KEYS);
  });

  it("says why when the perspective or the facets cannot be read, and offers no Package without a property of the packages", async () => {
    const listed: CommandListing = { ...command("element.list"), title: "Ask it" };
    let faultyFiles = false;
    const run = setup([shown], {
      ...answers,
      "perspective.list": () =>
        faultyFiles ? new Error("The perspectives are faulty") : answers["perspective.list"](),
    });
    catalogItems(run.context, [listed], [])[0]?.more?.();
    await choose(run.asked, "perspective");
    item((await last(run.asked)).items, "Mine").more?.();
    faultyFiles = true;
    await choose(run.asked, "group");
    expect((await last(run.asked)).label).toBe("The perspectives are faulty · Ask it Mine · group:");

    const faulty = await atGroup({ "element.facets": () => new Error("The facets failed") });
    expect((await last(faulty.asked)).label).toBe("The facets failed · New perspective rain · group:");
    // The builder goes on without them.
    expect(await names(faulty.asked)).toEqual(["No grouping"]);
    let broken = false;
    const bare = await atGroup(
      { "metamodel.get": () => (broken ? new Error("faulty") : FIXTURE_METAMODEL) },
      false,
      () => {
        broken = true;
      },
    );
    expect(await names(bare.asked)).toEqual([
      "No grouping",
      "Type | type",
      "Status | status",
      "Component | component",
      "Packages | packages",
    ]);
  });
});

describe("no argument with fixed values asked as free text or JSON (SR-215 AK2, #1649)", () => {
  type Source = CommandListing["arguments"][number]["complete"];
  /**
   * How the prompt asks each source: hits of AK1, built from hits by AK3/AK6, AK7 or AK8, typed with path
   * completion (SR-143), or free input, which AK2 allows only for the classes below and the numbers.
   */
  const ASKED: Readonly<Record<Source, "hits" | "built" | "path" | "text" | "number" | "json" | "never">> = {
    element: "hits",
    type: "hits",
    status: "hits",
    invalidStatus: "hits",
    relationKind: "hits",
    relationTarget: "hits",
    relation: "hits",
    property: "hits",
    value: "hits",
    hint: "hits",
    filter: "hits",
    baseline: "hits",
    perspective: "hits",
    view: "hits",
    repository: "hits",
    choice: "hits",
    boolean: "hits",
    criterion: "hits",
    evidenceLocation: "hits",
    elementFile: "hits",
    metamodelLocation: "hits",
    group: "hits",
    searchField: "hits",
    condition: "built",
    sort: "built",
    properties: "built",
    relations: "built",
    folder: "path",
    file: "path",
    text: "text",
    number: "number",
    json: "json",
    selection: "never",
  };
  /** The free text AK2 allows: names, titles, texts, descriptions, points in time, versions, Git revisions, search queries, paths and values another command gives. */
  const CLASSES: readonly string[] = [
    "name",
    "title",
    "text",
    "description",
    "time",
    "version",
    "revision",
    "query",
    "path",
    "output",
  ];
  /**
   * The arguments asked as JSON: the mapping of "Save ReqIF mapping", and the fixed values and the
   * maximum entries (a number or empty) of a property until the prompt builds them (SR-236 AK11, #1954).
   */
  const AS_JSON = [
    "reqif.saveMapping mapping",
    "metamodel.changeProperty maxItems",
    "metamodel.changeProperty addChoices",
    "metamodel.changeProperty changeChoices",
    "metamodel.addProperty choices",
  ];

  /** The commands the prompt offers by their own entry (not those an action covers), with a list shown. */
  const prompted = (catalog: readonly CommandListing[]): CommandListing[] => {
    const { context } = setup([listBuffer("type: need", { where: { type: ["need"] } })]);
    const ids = new Set(catalogItems(context, catalog, ACTIONS).map((item) => item.id));
    return catalog.filter((command) => ids.has(`command:${command.name}`));
  };
  /** Every argument the prompt asks that AK2 does not allow, as `<command> <field>`. */
  const outside = (catalog: readonly CommandListing[]): string[] =>
    prompted(catalog).flatMap((command) =>
      askable(command).flatMap((arg) => {
        const asked = ASKED[arg.complete];
        const allowed =
          asked === "text"
            ? arg.class !== undefined && CLASSES.includes(arg.class)
            : asked !== "json" || AS_JSON.includes(`${command.name} ${arg.field}`);
        return allowed ? [] : [`${command.name} ${arg.field}`];
      }),
    );

  it("[SR-215/AK-qpq7] asks as free text only the classes of AK2 and numbers, and as JSON only the ReqIF mapping (and the property fields until #1954)", () => {
    const commands = prompted(CATALOG);
    // Each exception is still asked as JSON, so it goes once the prompt builds the value (#1954).
    expect(
      AS_JSON.filter(
        (entry) =>
          !commands.some((command) =>
            askable(command).some(
              (arg) => `${command.name} ${arg.field}` === entry && ASKED[arg.complete] === "json",
            ),
          ),
      ),
    ).toEqual([]);
    const free = commands.flatMap((command) =>
      command.arguments
        .filter((arg) => arg.complete === "text")
        .map((arg) => `${command.name} ${arg.field}: ${arg.class ?? "none"}`),
    );
    expect(outside(CATALOG)).toEqual([]);
    // The cases whose class was not obvious (#1649).
    expect(free).toEqual(
      expect.arrayContaining([
        "evidence.enrichJunit namePattern: query",
        "evidence.record item: name",
        "evidence.record evidence: path",
        "reqif.export profile: name",
      ]),
    );
    // The commands an action covers are not asked, so they are not checked: element.update asks `set` as JSON.
    expect(commands.map((command) => command.name)).not.toContain("element.update");
    // A new argument asked as text without a class, or as JSON, fails.
    const evidenceRecord = CATALOG.find((command) => command.name === "evidence.record");
    const saveMapping = CATALOG.find((command) => command.name === "reqif.saveMapping");
    if (evidenceRecord === undefined || saveMapping === undefined) {
      throw new Error("catalog without evidence.record or reqif.saveMapping");
    }
    const unclassed = {
      ...evidenceRecord,
      arguments: evidenceRecord.arguments.map(({ class: _class, ...arg }) => arg),
    };
    const asJson = {
      ...evidenceRecord,
      arguments: evidenceRecord.arguments.map((arg) =>
        arg.field === "variant" ? { field: arg.field, complete: "json" as const } : arg,
      ),
    };
    expect(outside([unclassed, saveMapping])).toEqual([
      "evidence.record item",
      "evidence.record date",
      "evidence.record evidence",
      "evidence.record testCase",
      "evidence.record reason",
    ]);
    expect(outside([asJson, saveMapping])).toEqual(["evidence.record variant"]);
  });
});
