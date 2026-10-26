// `logreq element list` end to end (SR-069, SR-101): the built binary on fixtures/SR-069/filter, as
// JSON and as lines. The selection is complex input, so it comes with `--input` (ADR-0009). The
// fixture: needs N1 and N2; SR b1 (approved) and b2 (draft, valid for V1) derive from N1, b3 (draft,
// valid for V2) from b1, b5 (approved) from N2; b4 is obsolete and has no parent; SWR f1 (draft) and
// f2 (approved), a subtype, derive from b1 and b2. Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

interface Output {
  readonly elements: readonly { readonly shortId: string; readonly text?: string }[];
  readonly total: number;
  readonly incomplete: boolean;
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const workspace = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-069/filter" });
  fixtures.push(ws);
  return ws;
};

const list = async (input: unknown, args: readonly string[] = ["--json"]): Promise<Run> =>
  run(["element", "list", "--input", JSON.stringify(input), ...args], { cwd: (await workspace()).root });

const shortIds = async (input: unknown): Promise<string[]> => {
  const result = await list(input);
  expect([result.code, result.stderr]).toEqual([0, ""]);
  return (JSON.parse(result.stdout) as Output).elements.map((e) => e.shortId);
};

const requirement = { type: ["system-requirement"] };

describe("logreq element list (SR-069)", () => {
  it("[SR-069/AK1] shows only the elements of a type, a status, a package, a validity or a property", async () => {
    expect(await shortIds({ selection: { where: { type: ["software-requirement"] } } })).toEqual([
      "SWR-0000f1",
      "SWR-0000f2",
    ]);
    expect(
      await shortIds({ selection: { where: { all: [requirement, { status: ["approved"] }] } } }),
    ).toEqual(["SR-0000b1", "SR-0000b5", "SWR-0000f2"]);
    expect(await shortIds({ selection: { where: { package: "PKG-0000d2" } } })).toEqual([
      "SR-0000b2",
      "SR-0000b4",
    ]);
    expect(
      await shortIds({ selection: { where: { all: [requirement, { validFor: "VAR-0000c2" }] } } }),
    ).toEqual(["SR-0000b1", "SR-0000b3", "SR-0000b4", "SR-0000b5", "SWR-0000f1", "SWR-0000f2"]);
    expect(await shortIds({ selection: { where: { property: "priority", op: "gt", value: 3 } } })).toEqual([
      "SWR-0000f2",
    ]);
  });

  it("[SR-069/AK2] applies and, or and not", async () => {
    const where = {
      all: [requirement, { not: { any: [{ status: ["draft"] }, { invalid: true }] } }],
    };
    expect(await shortIds({ selection: { where } })).toEqual(["SR-0000b1", "SR-0000b5", "SWR-0000f2"]);
  });

  it("[SR-069/AK3] shows the requirements without child, as lines without --json", async () => {
    const where = {
      all: [requirement, { relation: { meaning: "derivation", direction: "down" }, exists: false }],
    };
    expect(await shortIds({ selection: { where } })).toEqual([
      "SR-0000b3",
      "SR-0000b4",
      "SR-0000b5",
      "SWR-0000f1",
      "SWR-0000f2",
    ]);
    const human = await list({ selection: { where }, limit: 2 }, []);
    expect([human.code, human.stderr]).toEqual([0, ""]);
    // One line per element (#310), then the total of all matches and how to page.
    expect(human.stdout).toBe(
      "elements:\n  SR-0000b3  draft  Survive icing\n  SR-0000b4  obsolete  Show a dial\ntotal: 5\nShowing 2 of 5; ask for more with --offset and --limit.\n",
    );
  });

  it("[SR-101/AK3] selects exactly the elements of a list of short IDs, with their text", async () => {
    const result = await list({ selection: { ids: ["N-0000a2", "sr-0000B1"] }, withText: true });
    const output = JSON.parse(result.stdout) as Output;
    expect(output.elements.map((e) => [e.shortId, e.text])).toEqual([
      ["N-0000a2", "N2: parent of SR-0000b5.\n"],
      ["SR-0000b1", "b1: derives from N1, in package P1.\n"],
    ]);
    expect([output.total, output.incomplete]).toEqual([2, false]);
  });

  it("ends with exit code 2 and the error for a condition that comes later", async () => {
    const failed = await list({ selection: { where: { emergent: true } } });
    expect([failed.code, failed.stdout]).toEqual([2, ""]);
    expect(JSON.parse(failed.stderr)).toMatchObject({
      code: "input.invalid",
      details: { fields: ["selection.where.emergent"] },
    });
  });
});
