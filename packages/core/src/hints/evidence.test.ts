// Outdated evidence (SR-025 AK4) at core level (decision on #127, option 1): stage 4 reads the
// evidence records (SR-028, #40); here they are given through `evidenceRecordsState`, and
// `workspace.check` reports the evidence of an element whose newest record is for an older version.
// The CLI test follows with the records in stage 4.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import type { EvidenceIndex, EvidenceReader, EvidenceRecord } from "../evidence/index.js";
import {
  evidenceIndexState,
  evidenceReadState,
  evidenceRecordsState,
  readEvidence,
} from "../evidence/index.js";
import { loadWorkspaceLayout, workspaceLayoutState } from "../workspace/index.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import {
  elementEvidenceFindings,
  outdatedEvidenceFindings,
  outdatedEvidenceProblemsState,
} from "./evidence.js";

type Output = CommandOutput<"workspace.check">;

const P = "5e025a7d-2b4f-4c61-9d08-0";
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const N = `${P}a0000000001`;
const V = `${P}c0000000001`;
/** The current versions of A and B in fixtures/SR-025/outdated. */
const A_VERSION = "n1:c432bd0d8bcd0958";
const OLD = "n1:0000000000000000";

/** A workspace on fixtures/SR-025/outdated whose evidence records are `records`. */
const withRecords = async (
  records: readonly EvidenceRecord[],
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

const check = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("workspace.check", input, { workspace })) as Output;

const record = (
  element: string,
  version: string,
  date: string,
  more: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({ kind: "verification", element, version, date, result: "passed", ...more });

describe("outdated evidence (SR-025 AK4)", () => {
  it("[SR-025/AK4] reports the evidence of a requirement whose newest record is for an older version", async () => {
    const workspace = await withRecords([
      record(A, A_VERSION, "2026-01-01T10:00:00Z"),
      record(A, OLD, "2026-01-02T10:00:00Z", { repository: "system", file: "evidence/results.xml", line: 7 }),
    ]);
    const out = await check(workspace);
    // A warning: the check is ok by default and fails with failOn warning (#304).
    expect(out.ok).toBe(true);
    expect((await check(workspace, { failOn: "warning" })).ok).toBe(false);
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
        elementShortId: "SR-b0000000001",
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

  it("outdatedEvidenceFindings still reads the records through the moved state", async () => {
    // The whole path the readers of SR-028 and SR-093 take: an evidence file, a reader,
    // `evidenceReadState`, `evidenceRecordsState`, the check (#535).
    const fixture = await createFixtureWorkspace({
      fixture: "SR-025/outdated",
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n",
        "evidence/results.xml": "<testsuite/>\n",
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const reader: EvidenceReader = {
      extension: "xml",
      read: (file) => ({
        records: [
          record(A, OLD, "2026-01-01T00:00:00Z", { repository: file.repository, file: file.file, line: 1 }),
        ],
      }),
    };
    const read = workspace.get(evidenceReadState);
    expect((await read).records).toEqual([]);
    await workspace.replace(
      evidenceReadState,
      read,
      readEvidence(await loadWorkspaceLayout(fixture.root), [reader]),
    );
    expect((await check(workspace)).problems.map((p) => [p.code, p.elementId, p.file, p.line])).toEqual([
      ["evidence.outdated", A, "evidence/results.xml", 1],
    ]);
  });

  describe("the hint of one element (element.get) gives what the state gives (#698)", () => {
    type Shown = CommandOutput<"element.get">;
    /** The fields of an `evidence.outdated` problem, without what `invoke` adds (`elementShortId`). */
    const fieldsOf = (p: Problem): unknown[] => [
      p.code,
      p.message,
      p.repository,
      p.file,
      p.line,
      p.elementId,
      p.elementRepository,
      p.elementFile,
      p.storedVersion,
      p.currentVersion,
    ];
    const hintsAt = async (workspace: Workspace, id: string): Promise<unknown[][]> =>
      (((await invoke("element.get", { ref: id }, { workspace })) as Shown).element.problems ?? [])
        .filter((p) => p.code === "evidence.outdated")
        .map(fieldsOf);
    const versionOf = async (workspace: Workspace, id: string): Promise<string> =>
      ((await invoke("element.get", { ref: id }, { workspace })) as Shown).element.version ?? "";

    /** The hints `element.get` shows for each element before the state is built, then those of the state. */
    const both = async (records: readonly EvidenceRecord[]): Promise<[unknown[][], unknown[][]]> => {
      const workspace = await withRecords(records);
      const alone: unknown[][] = [];
      for (const id of [N, A, B]) {
        alone.push(...(await hintsAt(workspace, id)));
      }
      expect(workspace.peek(outdatedEvidenceProblemsState)).toBeUndefined();
      const state = (await workspace.get(outdatedEvidenceProblemsState)).map(fieldsOf);
      return [alone, state];
    };

    it("[SR-026/AK3] [SR-025/AK4] names the first record of a tie in the order of the records, not of the index", async () => {
      // Two locations whose repositories are not in name order: the index sorts a tie by repository
      // name, the records (and so the state) keep the order of the workspace file (review of #698, S1).
      const at = "2026-01-02T10:00:00Z";
      const [alone, state] = await both([
        record(A, OLD, at, { repository: "zeta", file: "evidence/a.md", line: 1 }),
        record(A, "n1:1111111111111111", at, { repository: "alpha", file: "evidence/b.md", line: 1 }),
      ]);
      expect(state.map((p) => p[2])).toEqual(["zeta"]);
      expect(alone).toEqual(state);
    });

    it("[SR-026/AK3] [SR-025/AK4] agrees with the state on generated records (kinds, variants, ties, unknown elements)", async () => {
      const probe = await withRecords([]);
      const current = new Map([
        [N, await versionOf(probe, N)],
        [A, A_VERSION],
        [B, await versionOf(probe, B)],
      ]);
      const unknown = `${P}ff00000000ff`;
      for (let seed = 1; seed <= 12; seed += 1) {
        // A small linear congruential generator: the same records for the same seed.
        let state = seed;
        const next = (n: number): number => {
          state = (state * 1103515245 + 12345) % 2147483648;
          return state % n;
        };
        const pick = <T>(values: readonly T[]): T => values[next(values.length)] as T;
        const records = Array.from({ length: 4 + next(10) }, (_, i): EvidenceRecord => {
          const element = pick([N, A, B, unknown]);
          return record(
            element,
            pick([current.get(element) ?? OLD, OLD, "n1:2222222222222222"]),
            pick(["2026-01-01T00:00:00Z", "2026-01-01T01:00:00+01:00", "2026-01-02T00:00:00Z", "not a date"]),
            {
              kind: pick(["verification", "validation"] as const),
              repository: pick(["zeta", "alpha", "mid"]),
              file: `evidence/${String(seed)}-${String(i)}.md`,
              line: 1 + next(3),
              ...(next(3) === 0 ? { variant: V } : {}),
              result: pick(["passed", "failed"] as const),
            },
          );
        });
        const [alone, expected] = await both(records);
        expect(alone, `seed ${String(seed)}`).toEqual(expected);
      }
    });

    it("looks up only the records of the element shown", async () => {
      const workspace = await withRecords([
        record(A, OLD, "2026-01-02T10:00:00Z"),
        record(B, OLD, "2026-01-02T10:00:00Z"),
      ]);
      const before = workspace.get(evidenceIndexState);
      const index = await before;
      const asked: string[] = [];
      /** The records by element, which may be asked by key but never walked. */
      class Watched extends Map<string, readonly EvidenceRecord[]> {
        override get(id: string): readonly EvidenceRecord[] | undefined {
          asked.push(id);
          return super.get(id);
        }
        override entries(): MapIterator<[string, readonly EvidenceRecord[]]> {
          throw new Error("walked every element");
        }
        override values(): MapIterator<readonly EvidenceRecord[]> {
          throw new Error("walked every element");
        }
      }
      const watched: EvidenceIndex = { ...index, byElement: new Watched(index.byElement) };
      await workspace.replace(evidenceIndexState, before, Promise.resolve(watched));
      const store = await workspace.get(elementStoreState);
      const element = store.byId.get(A)?.[0];
      if (element === undefined) {
        throw new Error("A is not in the store");
      }
      const context = {
        workspace,
        layout: await workspace.get(workspaceLayoutState),
        metamodel: await workspace.get(metamodelState),
        store,
        shortIds: await workspace.get(shortIdState),
      };
      expect(await elementEvidenceFindings(context, element)).toHaveLength(1);
      expect(asked).toEqual([A]);
      // An element without records reads no version and finds nothing.
      const other = store.byId.get(N)?.[0];
      expect(other === undefined ? undefined : await elementEvidenceFindings(context, other)).toEqual([]);
      expect(asked).toEqual([A, N]);
    });
  });
});
