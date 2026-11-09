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

describe("stage.mjs --whats-new", () => {
  /** A copy of stage.mjs in a new Git repository, with `commits`: a subject each, and the tag it gets, if any. */
  async function repository(commits) {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "whats-new-"));
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
    await fs.writeFile(
      path.join(temporary, "package.json"),
      JSON.stringify({ version: "1.1.0", type: "module" }),
    );
    const git = (...args) =>
      execFileSync(
        "git",
        [
          "-c",
          "user.name=T",
          "-c",
          "user.email=t@example.test",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "tag.gpgsign=false",
          ...args,
        ],
        {
          cwd: temporary,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_COMMITTER_DATE: "2026-11-09T12:00:00Z",
            GIT_AUTHOR_DATE: "2026-11-09T12:00:00Z",
          },
        },
      );
    git("init", "-q");
    for (const { subject, tag } of commits) {
      git("commit", "-q", "--allow-empty", "-m", subject);
      if (tag !== undefined) {
        git("tag", tag);
      }
    }
  }
  const run = (env = {}) =>
    execFileSync(process.execPath, ["scripts/package/stage.mjs", "--whats-new", "page.md"], {
      cwd: temporary,
      encoding: "utf8",
      env: { ...process.env, REQSEQ_DOCS_RELEASES: "", ...env },
    });

  it("writes the notes of each release tag, newest first, and of the commits since the last one", async () => {
    await repository([
      { subject: "feat: first function (#1)", tag: "v1.0" },
      { subject: "fix(core): a fix (#2)" },
      { subject: "test: more tests (#3)", tag: "v1.0.1" },
      { subject: "docs: a page (#4)", tag: "v1.1.0-rc1" },
      { subject: "spec: SR-1 refined (#5)" },
    ]);
    run();
    const page = await fs.readFile(path.join(temporary, "page.md"), "utf8");
    expect(page.slice(page.indexOf("## "))).toBe(
      [
        "## Not released yet",
        "",
        "### Specification",
        "",
        "- spec: SR-1 refined (#5)",
        "",
        "## 1.0.1",
        "",
        "Released 2026-11-09.",
        "",
        "### Fixes",
        "",
        "- fix(core): a fix (#2)",
        "",
        "## 1.0",
        "",
        "Released 2026-11-09.",
        "",
        "### New",
        "",
        "- feat: first function (#1)",
        "",
      ].join("\n"),
    );
  });

  it("has no section for unreleased work on a release tag, and refuses a history without one when asked", async () => {
    await repository([{ subject: "feat: first function (#1)" }]);
    run();
    expect(await fs.readFile(path.join(temporary, "page.md"), "utf8")).toContain(
      "The history this documentation was built from holds no release.",
    );
    expect(() => run({ REQSEQ_DOCS_RELEASES: "1" })).toThrow(/no release tag or a shallow history/);
    execFileSync("git", ["tag", "v1.0"], { cwd: temporary });
    run({ REQSEQ_DOCS_RELEASES: "1" });
    const page = await fs.readFile(path.join(temporary, "page.md"), "utf8");
    expect(page).toContain("## 1.0");
    expect(page).not.toContain("Not released yet");
    // A shallow clone of the tag has the tag but not the history before it.
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "fix: x"], {
      cwd: temporary,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@example.test",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@example.test",
      },
    });
    execFileSync("git", ["tag", "v1.1"], { cwd: temporary });
    const clone = path.join(temporary, "clone");
    execFileSync("git", ["clone", "-q", "--depth", "1", "--branch", "v1.1", `file://${temporary}`, clone]);
    await fs.cp(path.join(temporary, "scripts"), path.join(clone, "scripts"), { recursive: true });
    await fs.cp(path.join(temporary, "toolchain"), path.join(clone, "toolchain"), { recursive: true });
    await fs.cp(path.join(temporary, "package.json"), path.join(clone, "package.json"));
    expect(() =>
      execFileSync(process.execPath, ["scripts/package/stage.mjs", "--whats-new", "page.md"], {
        cwd: clone,
        encoding: "utf8",
        env: { ...process.env, REQSEQ_DOCS_RELEASES: "1" },
      }),
    ).toThrow(/a shallow history/);
  });
});
