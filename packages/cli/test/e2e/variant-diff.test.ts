// variant diff end to end (SR-044, SR-041 AK8): the built binary on fixtures/SR-043/example, where
// variant A (VAR-0000c1) replaces K1 (SR-0000a1) by A1 (SR-0000b1), excludes K2 (SR-0000a2) and adds
// A2 (SR-0000b2). Run after `pnpm build` with `pnpm test:e2e`.
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const P = "43043043-0000-4000-8000-0000000000";
const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const workspace = async (files: Readonly<Record<string, string>> = {}): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-043/example", files });
  fixtures.push(ws);
  return ws;
};

describe("variant diff (SR-044)", () => {
  it("[SR-044/AK1] variant diff of A lists added A2, replaced K1 by A1 and excluded K2", async () => {
    const ws = await workspace();
    const result = await run(["variant", "diff", "VAR-0000c1"], { cwd: ws.root });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toBe(
      [
        "added:",
        "  SR-0000b2  Warn of storms",
        "replaced:",
        "  - core: SR-0000a1  Response time at most 10 ms",
        "    replacement: SR-0000b1  Response time at most 20 ms",
        "excluded:",
        "  SR-0000a2  Measure the wind",
        "",
      ].join("\n"),
    );
  });

  it("[SR-044/AK3] a replaced row names the IDs of core requirement and replacement", async () => {
    const ws = await workspace();
    const result = await run(["variant", "diff", "VAR-0000c1", "--json"], { cwd: ws.root });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    const output = JSON.parse(result.stdout) as { replaced: unknown };
    expect(output.replaced).toEqual([{ core: `${P}a1`, replacement: `${P}b1` }]);
  });

  it("[SR-041/AK8] variant diff of A lists SR-A, whose replaces names no core requirement, as added", async () => {
    const ws = await workspace({
      "requirements/SR-0000000000b3.md":
        `---\nid: ${P}b3\ntype: system-requirement\nstatus: draft\ntitle: Report gusts\n` +
        `validity: [{ id: ${P}c1 }]\nreplaces: [{ id: ${P}d1 }]\n---\n`,
    });
    const result = await run(["variant", "diff", "VAR-0000c1"], { cwd: ws.root });
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(result.stdout).toContain(
      "added:\n  SR-0000b2  Warn of storms\n  SR-0000b3  Report gusts\nreplaced:",
    );
    expect(result.stdout).toContain(
      "warning  variant.target-not-core  system:requirements/SR-0000000000b3.md:7  System Requirement SR-0000b3 replaces Need N-0000d1",
    );
  });

  it("refuses an element that is no variant", async () => {
    const ws = await workspace();
    const result = await run(["variant", "diff", "SR-0000a1"], { cwd: ws.root });
    expect([result.code, result.stdout]).toEqual([2, ""]);
    expect(result.stderr).toContain("input.invalid: SR-0000a1 is no variant");
  });
});
