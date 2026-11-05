// Performance suite (ADR-0011, #126): the generated workspace of N-036 with 50,000 elements and
// 200,000 relations. Runs with `pnpm test:perf`, nightly and on pull requests labelled `perf`
// (.github/workflows/perf.yml), never in the required test run. Times are recorded with `measure`
// and reported in verification/performance.md. Test names carry no `[SR-xxx/AKn]` tag: these are
// component times inside one process, so a time over its threshold only records (the nightly job
// opens an issue) and does not fail a test. Correctness is asserted as usual. The SRs named in a basis
// have their own tagged tests at their access level, which assert the threshold: SR-020 AK1 spawns
// the CLI (packages/cli/test/perf/workspace-check.test.ts), SR-082 follows with #94.
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@reqseq/testkit";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createFixtureWorkspace,
  generateLargeWorkspace,
  malformedNoParentHints,
  measure,
  measureMedian,
  noParentHints,
  withoutNoParent,
  withoutParent,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { STANDARD_MODEL_TEXT, metamodelState } from "../../src/metamodel/index.js";
import { currentVersionOf, currentVersions } from "../../src/model/current-versions.js";
import { allRelationLimitFindings, relationLimitProblemsState } from "../../src/model/relation-limits.js";
import { shortIdState } from "../../src/model/short-id.js";
import { loadedVersionsOf } from "../../src/model/loaded-versions.test-helper.js";
import { elementStoreState } from "../../src/model/store.js";
import { buildSuccessionIndex, successionsOf } from "../../src/model/successors.js";
import { supersededTargetFindings } from "../../src/model/superseded.js";
import { currentTarget } from "../../src/model/targets.js";
import { REQIF_LIMITS } from "../../src/reqif/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import { readFirst } from "../../src/runtime/read-first.test-helper.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** Targets whose version core recomputes from their file (every one is compared with the generator). */
const SAMPLE = 500;

describe("workspace with 50,000 elements and 200,000 relations (N-036)", () => {
  let version: VersionFunction;
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace;
  let workspace: Workspace;

  beforeAll(async () => {
    version = versionOf(await standardModel());
    const options = { version, elements: ELEMENTS, relations: RELATIONS, metamodel: STANDARD_MODEL_TEXT };
    tree = (
      await measure(
        "generate 50,000 elements and 200,000 relations in memory",
        () => generateLargeWorkspace(options),
        {
          basis: "D-055 generator",
        },
      )
    ).result;
    fixture = (
      await measure("write the generated workspace", () => writeLargeWorkspace(tree), {
        basis: "D-055 generator",
      })
    ).result;
    workspace = new Workspace(fixture.workspaceRoot);
  }, 600_000);

  afterAll(async () => {
    await workspace.close();
    await fixture.cleanup();
  });

  it("generates the same tree again from the same seed", () => {
    expect(tree.elements).toHaveLength(ELEMENTS);
    expect(tree.relations).toBe(RELATIONS);
    expect(
      generateLargeWorkspace({
        version,
        elements: ELEMENTS,
        relations: RELATIONS,
        metamodel: STANDARD_MODEL_TEXT,
      }).digest,
    ).toBe(tree.digest);
  }, 300_000);

  it("loads every element cold, without cache (N-036, SR-082 AK2: 30 s)", async () => {
    const { result: store } = await measure(
      "cold load of the element store",
      () => workspace.get(elementStoreState),
      {
        basis: "N-036, SR-082 AK2 (app start without cache; the app adds its own time)",
        thresholdMs: 30_000,
      },
    );
    expect(store.elements).toHaveLength(ELEMENTS);
    expect(store.problems).toEqual([]);
  }, 600_000);

  it("runs workspace.check, finding only the hints of requirements without a parent (SR-020: 60 s)", async () => {
    await workspace.get(elementStoreState);
    const { result: findings } = await measure(
      "workspace.check (every finding state, with the current versions of SR-025)",
      async () => {
        const out = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
        expect(out.ok).toBe(true);
        return out.problems;
      },
      {
        basis: "SR-020, in process (the store is loaded; AK1 is the CLI measurement)",
        thresholdMs: 60_000,
      },
    );
    // The generated requirements that got no derivation are hints (SR-022 AK6, #659); nothing else.
    expect(malformedNoParentHints(findings)).toEqual([]);
    expect(noParentHints(findings)).toHaveLength(withoutParent(tree.files));
    expect(withoutNoParent(findings)).toEqual([]);
  }, 600_000);

  it("computes the current version of every element once per store and carries it over a save (#259)", async () => {
    // The first build on its own, in a workspace of its own: workspace.check above built them in its time.
    const own = new Workspace(fixture.workspaceRoot);
    try {
      await own.get(elementStoreState);
      await measure(
        "current version of every element (first use after the load: every file read again)",
        () => currentVersions(own),
        { basis: "SR-020 (part of workspace.check from SR-025 on; ADR-0008, #259)" },
      );
    } finally {
      await own.close();
    }
    await workspace.get(elementStoreState);
    const { result: versions } = await measure(
      "current version of every element (after workspace.check built them)",
      () => currentVersions(workspace),
      { basis: "SR-020 (ADR-0008, #259: kept with the store)" },
    );
    const generated = new Map(tree.elements.map((e) => [e.id, e.version]));
    expect(versions.byRecord.size).toBe(ELEMENTS);
    expect(
      versions.store.elements.filter((e) => currentVersionOf(versions, e) !== generated.get(e.id)),
    ).toEqual([]);
    // The versions as read (#439) equal those of the files: every generated element has one (no images).
    const loaded = loadedVersionsOf(versions.store);
    expect(loaded.size).toBe(ELEMENTS);
    expect(
      versions.store.elements.filter((e) => loaded.get(e)?.byForm["n1"] !== generated.get(e.id)),
    ).toEqual([]);
    const { result: again } = await measure(
      "current versions on a later use (embedded images checked; the generator embeds none)",
      () => currentVersions(workspace),
      { basis: "SR-020 (ADR-0008, #259: images checked on use)" },
    );
    expect(again).toBe(versions);
    const [first] = versions.store.elements;
    if (first === undefined) {
      throw new Error("the generated store is empty");
    }
    // The hash the save is made on (#269), read before the measurement.
    const input = await readFirst({ ref: first.id, text: "A new text." }, { workspace });
    await measure(
      "save one element with the current versions built (element.update of its text, versions carried)",
      () => invoke("element.update", input, { workspace }),
      { basis: "SR-082 AK3, ADR-0008 (#184, #259: the saved element gets its version again)" },
    );
    const { result: carried } = await measure(
      "current versions right after the save",
      () => currentVersions(workspace),
      { basis: "SR-020 (ADR-0008, #259)" },
    );
    const saved = carried.store.elements.find((e) => e.id === first.id);
    expect(saved).toBeDefined();
    expect(currentVersionOf(carried, saved ?? first)).not.toBe(generated.get(first.id));
    expect(carried.byRecord.size).toBe(ELEMENTS);
  }, 600_000);

  it("finds the hints on the relations to one element (ADR-0008: 200 ms)", async () => {
    const context = {
      store: await workspace.get(elementStoreState),
      metamodel: await workspace.get(metamodelState),
      shortIds: await workspace.get(shortIdState),
    };
    const [target] = context.store.elements;
    expect(target).toBeDefined();
    const { result: findings } = await measure(
      "hints on the relations to one element (as element.supersede and element.setStatus ask)",
      () => Promise.resolve(supersededTargetFindings(context, target === undefined ? [] : [target])),
      { basis: "SR-072 AK2, ADR-0008 (open an element: 200 ms)", thresholdMs: 200 },
    );
    // No generated element has an invalid status.
    expect(findings).toEqual([]);
  }, 600_000);

  it("builds the successions once per store and looks up the successors of a superseded element (ADR-0008: 200 ms)", async () => {
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const { result: index } = await measure(
      "succession index: every relation with the meaning succession, by target (once per store)",
      () => Promise.resolve(buildSuccessionIndex(store, metamodel)),
      { basis: "SR-072 AK3, ADR-0008 (open an element: 200 ms)", thresholdMs: 200 },
    );
    const [first] = store.elements;
    if (first === undefined) {
      throw new Error("the generated store is empty");
    }
    // As if it were superseded: no generated element has an invalid status.
    const superseded = { ...first, data: { ...first.data, status: "obsolete" } };
    const { result: found } = await measure(
      "successors of one superseded element (lookup in the index)",
      () => Promise.resolve(successionsOf(index, metamodel, superseded)),
      { basis: "SR-072 AK3 (a map lookup per view)", thresholdMs: 5 },
    );
    expect(Array.isArray(found)).toBe(true);
  }, 600_000);

  it("stores in every relation the version of its target", async () => {
    const context = {
      layout: await workspace.get(workspaceLayoutState),
      metamodel: await workspace.get(metamodelState),
      store: await workspace.get(elementStoreState),
    };
    const versions = new Map(tree.elements.map((e) => [e.id, e.version]));
    const relationKeys = new Set([
      ...context.metamodel.relations.map((r) => r.key),
      ...context.metamodel.properties.filter((p) => p.kind === "relation").map((p) => p.key),
    ]);
    const stored: {
      readonly repository: string;
      readonly target: { readonly id: string; readonly version: string };
    }[] = [];
    for (const record of context.store.elements) {
      for (const [, value] of Object.entries(record.data).filter(([key]) => relationKeys.has(key))) {
        for (const target of value as readonly { readonly id: string; readonly version: string }[]) {
          stored.push({ repository: record.repository, target });
        }
      }
    }
    expect(stored).toHaveLength(RELATIONS);
    expect(stored.filter(({ target }) => versions.get(target.id) !== target.version)).toEqual([]);
    // Every 400th relation: the target core would store now, from the target's file.
    for (const { repository, target } of stored.filter((_, i) => i % (RELATIONS / SAMPLE) === 0)) {
      expect(await currentTarget(context, repository, target)).toEqual(target);
    }
  }, 600_000);

  it("saves the input of the app as autosave does, on the bytes it read, and reads the element again (SR-105)", async () => {
    const store = await workspace.get(elementStoreState);
    const element = store.elements[1];
    if (element === undefined) {
      throw new Error("the generated store is empty");
    }
    const answer = (await invoke("element.get", { ref: element.id }, { workspace })) as {
      fileSha256: string;
    };
    let sha = answer.fileSha256;
    let count = 0;
    // One autosave: one element.update of the text with the bytes of the last answer as precondition.
    const { times } = await measureMedian(
      "autosave: element.update of the text with expectedFileSha256 (median of 21)",
      async () => {
        count += 1;
        const saved = (await invoke(
          "element.update",
          { ref: element.id, text: `Autosave ${String(count)}.`, expectedFileSha256: sha },
          { workspace },
        )) as { fileSha256: string };
        sha = saved.fileSha256;
        return saved;
      },
      { basis: "SR-105 AK1 (one write per pause; ADR-0008)", runs: 21 },
    );
    expect(times).toHaveLength(21);
    // The `written` reload of the buffer after each autosave: one element.get.
    const { result: read } = await measureMedian(
      "autosave: element.get of the saved element (the reload `written` brings, median of 21)",
      () => invoke("element.get", { ref: element.id }, { workspace }) as Promise<{ fileSha256: string }>,
      { basis: "SR-105, ADR-0008 (open an element: 200 ms)", thresholdMs: 200, runs: 21 },
    );
    expect(read.fileSha256).toBe(sha);
  }, 600_000);

  it("exports every element to one ReqIF file and imports it into an empty workspace without a mapping (SR-052 AK3)", async () => {
    const empty = await createFixtureWorkspace({
      fixture: "SR-052/empty",
      // The metamodel of the generated workspace, with its identifier property (#305).
      files: {
        "metamodel/standard-model.yaml": tree.files.get("system/metamodel/standard-model.yaml") ?? "",
      },
    });
    const target = new Workspace(empty.root);
    try {
      const output = path.join(empty.root, "in", "large.reqif");
      const { result: exported } = await measure(
        "reqif.export of every element",
        () => invoke("reqif.export", { output }, { workspace }) as Promise<CommandOutput<"reqif.export">>,
        { basis: "SR-052 AK1, N-036" },
      );
      expect(exported.elements).toBe(ELEMENTS);
      // The parser reads what the export writes at this size (ADR-0013 "Size").
      expect((await fs.stat(output)).size).toBeLessThan(REQIF_LIMITS.bytes);
      const { result: imported } = await measure(
        "reqif.import of that file into an empty workspace, one to one",
        () =>
          invoke(
            "reqif.import",
            { file: "in/large.reqif", delivery: "perf" },
            { workspace: target },
          ) as Promise<CommandOutput<"reqif.import">>,
        { basis: "SR-052 AK3, N-036" },
      );
      expect(imported.created).toHaveLength(ELEMENTS);
      expect(imported.problems ?? []).toEqual([]);
    } finally {
      await target.close();
      await empty.cleanup();
    }
  }, 1_200_000);

  // Last: it changes the metamodel of the generated workspace and puts it back afterwards.
  it("counts the relations of every element against limits and carries the hints over a save (SR-152)", async () => {
    const file = fixture.path("system/metamodel/standard-model.yaml");
    const model = await fs.readFile(file, "utf8");
    const kind = "    target-types: [need, use-case, system-requirement]\n    meaning: derivation\n";
    expect(model).toContain(kind);
    await fs.writeFile(
      file,
      model.replace(
        kind,
        `${kind}    limits:\n      - { target-type: use-case, max: 1 }\n      - { target-type: need, min: 1 }\n`,
      ),
    );
    const limited = new Workspace(fixture.workspaceRoot);
    try {
      expect((await limited.get(metamodelState)).valid).toBe(true);
      const context = {
        layout: await limited.get(workspaceLayoutState),
        store: await limited.get(elementStoreState),
        metamodel: await limited.get(metamodelState),
        shortIds: await limited.get(shortIdState),
      };
      const { result: counted } = await measure(
        "relation limits of every element, counted in memory without lines",
        () => Promise.resolve(allRelationLimitFindings(context)),
        { basis: "SR-152, N-036 (one pass over the items of limited kinds, no file read)" },
      );
      const { result: full } = await measure(
        "relation limits of every element (max 1 use case, min 1 need on derives-from), with lines",
        () => limited.get(relationLimitProblemsState),
        { basis: "SR-152, N-036 (one pass; files with a hint under the key are read for the line)" },
      );
      // Generated requirements derive from requirements, needs or use cases, so many lack a need.
      expect(full.filter((p) => p.code === "relation.too-few").length).toBeGreaterThan(0);
      expect(full).toHaveLength(counted.length);
      // Each hint is a count above its maximum or below its minimum, and nothing else.
      const outside = (p: (typeof full)[number]): boolean =>
        p.code === "relation.too-many"
          ? (p.count ?? 0) > (p.limit ?? 0)
          : p.code === "relation.too-few" && (p.count ?? 0) < (p.limit ?? 0);
      expect(full.filter((p) => !outside(p))).toEqual([]);
      const [first] = (await limited.get(elementStoreState)).elements;
      if (first === undefined) {
        throw new Error("the generated store is empty");
      }
      // Another text than the earlier save of this element, so that the update writes and the store changes.
      const input = await readFirst({ ref: first.id, text: "A text under limits." }, { workspace: limited });
      const updated = (await invoke("element.update", input, {
        workspace: limited,
      })) as CommandOutput<"element.update">;
      expect(updated.files).toHaveLength(1);
      const { result: carried } = await measure(
        "relation limits right after saving one element (carried, #184)",
        () => limited.get(relationLimitProblemsState),
        { basis: "SR-152, ADR-0008 (#184: only the saved file is looked at again)" },
      );
      // A new text changes no relation and no line of the frontmatter.
      expect(carried).toEqual(full);
    } finally {
      await limited.close();
      await fs.writeFile(file, model);
    }
  }, 600_000);
});
