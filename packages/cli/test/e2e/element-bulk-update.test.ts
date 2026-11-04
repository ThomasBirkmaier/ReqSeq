// `reqseq element bulk-update` end to end (SR-071): the built binary on fixtures/SR-069/filter. The
// property and the operation are positional, the selection and the value come with `--input`, the
// confirmation is `--confirm` with the plan of the preview as `--plan` (#158), or its count as
// `--expected` (ADR-0009). Requirements and needs have `topic` (b1 has Wind), the decision, packages
// and variants do not. Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

interface Output {
  readonly applied: boolean;
  readonly count: number;
  readonly affected: readonly { readonly shortId: string }[];
  readonly skipped: readonly { readonly shortId: string; readonly reason: string }[];
  readonly files: readonly string[];
  readonly plan: string;
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

describe("reqseq element bulk-update (SR-071)", () => {
  it("[SR-071/AK2] previews the number of affected elements, then writes on --confirm with its plan", async () => {
    const ws = await workspace();
    const before = await fs.readFile(ws.path(B1), "utf8");
    const preview = await run(["element", "bulk-update", "topic", "set", "--input", INPUT], { cwd: ws.root });
    expect([preview.code, preview.stderr]).toEqual([0, ""]);
    expect(preview.stdout).toMatch(/^applied: false\ncount: 7\n/);
    expect(preview.stdout).toContain("reason: not-a-property");
    expect(preview.stdout).toContain("files: none");
    expect(await fs.readFile(ws.path(B1), "utf8")).toBe(before);
    const json = await run(["element", "bulk-update", "topic", "set", "--input", INPUT, "--json"], {
      cwd: ws.root,
    });
    const { plan } = JSON.parse(json.stdout) as Output;
    expect(preview.stdout).toContain(`plan: ${plan}`);

    const refused = await run(
      ["element", "bulk-update", "topic", "set", "--input", INPUT, "--confirm", "--expected", "6"],
      { cwd: ws.root },
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      "error input.invalid: expected: the change now affects 7 elements, not 6",
    );
    // The plan of this preview does not hold for another value.
    const other = await run(
      [
        "element",
        "bulk-update",
        "topic",
        "set",
        "--input",
        INPUT.replace("Gusts", "Calm"),
        "--confirm",
        "--plan",
        plan,
      ],
      { cwd: ws.root },
    );
    expect(other.code).toBe(2);
    expect(other.stderr).toContain("error input.invalid: plan: the change now writes other elements");
    expect(await fs.readFile(ws.path(B1), "utf8")).toBe(before);

    const done = await run(
      ["element", "bulk-update", "topic", "set", "--input", INPUT, "--confirm", "--plan", plan, "--json"],
      { cwd: ws.root },
    );
    expect([done.code, done.stderr]).toEqual([0, ""]);
    const output = JSON.parse(done.stdout) as Output;
    expect(output).toMatchObject({ applied: true, count: 7, plan });
    expect(output.files).toContain(B1);
    // [SR-071/AK3] the decision is left out and named.
    expect(output.skipped).toEqual([
      expect.objectContaining({ shortId: "D-0000e1", reason: "not-a-property" }),
    ]);
    // [SR-071/AK1] only the topic line changed.
    expect(await fs.readFile(ws.path(B1), "utf8")).toBe(before.replace("topic: Wind", "topic: Gusts"));
  });
});
