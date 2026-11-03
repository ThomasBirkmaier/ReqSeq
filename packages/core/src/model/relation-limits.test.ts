import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { RelationLimitContext } from "./relation-limits.js";
import { relationLimitFindings, relationLimitProblemsState } from "./relation-limits.js";
import { shortIdState } from "./short-id.js";
import { applyStoreChange, elementStoreState, updateElements } from "./store.js";

const ID = "15200000-0000-4000-8000-000000";
const NEED = `${ID}a00001`;
const UC1 = `${ID}b00001`;
const DECISION = `${ID}d00001`;
const SR1 = `${ID}c00001`;
const SR2 = `${ID}c00002`;
const SR3 = `${ID}c00003`;
const MODEL = "metamodel/model.yaml";

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-152/limits", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const contextOf = async (workspace: Workspace): Promise<RelationLimitContext> => ({
  layout: await workspace.get(workspaceLayoutState),
  store: await workspace.get(elementStoreState),
  metamodel: await workspace.get(metamodelState),
  shortIds: await workspace.get(shortIdState),
});

const recordOf = (context: RelationLimitContext, id: string): ElementRecord => {
  const [record] = context.store.byId.get(id) ?? [];
  if (record === undefined) {
    throw new Error(`no element ${id}`);
  }
  return record;
};

/** A count hint of the fixture: element `n` of the requirements, its line, count and limit. */
const hint = (
  code: string,
  n: number,
  targetType: string,
  count: number,
  limit: number,
  line?: number,
): Problem => ({
  code: code as Problem["code"],
  severity: "warning",
  message: `System Requirement SR-c0000${String(n)} has ${String(count)} relation${count === 1 ? "" : "s"} Derives from (derives-from) to ${targetType === "need" ? "Need" : "Use Case"} (${targetType}); ${code === "relation.too-many" ? "at most" : "at least"} ${String(limit)}`,
  repository: "system",
  file: `requirements/SR-000000c0000${String(n)}.md`,
  elementId: `${ID}c0000${String(n)}`,
  key: "derives-from",
  targetType,
  count,
  limit,
  ...(line === undefined ? {} : { line }),
});

/** The count hints of the SR `SR1` with other `derives-from` items (or none). */
const countsOf = async (items: unknown, layout?: RelationLimitContext["layout"]): Promise<unknown[]> => {
  const { workspace } = await open({
    "decisions/X-000000e00001.md": `---\nid: ${ID}e00001\ntype: gizmo\ntitle: Unknown type\n---\n`,
  });
  const context = await contextOf(workspace);
  const record = recordOf(context, SR1);
  const element = { ...record, data: { ...record.data, "derives-from": items } };
  return relationLimitFindings(element, { ...context, ...(layout === undefined ? {} : { layout }) }).map(
    (f) => [f.problem.code, f.problem.count],
  );
};

const to = (id: string, extra: Readonly<Record<string, string>> = {}): unknown => ({
  id,
  version: "n1:0000000000000000",
  ...extra,
});

describe("relation limits (SR-152)", () => {
  it("[SR-152/AK1] gives a hint with element, relation kind, target type, count and maximum for more relations than the maximum", async () => {
    const { workspace } = await open();
    const problems = await workspace.get(relationLimitProblemsState);
    expect(problems.filter((p) => p.code === "relation.too-many")).toEqual([
      hint("relation.too-many", 1, "use-case", 2, 1, 6),
    ]);
  });

  it("[SR-152/AK2] gives a hint with element, relation kind, target type, count and minimum for fewer relations than the minimum", async () => {
    const { workspace } = await open();
    const problems = await workspace.get(relationLimitProblemsState);
    // SR-c00002 has no derives-from key: the hint has no line, and its file is not read for it.
    expect(problems.filter((p) => p.code === "relation.too-few")).toEqual([
      hint("relation.too-few", 2, "need", 0, 1),
      hint("relation.too-few", 3, "need", 0, 1, 6),
    ]);
  });

  it("[SR-152/AK4] gives no count hint for a relation kind without limits, with none or many relations", async () => {
    const { fixture, workspace } = await open();
    // SR-c00001 has two based-on relations, SR-c00002 none: based-on has no limit.
    expect((await workspace.get(relationLimitProblemsState)).filter((p) => p.key === "based-on")).toEqual([]);
    const model = await fs.readFile(fixture.path(MODEL), "utf8");
    const { workspace: unlimited } = await open({
      [MODEL]: model.replace(/ {4}limits:\n(?: {6}- .*\n)+/, ""),
    });
    expect(await unlimited.get(relationLimitProblemsState)).toEqual([]);
    // A save is carried without a look at any element.
    await invoke(
      "relation.add",
      { source: SR2, kind: "derives-from", target: UC1 },
      { workspace: unlimited },
    );
    expect(await unlimited.get(relationLimitProblemsState)).toEqual([]);
  });

  it("counts each item whose target is one element of the target type or a subtype, a duplicate twice", async () => {
    expect(await countsOf([to(UC1), to(UC1)])).toEqual([
      ["relation.too-many", 2],
      ["relation.too-few", 0],
    ]);
    // A missing target, one of an unknown type, of another type, no mapping and no list count nothing.
    expect(await countsOf([to(`${ID}f00001`), to(`${ID}e00001`), to(DECISION), "text", to(NEED)])).toEqual(
      [],
    );
    expect(await countsOf("not a list")).toEqual([["relation.too-few", 0]]);
  });

  it("gives no too-few while a target lies in a repository that is not here", async () => {
    expect(await countsOf([to(UC1, { repository: "elsewhere" })])).toEqual([]);
    const layout = {
      repositories: [
        { name: "system", available: true },
        { name: "sensor", available: false },
      ],
    } as unknown as RelationLimitContext["layout"];
    expect(await countsOf([to(UC1, { repository: "sensor" })], layout)).toEqual([]);
  });

  it("gives none to an element of an unknown type, with a status marked invalid, or of a type without limits", async () => {
    const { workspace } = await open();
    const context = await contextOf(workspace);
    const record = recordOf(context, SR2);
    expect(relationLimitFindings({ ...record, type: "gizmo" }, context)).toEqual([]);
    expect(
      relationLimitFindings({ ...record, data: { ...record.data, status: "rejected" } }, context),
    ).toEqual([]);
    expect(relationLimitFindings(recordOf(context, NEED), context)).toEqual([]);
  });

  it("says relation for a count of one", async () => {
    const { fixture } = await open();
    const model = await fs.readFile(fixture.path(MODEL), "utf8");
    const { workspace: strict } = await open({
      [MODEL]: model.replace("target-type: need, min: 1", "target-type: need, min: 2"),
    });
    const findings = (await strict.get(relationLimitProblemsState)).filter((p) => p.elementId === SR1);
    expect(findings.map((p) => p.message)).toContain(
      "System Requirement SR-c00001 has 1 relation Derives from (derives-from) to Need (need); at least 2",
    );
  });

  it("is carried over a save and over a new element, as a fresh build finds it", async () => {
    const { fixture, workspace } = await open();
    await workspace.get(relationLimitProblemsState);
    await invoke("relation.add", { source: SR3, kind: "derives-from", target: NEED }, { workspace });
    expect(workspace.peek(relationLimitProblemsState)).toBeDefined();
    const created = (await invoke(
      "element.create",
      { type: "use-case", title: "Show the wind" },
      { workspace },
    )) as {
      readonly element: { readonly id: string };
    };
    await invoke(
      "relation.add",
      { source: SR1, kind: "derives-from", target: created.element.id },
      { workspace },
    );
    const fresh = new Workspace(fixture.root);
    onTestFinished(() => fresh.close());
    const carried = await workspace.get(relationLimitProblemsState);
    expect(carried).toEqual(await fresh.get(relationLimitProblemsState));
    expect(carried.map((p) => [p.elementId, p.count])).toEqual([
      [SR1, 3],
      [SR2, 0],
    ]);
  });

  it("checks a source whose file is unchanged again when its target changes type on disk", async () => {
    const { fixture, workspace } = await open();
    expect((await workspace.get(relationLimitProblemsState)).map((p) => p.elementId)).toContain(SR1);
    const file = "use-cases/UC-000000b00001.md";
    await fixture.write(
      file,
      (await fs.readFile(fixture.path(file), "utf8")).replace("type: use-case", "type: need"),
    );
    const layout = await workspace.get(workspaceLayoutState);
    const changed = await applyStoreChange(workspace, (store) =>
      updateElements(store, layout, new Map([["system", { paths: [file] }]])),
    );
    expect(changed).toBeDefined();
    expect(workspace.peek(relationLimitProblemsState)).toBeDefined();
    const fresh = new Workspace(fixture.root);
    onTestFinished(() => fresh.close());
    const carried = await workspace.get(relationLimitProblemsState);
    expect(carried).toEqual(await fresh.get(relationLimitProblemsState));
    // SR1 now derives from one use case and two needs: within both limits.
    expect(carried.map((p) => [p.elementId, p.count])).toEqual([
      [SR2, 0],
      [SR3, 0],
    ]);
  });
});
