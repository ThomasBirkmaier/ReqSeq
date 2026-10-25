// The version date (ADR-0005 "Version date", enabler #260) in a deep history with many merges:
// 2,000 element files in one folder, 3,000 commits of which 1,000 merge a side commit, as a team
// that works on branches makes them. The first walk of 300 files in one call is recorded, which is
// what SR-025 will ask for after a long-lived project; `log` is asked for the folder of the files,
// not for every file (a literal pathspec per file costs time per commit, folder entry and path).
// No SR sets a limit for the date, so the time is recorded only (ADR-0011).
import type { FixtureWorkspace, HistoryCommitSpec } from "@logreq/testkit";
import { createFixtureWorkspace, measure } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseFileBytes } from "../../src/files/index.js";
import type { Metamodel } from "../../src/metamodel/index.js";
import { metamodelState } from "../../src/metamodel/index.js";
import { versionDates } from "../../src/model/version-date.js";
import type { VersionDateRequest } from "../../src/model/version-date.js";
import { elementVersion } from "../../src/model/view.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { workspaceLayoutState } from "../../src/workspace/index.js";

/** Element files, all in `requirements/`. */
const FILES = 2_000;
/** Commits after the first; every third one merges the side commit before it. */
const COMMITS = 3_000;
/** Element files each side or main commit changes. */
const CHANGED = 5;
/** Files dated in one call. */
const DATED = 300;

const hex = (n: number, width: number): string => n.toString(16).padStart(width, "0");
const idOf = (i: number): string => `${hex(i, 8)}-0000-4000-8000-${hex(i, 12)}`;
const fileOf = (i: number): string => `requirements/SR-${hex(i, 12)}.md`;
const textOf = (i: number, commit: number): string =>
  `---\nid: ${idOf(i)}\ntype: system-requirement\nstatus: draft\ntitle: Requirement ${String(i)}\n---\n\nText of ${String(i)} from commit ${String(commit)}.\n`;

/** The version of an element file without images (ADR-0005). */
const versionOf = (metamodel: Metamodel, text: string): string => {
  const parsed = parseFileBytes("x.md", Buffer.from(text));
  if (parsed.kind !== "parsed") {
    throw new Error("generated file did not parse");
  }
  const data = parsed.content.data as Readonly<Record<string, unknown>>;
  return elementVersion({ type: String(data["type"]), data }, parsed.content.body, metamodel, []);
};

describe("version date in a deep history with merges (enabler #260)", () => {
  let fixture: FixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  /** The current text of each file and the commit that started it, by file index. */
  const current = new Map<number, { readonly text: string; readonly started: string }>();
  let dates = new Map<string, string>();

  beforeAll(async () => {
    fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
    await fixture.git(["init", "--quiet", "--initial-branch=main"]);
    const all = Array.from({ length: FILES }, (_, i) => i);
    const commits: HistoryCommitSpec[] = [
      { name: "start", files: Object.fromEntries(all.map((i) => [fileOf(i), textOf(i, 0)])) },
    ];
    for (const i of all) {
      current.set(i, { text: textOf(i, 0), started: "start" });
    }
    let main = "start";
    let side: { readonly name: string; readonly files: Record<string, string> } | undefined;
    for (let commit = 1; commit <= COMMITS; commit++) {
      const name = String(commit);
      if (commit % 3 === 0 && side !== undefined) {
        // The merge takes the side's files: git would merge them in the same way.
        commits.push({ name, parents: [main, side.name], files: side.files });
        main = name;
        side = undefined;
        continue;
      }
      const changed = Array.from({ length: CHANGED }, (_, k) => (commit * 7919 + k * 104_729) % FILES);
      const files = Object.fromEntries(changed.map((i) => [fileOf(i), textOf(i, commit)]));
      for (const i of changed) {
        current.set(i, { text: textOf(i, commit), started: name });
      }
      // A side commit branches from main; the next one goes on main.
      commits.push({ name, parents: [main], files });
      if (commit % 3 === 1) {
        side = { name, files };
      } else {
        main = name;
      }
    }
    const made = await fixture.commitHistory(commits, { branch: "main" });
    await fixture.git(["reset", "--hard", "--quiet"]);
    dates = new Map(
      Object.entries(made).map(([name, { date }]) => [name, date.toISOString().replace(".000Z", "Z")]),
    );
    workspace = new Workspace(fixture.root);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it(`records the first walk of ${String(DATED)} files over ${String(COMMITS + 1)} commits with merges`, async () => {
    const opened = workspace;
    if (opened === undefined) {
      throw new Error("the workspace was not opened");
    }
    const metamodel = await opened.get(metamodelState);
    const context = { workspace: opened, layout: await opened.get(workspaceLayoutState), metamodel };
    const dated = Array.from({ length: DATED }, (_, k) => (k * 6) % FILES);
    const requests = dated.map((i): VersionDateRequest => ({
      repository: "system",
      file: fileOf(i),
      id: idOf(i),
      version: versionOf(metamodel, String(current.get(i)?.text)),
    }));
    const cold = await measure(
      `version dates of ${String(DATED)} files over ${String(COMMITS + 1)} commits, ${String(COMMITS / 3)} merges (first walk)`,
      () => versionDates(context, requests),
      { basis: "ADR-0005 version date for SR-025 in a deep history with merges (no threshold)" },
    );
    // A file changed on a side branch dates from the side commit, not from the merge.
    expect(cold.result).toEqual(dated.map((i) => dates.get(String(current.get(i)?.started))));
  });
});
