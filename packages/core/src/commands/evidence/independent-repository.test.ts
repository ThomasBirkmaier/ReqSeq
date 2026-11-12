// Variant-independent repositories (SR-173) on fixtures/SR-173/independent: the main repository
// `system` holds variants A (c1), B (c2) and C (c3, excludes S2) and the requirements K (a1), K4 (a4)
// and R5 (b5, valid in B, replaces S5); the repository `supplier` is marked `variant-independent`
// and holds S1 (d1, derives from K), S2 (d2), S3 (d3, valid in A), S5 (d5), and S6 to S8 (d6 to d8)
// with records with and without variant. S1's record lies in the evidence folder of `system`, K4's
// in that of `supplier`: the element's repository decides, not the record's folder (#817 Q1).
// The same on every access in packages/cli/test/cross-access.test.ts; the CLI in
// packages/cli/test/e2e/evidence-per-variant.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { COPIED, COPIED_FILES, openCopiedFile } from "../copied.test-helper.js";
import type { FullList } from "../list.test-helper.js";

const WORKSPACE_FILE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  '  - { name: supplier, url: "git@git.example.com:ws/supplier.git", path: supplier, variant-independent: MARK }\n' +
  "metamodel: { repository: system, path: metamodel }\n" +
  "evidence:\n  - { repository: system, path: evidence }\n  - { repository: supplier, path: evidence }\n";

/** The fixture, with `supplier` marked as given (the fixture marks it) and `files` added. */
const open = async (marked = true, files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-173/independent",
    files: { "reqseq-workspace.yaml": WORKSPACE_FILE.replace("MARK", String(marked)), ...files },
  });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return workspace;
};

type Rows = Record<string, string>;

/** The verification rows of every requirement by the last two digits of its UUID, view by view (`evidence.status`). */
const statusRows = async (workspace: Workspace): Promise<Record<string, Rows>> => {
  const out = (await invoke("evidence.status", {}, { workspace })) as CommandOutput<"evidence.status">;
  return Object.fromEntries(
    out.elements.flatMap((e) =>
      e.verification === undefined
        ? []
        : [[e.id.slice(-2), Object.fromEntries(e.verification.map((v) => [v.view.slice(-2), v.status]))]],
    ),
  );
};

const all = (status: string): Rows => ({ re: status, c1: status, c2: status, c3: status });

describe("variant-independent repositories (SR-173)", () => {
  it("[SR-047/AK-k95w] [SR-173/AK-g2t9] a record without variant of an element of a marked repository counts for the core and every variant the element applies in", async () => {
    const workspace = await open();
    const rows = await statusRows(workspace);
    // `re` is the core (`core`.slice(-2)).
    expect(rows["d1"]).toEqual(all("verified"));
    // Excluded by C: no row there (SR-047 AK3).
    expect(rows["d2"]).toEqual({ re: "verified", c1: "verified", c2: "verified" });
    // Valid in A only.
    expect(rows["d3"]).toEqual({ c1: "verified" });
    // Replaced in B by R5: no row there.
    expect(rows["d5"]).toEqual({ re: "verified", c1: "verified", c3: "verified" });
    // Pooled with the records of the variant: a newer failed A record gives failed in A only.
    expect(rows["d6"]).toEqual({ ...all("verified"), c1: "failed" });
    // A newer record without variant over an older failed A record.
    expect(rows["d7"]).toEqual(all("verified"));
    // A tie with one failed.
    expect(rows["d8"]).toEqual({ ...all("verified"), c1: "failed" });
    // K, in the unmarked repository, is indirect in every view through S1 (#817 Q3).
    expect(rows["a1"]).toEqual(all("indirect"));
    // element.get gives the same rows (SR-080).
    const got = (await invoke(
      "element.get",
      { ref: "SR-0000d6" },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(got.element.verification?.map((v) => [v.view.slice(-2), v.status])).toEqual(
      Object.entries(rows["d6"] ?? {}),
    );
  });

  it("[SR-173/AK-g2t9] the evidence lists, has-evidence and the passed-test list follow the same rule", async () => {
    const workspace = await open();
    const list = (await invoke(
      "evidence.list",
      { ref: "SR-0000d1", view: "VAR-0000c2" },
      { workspace },
    )) as CommandOutput<"evidence.list">;
    expect(list.records.map((r) => r.result)).toEqual(["passed"]);
    const inB = (await invoke(
      "element.list",
      { selection: { where: { relation: { direction: "evidence" }, exists: true }, view: "VAR-0000c2" } },
      { workspace },
    )) as FullList;
    // S5 is replaced in B, so the view does not hold it.
    expect(inB.elements.map((e) => e.id.slice(-2))).toEqual(["d1", "d2", "d6", "d7", "d8"]);
    const without = (await invoke(
      "evidence.withoutPassedTest",
      { view: "VAR-0000c2" },
      { workspace },
    )) as CommandOutput<"evidence.withoutPassedTest">;
    expect(without.elements.map((e) => e.id.slice(-2))).toEqual(["a1", "a4", "b5"]);
    const status = (await invoke("workspace.status", {}, { workspace })) as CommandOutput<"workspace.status">;
    expect(status.repositories.map((r) => [r.name, r.variantIndependent])).toEqual([
      ["system", undefined],
      ["supplier", true],
    ]);
  });

  it("[SR-173/AK-x4d7] a record without variant of an element of an unmarked repository counts only for the core", async () => {
    const workspace = await open();
    const rows = await statusRows(workspace);
    // K4 lies in `system`; its record lies in the marked repository's folder, which does not count.
    expect(rows["a4"]).toEqual({ ...all("open"), re: "verified" });
    // With `supplier` unmarked, its records without variant count only for the core too.
    const unmarked = await statusRows(await open(false));
    expect(unmarked["a4"]).toEqual(rows["a4"]);
    expect(unmarked["d1"]).toEqual({ ...all("open"), re: "verified" });
    expect(unmarked["d6"]).toEqual({ ...all("open"), re: "verified", c1: "failed" });
    expect(unmarked["a1"]).toEqual({ ...all("open"), re: "indirect" });
  });

  it("[SR-047/AK-y6zf] [SR-029/AK-h0h5] a record without variant of an element valid in a variant only counts there through the mark, so it is reported, refused and not enriched only without it", async () => {
    const noView = async (workspace: Workspace): Promise<readonly string[]> =>
      (
        (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">
      ).problems.flatMap((p) =>
        p.code === "evidence.counts-in-no-view" ? [`${String(p.repository)}:${String(p.file)}`] : [],
      );
    const record = (workspace: Workspace): Promise<unknown> =>
      invoke(
        "evidence.record",
        { ref: "SR-0000d3", kind: "verification", method: "test", item: "build-1", result: "passed" },
        { workspace },
      );
    const junit = {
      "results/run.xml":
        '<testsuites><testsuite name="s"><testcase name="[SR-0000d3] in A"/></testsuite></testsuites>',
    };
    const enrich = async (workspace: Workspace): Promise<readonly string[]> =>
      (
        (await invoke(
          "evidence.enrichJunit",
          { file: "results/run.xml", item: "build-1", variant: ["core"] },
          { workspace },
        )) as CommandOutput<"evidence.enrichJunit">
      ).problems.map((p) => p.message);
    // S3 applies in A only; marked, its record without variant counts in A (SR-173 AK1).
    const marked = await open(true, junit);
    expect(await noView(marked)).toEqual([]);
    await expect(record(marked)).resolves.toBeDefined();
    expect(await enrich(marked)).toEqual([]);
    // Marked, a record without variant of an element that applies in no variant counts nowhere either.
    const nowhere = await open(true, {
      "supplier/requirements/SR-0000000000d9.md":
        "---\nid: 17317317-0000-4000-8000-0000000000d9\ntype: system-requirement\nstatus: draft\n" +
        "title: Sensor reports dust\nvalidity: [{ id: 17317317-0000-4000-8000-0000000000c9, repository: system }]\n---\n",
    });
    await expect(
      invoke(
        "evidence.record",
        { ref: "SR-0000d9", kind: "verification", method: "test", item: "build-1", result: "passed" },
        { workspace: nowhere },
      ),
    ).rejects.toMatchObject({ code: "input.invalid", details: { reason: "counts-in-no-view" } });
    const unmarked = await open(false, junit);
    expect(await noView(unmarked)).toEqual(["supplier:evidence/2026-11-01-SR-0000d3-test.md"]);
    await expect(record(unmarked)).rejects.toMatchObject({
      code: "input.invalid",
      details: { reason: "counts-in-no-view" },
    });
    expect(await enrich(unmarked)).toEqual([
      'Test case "[SR-0000d3] in A" (line 1) is not enriched: SR-0000d3 does not apply in core, so a record for it there would count nowhere (SR-040)',
    ]);
  });

  it("lists the records of the copy a repository names: its repository decides about the records without variant (#821)", async () => {
    // S1 copied into `system`, which is not marked: two elements share its UUID (SR-088, D-058).
    const workspace = await open(true, {
      "requirements/SR-0000000000d1.md":
        "---\nid: 17317317-0000-4000-8000-0000000000d1\ntype: system-requirement\nstatus: draft\n" +
        "title: Sensor reports temperature\n" +
        "derives-from: [{ id: 17317317-0000-4000-8000-0000000000a1, repository: system, version: n1:67ebd0624004c969 }]\n---\n",
    });
    const list = async (repository?: string): Promise<CommandOutput<"evidence.list">> =>
      (await invoke(
        "evidence.list",
        { ref: "SR-0000d1", view: "VAR-0000c2", ...(repository === undefined ? {} : { repository }) },
        { workspace },
      )) as CommandOutput<"evidence.list">;
    await expect(list()).rejects.toMatchObject({ code: "ref.ambiguous" });
    expect((await list("supplier")).records.map((r) => r.result)).toEqual(["passed"]);
    // The record names the UUID, so both copies have it; in `system` it holds for the core only.
    expect((await list("system")).records).toEqual([]);
  });

  it("lists the records of the copy a file alone names, of two in one repository (SR-088, #821)", async () => {
    const workspace = await openCopiedFile();
    const list = (input: Record<string, unknown>): Promise<unknown> =>
      invoke("evidence.list", { ref: COPIED, ...input }, { workspace });
    await expect(list({ repository: "system" })).rejects.toMatchObject({ code: "ref.ambiguous" });
    for (const file of COPIED_FILES) {
      expect(await list({ file })).toMatchObject({ records: [], testCases: [] });
    }
  });
});
