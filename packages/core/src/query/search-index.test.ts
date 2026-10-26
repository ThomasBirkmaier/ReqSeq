import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT } from "../metamodel/standard-model.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { applyStoreChange, elementStoreState, updateElements } from "../model/index.js";
import { setElementStatus } from "../model/status.js";
import { createElement, updateElement } from "../model/write.js";
import { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { SearchElementsOptions, SearchIndex } from "./search-index.js";
import {
  MIN_FUZZY,
  PAUSE_MS,
  SearchBuildCancelled,
  buildSearchIndex,
  documentOf,
  recordKey,
  searchElements,
} from "./search-index.js";
import { searchIndex, searchIndexState } from "./search-state.js";

const V = "n1:1111111111111111";
const N1 = "6adc6d88-2177-457b-959d-545b7b379da2";
const S1 = "0b0e6f6c-3c1f-4c55-9d0e-0c1d2e3f4a5b";
const S2 = "5f1c2a0e-8d4b-4b8e-a6f1-2b3c4d5e6f70";
const U1 = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
/** Ends with the same 6 digits as S1 (`3f4a5b`): a short ID shows more of both (SR-084). */
const TWIN = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3f4a5b";
const DUP = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60";
/** Of a type the metamodel does not know; its text names its own UUID tail. */
const GADGET = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6c";

const WORKSPACE = [
  "logreq-workspace: 1",
  "name: Search",
  "repositories:",
  "  - { name: system, url: git@example.com:system.git, main: true }",
  "  - { name: platform, url: git@example.com:platform.git, path: ../platform }",
  "metamodel: { repository: system, path: metamodel }",
  "",
].join("\n");

const element = (id: string, type: string, frontmatter: readonly string[], text = ""): string =>
  ["---", `id: ${id}`, `type: ${type}`, ...frontmatter, "---", text].join("\n");

const N1_FILE = element(
  N1,
  "need",
  ["status: draft", "title: Wind speed on the display", "rationale: Pilots need it", "topic: Weather"],
  [
    "",
    `The station shall show [the gusts](logreq:${S1}?version=${V}) and ![a chart](images/chart.png "Chart").`,
    "",
  ].join("\n"),
);

const S1_FILE = element(S1, "system-requirement", [
  "status: approved",
  "title: Record the air pressure",
  "requirement-type: performance",
  "acceptance-criteria:",
  "  - Given a storm, when it passes, then the barometer logs it",
  "emergent: 'yes'",
  "verification-method: [test, analysis]",
  `derives-from:\n  - { id: ${N1}, version: ${V}, title: Hidden relation title }`,
  `validity:\n  - { id: ${N1}, version: ${V} }`,
  "limits: { low: 950, high: 1050, nested: { unit: hectopascal, strict: true } }",
  "stamp: !!timestamp 2026-10-26",
  "ordered: !!omap [ { first: alpha }, { second: omega } ]",
  "tags: !!set { calibrated, sealed }",
  "blob: !!binary aGVsbG8=",
  "nothing: null",
]);

const FILES: Readonly<Record<string, string>> = {
  "system/logreq-workspace.yaml": WORKSPACE,
  "system/metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
  "system/needs/N-545b7b379da2.md": N1_FILE,
  "system/requirements/SR-0c1d2e3f4a5b.md": S1_FILE,
  "system/requirements/SR-2b3c4d5e6f70.md": element(
    S2,
    "system-requirement",
    ["status: draft", "title: Store the temperature"],
    // NFD: "Größe" with a combining diaeresis, as a Mac may write it.
    "\nThe Größe of the mast.\n",
  ),
  "system/use-cases/UC-1e0f9a8b7c6d.md": element(
    U1,
    "use-case",
    ["title: Read the temperature"],
    "\nTemperatures and thermometers.\n",
  ),
  "system/requirements/SR-0a1b2c3f4a5b.md": element(TWIN, "system-requirement", ["title: Twin"], ""),
  "system/copies/N-1b2c3d4e5f60.md": element(DUP, "need", ["title: Copied need"], ""),
  "system/misc/G-1c2d3e4f5a6c.md": element(GADGET, "gadget", ["title: Gadget"], "\nSerial 2d3e4f5a6c.\n"),
  "platform/needs/N-1b2c3d4e5f60.md": element(DUP, "need", ["title: Copied need"], ""),
};

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: Readonly<Record<string, string>> = FILES): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const parts = async (
  workspace: Workspace,
): Promise<{ store: ElementStore; layout: WorkspaceLayout; metamodel: Metamodel }> => ({
  store: await workspace.get(elementStoreState),
  layout: await workspace.get(workspaceLayoutState),
  metamodel: await workspace.get(metamodelState),
});

const recordOf = (store: ElementStore, id: string, repository = "system"): ElementRecord => {
  const found = store.elements.find((r) => r.id === id && r.repository === repository);
  if (found === undefined) {
    throw new Error(`no element ${id}`);
  }
  return found;
};

/** The UUIDs of the hits of `query`, best first. */
const ids = (index: SearchIndex, query: string, options?: SearchElementsOptions): string[] =>
  searchElements(index, query, options).hits.map((hit) => hit.element.id);

describe("search index documents (ADR-0008, SR-068)", () => {
  it("indexes the title, the visible text and the values of every property, type and status by name, not relations", async () => {
    const { workspace } = await open();
    const { store, metamodel } = await parts(workspace);
    const n1 = recordOf(store, N1);
    expect(documentOf(n1, N1_FILE.slice(N1_FILE.indexOf("---\n\n") + 4), metamodel)).toEqual({
      key: `system\0${n1.file}`,
      title: "Wind speed on the display",
      // The destinations of links and images are left out; labels, alt texts and titles stay.
      text: '\nThe station shall show [the gusts]() and ![a chart]( "Chart").\n',
      // Type and status by the names the metamodel gives them (#80).
      properties: "Need\nDraft\nPilots need it\nWeather",
    });
    const { properties } = documentOf(recordOf(store, S1), "", metamodel);
    expect(properties.split("\n")).toEqual([
      "System Requirement",
      "Approved",
      // A choice value also by the name of the choice; a list of them too.
      "performance",
      "Performance",
      "Given a storm, when it passes, then the barometer logs it",
      "yes",
      "Yes",
      "test",
      "analysis",
      "Test",
      "Analysis",
      // Nested mappings, numbers and booleans; a date as ISO text; ordered maps and sets.
      "950",
      "1050",
      "hectopascal",
      "true",
      "2026-10-26T00:00:00.000Z",
      "alpha",
      "omega",
      "calibrated",
      "sealed",
    ]);
    // Relation kinds and relation-valued properties (derives-from, validity) are not properties of
    // the search, nor is the UUID; binary data and null have no text.
    expect(properties).not.toMatch(/Hidden|aGVsbG8|hello|null|0b0e6f6c/);
  });

  it("has no title without a property with the meaning title, and no text for an invalid date", () => {
    const record = {
      id: N1,
      type: "need",
      repository: "system",
      file: "n.md",
      data: { id: N1, type: "need", title: "Kept as a property", when: new Date(Number.NaN), title2: ["x"] },
      eol: "\n",
      closingEol: "\n",
      bom: false,
      snapshot: { path: "n.md", size: 0, mtimeMs: 0, sha256: "" },
    } as const satisfies ElementRecord;
    const metamodel = {
      properties: [],
      relations: [],
      meanings: {},
      effectiveTypes: [],
      statuses: [],
    } as unknown as Metamodel;
    // A type and status the metamodel does not define are found by their keys only.
    expect(documentOf({ ...record, data: { ...record.data, status: "gone" } }, "", metamodel)).toEqual({
      key: "system\0n.md",
      title: "",
      text: "",
      properties: "need\nKept as a property\nx\ngone",
    });
  });
});

describe("searchElements (ADR-0008, SR-068)", () => {
  it("finds words of every field in any case and Unicode form, with a typo and as a prefix", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    expect(ids(index, "wind")).toEqual([N1]);
    expect(ids(index, "WIND SPEED")).toEqual([N1]);
    // A value only in a property, a choice by its name, a nested value (SR-068 AK1 at index level).
    expect(ids(index, "barometer")).toEqual([S1]);
    expect(ids(index, "Performance")).toEqual([S1]);
    expect(ids(index, "hectopascal")).toEqual([S1]);
    // The label of a link is text; its destination is not.
    expect(ids(index, "gusts")).toEqual([N1]);
    expect(ids(index, "chart")).toEqual([N1]);
    expect(ids(index, "logreq")).toEqual([]);
    expect(ids(index, "png")).toEqual([]);
    // NFD in the file, NFC and upper case in the query (SR-068 AK2 at index level).
    expect(ids(index, "GRÖSSE")).toEqual([]);
    expect(ids(index, "GRÖßE")).toEqual([S2]);
    // A typo: one edit in a word of at least MIN_FUZZY letters (SR-068 AK2 at index level).
    expect(MIN_FUZZY).toBe(4);
    expect(ids(index, "temprature")).toEqual([U1, S2]);
    expect(ids(index, "presure")).toEqual([S1]);
    expect(ids(index, "temprature", { fuzzy: 0 })).toEqual([]);
    // Never in a word with a digit: 1050 is in S1, 1051 is no typo of it (#80).
    expect(ids(index, "1050")).toEqual([S1]);
    expect(ids(index, "1051")).toEqual([]);
    // A prefix from two letters; a shorter word only as itself.
    expect(ids(index, "baro")).toEqual([S1]);
    expect(ids(index, "baro", { prefix: false })).toEqual([]);
    expect(ids(index, "w")).toEqual([]);
    // The words of a hit and the fields they were found in, in the order of SEARCH_FIELDS.
    expect(searchElements(index, "temperatur").hits).toEqual([
      expect.objectContaining({ element: recordOf(index.store, U1), fields: ["title", "text"] }),
      expect.objectContaining({
        element: recordOf(index.store, S2),
        fields: ["title"],
        terms: ["temperature"],
      }),
    ]);
  });

  it("matches short IDs, tails and beginnings of UUIDs exactly, in any case, never as a typo", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    // A short ID with the 6 digits it shows at least, more, or the 12 of the file name.
    // Equal (no words): store order.
    expect(ids(index, "SR-3f4a5b")).toEqual([TWIN, S1]);
    expect(ids(index, "sr-2E3F4A5B")).toEqual([S1]);
    expect(ids(index, "SR-0c1d2e3f4a5b")).toEqual([S1]);
    expect(ids(index, "SR-9d0e0c1d2e3f4a5b")).toEqual([S1]);
    expect(ids(index, "N-545b7b379da2")).toEqual([N1]);
    // Another type's prefix does not match; neither does a typo or a short ID with 5 digits.
    expect(ids(index, "UC-545b7b379da2")).toEqual([]);
    expect(ids(index, "SR-3f4a5c")).toEqual([]);
    expect(ids(index, "SR-f4a5b")).toEqual([]);
    // A tail or the beginning of a UUID, with or without its dashes; a whole UUID.
    expect(ids(index, "379DA2")).toEqual([N1]);
    expect(ids(index, "6adc6d88-2177")).toEqual([N1]);
    expect(ids(index, "959d545b7b379da2")).toEqual([N1]);
    expect(ids(index, N1)).toEqual([N1]);
    expect(ids(index, "79da2")).toEqual([]);
    // Every file with the UUID is a hit of its own (SR-088).
    expect(
      searchElements(index, DUP).hits.map((hit) => [hit.element.repository, hit.element.file, hit.fields]),
    ).toEqual([
      ["system", "copies/N-1b2c3d4e5f60.md", ["id"]],
      ["platform", "needs/N-1b2c3d4e5f60.md", ["id"]],
    ]);
    // The prefix of an element whose type is unknown (SR-016); a word that is both text and ID.
    expect(ids(index, "UNKNOWN-4f5a6c")).toEqual([GADGET]);
    expect(searchElements(index, "2d3e4f5a6c").hits).toEqual([
      expect.objectContaining({ element: recordOf(index.store, GADGET), fields: ["text", "id"] }),
    ]);
    // Words with and without an ID form, combined: every word, or any.
    expect(ids(index, "wind SR-3f4a5b")).toEqual([]);
    expect(ids(index, "wind SR-3f4a5b", { combineWith: "or" })).toEqual([TWIN, S1, N1]);
    // An ID match comes before words, even with a lower score.
    expect(
      searchElements(index, "SR-3f4a5b twin", { combineWith: "or" }).hits.map((h) => h.element.id),
    ).toEqual([TWIN, S1]);
    expect(searchElements(index, "SR-3f4a5b twin").hits).toEqual([
      expect.objectContaining({
        element: recordOf(index.store, TWIN),
        fields: ["title", "id"],
        terms: ["twin"],
      }),
    ]);
  });

  it("searches only the fields and elements asked for, combines words, and pages hits in a stable order", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    expect(ids(index, "temperature", { fields: ["text"] })).toEqual([U1]);
    expect(ids(index, "temperature", { fields: ["title"] })).toEqual([S2, U1]);
    expect(ids(index, "barometer", { fields: ["title", "text"] })).toEqual([]);
    // Without the ID field an ID is only words; without word fields only IDs count.
    expect(ids(index, "379da2", { fields: ["title", "text", "properties"] })).toEqual([]);
    expect(ids(index, "379da2 wind", { fields: ["id"] })).toEqual([N1]);
    expect(ids(index, "wind", { fields: ["id"] })).toEqual([]);
    // Only elements of a selection (SR-068 AK3 at index level).
    expect(ids(index, "temperature", { within: [recordOf(index.store, U1)] })).toEqual([U1]);
    expect(ids(index, "379da2", { within: [recordOf(index.store, S1)] })).toEqual([]);
    // A selection names records: of two files with one UUID only the one selected (SR-088).
    const platformCopy = { repository: "platform", file: "needs/N-1b2c3d4e5f60.md" };
    expect(
      searchElements(index, "copied", { within: [platformCopy] }).hits.map((h) => h.element.repository),
    ).toEqual(["platform"]);
    expect(searchElements(index, DUP, { within: [platformCopy] }).total).toBe(1);
    // Every word (default), or any word.
    expect(ids(index, "temperature mast")).toEqual([S2]);
    expect(ids(index, "temperature mast", { combineWith: "or" })).toEqual([S2, U1]);
    expect(ids(index, "temperature nowhere")).toEqual([]);
    expect(ids(index, "nowhere temperature", { combineWith: "or" })).toEqual([U1, S2]);
    // A word with a dash or a dot is several words, all of them.
    expect(ids(index, "air-pressure")).toEqual([S1]);
    expect(ids(index, "air-wind")).toEqual([]);
    // Nothing to search: no hits.
    expect(searchElements(index, "")).toEqual({ total: 0, hits: [] });
    expect(searchElements(index, "  --  ")).toEqual({ total: 0, hits: [] });
    // Equal scores keep store order (repositories in workspace order, then paths); pages of it.
    const copied = searchElements(index, "copied");
    expect(copied.hits.map((h) => h.element.repository)).toEqual(["system", "platform"]);
    expect(copied.hits[0]?.score).toBe(copied.hits[1]?.score);
    expect(searchElements(index, "copied", { offset: 1 }).hits.map((h) => h.element.repository)).toEqual([
      "platform",
    ]);
    expect(searchElements(index, "copied", { limit: 1 })).toEqual({ total: 2, hits: [copied.hits[0]] });
  });

  it("reads a file changed since the store read it as it is now, and marks the build inexact", async () => {
    const { fixture, workspace } = await open();
    const { store, layout, metamodel } = await parts(workspace);
    expect((await buildSearchIndex(store, layout, metamodel)).exact).toBe(true);
    // Changed with the same UUID: the element as the file holds it now.
    await fixture.write(
      "system/needs/N-545b7b379da2.md",
      element(N1, "need", ["title: Rain on the display"], "\nDrizzle.\n"),
    );
    // Another UUID, or gone: the record without its text.
    await fixture.write(
      "system/use-cases/UC-1e0f9a8b7c6d.md",
      element(DUP, "use-case", ["title: Other"], "\nX.\n"),
    );
    await fs.rm(fixture.path("system/requirements/SR-2b3c4d5e6f70.md"));
    const built = await buildSearchIndex(store, layout, metamodel);
    expect(built.exact).toBe(false);
    expect(ids(built.index, "drizzle rain")).toEqual([N1]);
    expect(ids(built.index, "wind")).toEqual([]);
    expect(ids(built.index, "read the temperature")).toEqual([U1]);
    expect(ids(built.index, "thermometers")).toEqual([]);
    expect(ids(built.index, "store the temperature")).toEqual([S2]);
    expect(ids(built.index, "mast")).toEqual([]);
    // A record of a repository that is not in the layout has no text either.
    const away = await buildSearchIndex(store, { ...layout, repositories: [] }, metamodel);
    expect(away.exact).toBe(false);
    expect(ids(away.index, "rain")).toEqual([]);
    expect(ids(away.index, "record the air pressure")).toEqual([S1]);
  });

  it("stops a build with SearchBuildCancelled when it is no longer needed, and waits while it is paused", async () => {
    const files: Record<string, string> = { ...FILES };
    for (let n = 0; n < 501; n += 1) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      files[`system/bulk/N-${id.slice(-12)}.md`] = element(id, "need", [`title: Bulk ${String(n)}`]);
    }
    const { workspace } = await open(files);
    const { store, layout, metamodel } = await parts(workspace);
    await expect(buildSearchIndex(store, layout, metamodel, { cancelled: () => true })).rejects.toThrow(
      SearchBuildCancelled,
    );
    await expect(
      buildSearchIndex(store, layout, metamodel, { cancelled: () => false }),
    ).resolves.toMatchObject({ exact: true });
    // Paused at its first turn (after at most 500 files), asked again every PAUSE_MS, until it may go on.
    let asked = 0;
    const started = performance.now();
    const built = await buildSearchIndex(store, layout, metamodel, {
      paused: () => {
        asked += 1;
        return asked <= 3;
      },
    });
    expect(asked).toBeGreaterThanOrEqual(4);
    expect(performance.now() - started).toBeGreaterThanOrEqual(3 * PAUSE_MS - 1);
    expect(built.index.engine.mini.documentCount).toBe(store.elements.length);
  });
});

describe("carried search index (ADR-0008, #184)", () => {
  /** Every word, short ID and UUID tail of the store, to compare two indexes by their answers. */
  const queries = (store: ElementStore): string[] => [
    ...new Set(
      store.elements.flatMap((r) => [
        ...(typeof r.data["title"] === "string" ? r.data["title"] : "").toLowerCase().split(/\W+/u),
        r.id.slice(-6),
        "temprature",
        "the",
        "drizzle",
        "barometer",
      ]),
    ),
  ];

  /** The answers of `index` to every query: files, fields, words and scores (rounded). */
  const answers = (index: SearchIndex): unknown =>
    queries(index.store).map((q) =>
      searchElements(index, q).hits.map((h) => [
        h.element.repository,
        h.element.file,
        h.fields,
        h.terms,
        Math.round(h.score * 1e9),
      ]),
    );

  /** The carried index of the workspace's store, compared with a fresh build and a fresh workspace. */
  const expectCarried = async (
    fixture: FixtureWorkspace,
    workspace: Workspace,
    before: SearchIndex,
  ): Promise<SearchIndex> => {
    const store = await workspace.get(elementStoreState);
    const carried = await searchIndex(workspace);
    expect(carried.store).toBe(store);
    // The same MiniSearch object, changed in place (`carrySearchIndex`).
    expect(carried.engine).toBe(before.engine);
    expect(carried.engine.generation).toBeGreaterThan(0);
    expect([...carried.records.keys()].sort()).toEqual(store.elements.map(recordKey).sort());
    expect(carried.engine.mini.documentCount).toBe(store.elements.length);
    // The replaced documents were removed, not discarded: nothing is left to vacuum.
    expect(carried.engine.mini.dirtCount).toBe(0);
    expect([...(carried.engine.documents?.keys() ?? [])].sort()).toEqual([...carried.records.keys()].sort());
    const { layout, metamodel } = await parts(workspace);
    const built = (await buildSearchIndex(store, layout, metamodel)).index;
    expect(answers(carried)).toEqual(answers(built));
    const fresh = new Workspace(fixture.path("system"));
    onTestFinished(() => fresh.close());
    expect(answers(carried)).toEqual(answers(await searchIndex(fresh)));
    return carried;
  };

  /** Writes and deletes files as the user's editor does and applies them the way the watcher does (SR-007). */
  const external = async (
    fixture: FixtureWorkspace,
    workspace: Workspace,
    files: Readonly<Record<string, string | undefined>>,
  ): Promise<void> => {
    const paths = new Map<string, string[]>();
    for (const [file, text] of Object.entries(files)) {
      if (text === undefined) {
        await fs.rm(fixture.path(file));
      } else {
        await fixture.write(file, text);
      }
      const [repository = "", ...rest] = file.split("/");
      paths.set(repository, [...(paths.get(repository) ?? []), rest.join("/")]);
    }
    const layout = await workspace.get(workspaceLayoutState);
    await applyStoreChange(workspace, (store) =>
      updateElements(
        store,
        layout,
        new Map([...paths].map(([repository, list]) => [repository, { paths: list }])),
      ),
    );
  };

  it("equals a fresh build after element.update, element.create and element.setStatus", async () => {
    const { fixture, workspace } = await open();
    const first = await searchIndex(workspace);
    await updateElement(workspace, { ref: N1, title: "Rain on the display", text: "Drizzle.\n" });
    const updated = await expectCarried(fixture, workspace, first);
    expect(ids(updated, "drizzle")).toEqual([N1]);
    expect(ids(updated, "wind")).toEqual([]);
    // The index of the previous store shares the MiniSearch object, and names only its own records.
    expect(ids(first, "drizzle")).toEqual([N1]);
    expect(searchElements(first, "drizzle").hits[0]?.element).toBe(recordOf(first.store, N1));
    await createElement(workspace, { type: "need", title: "Fresh snow", text: "Powder.\n" });
    const created = await expectCarried(fixture, workspace, first);
    expect(ids(created, "powder")).toHaveLength(1);
    expect(ids(updated, "powder")).toEqual([]);
    await setElementStatus(workspace, { refs: [S2], status: "approved" });
    await expectCarried(fixture, workspace, first);
  });

  it("equals a fresh build after watcher batches that add, change and delete files in several repositories", async () => {
    const { fixture, workspace } = await open();
    const first = await searchIndex(workspace);
    await external(fixture, workspace, {
      "platform/needs/N-000000000010.md": element("00000000-0000-4000-8000-000000000010", "need", [
        "title: Hail at the mast",
      ]),
      "system/a/N-000000000011.md": element("00000000-0000-4000-8000-000000000011", "need", ["title: Sleet"]),
      "system/requirements/SR-2b3c4d5e6f70.md": undefined,
      // A Markdown file that is no element any more.
      "system/use-cases/UC-1e0f9a8b7c6d.md": "---\nauthor: someone\n---\nNotes.\n",
    });
    const batch = await expectCarried(fixture, workspace, first);
    expect(ids(batch, "hail")).toEqual(["00000000-0000-4000-8000-000000000010"]);
    expect(ids(batch, "temperature")).toEqual([]);
    await external(fixture, workspace, {
      "platform/needs/N-000000000010.md": element("00000000-0000-4000-8000-000000000010", "need", [
        "title: Hail",
      ]),
    });
    await expectCarried(fixture, workspace, first);
  });

  /** Needs in `system/bulk/` with `count` words each from `next`, many terms that share prefixes. */
  const bulk = (files: number, count: number, next: () => string): Record<string, string> => {
    const result: Record<string, string> = {};
    for (let n = 0; n < files; n += 1) {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const text = Array.from({ length: count }, next).join(" ");
      result[`system/bulk/N-${id.slice(-12)}.md`] = element(id, "need", [`title: Bulk ${String(n)}`], text);
    }
    return result;
  };

  /** Words of seven letters from a fixed seed. */
  const wordsFrom = (seed: number): (() => string) => {
    let state = seed;
    return () =>
      Array.from({ length: 7 }, () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return String.fromCharCode(97 + (state % 26));
      }).join("");
  };

  it("never vacuums, also when searches run while a carry reads the files (MiniSearch 7.2.0)", async () => {
    // MiniSearch's batched vacuum breaks when a search or an add changes the term tree in one of its
    // pauses; the index never starts one, and a carry removes the old documents exactly.
    const { fixture, workspace } = await open({ ...FILES, ...bulk(600, 30, wordsFrom(1)) });
    const first = await searchIndex(workspace);
    const { mini } = first.engine;
    const vacuum = vi.spyOn(mini, "vacuum");
    const vacuuming: boolean[] = [];
    const progress = { carried: false };
    const carry = external(fixture, workspace, bulk(550, 30, wordsFrom(2)))
      .then(() => searchIndex(workspace))
      .then(() => {
        progress.carried = true;
      });
    // As a user types while a pull is applied: prefix and fuzzy searches between the carry's slices.
    const typed = wordsFrom(3);
    while (!progress.carried) {
      searchElements(first, typed().slice(0, 3));
      searchElements(first, typed());
      vacuuming.push(mini.isVacuuming);
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await carry;
    const after = await expectCarried(fixture, workspace, first);
    expect(vacuum).not.toHaveBeenCalled();
    expect(vacuuming.length).toBeGreaterThan(0);
    expect(vacuuming.every((v) => !v)).toBe(true);
    expect(after.engine.mini.isVacuuming).toBe(false);
  });

  it("stops a carry when its workspace is closed", async () => {
    const { fixture, workspace } = await open();
    await searchIndex(workspace);
    // A command runs, so the carry (which no search waits for) pauses at its first turn.
    let release = (): void => undefined;
    const command = workspace.runCommand(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await external(fixture, workspace, bulk(600, 1, wordsFrom(4)));
    const carrying = workspace.peek(searchIndexState);
    const closing = workspace.close();
    await expect(carrying).rejects.toThrow(SearchBuildCancelled);
    await closing;
    release();
    await command;
  });

  it("is reset with the metamodel, and by a store replaced without an update", async () => {
    const { workspace } = await open();
    const first = await searchIndex(workspace);
    await workspace.reset(metamodelState);
    expect(workspace.peek(searchIndexState)).toBeUndefined();
    const second = await searchIndex(workspace);
    expect(second.engine).not.toBe(first.engine);
    const store = await workspace.get(elementStoreState);
    expect(
      await workspace.replace(elementStoreState, workspace.peek(elementStoreState), Promise.resolve(store)),
    ).toBe(true);
    expect(workspace.peek(searchIndexState)).toBeUndefined();
  });
});
