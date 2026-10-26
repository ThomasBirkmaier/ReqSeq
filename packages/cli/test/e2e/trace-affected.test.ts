// `logreq trace affected` and the count of `logreq element update` end to end (SR-024, ADR-0009): the
// built binary with the product commands on fixtures/SR-024/affected, its exit code, its JSON and its
// readable output. The evidence records of an old version (AK4) come with the evidence records of
// stage 4 (SR-028), and their CLI tests with them; core tests them through the evidence seam now.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

const logreq = (args: readonly string[], cwd: string): Promise<Run> => run(args, { cwd });

interface Output {
  readonly affected: readonly {
    readonly shortId: string;
    readonly distance: number;
    readonly path: readonly { readonly id: string; readonly repository: string }[];
    readonly via: { readonly kind: string; readonly key?: string };
  }[];
  readonly total: number;
  readonly records: readonly unknown[];
  readonly incomplete: boolean;
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const fixture = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-024/affected" });
  fixtures.push(ws);
  return ws;
};

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const P = "5c0e1d2a-0024-4024-8024-00000000";

describe("logreq trace affected (SR-024)", () => {
  it("[SR-024/AK1] prints the affected elements of an element with way and distance, as JSON and readable", async () => {
    const ws = await fixture();
    const json = await logreq(["trace", "affected", "SR-00b001", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    const output = JSON.parse(json.stdout) as Output;
    expect(output.affected.map((a) => [a.shortId, a.distance, a.via])).toEqual([
      ["SR-00b002", 1, { kind: "relation", key: "derives-from" }],
      ["SR-00b003", 1, { kind: "reference" }],
      ["SR-00b004", 2, { kind: "relation", key: "derives-from" }],
    ]);
    expect(output.affected[2]?.path.map((p) => p.id)).toEqual([`${P}b001`, `${P}b002`, `${P}b004`]);
    expect(output.affected[2]?.path.every((p) => p.repository === "system")).toBe(true);
    expect([output.total, output.records, output.incomplete]).toEqual([3, [], false]);
    const page = await logreq(
      ["trace", "affected", "SR-00b001", "--limit", "1", "--offset", "2", "--json"],
      ws.root,
    );
    const paged = JSON.parse(page.stdout) as Output;
    expect([paged.affected.map((a) => a.shortId), paged.total]).toEqual([["SR-00b004"], 3]);
    const human = await logreq(["trace", "affected", "SR-00b001"], ws.root);
    expect([human.code, human.stderr]).toEqual([0, ""]);
    // One line per element: distance, short ID, title, and how it points at the one before it on its
    // path, named unless it is the element asked for (SR-024 AK1 "mit Weg und Abstand", #310).
    expect(human.stdout).toBe(
      [
        "affected:",
        "  1  SR-00b002  Show gusts  [via derives-from]",
        "  1  SR-00b003  Show wind direction  [via reference]",
        "  2  SR-00b004  Warn of storms  [via derives-from from SR-00b002]",
        "total: 3",
        "records: none",
        "",
      ].join("\n"),
    );
  });

  it("[SR-024/AK1] names an unknown element with exit code 2", async () => {
    const ws = await fixture();
    const unknown = await logreq(["trace", "affected", "SR-ffffff"], ws.root);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain("error ref.unknown");
  });

  it("[SR-024/AK2] prints the number of directly affected elements after a change of the text", async () => {
    const ws = await fixture();
    const json = await logreq(["element", "update", "SR-00b001", "--text", "In knots.\n", "--json"], ws.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    expect((JSON.parse(json.stdout) as { affected: number }).affected).toBe(2);
    const human = await logreq(["element", "update", "SR-00b001", "--text", "In km/h.\n"], ws.root);
    expect(human.stdout).toContain("\naffected: 2\n");
  });

  it("[SR-024/AK3] prints no affected elements after a change of the title only", async () => {
    const ws = await fixture();
    const json = await logreq(
      ["element", "update", "SR-00b001", "--title", "Show the wind speed", "--json"],
      ws.root,
    );
    expect([json.code, (JSON.parse(json.stdout) as { affected: number }).affected]).toEqual([0, 0]);
  });
});
