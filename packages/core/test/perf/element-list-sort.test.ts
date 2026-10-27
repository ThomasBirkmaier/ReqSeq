// `element.list` sorted (SR-075) in the performance suite (ADR-0011) on the generated workspace of
// N-036 with 50,000 elements and 200,000 relations. The sort and the derivation tree always take the
// whole selection (every element here); only the page (`limit`, default 200) is built as elements.
// The first page of all elements as a derivation tree, and sorted by title, are results like a
// filter, so they assert SR-082 AK4's 500 ms (tagged, ADR-0011); the other times are recorded only.
// The tree reads the parents of every element of the store as store positions once per store
// (`parentPositions`), not the incoming relation index: the first tree of a store is recorded apart,
// and so is the first tree of a workspace without the index (a one-shot CLI call).
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import { generateLargeWorkspace, measure, thresholdMessage, writeLargeWorkspace } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { elementStoreState, shortIdState } from "../../src/model/index.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-082 AK4. */
const RESULT_MS = 500;
/** The versions stored in relations do not matter here: nothing compares them. */
const VERSION: VersionFunction = () => "n1:0000000000000000";

type Output = CommandOutput<"element.list">;

describe("element.list sorted and as a derivation tree with 50,000 elements and 200,000 relations (SR-075, N-036)", () => {
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

  const list = async (input: Record<string, unknown>, current = opened()): Promise<Output> =>
    (await invoke("element.list", input, { workspace: current })) as Output;

  const basis = "SR-075, N-036 (recorded; compare SR-082 AK4, 500 ms)";

  it("[SR-082/AK4] lists the first page of all elements as a derivation tree within 500 ms", async () => {
    await measure("list: first call (short IDs, first page)", () => list({}), { basis });
    // The first tree of the store reads the parents of every element (kept for the store), and the
    // engine has not optimised its code yet (as the first chain, ADR-0008); recorded only.
    await measure(
      "list: first call as a derivation tree (parents of the store)",
      () => list({ sort: [{ by: "hierarchy" }] }),
      {
        basis,
      },
    );
    const { result: page, measurement } = await measure(
      "list: first page (200) of all elements as a derivation tree, siblings by title",
      () => list({ sort: [{ by: "hierarchy" }, { by: "title" }] }),
      {
        basis: "SR-082 AK4 (element.list, the tree of the whole selection, one page built)",
        thresholdMs: RESULT_MS,
      },
    );
    expect(page.elements).toHaveLength(200);
    expect(page.tree).toHaveLength(200);
    expect(page.total).toBe(ELEMENTS);
    expect(page.tree?.[0]?.depth).toBe(0);
    expect(page.tree?.some((place) => place.depth > 0)).toBe(true);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] lists the first page of all elements sorted by title within 500 ms", async () => {
    const { result: page, measurement } = await measure(
      "list: first page (200) of all elements sorted by title",
      () => list({ sort: [{ by: "title" }] }),
      {
        basis: "SR-082 AK4 (element.list, the sort of the whole selection, one page built)",
        thresholdMs: RESULT_MS,
      },
    );
    const titles = page.elements.map((e) => e.title.normalize("NFC").toLowerCase());
    expect(titles).toEqual(titles.toSorted());
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("[SR-082/AK4] lists the first page of all elements sorted by type and identifier within 500 ms (#418)", async () => {
    const { result: page, measurement } = await measure(
      "list: first page (200) of all elements sorted by type, then identifier (natural order)",
      () => list({ sort: [{ by: "type" }, { by: "identifier" }] }),
      {
        basis: "SR-082 AK4 (element.list, the default sort of the app, one page built)",
        thresholdMs: RESULT_MS,
      },
    );
    expect(page.elements).toHaveLength(200);
    // Natural order: within one type the numbers rise.
    const numberOf = (identifier: string | undefined): number => Number(/\d+$/.exec(identifier ?? "")?.[0]);
    const riseWithinType = (elements: Output["elements"]): void => {
      const type = elements[0]?.type;
      const numbers = elements.filter((e) => e.type === type).map((e) => numberOf(e.identifier));
      expect(numbers.every((n) => Number.isInteger(n))).toBe(true);
      expect(numbers).toEqual(numbers.toSorted((x, y) => x - y));
    };
    riseWithinType(page.elements);
    // A page far on holds identifiers of 4 and 5 digits, which a text sort would put before SR-999.
    const { result: far } = await measure(
      "list: page (200) at 20,000 of all elements sorted by type, then identifier",
      () => list({ sort: [{ by: "type" }, { by: "identifier" }], offset: 20_000 }),
      { basis },
    );
    riseWithinType(far.elements);
    expect(far.elements.some((e) => (e.identifier ?? "").replace(/\D/g, "").length >= 4)).toBe(true);
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(RESULT_MS);
  });

  it("records other sorts, a tree of the system requirements and a tree without the incoming index", async () => {
    const { result: byStatus } = await measure(
      "list: first page of all elements by status descending, then short ID",
      () => list({ sort: [{ by: "status", order: "desc" }, { by: "id" }] }),
      { basis },
    );
    await measure(
      "list: first page of all elements by type, then a property (requirement-type)",
      () => list({ sort: [{ by: "type" }, { by: "requirement-type" }] }),
      { basis },
    );
    const { result: requirements } = await measure(
      "list: first page of the system requirements as a derivation tree",
      () => list({ selection: { where: { type: ["system-requirement"] } }, sort: [{ by: "hierarchy" }] }),
      { basis },
    );
    const { result: last } = await measure(
      "list: last page (5,000) of all elements as a derivation tree",
      () => list({ sort: [{ by: "hierarchy" }], offset: ELEMENTS - 5000, limit: 5000 }),
      { basis },
    );
    expect(byStatus.elements).toHaveLength(200);
    expect(requirements.total).toBeGreaterThan(0);
    expect(last.tree).toHaveLength(5000);
    // A workspace that never built the incoming relation index, as a one-shot CLI call has it.
    const cold = new Workspace(opened().root);
    try {
      await cold.get(elementStoreState);
      await cold.get(shortIdState);
      const { result: page } = await measure(
        "list: first tree of a workspace without the incoming index (one-shot CLI call; parents of the store)",
        () => list({ sort: [{ by: "hierarchy" }] }, cold),
        { basis },
      );
      expect(page.tree).toHaveLength(200);
    } finally {
      await cold.close();
    }
  });
});
