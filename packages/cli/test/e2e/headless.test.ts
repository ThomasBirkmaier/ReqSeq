// The command line without a graphical interface (SR-080 AK3): the built binary with no display set
// reads, writes and checks a fixture workspace, and nothing it loads depends on the app's interface.
// Every catalog command runs through the CLI in the cross-access suite, which needs no display either.
// Run after `pnpm build` with `pnpm test:e2e`.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fileSha256, reqseq, requireBuiltCli } from "../support/reqseq.js";

const packagesDir = fileURLToPath(new URL("../../../", import.meta.url));

/** No display of X11 or Wayland, as on a server or in a container. */
const HEADLESS = { DISPLAY: "", WAYLAND_DISPLAY: "" };

/** The interface packages; none may be among what the CLI loads. */
const INTERFACE = ["@reqseq/app", "electron", "react", "react-dom"];

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

/** The runtime dependencies of a package of this repository, and of its own packages in turn. */
const dependenciesOf = (name: string, seen = new Set<string>()): Set<string> => {
  const manifest = JSON.parse(
    readFileSync(path.join(packagesDir, name.replace("@reqseq/", ""), "package.json"), "utf8"),
  ) as { readonly dependencies?: Readonly<Record<string, string>> };
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    if (!seen.has(dependency)) {
      seen.add(dependency);
      if (dependency.startsWith("@reqseq/")) {
        dependenciesOf(dependency, seen);
      }
    }
  }
  return seen;
};

describe("the command line without a graphical interface", () => {
  it("[SR-080/AK3] reads, writes and checks a workspace with no display, and loads nothing of the app", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-069/filter" });
    fixtures.push(ws);
    const run = (args: readonly string[]) => reqseq(args, { cwd: ws.root, env: HEADLESS });

    const listed = await run(["element", "list", "--json"]);
    expect([listed.code, listed.stderr]).toEqual([0, ""]);
    expect((JSON.parse(listed.stdout) as { total: number }).total).toBeGreaterThan(0);

    const sha = await fileSha256("SR-0000b1", { cwd: ws.root, env: HEADLESS });
    const updated = await run([
      "element",
      "update",
      "SR-0000b1",
      "--title",
      "Show the wind headless",
      "--expected-file-sha256",
      sha,
    ]);
    expect([updated.code, updated.stderr]).toEqual([0, ""]);
    const got = await run(["element", "get", "SR-0000b1", "--json"]);
    expect((JSON.parse(got.stdout) as { element: { title: string } }).element.title).toBe(
      "Show the wind headless",
    );

    const checked = await run(["workspace", "check", "--json"]);
    expect(checked.stderr).toBe("");
    expect(JSON.parse(checked.stdout)).toHaveProperty("checkedElements");

    const loaded = dependenciesOf("@reqseq/cli");
    expect(loaded).toContain("@reqseq/core");
    expect(INTERFACE.filter((name) => loaded.has(name))).toEqual([]);
  });
});
