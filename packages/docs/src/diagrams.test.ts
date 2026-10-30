import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REQUIRED_CHECKS, readWorkflows } from "./ci-diagram.js";
import { DIAGRAMS_COMMAND, architectureDiagrams, writeDiagrams } from "./diagrams.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("architecture diagrams", () => {
  it("are committed as the sources draw them today", async () => {
    for (const { path, text } of await architectureDiagrams(repoRoot)) {
      const committed = await readFile(join(repoRoot, path), "utf8").catch(() => "");
      expect(committed === text, `${path} is stale: run \`${DIAGRAMS_COMMAND}\` and commit it`).toBe(true);
    }
  });

  it("are embedded in docs/architecture/README.md", async () => {
    const readme = await readFile(join(repoRoot, "docs", "architecture", "README.md"), "utf8");
    expect(readme).toContain("](ci.svg)");
    expect(readme).toContain("](packages.svg)");
  });

  it("mark only required checks that are jobs of ci.yml", async () => {
    const ci = (await readWorkflows(repoRoot)).find((workflow) => workflow.file === "ci.yml");
    const names = ci?.runs.map((run) => run.name) ?? [];
    expect(REQUIRED_CHECKS.filter((name) => !names.includes(name))).toEqual([]);
  });

  it("are written into the repository by the command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reqseq-diagrams-"));
    try {
      await mkdir(join(dir, ".github", "workflows"), { recursive: true });
      await mkdir(join(dir, "packages", "a"), { recursive: true });
      await mkdir(join(dir, "docs", "architecture"), { recursive: true });
      await writeFile(
        join(dir, ".github", "workflows", "ci.yml"),
        "on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n",
      );
      await writeFile(join(dir, "packages", "a", "package.json"), JSON.stringify({ name: "@x/a" }));
      expect(await writeDiagrams(dir)).toEqual([
        "docs/architecture/ci.svg",
        "docs/architecture/packages.svg",
      ]);
      expect(await readFile(join(dir, "docs", "architecture", "packages.svg"), "utf8")).toContain(">@x/a<");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
