// Every output that lists records names the criteria they name with number, key and text
// (SR-205 AK2, `recordNamer`): evidence.list with its test cases, trace.chain, trace.matrix,
// trace.affected, baseline.get and evidence.record. On fixtures/SR-031/criteria: SR-0000e3 has the
// criteria kred, kdas and kfro at its current version n2:de10890cdf8c6167; e3-ak12 names [1, 2] of
// that version, e3-ak3-older names kfro of an older one.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const E3 = "31313131-0000-4000-8000-3131310000e3";
const CURRENT = "n2:de10890cdf8c6167";

const KRED = { criterion: 1, key: "kred", text: "Given a reading, then it shows." };
const KDAS = { criterion: 2, key: "kdas", text: "Given no reading, then a dash shows." };
const KFRO = { criterion: 3, key: "kfro", text: "Given frost, then a mark shows." };

const record = (fields: string): string =>
  `---\nreqseq-record: 1\nkind: verification\nelement: ${E3}\nmethod: test\nitem: build-7\n${fields}---\n`;

const open = async (extra: Record<string, string> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-031/criteria",
    files: {
      // A test case of the current version that names kfro, and an older record by number (no Git:
      // its number counts for none and keeps its number, without key and text).
      "evidence/e3-case.md": record(
        `version: ${CURRENT}\nresult: failed\ntest-case: display > frost\ncriteria: [kfro]\ndate: 2026-11-03T10:00:00Z\n`,
      ),
      "evidence/e3-older-number.md": record(
        "version: n2:1111111111111111\nresult: passed\ncriteria: [2]\ndate: 2026-11-01T10:00:00Z\n",
      ),
      "baselines/release-1.yaml":
        "reqseq-baseline: 1\nname: Release 1\ndate: 2026-11-01T12:00:00Z\nrepositories:\n" +
        "  - { name: system, commit: 31a031a031a031a031a031a031a031a031a031a0 }\n" +
        `elements:\n  - { id: ${E3}, version: ${CURRENT} }\n`,
      ...extra,
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const run = async <
  N extends "evidence.list" | "trace.chain" | "trace.matrix" | "trace.affected" | "baseline.get",
>(
  workspace: Workspace,
  name: N,
  input: Record<string, unknown>,
): Promise<CommandOutput<N>> => (await invoke(name, input, { workspace })) as CommandOutput<N>;

describe("records name their criteria with number, key and text in every output (SR-205 AK2)", () => {
  it("[SR-205/AK-m2vv] evidence.list names the criteria of the executions of its test cases", async () => {
    const workspace = await open();
    const out = await run(workspace, "evidence.list", { ref: E3 });
    const [test] = out.testCases;
    expect(test?.executions.map((r) => r.criterionNames)).toEqual([[KFRO]]);
    expect(test?.last?.criterionNames).toEqual([KFRO]);
  });

  it("[SR-205/AK-m2vv] trace.chain names the criteria of the records and test cases below an element", async () => {
    const workspace = await open();
    const out = await run(workspace, "trace.chain", { ref: E3, direction: "down" });
    const below = out.evidence.find((e) => e.id === E3);
    expect(below?.testCases[0]?.last?.criterionNames).toEqual([KFRO]);
    expect(
      below?.records.find((r) => r.date === "2026-11-02T10:00:00Z" && r.version === CURRENT)?.criterionNames,
    ).toEqual([KRED, KDAS]);
  });

  it("[SR-205/AK-m2vv] trace.matrix names the criteria of the last execution of a test case", async () => {
    const workspace = await open();
    const out = await run(workspace, "trace.matrix", { selection: { ids: [E3] } });
    expect(out.rows[0]?.testCases?.[0]?.last?.criterionNames).toEqual([KFRO]);
  });

  it("[SR-205/AK-m2vv] trace.affected names the criteria of the records of older versions: a key with the current number, a number without Git as named", async () => {
    const workspace = await open();
    const out = await run(workspace, "trace.affected", { ref: E3 });
    expect(out.records.map((r) => r.criterionNames)).toEqual([[KFRO], [{ criterion: 2 }]]);
  });

  it("[SR-205/AK-m2vv] baseline.get names the criteria of the later records with the numbers of the baseline's version", async () => {
    const workspace = await open();
    const out = await run(workspace, "baseline.get", { baseline: "Release 1", withEvidence: true });
    const later = out.elements.find((e) => e.id === E3)?.verification?.[0]?.later ?? [];
    expect(later.map((r) => r.criterionNames)).toEqual([[KFRO], [KRED, KDAS]]);
  });

  it("[SR-205/AK-m2vv] baseline.get names the criteria of later records by what they name where Git does not have the baseline's version", async () => {
    const workspace = await open({
      "baselines/release-0.yaml":
        "reqseq-baseline: 1\nname: Release 0\ndate: 2026-10-01T12:00:00Z\nrepositories:\n" +
        "  - { name: system, commit: 31a031a031a031a031a031a031a031a031a031a0 }\n" +
        `elements:\n  - { id: ${E3}, version: n2:0000000000000000 }\n`,
    });
    const out = await run(workspace, "baseline.get", { baseline: "Release 0", withEvidence: true });
    const later = out.elements.find((e) => e.id === E3)?.verification?.[0]?.later ?? [];
    expect(later.map((r) => r.criterionNames)).toEqual([[{ key: "kfro" }]]);
  });

  it("[SR-205/AK-m2vv] evidence.record names the criteria of the record it wrote with their whole texts", async () => {
    const workspace = await open();
    const out = (await invoke(
      "evidence.record",
      {
        ref: E3,
        kind: "verification",
        method: "inspection",
        item: "Display sample B3",
        result: "passed",
        criteria: ["kfro", 1],
        date: "2026-11-04T10:00:00Z",
      },
      { workspace },
    )) as CommandOutput<"evidence.record">;
    // The record lists its keys in code-unit order, and names them in that order.
    expect(out.record.criteria).toEqual(["kfro", "kred"]);
    expect(out.record.criterionNames).toEqual([KFRO, KRED]);
  });
});
