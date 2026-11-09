import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..", "..");
const STATIC_IMPORT = /^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"|^import\s+"([^"]+)"/gm;

/** The specifiers of the static imports of `file` and of the local modules it imports, by file. */
async function staticImports(file, seen = new Map()) {
  if (seen.has(file)) {
    return seen;
  }
  const specifiers = [...(await fs.readFile(file, "utf8")).matchAll(STATIC_IMPORT)].map((m) => m[1] ?? m[2]);
  seen.set(file, specifiers);
  for (const specifier of specifiers.filter((s) => s.startsWith("."))) {
    await staticImports(path.resolve(path.dirname(file), specifier), seen);
  }
  return seen;
}

let temporary;
afterEach(async () => {
  if (temporary !== undefined) {
    await fs.rm(temporary, { recursive: true, force: true });
    temporary = undefined;
  }
});

// The release job runs `--check-tag` and `--release-notes` before any install (release.yml, job `release`).
describe("stage.mjs without installed packages", () => {
  it("imports only node: modules and local files statically", async () => {
    const graph = await staticImports(path.join(root, "scripts", "package", "stage.mjs"));
    const packages = [...graph].flatMap(([file, specifiers]) =>
      specifiers
        .filter((s) => !s.startsWith(".") && !s.startsWith("node:"))
        .map((s) => `${path.relative(root, file)}: ${s}`),
    );
    expect(packages).toEqual([]);
  });

  it("runs --check-tag from a copy with no node_modules anywhere above it", async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "stage-"));
    for (const folder of ["scripts/package", "scripts/licenses"]) {
      await fs.cp(path.join(root, folder), path.join(temporary, folder), {
        recursive: true,
        filter: (source) => !source.includes("node_modules") && !source.endsWith(".test.mjs"),
      });
    }
    await fs.cp(
      path.join(root, "toolchain", "packaging", "names.json"),
      path.join(temporary, "toolchain", "packaging", "names.json"),
    );
    const { version } = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    await fs.writeFile(path.join(temporary, "package.json"), JSON.stringify({ version, type: "module" }));
    const output = execFileSync(
      process.execPath,
      ["scripts/package/stage.mjs", "--check-tag", `v${version}`],
      {
        cwd: temporary,
        encoding: "utf8",
      },
    );
    expect(output.trim()).toBe(`v${version} releases ${version}`);
  });
});
