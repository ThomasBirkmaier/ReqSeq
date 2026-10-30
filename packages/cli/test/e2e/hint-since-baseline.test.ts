// The core requirements changed since a variant's newest baseline end to end (SR-103, ADR-0009):
// `reqseq baseline create` of the view of Coast on fixtures/SR-103/since-baseline, a change of the
// adopted core requirement K1, then `reqseq hint list`, `reqseq workspace check`, `reqseq hint
// confirm` and a new baseline. Their place on the page of the variant in the app comes with C7.
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const reqseq = (args: readonly string[], cwd: string): Promise<Run> => run(args, { cwd });

const P = "10310310-0000-4000-8000-0000000000";
const CHANGED = "variant.core-changed-since-baseline";

interface Hint {
  readonly code: string;
  readonly elementId: string;
  readonly targetId: string;
  readonly storedVersion?: string;
  readonly currentVersion?: string;
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

/** The fixture with a baseline R1 of Coast, then K1 changed and committed. */
const changedSinceR1 = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-103/since-baseline", git: true });
  fixtures.push(ws);
  const created = await reqseq(
    ["baseline", "create", "R1", "--input", '{"selection":{"view":"VAR-0000c1"}}'],
    ws.root,
  );
  expect([created.code, created.stderr]).toEqual([0, ""]);
  const file = ws.path("requirements/SR-0000000000a1.md");
  await fs.writeFile(
    file,
    (await fs.readFile(file, "utf8")).replace("every minute.\n", "every 30 seconds.\n"),
  );
  await ws.commit();
  return ws;
};

const hintsOf = async (ws: FixtureWorkspace, ...args: string[]): Promise<readonly Hint[]> => {
  const listed = await reqseq(["hint", "list", ...args, "--json"], ws.root);
  expect([listed.code, listed.stderr]).toEqual([0, ""]);
  return (JSON.parse(listed.stdout) as { readonly hints: readonly Hint[] }).hints.filter((h) =>
    h.code.endsWith("-since-baseline"),
  );
};

describe("reqseq hints since a variant's newest baseline (SR-103)", () => {
  it("[SR-103/AK1] an adopted core requirement changed since A's newest baseline is a hint at A with both versions", async () => {
    const ws = await changedSinceR1();
    const hints = await hintsOf(ws, "--variant", "VAR-0000c1");
    expect(hints.map((h) => [h.code, h.elementId, h.targetId, h.storedVersion])).toEqual([
      [CHANGED, `${P}c1`, `${P}a1`, "n1:c44c2a59a7eba159"],
    ]);
    expect(hints[0]?.currentVersion).toMatch(/^n1:/);
    // Mountain has no baseline (AK3), and Coast's hint is not Mountain's.
    expect(await hintsOf(ws, "--variant", "VAR-0000c2")).toEqual([]);
    const check = await reqseq(["workspace", "check"], ws.root);
    expect(check.code).toBe(0);
    expect(check.stdout).toContain(
      "Core requirement System Requirement SR-0000a1, which Variant VAR-0000c1 adopts, has changed since its newest baseline R1: version n1:c44c2a59a7eba159 there",
    );
  });

  it("[SR-103/AK2] a new baseline of A clears the hint", async () => {
    const ws = await changedSinceR1();
    const created = await reqseq(
      ["baseline", "create", "R2", "--input", '{"selection":{"view":"VAR-0000c1"}}'],
      ws.root,
    );
    expect(created.code).toBe(0);
    expect(await hintsOf(ws)).toEqual([]);
  });

  it("[SR-103/AK5] hint.confirm of the hint is refused: a new baseline settles it", async () => {
    const ws = await changedSinceR1();
    const before = await fs.readFile(ws.path("variants/VAR-0000000000c1.md"), "utf8");
    const refused = await reqseq(["hint", "confirm", "--ref", "VAR-0000c1", "--kind", CHANGED], ws.root);
    expect(refused.code).toBe(1);
    expect(`${refused.stdout}${refused.stderr}`).toContain(
      `kind ${CHANGED} is not confirmed: a ${CHANGED} hint is settled only by a new baseline of its variant`,
    );
    expect(await fs.readFile(ws.path("variants/VAR-0000000000c1.md"), "utf8")).toBe(before);
    expect(await hintsOf(ws)).toHaveLength(1);
  });
});
