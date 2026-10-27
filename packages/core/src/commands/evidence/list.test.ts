// evidence.list through `invoke` (SR-032) on fixtures/SR-032/baselines: the requirements A1 "Show
// wind speed" and A2 "Show wind direction", the variant C1 "Coast", and three baselines in the
// default folder `baselines`: Beta (A1 at version V1), Release 1.0 (A1 at V1, A2 at V2) and
// Release 1.1 (A1 at V2, A2 at V2), plus a README that is no baseline. The evidence records are
// given through `evidenceRecordsState` (#127 option 1); the readers come with SR-028 and SR-093,
// whose end-to-end tests read record files. The same output on every access: cross-access.test.ts.
// The baseline reader itself: baselines/read.test.ts. The test cases of the element (SR-033) come
// from the same index; skipped test cases are injected through `evidenceReadState`.
import { rm } from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { EvidenceRead, EvidenceRecord } from "../../evidence/index.js";
import { evidenceReadState, evidenceRecordsState } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.list">;

const P = "32032032-0000-4000-8000-0000000032";
const A1 = `${P}a1`;
const A2 = `${P}a2`;
const C1 = `${P}c1`;
const V1 = "n1:1111111111111111";
const V2 = "n1:2222222222222222";
const V3 = "n1:3333333333333333";

const record = (more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "verification",
  element: A1,
  version: V1,
  method: "test",
  item: "build-1",
  result: "passed",
  date: "2026-10-01T10:00:00Z",
  ...more,
});

/** A1: an inspection of V1, a failed test of V2 and a passed one of V3 (newest), one for the coast; A2: one. */
const INSPECTION = record({
  method: "inspection",
  item: "Display sample B2",
  date: "2026-09-10T14:00:00Z",
  evidence: "//fileserver/qa/ws/inspection-2026-09-10.docx",
  source: "markdown",
  repository: "system",
  file: "evidence/2026-09-10-SR-0032a1-inspection.md",
  line: 1,
});
const FAILED = record({
  version: V2,
  item: "build-511",
  result: "failed",
  date: "2026-10-10T08:00:00Z",
  evidence: "ci/results-511.xml",
  testCase: "test_shows_wind_speed",
  className: "tests.test_display",
});
const PASSED = record({
  version: V3,
  item: "build-512",
  date: "2026-10-20T08:00:00Z",
  evidence: "ci/results-512.xml",
});
const COAST = record({ version: V2, item: "coast-7", date: "2026-10-05T08:00:00Z", variant: C1 });
const OTHER = record({ element: A2, version: V2, item: "build-512" });
const RECORDS: readonly EvidenceRecord[] = [INSPECTION, FAILED, PASSED, COAST, OTHER];

const fixture = async (files: Readonly<Record<string, string>> = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-032/baselines", files });
  onTestFinished(() => created.cleanup());
  return created;
};

/** A workspace on `ws` whose evidence records are `records`. */
const open = async (
  ws: FixtureWorkspace,
  records: readonly EvidenceRecord[] = RECORDS,
): Promise<Workspace> => {
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  const empty = workspace.get(evidenceRecordsState);
  expect(await empty).toEqual([]);
  await workspace.replace(evidenceRecordsState, empty, Promise.resolve(records));
  return workspace;
};

const list = async (workspace: Workspace, input: Readonly<Record<string, unknown>>): Promise<Output> =>
  (await invoke("evidence.list", input, { workspace })) as Output;

const listError = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>>,
): Promise<CommandError> => {
  const error = await list(workspace, input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** Each record as `[item, version, baselines]`. */
const named = (output: Output): unknown[] => output.records.map((r) => [r.item, r.version, r.baselines]);

describe("evidence.list (SR-032)", () => {
  it("[SR-032/AK1] shows each record of a requirement with version, item, date, result and evidence", async () => {
    const workspace = await open(await fixture());
    const output = await list(workspace, { ref: "SR-0032a1" });
    expect(output.records.map((r) => [r.version, r.item, r.date, r.result, r.evidence])).toEqual([
      [V3, "build-512", "2026-10-20T08:00:00Z", "passed", "ci/results-512.xml"],
      [V2, "build-511", "2026-10-10T08:00:00Z", "failed", "ci/results-511.xml"],
      [V2, "coast-7", "2026-10-05T08:00:00Z", "passed", undefined],
      [
        V1,
        "Display sample B2",
        "2026-09-10T14:00:00Z",
        "passed",
        "//fileserver/qa/ws/inspection-2026-09-10.docx",
      ],
    ]);
    expect(output.records[3]).toEqual({ ...INSPECTION, baselines: ["Beta", "Release 1.0"] });
    expect(output.records[1]).toEqual({ ...FAILED, baselines: ["Release 1.1"] });
    expect([output.problems, output.incomplete]).toEqual([[], false]);
  });

  it("[SR-032/AK1] shows only the records of the element asked for, by UUID or short ID alike", async () => {
    const workspace = await open(await fixture());
    expect(named(await list(workspace, { ref: A2 }))).toEqual([
      ["build-512", V2, ["Release 1.0", "Release 1.1"]],
    ]);
    expect((await list(workspace, { ref: "SR-0032a1" })).records.map((r) => r.element)).toEqual([
      A1,
      A1,
      A1,
      A1,
    ]);
  });

  it("[SR-032/AK1] shows no record for a requirement without records", async () => {
    const workspace = await open(await fixture(), [OTHER]);
    expect(await list(workspace, { ref: "SR-0032a1" })).toEqual({
      records: [],
      testCases: [],
      problems: [],
      incomplete: false,
    });
  });

  it("[SR-032/AK2] names the baselines that contain the version of each record, and none for a version no baseline holds", async () => {
    const workspace = await open(await fixture());
    expect(named(await list(workspace, { ref: "SR-0032a1" }))).toEqual([
      ["build-512", V3, []],
      ["build-511", V2, ["Release 1.1"]],
      ["coast-7", V2, ["Release 1.1"]],
      ["Display sample B2", V1, ["Beta", "Release 1.0"]],
    ]);
  });

  it("[SR-032/AK2] names a baseline committed after the first call, and no longer one that was removed or changed", async () => {
    const ws = await fixture();
    const workspace = await open(ws);
    expect(named(await list(workspace, { ref: A1 }))[0]).toEqual(["build-512", V3, []]);
    await ws.write(
      "baselines/release-1.2.yaml",
      "logreq-baseline: 1\nname: Release 1.2\ndate: 2026-10-25T09:00:00Z\nrepositories:\n" +
        "  - { name: system, commit: 4abcdef04abcdef04abcdef04abcdef04abcdef0 }\nelements:\n" +
        `  - { id: ${A1}, version: ${V3} }\n`,
    );
    await rm(ws.path("baselines/beta.yaml"));
    await ws.write(
      "baselines/release-1.1.yaml",
      "logreq-baseline: 1\nname: Release 1.1 (rebuilt)\ndate: 2026-10-15T09:00:00Z\nrepositories:\n" +
        "  - { name: system, commit: 3abcdef03abcdef03abcdef03abcdef03abcdef0 }\nelements: []\n",
    );
    expect(named(await list(workspace, { ref: A1 }))).toEqual([
      ["build-512", V3, ["Release 1.2"]],
      ["build-511", V2, []],
      ["coast-7", V2, []],
      ["Display sample B2", V1, ["Release 1.0"]],
    ]);
  });

  it("[SR-032/AK2] lists a faulty baseline file as a problem and names no baseline from it", async () => {
    const ws = await fixture({
      "baselines/broken.yaml": `logreq-baseline: 1\ndate: 2026-10-01T09:00:00Z\nrepositories: []\nelements:\n  - { id: ${A1}, version: ${V1} }\n`,
    });
    const output = await list(await open(ws), { ref: A1 });
    expect(named(output).at(-1)).toEqual(["Display sample B2", V1, ["Beta", "Release 1.0"]]);
    expect(output.problems.map((p) => [p.code, p.severity, p.repository, p.file, p.line])).toEqual([
      ["baseline.invalid", "error", "system", "baselines/broken.yaml", 1],
      ["baseline.invalid", "error", "system", "baselines/broken.yaml", 3],
    ]);
  });

  it("keeps the records of the core or of one variant with view (SR-047)", async () => {
    const workspace = await open(await fixture());
    expect(named(await list(workspace, { ref: A1, view: "core" })).map((r) => (r as unknown[])[0])).toEqual([
      "build-512",
      "build-511",
      "Display sample B2",
    ]);
    expect(named(await list(workspace, { ref: A1, view: "VAR-0032c1" }))).toEqual([
      ["coast-7", V2, ["Release 1.1"]],
    ]);
    expect((await listError(workspace, { ref: A1, view: "SR-0032a2" })).code).toBe("input.invalid");
  });

  it("refuses an element that does not exist", async () => {
    const workspace = await open(await fixture());
    expect((await listError(workspace, { ref: "SR-ffffff" })).code).toBe("ref.unknown");
  });

  it("marks the list incomplete when an evidence location or the baselines folder is not on this machine (SR-006 AK2)", async () => {
    const vault =
      "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
      '  - { name: vault, url: "git@git.example.com:ws/vault.git", path: ../vault }\n' +
      "metamodel: { repository: system, path: metamodel }\n";
    const baselinesAway = await open(
      await fixture({
        "logreq-workspace.yaml": `${vault}baselines: { repository: vault, path: baselines }\n`,
      }),
    );
    expect(await list(baselinesAway, { ref: A2 })).toEqual({
      records: [{ ...OTHER, baselines: [] }],
      testCases: [],
      problems: [],
      incomplete: true,
    });
    const ws = await fixture({
      "logreq-workspace.yaml": `${vault}evidence:\n  - { repository: vault, path: evidence }\n`,
    });
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    const read = workspace.get(evidenceReadState);
    expect((await read).incomplete).toBe(true);
    const injected: EvidenceRead = { records: [OTHER], skipped: [], problems: [], incomplete: true };
    await workspace.replace(evidenceReadState, read, Promise.resolve(injected));
    expect(await list(workspace, { ref: A2 })).toEqual({
      records: [{ ...OTHER, baselines: ["Release 1.0", "Release 1.1"] }],
      testCases: [],
      problems: [],
      incomplete: true,
    });
  });
});

describe("evidence.list: test cases (SR-033)", () => {
  /** A1's second execution of the test case of FAILED, a run later, and one of it for A2. */
  const RERUN = record({
    version: V3,
    item: "build-513",
    date: "2026-10-21T08:00:00Z",
    testCase: "test_shows_wind_speed",
    className: "tests.test_display",
    source: "junit",
    repository: "system",
    file: "evidence/ci/run-513.xml",
    line: 4,
  });
  const OF_A2 = { ...RERUN, element: A2, version: V2 };

  /** A workspace on `ws` whose evidence read gives `records` and the skipped test cases `skipped`. */
  const openRead = async (
    ws: FixtureWorkspace,
    records: readonly EvidenceRecord[],
    skipped: EvidenceRead["skipped"] = [],
  ): Promise<Workspace> => {
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    const read = workspace.get(evidenceReadState);
    const injected: EvidenceRead = { records, skipped, problems: [], incomplete: false };
    await workspace.replace(evidenceReadState, read, Promise.resolve(injected));
    return workspace;
  };

  it("[SR-033/AK1] evidence.list gives the test cases of the element with all their executions", async () => {
    const workspace = await openRead(await fixture(), [...RECORDS, RERUN, OF_A2]);
    const output = await list(workspace, { ref: A1 });
    expect(output.testCases).toEqual([
      {
        name: "test_shows_wind_speed",
        className: "tests.test_display",
        elements: [A1, A2],
        executed: true,
        executions: [RERUN, FAILED],
        last: RERUN,
      },
    ]);
    // In the core view both executions hold; for the coast none, so the test case is left out there.
    expect((await list(workspace, { ref: A1, view: "core" })).testCases).toEqual(output.testCases);
    expect((await list(workspace, { ref: A1, view: "VAR-0032c1" })).testCases).toEqual([]);
    expect((await list(workspace, { ref: A2 })).testCases.map((t) => t.executions)).toEqual([[OF_A2]]);
  });

  it("[SR-033/AK3] evidence.list marks a test case without execution as not executed", async () => {
    const skipped = {
      name: "test_shows_gusts",
      className: "tests.test_display",
      elements: [A1],
      repository: "system",
      file: "evidence/ci/run-513.xml",
      line: 12,
    };
    const workspace = await openRead(await fixture(), [OTHER], [skipped]);
    const expected = [
      {
        name: "test_shows_gusts",
        className: "tests.test_display",
        elements: [A1],
        executed: false,
        executions: [],
      },
    ];
    expect((await list(workspace, { ref: A1 })).testCases).toEqual(expected);
    // A skipped test case carries no variant: it shows in every view.
    expect((await list(workspace, { ref: A1, view: "VAR-0032c1" })).testCases).toEqual(expected);
  });
});
