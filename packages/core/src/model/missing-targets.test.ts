import { rm, writeFile } from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { MissingTargetContext } from "./missing-targets.js";
import {
  allMissingTargetFindings,
  missingTargetFindings,
  missingTargetProblemsState,
} from "./missing-targets.js";
import { shortIdState } from "./short-id.js";
import { elementView, titleKeyOf } from "./view.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

const FIXTURE = "SR-089/missing-targets";

const REMOVED = "3b8e1f2a-6c4d-4e7f-9a1b-2c3d4e5f6a7b";
const KEPT = "7d2c9e4f-1a3b-4c5d-8e6f-0a1b2c3d4e5f";
const SR = "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9";
const SENSOR_SR = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const IN_VAULT = "41b29219-7bc1-41c2-96a3-ed3a9c39dbb8";
const REMOVED_FILE = "system/needs/N-2c3d4e5f6a7b.md";
const SR_FILE = "requirements/SR-c4d5e6f7a8b9.md";
const SENSOR_FILE = "anemometer/SR-1e0f9a8b7c6d.md";
const VERSION = "n1:9f86d081884c7d65";

const problem = (
  repository: string,
  file: string,
  line: number,
  elementId: string,
  message: string,
): Problem => ({
  code: "relation.missing-target",
  severity: "error",
  message,
  repository,
  file,
  line,
  elementId,
  targetId: REMOVED,
});

const gone = (relation: string, source: string): string =>
  `${relation} of ${source} points to ${REMOVED}, which is not in repository system`;

/** The findings once the need is removed: SR first (key order, then items), then the sensor's. */
const AFTER_REMOVAL: readonly Problem[] = [
  problem(
    "system",
    SR_FILE,
    6,
    SR,
    gone("Property Parent item (parent-item)", "System Requirement SR-f7a8b9"),
  ),
  problem("system", SR_FILE, 9, SR, gone("Property See also (see-also)", "System Requirement SR-f7a8b9")),
  problem(
    "system",
    SR_FILE,
    12,
    SR,
    gone("Relation Derives from (derives-from)", "System Requirement SR-f7a8b9"),
  ),
  problem(
    "sensor",
    SENSOR_FILE,
    8,
    SENSOR_SR,
    gone("Relation Derives from (derives-from)", "System Requirement SR-8b7c6d"),
  ),
];

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: FIXTURE, files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const contextOf = async (workspace: Workspace): Promise<MissingTargetContext> => ({
  layout: await workspace.get(workspaceLayoutState),
  store: await workspace.get(elementStoreState),
  metamodel: await workspace.get(metamodelState),
  shortIds: await workspace.get(shortIdState),
});

const recordOf = (store: ElementStore, id: string): ElementRecord => {
  const record = store.byId.get(id)?.[0];
  if (record === undefined) {
    throw new Error(`no element ${id}`);
  }
  return record;
};

/** The element `id` with other frontmatter values, without touching its file. */
const withData = (
  store: ElementStore,
  id: string,
  data: Readonly<Record<string, unknown>>,
): ElementRecord => {
  const record = recordOf(store, id);
  return { ...record, data: { ...record.data, ...data } };
};

describe("missing relation targets (SR-089)", () => {
  it("[SR-089/AK1] reports no finding while every target is there", async () => {
    const { workspace } = await open();
    expect(await workspace.get(missingTargetProblemsState)).toEqual([]);
  });

  it("[SR-089/AK1] reports every relation whose target was removed from a repository that is here, with source and target ID", async () => {
    const { fixture, workspace } = await open();
    await rm(fixture.path(REMOVED_FILE));
    expect(await workspace.get(missingTargetProblemsState)).toEqual(AFTER_REMOVAL);
  });

  it("[SR-089/AK1] gives the findings of one element and of all elements without a line, in key and item order", async () => {
    const { fixture, workspace } = await open();
    await rm(fixture.path(REMOVED_FILE));
    const context = await contextOf(workspace);
    const all = allMissingTargetFindings(context);
    expect(all.map((f) => f.problem)).toEqual(AFTER_REMOVAL.map(({ line: _line, ...rest }) => rest));
    expect(all.map((f) => f.path)).toEqual([
      ["parent-item"],
      ["see-also", 1],
      ["derives-from", 1],
      ["derives-from", 1],
    ]);
    expect(all[0]?.target).toEqual({
      id: REMOVED,
      version: VERSION,
      title: "Wind speed visible at a glance",
    });
    const sr = recordOf(context.store, SR);
    expect(missingTargetFindings(sr, context)).toEqual(all.slice(0, 3));
    expect(missingTargetFindings(recordOf(context.store, KEPT), context)).toEqual([]);
  });

  it("[SR-089/AK1] reports a target that names the source's own repository, and one of a source of an unknown type", async () => {
    const { workspace } = await open();
    const context = await contextOf(workspace);
    const missing = { id: REMOVED.replace("3b8e", "4b8e"), version: VERSION };
    const own = withData(context.store, SR, {
      "derives-from": [{ ...missing, repository: "system" }],
      "parent-item": null,
      "see-also": [],
    });
    expect(
      missingTargetFindings(own, context).map((f) => [f.path, f.problem.message, f.problem.targetId]),
    ).toEqual([
      [
        ["derives-from", 0],
        `Relation Derives from (derives-from) of System Requirement SR-f7a8b9 points to ${missing.id}, which is not in repository system`,
        missing.id,
      ],
    ]);
    const unknownType = { ...withData(context.store, SR, { "derives-from": [missing] }), type: "gadget" };
    expect(missingTargetFindings(unknownType, context).map((f) => f.problem.message)).toEqual([
      `Relation Derives from (derives-from) of gadget UNKNOWN-f7a8b9 points to ${missing.id}, which is not in repository system`,
    ]);
  });

  it("[SR-089/AK1] reports every mapping with a missing UUID as id, and leaves other values (SR-085), ambiguous targets (SR-088) and other keys to other checks", async () => {
    const { workspace } = await open();
    const context = await contextOf(workspace);
    const missing = REMOVED.replace("3b8e", "4b8e");
    const odd = withData(context.store, SR, {
      "derives-from": [
        missing,
        { id: missing },
        { id: 7 },
        null,
        [missing],
        { id: "not-a-uuid", version: VERSION },
        { id: missing, version: "bad", note: 1 },
        { id: missing, version: VERSION, repository: "system", title: "Gone" },
      ],
      "based-on": { id: missing, version: VERSION },
      "see-also": { id: missing, version: VERSION },
      "parent-item": [{ id: missing, version: VERSION }],
      title: { id: missing, version: VERSION },
      unknown: [{ id: missing, version: VERSION }],
    });
    const findings = missingTargetFindings(odd, context);
    expect(findings.map((f) => f.path)).toEqual([
      ["derives-from", 1],
      ["derives-from", 6],
      ["derives-from", 7],
    ]);
    expect(findings.map((f) => f.target)).toEqual([
      { id: missing },
      { id: missing, version: "bad", note: 1 },
      { id: missing, version: VERSION, repository: "system", title: "Gone" },
    ]);
    const kept = recordOf(context.store, KEPT);
    const shared: MissingTargetContext = {
      ...context,
      store: {
        ...context.store,
        byId: new Map([...context.store.byId, [KEPT, [kept, { ...kept, file: "needs/copy.md" }]]]),
      },
    };
    expect(missingTargetFindings(recordOf(context.store, SR), shared)).toEqual([]);
  });

  it("[SR-089/AK1] says when the target may be in a file of its repository that cannot be read (SR-008)", async () => {
    const { fixture, workspace } = await open();
    await writeFile(fixture.path(REMOVED_FILE), "---\nid: [unclosed\n---\n");
    const context = await contextOf(workspace);
    expect(context.store.problems.map((p) => [p.repository, p.file])).toContainEqual([
      "system",
      "needs/N-2c3d4e5f6a7b.md",
    ]);
    const note = "; its file may be needs/N-2c3d4e5f6a7b.md, which LogReq cannot read";
    expect((await workspace.get(missingTargetProblemsState)).map((p) => p.message)).toEqual(
      AFTER_REMOVAL.map((p) => `${p.message}${note}`),
    );
    const sr = recordOf(context.store, SR);
    const others: MissingTargetContext = {
      ...context,
      store: {
        ...context.store,
        problems: [
          { code: "file.unreadable", severity: "error", message: "No file" },
          {
            code: "file.invalid-yaml",
            severity: "error",
            message: "Bad",
            repository: "system",
            file: "notes.md",
          },
          {
            code: "file.invalid-yaml",
            severity: "error",
            message: "Bad",
            repository: "sensor",
            file: "needs/N-2c3d4e5f6a7b.md",
          },
        ],
      },
    };
    expect(missingTargetFindings(sr, others).map((f) => f.problem.message.includes("cannot read"))).toEqual([
      false,
      false,
      false,
    ]);
    // A file that was read as an element (here with a new UUID and only a warning) is never named.
    const warned: MissingTargetContext = {
      ...context,
      store: {
        ...context.store,
        elements: [...context.store.elements, { ...sr, file: "needs/N-2c3d4e5f6a7b.md" }],
        problems: [
          {
            code: "file.yaml-warning",
            severity: "warning",
            message: "Tag",
            repository: "system",
            file: "needs/N-2c3d4e5f6a7b.md",
          },
        ],
      },
    };
    expect(missingTargetFindings(sr, warned).map((f) => f.problem.message.includes("cannot read"))).toEqual([
      false,
      false,
      false,
    ]);
    // A skipped file whose extension is in upper case is named all the same.
    const upper: MissingTargetContext = {
      ...context,
      store: {
        ...context.store,
        problems: [
          {
            code: "file.skipped",
            severity: "warning",
            message: "Skipped",
            repository: "system",
            file: "needs/N-2c3d4e5f6a7b.MD",
          },
        ],
      },
    };
    expect(
      missingTargetFindings(sr, upper).map((f) => f.problem.message.includes("N-2c3d4e5f6a7b.MD")),
    ).toEqual([true, true, true]);
  });

  it("checks 50,000 elements with 200,000 relations, 1 % of them missing, in one pass within the time budget (N-036)", async () => {
    const { workspace } = await open();
    const context = await contextOf(workspace);
    const missing = { id: REMOVED.replace("3b8e", "4b8e"), version: VERSION };
    const kept = { id: KEPT, version: VERSION };
    const elements = Array.from({ length: 50_000 }, (_, i) =>
      withData(context.store, SR, {
        "parent-item": null,
        "see-also": [],
        "based-on": [],
        "derives-from": i % 100 === 0 ? [missing, missing, missing, missing] : [kept, kept, kept, kept],
      }),
    );
    const store: ElementStore = { ...context.store, elements };
    const started = performance.now();
    const findings = allMissingTargetFindings({ ...context, store });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(findings).toHaveLength(2000);
  });

  it("[SR-089/AK2] does not report a relation to a target in a repository that is not on this machine", async () => {
    const { fixture, workspace } = await open();
    await rm(fixture.path(REMOVED_FILE));
    const context = await contextOf(workspace);
    expect(context.layout.repositories.find((r) => r.name === "vault")?.available).toBe(false);
    expect(allMissingTargetFindings(context).filter((f) => f.problem.targetId === IN_VAULT)).toEqual([]);
    expect((await workspace.get(missingTargetProblemsState)).map((p) => p.targetId)).not.toContain(IN_VAULT);
    // The element view shows these relations as not accessible (SR-006).
    for (const [repository, id] of [
      ["system", SR],
      ["sensor", SENSOR_SR],
    ] as const) {
      const record = recordOf(context.store, id);
      const read = await readElementFile(fixture.path(repository), record.file);
      if (read.kind !== "parsed") {
        throw new Error(`cannot read ${record.file}`);
      }
      const view = elementView({
        record,
        file: read.file,
        metamodel: context.metamodel,
        store: context.store,
        shortIds: context.shortIds,
        titleKey: titleKeyOf(context.metamodel) ?? "title",
        layout: context.layout,
      });
      expect(
        view.relations.filter((r) => r.id === IN_VAULT).map((r) => [r.targetState, r.accessible]),
      ).toEqual([["inaccessible", false]]);
    }
  });

  it("[SR-089/AK2] does not report a target in a repository the workspace file does not list (spec question #193)", async () => {
    const { workspace } = await open();
    const context = await contextOf(workspace);
    const missing = { id: REMOVED.replace("3b8e", "4b8e"), version: VERSION };
    const elsewhere = withData(context.store, SR, {
      "derives-from": [
        { ...missing, repository: "elsewhere" },
        { ...missing, repository: "vault" },
      ],
    });
    expect(missingTargetFindings(elsewhere, context)).toEqual([]);
  });
});
