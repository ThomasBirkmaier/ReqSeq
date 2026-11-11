// A JUnit test case that names several views (SR-093 AK5) on fixtures/SR-093/views: one test case
// names the variants Linux (c1) and macOS (c2) and the core, for SR-0000a1 of `system` and SR-0000b1
// of `supplier`, which the workspace file marks `variant-independent` (SR-173). Windows (c3) is not
// named. The same on every access in packages/cli/test/cross-access.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const P = "09300093-0000-4000-8000-0000000000";
const LINUX = `${P}c1`;
const MACOS = `${P}c2`;

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-093/views", files });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return workspace;
};

/** The verification rows of each requirement by the last two digits of its UUID, view by view (`evidence.status`). */
const statusRows = async (workspace: Workspace): Promise<Record<string, Record<string, string>>> => {
  const out = (await invoke("evidence.status", {}, { workspace })) as CommandOutput<"evidence.status">;
  return Object.fromEntries(
    out.elements.flatMap((e) =>
      e.verification === undefined
        ? []
        : [[e.id.slice(-2), Object.fromEntries(e.verification.map((v) => [v.view.slice(-2), v.status]))]],
    ),
  );
};

const list = async (
  workspace: Workspace,
  ref: string,
  view?: string,
): Promise<CommandOutput<"evidence.list">> =>
  (await invoke(
    "evidence.list",
    { ref, ...(view === undefined ? {} : { view }) },
    { workspace },
  )) as CommandOutput<"evidence.list">;

describe("a JUnit test case for several views (SR-093 AK5)", () => {
  it("[SR-093/AK5] a test case for the variants A and B and the core verifies the requirement in each of them, and in no other variant", async () => {
    const workspace = await open();
    // `re` is the core (`core`.slice(-2)); c3 (Windows) is not named.
    expect((await statusRows(workspace))["a1"]).toEqual({
      re: "verified",
      c1: "verified",
      c2: "verified",
      c3: "open",
    });
    // One record per view, each for its view only.
    const all = await list(workspace, "SR-0000a1");
    expect(all.records.map((r) => r.variant)).toEqual([undefined, LINUX, MACOS]);
    expect((await list(workspace, "SR-0000a1", "VAR-0000c3")).records).toEqual([]);
    // Read without a finding.
    const checked = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(checked.problems.filter((p) => p.code.startsWith("evidence."))).toEqual([]);
  });

  it("[SR-093/AK5] the record of the core of a variant-independent repository counts in every variant, also one the test case does not name", async () => {
    const workspace = await open();
    expect((await statusRows(workspace))["b1"]).toEqual({
      re: "verified",
      c1: "verified",
      c2: "verified",
      c3: "verified",
    });
    // In Linux both the record of the core and that of Linux hold; the view lists the execution once.
    const linux = await list(workspace, "SR-0000b1", "VAR-0000c1");
    expect(linux.records.map((r) => r.variant)).toEqual([LINUX]);
    expect(linux.testCases.map((t) => t.executions.map((r) => r.variant))).toEqual([[LINUX]]);
    // In Windows the record of the core.
    const windows = await list(workspace, "SR-0000b1", "VAR-0000c3");
    expect(windows.records.map((r) => r.variant)).toEqual([undefined]);
    expect(windows.testCases.map((t) => t.executions.length)).toEqual([1]);
  });

  it("keeps the record of another test case on the same line in the variant's list (pytest writes a whole file on line 1)", async () => {
    const property = (name: string, value: string): string => `<property name="${name}" value="${value}"/>`;
    const testCase = (name: string, views: readonly string[], body = ""): string =>
      `<testcase classname="tests" name="${name}"><properties>` +
      property("reqseq:element", `${P}b1`) +
      property("reqseq:version", "n2:1220d601226af314") +
      property("reqseq:item", "build-94") +
      property("reqseq:date", "2026-11-09T11:00:00Z") +
      views.map((v) => property("reqseq:variant", v)).join("") +
      `</properties>${body}</testcase>`;
    const workspace = await open({
      "evidence/ci/linux.xml": `<testsuites><testsuite name="pytest">${testCase("test_a", [LINUX, "core"])}${testCase("test_b", [], "<failure/>")}</testsuite></testsuites>`,
    });
    const linux = await list(workspace, "SR-0000b1", "VAR-0000c1");
    // test_a once (its core record is shadowed), test_b's failed run of the core too.
    expect(linux.records.map((r) => [r.testCase, r.variant, r.result])).toEqual([
      ["test_b", undefined, "failed"],
      ["test_a", LINUX, "passed"],
    ]);
    expect(linux.testCases.map((t) => [t.name, t.executions.length])).toEqual([
      ["test_a", 1],
      ["test_b", 1],
    ]);
    expect((await statusRows(workspace))["b1"]?.["c1"]).toBe("failed");
  });

  it("[SR-047/AK5] reports each record that counts in no view, unless another record of its test case counts for the requirement", async () => {
    // SR-0000a2 applies in Linux only; of each test case the record of the core counts nowhere.
    const property = (name: string, value: string): string => `<property name="${name}" value="${value}"/>`;
    const testCase = (name: string, views: readonly string[]): string =>
      `<testcase classname="views.test.ts" name="${name}"><properties>` +
      property("reqseq:element", `${P}a2`) +
      property("reqseq:version", "n1:0000000000000000") +
      property("reqseq:item", "build-93") +
      property("reqseq:date", "2026-11-09T10:00:00Z") +
      views.map((view) => property("reqseq:variant", view)).join("") +
      "</properties></testcase>";
    const workspace = await open({
      "requirements/SR-0000000000a2.md":
        `---\nid: ${P}a2\ntype: system-requirement\nstatus: draft\ntitle: Read the Linux log\n` +
        `validity: [{ id: ${LINUX}, version: n1:67ebd0624004c969, title: Linux }]\n---\n\nThe tool reads the Linux log.\n`,
      "evidence/ci/views.xml":
        '<testsuites><testsuite name="views.test.ts" timestamp="2026-11-09T10:00:00.000Z">' +
        testCase("linux and core", ["core", LINUX]) +
        testCase("macos and core", ["core", MACOS]) +
        "</testsuite></testsuites>",
    });
    const checked = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    // "linux and core" counts in Linux, so its record of the core is no finding.
    expect(
      checked.problems
        .filter((p) => p.code === "evidence.counts-in-no-view")
        .map((p) => [p.severity, p.file, p.targetId, p.message]),
    ).toEqual(
      (
        [
          ["the core", "core"],
          ["the variant VAR-0000c2", "VAR-0000c2"],
        ] as const
      ).map(([view, short]) => [
        "warning",
        "evidence/ci/views.xml",
        `${P}a2`,
        `The verification record of SR-0000a2 for ${view} counts in no view: SR-0000a2 does not apply in ${short}, so a record for it there would count nowhere (SR-040)`,
      ]),
    );
  });
});
