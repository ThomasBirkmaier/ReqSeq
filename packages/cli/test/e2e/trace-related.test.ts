// `logreq trace related` end to end (SR-023): the built binary on fixtures/SR-023/related, as lines
// and as JSON. N1 and N2 are needs; A derives from N1, B from N1 and N2, C from A and B, D refines C,
// E derives from N2. Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

interface Output {
  readonly elements: readonly { readonly id: string; readonly shortId: string; readonly text?: string }[];
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

const related = async (args: readonly string[]): Promise<{ run: Run; output: Output }> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-023/related" });
  fixtures.push(ws);
  const result = await run(["trace", "related", ...args, "--json"], { cwd: ws.root });
  return { run: result, output: JSON.parse(result.stdout) as Output };
};

const shortIds = (output: Output): string[] => output.elements.map((e) => e.shortId);

describe("logreq trace related (SR-023)", () => {
  it("[SR-023/AK1] lists the children of a parent on every level, and up to a depth", async () => {
    const all = await related(["children", "--refs", "N-0000a1"]);
    expect([all.run.code, all.run.stderr]).toEqual([0, ""]);
    expect(shortIds(all.output)).toEqual(["SR-0000b1", "SR-0000b2", "SR-0000b3", "SR-0000b4"]);
    expect(all.output.elements.every((e) => e.text === undefined)).toBe(true);
    const one = await related(["children", "--refs", "N-0000a1", "--max-depth", "1"]);
    expect(shortIds(one.output)).toEqual(["SR-0000b1", "SR-0000b2"]);
  });

  it("[SR-023/AK2] lists an element derived from two selected parents once", async () => {
    const { run: result, output } = await related(["children", "--refs", "N-0000a1", "--refs", "N-0000a2"]);
    expect(result.code).toBe(0);
    expect(shortIds(output)).toEqual(["SR-0000b1", "SR-0000b2", "SR-0000b5", "SR-0000b3", "SR-0000b4"]);
    expect([output.total, output.incomplete]).toEqual([5, false]);
  });

  it("[SR-023/AK3] lists every parent of a selection, and shows them as lines without --json", async () => {
    const { output } = await related(["parents", "--refs", "SR-0000b3", "--refs", "SR-0000b5"]);
    expect(shortIds(output)).toEqual(["SR-0000b1", "SR-0000b2", "N-0000a2", "N-0000a1"]);
    const ws = await createFixtureWorkspace({ fixture: "SR-023/related" });
    fixtures.push(ws);
    const human = await run(["trace", "related", "parents", "--refs", "SR-0000b1"], { cwd: ws.root });
    expect(human.code).toBe(0);
    expect(human.stdout).toMatch(
      /^elements:\n {2}- id: 2302a0de-0000-4000-8000-0000000000a1\n {4}shortId: N-0000a1\n/,
    );
    expect(human.stdout).toContain("\ntotal: 1\nincomplete: false\n");
  });

  it("ends with exit code 2 and the error for an unknown reference", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-023/related" });
    fixtures.push(ws);
    const failed = await run(["trace", "related", "children", "--refs", "N-ffffff", "--json"], {
      cwd: ws.root,
    });
    expect([failed.code, failed.stdout]).toEqual([2, ""]);
    expect(JSON.parse(failed.stderr)).toMatchObject({ code: "ref.unknown" });
  });
});
