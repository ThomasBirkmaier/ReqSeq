// trace.matrix with evidence (SR-126) through `invoke` on fixtures/SR-126/matrix (its README lists every
// element): one repository `system` with the need N-126a01, the system requirements SR-126b01 to b10
// (b08 and b09 derive from b07, the others from the need) and the evidence location `evidence/` with
// two JUnit runs and one inspection record. The relation columns are SR-125's (matrix.test.ts); the
// unit tests of the evidence columns are evidence/matrix.test.ts. The same matrix on every access:
// cli/test/cross-access.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceIndex, EvidenceRead } from "../../evidence/index.js";
import { chainEvidenceOf, evidenceIndexState, evidenceReadState } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { View } from "../../variants/index.js";

type Output = CommandOutput<"trace.matrix">;
type Row = Output["rows"][number];
type DegreeOutput = CommandOutput<"evidence.degree">;

const P = "5c0e1d2a-0126-4126-8126-000000126";
const ID = {
  N01: `${P}a01`,
  B01: `${P}b01`,
  B02: `${P}b02`,
  B03: `${P}b03`,
  B04: `${P}b04`,
  B05: `${P}b05`,
  B06: `${P}b06`,
  B07: `${P}b07`,
  B08: `${P}b08`,
  B09: `${P}b09`,
  B10: `${P}b10`,
  B11: `${P}b11`,
  B12: `${P}b12`,
  B13: `${P}b13`,
  B14: `${P}b14`,
  COAST: `${P}c01`,
} as const;
type Name = keyof typeof ID;
const NAME = new Map<string, Name>((Object.entries(ID) as [Name, string][]).map(([name, id]) => [id, name]));
const nameOf = (id: string): string => NAME.get(id) ?? id;

/** The current versions of the fixture's element files (README). */
const VERSION = {
  B01: "n1:f3f86f771ff1e825",
  B02: "n1:79f49551086ace54",
  B03: "n1:3155226bafecafee",
  B06: "n1:aea9ffdcc588fbcb",
} as const;

const SR = { where: { type: ["system-requirement"] } };
const MATRIX: FixtureOptions = { fixture: "SR-126/matrix" };

/** A system requirement file of the fixture's shape, deriving from `parent` (the need unless given). */
const requirement = (key: string, title: string, status: string, more = "", parent: Name = "N01"): string =>
  `---\nid: ${P}${key}\ntype: system-requirement\nstatus: ${status}\ntitle: ${title}\nrequirement-type: functional\n` +
  `acceptance-criteria:\n  - Given wind, when it is measured, then it works.\n${more}` +
  `derives-from:\n  - { id: ${ID[parent]}, version: n1:0000000000000000 }\n---\n`;

/** A Markdown verification record of `element` that passed, for `version`. */
const passedRecord = (element: string, version: string, more = ""): string =>
  `---\nlogreq-record: 1\nkind: verification\nelement: ${element}\nversion: ${version}\nmethod: test\n` +
  `item: build-7\nresult: passed\ndate: 2026-10-23T10:00:00Z\n${more}---\n`;

/** The variant VAR-126c01 "Coast edition", and a record of b06 for it with the test case "coast check". */
const COAST_FILES = {
  "variants/VAR-000000126c01.md": `---\nid: ${ID.COAST}\ntype: variant\nstatus: draft\ntitle: Coast edition\n---\n`,
  "evidence/2026-10-23-SR-126b06-coast.md": passedRecord(
    ID.B06,
    VERSION.B06,
    `variant: ${ID.COAST}\ntest-case: coast check\n`,
  ),
};
const COAST_VIEW: View = { kind: "variant", variant: { id: ID.COAST, repository: "system" } };

const open = async (options: FixtureOptions = MATRIX): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const matrix = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("trace.matrix", input, { workspace })) as Output;

const degree = async (workspace: Workspace, input: Record<string, unknown>): Promise<DegreeOutput> =>
  (await invoke("evidence.degree", input, { workspace })) as DegreeOutput;

const rowOf = (output: Output, name: Name): Row => {
  const found = output.rows.find((r) => r.id === ID[name]);
  if (found === undefined) {
    throw new Error(`no row ${name}`);
  }
  return found;
};

/** A row's test cases as `[name, result of the last execution, its date, mark]`. */
const testCasesOf = (output: Output, name: Name): unknown[] =>
  (rowOf(output, name).testCases ?? ["<no field>"]).map((t) =>
    typeof t === "string" ? t : [t.name, t.last?.result, t.last?.date, t.mark],
  );

/** A row's verification entries as `view status`. */
const statusOf = (output: Output, name: Name): string[] =>
  (rowOf(output, name).verification ?? []).map((v) => `${v.view} ${v.status}`);

const ALL_SR_DEGREE = {
  share: 5 / 9,
  total: 9,
  counts: { open: 2, verified: 4, indirect: 1, failed: 1, outdated: 1 },
};

describe("trace.matrix test cases and verification status (SR-126 AK1)", () => {
  it("[SR-126/AK1] gives each requirement of the selection its test cases, each with result and date of its last execution, and its verification status", async () => {
    const output = await matrix(await open(), { selection: SR });
    expect(rowOf(output, "B01").testCases).toEqual([
      {
        name: "test_speed[SR-126b01]",
        className: "tests.test_wind",
        executed: true,
        last: {
          element: ID.B01,
          version: VERSION.B01,
          kind: "verification",
          method: "test",
          item: "build-602",
          result: "passed",
          date: "2026-10-22T09:00:00Z",
          testCase: "test_speed[SR-126b01]",
          source: "junit",
          repository: "system",
          file: "evidence/ci/run-2.xml",
          line: 4,
          className: "tests.test_wind",
        },
      },
    ]);
    expect(rowOf(output, "B01").verification).toEqual([{ view: "core", status: "verified" }]);
    expect(output.rows.map((r) => [nameOf(r.id), statusOf(output, NAME.get(r.id) ?? "N01")])).toEqual([
      ["B01", ["core verified"]],
      ["B02", ["core failed"]],
      ["B03", ["core outdated"]],
      ["B04", ["core open"]],
      ["B05", ["core verified"]],
      ["B06", ["core open"]],
      ["B07", ["core indirect"]],
      ["B08", ["core verified"]],
      ["B09", ["core verified"]],
      ["B10", ["core verified"]],
    ]);
    expect(output.evidence?.view).toBe("core");
  });

  it("[SR-126/AK1] gives the test cases the chain shows for the requirement in the same view", async () => {
    const workspace = await open({ ...MATRIX, files: COAST_FILES });
    const index = await workspace.get(evidenceIndexState);
    const names = (view: View, id: string): string[] =>
      (chainEvidenceOf(index, id, view)?.testCases ?? []).map((t) => t.name);
    for (const [selection, view] of [
      [SR, { kind: "core" }],
      [{ ...SR, view: "VAR-126c01" }, COAST_VIEW],
    ] as const) {
      const output = await matrix(workspace, { selection });
      expect(output.evidence?.view).toBe(view.kind === "core" ? "core" : ID.COAST);
      for (const row of output.rows) {
        expect([nameOf(row.id), row.testCases?.map((t) => t.name)]).toEqual([
          nameOf(row.id),
          names(view, row.id),
        ]);
      }
    }
  });

  it("gives no evidence fields when the workspace file names no evidence location", async () => {
    for (const options of [
      { fixture: "SR-125/matrix" },
      {
        ...MATRIX,
        files: {
          "logreq-workspace.yaml":
            'logreq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "ssh://example.com/system.git", main: true }\nmetamodel: { repository: system, path: metamodel }\n',
        },
      },
    ]) {
      const output = await matrix(await open(options), {});
      expect(Object.keys(output)).toEqual(["columns", "rows", "total", "incomplete"]);
      expect(output.rows.filter((r) => "testCases" in r || "verification" in r)).toEqual([]);
    }
  });

  it("gives a need row neither test cases nor status", async () => {
    const output = await matrix(await open(), {});
    const need = rowOf(output, "N01");
    expect(["testCases" in need, "verification" in need]).toEqual([false, false]);
    expect(output.evidence?.degree.total).toBe(9);
  });

  it("gives no evidence for a selection without a requirement", async () => {
    const output = await matrix(await open(), { selection: { ids: [ID.N01] } });
    expect(output.evidence).toBeUndefined();
  });

  it("gives no evidence while the metamodel is not valid", async () => {
    const workspace = await open({
      ...MATRIX,
      files: { "metamodel/broken.yaml": "logreq-metamodel: 1\ntypes: [\n" },
    });
    const output = await matrix(workspace, { selection: SR });
    expect(output.evidence).toBeUndefined();
    expect(output.rows.filter((r) => "testCases" in r || "verification" in r)).toEqual([]);
  });

  it("builds the evidence of the page rows only", async () => {
    const workspace = await open();
    const asked: string[] = [];
    const before = workspace.get(evidenceIndexState);
    const index = await before;
    const counting: EvidenceIndex = {
      ...index,
      testCasesOf: (id) => {
        asked.push(nameOf(id));
        return index.testCasesOf(id);
      },
    };
    await workspace.replace(evidenceIndexState, before, Promise.resolve(counting));
    const output = await matrix(workspace, { selection: SR, limit: 3, offset: 2 });
    expect(
      output.rows.map((r) => [nameOf(r.id), r.testCases?.length, statusOf(output, NAME.get(r.id) ?? "N01")]),
    ).toEqual([
      ["B03", 1, ["core outdated"]],
      ["B04", 1, ["core open"]],
      ["B05", 0, ["core verified"]],
    ]);
    expect(asked.filter((name) => ["B03", "B04", "B05"].includes(name)).sort()).toEqual([
      "B03",
      "B04",
      "B05",
    ]);
    expect(asked.filter((name) => !["B03", "B04", "B05"].includes(name))).toEqual([]);
    expect(output.evidence?.degree).toEqual(ALL_SR_DEGREE);
  });

  it("shows in a variant view only executions for that variant and the status there", async () => {
    const workspace = await open({ ...MATRIX, files: COAST_FILES });
    const core = await matrix(workspace, { selection: { ids: [ID.B01, ID.B04, ID.B06] } });
    const coast = await matrix(workspace, {
      selection: { ids: [ID.B01, ID.B04, ID.B06], view: "VAR-126c01" },
    });
    expect([testCasesOf(core, "B06"), statusOf(core, "B06")]).toEqual([[], ["core open"]]);
    expect([testCasesOf(coast, "B06"), statusOf(coast, "B06")]).toEqual([
      [["coast check", "passed", "2026-10-23T10:00:00Z", undefined]],
      [`${ID.COAST} verified`],
    ]);
    // A record of the core holds in no variant; a skipped test case stays in every view.
    expect([testCasesOf(coast, "B01"), statusOf(coast, "B01")]).toEqual([[], [`${ID.COAST} open`]]);
    expect(testCasesOf(coast, "B04")).toEqual([
      ["test_gusts[SR-126b04]", undefined, undefined, "not-executed"],
    ]);
    expect(coast.evidence).toEqual({
      view: ID.COAST,
      degree: {
        share: 1 / 3,
        total: 3,
        counts: { open: 2, verified: 1, indirect: 0, failed: 0, outdated: 0 },
      },
    });
    // The variant of the view, named for readers (#588); the core names none. A page without a
    // requirement row still names the variant of `evidence.view`.
    const named = [{ id: ID.COAST, repository: "system", shortId: "VAR-126c01", title: "Coast edition" }];
    const past = await matrix(workspace, {
      selection: { ids: [ID.B01, ID.B04, ID.B06], view: "VAR-126c01" },
      offset: 3,
    });
    expect([core.names, coast.names, past.rows, past.evidence?.view, past.names]).toEqual([
      undefined,
      named,
      [],
      ID.COAST,
      named,
    ]);
    // The row fields in schema order: the evidence fields before the relation cells (review of #607, N3).
    expect(Object.keys(rowOf(coast, "B06")).slice(-3)).toEqual(["testCases", "verification", "cells"]);
  });

  it("gives a requirement valid only in a variant neither field when the matrix has no view", async () => {
    const workspace = await open({
      ...MATRIX,
      files: {
        ...COAST_FILES,
        "requirements/SR-000000126b14.md": requirement(
          "b14",
          "Show the tide",
          "draft",
          `validity:\n  - { id: ${ID.COAST}, version: n1:0000000000000000 }\n`,
        ),
      },
    });
    const core = await matrix(workspace, { selection: SR });
    const tide = rowOf(core, "B14");
    expect(["testCases" in tide, "verification" in tide]).toEqual([false, false]);
    expect(core.evidence?.degree).toEqual(ALL_SR_DEGREE);
    const coast = await matrix(workspace, { selection: { ...SR, view: "VAR-126c01" } });
    expect([testCasesOf(coast, "B14"), statusOf(coast, "B14")]).toEqual([[], [`${ID.COAST} open`]]);
  });

  it("[SR-006/AK2] marks the matrix incomplete when an evidence location lies in a repository that is not on this machine", async () => {
    const workspace = await open();
    const before = workspace.get(evidenceReadState);
    const read = await before;
    const injected: EvidenceRead = { ...read, incomplete: true };
    await workspace.replace(evidenceReadState, before, Promise.resolve(injected));
    const output = await matrix(workspace, { selection: SR });
    expect([output.incomplete, output.evidence?.degree.total]).toEqual([true, 9]);
    // Without evidence columns the evidence read is not asked.
    expect((await matrix(workspace, { selection: { ids: [ID.N01] } })).incomplete).toBe(false);
  });
});

describe("trace.matrix marks (SR-126 AK2)", () => {
  it("[SR-126/AK2] leaves the test case cell of a requirement without test case empty", async () => {
    const output = await matrix(await open(), { selection: SR });
    // b05 has only an inspection record (no test case, #528 Q3), b06 no evidence at all.
    expect([testCasesOf(output, "B05"), statusOf(output, "B05")]).toEqual([[], ["core verified"]]);
    expect([testCasesOf(output, "B06"), statusOf(output, "B06")]).toEqual([[], ["core open"]]);
  });

  it("[SR-126/AK2] marks a test case without execution as not executed", async () => {
    const output = await matrix(await open(), { selection: SR });
    expect(rowOf(output, "B04").testCases).toEqual([
      { name: "test_gusts[SR-126b04]", className: "tests.test_wind", executed: false, mark: "not-executed" },
    ]);
  });

  it("[SR-126/AK2] marks a test case whose last execution failed as failed", async () => {
    const output = await matrix(await open(), { selection: SR });
    expect(testCasesOf(output, "B02")).toEqual([
      ["test_log[SR-126b02]", "failed", "2026-10-22T09:00:00Z", "failed"],
    ]);
    expect(rowOf(output, "B02").testCases?.[0]?.last?.version).toBe(VERSION.B02);
    // b01 failed in run 1 and passed in run 2: the last execution decides, no mark.
    expect(testCasesOf(output, "B01")).toEqual([
      ["test_speed[SR-126b01]", "passed", "2026-10-22T09:00:00Z", undefined],
    ]);
  });

  it("[SR-126/AK2] marks a test case whose last execution belongs to an older version as outdated", async () => {
    const output = await matrix(await open(), { selection: SR });
    expect(testCasesOf(output, "B03")).toEqual([
      ["test_trend[SR-126b03]", "passed", "2026-10-21T09:00:00Z", "outdated"],
    ]);
    expect(rowOf(output, "B03").testCases?.[0]?.last?.version).toBe("n1:0000000000000000");
    expect(statusOf(output, "B03")).toEqual(["core outdated"]);
  });
});

describe("trace.matrix indirect verification (SR-126 AK3)", () => {
  it("[SR-126/AK3] marks the verification status of an indirectly verified requirement as indirect", async () => {
    const output = await matrix(await open(), { selection: SR });
    expect([testCasesOf(output, "B07"), rowOf(output, "B07").verification]).toEqual([
      [],
      [{ view: "core", status: "indirect" }],
    ]);
  });

  it("an obsolete parent without own record and with verified children shows indirect on the page and is not counted in the degree", async () => {
    // b12 and b13 have the same content properties, so the same version.
    const child = "n1:744395a93994454c";
    const records = await open({
      ...MATRIX,
      files: {
        "requirements/SR-000000126b11.md": requirement("b11", "Show the old direction", "obsolete"),
        "requirements/SR-000000126b12.md": requirement("b12", "Show north", "draft", "", "B11"),
        "requirements/SR-000000126b13.md": requirement("b13", "Show south", "draft", "", "B11"),
        "evidence/2026-10-23-SR-126b12-test.md": passedRecord(ID.B12, child),
        "evidence/2026-10-23-SR-126b13-test.md": passedRecord(ID.B13, child),
      },
    });
    // The parent alone on the page, and alone in the selection: its children are prepared all the same.
    const page = await matrix(records, { selection: { ids: [ID.B11, ID.B12, ID.B13] }, limit: 1 });
    expect(page.rows.map((r) => [nameOf(r.id), r.status, r.verification])).toEqual([
      ["B11", "obsolete", [{ view: "core", status: "indirect" }]],
    ]);
    expect(page.evidence?.degree).toEqual({
      share: 1,
      total: 2,
      counts: { open: 0, verified: 2, indirect: 0, failed: 0, outdated: 0 },
    });
    const alone = await matrix(records, { selection: { ids: [ID.B11] } });
    expect([statusOf(alone, "B11"), alone.evidence?.degree]).toEqual([
      ["core indirect"],
      { total: 0, counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 } },
    ]);
  });
});

describe("trace.matrix verification degree (SR-126 AK4)", () => {
  it("[SR-126/AK4] gives above the status column the degree of the whole selection with the count per status", async () => {
    const workspace = await open();
    for (const page of [{}, { limit: 2 }, { offset: 8 }]) {
      const output = await matrix(workspace, { selection: SR, ...page });
      expect(output.evidence).toEqual({ view: "core", degree: ALL_SR_DEGREE });
      // Above the rows, as the readable output prints the keys in order.
      expect(Object.keys(output).slice(0, 3)).toEqual(["columns", "evidence", "rows"]);
    }
  });

  it("[SR-126/AK4] gives the degree evidence.degree gives for the same selection", async () => {
    const workspace = await open({ ...MATRIX, files: COAST_FILES });
    for (const selection of [
      SR,
      {},
      { ids: [ID.B01, ID.B02, ID.B07, ID.B10, ID.N01] },
      { ...SR, view: "VAR-126c01" },
    ]) {
      const output = await matrix(workspace, { selection, limit: 1 });
      const expected = await degree(workspace, { selection });
      expect(output.evidence).toEqual({ view: expected.view, degree: expected.degree });
    }
  });

  it("leaves a requirement with an invalid status out of the degree and still shows its cells", async () => {
    const output = await matrix(await open(), { selection: { ids: [ID.B10, ID.B02] } });
    expect([testCasesOf(output, "B10"), statusOf(output, "B10")]).toEqual([
      [["test_old[SR-126b10]", "passed", "2026-10-21T09:00:00Z", undefined]],
      ["core verified"],
    ]);
    expect(output.evidence?.degree).toEqual({
      share: 0,
      total: 1,
      counts: { open: 0, verified: 0, indirect: 0, failed: 1, outdated: 0 },
    });
  });
});
