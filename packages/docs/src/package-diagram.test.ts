import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packageDiagram, readPackages, workspacePackages } from "./package-diagram.js";

const PACKAGES = workspacePackages([
  { dir: "kit", manifest: { name: "@x/kit" } },
  {
    dir: "core",
    manifest: { name: "@x/core", dependencies: { yaml: "1" }, devDependencies: { "@x/kit": "*" } },
  },
  { dir: "cli", manifest: { name: "@x/cli", dependencies: { "@x/core": "*", "@x/kit": "*" } } },
  { dir: "api", manifest: { name: "@x/api", dependencies: { "@x/core": "*" } } },
  {
    dir: "docs",
    manifest: { name: "@x/docs", dependencies: { "@x/cli": "*", "@x/api": "*", "@x/core": "*" } },
  },
]);

describe("workspacePackages", () => {
  it("splits workspace dependencies, marked dev or not, from external runtime ones", () => {
    expect(PACKAGES[1]).toEqual({
      dir: "core",
      name: "@x/core",
      uses: [{ name: "@x/kit", dev: true }],
      external: ["yaml"],
    });
  });
});

describe("readPackages", () => {
  it("reads packages/*/package.json in folder order and skips folders without one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reqseq-packages-"));
    try {
      for (const name of ["b", "a", "empty"]) {
        await mkdir(join(dir, "packages", name), { recursive: true });
      }
      await writeFile(join(dir, "packages", "notes.txt"), "");
      await writeFile(join(dir, "packages", "b", "package.json"), JSON.stringify({ name: "@x/b" }));
      await writeFile(join(dir, "packages", "a", "package.json"), JSON.stringify({ name: "@x/a" }));
      expect((await readPackages(dir)).map((p) => p.dir)).toEqual(["a", "b"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("packageDiagram", () => {
  it("draws each package once and an arrow only for a dependency that no other package implies", () => {
    const svg = packageDiagram(PACKAGES);
    for (const name of ["@x/kit", "@x/core", "@x/cli", "@x/api", "@x/docs"]) {
      expect(svg).toContain(`>${name}<`);
    }
    expect(svg).toContain(">uses api, cli, core<");
    expect(svg).toContain(">uses no workspace package<");
    expect(svg).toContain(">external: none<");
    // docs → cli, docs → api, cli → core, api → core, core → kit (dev); docs → core and cli → kit are implied.
    expect(svg.match(/marker-end/g)).toHaveLength(5);
    expect(svg.match(/class="arr dev"/g)).toHaveLength(1);
  });

  it("refuses a dependency on a package it does not draw", () => {
    expect(() =>
      packageDiagram([{ dir: "a", name: "@x/a", uses: [{ name: "@x/b", dev: false }], external: [] }]),
    ).toThrow("@x/b is not a workspace package");
  });
});
