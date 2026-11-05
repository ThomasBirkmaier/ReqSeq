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

const WORKSPACE_FILE =
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  '  - { name: supplier, url: "git@git.example.com:ws/supplier.git", path: supplier, variant-independent: MARK }\n' +
  "metamodel: { repository: system, path: metamodel }\n" +
  "evidence:\n  - { repository: system, path: evidence }\n  - { repository: supplier, path: evidence }\n";

/** The fixture, with `supplier` marked as given (the fixture marks it). */
const open = async (marked = true): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-173/independent",
    files: { "reqseq-workspace.yaml": WORKSPACE_FILE.replace("MARK", String(marked)) },
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
  it("[SR-047/AK2] [SR-173/AK1] a record without variant of an element of a marked repository counts for the core and every variant the element applies in", async () => {
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

  it("[SR-173/AK1] the evidence lists, has-evidence and the passed-test list follow the same rule", async () => {
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
    )) as CommandOutput<"element.list">;
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

  it("[SR-173/AK2] a record without variant of an element of an unmarked repository counts only for the core", async () => {
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
});
