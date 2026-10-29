import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { locateFindings } from "./locate.js";
import type { RelationTypeContext } from "./relation-types.js";
import {
  allRelationTypeFindings,
  relationTypeAgain,
  relationTypeFindings,
  relationTypeProblemsState,
} from "./relation-types.js";
import { buildIncomingIndex } from "./incoming.js";
import { buildShortIds, shortIdState } from "./short-id.js";
import type { ElementStore, LoadedStore } from "./store.js";
import { elementStoreState } from "./store.js";

const FIXTURE = "SR-086/relation-types";

const NEED = "22a972fd-f4f1-4b95-ba1d-e3e85234824e";
const SR = "fa1e252c-ae4a-43c5-b53c-c03e4db185f3";
const DECISION = "41b29219-7bc1-41c2-96a3-ed3a9c39dbb8";
const SAFETY = "67719da8-02aa-4c04-9637-4aa95a8571ac";
const NEED_FILE = "needs/N-e3e85234824e.md";
const SAFETY_FILE = "anemometer/SSR-4aa95a8571ac.md";
const TO_NEED = { id: NEED, version: "n1:9f86d081884c7d65" };
const TO_SR = { id: SR, version: "n1:5f3b4a1e0c9d2e71" };
const TO_DECISION = { id: DECISION, version: "n1:2c26b46b68ffc68f" };
/** A target in no repository of the workspace. */
const OTHER = { id: "587fff4b-4dce-4f06-8434-acfd25c193f6", version: "n1:9f86d081884c7d65" };

const NEED_PROBLEM: Problem = {
  code: "relation.not-allowed",
  severity: "warning",
  message:
    "Relation Derives from (derives-from) from Need N-34824e to System Requirement SR-b185f3 is not allowed; allowed: from System Requirement to Need",
  repository: "system",
  file: NEED_FILE,
  line: 7,
  elementId: NEED,
  targetId: SR,
};

const SAFETY_PROBLEM: Problem = {
  code: "relation.not-allowed",
  severity: "warning",
  message:
    "Relation Derives from (derives-from) from Safety Requirement SSR-8571ac to System Requirement SR-b185f3 is not allowed; allowed: from System Requirement to Need",
  repository: "sensor",
  file: SAFETY_FILE,
  line: 8,
  elementId: SAFETY,
  targetId: SR,
};

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const ws = await createFixtureWorkspace({ fixture: FIXTURE, files });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const contextOf = async (workspace: Workspace): Promise<RelationTypeContext> => ({
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

/** The element `id` of the fixture with other frontmatter values, without touching its file. */
const withData = (
  record: ElementRecord,
  data: Readonly<Record<string, unknown>>,
  type = record.type,
): ElementRecord => ({
  ...record,
  type,
  data: { id: record.id, type, status: "draft", title: "T", ...data },
});

/** Key path, target and message of the findings of element `id` with other values. */
const findingsOf = async (
  id: string,
  data: Readonly<Record<string, unknown>>,
  type?: string,
): Promise<readonly (readonly [string, string, string])[]> => {
  const context = await contextOf(await open());
  const element = withData(recordOf(context.store, id), data, type);
  return relationTypeFindings(element, context).map(
    (f) => [f.path.join("/"), f.target.id, f.problem.message] as const,
  );
};

describe("relation types (SR-086)", () => {
  it("[SR-086/AK1] gives a hint with source, target and relation kind when a need derives from a system requirement", async () => {
    const workspace = await open();
    const context = await contextOf(workspace);
    const need = recordOf(context.store, NEED);
    const findings = relationTypeFindings(need, context);
    expect(findings.map((f) => [f.path, f.target])).toEqual([
      [["derives-from", 0], { ...TO_SR, title: "Show wind speed in large digits" }],
    ]);
    expect(await locateFindings(await workspace.get(workspaceLayoutState), findings)).toEqual([NEED_PROBLEM]);
  });

  it("[SR-086/AK1] gives no hint for relations the metamodel allows", async () => {
    const context = await contextOf(await open());
    expect(relationTypeFindings(recordOf(context.store, SR), context)).toEqual([]);
    expect(relationTypeFindings(recordOf(context.store, DECISION), context)).toEqual([]);
  });

  it("[SR-086/AK1] allows the types that extend an allowed type", async () => {
    const context = await contextOf(await open());
    const safety = relationTypeFindings(recordOf(context.store, SAFETY), context);
    expect(safety.map((f) => f.path)).toEqual([["derives-from", 1]]);
  });

  it("[SR-086/AK1] names what is allowed when only the source type or only the target type is wrong", async () => {
    expect(await findingsOf(NEED, { "derives-from": [TO_NEED] })).toEqual([
      [
        "derives-from/0",
        NEED,
        "Relation Derives from (derives-from) from Need N-34824e to Need N-34824e is not allowed; allowed: from System Requirement to Need",
      ],
    ]);
    expect(await findingsOf(SR, { "based-on": [TO_DECISION, TO_NEED], "refers-to": [TO_SR] })).toEqual([
      [
        "based-on/1",
        NEED,
        "Relation Based on (based-on) from System Requirement SR-b185f3 to Need N-34824e is not allowed; allowed: to Decision",
      ],
    ]);
  });

  it("[SR-086/AK1] checks the target type of a relation-valued property", async () => {
    expect(await findingsOf(SR, { "parent-item": TO_DECISION, "see-also": [TO_NEED, TO_SR] })).toEqual([
      [
        "parent-item",
        DECISION,
        "Property Parent item (parent-item) from System Requirement SR-b185f3 to Decision D-39dbb8 is not allowed; allowed: to Need",
      ],
    ]);
    expect(await findingsOf(DECISION, { "parent-item": TO_NEED }, "decision")).toEqual([]);
  });

  it("[SR-086/AK1] names types the metamodel does not define by their key, an empty list as no type, and a restriction of the source alone", async () => {
    const workspace = await open();
    const context = await contextOf(workspace);
    const metamodel: Metamodel = {
      ...context.metamodel,
      relations: [
        { key: "derives-from", name: "Derives from", "source-types": [], "target-types": ["need", "goal"] },
        { key: "refers-to", name: "Refers to", "source-types": ["decision"] },
      ],
    };
    const element = withData(recordOf(context.store, SR), { "derives-from": [TO_SR], "refers-to": [TO_SR] });
    expect(relationTypeFindings(element, { ...context, metamodel }).map((f) => f.problem.message)).toEqual([
      "Relation Derives from (derives-from) from System Requirement SR-b185f3 to System Requirement SR-b185f3 is not allowed; allowed: from no type to Need, goal",
      "Relation Refers to (refers-to) from System Requirement SR-b185f3 to System Requirement SR-b185f3 is not allowed; allowed: from Decision",
    ]);
  });

  it("[SR-086/AK1] follows a property over a relation kind of the same key, as the value-kind check does", async () => {
    const context = await contextOf(await open());
    const metamodel: Metamodel = {
      ...context.metamodel,
      properties: [...context.metamodel.properties, { key: "derives-from", name: "Origin", kind: "text" }],
    };
    expect(relationTypeFindings(recordOf(context.store, NEED), { ...context, metamodel })).toEqual([]);
  });

  it("[SR-086/AK1] checks the target type only when the target resolves to one element of a known type", async () => {
    // Missing target (SR-089), target in another or a missing repository (SR-006), wrong format (SR-085).
    expect(
      await findingsOf(SR, {
        "derives-from": [
          OTHER,
          { ...TO_SR, repository: "sensor" },
          { ...TO_SR, repository: "elsewhere" },
          "SR-b185f3",
          { id: SR },
        ],
        "parent-item": [TO_DECISION],
        "see-also": TO_SR,
        "based-on": null,
        "customer-link": [TO_SR],
      }),
    ).toEqual([]);
    // A source of a type the metamodel does not know (SR-016).
    expect(await findingsOf(NEED, { "derives-from": [TO_SR] }, "goal")).toEqual([]);
  });

  it("[SR-086/AK1] skips the target type of a target of an unknown type and of a UUID that files share", async () => {
    const context = await contextOf(await open());
    const sr = recordOf(context.store, SR);
    const unknownType = { ...sr, type: "goal" };
    const copied = { ...recordOf(context.store, DECISION), id: SR };
    const element = withData(sr, { "derives-from": [TO_SR] });
    const check = (records: readonly ElementRecord[]): number => {
      const store: ElementStore = { ...context.store, byId: new Map([[SR, records]]) };
      return relationTypeFindings(element, { ...context, store }).length;
    };
    expect(check([sr])).toBe(1);
    expect(check([unknownType])).toBe(0);
    expect(check([sr, copied])).toBe(0);
    expect(check([sr, { ...sr, file: "requirements/copy.md" }])).toBe(0);
  });

  it("[SR-086/AK1] reports a source type that is not allowed even when the target does not resolve", async () => {
    const context = await contextOf(await open());
    const sr = recordOf(context.store, SR);
    const element = withData(recordOf(context.store, NEED), {
      "derives-from": [OTHER, { ...TO_SR, repository: "elsewhere" }, TO_SR],
    });
    const store: ElementStore = {
      ...context.store,
      byId: new Map([[SR, [sr, { ...sr, file: "requirements/copy.md" }]]]),
    };
    const found = relationTypeFindings(element, { ...context, store });
    const allowed = "allowed: from System Requirement to Need";
    expect(found.map((f) => [f.path.join("/"), f.problem.targetId, f.problem.message])).toEqual([
      [
        "derives-from/0",
        OTHER.id,
        `Relation Derives from (derives-from) from Need N-34824e to c193f6 is not allowed; ${allowed}`,
      ],
      [
        "derives-from/1",
        SR,
        `Relation Derives from (derives-from) from Need N-34824e to b185f3 is not allowed; ${allowed}`,
      ],
      [
        "derives-from/2",
        SR,
        `Relation Derives from (derives-from) from Need N-34824e to b185f3 is not allowed; ${allowed}`,
      ],
    ]);
    const unknownType = withData(sr, {}, "goal");
    const toUnknown: ElementStore = { ...context.store, byId: new Map([[SR, [unknownType]]]) };
    expect(relationTypeFindings(element, { ...context, store: toUnknown })[2]?.problem.message).toBe(
      `Relation Derives from (derives-from) from Need N-34824e to goal UNKNOWN-b185f3 is not allowed; ${allowed}`,
    );
  });

  it("[SR-086/AK2] reports every relation between types that are not allowed as a finding of the workspace", async () => {
    const workspace = await open();
    expect(await workspace.get(relationTypeProblemsState)).toEqual([NEED_PROBLEM, SAFETY_PROBLEM]);
  });

  it("[SR-086/AK2] checks the relations again after the element store is read again", async () => {
    const fixture = await createFixtureWorkspace({ fixture: FIXTURE });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    expect(await workspace.get(relationTypeProblemsState)).toHaveLength(2);
    await fixture.write(
      `system/${NEED_FILE}`,
      `---\nid: ${NEED}\ntype: need\nstatus: draft\ntitle: Wind speed visible at a glance\n---\n`,
    );
    await workspace.reset(elementStoreState);
    expect(await workspace.get(relationTypeProblemsState)).toEqual([SAFETY_PROBLEM]);
  });

  it("checks 50,000 elements with 200,000 relations in one pass within the time budget (N-036)", async () => {
    const context = await contextOf(await open());
    const need = recordOf(context.store, NEED);
    const sr = recordOf(context.store, SR);
    const elements = Array.from({ length: 50_000 }, (_, i) =>
      i % 100 === 0
        ? withData(need, { "derives-from": [TO_SR, TO_SR, TO_SR, TO_SR] })
        : withData(sr, { "derives-from": [TO_NEED, TO_NEED, TO_NEED, TO_NEED] }),
    );
    const store: ElementStore = { ...context.store, elements };
    const started = performance.now();
    const findings = allRelationTypeFindings({
      ...context,
      store,
      shortIds: buildShortIds(store.byId, context.metamodel),
    });
    expect(performance.now() - started).toBeLessThan(5000);
    expect(findings).toHaveLength(2000);
  });
});

describe("elements looked at again after a change of UUIDs (SR-086 carry, #272)", () => {
  it("picks from the incoming index of the store before the change what the scan picks", async () => {
    const fixture = await createFixtureWorkspace({ fixture: FIXTURE });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    const store = (await workspace.get(elementStoreState)) as LoadedStore;
    const metamodel = await workspace.get(metamodelState);
    const update = {
      from: store,
      to: store,
      files: new Map<string, Set<string>>(),
      repositories: store.repositories,
    };
    const files = (list: readonly ElementRecord[]): string[] => [...new Set(list.map((e) => e.file))].sort();
    const index = buildIncomingIndex(store, metamodel);
    for (const id of [NEED, SR, DECISION, SAFETY, OTHER.id]) {
      const changed = { ...update, ids: new Set([id]) };
      const scan = relationTypeAgain(changed, metamodel, undefined);
      const picked = relationTypeAgain(changed, metamodel, index);
      if (typeof scan !== "function" || typeof picked === "function") {
        throw new Error("a test without the index, a list with it");
      }
      expect(files(picked), id).toEqual(files(store.elements.filter(scan)));
    }
    expect(
      files(relationTypeAgain({ ...update, ids: new Set([SR]) }, metamodel, index) as ElementRecord[]),
    ).toEqual([SAFETY_FILE, NEED_FILE, "requirements/SR-c03e4db185f3.md"]);
    // An index of another store or built with another metamodel: the scan.
    const changed = { ...update, ids: new Set([NEED]) };
    expect(typeof relationTypeAgain(changed, metamodel, buildIncomingIndex({ ...store }, metamodel))).toBe(
      "function",
    );
    expect(typeof relationTypeAgain(changed, metamodel, buildIncomingIndex(store, { ...metamodel }))).toBe(
      "function",
    );
  });
});
