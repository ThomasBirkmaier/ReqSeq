// `reqseq baseline get` and `reqseq baseline compare` end to end (SR-051): the built binary on
// fixtures/SR-061/export (Git repositories `system` and `sensor`, cwd `system`). The baseline
// „Release 2“ of PKG-0000d1 is written at the first commit; a second commit changes SR-0000b1,
// supersedes SR-0000b2, adds SR-0000b3 to the package and changes N-0000a1. `release-1.yaml` stores
// no selection. Every state and error: core commands/baseline/get.test.ts.
// Run after `pnpm build` with `pnpm test:e2e`.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const execFileAsync = promisify(execFile);
const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const ID = "61061061-0000-4000-8000-0000000000";

const edit = async (ws: FixtureWorkspace, file: string, from: string, to: string): Promise<void> => {
  const at = ws.path(`system/${file}`);
  await fs.writeFile(at, (await fs.readFile(at, "utf8")).replace(from, to));
};

/** The fixture of the file comment, with the commits of `system`. */
const fixture = async (): Promise<{ ws: FixtureWorkspace; first: string; second: string }> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-061/export", git: ["system", "sensor"] });
  fixtures.push(ws);
  const first = await ws.head("system");
  await ws.write(
    "system/baselines/Release-2.yaml",
    [
      "reqseq-baseline: 1",
      "name: Release 2",
      "date: 2026-11-02T13:00:00Z",
      "selection:",
      `  package: { id: ${ID}d1, title: Display }`,
      "repositories:",
      `  - { name: system, commit: ${first} }`,
      "elements:",
      `  - { id: ${ID}a1, version: n1:9d97d0ccf9b75591 }`,
      `  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }`,
      `  - { id: ${ID}b2, version: n1:077d46fbf1a6a93d }`,
      "",
    ].join("\n"),
  );
  await edit(ws, "requirements/SR-0000000000b1.md", "shows the speed.", "shows the speed in knots.");
  await edit(ws, "requirements/SR-0000000000b2.md", "status: draft", "status: obsolete");
  await edit(
    ws,
    "requirements/SR-0000000000b3.md",
    "validity:",
    `packages:\n  - { id: ${ID}d1, version: n1:5862e4d618683af6 }\nvalidity:`,
  );
  await edit(ws, "needs/N-0000000000a1.md", "a1: the need", "a1: the changed need");
  const second = await ws.commit("system", "change");
  return { ws, first, second };
};

interface Shown {
  readonly selectionKnown: boolean;
  readonly elements: readonly {
    id: string;
    state: string;
    version?: string;
    versionDate?: string | null;
    current?: string;
  }[];
  readonly counts: Readonly<Record<string, number>>;
}

const get = async (ws: FixtureWorkspace, name: string): Promise<Shown> => {
  const result = await run(["baseline", "get", name, "--json"], { cwd: ws.path("system") });
  expect(result.code).toBe(0);
  return JSON.parse(result.stdout) as Shown;
};

const state = (shown: Shown, tail: string): Shown["elements"][number] | undefined =>
  shown.elements.find((e) => e.id === `${ID}${tail}`);

describe("reqseq baseline get", () => {
  it("[SR-051/AK1] baseline.get shows each element with its baseline version and that version's date", async () => {
    const { ws, first } = await fixture();
    const seconds = Number((await ws.git(["log", "-1", "--format=%ct", first], "system")).trim());
    const date = `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`;
    const shown = await get(ws, "Release 2");
    expect(state(shown, "b1")).toMatchObject({ version: "n1:697a2ad17ed49170", versionDate: date });
    // The readable output names the version and its date, and no old content.
    const human = await run(["baseline", "get", "Release 2"], { cwd: ws.path("system") });
    expect(human.stdout).toContain(
      `- id: SR-0000b1  Show the wind speed\n    repository: system\n    state: changed\n    version: n1:697a2ad17ed49170\n`,
    );
    expect(human.stdout).toContain(`versionDate: ${date}`);
    expect(human.stdout).not.toContain("then it shows the speed.");
  });

  it("[SR-051/AK2] baseline.get marks SR-X changed, SR-Y superseded, SR-Z added; without stored selection no added and it says so", async () => {
    const { ws } = await fixture();
    const shown = await get(ws, "Release 2");
    expect([state(shown, "b1")?.state, state(shown, "b2")?.state, state(shown, "b3")?.state]).toEqual([
      "changed",
      "superseded",
      "added",
    ]);
    const without = await get(ws, "release-1");
    expect(without.selectionKnown).toBe(false);
    expect(without.counts["added"]).toBe(0);
    const human = await run(["baseline", "get", "release-1"], { cwd: ws.path("system") });
    expect(human.stdout).toContain("selectionKnown: false");
  });

  it("[SR-051/AK3] baseline.get marks SR-W removed; without stored selection no removed", async () => {
    const { ws } = await fixture();
    const a1 = state(await get(ws, "Release 2"), "a1");
    expect(a1).toMatchObject({ state: "removed", version: "n1:9d97d0ccf9b75591" });
    expect(a1?.current).toMatch(/^n1:/);
    expect((await get(ws, "release-1")).counts["removed"]).toBe(0);
  });
});

describe("reqseq baseline compare", () => {
  it("[SR-051/AK4] baseline.compare gives both commits and the git command", async () => {
    const { ws, first, second } = await fixture();
    const result = await run(["baseline", "compare", "Release 2", "SR-0000b1", "--json"], {
      cwd: ws.path("system"),
    });
    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout) as { from: string; to: string; command: string[] };
    const file = "requirements/SR-0000000000b1.md";
    expect(out).toMatchObject({
      from: first,
      to: second,
      command: ["git", "-C", ".", "diff", first, second, "--", file],
    });
    // The command, run in the workspace root, shows the change of SR-0000b1.
    const [program, ...args] = out.command;
    const diff = await execFileAsync(String(program), args, { cwd: ws.path("system") });
    expect(diff.stdout).toContain(
      "+  - Given wind, when the station measures it, then it shows the speed in knots.",
    );
  });
});
