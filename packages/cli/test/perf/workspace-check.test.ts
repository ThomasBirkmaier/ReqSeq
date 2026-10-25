// SR-020 in the performance suite (ADR-0011, #126): `logreq workspace check` as a pipeline runs it,
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
import type { CommandOutput, Problem, VersionValue } from "@logreq/core";
import { Workspace, computeVersion, invoke } from "@logreq/core";
import type { LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import {
  createFixtureWorkspace,
  defaultStandardModelFile,
  generateLargeWorkspace,
  measure,
  thresholdMessage,
  writeLargeWorkspace,
} from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logreq, requireBuiltCli } from "../support/logreq.js";

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
    count += [...content.matchAll(/\{ id: [0-9a-f-]{36}, version: |\(logreq:[0-9a-f-]{36}\?version=/g)]
      .length;
  }
  return count;
};

type Metamodel = CommandOutput<"metamodel.get">;

/** The standard model as `metamodel.get` gives it for a workspace with the generator's model file. */
const standardModel = async (): Promise<Metamodel> => {
  const fixture = await createFixtureWorkspace({
    files: {
      "logreq-workspace.yaml":
        'logreq-workspace: 1\nname: Model\nrepositories:\n  - { name: system, url: "x" }\nmetamodel: { repository: system, path: metamodel }\n',
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

describe("logreq workspace check with 50,000 elements and 200,000 relations (SR-020, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let cache: string | undefined;

  beforeAll(async () => {
    requireBuiltCli("pnpm test:perf");
    const version = versionOf(await standardModel());
    const tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree);
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-020-cache-"));
  }, 600_000);

  afterAll(async () => {
    await fixture?.cleanup();
    if (cache !== undefined) {
      await fs.rm(cache, { recursive: true, force: true });
    }
  });

  it("[SR-020/AK1] checks the workspace from the command line in at most 60 s", async () => {
    const root = fixture?.workspaceRoot ?? "";
    // An empty cache folder of its own, so that the LogReq cache is cold once the model cache exists
    // (SR-082). The page cache of the operating system is warm: the fixture was just written.
    // The variables cover Linux, where the suite runs, and Windows.
    const env = { XDG_CACHE_HOME: cache ?? "", LOCALAPPDATA: cache ?? "" };
    const { result: run, measurement } = await measure(
      "logreq workspace check --json (new CLI process, no cache)",
      () => logreq(["workspace", "check", "--json"], { cwd: root, env }),
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
    const own = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-sr-020-cache-"));
    try {
      const env = { XDG_CACHE_HOME: own, LOCALAPPDATA: own };
      const { result: run, measurement } = await measure(
        "logreq workspace check --json, every relation outdated, no Git (new CLI process, no cache)",
        () => logreq(["workspace", "check", "--json"], { cwd: outdated.workspaceRoot, env }),
        {
          basis: "SR-020 AK1, worst case of SR-025 (command line, from process start to exit)",
          thresholdMs: THRESHOLD_MS,
        },
      );
      expect(run.stderr).toBe("");
      // Outdated relations are warnings: not ok (ADR-0009).
      expect(run.code).toBe(1);
      const out = JSON.parse(run.stdout) as { ok: boolean; problems: Problem[]; checkedElements: number };
      expect(out.ok).toBe(false);
      expect(out.checkedElements).toBe(ELEMENTS);
      expect(out.problems).toHaveLength(storedVersions(tree.files));
      expect(out.problems.filter((p) => p.code !== "relation.outdated" || p.line === undefined)).toEqual([]);
      expect(measurement.ms, thresholdMessage(measurement)).toBeLessThanOrEqual(THRESHOLD_MS);
    } finally {
      await outdated.cleanup();
      await fs.rm(own, { recursive: true, force: true });
    }
  }, 900_000);
});
