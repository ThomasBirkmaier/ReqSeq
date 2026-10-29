import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState } from "../../model/index.js";
import { loadContracts } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"workspace.check">;

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const check = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("workspace.check", input, { workspace })) as Output;

/** Kind, file and element of each problem, as SR-019 AK2 asks. */
const kinds = (out: Output): (readonly [string, string | undefined, string | undefined])[] =>
  out.problems.map((p) => [p.code, p.file, p.elementId] as const);

const NEED = "1a1a1a1a-1111-4111-8111-a0000000000";
const SR = "2b2b2b2b-2222-4222-8222-b0000000000";

/** One finding of every kind of stage 1 in fixtures/SR-019/findings, in the order the check gives them. */
const FINDINGS = [
  ["file.invalid-yaml", "requirements/SR-b00000000006.md", undefined], // SR-008 AK1
  ["file.conflict-markers", "requirements/SR-b00000000007.md", undefined], // SR-008 AK2
  ["element.missing-required", "requirements/SR-b00000000002.md", `${SR}2`], // SR-015
  ["element.unknown-property", "requirements/SR-b00000000003.md", `${SR}3`], // SR-016
  ["relation.target-superseded", "requirements/SR-b00000000008.md", `${SR}8`], // SR-072
  ["variant.superseded-in-validity", "requirements/SR-b00000000009.md", `${SR}9`], // SR-040 AK3
  ["element.wrong-value-kind", "requirements/SR-b00000000004.md", `${SR}4`], // SR-085
  ["relation.not-allowed", "needs/N-a00000000002.md", `${NEED}2`], // SR-086
  ["element.duplicate-id", "copies/N-a00000000003.md", `${NEED}3`], // SR-088
  ["element.duplicate-id", "needs/N-a00000000003.md", `${NEED}3`], // SR-088
  ["relation.missing-target", "requirements/SR-b00000000005.md", `${SR}5`], // SR-089
] as const;

describe("workspace.check", () => {
  it("[SR-019/AK1] is ok and lists no problem for a workspace without findings", async () => {
    const ws = await fixture({ fixture: "SR-072/supersede" });
    const out = await check(open(ws.root));
    expect(out).toEqual({ ok: true, problems: [], checkedElements: 5 });
  });

  it("[SR-019/AK1] stays ok with info only, such as a repository that is not on this machine", async () => {
    const ws = await fixture({ fixture: "SR-089/missing-targets" });
    const out = await check(open(ws.path("system")));
    expect(out.ok).toBe(true);
    // Its metamodel has no relation kind with the meaning derivation: the cycle check says so as info
    // (SR-013 AK3, SR-090; spec question #270 option 1).
    expect(out.problems.map((p) => [p.code, p.severity])).toEqual([
      ["workspace.repository-missing", "info"],
      ["metamodel.meaning-unassigned", "info"],
    ]);
    expect(out.checkedElements).toBe(4);
  });

  it("[SR-019/AK2] reports every finding of SR-008, SR-015, SR-016, SR-040, SR-072, SR-085, SR-086, SR-088 and SR-089 with kind, file and element, and is not ok", async () => {
    const ws = await fixture({ fixture: "SR-019/findings" });
    const out = await check(open(ws.root));
    expect(out.ok).toBe(false);
    expect(kinds(out)).toEqual(FINDINGS);
    expect(out.problems.every((p) => p.repository === "system" && p.message !== "")).toBe(true);
    // Thirteen elements: the two faulty files are no elements, the copied need counts twice.
    expect(out.checkedElements).toBe(13);
  });

  it("[SR-019/AK2] reports every element of a cycle in the derivations (SR-090) with kind, file and element, and is not ok with failOn warning", async () => {
    const ws = await fixture({ fixture: "SR-090/cycle" });
    // Cycles are warnings: since #304 they fail the check only with failOn warning.
    const out = await check(open(ws.root), { failOn: "warning" });
    const CYCLE = "5e9c0a7d-2b4f-4c61-9d08-0b000000000";
    expect(out.ok).toBe(false);
    expect(kinds(out)).toEqual([
      ["trace.cycle", "requirements/SR-0b0000000001.md", `${CYCLE}1`],
      ["trace.cycle", "requirements/SR-0b0000000002.md", `${CYCLE}2`],
      ["trace.cycle", "requirements/SR-0b0000000003.md", `${CYCLE}3`],
    ]);
    expect(out.checkedElements).toBe(5);
  });

  it("[SR-019/AK2] is not ok for warnings alone with failOn warning, since they are findings too", async () => {
    // Before #304 this was the default; the product owner decision of 2026-10-26 (option 1) made warnings pass
    // by default, so the exit code 1 of SR-019 AK2 for warnings needs failOn warning (--fail-on warning).
    const ws = await fixture({ fixture: "SR-085/value-kinds" });
    const out = await check(open(ws.path("system")), { failOn: "warning" });
    expect(out.ok).toBe(false);
    expect(new Set(out.problems.map((p) => p.severity))).toEqual(new Set(["warning"]));
  });

  it("is ok by default with warnings alone: only an error fails the check (#304)", async () => {
    const ws = await fixture({ fixture: "SR-085/value-kinds" });
    const workspace = open(ws.path("system"));
    const out = await check(workspace);
    expect(out.ok).toBe(true);
    expect(out.problems.length).toBeGreaterThan(0);
    expect(new Set(out.problems.map((p) => p.severity))).toEqual(new Set(["warning"]));
    expect(await check(workspace, { failOn: "error" })).toEqual(out);
    // An error fails it whatever failOn says (error is the highest severity).
    const findings = await fixture({ fixture: "SR-019/findings" });
    expect((await check(open(findings.root), { failOn: "error" })).ok).toBe(false);
  });

  it("is not ok for info with failOn info, such as a repository that is not on this machine (#304)", async () => {
    const ws = await fixture({ fixture: "SR-089/missing-targets" });
    const workspace = open(ws.path("system"));
    expect((await check(workspace, { failOn: "warning" })).ok).toBe(true);
    const out = await check(workspace, { failOn: "info" });
    expect(out.ok).toBe(false);
    expect(out.problems.map((p) => p.severity)).toEqual(["info", "info"]);
  });

  it("counts the findings that severity leaves out in hidden, and keeps failOn apart from severity (#304)", async () => {
    const ws = await fixture({ fixture: "SR-019/findings" });
    const workspace = open(ws.root);
    const errors = await check(workspace, { severity: "error" });
    // Five errors shown; the six warnings of FINDINGS left out and counted.
    expect(errors.problems.every((p) => p.severity === "error")).toBe(true);
    expect(errors.hidden).toEqual({ below: "error", warning: 6, info: 0 });
    // Nothing left out: no hidden.
    expect((await check(workspace)).hidden).toBeUndefined();
    expect((await check(workspace, { severity: "warning" })).hidden).toBeUndefined();
    const missing = await fixture({ fixture: "SR-089/missing-targets" });
    const info = open(missing.path("system"));
    // Only info, all left out: ok unless failOn info, whatever severity shows.
    expect(await check(info, { severity: "warning" })).toEqual({
      ok: true,
      problems: [],
      hidden: { below: "warning", warning: 0, info: 2 },
      checkedElements: 4,
    });
    expect(await check(info, { severity: "error", failOn: "info" })).toEqual({
      ok: false,
      problems: [],
      hidden: { below: "error", warning: 0, info: 2 },
      checkedElements: 4,
    });
    // A clean workspace hides nothing.
    const clean = await fixture({ fixture: "SR-072/supersede" });
    expect(await check(open(clean.root), { severity: "error" })).toEqual({
      ok: true,
      problems: [],
      checkedElements: 5,
    });
  });

  it("[SR-019/AK2] shows only problems at or above the given severity, and ok stays about all findings", async () => {
    const ws = await fixture({ fixture: "SR-019/findings" });
    const workspace = open(ws.root);
    const errors = await check(workspace, { severity: "error" });
    expect(errors.ok).toBe(false);
    expect(errors.problems.map((p) => p.code)).toEqual([
      "file.invalid-yaml",
      "file.conflict-markers",
      "element.duplicate-id",
      "element.duplicate-id",
      "relation.missing-target",
    ]);
    expect(kinds(await check(workspace, { severity: "warning" }))).toEqual(FINDINGS);
    const values = await fixture({ fixture: "SR-085/value-kinds" });
    // Only warnings, none shown: with failOn warning still not ok, since the workspace has findings
    // (exit code 1); they are counted as hidden.
    expect(await check(open(values.path("system")), { severity: "error", failOn: "warning" })).toEqual({
      ok: false,
      problems: [],
      hidden: { below: "error", warning: 5, info: 0 },
      checkedElements: 4,
    });
    const missing = await fixture({ fixture: "SR-089/missing-targets" });
    expect((await check(open(missing.path("system")), { severity: "warning" })).problems).toEqual([]);
  });

  it("[SR-019/AK4] reports a hint about a relation no more once it is confirmed, and is ok when nothing else is left", async () => {
    // fixtures/SR-025/outdated: requirement A derives from need N; B refines A. N gets a new text.
    const ws = await fixture({ fixture: "SR-025/outdated" });
    const need = "needs/N-0a0000000001.md";
    await ws.write(need, `${fs.readFileSync(ws.path(need), "utf8")}Changed.\n`);
    const workspace = open(ws.root);
    // failOn warning: the outdated relations are warnings, so `ok` tells whether one is left (#304).
    const failOn = { failOn: "warning" };
    const before = await check(workspace, failOn);
    expect(before.ok).toBe(false);
    const [derives, link] = before.problems;
    expect([derives?.code, derives?.line, link?.code, link?.line]).toEqual([
      "relation.outdated",
      12,
      "relation.outdated",
      15,
    ]);
    await invoke("hint.confirm", { hintIds: [derives?.hintId] }, { workspace });
    const after = await check(workspace, failOn);
    expect([after.ok, after.problems]).toEqual([false, [link]]);
    // The reference changes A's text, so B's refinement of A is outdated now (ADR-0004); confirm both.
    await invoke("hint.confirm", { hintIds: [link?.hintId] }, { workspace });
    const refines = (await check(workspace, failOn)).problems.map((p) => p.hintId);
    expect(refines).toHaveLength(1);
    await invoke("hint.confirm", { hintIds: refines }, { workspace });
    expect(await check(workspace, failOn)).toEqual({ ok: true, problems: [], checkedElements: 4 });
  });

  it("[SR-019/AK2] checks again after the element store is read again", async () => {
    const ws = await fixture({ fixture: "SR-019/findings" });
    const workspace = open(ws.root);
    expect(kinds(await check(workspace))).toEqual(FINDINGS);
    await ws.write(
      "requirements/SR-b00000000004.md",
      `---\nid: ${SR}4\ntype: system-requirement\nstatus: draft\ntitle: Weigh the mast\nverification-method: inspection\nweight: 12\n---\n`,
    );
    await workspace.reset(elementStoreState);
    expect(kinds(await check(workspace))).toEqual(
      FINDINGS.filter(([code]) => code !== "element.wrong-value-kind"),
    );
  });

  it("[SR-019/AK2] restricted to changed files (SR-092), reports the findings of those elements and their targets only", async () => {
    const ws = await fixture({ fixture: "SR-019/findings" });
    const workspace = open(ws.root);
    const out = await check(workspace, {
      changedFiles: ["requirements/SR-b00000000002.md", "requirements/SR-b00000000006.md"],
    });
    expect(kinds(out)).toEqual(
      FINDINGS.filter(
        ([, file]) =>
          file === "requirements/SR-b00000000002.md" || file === "requirements/SR-b00000000006.md",
      ),
    );
    expect(out.ok).toBe(false);
    expect(await check(workspace, { changedFiles: [] })).toEqual({
      ok: true,
      problems: [],
      checkedElements: 0,
    });
  });

  it("[SR-019/AK3] gives all findings as an output that matches the catalog schema", async () => {
    const ws = await fixture({ fixture: "SR-019/findings" });
    const out = await check(open(ws.root));
    const validate = loadContracts().validator("workspace.check", "output");
    expect([validate(out), validate.errors ?? []]).toEqual([true, []]);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    expect(out.problems).toHaveLength(FINDINGS.length);
  });

  // #208, assumption of spec question #220 option 1: against a metamodel that is not valid only the
  // findings that need no metamodel are reported, so one typo does not bury its cause.
  const WITHOUT_METAMODEL = FINDINGS.filter(([code]) =>
    ["file.invalid-yaml", "file.conflict-markers", "element.duplicate-id"].includes(code),
  );

  it("[SR-019/AK2] [SR-011/AK3] reports only the metamodel error and the findings without metamodel while the metamodel is faulty", async () => {
    const ws = await fixture({
      fixture: "SR-019/findings",
      files: { "metamodel/broken.yaml": "properties: [\n" },
    });
    const out = await check(open(ws.root));
    expect(out.ok).toBe(false);
    expect(out.problems[0]).toMatchObject({
      severity: "error",
      repository: "system",
      file: "metamodel/broken.yaml",
    });
    expect(kinds({ ...out, problems: out.problems.slice(1) })).toEqual(WITHOUT_METAMODEL);
    expect(out.checkedElements).toBe(13);
  });

  it("[SR-019/AK2] [SR-011/AK3] reports only the missing metamodel folder and the findings without metamodel", async () => {
    const ws = await fixture({
      fixture: "SR-019/findings",
      files: {
        "reqseq-workspace.yaml":
          'reqseq-workspace: 1\nname: Weather station\nrepositories:\n  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\nmetamodel: { repository: system, path: no-metamodel }\n',
      },
    });
    const out = await check(open(ws.root));
    expect(out.ok).toBe(false);
    expect(out.problems[0]).toMatchObject({ code: "metamodel.invalid", severity: "error" });
    expect(kinds({ ...out, problems: out.problems.slice(1) })).toEqual(WITHOUT_METAMODEL);
  });

  it("[SR-019/AK2] [SR-011/AK3] reports every finding again once the faulty metamodel file is fixed", async () => {
    const ws = await fixture({
      fixture: "SR-019/findings",
      files: { "metamodel/broken.yaml": "properties: [\n" },
    });
    const workspace = open(ws.root);
    expect(kinds(await check(workspace)).slice(1)).toEqual(WITHOUT_METAMODEL);
    await ws.write("metamodel/broken.yaml", "reqseq-metamodel: 1\n");
    await workspace.reset(metamodelState);
    expect(kinds(await check(workspace))).toEqual(FINDINGS);
  });
});
