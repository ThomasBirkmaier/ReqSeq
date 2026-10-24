// Performance suite (ADR-0011, #126): the generated workspace of N-036 with 50,000 elements and
// 200,000 relations. Runs with `pnpm test:perf`, nightly and on pull requests labelled `perf`
// (.github/workflows/perf.yml), never in the required test run. Times are recorded with `measure`
// and reported in verification/performance.md; a time over its threshold does not fail a test, the
// nightly job opens an issue (CI runners are not the reference machine: 4 cores, 16 GB).
// Correctness is asserted as usual. Test names carry no `[SR-xxx/AKn]` tag: the SRs named in a
// basis get their own tests when they are implemented (SR-020 #32, SR-082 #94).
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import {
  createFixtureWorkspace,
  generateLargeWorkspace,
  measure,
  writeLargeWorkspace,
} from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { STANDARD_MODEL_TEXT, findType, metamodelState } from "../../src/metamodel/index.js";
import { shortIdState } from "../../src/model/short-id.js";
import { elementStoreState } from "../../src/model/store.js";
import { supersededTargetFindings } from "../../src/model/superseded.js";
import { currentTarget } from "../../src/model/targets.js";
import { invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import type { VersionValue } from "../../src/version/version.js";
import { computeVersion } from "../../src/version/version.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** Targets whose version core recomputes from their file (every one is compared with the generator). */
const SAMPLE = 500;

/** The standard model as a workspace reads it. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "logreq-workspace.yaml":
        'logreq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
    },
  });
  const workspace = new Workspace(fixture.root);
  try {
    return await workspace.get(metamodelState);
  } finally {
    await workspace.close();
    await fixture.cleanup();
  }
};

/** Core's version (ADR-0005) for the generator, like `elementVersion` does it for a read element. */
const versionOf =
  (metamodel: Metamodel): VersionFunction =>
  ({ type, text, properties }) => {
    const keys = new Set(findType(metamodel, type)?.properties ?? []);
    return computeVersion({
      text,
      properties: properties as Readonly<Record<string, VersionValue>>,
      definitions: metamodel.properties
        .filter((p) => keys.has(p.key))
        .map((p) => ({
          key: p.key,
          kind: p.kind,
          ...(p.content === undefined ? {} : { content: p.content }),
        })),
      files: [],
    });
  };

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

  it("runs workspace.check, finding nothing (SR-020: 60 s)", async () => {
    await workspace.get(elementStoreState);
    const { result: findings } = await measure(
      "workspace.check (every finding state of stage 1)",
      async () => {
        const out = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
        expect(out.ok).toBe(true);
        return out.problems;
      },
      {
        basis: "SR-020 (workspace.check; the store is loaded)",
        thresholdMs: 60_000,
      },
    );
    expect(findings).toEqual([]);
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
});
