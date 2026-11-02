// Cross-access scenarios of baseline.compare, in addition to the default one (cross-access.test.ts).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Copy } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

const execFileAsync = promisify(execFile);

/**
 * In `system` of an EXPORT copy: the baseline „Release 2“ of SR-0000b1 at HEAD, then a commit that
 * changes SR-0000b1, with fixed author and dates, so every copy gets the same commits; once (SR-051 AK4).
 */
const changedSinceBaseline = async ({ root }: Copy): Promise<void> => {
  const date = "2026-11-03T10:00:00Z";
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
  };
  const git = (args: readonly string[]): Promise<{ stdout: string }> =>
    execFileAsync("git", args, {
      cwd: root,
      env: { ...env, GIT_COMMITTER_EMAIL: "t@example.com", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  const file = path.join(root, "baselines", "Release-2.yaml");
  if (
    await fs.stat(file).then(
      () => true,
      () => false,
    )
  ) {
    return;
  }
  const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
  await fs.writeFile(
    file,
    "reqseq-baseline: 1\nname: Release 2\ndate: 2026-11-02T13:00:00Z\nrepositories:\n" +
      `  - { name: system, commit: ${head} }\nelements:\n` +
      "  - { id: 61061061-0000-4000-8000-0000000000b1, version: n1:697a2ad17ed49170 }\n",
  );
  const b1 = path.join(root, "requirements", "SR-0000000000b1.md");
  await fs.writeFile(
    b1,
    (await fs.readFile(b1, "utf8")).replace("shows the speed.", "shows the speed in knots."),
  );
  await git(["commit", "-qam", "change"]);
};

// The date of the baseline is checked to lie within each call and then masked (`withoutDate`).
scenariosOf("baseline.compare", [
  {
    name: "the two commits and the Git command for a changed element (SR-051 AK4)",
    fixture: EXPORT,
    root: "system",
    input: { baseline: "Release 2", ref: "SR-0000b1" },
    tag: "[SR-051/AK4]",
    expect: "output",
    prepare: changedSinceBaseline,
  },
  {
    name: "a baseline whose commit is not here",
    fixture: EXPORT,
    root: "system",
    input: { baseline: "release-1", ref: "SR-0000b1" },
    expect: "error",
  },
]);
