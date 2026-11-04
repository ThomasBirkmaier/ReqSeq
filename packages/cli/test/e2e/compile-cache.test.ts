// Node's compile cache of the CLI (#178): the built binary fills `<OS cache>/reqseq/node-compile-cache`,
// and writes nothing there with NODE_DISABLE_COMPILE_CACHE. Each run gets its own home and OS cache
// folder, so the real cache of the user or the runner stays untouched. Run after `pnpm build` with
// `pnpm test:e2e`.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileCacheFolder } from "@reqseq/core/os-cache";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

// Node reads NODE_DISABLE_COMPILE_CACHE even when it is empty, so one of the outer environment is
// removed for the spawned CLIs of this file (they get this process's environment) and put back after.
const disabled = process.env["NODE_DISABLE_COMPILE_CACHE"];
beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
  delete process.env["NODE_DISABLE_COMPILE_CACHE"];
});
afterAll(() => {
  if (disabled !== undefined) {
    process.env["NODE_DISABLE_COMPILE_CACHE"] = disabled;
  }
});

/** `reqseq --version` in a fresh home, and the compile cache folder of that home. */
const versionIn = async (env: Readonly<Record<string, string>> = {}) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reqseq-compile-cache-"));
  homes.push(home);
  const homeEnv = { HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home };
  // An empty NODE_COMPILE_CACHE counts as unset, so a folder of the outer environment does not win.
  const out = await run(["--version"], { cwd: home, env: { ...homeEnv, NODE_COMPILE_CACHE: "", ...env } });
  const folder = compileCacheFolder({ platform: process.platform, env: homeEnv, home });
  const entries = await readdir(folder, { recursive: true }).catch(() => []);
  return { out, entries };
};

describe("compile cache of the CLI (#178)", () => {
  it("fills the per-user folder, and stays off with NODE_DISABLE_COMPILE_CACHE", async () => {
    const on = await versionIn();
    expect([on.out.code, on.out.stderr]).toEqual([0, ""]);
    expect(on.entries.length).toBeGreaterThan(0);
    const off = await versionIn({ NODE_DISABLE_COMPILE_CACHE: "1" });
    expect([off.out.code, off.out.stdout]).toEqual([0, on.out.stdout]);
    expect(off.entries).toEqual([]);
  });
});
