// Performance suite (ADR-0011): outdated relations (SR-025) in `workspace.check` on the generated
// workspace of N-036 with 50,000 elements and 200,000 relations, each repository a Git repository
// with one commit. After the commit the text of every 100th element changes (500 targets), so every
// relation and inline reference to them is outdated: the check reports each with the dates of both
// versions (D-013, `versionDates`). Times are recorded with `measure` against SR-020 (check ≤ 60 s);
// like the other component times of this suite they record and do not fail a test (the tagged
// `[SR-020/AK1]` CLI tests assert the threshold, also for the worst case below). Correctness is
// asserted as usual.
//
// The worst case: every relation and inline reference outdated (the generator's versions are not
// core's), with Git. Its parts are recorded one by one: the current versions, the findings with
// their lines, and the dates of every stored and current version (`datedProblems`, one walk per
// target file: every element is a target). The check without Git in this case is the second
// `[SR-020/AK1]` CLI test.
import fs from "node:fs/promises";
import type { GeneratedWorkspace, LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import { generateLargeWorkspace, measure, writeLargeWorkspace } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { datedProblems, outdatedRelationsState } from "../../src/hints/index.js";
import { currentVersions } from "../../src/model/current-versions.js";
import { elementStoreState } from "../../src/model/store.js";
import { invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** Every this many elements one gets a new text after the commit. */
const EVERY = 100;
/** A version no element has: every relation and reference that stores it is outdated. */
const OLD_VERSION: VersionFunction = () => "n1:0000000000000000";

/** How often the files of `tree` store a version of one of `ids`: relation items and inline references. */
const storedTargets = (tree: GeneratedWorkspace, ids: ReadonlySet<string>): number => {
  let count = 0;
  const target = /\{ id: ([0-9a-f-]{36}), version: |\(logreq:([0-9a-f-]{36})\?version=/g;
  for (const content of tree.files.values()) {
    for (const match of content.matchAll(target)) {
      if (ids.has(match[1] ?? match[2] ?? "")) {
        count += 1;
      }
    }
  }
  return count;
};

describe("outdated relations in workspace.check with 50,000 elements and 200,000 relations (SR-025, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace;
  let workspace: Workspace;
  let changed: ReadonlySet<string>;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    fixture = (
      await measure(
        "write the generated workspace and commit each repository",
        () => writeLargeWorkspace(tree, { git: true }),
        { basis: "D-055 generator" },
      )
    ).result;
    const folders = new Map(tree.repositories.map((r) => [r.name, r.folder]));
    const targets = tree.elements.filter((_, i) => i % EVERY === 0);
    for (const element of targets) {
      const file = fixture.path(`${folders.get(element.repository) ?? ""}/${element.file}`);
      await fs.writeFile(file, `${await fs.readFile(file, "utf8")}Changed after the commit.\n`);
    }
    changed = new Set(targets.map((e) => e.id));
    workspace = new Workspace(fixture.workspaceRoot);
  }, 900_000);

  afterAll(async () => {
    await workspace.close();
    await fixture.cleanup();
  });

  it("reports every relation and reference to a changed element with both dates (SR-020: 60 s)", async () => {
    await measure("load the store (cold, no cache)", () => workspace.get(elementStoreState), {
      basis: "N-036, SR-082 AK2 (30 s)",
      thresholdMs: 30_000,
    });
    const { result: out } = await measure(
      `workspace.check with ${String(changed.size)} changed targets (current versions, outdated relations, dates from Git)`,
      async () => (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">,
      { basis: "SR-020, SR-025 in process (the store is loaded)", thresholdMs: 60_000 },
    );
    expect(out.ok).toBe(false);
    const expected = storedTargets(tree, changed);
    expect(expected).toBeGreaterThan(changed.size);
    expect(out.problems.filter((p) => p.code !== "relation.outdated")).toEqual([]);
    expect(out.problems).toHaveLength(expected);
    expect(out.problems.every((p) => p.targetId !== undefined && changed.has(p.targetId))).toBe(true);
    // Stored: the version of the commit; current: not committed.
    expect(new Set(out.problems.map((p) => p.currentDate))).toEqual(new Set([null]));
    expect(out.problems.every((p) => typeof p.storedDate === "string")).toBe(true);
    const { result: again } = await measure(
      "workspace.check again (states kept, dates asked again)",
      async () => (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">,
      { basis: "SR-020, SR-025", thresholdMs: 60_000 },
    );
    expect(again).toEqual(out);
  }, 900_000);
});

describe("every relation outdated, with Git (SR-025 worst case, N-036)", () => {
  let tree: GeneratedWorkspace;
  let fixture: LargeFixtureWorkspace;
  let workspace: Workspace;

  beforeAll(async () => {
    tree = generateLargeWorkspace({ version: OLD_VERSION, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree, { git: true });
    workspace = new Workspace(fixture.workspaceRoot);
  }, 900_000);

  afterAll(async () => {
    await workspace.close();
    await fixture.cleanup();
  });

  it("finds every outdated relation with its line, then dates them all", async () => {
    await workspace.get(elementStoreState);
    await measure("current version of every element (worst case)", () => currentVersions(workspace), {
      basis: "SR-020 (part of workspace.check, #259)",
    });
    const { result: findings } = await measure(
      "outdated relations with lines, every relation and link outdated (no dates)",
      () => workspace.get(outdatedRelationsState),
      { basis: "SR-020, SR-025 (part of workspace.check; ADR-0008)" },
    );
    expect(findings).toHaveLength(storedTargets(tree, new Set(tree.elements.map((e) => e.id))));
    expect(findings.every((f) => f.problem.line !== undefined)).toBe(true);
    const { result: problems } = await measure(
      `dates of the stored and current versions of ${String(findings.length)} findings (every element a target, Git)`,
      () => datedProblems(workspace, findings),
      { basis: "SR-020, D-013 (part of workspace.check; ADR-0005 version date)" },
    );
    expect(problems).toHaveLength(findings.length);
    // The stored version is in no commit; the current one is the generated commit's.
    expect(new Set(problems.map((p) => p.storedDate))).toEqual(new Set([null]));
    expect(problems.every((p) => typeof p.currentDate === "string")).toBe(true);
  }, 1_800_000);
});
