#!/usr/bin/env node
// Merges origin/main into the current branch and resolves conflicts in generated files by
// regenerating them (#392): parallel PRs that each add catalog commands always conflict there.
// Usage: merge-main.mjs   (needs no tracked changes; git itself refuses to overwrite untracked files)
// Conflicts in other files are left for you; resolve them, then run `pnpm contracts:generate`,
// `git add` and `git commit`. The script never pushes.
import { execFileSync, spawnSync } from "node:child_process";

const GENERATED = ["schemas/generated/", "packages/core/src/generated/"];
const isGenerated = (file) => GENERATED.some((prefix) => file.startsWith(prefix));
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const generatedChanged = () => spawnSync("git", ["diff", "--quiet", "--", ...GENERATED]).status !== 0;
// `shell` lets Windows find pnpm.cmd.
const regenerate = () => execFileSync("pnpm", ["contracts:generate"], { stdio: "inherit", shell: true });

if (git("status", "--porcelain", "--untracked-files=no") !== "") {
  console.error("Commit or stash your changes first; merge-main needs a clean working tree.");
  process.exit(1);
}
git("fetch", "origin", "main");
const merge = spawnSync("git", ["merge", "--no-edit", "origin/main"], { stdio: "inherit" });
if (merge.status === 0) {
  // A clean merge can still leave generated files out of date (both sides changed the catalog).
  regenerate();
  if (generatedChanged()) {
    git("commit", "-m", "chore: regenerate contracts after merging main", "--", ...GENERATED);
  }
  process.exit(0);
}
if (spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status !== 0) {
  // The merge did not start (for example, untracked files would be overwritten); git said why.
  process.exit(merge.status ?? 1);
}

const conflicted = git("diff", "--name-only", "--diff-filter=U").split("\n").filter(Boolean);
const generated = conflicted.filter(isGenerated);
const others = conflicted.filter((file) => !isGenerated(file));
if (generated.length > 0) {
  // Main's version; regenerated below from the merged catalog and schemas, so no side is lost.
  git("checkout", "--theirs", "--", ...generated);
  git("add", "--", ...generated);
}
if (others.length > 0) {
  console.error(
    `Resolve these conflicts, then run pnpm contracts:generate and commit:\n${others.join("\n")}`,
  );
  process.exit(1);
}
regenerate();
git("add", "--", ...GENERATED);
git("commit", "--no-edit");
console.log(`Merged origin/main; regenerated ${generated.length} conflicting generated file(s).`);
