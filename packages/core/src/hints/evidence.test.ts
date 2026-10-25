// Outdated evidence (SR-025 AK4) at core level (decision on #127, option 1): stage 4 reads the
// evidence records (SR-028, #40); here they are given through `evidenceRecordsState`, and
// `workspace.check` reports the evidence of an element whose newest record is for an older version.
// The CLI test follows with the records in stage 4.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import type { EvidenceVersion } from "./evidence.js";
import { evidenceRecordsState, outdatedEvidenceFindings, outdatedEvidenceProblemsState } from "./evidence.js";

type Output = CommandOutput<"workspace.check">;

const P = "5e025a7d-2b4f-4c61-9d08-0";
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const V = `${P}c0000000001`;
/** The current versions of A and B in fixtures/SR-025/outdated. */
const A_VERSION = "n1:c432bd0d8bcd0958";
const OLD = "n1:0000000000000000";

/** A workspace on fixtures/SR-025/outdated whose evidence records are `records`. */
const withRecords = async (
  records: readonly EvidenceVersion[],
  files: Readonly<Record<string, string>> = {},
): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-025/outdated", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const empty = workspace.get(evidenceRecordsState);
  expect(await empty).toEqual([]);
  await workspace.replace(evidenceRecordsState, empty, Promise.resolve(records));
  return workspace;
};

const check = async (workspace: Workspace): Promise<Output> =>
  (await invoke("workspace.check", {}, { workspace })) as Output;

const record = (
  element: string,
  version: string,
  date: string,
  more: Partial<EvidenceVersion> = {},
): EvidenceVersion => ({ kind: "verification", element, version, date, ...more });

describe("outdated evidence (SR-025 AK4)", () => {
  it("[SR-025/AK4] reports the evidence of a requirement whose newest record is for an older version", async () => {
    const workspace = await withRecords([
      record(A, A_VERSION, "2026-01-01T10:00:00Z"),
      record(A, OLD, "2026-01-02T10:00:00Z", { repository: "system", file: "evidence/results.xml", line: 7 }),
    ]);
    const out = await check(workspace);
    expect(out.ok).toBe(false);
    expect(out.problems).toEqual([
      {
        code: "evidence.outdated",
        severity: "warning",
        message:
          "The newest verification record of System Requirement SR-b0000000001, from 2026-01-02T10:00:00Z, is for an older version",
        repository: "system",
        file: "evidence/results.xml",
        line: 7,
        elementId: A,
        elementRepository: "system",
        elementFile: "requirements/SR-0b0000000001.md",
        storedVersion: OLD,
        currentVersion: A_VERSION,
      },
    ]);
  });

  it("[SR-025/AK4] reports nothing when the newest record is for the current version", async () => {
    const workspace = await withRecords([
      record(A, OLD, "2026-01-01T10:00:00Z"),
      record(A, A_VERSION, "2026-01-02T10:00:00+02:00"),
    ]);
    expect(await check(workspace)).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK4] takes the newest record per kind and variant", async () => {
    const workspace = await withRecords([
      record(A, A_VERSION, "2026-01-03T00:00:00Z"),
      record(A, OLD, "2026-01-02T00:00:00Z", { kind: "validation" }),
      record(A, OLD, "2026-01-01T00:00:00Z", { variant: V }),
      record(A, A_VERSION, "2026-01-01T00:00:00Z", { variant: V }),
    ]);
    expect(
      (await workspace.get(outdatedEvidenceProblemsState)).map((p) => [p.elementId, p.message, p.file]),
    ).toEqual([
      [
        A,
        "The newest validation record of System Requirement SR-b0000000001, from 2026-01-02T00:00:00Z, is for an older version",
        undefined,
      ],
    ]);
  });

  it("leaves out records of elements that are not in the store or have no current version", () => {
    const element = { id: B } as Parameters<typeof outdatedEvidenceFindings>[0][number];
    const label = (): string => "B";
    expect(
      outdatedEvidenceFindings([], [record(A, OLD, "2026-01-01T00:00:00Z")], () => A_VERSION, label),
    ).toEqual([]);
    expect(
      outdatedEvidenceFindings([element], [record(B, OLD, "2026-01-01T00:00:00Z")], () => undefined, label),
    ).toEqual([]);
    // A tie on the newest date: the record of the current version counts, in either order.
    const tie = [record(B, A_VERSION, "2026-01-01T00:00:00Z"), record(B, OLD, "2026-01-01T00:00:00Z")];
    expect(outdatedEvidenceFindings([element], tie, () => A_VERSION, label)).toEqual([]);
    expect(outdatedEvidenceFindings([element], [...tie].reverse(), () => A_VERSION, label)).toEqual([]);
    // A date that cannot be read counts as the oldest, in either order.
    const unreadable = [record(B, OLD, "not a date"), record(B, A_VERSION, "2026-01-01T00:00:00Z")];
    expect(outdatedEvidenceFindings([element], unreadable, () => A_VERSION, label)).toEqual([]);
    expect(outdatedEvidenceFindings([element], [...unreadable].reverse(), () => A_VERSION, label)).toEqual(
      [],
    );
    // A tie of records of an element that is not in the store decides nothing.
    expect(
      outdatedEvidenceFindings(
        [element],
        [...tie, record(A, OLD, "2026-01-01T00:00:00Z"), record(A, A_VERSION, "2026-01-01T00:00:00Z")],
        () => A_VERSION,
        label,
      ),
    ).toEqual([]);
    // The newest record of a variant names the variant.
    expect(
      outdatedEvidenceFindings(
        [element],
        [record(B, OLD, "2026-01-01T00:00:00Z", { variant: V })],
        () => A_VERSION,
        label,
      ).map((p) => p.message),
    ).toEqual([
      `The newest verification record of B for variant ${V}, from 2026-01-01T00:00:00Z, is for an older version`,
    ]);
  });

  it("reports nothing against a metamodel that is not valid (#208, #220)", async () => {
    const workspace = await withRecords([record(A, OLD, "2026-01-01T00:00:00Z")], {
      "metamodel/broken.yaml": "properties: [\n",
    });
    expect(await workspace.get(outdatedEvidenceProblemsState)).toEqual([]);
  });
});
