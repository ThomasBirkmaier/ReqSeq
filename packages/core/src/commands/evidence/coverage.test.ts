// evidence.coverage through `invoke` (SR-036, SR-101 AK1, D-044) on fixtures/SR-036/levels: the
// workspace `system/` with the repositories `system` and `sensor`, the standard model and the subtype
// software-requirement (SWR) of system-requirement (SR):
// - needs N1 (parent of S1, S2), N2 (its only child S3 is obsolete), N3 (obsolete);
// - S1 (package P1) with the child SWR F1; S2 (P1) with the child S4, which is valid for variant V2
//   only; S3 obsolete; S4 (V2) with the child SWR F3 in the repository `sensor`;
// - SWR F1, F2 (package P2, no parent), F3 (sensor); decision D1, packages P1, P2, variants V1, V2;
// - the saved filter "Requirements": the system requirements.
// Without a selected view the coverage counts the core (AK5): S4 and its record of V2 count only in V2.
// The evidence records are given through `evidenceRecordsState` (#127 option 1): the readers come
// with SR-028 and SR-093, whose end-to-end tests read record files. The same output on every access:
// cross-access.test.ts.
import { readFile, rm } from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRead, EvidenceRecord } from "../../evidence/index.js";
import { evidenceReadState, evidenceRecordsState } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.coverage">;
type Level = Output["levels"][number];

const P = "36036036-0000-4000-8000-0000000000";
const ID = {
  N1: `${P}a1`,
  N2: `${P}a2`,
  N3: `${P}a3`,
  S1: `${P}b1`,
  S2: `${P}b2`,
  S3: `${P}b3`,
  S4: `${P}b4`,
  F1: `${P}f1`,
  F2: `${P}f2`,
  F3: `${P}f3`,
  P1: `${P}d1`,
  V2: `${P}c2`,
} as const;
type Name = keyof typeof ID;
const NAME = new Map<string, Name>((Object.entries(ID) as [Name, string][]).map(([name, id]) => [id, name]));
const names = (ids: readonly string[] | undefined): (string | undefined)[] | undefined =>
  ids?.map((id) => NAME.get(id) ?? id);

/** A level with the UUIDs as fixture names, so a failure reads like the file comment. */
const named = (level: Level): unknown => ({
  ...level,
  elements: Object.fromEntries(Object.entries(level.elements).map(([key, ids]) => [key, names(ids)])),
});

const record = (element: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "verification",
  element,
  version: "n1:0000000000000000",
  method: "test",
  item: "build-1",
  result: "passed",
  date: "2026-10-01T10:00:00Z",
  ...more,
});

/**
 * The records of most tests: S1 a verification of the core; S2 one of V2 only; F1 a validation only
 * (no Nachweis, D-007); F2 a failed one of an older version (counts: any version and result, #527);
 * N1 a validation.
 */
const RECORDS: readonly EvidenceRecord[] = [
  record(ID.S1),
  record(ID.S2, { variant: ID.V2 }),
  record(ID.F1, { kind: "validation" }),
  record(ID.F2, { result: "failed", version: "n1:1111111111111111" }),
  record(ID.N1, { kind: "validation" }),
];

const fixture = async (files: Readonly<Record<string, string>> = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-036/levels", files });
  onTestFinished(() => created.cleanup());
  return created;
};

/** A workspace on `ws` (its `system/` folder) whose evidence records are `records`. */
const open = async (
  ws: FixtureWorkspace,
  records: readonly EvidenceRecord[] = RECORDS,
): Promise<Workspace> => {
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  const empty = workspace.get(evidenceRecordsState);
  expect(await empty).toEqual([]);
  await workspace.replace(evidenceRecordsState, empty, Promise.resolve(records));
  return workspace;
};

const coverage = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>> = {},
): Promise<Output> => (await invoke("evidence.coverage", input, { workspace })) as Output;

/** The levels of the coverage, with fixture names. */
const levels = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>> = {},
): Promise<unknown[]> => (await coverage(workspace, input)).levels.map(named);

const NEEDS = {
  type: "need",
  total: 2,
  withChildren: 1,
  elements: { withChildren: ["N1"], withoutChildren: ["N2"] },
};

describe("evidence.coverage (SR-036)", () => {
  it("[SR-036/AK1] counts per type of the selection how many requirements have children and how many have evidence", async () => {
    const workspace = await open(await fixture());
    const out = await coverage(workspace);
    expect(out.incomplete).toBe(false);
    expect(out.levels.map((l) => [l.type, l.total, l.withChildren, l.withEvidence])).toEqual([
      ["need", 2, 1, undefined],
      ["system-requirement", 2, 1, 1],
      ["software-requirement", 3, 0, 1],
    ]);
  });

  it("[SR-036/AK1] evidence.coverage of a saved filter counts its elements", async () => {
    const workspace = await open(await fixture());
    expect(await levels(workspace, { selection: { filter: "Requirements" } })).toEqual([
      {
        type: "system-requirement",
        total: 2,
        withChildren: 1,
        withEvidence: 1,
        elements: {
          withChildren: ["S1"],
          withoutChildren: ["S2"],
          withEvidence: ["S1"],
          withoutEvidence: ["S2"],
        },
      },
    ]);
  });

  it("[SR-036/AK1] [SR-101/AK1] evidence.coverage of a package counts exactly the elements of the package", async () => {
    const workspace = await open(await fixture());
    const out = await coverage(workspace, { selection: { package: "PKG-0000d1" } });
    expect(out.levels.map(named)).toEqual([
      {
        type: "system-requirement",
        total: 2,
        withChildren: 1,
        withEvidence: 1,
        elements: {
          withChildren: ["S1"],
          withoutChildren: ["S2"],
          withEvidence: ["S1"],
          withoutEvidence: ["S2"],
        },
      },
    ]);
  });

  it("[SR-036/AK2] gives the requirements behind every number, those without children and without evidence included", async () => {
    const workspace = await open(await fixture());
    expect(await levels(workspace)).toEqual([
      NEEDS,
      {
        type: "system-requirement",
        total: 2,
        withChildren: 1,
        withEvidence: 1,
        elements: {
          withChildren: ["S1"],
          withoutChildren: ["S2"],
          withEvidence: ["S1"],
          withoutEvidence: ["S2"],
        },
      },
      {
        type: "software-requirement",
        total: 3,
        withChildren: 0,
        withEvidence: 1,
        elements: {
          withChildren: [],
          withoutChildren: ["F1", "F2", "F3"],
          withEvidence: ["F2"],
          withoutEvidence: ["F1", "F3"],
        },
      },
    ]);
  });

  it("[SR-033/AK2] a test case that names two requirements counts as evidence for each in the coverage", async () => {
    const ws = await fixture();
    const software = async (records: readonly EvidenceRecord[]): Promise<unknown> =>
      (await levels(await open(ws, records))).find(
        (level) => (level as Level).type === "software-requirement",
      );
    // Control: without records no software requirement has evidence.
    expect(await software([])).toMatchObject({ withEvidence: 0 });
    // One JUnit test case that names F2 and F3 gives one record of each (SR-093).
    const run = {
      testCase: "test_wind",
      className: "tests.Wind",
      source: "junit",
      repository: "system",
      file: "evidence/results.xml",
      line: 3,
    } as const;
    expect(await software([record(ID.F2, run), record(ID.F3, run)])).toMatchObject({
      withEvidence: 2,
      elements: { withEvidence: ["F2", "F3"], withoutEvidence: ["F1"] },
    });
  });

  it("[SR-036/AK2] names every element behind the numbers once, by short ID and title, for readers (#588)", async () => {
    const workspace = await open(await fixture());
    const out = await coverage(workspace);
    expect(out.names?.map((n) => [NAME.get(n.id), n.repository, n.shortId, n.title])).toEqual([
      ["N1", "system", "N-0000a1", "See the wind"],
      ["N2", "system", "N-0000a2", "Warn of storms"],
      ["S1", "system", "SR-0000b1", "Measure wind speed"],
      ["S2", "system", "SR-0000b2", "Measure every second"],
      ["F1", "system", "SWR-0000f1", "Filter the sensor signal"],
      ["F2", "system", "SWR-0000f2", "Log the raw values"],
      ["F3", "sensor", "SWR-0000f3", "Heat the sensor"],
    ]);
    // Each counted element once, in selection order; those not counted (N3, S3 obsolete, S4 of V2 only)
    // are not named.
    const listed = out.levels.flatMap((l) => [...l.elements.withChildren, ...l.elements.withoutChildren]);
    expect(new Set(out.names?.map((n) => n.id))).toEqual(new Set(listed));
  });

  it("[SR-036/AK2] the UUIDs of a number select exactly its requirements in element.list", async () => {
    const workspace = await open(await fixture());
    const [, requirements] = (await coverage(workspace)).levels;
    const ids = requirements?.elements.withoutEvidence ?? [];
    const list = (await invoke(
      "element.list",
      { selection: { ids } },
      { workspace },
    )) as CommandOutput<"element.list">;
    expect(list.elements.map((e) => e.shortId)).toEqual(["SR-0000b2"]);
  });

  it("[SR-036/AK3] marks the coverage incomplete when a repository of the workspace is not available", async () => {
    const workspace = await open(await fixture({ "system/reqseq-workspace.yaml": workspaceFile() }));
    const out = await coverage(workspace);
    expect(out.incomplete).toBe(true);
    // What is on this machine is still counted.
    expect(out.levels.map((l) => [l.type, l.total])).toEqual([
      ["need", 2],
      ["system-requirement", 2],
      ["software-requirement", 3],
    ]);
  });

  it("[SR-036/AK3] marks the coverage incomplete when a target lies in a repository that is not accessible", async () => {
    // S4's only child, F3, lies in `sensor`; the workspace file lists `sensor`, but it is not on this machine.
    const ws = await fixture();
    await rm(ws.path("sensor"), { recursive: true });
    const workspace = await open(ws);
    const out = await coverage(workspace, { selection: { ids: ["SR-0000b4"], view: "VAR-0000c2" } });
    expect(out.incomplete).toBe(true);
    expect(out.levels.map(named)).toEqual([
      {
        type: "system-requirement",
        total: 1,
        withChildren: 0,
        withEvidence: 0,
        elements: { withChildren: [], withoutChildren: ["S4"], withEvidence: [], withoutEvidence: ["S4"] },
      },
    ]);
  });

  it("marks the coverage incomplete when an evidence location lies in a repository that is not available", async () => {
    const evidence = "evidence:\n  - { repository: vault, path: results }\n";
    const workspace = await open(await fixture({ "system/reqseq-workspace.yaml": workspaceFile(evidence) }));
    expect((await coverage(workspace)).incomplete).toBe(true);
  });

  it("marks the coverage incomplete when the evidence records are incomplete", async () => {
    const workspace = new Workspace((await fixture()).path("system"));
    onTestFinished(() => workspace.close());
    const read: EvidenceRead = { records: RECORDS, skipped: [], problems: [], incomplete: true };
    const current = workspace.get(evidenceReadState);
    await current;
    await workspace.replace(evidenceReadState, current, Promise.resolve(read));
    const out = await coverage(workspace);
    expect(out.incomplete).toBe(true);
    expect(out.levels.map((l) => [l.type, l.withEvidence])).toEqual([
      ["need", undefined],
      ["system-requirement", 1],
      ["software-requirement", 1],
    ]);
  });

  it("[SR-036/AK4] leaves out requirements whose status is marked invalid", async () => {
    const workspace = await open(await fixture());
    // S3 and N3 are obsolete: not counted, even when named.
    const out = await coverage(workspace, { selection: { ids: ["SR-0000b3", "N-0000a3", "SR-0000b1"] } });
    expect(out.levels.map(named)).toEqual([
      {
        type: "system-requirement",
        total: 1,
        withChildren: 1,
        withEvidence: 1,
        elements: { withChildren: ["S1"], withoutChildren: [], withEvidence: ["S1"], withoutEvidence: [] },
      },
    ]);
    const all = JSON.stringify((await coverage(workspace)).levels);
    expect([all.includes(ID.S3), all.includes(ID.N3)]).toEqual([false, false]);
  });

  it("[SR-036/AK4] a child whose status is marked invalid does not count as a child", async () => {
    // N2's only child S3 is obsolete.
    const obsolete = await open(await fixture());
    expect((await levels(obsolete))[0]).toEqual(NEEDS);
    // The same child as a draft counts (and is counted itself).
    const ws = await fixture();
    const file = "system/requirements/SR-0000000000b3.md";
    await ws.write(
      file,
      (await readFile(ws.path(file), "utf8")).replace("status: obsolete", "status: draft"),
    );
    const draft = await open(ws);
    expect((await levels(draft))[0]).toEqual({
      ...NEEDS,
      withChildren: 2,
      elements: { withChildren: ["N1", "N2"], withoutChildren: [] },
    });
  });

  it("[SR-036/AK5] without a selected variant counts only the requirements, children and evidence of the core", async () => {
    const workspace = await open(await fixture());
    const none = await levels(workspace, { selection: { filter: "Requirements" } });
    // S4 (V2 only) is neither counted nor S2's child, and S2's record of V2 is no evidence.
    expect(none).toEqual([
      {
        type: "system-requirement",
        total: 2,
        withChildren: 1,
        withEvidence: 1,
        elements: {
          withChildren: ["S1"],
          withoutChildren: ["S2"],
          withEvidence: ["S1"],
          withoutEvidence: ["S2"],
        },
      },
    ]);
    // Named by ID, S4 is still not counted; the core view gives the same coverage.
    expect(await levels(workspace, { selection: { ids: ["SR-0000b4"] } })).toEqual([]);
    expect(await levels(workspace, { selection: { view: "core", filter: "Requirements" } })).toEqual(none);
  });

  it("a view narrows the children to those that apply in it and takes the records of the view", async () => {
    const workspace = await open(await fixture());
    // The core: S4 (V2 only) is not selected and is no child of S2; the core record of S1 counts.
    expect((await levels(workspace, { selection: { view: "core", filter: "Requirements" } }))[0]).toEqual({
      type: "system-requirement",
      total: 2,
      withChildren: 1,
      withEvidence: 1,
      elements: {
        withChildren: ["S1"],
        withoutChildren: ["S2"],
        withEvidence: ["S1"],
        withoutEvidence: ["S2"],
      },
    });
    // V2: S4 applies and is the child of S2; only the record of V2 counts.
    expect(
      (await levels(workspace, { selection: { view: "VAR-0000c2", filter: "Requirements" } }))[0],
    ).toEqual({
      type: "system-requirement",
      total: 3,
      withChildren: 3,
      withEvidence: 1,
      elements: {
        withChildren: ["S1", "S2", "S4"],
        withoutChildren: [],
        withEvidence: ["S2"],
        withoutEvidence: ["S1", "S4"],
      },
    });
  });

  it("the view of a saved filter narrows the children too", async () => {
    const workspace = await open(
      await fixture({
        "system/filters/core.yaml":
          "reqseq-filter: 1\nname: Core requirements\nview: core\nwhere: { type: [system-requirement], subtypes: false }\n",
      }),
    );
    const [level] = await levels(workspace, { selection: { filter: "Core requirements" } });
    expect(level).toMatchObject({ total: 2, withChildren: 1, elements: { withoutChildren: ["S2"] } });
  });

  it("a child in another repository counts", async () => {
    const workspace = await open(await fixture());
    const out = await coverage(workspace, { selection: { ids: ["SR-0000b4"], view: "VAR-0000c2" } });
    expect(out.levels.map(named)).toEqual([
      {
        type: "system-requirement",
        total: 1,
        withChildren: 1,
        withEvidence: 0,
        elements: { withChildren: ["S4"], withoutChildren: [], withEvidence: [], withoutEvidence: ["S4"] },
      },
    ]);
  });

  it("gives no level for elements of other types and no evidence without records", async () => {
    const workspace = await open(await fixture(), []);
    expect(
      (await coverage(workspace, { selection: { ids: ["D-0000e1", "PKG-0000d1", "VAR-0000c1"] } })).levels,
    ).toEqual([]);
    expect(
      (await coverage(workspace, { selection: { ids: ["D-0000e1", "PKG-0000d1", "VAR-0000c1"] } })).names,
    ).toBeUndefined();
    expect((await coverage(workspace, { selection: { ids: ["SR-0000b1"] } })).levels[0]?.withEvidence).toBe(
      0,
    );
  });
});

/** The workspace file of the fixture with a third repository, `vault`, that is not on this machine (SR-006). */
const workspaceFile = (more = ""): string =>
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }\n' +
  '  - { name: vault, url: "git@git.example.com:ws/vault.git" }\n' +
  "metamodel: { repository: system, path: metamodel }\n" +
  more;
