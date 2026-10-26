// `logreq element bulk-update` end to end (SR-071): the built binary on fixtures/SR-069/filter. The
// property and the operation are positional, the selection and the value come with `--input`, the
// confirmation is `--confirm` with the count of the preview as `--expected` (ADR-0009). Requirements
// and needs have `topic` (b1 has Wind), the decision, packages and variants do not. Run after
// `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

interface Output {
  readonly applied: boolean;
  readonly count: number;
  readonly affected: readonly { readonly shortId: string }[];
  readonly skipped: readonly { readonly shortId: string; readonly reason: string }[];
  readonly files: readonly string[];
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

const INPUT = JSON.stringify({
  selection: { where: { type: ["system-requirement", "decision"] } },
  value: "Gusts",
});

const B1 = "requirements/SR-0000000000b1.md";

describe("logreq element bulk-update (SR-071)", () => {
  it("[SR-071/AK2] previews the number of affected elements, then writes on --confirm with that number", async () => {
    const ws = await workspace();
    const before = await fs.readFile(ws.path(B1), "utf8");
    const preview = await run(["element", "bulk-update", "topic", "set", "--input", INPUT], { cwd: ws.root });
    expect([preview.code, preview.stderr]).toEqual([0, ""]);
    expect(preview.stdout).toMatch(/^applied: false\ncount: 7\n/);
    expect(preview.stdout).toContain("reason: not-a-property");
    expect(preview.stdout).toContain("files: none");
    expect(await fs.readFile(ws.path(B1), "utf8")).toBe(before);

    const refused = await run(
      ["element", "bulk-update", "topic", "set", "--input", INPUT, "--confirm", "--expected", "6"],
      { cwd: ws.root },
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      "error input.invalid: expected: the change now affects 7 elements, not 6",
    );
    expect(await fs.readFile(ws.path(B1), "utf8")).toBe(before);

    const done = await run(
      ["element", "bulk-update", "topic", "set", "--input", INPUT, "--confirm", "--expected", "7", "--json"],
      { cwd: ws.root },
    );
    expect([done.code, done.stderr]).toEqual([0, ""]);
    const output = JSON.parse(done.stdout) as Output;
    expect(output).toMatchObject({ applied: true, count: 7 });
    expect(output.files).toContain(B1);
    // [SR-071/AK3] the decision is left out and named.
    expect(output.skipped).toEqual([
      expect.objectContaining({ shortId: "D-0000e1", reason: "not-a-property" }),
    ]);
    // [SR-071/AK1] only the topic line changed.
    expect(await fs.readFile(ws.path(B1), "utf8")).toBe(before.replace("topic: Wind", "topic: Gusts"));
  });
});
