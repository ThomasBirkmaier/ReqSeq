// `element.facets` (#425) in the performance suite (ADR-0011) on the generated workspace of N-036 with
// 50,000 elements: the statuses and property values of all elements and of one type, as the app's
// "Filter list by property" asks for them. One pass over the selection plus one over the store for
// the free-text rule. It is a result like a filter, so it is held to the 500 ms of SR-082 AK4 without
// carrying that tag (it is no acceptance criterion of it, enabler #425).
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measureMedian,
  thresholdMessage,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { elementStoreState } from "../../src/model/index.js";
import { invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** The filter budget of SR-082 AK4. */
const RESULT_MS = 500;
/** The budget of opening an element (SR-082), which the facets of the shown element follow (SR-132). */
const OPEN_MS = 200;
/** Runs per measurement: the median blurs pauses of the garbage collector on a shared machine. */
const RUNS = 5;
const VERSION: VersionFunction = () => "n1:0000000000000000";

type Output = CommandOutput<"element.facets">;

describe("element.facets with 50,000 elements (#425, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    tree = generateLargeWorkspace({ version: VERSION, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    await warmWorkspace(workspace);
    expect((await workspace.get(elementStoreState)).elements).toHaveLength(ELEMENTS);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  const facets = async (input: Record<string, unknown>): Promise<Output> => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return (await invoke("element.facets", input, { workspace })) as Output;
  };

  const basis = "N-036, filter budget of SR-082 AK4 (recorded, enabler #425)";

  it("gives the facets of all elements within 500 ms", async () => {
    await facets({});
    const { result, measurement } = await measureMedian("facets: all elements (warm)", () => facets({}), {
      basis,
      thresholdMs: RESULT_MS,
      runs: RUNS,
    });
    expect(result.total).toBe(ELEMENTS);
    expect(result.types.reduce((sum, t) => sum + t.count, 0)).toBe(ELEMENTS);
    expect(result.properties.length).toBeGreaterThan(0);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("gives the facets of the system requirements within 500 ms", async () => {
    const input = { selection: { where: { type: ["system-requirement"] } } };
    await facets(input);
    const { result, measurement } = await measureMedian(
      "facets: system requirements (warm)",
      () => facets(input),
      { basis, thresholdMs: RESULT_MS, runs: RUNS },
    );
    expect(result.total).toBeGreaterThan(0);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  // SR-132: the app asks for the facets of the shown element, by its short ID, to know which of its values
  // open a list. The free-text rule still passes the whole store for every few-valued or absent text
  // property of the type; held to the 200 ms of opening an element (SR-082).
  it("gives the facets of one system requirement within 200 ms", async () => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    const listed = (await invoke(
      "element.list",
      { selection: { where: { type: ["system-requirement"] } }, limit: 1 },
      { workspace },
    )) as CommandOutput<"element.list">;
    const shortId = listed.elements[0]?.shortId ?? "";
    const input = { selection: { ids: [shortId] } };
    await facets(input);
    const { result, measurement } = await measureMedian(
      "facets: one element (warm, SR-132)",
      () => facets(input),
      {
        basis: "N-036, opening budget of SR-082 (recorded, SR-132)",
        thresholdMs: OPEN_MS,
        runs: RUNS,
      },
    );
    expect(result.total).toBe(1);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(OPEN_MS);
  });
});
