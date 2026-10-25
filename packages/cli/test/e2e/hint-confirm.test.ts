// `logreq hint confirm` end to end (SR-027, ADR-0009): the built binary with the product commands on
// fixtures/SR-025/outdated, its exit code, its JSON and the files it writes. Confirming in the app
// comes with the app in stage 3 (#127 option 1); core and this test cover the function now.
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

const logreq = (args: readonly string[], cwd: string): Promise<Run> => run(args, { cwd });

interface Hint {
  readonly code: string;
  readonly severity: string;
  readonly hintId?: string;
  readonly storedVersion?: string;
  readonly currentVersion?: string;
}

interface Confirmed {
  readonly confirmed: readonly string[];
  readonly files: readonly string[];
  readonly problems?: readonly Hint[];
}

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const A_FILE = "requirements/SR-0b0000000001.md";

/** fixtures/SR-025/outdated as a Git repository, with the need and the variant changed and committed. */
const changed = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-025/outdated", git: true });
  fixtures.push(ws);
  for (const file of ["needs/N-0a0000000001.md", "variants/V-0c0000000001.md"]) {
    await fs.writeFile(ws.path(file), `${await fs.readFile(ws.path(file), "utf8")}Changed.\n`);
  }
  await ws.commit();
  return ws;
};

const hints = async (ws: FixtureWorkspace): Promise<Hint[]> => {
  const out = await logreq(["hint", "list", "--kind", "relation.outdated", "--json"], ws.root);
  return (JSON.parse(out.stdout) as { readonly hints: Hint[] }).hints;
};

describe("logreq hint confirm (SR-027)", () => {
  it("[SR-027/AK1] [SR-027/AK2] confirms several hints, each on its own, and reports an ID that confirms nothing with exit code 1", async () => {
    const ws = await changed();
    const [validity, derives, link] = await hints(ws);
    const before = await fs.readFile(ws.path(A_FILE), "utf8");
    const args = [
      "hint",
      "confirm",
      "--hint-ids",
      validity?.hintId ?? "",
      "--hint-ids",
      derives?.hintId ?? "",
    ];
    const out = await logreq([...args, "--hint-ids", "element.unknown-property", "--json"], ws.root);
    expect([out.code, out.stderr]).toEqual([1, ""]);
    expect(JSON.parse(out.stdout) as Confirmed).toEqual({
      confirmed: [validity?.hintId, derives?.hintId],
      files: [A_FILE],
      problems: [expect.objectContaining({ code: "hint.not-confirmable", severity: "error" })],
    });
    let expected = before;
    for (const hint of [validity, derives]) {
      expected = expected.replace(hint?.storedVersion ?? "", hint?.currentVersion ?? "");
    }
    expect(await fs.readFile(ws.path(A_FILE), "utf8")).toBe(expected);
    expect((await hints(ws)).map((h) => h.hintId)).toEqual([link?.hintId]);
    // A stale ID is a warning: nothing to write, exit code 0.
    const again = await logreq(["hint", "confirm", "--hint-ids", derives?.hintId ?? ""], ws.root);
    expect([again.code, again.stderr]).toEqual([0, ""]);
    expect(again.stdout).toContain("hint.not-found");
  });

  it("[SR-027/AK3] shows the new version as a normal change in Git, only on the line of the relation", async () => {
    const ws = await changed();
    const derives = (await hints(ws))[1];
    const out = await logreq(["hint", "confirm", "--hint-ids", derives?.hintId ?? ""], ws.root);
    expect([out.code, out.stderr]).toEqual([0, ""]);
    expect(await ws.git(["status", "--porcelain"])).toBe(` M ${A_FILE}\n`);
    const diff = await ws.git(["diff", "--unified=0", "--no-color"]);
    expect(diff.split("\n").filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l))).toEqual([
      `-  - { id: 5e025a7d-2b4f-4c61-9d08-0a0000000001, version: ${derives?.storedVersion ?? ""}, title: See the wind }`,
      `+  - { id: 5e025a7d-2b4f-4c61-9d08-0a0000000001, version: ${derives?.currentVersion ?? ""}, title: See the wind }`,
    ]);
  });
});
