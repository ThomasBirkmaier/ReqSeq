// Outdated evidence (SR-025 AK4) at core level (decision on ThomasBirkmaier/ReqSeq-archive#127, option 1): stage 4 reads the
// evidence records (SR-028, ThomasBirkmaier/ReqSeq-archive#40); here they are given through `evidenceRecordsState`, and
// `workspace.check` reports the evidence of an element whose newest record is for an older version.
// The CLI test follows with the records in stage 4.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { forms } from "../model/version-forms.test-helper.js";
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
import {
  currentVersionOf,
  currentVersionsState,
  elementStoreState,
  NORMAL_FORM,
  shortIdState,
} from "../model/index.js";
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
const A_VERSION = "n1:e73a2cb229cfa29d";
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

/**
 * `workspace.check` without `evidence.counts-in-no-view`: A applies in Pro only, so its records without
 * variant count in no view (SR-047 AK5, tested in `commands/evidence/per-variant.test.ts`).
 */
const check = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>> = {},
): Promise<Output> => {
  const out = (await invoke("workspace.check", input, { workspace })) as Output;
  return { ...out, problems: out.problems.filter((p) => p.code !== "evidence.counts-in-no-view") };
};

/** The current version of `id` in the form the tool writes. */
const currentOf = async (workspace: Workspace, id: string): Promise<string | undefined> => {
  const versions = await workspace.get(currentVersionsState);
  const record = (await workspace.get(elementStoreState)).byId.get(id)?.[0];
  return record === undefined ? undefined : currentVersionOf(versions, record);
};

const record = (
  element: string,
  version: string,
  date: string,
  more: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({ kind: "verification", element, version, date, result: "passed", ...more });

describe("outdated evidence (SR-025 AK4)", () => {
  it("[SR-025/AK4] reports the evidence of a requirement whose records all belong to older versions, naming the newest", async () => {
    const workspace = await withRecords([
      record(A, OLD, "2026-01-01T10:00:00Z"),
      record(A, OLD, "2026-01-02T10:00:00Z", { repository: "system", file: "evidence/results.xml", line: 7 }),
    ]);
    const out = await check(workspace);
    // A warning: the check is ok by default and fails with failOn warning (ThomasBirkmaier/ReqSeq-archive#304).
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
        currentVersion: await currentOf(workspace, A),
      },
    ]);
  });

  it("[SR-025/AK4] reports nothing when a record of the current version is older than one of an older version (#201)", async () => {
    // The hint follows the status (product owner decision, 2026-10-29): verified by the current record.
    const workspace = await withRecords([
      record(A, A_VERSION, "2026-01-01T10:00:00Z"),
      record(A, OLD, "2026-01-02T10:00:00Z"),
    ]);
    expect(await check(workspace)).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK4] reports nothing when the newest record is for the current version", async () => {
    const workspace = await withRecords([
      record(A, OLD, "2026-01-01T10:00:00Z"),
      record(A, A_VERSION, "2026-01-02T10:00:00+02:00"),
    ]);
    expect(await check(workspace)).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-025/AK4] reports a criterion with records of older versions only while the others are verified (SR-031 AK8)", async () => {
    // fixtures/SR-031/criteria: SR-0000e3 has AK1 and AK2 passed at its current version, AK3 only at
    // an older one, so its status is outdated (SR-031 AK8); the other requirements are not outdated.
    const fixture = await createFixtureWorkspace({ fixture: "SR-031/criteria" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const E3 = "31313131-0000-4000-8000-3131310000e3";
    const status = (await invoke(
      "evidence.status",
      { selection: { ids: [E3] } },
      { workspace },
    )) as CommandOutput<"evidence.status">;
    expect(status.elements[0]?.verification?.[0]?.status).toBe("outdated");
    const out = (await invoke("workspace.check", { failOn: "warning" }, { workspace })) as Output;
    expect(out.ok).toBe(false);
    expect(out.problems.filter((p) => p.code === "evidence.outdated")).toEqual([
      {
        code: "evidence.outdated",
        severity: "warning",
        message:
          "The verification of System Requirement SR-0000e3 is outdated: AK3 only has records of older versions, the newest from 2026-11-02T10:00:00Z",
        repository: "system",
        file: "evidence/e3-ak3-older.md",
        line: 1,
        elementId: E3,
        elementShortId: "SR-0000e3",
        elementRepository: "system",
        elementFile: "requirements/SR-3131310000e3.md",
        storedVersion: "n2:0000000000000000",
        currentVersion: "n2:de10890cdf8c6167",
      },
    ]);
  });

  it("[SR-025/AK4] names every criterion with records of older versions only, and none once all are verified", () => {
    const element = { id: B } as Parameters<typeof outdatedEvidenceFindings>[0][number];
    const findings = (records: readonly EvidenceRecord[]): string[] =>
      outdatedEvidenceFindings(
        [element],
        records,
        () => forms(A_VERSION),
        () => "B",
        () => false,
        () => 3,
      ).map((p) => p.message);
    const two = [
      record(B, A_VERSION, "2026-01-02T00:00:00Z", { criteria: [1] }),
      record(B, OLD, "2026-01-01T00:00:00Z", { criteria: [2] }),
      record(B, OLD, "2026-01-01T01:00:00Z", { criteria: [3] }),
    ];
    expect(findings(two)).toEqual([
      "The verification of B is outdated: AK2, AK3 only have records of older versions, the newest from 2026-01-01T01:00:00Z",
    ]);
    expect(findings([...two, record(B, A_VERSION, "2026-01-03T00:00:00Z")])).toEqual([]);
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

  it("[SR-025/AK4] counts a record of either normal form of the current version (ADR-0005)", () => {
    const element = { id: B } as Parameters<typeof outdatedEvidenceFindings>[0][number];
    const both = { n1: A_VERSION, n2: "n2:1111111111111111" };
    const label = (): string => "B";
    const unmarked = (): boolean => false;
    expect(
      outdatedEvidenceFindings(
        [element],
        [record(B, both.n2, "2026-01-01T00:00:00Z")],
        () => both,
        label,
        unmarked,
      ),
    ).toEqual([]);
    const outdated = outdatedEvidenceFindings(
      [element],
      [record(B, "n2:2222222222222222", "2026-01-01T00:00:00Z")],
      () => both,
      label,
      unmarked,
    );
    expect(outdated.map((p) => [p.storedVersion, p.currentVersion])).toEqual([
      ["n2:2222222222222222", both[NORMAL_FORM]],
    ]);
  });

  it("leaves out records of elements that are not in the store or have no current version", () => {
    const element = { id: B } as Parameters<typeof outdatedEvidenceFindings>[0][number];
    const label = (): string => "B";
    const unmarked = (): boolean => false;
    expect(
      outdatedEvidenceFindings(
        [],
        [record(A, OLD, "2026-01-01T00:00:00Z")],
        () => forms(A_VERSION),
        label,
        unmarked,
      ),
    ).toEqual([]);
    expect(
      outdatedEvidenceFindings(
        [element],
        [record(B, OLD, "2026-01-01T00:00:00Z")],
        () => undefined,
        label,
        unmarked,
      ),
    ).toEqual([]);
    // A tie on the newest date: the record of the current version counts, in either order.
    const tie = [record(B, A_VERSION, "2026-01-01T00:00:00Z"), record(B, OLD, "2026-01-01T00:00:00Z")];
    expect(outdatedEvidenceFindings([element], tie, () => forms(A_VERSION), label, unmarked)).toEqual([]);
    expect(
      outdatedEvidenceFindings([element], [...tie].reverse(), () => forms(A_VERSION), label, unmarked),
    ).toEqual([]);
    // A date that cannot be read counts as the oldest, in either order.
    const unreadable = [record(B, OLD, "not a date"), record(B, A_VERSION, "2026-01-01T00:00:00Z")];
    expect(outdatedEvidenceFindings([element], unreadable, () => forms(A_VERSION), label, unmarked)).toEqual(
      [],
    );
    expect(
      outdatedEvidenceFindings([element], [...unreadable].reverse(), () => forms(A_VERSION), label, unmarked),
    ).toEqual([]);
    // A tie of records of an element that is not in the store decides nothing.
    expect(
      outdatedEvidenceFindings(
        [element],
        [...tie, record(A, OLD, "2026-01-01T00:00:00Z"), record(A, A_VERSION, "2026-01-01T00:00:00Z")],
        () => forms(A_VERSION),
        label,
        unmarked,
      ),
    ).toEqual([]);
    // The newest record of a variant names the variant.
    expect(
      outdatedEvidenceFindings(
        [element],
        [record(B, OLD, "2026-01-01T00:00:00Z", { variant: V })],
        () => forms(A_VERSION),
        label,
        unmarked,
      ).map((p) => p.message),
    ).toEqual([
      `The newest verification record of B for variant ${V}, from 2026-01-01T00:00:00Z, is for an older version`,
    ]);
  });

  it("follows the pooled status of an element of a marked repository: a current record without variant settles a variant (SR-173, #817 Q10)", () => {
    const element = { id: B, repository: "supplier" } as Parameters<
      typeof outdatedEvidenceFindings
    >[0][number];
    const marked = (e: { readonly repository: string }): boolean => e.repository === "supplier";
    const label = (): string => "B";
    const forV = record(B, OLD, "2026-01-02T00:00:00Z", { variant: V });
    const coreCurrent = record(B, A_VERSION, "2026-01-01T00:00:00Z");
    const findings = (records: readonly EvidenceRecord[], independent: typeof marked) =>
      outdatedEvidenceFindings([element], records, () => forms(A_VERSION), label, independent).map(
        (p) => p.message,
      );
    expect(findings([forV, coreCurrent], marked)).toEqual([]);
    // Without the mark the variant's group stands alone (SR-173 AK2).
    expect(findings([forV, coreCurrent], () => false)).toHaveLength(1);
    // A record without variant of an older version does not settle it, nor does a validation record.
    expect(findings([forV, record(B, OLD, "2026-01-01T00:00:00Z")], marked)).toHaveLength(2);
    expect(
      findings([forV, record(B, A_VERSION, "2026-01-01T00:00:00Z", { kind: "validation" })], marked),
    ).toHaveLength(1);
    // A variant's records all current, an older record without variant for another criterion: the
    // pooled status of the variant is outdated, and the hint is the core's, whose record it is.
    const criteria = (): number => 2;
    expect(
      outdatedEvidenceFindings(
        [element],
        [
          record(B, A_VERSION, "2026-01-02T00:00:00Z", { variant: V, criteria: [1] }),
          record(B, OLD, "2026-01-01T00:00:00Z", { criteria: [2] }),
        ],
        () => forms(A_VERSION),
        label,
        marked,
        criteria,
      ).map((p) => p.message),
    ).toEqual(["The newest verification record of B, from 2026-01-01T00:00:00Z, is for an older version"]);
  });

  it("is computed again when the workspace file marks the repository (SR-173)", async () => {
    const workspace = await withRecords([
      record(A, OLD, "2026-01-02T00:00:00Z", { variant: V }),
      record(A, A_VERSION, "2026-01-01T00:00:00Z"),
    ]);
    expect(await workspace.get(outdatedEvidenceProblemsState)).toHaveLength(1);
    const layout = workspace.get(workspaceLayoutState);
    const marked = layout.then((l) => ({
      ...l,
      repositories: l.repositories.map((r) => ({ ...r, variantIndependent: true })),
    }));
    await workspace.replace(workspaceLayoutState, layout, marked);
    expect(await workspace.get(outdatedEvidenceProblemsState)).toEqual([]);
  });

  it("reports nothing against a metamodel that is not valid (ThomasBirkmaier/ReqSeq-archive#208, ThomasBirkmaier/ReqSeq-archive#220)", async () => {
    const workspace = await withRecords([record(A, OLD, "2026-01-01T00:00:00Z")], {
      "metamodel/broken.yaml": "properties: [\n",
    });
    expect(await workspace.get(outdatedEvidenceProblemsState)).toEqual([]);
  });

  it("outdatedEvidenceFindings still reads the records through the moved state", async () => {
    // The whole path the readers of SR-028 and SR-093 take: an evidence file, a reader,
    // `evidenceReadState`, `evidenceRecordsState`, the check (ThomasBirkmaier/ReqSeq-archive#535).
    const fixture = await createFixtureWorkspace({
      fixture: "SR-025/outdated",
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
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

  describe("the hint of one element (element.get) gives what the state gives (ThomasBirkmaier/ReqSeq-archive#698)", () => {
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
      // name, the records (and so the state) keep the order of the workspace file (review of ThomasBirkmaier/ReqSeq-archive#698, S1).
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

    it("[SR-026/AK3] [SR-025/AK4] agrees with the state for two copies of one UUID and a record of one copy's version", async () => {
      // Two copies of one need with different versions (SR-088) and one record of one copy's version.
      // Each copy is checked against its own version: only the other copy is reported, whichever copy
      // the record is of. The hint of one element gives the same. Which version is current for a
      // shared UUID is open (ThomasBirkmaier/ReqSeq-archive#713).
      const COPIED = "948a10f1-05c3-4212-bd19-00606ccf2661";
      const fixture = await createFixtureWorkspace({
        fixture: "SR-088/copied-file",
        files: {
          "system/copies/N-00606ccf2661.md": [
            "---",
            `id: ${COPIED}`,
            "type: need",
            "status: draft",
            "title: Wind speed visible at a glance (copy)",
            "---",
            "",
            "The wind speed is visible from the door.",
            "",
          ].join("\n"),
        },
      });
      onTestFinished(() => fixture.cleanup());
      const workspace = new Workspace(fixture.path("system"));
      onTestFinished(() => workspace.close());
      const versions = await workspace.get(currentVersionsState);
      const copies = versions.store.byId.get(COPIED) ?? [];
      const [first, second] = copies.map((copy) => currentVersionOf(versions, copy) ?? "");
      expect(copies).toHaveLength(2);
      expect(first).not.toEqual(second);
      const context = {
        workspace,
        layout: await workspace.get(workspaceLayoutState),
        metamodel: await workspace.get(metamodelState),
        store: versions.store,
        shortIds: await workspace.get(shortIdState),
      };
      const rows = (problems: readonly Problem[]): unknown[] =>
        problems.map((p) => [p.elementFile, p.storedVersion, p.currentVersion]);
      const cases = [
        { of: first ?? "", other: copies[1], expected: second },
        { of: second ?? "", other: copies[0], expected: first },
      ];
      for (const { of, other, expected } of cases) {
        await workspace.replace(
          evidenceRecordsState,
          workspace.get(evidenceRecordsState),
          Promise.resolve([record(COPIED, of, "2026-01-02T10:00:00Z", { file: "evidence/a.md", line: 1 })]),
        );
        const alone: Problem[] = [];
        for (const copy of copies) {
          alone.push(...(await elementEvidenceFindings(context, copy)).map((f) => f.problem));
        }
        const state = await workspace.get(outdatedEvidenceProblemsState);
        expect(rows(state)).toEqual([[other?.file, of, expected]]);
        expect(rows(alone)).toEqual(rows(state));
      }
    });
  });
});
