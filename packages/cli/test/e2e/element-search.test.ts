// `reqseq element search` end to end (SR-068): the built binary on fixtures/SR-069/filter (see
// element-list.test.ts), as lines and as JSON. The query is the positional argument, the fields
// repeat a flag, the selection comes with `--input` (ADR-0009). A second run loads the search index
// from the cache folder that the first one wrote (ADR-0008) and gives the same hits. Run after
// `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

interface Output {
  readonly hits: readonly { readonly shortId: string; readonly fields: readonly string[] }[];
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

describe("reqseq element search (SR-068)", () => {
  it("[SR-068/AK2] shows one line per hit, best first, for a query with a typo in another case", async () => {
    const ws = await workspace();
    const result = await run(["element", "search", "MESURE"], { cwd: ws.root });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toBe(
      "hits:\n  SR-0000b1  approved  Measure wind speed\n  SR-0000b2  draft  Measure every second\ntotal: 2\n",
    );
  });

  it("[SR-068/AK1] finds a short ID in title and IDs only, the same with the index from the cache", async () => {
    const ws = await workspace();
    const args = ["element", "search", "sr-0000b5", "--fields", "title", "--fields", "id", "--json"];
    const first = await run(args, { cwd: ws.root });
    const second = await run(args, { cwd: ws.root });
    expect([first.code, first.stderr, second.stdout]).toEqual([0, "", first.stdout]);
    const output = JSON.parse(first.stdout) as Output;
    expect(output.hits.map((hit) => [hit.shortId, hit.fields])).toEqual([["SR-0000b5", ["id"]]]);
  });

  it("[SR-068/AK3] searches only within the selection, one page at a time", async () => {
    const ws = await workspace();
    const result = await run(
      [
        "element",
        "search",
        "measure",
        "--input",
        JSON.stringify({ selection: { view: "VAR-0000c2" } }),
        "--limit",
        "1",
        "--json",
      ],
      { cwd: ws.root },
    );
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const output = JSON.parse(result.stdout) as Output;
    expect([output.hits.map((hit) => hit.shortId), output.total]).toEqual([["SR-0000b1"], 1]);
  });
});
