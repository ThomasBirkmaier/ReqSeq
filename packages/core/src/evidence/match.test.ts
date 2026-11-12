// SR-028 AK3 and AK5: the findings of the evidence records (`match.ts`) for `workspace.check`, on
// fixtures/SR-028/records (requirements in `system`, records in `ci-results/evidence`).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import type { ElementRecord } from "../model/index.js";
import { currentVersionOf, currentVersionsState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import {
  criteriaTargets,
  distinctFindings,
  evidenceProblemsState,
  olderCriterionProblems,
  recordElementProblems,
  recordKindProblems,
  unknownCriterionProblem,
} from "./match.js";
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
  it("[SR-028/AK-h59k] a record that names an unknown UUID gives the hint evidence.unknown-element", async () => {
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

  it("[SR-028/AK-hdkt] a verification record of a need counts for no status and is a finding, a validation of a need is not (#628)", async () => {
    const need = "3c3c3c3c-3333-4333-8333-0d00000000a1";
    const workspace = await open({
      "system/needs/N-0d00000000a1.md": `---\nid: ${need}\ntype: need\nstatus: draft\ntitle: Weigh the load\n---\n`,
      "ci-results/evidence/2026-10-23-need-test.md": recordFile(need),
      "ci-results/evidence/2026-10-23-need-validation.md": recordFile(need).replace(
        "kind: verification",
        "kind: validation",
      ),
    });
    const found = (await workspace.get(evidenceProblemsState)).filter(
      (p) => p.code === "evidence.kind-mismatch",
    );
    expect(found.map((p) => [p.file, p.targetId, p.severity])).toEqual([
      ["evidence/2026-10-23-need-test.md", need, "warning"],
    ]);
    expect(found[0]?.message).toBe(
      `The verification record names element ${need} of type need, so it counts for no status: a verification record names a requirement (D-012)`,
    );
  });

  it("[SR-038/AK-f98s] a validation record of an element that is neither need nor requirement counts for no status and is a finding", async () => {
    const decision = "3c3c3c3c-3333-4333-8333-0d00000000a2";
    const workspace = await open({
      "system/decisions/D-0d00000000a2.md": `---\nid: ${decision}\ntype: decision\nstatus: draft\ntitle: Use kg\n---\n`,
      "ci-results/evidence/2026-10-23-decision-validation.md": recordFile(decision).replace(
        "kind: verification",
        "kind: validation",
      ),
    });
    const checked = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    const found = checked.problems.filter((p) => p.code === "evidence.kind-mismatch");
    expect(found.map((p) => [p.file, p.targetId, p.severity, p.message])).toEqual([
      [
        "evidence/2026-10-23-decision-validation.md",
        decision,
        "warning",
        `The validation record names element ${decision} of type decision, so it counts for no status: a validation record names a need or a requirement (D-012)`,
      ],
    ]);
    const got = (await invoke(
      "element.get",
      { ref: decision },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(got.element.validation).toBeUndefined();
    const listed = (await invoke(
      "evidence.list",
      { ref: decision },
      { workspace },
    )) as CommandOutput<"evidence.list">;
    expect(listed.records).toHaveLength(1);
    expect(listed.display.rows).toEqual([]);
  });

  it("checks no kind while the metamodel is not valid", () => {
    const record = { element: A, kind: "verification" } as EvidenceRecord;
    const store = { byId: new Map([[A, [{ type: "need" }]]]) } as unknown as Parameters<
      typeof recordKindProblems
    >[1];
    expect(
      recordKindProblems([record], store, { valid: false } as Parameters<typeof recordKindProblems>[2]),
    ).toEqual([]);
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

  describe("SR-028 AK5: criteria the named version does not have", () => {
    const B = "3c3c3c3c-3333-4333-8333-0d0000000002";
    /** Requirement A of the fixture with `criteria` as its acceptance criteria. */
    const elementA = (criteria: readonly string[]): string =>
      `---\nid: ${A}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n` +
      `requirement-type: functional\nacceptance-criteria:\n${criteria.map((c) => `  - ${c}\n`).join("")}---\n\n` +
      "The station shows the current wind speed.\n";
    /** A record of A (version `version`) naming `criteria`. */
    const withCriteria = (criteria: string, version: string, element = A): string =>
      recordFile(element)
        .replace("version: n1:de6d3ed288b0f3de", `version: ${version}`)

        .replace("result: failed\n", `result: failed\ncriteria: ${criteria}\n`);
    /** The current version of `id`. */
    const versionOf = async (workspace: Workspace, id: string): Promise<string> => {
      const versions = await workspace.get(currentVersionsState);
      const element = versions.store.byId.get(id)?.[0];
      return element === undefined ? "" : String(currentVersionOf(versions, element));
    };

    it("[SR-028/AK-w61w] a Markdown record naming a number the current version does not have gives evidence.unknown-criterion at the line of criteria", async () => {
      const workspace = await open({
        "ci-results/evidence/2026-10-23-a-test.md": withCriteria("[1, 9, 4]", "n1:de6d3ed288b0f3de"),
        "ci-results/evidence/2026-10-23-b-test.md": withCriteria("[1]", "n1:de6d3ed288b0f3de"),
      });
      // n1:de6d3ed288b0f3de is A's current version in normal form 1 (ADR-0005), so b-test has no finding.
      const problem: Problem = {
        code: "evidence.unknown-criterion",
        severity: "warning",
        message: `The verification record names acceptance criteria 4, 9 of element ${A}, whose version n1:de6d3ed288b0f3de has 1; they count for no criterion`,
        repository: "ci-results",
        file: "evidence/2026-10-23-a-test.md",
        line: 9,
        targetId: A,
        targetRepository: "system",
        criteria: [{ criterion: 4 }, { criterion: 9 }],
      };
      expect(
        (await workspace.get(evidenceProblemsState)).filter((p) => p.code === "evidence.unknown-criterion"),
      ).toEqual([problem]);
      const checked = await check(workspace);
      expect(checked.problems.filter((p) => p.code === "evidence.unknown-criterion")).toEqual([
        { ...problem, targetShortId: "SR-000001" },
      ]);
    });

    it("[SR-028/AK-w61w] a JUnit test case naming a number the current version does not have gives evidence.unknown-criterion at the line of the property", async () => {
      const junit =
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="s">\n<testcase classname="c" name="t">\n<properties>\n' +
        `<property name="reqseq:element" value="${A}"/>\n<property name="reqseq:version" value="n1:de6d3ed288b0f3de"/>\n` +
        '<property name="reqseq:item" value="b"/>\n<property name="reqseq:date" value="2026-10-23T10:00:00Z"/>\n' +
        `<property name="reqseq:criterion" value="${A}:1"/>\n<property name="reqseq:criterion" value="${A}:2"/>\n` +
        "</properties>\n</testcase>\n</testsuite>\n";
      const workspace = await open({ "ci-results/evidence/run.xml": junit });
      expect(
        (await workspace.get(evidenceProblemsState))
          .filter((p) => p.code === "evidence.unknown-criterion")
          .map((p) => [p.file, p.line, p.message]),
      ).toEqual([
        [
          "evidence/run.xml",
          10,
          `The verification record names acceptance criterion 2 of element ${A}, whose version n1:de6d3ed288b0f3de has 1; it counts for no criterion`,
        ],
      ]);
    });

    it("gives the findings of a JUnit test case for several views once (SR-093 AK5)", async () => {
      const junit =
        '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="s">\n<testcase classname="c" name="t">\n<properties>\n' +
        `<property name="reqseq:element" value="${A}"/>\n<property name="reqseq:element" value="${UNKNOWN}"/>\n` +
        '<property name="reqseq:version" value="n1:de6d3ed288b0f3de"/>\n<property name="reqseq:version" value="n1:de6d3ed288b0f3de"/>\n' +
        '<property name="reqseq:item" value="b"/>\n<property name="reqseq:date" value="2026-10-23T10:00:00Z"/>\n' +
        `<property name="reqseq:criterion" value="${A}:2"/>\n` +
        '<property name="reqseq:variant" value="core"/>\n<property name="reqseq:variant" value="3c3c3c3c-3333-4333-8333-0d00000000c1"/>\n' +
        "</properties>\n</testcase>\n</testsuite>\n";
      const workspace = await open({ "ci-results/evidence/run.xml": junit });
      const records = await workspace.get(evidenceRecordsState);
      expect(records.filter((r) => r.file === "evidence/run.xml")).toHaveLength(4);
      expect(
        (await workspace.get(evidenceProblemsState))
          .filter((p) => p.file === "evidence/run.xml")
          .map((p) => [p.code, p.file, p.line, p.targetId]),
      ).toEqual([
        ["evidence.unknown-element", "evidence/run.xml", 3, UNKNOWN],
        ["evidence.unknown-criterion", "evidence/run.xml", 11, A],
      ]);
    });

    it("gives the findings of two test cases on one line each (pytest writes a whole file on line 1)", async () => {
      const testCase = (name: string, criterion: number): string =>
        `<testcase classname="c" name="${name}"><properties>` +
        `<property name="reqseq:element" value="${A}"/><property name="reqseq:version" value="n1:de6d3ed288b0f3de"/>` +
        '<property name="reqseq:item" value="b"/><property name="reqseq:date" value="2026-10-23T10:00:00Z"/>' +
        `<property name="reqseq:criterion" value="${A}:${String(criterion)}"/></properties></testcase>`;
      const junit = `<testsuite name="s">${testCase("test_a", 7)}${testCase("test_b", 8)}</testsuite>`;
      const workspace = await open({ "ci-results/evidence/run.xml": junit });
      expect(
        (await workspace.get(evidenceProblemsState))
          .filter((p) => p.file === "evidence/run.xml")
          .map((p) => [p.code, p.line, p.message.slice(0, 50)]),
      ).toEqual([
        ["evidence.unknown-criterion", 1, "The verification record names acceptance criterion"],
        ["evidence.unknown-criterion", 1, "The verification record names acceptance criterion"],
      ]);
    });

    it("distinctFindings keeps the first of each code, place, target and message, in order", () => {
      const at = (line: number, targetId?: string): Problem => ({
        code: "evidence.unknown-element",
        severity: "warning",
        message: `line ${String(line)}`,
        file: "run.xml",
        line,
        ...(targetId === undefined ? {} : { targetId }),
      });
      const other = { ...at(3, A), message: "another test case on line 3" };
      expect(distinctFindings([at(3, A), at(3, A), at(4, A), at(3, UNKNOWN), at(3), at(3), other])).toEqual([
        at(3, A),
        at(4, A),
        at(3, UNKNOWN),
        at(3),
        other,
      ]);
    });

    it("[SR-028/AK-w61w] checks a record of an older version against the criteria of that version in the Git history", async () => {
      const ws = await createFixtureWorkspace({
        fixture: "SR-028/records",
        files: { "system/requirements/SR-0d0000000001.md": elementA(["One.", "Two.", "Three."]) },
      });
      onTestFinished(() => ws.cleanup());
      await ws.git(["init", "--quiet", "--initial-branch=main"], "system");
      await ws.commit("system");
      const first = new Workspace(ws.path("system"));
      const old = await versionOf(first, A);
      await first.close();
      await ws.write("system/requirements/SR-0d0000000001.md", elementA(["One."]));
      await ws.commit("system");
      await ws.write("ci-results/evidence/2026-10-23-old-test.md", withCriteria("[3, 4]", old));
      // A version Git never had is not checked.
      await ws.write(
        "ci-results/evidence/2026-10-23-unknown-test.md",
        withCriteria("[7]", "n1:00000000000000aa"),
      );
      const workspace = new Workspace(ws.path("system"));
      onTestFinished(() => workspace.close());
      expect(await versionOf(workspace, A)).not.toBe(old);
      // Not in the state, which does not ask Git.
      expect(
        (await workspace.get(evidenceProblemsState)).filter((p) => p.code === "evidence.unknown-criterion"),
      ).toEqual([]);
      const found = (await check(workspace)).problems.filter((p) => p.code === "evidence.unknown-criterion");
      expect(found.map((p) => [p.file, p.line, p.message])).toEqual([
        [
          "evidence/2026-10-23-old-test.md",
          9,
          `The verification record names acceptance criterion 4 of element ${A}, whose version ${old} has 3; it counts for no criterion`,
        ],
      ]);
      // Without criteria of an older version, nothing is asked of Git.
      expect(await olderCriterionProblems(await open())).toEqual([]);
    });

    it("[SR-028/AK-w61w] a record naming a key that no criterion of the current version carries gives evidence.unknown-criterion", async () => {
      const workspace = await open({
        // The fixture's criterion with a key: the same version (a key never counts to it, D-027).
        "system/requirements/SR-0d0000000001.md": elementA([
          "key: kone\n    text: Given a wind speed, when it is shown, then it is in km/h.",
        ]),
        "ci-results/evidence/2026-10-23-a-test.md": withCriteria("[kone, ktwo, 1]", "n1:de6d3ed288b0f3de"),
      });
      expect(
        (await workspace.get(evidenceProblemsState))
          .filter((p) => p.code === "evidence.unknown-criterion")
          .map((p) => [p.line, p.message]),
      ).toEqual([
        [
          9,
          `The verification record names acceptance criterion ktwo of element ${A}, whose version n1:de6d3ed288b0f3de has 1 and no criterion with that key; it counts for no criterion`,
        ],
      ]);
    });

    it("[SR-028/AK-w61w] checks the keys of an older version against its newest commit, where a key was added in the same version", async () => {
      const ws = await createFixtureWorkspace({
        fixture: "SR-028/records",
        files: { "system/requirements/SR-0d0000000001.md": elementA(["One.", "Two."]) },
      });
      onTestFinished(() => ws.cleanup());
      await ws.git(["init", "--quiet", "--initial-branch=main"], "system");
      await ws.commit("system");
      const first = new Workspace(ws.path("system"));
      const old = await versionOf(first, A);
      await first.close();
      // The same version with keys (a key never counts to the version, D-027), then a new version.
      await ws.write(
        "system/requirements/SR-0d0000000001.md",
        elementA(["key: kone\n    text: One.", "key: ktwo\n    text: Two."]),
      );
      await ws.commit("system");
      await ws.write("system/requirements/SR-0d0000000001.md", elementA(["key: kone\n    text: One."]));
      await ws.commit("system");
      await ws.write("ci-results/evidence/2026-10-23-old-test.md", withCriteria("[ktwo, kxyz, 3]", old));
      await ws.write("ci-results/evidence/2026-10-24-old-test.md", withCriteria("[1]", old));
      const workspace = new Workspace(ws.path("system"));
      onTestFinished(() => workspace.close());
      const found = (await check(workspace)).problems.filter((p) => p.code === "evidence.unknown-criterion");
      expect(found.map((p) => p.message)).toEqual([
        `The verification record names acceptance criteria 3, kxyz of element ${A}, whose version ${old} has 2 and no criterion with that key; they count for no criterion`,
      ]);
      // Number 1 of the older version is `kone` in its newest commit, so it counts for the current
      // criterion `kone` (SR-031 AK11); `ktwo` is gone from the current version and counts for none.
      const list = (await invoke(
        "evidence.list",
        { ref: A },
        { workspace },
      )) as CommandOutput<"evidence.list">;
      expect(list.display.rows.map((row) => [row.criterion, row.key, row.status, row.cases.length])).toEqual([
        [1, "kone", "outdated", 1],
      ]);
    });

    it("counts no criteria for a type without the property of the meaning, nor while the metamodel is not valid", async () => {
      const metamodel = "system/metamodel/standard-model.yaml";
      const ws = await createFixtureWorkspace({ fixture: "SR-028/records" });
      const model = await fs.readFile(ws.path(metamodel), "utf8");
      await ws.cleanup();
      const workspace = await open({
        [metamodel]: model.replace("    meaning: acceptance-criteria\n", ""),
        "ci-results/evidence/2026-10-23-a-test.md": withCriteria("[1]", "n1:de6d3ed288b0f3de"),
      });
      expect(
        (await workspace.get(evidenceProblemsState))
          .filter((p) => p.code === "evidence.unknown-criterion")
          .map((p) => p.message),
      ).toEqual([
        `The verification record names acceptance criterion 1 of element ${A}, whose version n1:de6d3ed288b0f3de has 0; the record counts for the whole requirement`,
      ]);
      const invalid = await open({
        [metamodel]: `${model}\nunknown-key: 1\n`,
        "ci-results/evidence/2026-10-23-a-test.md": withCriteria("[2]", "n1:de6d3ed288b0f3de"),
      });
      expect(
        (await invalid.get(evidenceProblemsState)).filter((p) => p.code === "evidence.unknown-criterion"),
      ).toEqual([]);
      expect(await olderCriterionProblems(invalid)).toEqual([]);
    });

    it("leaves out records of unknown, shared or unversioned elements, and gives a problem without a place for an injected record", () => {
      const record = (element: string, criteria: number[]): EvidenceRecord => ({
        element,
        version: "n1:1111111111111111",
        kind: "verification",
        method: "test",
        item: "b",
        result: "passed",
        date: "2026-10-23T10:00:00Z",
        criteria,
      });
      const element = (id: string): ElementRecord =>
        ({
          id,
          repository: "system",
          file: `${id}.md`,
          type: "system-requirement",
          data: {},
        }) as unknown as ElementRecord;
      const store = {
        byId: new Map<string, readonly ElementRecord[]>([
          [A, [element(A)]],
          [B, [element(B), element(B)]],
          [UNKNOWN.replace("ff", "fe"), [element("x")]],
        ]),
      };
      const forms = { n1: "n1:1111111111111111", n2: "n2:1111111111111111" };
      const records = [
        record(UNKNOWN, [1]),
        record(B, [1]),
        record(UNKNOWN.replace("ff", "fe"), [1]),
        { ...record(A, [1]), version: forms.n2 },
        { ...record(A, [2]), version: "n1:2222222222222222" },
        { ...record(A, [1]), criteria: undefined },
      ] as EvidenceRecord[];
      const targets = criteriaTargets(records, store, (e) => (e.id === "x" ? undefined : forms));
      expect(targets.current.map((t) => t.record.version)).toEqual([forms.n2]);
      expect(targets.older.map((t) => t.criteria)).toEqual([[2]]);
      const [current] = targets.current;
      expect(current === undefined ? undefined : unknownCriterionProblem(current, [])).toEqual({
        code: "evidence.unknown-criterion",
        severity: "warning",
        message: `The verification record names acceptance criterion 1 of element ${A}, whose version ${forms.n2} has 0; the record counts for the whole requirement`,
        targetId: A,
        targetRepository: "system",
        criteria: [{ criterion: 1 }],
      });
      expect(current === undefined ? undefined : unknownCriterionProblem(current, ["one"])).toBeUndefined();
    });
  });
});
