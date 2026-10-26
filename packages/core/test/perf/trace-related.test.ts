// `trace.related` (SR-023) in the performance suite (ADR-0011) on the generated workspace of N-036
// with 50,000 elements and 200,000 relations. The walk is always complete; only the page (`limit`,
// default 200) is built as elements and gets its versions. The first page of all children of a need
// is a result like a chain, so it asserts SR-082 AK4's 500 ms (tagged, ADR-0011); the other times
// are recorded only: a full listing of every child (the largest page, 5,000, page by page) with
// versions read from the files and with the versions the workspace keeps.
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import { generateLargeWorkspace, measure, thresholdMessage, writeLargeWorkspace } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { currentVersions, elementStoreState } from "../../src/model/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** The largest page (catalog). */
const MAX_LIMIT = 5000;
/** The versions stored in relations do not matter here: nothing compares them. */
const VERSION: VersionFunction = () => "n1:0000000000000000";

type Output = CommandOutput<"trace.related">;

describe("trace.related with 50,000 elements and 200,000 relations (SR-023, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    tree = generateLargeWorkspace({ version: VERSION, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    // As a server or the app does it at start (SR-082 AK1, AK2).
    await warmWorkspace(workspace);
    expect((await workspace.get(elementStoreState)).elements).toHaveLength(ELEMENTS);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  const opened = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return workspace;
  };

  const related = async (input: Record<string, unknown>): Promise<Output> =>
    (await invoke("trace.related", input, { workspace: opened() })) as Output;

  /** Every page of `input`, `MAX_LIMIT` elements each. */
  const allPages = async (input: Record<string, unknown>): Promise<Output["elements"]> => {
    const elements: Output["elements"][number][] = [];
    for (let offset = 0, total = 1; offset < total; offset += MAX_LIMIT) {
      const page = await related({ ...input, offset, limit: MAX_LIMIT });
      elements.push(...page.elements);
      total = page.total;
    }
    return elements;
  };

  const needs = (): string[] => tree.elements.filter((e) => e.type === "need").map((e) => e.id);
  const basis = "SR-023, N-036 (recorded; compare SR-082 AK4, 500 ms)";

  it("[SR-082/AK4] lists the first page of all children of a need within 500 ms", async () => {
    const [need = ""] = needs();
    // The incoming relation index and the short IDs are built once per store, not per call (ADR-0008).
    await measure(
      "related: first call (incoming index, short IDs, first page)",
      () => related({ refs: [need], direction: "parents" }),
      { basis },
    );
    const { result: page, measurement } = await measure(
      "related: first page (200) of all children of the first need (versions of the page's files)",
      () => related({ refs: [need], direction: "children" }),
      { basis: "SR-082 AK4 (trace.related, the walk complete, one page built)", thresholdMs: RESULT_MS },
    );
    expect(page.elements).toHaveLength(200);
    expect(page.total).toBeGreaterThan(10_000);
    expect(page.incomplete).toBe(false);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records a full listing of all children, the parents of requirements and children with kept versions", async () => {
    const [need = ""] = needs();
    const requirements = tree.elements.filter((e) => e.type === "system-requirement").map((e) => e.id);
    const { result: direct } = await measure(
      "related: direct children of 10 needs",
      () => related({ refs: needs().slice(0, 10), direction: "children", maxDepth: 1 }),
      { basis },
    );
    const { result: parents } = await measure(
      "related: all parents of the last 10 system requirements",
      () => related({ refs: requirements.slice(-10), direction: "parents" }),
      { basis },
    );
    const { result: all } = await measure(
      "related: every child of the first need, all pages of 5,000 (versions of the listed files)",
      () => allPages({ refs: [need], direction: "children" }),
      { basis },
    );
    await measure("current versions of the whole store (built once, kept)", () => currentVersions(opened()), {
      basis: "ADR-0005, #259 (recorded)",
    });
    const { result: kept } = await measure(
      "related: every child of the first need, all pages of 5,000 (kept versions)",
      () => allPages({ refs: [need], direction: "children" }),
      { basis },
    );
    expect(direct.total).toBeGreaterThan(0);
    expect(parents.total).toBeGreaterThan(0);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    expect(kept).toEqual(all);
    await measure(`related: ${String(all.length)} children of the first need`, () => all.length, { basis });
  });
});
