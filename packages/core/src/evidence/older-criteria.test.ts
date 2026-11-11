// The lookup of older criteria (`older-criteria.ts`, SR-031 AK11, product owner decision,
// 2026-11-11, #1502) on fixtures/SR-028/records with the repository `system` under Git: which records
// it looks up, how two lookups compare, and the verification status carried over a change that makes
// a record's version an older one.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { currentVersionOf, currentVersionsState, elementStoreState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { NO_OLDER_CRITERIA } from "./criteria.js";
import { olderCriteriaOf, olderCriteriaState, sameOlderCriteria } from "./older-criteria.js";
import type { EvidenceRecord } from "./record.js";
import { evidenceRecordsState } from "./state.js";

const A = "3c3c3c3c-3333-4333-8333-0d0000000001";
const UNKNOWN = "9f9f9f9f-9999-4999-8999-0d00000000ff";
const FILE = "system/requirements/SR-0d0000000001.md";

/** Element A with the acceptance criteria `criteria` (lines below the list item marker). */
const elementA = (criteria: readonly string[]): string =>
  `---\nid: ${A}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n` +
  `requirement-type: functional\nacceptance-criteria:\n${criteria.map((c) => `  - ${c}\n`).join("")}---\n\n` +
  "The station shows the current wind speed.\n";

/** A passed verification record of A's `version` naming `criteria`. */
const recordOf = (version: string, criteria: string): string =>
  "---\nreqseq-record: 1\nkind: verification\n" +
  `element: ${A}\nversion: ${version}\nmethod: test\nitem: build-600\n` +
  `result: passed\ndate: 2026-10-30T10:00:00Z\ncriteria: ${criteria}\n---\n`;

const versionOf = async (workspace: Workspace): Promise<string> => {
  const versions = await workspace.get(currentVersionsState);
  const element = versions.store.byId.get(A)?.[0];
  return element === undefined ? "" : String(currentVersionOf(versions, element));
};

/** A Git repository `system` whose HEAD holds A with the keyed criteria `kone` and `ktwo`. */
const committed = async (): Promise<{ ws: FixtureWorkspace; version: string }> => {
  const ws = await createFixtureWorkspace({
    fixture: "SR-028/records",
    files: { [FILE]: elementA(["key: kone\n    text: One.", "key: ktwo\n    text: Two."]) },
  });
  onTestFinished(() => ws.cleanup());
  await ws.git(["init", "--quiet", "--initial-branch=main"], "system");
  await ws.commit("system");
  const first = new Workspace(ws.path("system"));
  const version = await versionOf(first);
  await first.close();
  return { ws, version };
};

const open = (ws: FixtureWorkspace): Workspace => {
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const rows = async (workspace: Workspace): Promise<unknown[]> =>
  (
    (await invoke("evidence.list", { ref: A }, { workspace })) as CommandOutput<"evidence.list">
  ).display.rows.map((row) => [row.criterion, row.key, row.status]);

describe("older criteria (SR-031 AK11)", () => {
  it("looks up only verification records of an older version of a known element that name a number, or a key the current criteria lack", async () => {
    const { ws, version } = await committed();
    await ws.write(FILE, elementA(["key: kone\n    text: One."]));
    const workspace = open(ws);
    const [metamodel, store] = await Promise.all([
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
    ]);
    const record = (more: Partial<EvidenceRecord>): EvidenceRecord => ({
      element: A,
      version,
      kind: "verification",
      method: "test",
      item: "b",
      result: "passed",
      date: "2026-10-30T10:00:00Z",
      ...more,
    });
    const lookup = (records: readonly EvidenceRecord[]) =>
      olderCriteriaOf(workspace, metamodel, store, records);
    // Nothing to look up: no criteria, a key the current criteria carry, an unknown element, validation.
    for (const records of [
      [record({})],
      [record({ criteria: ["kone"] })],
      [record({ element: UNKNOWN, criteria: [1] })],
      [record({ kind: "validation", criteria: [1] })],
    ]) {
      expect(await lookup(records)).toBe(NO_OLDER_CRITERIA);
    }
    const byNumber = await lookup([record({ criteria: [2] })]);
    expect(byNumber(A, version)).toEqual([
      { key: "kone", text: "One." },
      { key: "ktwo", text: "Two." },
    ]);
    expect(byNumber(A, "n1:0000000000000000")).toBeUndefined();
    // The same items from another build compare equal; other items or none do not.
    expect(sameOlderCriteria(byNumber, await lookup([record({ criteria: ["ktwo"] })]))).toBe(true);
    expect(sameOlderCriteria(byNumber, byNumber)).toBe(true);
    expect(sameOlderCriteria(byNumber, NO_OLDER_CRITERIA)).toBe(false);
    expect(sameOlderCriteria(NO_OLDER_CRITERIA, byNumber)).toBe(false);
    // A version Git does not have gives nothing (#1502).
    expect(await lookup([record({ version: "n1:0000000000000000", criteria: [2] })])).toBe(NO_OLDER_CRITERIA);
    // Nor for an element with two copies (SR-088).
    const copies = [...(store.byId.get(A) ?? []), ...(store.byId.get(A) ?? [])];
    const twin = { ...store, byId: new Map([[A, copies]]) } as typeof store;
    expect(await olderCriteriaOf(workspace, metamodel, twin, [record({ criteria: [2] })])).toBe(
      NO_OLDER_CRITERIA,
    );
    // Without a valid metamodel nothing is looked up.
    expect(
      await olderCriteriaOf(workspace, { ...metamodel, valid: false }, store, [record({ criteria: [2] })]),
    ).toBe(NO_OLDER_CRITERIA);
  });

  it("[SR-031/AK11] counts a number of an older version through its key in a status carried over the change that made the version older", async () => {
    const { ws, version } = await committed();
    // Without the fixture's record for every criterion, only the record by number counts.
    await fs.rm(ws.path("ci-results/evidence/2026-10-20-SR-000001-test.md"));
    await ws.write("ci-results/evidence/2026-10-30-a-test.md", recordOf(version, "[2]"));
    const workspace = open(ws);
    expect(await workspace.get(olderCriteriaState)).toBe(NO_OLDER_CRITERIA);
    expect(await rows(workspace)).toEqual([
      [1, "kone", "open"],
      [2, "ktwo", "verified"],
    ]);
    // A new text of `kone` gives a new version (and `kone` a new key); number 2 of the old version
    // is `ktwo` in Git, so the record counts, outdated, for the current `ktwo`.
    await invoke(
      "element.update",
      { ref: A, set: { "acceptance-criteria": ["One, changed.", { key: "ktwo", text: "Two." }] } },
      { workspace },
    );
    expect(await versionOf(workspace)).not.toBe(version);
    const carried = await rows(workspace);
    expect(carried).toEqual([
      [1, expect.any(String), "open"],
      [2, "ktwo", "outdated"],
    ]);
    expect(await rows(open(ws))).toEqual(carried);
    expect((await workspace.get(evidenceRecordsState)).length).toBe(2);
  });

  it("[SR-205/AK2] names a criterion a record of an older version names by number, without key there, with that number and that version's text, where Git has the version", async () => {
    const ws = await createFixtureWorkspace({
      fixture: "SR-028/records",
      files: { [FILE]: elementA(["One.", "Two."]) },
    });
    onTestFinished(() => ws.cleanup());
    await fs.rm(ws.path("ci-results/evidence/2026-10-20-SR-000001-test.md"));
    await ws.git(["init", "--quiet", "--initial-branch=main"], "system");
    await ws.commit("system");
    const first = new Workspace(ws.path("system"));
    const old = await versionOf(first);
    await first.close();
    await ws.write(FILE, elementA(["One.", "Two, changed."]));
    await ws.commit("system");
    await ws.write("ci-results/evidence/2026-10-30-a-test.md", recordOf(old, "[2]"));
    await ws.write(
      "ci-results/evidence/2026-10-31-b-test.md",
      recordOf("n1:0000000000000000", "[2]").replace("2026-10-30", "2026-10-31"),
    );
    const workspace = open(ws);
    // The current criteria carry no key, so the status needs no lookup; the record counts for none.
    expect(await workspace.get(olderCriteriaState)).toBe(NO_OLDER_CRITERIA);
    const listed = (await invoke(
      "evidence.list",
      { ref: A },
      { workspace },
    )) as CommandOutput<"evidence.list">;
    expect(listed.records.map((r) => [r.version, r.criterionNames])).toEqual([
      // A version Git does not have: the number as named, no text.
      ["n1:0000000000000000", [{ criterion: 2 }]],
      [old, [{ criterion: 2, text: "Two." }]],
    ]);
  });
});
