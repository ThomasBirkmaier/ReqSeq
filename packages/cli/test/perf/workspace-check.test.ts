// SR-020 in the performance suite (ADR-0011, #126): `reqseq workspace check` as a pipeline runs it,
// a new process of the built CLI on the generated workspace of N-036 with 50,000 elements and 200,000
// relations. The time is the whole process, from spawn to exit: Node start, reading every file, all
// finding states of stage 1 and the JSON output. Runs with `pnpm test:perf` after `pnpm build`, nightly
// and on pull requests labelled `perf` (.github/workflows/perf.yml), never in the required test run.
// The test is tagged `[SR-020/AK1]`, so it asserts its threshold (ADR-0011): a time over 60 s fails it,
// after `measure` has recorded the time for verification/performance.md. The ubuntu-24.04 runner of the
// perf job has 4 vCPU and 16 GB, the machine of AK1. Exit code and output are asserted too.
//
// The second test is the worst case of SR-025 for AK1: every relation and inline reference stores a
// version its target does not have, so the check reports every one of them as outdated, each with
// its line. Without Git (a workspace copied without history, as a pipeline may check it): the dates
// are then null without a walk; with Git the dates of 50,000 targets take longer (recorded in
// packages/core/test/perf/outdated-relations.test.ts).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CommandOutput, Problem, VersionValue } from "@reqseq/core";
import { Workspace, computeVersion, invoke } from "@reqseq/core";
import type { LargeFixtureWorkspace, VersionFunction } from "@reqseq/testkit";
import {
  createFixtureWorkspace,
  defaultStandardModelFile,
  generateLargeWorkspace,
  measure,
  thresholdMessage,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reqseq, requireBuiltCli } from "../support/reqseq.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** SR-020 AK1. */
const THRESHOLD_MS = 60_000;
/** A version no element has: every relation and reference that stores it is outdated. */
const OLD_VERSION: VersionFunction = () => "n1:0000000000000000";

/** How many relation items and inline references with a version the files hold. */
const storedVersions = (files: ReadonlyMap<string, string>): number => {
  let count = 0;
  for (const content of files.values()) {
    count += [...content.matchAll(/\{ id: [0-9a-f-]{36}, version: |\(reqseq:[0-9a-f-]{36}\?version=/g)]
      .length;
  }
  return count;
};

type Metamodel = CommandOutput<"metamodel.get">;

/** The standard model as `metamodel.get` gives it for a workspace with the generator's model file. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "reqseq-workspace.yaml":
        'reqseq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
      "metamodel/standard-model.yaml": await fs.readFile(defaultStandardModelFile, "utf8"),
    },
  });
  const workspace = new Workspace(fixture.root);
  try {
    return (await invoke("metamodel.get", {}, { workspace })) as Metamodel;
  } finally {
    await workspace.close();
    await fixture.cleanup();
  }
};

/** Core's version (ADR-0005) for the generator, from the effective properties of each type. */
const versionOf =
  (metamodel: Metamodel): VersionFunction =>
  ({ type, text, properties }) => {
    const keys = new Set(metamodel.types.find((t) => t.key === type)?.properties ?? []);
    return computeVersion({
      text,
      properties: properties as Readonly<Record<string, VersionValue>>,
      definitions: metamodel.properties
        .filter((p) => keys.has(p.key))
        .map((p) => ({
          key: p.key,
          kind: p.kind,
          ...(p.content === undefined ? {} : { content: p.content }),
        })),
      files: [],
    });
  };

describe("reqseq workspace check with 50,000 elements and 200,000 relations (SR-020, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let cache: string | undefined;

  beforeAll(async () => {
    requireBuiltCli("pnpm test:perf");
    const version = versionOf(await standardModel());
    const tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-020-cache-"));
  }, 600_000);

  afterAll(async () => {
    await fixture?.cleanup();
    if (cache !== undefined) {
      await fs.rm(cache, { recursive: true, force: true });
    }
  });

  it("[SR-020/AK1] checks the workspace from the command line in at most 60 s", async () => {
    const root = fixture?.workspaceRoot ?? "";
    // An empty cache folder of its own, so that the ReqSeq cache is cold once the model cache exists
    // (SR-082). The page cache of the operating system is warm: the fixture was just written.
    // The variables cover Linux, where the suite runs, and Windows.
    const env = { XDG_CACHE_HOME: cache ?? "", LOCALAPPDATA: cache ?? "" };
    const { result: run, measurement } = await measure(
      "reqseq workspace check --json (new CLI process, no cache)",
      () => reqseq(["workspace", "check", "--json"], { cwd: root, env }),
      {
        basis: "SR-020 AK1 (command line, from process start to exit)",
        thresholdMs: THRESHOLD_MS,
      },
    );
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, problems: [], checkedElements: ELEMENTS });
    expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(THRESHOLD_MS);
  }, 600_000);

  it("[SR-020/AK1] checks a workspace in which every relation is outdated in at most 60 s", async () => {
    const tree = generateLargeWorkspace({ version: OLD_VERSION, elements: ELEMENTS, relations: RELATIONS });
    const outdated = await writeLargeWorkspace(tree);
    const own = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-020-cache-"));
    try {
      const env = { XDG_CACHE_HOME: own, LOCALAPPDATA: own };
      const { result: run, measurement } = await measure(
        "reqseq workspace check --json, every relation outdated, no Git (new CLI process, no cache)",
        () => reqseq(["workspace", "check", "--json"], { cwd: outdated.workspaceRoot, env }),
        {
          basis: "SR-020 AK1, worst case of SR-025 (command line, from process start to exit)",
          thresholdMs: THRESHOLD_MS,
        },
      );
      expect(run.stderr).toBe("");
      // Outdated relations are warnings: ok, exit code 0, by default (failOn error, #304).
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as { ok: boolean; problems: Problem[]; checkedElements: number };
      expect(out.ok).toBe(true);
      expect(out.checkedElements).toBe(ELEMENTS);
      expect(out.problems).toHaveLength(storedVersions(tree.files));
      expect(out.problems.filter((p) => p.code !== "relation.outdated" || p.line === undefined)).toEqual([]);
      expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(THRESHOLD_MS);
    } finally {
      await outdated.cleanup();
      await fs.rm(own, { recursive: true, force: true });
    }
  }, 900_000);

  // SR-092 in a pipeline: the same worst case, each repository a Git repository with a tag `base` and a
  // merge request of 3 changed elements on top. Recorded only, with no threshold: the check still
  // builds the states of the whole workspace before it restricts them (#293).
  it("records a check restricted to a merge request of 3 changed elements, with Git (SR-092)", async () => {
    const tree = generateLargeWorkspace({ version: OLD_VERSION, elements: ELEMENTS, relations: RELATIONS });
    const merged = await writeLargeWorkspace(tree, { git: true });
    const own = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-sr-092-cache-"));
    try {
      const folders = new Map(tree.repositories.map((r) => [r.name, r.folder]));
      for (const repository of tree.repositories) {
        await merged.git(["tag", "base"], repository.folder);
      }
      const changed = [tree.elements[1000], tree.elements[25_000], tree.elements[49_999]].filter(
        (e) => e !== undefined,
      );
      for (const element of changed) {
        const folder = folders.get(element.repository) ?? "";
        const file = merged.path(`${folder}/${element.file}`);
        await fs.writeFile(file, `${await fs.readFile(file, "utf8")}Changed in the merge request.\n`);
        await merged.commit(folder, "the merge request");
      }
      const env = { XDG_CACHE_HOME: own, LOCALAPPDATA: own };
      const { result: run } = await measure(
        "reqseq workspace check --changed-since base --json, 3 changed elements, every relation outdated, Git (new CLI process, no cache)",
        () =>
          reqseq(["workspace", "check", "--changed-since", "base", "--json"], {
            cwd: merged.workspaceRoot,
            env,
          }),
        { basis: "SR-092, SR-020 (command line, from process start to exit; recorded only, #293)" },
      );
      expect(run.stderr).toBe("");
      // Only warnings (outdated relations): exit code 0 by default (#304).
      expect(run.code).toBe(0);
      const out = JSON.parse(run.stdout) as { ok: boolean; problems: Problem[]; checkedElements: number };
      const ids = new Set(changed.map((e) => e.id));
      expect(out.ok).toBe(true);
      expect(out.checkedElements).toBeLessThan(100);
      expect(out.problems.some((p) => p.targetId !== undefined && ids.has(p.targetId))).toBe(true);
    } finally {
      await merged.cleanup();
      await fs.rm(own, { recursive: true, force: true });
    }
  }, 1_800_000);
});
