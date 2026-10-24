// The generated large workspace of the testkit (#126, ADR-0011, D-055) as core reads it: a valid
// workspace of the standard model, and every relation stores the version core computes for its
// target. The perf suite (`pnpm test:perf`) uses the same generator at 50,000 elements.
import type { GeneratedWorkspace, VersionFunction } from "@logreq/testkit";
import { createFixtureWorkspace, generateLargeWorkspace, writeLargeWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { invoke } from "../runtime/invoke.js";
import type { Metamodel } from "../metamodel/index.js";
import { STANDARD_MODEL_TEXT, findType, metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { VersionValue } from "../version/version.js";
import { computeVersion } from "../version/version.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { duplicateIdProblemsState } from "./duplicates.js";
import { relationTypeProblemsState } from "./relation-types.js";
import { requiredProblemsState } from "./required.js";
import { elementStoreState } from "./store.js";
import { currentTarget } from "./targets.js";
import { unknownProblemsState } from "./unknown.js";
import { valueKindProblemsState } from "./values.js";

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The standard model as a workspace reads it. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "logreq-workspace.yaml":
        'logreq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT,
    },
  });
  onTestFinished(() => fixture.cleanup());
  return open(fixture.root).get(metamodelState);
};

/** Core's version (ADR-0005) for the generator, like `elementVersion` does it for a read element. */
const versionOf = (metamodel: Metamodel): VersionFunction => {
  return ({ type, text, properties }) => {
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
};

const generated = async (): Promise<{
  readonly workspace: Workspace;
  readonly generated: GeneratedWorkspace;
}> => {
  const metamodel = await standardModel();
  const ws = await writeLargeWorkspace(
    generateLargeWorkspace({
      version: versionOf(metamodel),
      seed: 126,
      elements: 600,
      relations: 2400,
      metamodel: STANDARD_MODEL_TEXT,
    }),
  );
  onTestFinished(() => ws.cleanup());
  return { workspace: open(ws.workspaceRoot), generated: ws.generated };
};

/**
 * Writing 600 files and reading them, and every target file once more, takes 1.5 to 3 s alone on 4
 * cores; the tests check content, not time, so a bound only a hang reaches (#199).
 */
const TIMEOUT_MS = 30_000;

describe("generated large workspace (#126)", () => {
  it(
    "is a valid workspace of the standard model in four repositories, without any problem",
    async () => {
      const { workspace } = await generated();
      const status = (await invoke("workspace.status", {}, { workspace })) as {
        readonly repositories: readonly { readonly name: string; readonly available: boolean }[];
        readonly problems: readonly unknown[];
        readonly readOnly: boolean;
      };
      expect(status.repositories.map((r) => [r.name, r.available])).toEqual([
        ["system", true],
        ["product", true],
        ["sensor", true],
        ["display", true],
      ]);
      expect(status).toMatchObject({ problems: [], readOnly: false });
      const store = await workspace.get(elementStoreState);
      expect(store.elements).toHaveLength(600);
      expect(store.problems).toEqual([]);
      expect(store.nonElements).toEqual([]);
      for (const state of [
        requiredProblemsState,
        valueKindProblemsState,
        unknownProblemsState,
        relationTypeProblemsState,
        duplicateIdProblemsState,
      ]) {
        expect(await workspace.get(state)).toEqual([]);
      }
    },
    TIMEOUT_MS,
  );

  it(
    "stores in every relation exactly the target core would store now: valid versions (ADR-0005, D-058)",
    async () => {
      const { workspace, generated: tree } = await generated();
      const context = {
        layout: await workspace.get(workspaceLayoutState),
        metamodel: await workspace.get(metamodelState),
        store: await workspace.get(elementStoreState),
      };
      const relationKeys = new Set([
        ...context.metamodel.relations.map((r) => r.key),
        ...context.metamodel.properties.filter((p) => p.kind === "relation").map((p) => p.key),
      ]);
      let relations = 0;
      for (const record of context.store.elements) {
        for (const [, value] of Object.entries(record.data).filter(([k]) => relationKeys.has(k))) {
          for (const target of value as readonly { readonly id: string; readonly repository?: string }[]) {
            relations++;
            expect(target).toEqual(await currentTarget(context, record.repository, target));
          }
        }
      }
      expect(relations).toBe(2400);
      expect(tree.relations).toBe(2400);
    },
    TIMEOUT_MS,
  );
});
