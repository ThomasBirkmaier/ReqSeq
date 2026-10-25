// The model cache from the command line (ADR-0008, SR-082): the same command run twice on a copy
// whose files are older than the racy window gives exactly the same output, the second time from
// the cache. The fixtures hold value kinds that YAML resolves to other types than JSON knows
// (`!!timestamp`, `!!binary`, `!!set`, `!!omap`, `.inf`, an alias that contains itself), whose
// findings must not change once a cache exists. Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cliEnv, logreq, requireBuiltCli } from "../support/logreq.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const ODD_VALUES = `---
id: 7d3c1a2b-4e5f-4a6b-8c7d-9e0f1a2b3c4d
type: system-requirement
status: draft
title: Odd values
priority: !!timestamp 2026-10-24
rationale: !!binary aGVsbG8=
tags: !!set { a: null }
notes: !!omap [ { a: 1 } ]
weight: .inf
loop: &x [*x]
---
Text.
`;

/**
 * Every file of the fixture a minute old, so the cache trusts it; then waits until the change times
 * (now, from `utimes`) lie more than the racy window (2 s, ADR-0008) back.
 */
const age = async (ws: FixtureWorkspace): Promise<void> => {
  const when = new Date(Date.now() - 60_000);
  for (const entry of await fs.readdir(ws.root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      await fs.utimes(path.join(entry.parentPath, entry.name), when, when);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2_100));
};

describe("logreq with the model cache (SR-082)", () => {
  it.each([
    ["SR-019/findings", ""],
    ["SR-085/value-kinds", "system/"],
    ["SR-089/missing-targets", "system/"],
  ])("gives the same workspace check twice on %s, the second time from the cache", async (name, main) => {
    const ws = await createFixtureWorkspace({
      fixture: name,
      files: { [`${main}odd/odd-values.md`]: ODD_VALUES },
    });
    const cwd = main === "" ? ws.root : ws.path(main.slice(0, -1));
    cleanups.push(() => ws.cleanup());
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-model-cache-home-"));
    cleanups.push(() => fs.rm(home, { recursive: true, force: true }));
    await age(ws);
    const env = cliEnv(home) as Record<string, string>;
    const first = await logreq(["workspace", "check", "--json"], { cwd, env });
    // The cache folder of the OS user lies in `home` on every OS (cliEnv).
    const cached = (await fs.readdir(home, { recursive: true })).filter((file) =>
      file.endsWith("model.json"),
    );
    expect(cached).toHaveLength(1);
    // The regular files of the fixture have entries; the file with the odd values has none.
    const model = JSON.parse(await fs.readFile(path.join(home, cached[0] ?? ""), "utf8")) as {
      repositories: { files: [string, ...unknown[]][] }[];
    };
    const entries = model.repositories.flatMap((repository) => repository.files.map(([file]) => file));
    expect(entries.filter((file) => file.endsWith(".md")).length).toBeGreaterThan(0);
    expect(entries.filter((file) => file.endsWith("odd-values.md"))).toEqual([]);
    const second = await logreq(["workspace", "check", "--json"], { cwd, env });
    expect(second).toStrictEqual(first);
    expect(first.stderr).toBe("");
    expect(JSON.stringify(first.stdout)).toContain("odd-values.md");
  });
});
