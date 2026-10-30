// `reqseq baseline create` end to end (SR-050): the built binary on fixtures/SR-061/export (Git
// repositories `system` and `sensor`, cwd `system`). The exact file text: core create.test.ts.
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const ID = "61061061-0000-4000-8000-0000000000";

const fixture = async (git: FixtureOptions["git"] = ["system", "sensor"]): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-061/export", git });
  fixtures.push(ws);
  return ws;
};

/** `reqseq baseline create <name> --input <selection> --json` with cwd `system`. */
const create = (ws: FixtureWorkspace, name: string, selection: object): Promise<Run> =>
  run(["baseline", "create", name, "--input", JSON.stringify({ selection }), "--json"], {
    cwd: ws.path("system"),
  });

const read = (ws: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(ws.path(`system/${file}`), "utf8");

/** The error a refused call printed (exit 2). */
const refusal = (result: Run): { code: string; message: string; details?: unknown } => {
  expect(result.code).toBe(2);
  return JSON.parse(result.stdout || result.stderr) as { code: string; message: string; details?: unknown };
};

describe("reqseq baseline create", () => {
  it("[SR-050/AK1] baseline.create writes a file in the baseline folder with name, date, commits and id plus version", async () => {
    const ws = await fixture();
    const head = await ws.head("system");
    const result = await create(ws, "Release 2", { package: "PKG-0000d1" });
    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout) as { files: string[]; baseline: { date: string } };
    expect(out.files).toEqual(["baselines/Release-2.yaml"]);
    const text = await read(ws, "baselines/Release-2.yaml");
    expect(text).toContain(
      `name: Release 2\ndate: ${out.baseline.date}\nselection:\n  package: { id: ${ID}d1, title: Display }\n`,
    );
    expect(text).toContain(
      `repositories:\n  - { name: system, commit: ${head} }\nelements:\n  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }\n`,
    );
    // Never committed: HEAD and the index stay, the file is new (SR-083).
    expect(await ws.head("system")).toBe(head);
    expect(await ws.git(["status", "--porcelain"], "system")).toBe("?? baselines/Release-2.yaml\n");
  });

  it("[SR-050/AK2] uncommitted or never committed files of the selection, embedded files, metamodel or workspace file refuse the baseline; evidence records do not", async () => {
    const ws = await fixture();
    await fs.appendFile(ws.path("system/requirements/SR-0000000000b1.md"), "edited\n");
    await fs.appendFile(ws.path("system/metamodel/standard-model.yaml"), "# edited\n");
    const error = refusal(await create(ws, "Changed", { package: "PKG-0000d1" }));
    expect(error).toMatchObject({
      code: "baseline.uncommitted-changes",
      details: {
        elements: [{ id: `${ID}b1`, repository: "system", file: "requirements/SR-0000000000b1.md" }],
        files: [{ repository: "system", file: "metamodel/standard-model.yaml" }],
      },
    });
    expect(error.message).toContain("SR-0000b1 (requirements/SR-0000000000b1.md)");
  });

  it("[SR-050/AK4] R1 in system and R2 in sensor give the commits of system and sensor once each", async () => {
    const ws = await fixture();
    const result = await create(ws, "Both", { ids: ["SR-0000b1", "SR-0000e1"] });
    expect(result.code).toBe(0);
    expect(await read(ws, "baselines/Both.yaml")).toContain(
      `repositories:\n  - { name: system, commit: ${await ws.head("system")} }\n  - { name: sensor, commit: ${await ws.head("sensor")} }\nelements:\n`,
    );
  });

  it("[SR-050/AK6] a second baseline „Release 1“ is refused naming the existing file, nothing overwritten", async () => {
    const ws = await fixture();
    const before = await read(ws, "baselines/release-1.yaml");
    expect(refusal(await create(ws, "Release 1", { package: "PKG-0000d1" }))).toMatchObject({
      code: "baseline.exists",
      details: { file: "baselines/release-1.yaml", repository: "system" },
    });
    expect(await read(ws, "baselines/release-1.yaml")).toBe(before);
    expect((await fs.readdir(ws.path("system/baselines"))).sort()).toEqual(["broken.yaml", "release-1.yaml"]);
  });

  it("[SR-050/AK7] a repository without a commit refuses the baseline naming it", async () => {
    const ws = await fixture(["system"]);
    await ws.git(["init", "-q"], "sensor");
    const error = refusal(await create(ws, "Sensor", { ids: ["SR-0000e1"] }));
    expect(error).toMatchObject({ code: "git.unavailable", details: { repository: "sensor" } });
    expect(error.message).toContain("repository sensor has no commit");
  });
});
