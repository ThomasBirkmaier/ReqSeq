// baseline.get with withEvidence (SR-094) on fixtures/SR-094/baseline; its README lists the
// elements, the baselines „Release 1“ (core) and „Alpine 1“ (view Alpine), both dated
// 2026-11-02T14:00:00Z, and the records. CLI end to end: packages/cli/test/e2e/baseline-get.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import * as variants from "../../variants/index.js";

vi.mock("../../variants/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof variants>();
  return { ...original, resolveView: vi.fn(original.resolveView) };
});

type Output = CommandOutput<"baseline.get">;
type Verification = Output["elements"][number]["verification"];

const P = "94094094-0000-4000-8000-0000000000";
const ALPINE = `${P}c1`;
const V = { b1: "n1:8e4ad117d2db675a", b3: "n1:9ef6067b7d2e918b", olderB2: "n1:2222222222222222" };

const opened = async (): Promise<{ readonly fixture: FixtureWorkspace; readonly workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-094/baseline" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const get = async (workspace: Workspace, baseline: string, withEvidence = true): Promise<Output> =>
  (await invoke("baseline.get", { baseline, withEvidence }, { workspace })) as Output;

/** The verification of each row by the last two characters of its UUID. */
const statusOf = (out: Output): Record<string, Verification> =>
  Object.fromEntries(out.elements.map((e) => [e.id.slice(-2), e.verification]));

const core = (status: NonNullable<Verification>["status"]): Verification => ({ view: "core", status });

/** A baseline file dated like the fixture's, with `selection` lines and the entries `ids`. */
const baselineText = (name: string, selection: readonly string[], ids: readonly string[]): string =>
  [
    "reqseq-baseline: 1",
    `name: ${name}`,
    "date: 2026-11-02T14:00:00Z",
    ...(selection.length === 0 ? [] : ["selection:", ...selection]),
    "repositories:",
    "  - { name: system, commit: 94a094a094a094a094a094a094a094a094a094a0 }",
    "elements:",
    ...ids.map((id) => `  - { id: ${P}${id}, version: ${V.b1} }`),
    "",
  ].join("\n");

describe("baseline.get withEvidence", () => {
  it("[SR-094/AK1] baseline.get withEvidence gives each requirement's status for its baseline version", async () => {
    const { fixture, workspace } = await opened();
    const out = await get(workspace, "Release 1");
    expect(statusOf(out)).toEqual({
      a1: undefined, // a need: no verification status
      b1: core("verified"),
      b2: core("outdated"),
      b3: core("open"),
      b5: core("open"),
      b6: core("verified"),
    });
    expect(statusOf(await get(workspace, "Release 1", false))["b1"]).toBeUndefined();
    // SR-0000b2 at an older version: its record of that version decides, not the current version's.
    await fixture.write(
      "baselines/older.yaml",
      baselineText("Older", [], []).replace(
        "elements:\n",
        `elements:\n  - { id: ${P}b2, version: ${V.olderB2} }\n`,
      ),
    );
    const older = await get(workspace, "Older");
    expect(older.elements[0]).toMatchObject({ state: "changed", version: V.olderB2 });
    expect(statusOf(older)["b2"]).toEqual(core("verified"));
  });

  it("[SR-094/AK2] records are compared to the baseline by date and time, by day when one has no time", async () => {
    const { workspace } = await opened();
    // SR-0000b1: passed at 13:00 counts, failed at 15:00 does not.
    expect(statusOf(await get(workspace, "Release 1"))["b1"]).toEqual(core("verified"));
    // A record without time counts on the baseline's day, not on the day after.
    const record = (date: string, result: EvidenceRecord["result"]): EvidenceRecord => ({
      element: `${P}b3`,
      version: V.b3,
      kind: "verification",
      method: "test",
      item: "build-44",
      result,
      date,
    });
    await workspace.replace(
      evidenceRecordsState,
      workspace.get(evidenceRecordsState),
      Promise.resolve([record("2026-11-02", "passed"), record("2026-11-03", "failed")]),
    );
    expect(statusOf(await get(workspace, "Release 1"))["b3"]).toEqual(core("verified"));
  });

  it("[SR-094/AK3] without a counting record of the baseline version the status is outdated with older ones, else open", async () => {
    const { workspace } = await opened();
    const rows = statusOf(await get(workspace, "Release 1"));
    // SR-0000b2: a record of an older version counts; the one of its version is dated after.
    expect(rows["b2"]).toEqual(core("outdated"));
    expect(rows["b3"]).toEqual(core("open"));
  });

  it("[SR-094/AK4] the view of the baseline's variant decides, else the core", async () => {
    const { workspace } = await opened();
    const out = await get(workspace, "Alpine 1");
    expect(out.view).toBe(ALPINE);
    // SR-0000b1 is verified in the core only; SR-0000b4 in Alpine.
    expect(statusOf(out)).toMatchObject({
      b1: { view: ALPINE, status: "open" },
      b4: { view: ALPINE, status: "verified" },
    });
    expect(statusOf(await get(workspace, "Release 1"))["b1"]).toEqual(core("verified"));
  });

  it("[SR-094/AK5] a baseline's status has no indirect verification", async () => {
    const { workspace } = await opened();
    // SR-0000b5 has no record; its child SR-0000b6 passed: indirect now, open in the baseline.
    const now = (await invoke(
      "element.get",
      { ref: `${P}b5` },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(now.element.verification?.[0]).toEqual({ view: "core", status: "indirect" });
    expect(statusOf(await get(workspace, "Release 1"))).toMatchObject({
      b5: core("open"),
      b6: core("verified"),
    });
  });

  it("takes the stored view alone when the selection cannot be resolved, and leaves the evidence out when that cannot be either", async () => {
    const { fixture, workspace } = await opened();
    await fixture.write(
      "baselines/gone-filter.yaml",
      baselineText("Gone filter", ["  filter: gone", `  view: { id: ${ALPINE}, title: Alpine }`], ["b1"]),
    );
    await fixture.write(
      "baselines/gone-view.yaml",
      baselineText("Gone view", [`  view: { id: ${P}ff, title: Gone }`], ["b1"]),
    );
    await fixture.write("baselines/gone-core.yaml", baselineText("Gone core", ["  filter: gone"], ["b1"]));
    await fixture.write("baselines/ids.yaml", baselineText("Ids", ["  ids:", `    - ${P}b1`], ["b1"]));
    expect(statusOf(await get(workspace, "Ids"))["b1"]).toEqual(core("verified"));
    const filter = await get(workspace, "Gone filter");
    expect(statusOf(filter)["b1"]).toEqual({ view: ALPINE, status: "open" });
    expect(filter.problems).toHaveLength(1);
    expect(statusOf(await get(workspace, "Gone core"))["b1"]).toEqual(core("verified"));
    const view = await get(workspace, "Gone view");
    expect(statusOf(view)["b1"]).toBeUndefined();
    expect(view.problems?.map((p) => p.message)).toEqual([
      expect.stringContaining("stored selection"),
      expect.stringContaining("the evidence is left out"),
    ]);
    vi.mocked(variants.resolveView).mockImplementationOnce(() => {
      throw new Error("bug");
    });
    await expect(get(workspace, "Gone filter")).rejects.toThrow("Internal error in baseline.get");
  });

  it("gives every requirement open while the metamodel is not valid", async () => {
    const { fixture, workspace } = await opened();
    await fixture.write("metamodel/broken.yaml", "properties: [\n");
    expect(statusOf(await get(workspace, "Release 1"))["b1"]).toEqual(core("open"));
  });
});
