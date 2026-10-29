// SR-028 AK3: the findings of the evidence records (`match.ts`) for `workspace.check`, on
// fixtures/SR-028/records (requirements in `system`, records in `ci-results/evidence`).
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { evidenceProblemsState, recordElementProblems } from "./match.js";
import type { EvidenceRecord } from "./record.js";
import { evidenceRecordsState } from "./state.js";

const A = "3c3c3c3c-3333-4333-8333-0d0000000001";
const UNKNOWN = "9f9f9f9f-9999-4999-8999-0d00000000ff";

/** A record of `element` in `ci-results/evidence/<name>`. */
const recordFile = (element: string): string =>
  "---\nreqseq-record: 1\nkind: verification\n" +
  `element: ${element}\nversion: n1:de6d3ed288b0f3de\nmethod: test\nitem: build-513\n` +
  "result: failed\ndate: 2026-10-23T10:00:00Z\n---\n";

/** `workspace.check` with `input`. */
const check = async (workspace: Workspace, input: object = {}): Promise<CommandOutput<"workspace.check">> =>
  (await invoke("workspace.check", input, { workspace })) as CommandOutput<"workspace.check">;

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-028/records", files });
  const workspace = new Workspace(ws.path("system"));
  onTestFinished(async () => {
    await workspace.close();
    await ws.cleanup();
  });
  return workspace;
};

const UNKNOWN_PROBLEM: Problem = {
  code: "evidence.unknown-element",
  severity: "warning",
  message: `The verification record names element ${UNKNOWN}, which the workspace does not have`,
  repository: "ci-results",
  file: "evidence/2026-10-23-unknown-test.md",
  line: 1,
  targetId: UNKNOWN,
};

describe("SR-028 findings of the evidence records", () => {
  it("[SR-028/AK3] a record that names an unknown UUID gives the hint evidence.unknown-element", async () => {
    const workspace = await open({ "ci-results/evidence/2026-10-23-unknown-test.md": recordFile(UNKNOWN) });
    expect(await workspace.get(evidenceProblemsState)).toEqual([UNKNOWN_PROBLEM]);
    // workspace.check shows it: a warning, so `ok` stays true by default and is false with failOn warning.
    const checked = await check(workspace);
    expect(checked.problems.filter((p) => p.code.startsWith("evidence."))).toEqual([
      UNKNOWN_PROBLEM,
      expect.objectContaining({ code: "evidence.outdated" }),
    ]);
    expect(checked.ok).toBe(true);
    expect((await check(workspace, { failOn: "warning" })).ok).toBe(false);
  });

  it("a workspace whose records name known elements has no record findings", async () => {
    const workspace = await open();
    expect(await workspace.get(evidenceProblemsState)).toEqual([]);
  });

  it("names the repositories that are not on this machine in evidence.unknown-element", () => {
    const record: EvidenceRecord = {
      element: UNKNOWN,
      version: "n1:de6d3ed288b0f3de",
      kind: "validation",
      result: "passed",
      date: "2026-10-23T10:00:00Z",
    };
    const store = { byId: new Map<string, readonly unknown[]>() };
    const repository = (name: string, available: boolean): { name: string; available: boolean } => ({
      name,
      available,
    });
    // An injected record without a place gives a problem without one.
    expect(recordElementProblems([record], store, { repositories: [repository("a", false)] })).toEqual([
      {
        code: "evidence.unknown-element",
        severity: "warning",
        message: `The validation record names element ${UNKNOWN}, which the workspace does not have; it may lie in repository a, which is not on this machine`,
        targetId: UNKNOWN,
      },
    ]);
    const two = { repositories: [repository("a", false), repository("b", true), repository("c", false)] };
    expect(recordElementProblems([record], store, two)[0]?.message).toBe(
      `The validation record names element ${UNKNOWN}, which the workspace does not have; it may lie in one of the repositories a, c, which are not on this machine`,
    );
  });

  it("gives evidence.ambiguous-element for a record whose UUID has several copies", async () => {
    const copy =
      "---\nid: 3c3c3c3c-3333-4333-8333-0d0000000001\ntype: system-requirement\nstatus: draft\n---\n";
    const workspace = await open({ "system/copies/SR-0d0000000001.md": copy });
    expect(
      (await workspace.get(evidenceProblemsState)).filter((p) => p.code === "evidence.ambiguous-element"),
    ).toEqual([
      {
        code: "evidence.ambiguous-element",
        severity: "warning",
        message: `The verification record names element ${A}, which 2 files share; it is not assigned to one of them`,
        repository: "ci-results",
        file: "evidence/2026-10-20-SR-000001-test.md",
        line: 1,
        targetId: A,
      },
    ]);
  });

  it("shows the problems of reading the evidence folders, once when the element store has them too", async () => {
    const workspace = await open({
      "system/reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        "  - { name: system, url: u, main: true }\n  - { name: ci-results, url: u }\n" +
        "metamodel: { repository: system, path: metamodel }\nevidence:\n" +
        "  - { repository: ci-results, path: evidence }\n  - { repository: system, path: missing }\n",
      "ci-results/evidence/broken.md": "---\nreqseq-record: [1\n---\n",
      "ci-results/evidence/faulty.md": recordFile(A).replace("result: failed", "result: unknown"),
    });
    const problems = await workspace.get(evidenceProblemsState);
    expect(problems.map((p) => [p.code, p.severity, p.repository, p.file, p.line])).toEqual([
      ["evidence.folder-missing", "info", "system", "missing", undefined],
      ["evidence.invalid-record", "error", "ci-results", "evidence/faulty.md", 8],
    ]);
    // The store reports the YAML error of broken.md; workspace.check lists it once.
    const checked = await check(workspace);
    expect(checked.problems.filter((p) => p.file === "evidence/broken.md").map((p) => p.code)).toEqual([
      "file.invalid-yaml",
    ]);
    expect(checked.ok).toBe(false);
  });

  it("matches records injected through evidenceRecordsState", async () => {
    const workspace = await open();
    const injected: EvidenceRecord = {
      element: UNKNOWN,
      version: "n1:de6d3ed288b0f3de",
      kind: "verification",
      method: "test",
      item: "b",
      result: "passed",
      date: "2026-10-23T10:00:00Z",
    };
    const read = workspace.get(evidenceRecordsState);
    await read;
    await workspace.replace(evidenceRecordsState, read, Promise.resolve([injected]));
    expect((await workspace.get(evidenceProblemsState)).map((p) => [p.code, p.targetId, p.file])).toEqual([
      ["evidence.unknown-element", UNKNOWN, undefined],
    ]);
  });
});
