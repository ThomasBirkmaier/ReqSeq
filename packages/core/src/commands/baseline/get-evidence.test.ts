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
type Entry = Output["elements"][number];
type Status = NonNullable<Entry["verification"]>[number]["status"];

const P = "94094094-0000-4000-8000-0000000000";
const ALPINE = `${P}c1`;
const COASTAL = `${P}c2`;
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

/** The views of a row: `core`, `alpine`, `coastal`. */
const VIEW_NAMES: Readonly<Record<string, string>> = {
  core: "core",
  [ALPINE]: "alpine",
  [COASTAL]: "coastal",
};

/** The rows of each entry by the last two characters of its UUID, as `view status` (`+n`: n later records). */
const rowsOf = (out: Output): Record<string, string[] | undefined> =>
  Object.fromEntries(
    out.elements.map((e) => [
      e.id.slice(-2),
      e.verification?.map(
        (r) =>
          `${String(VIEW_NAMES[r.view])} ${r.status}${r.later === undefined ? "" : ` +${String(r.later.length)}`}`,
      ),
    ]),
  );

/** The entry of `out` whose UUID ends with `tail`. */
const entry = (out: Output, tail: string): Entry => {
  const found = out.elements.find((e) => e.id.endsWith(tail));
  if (found === undefined) {
    throw new Error(`no entry ${tail}`);
  }
  return found;
};

/** The status of the core row of the entry ending with `tail`. */
const coreStatus = (out: Output, tail: string): Status | undefined =>
  entry(out, tail).verification?.find((r) => r.view === "core")?.status;

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

/** Replaces the records of the workspace (#127 option 1). */
const recordsAre = async (workspace: Workspace, records: readonly EvidenceRecord[]): Promise<void> => {
  await workspace.replace(
    evidenceRecordsState,
    workspace.get(evidenceRecordsState),
    Promise.resolve(records),
  );
};

describe("baseline.get withEvidence", () => {
  it("[SR-094/AK1] baseline.get withEvidence gives each requirement's status for its baseline version", async () => {
    const { fixture, workspace } = await opened();
    const out = await get(workspace, "Release 1");
    expect(rowsOf(out)).toEqual({
      a1: undefined, // needs: no verification status
      a2: undefined,
      b1: ["core verified +1", "alpine verified +1", "coastal open"],
      b2: ["core outdated +1", "alpine open"],
      b3: ["core open", "alpine open"],
      b5: ["core open", "alpine open", "coastal open"],
      b6: ["core verified", "alpine open", "coastal open"],
      b7: ["coastal verified"],
    });
    // The variants the rows name are named (#588).
    expect(out.names.map((n) => n.id)).toEqual(expect.arrayContaining([ALPINE, COASTAL]));
    const without = await get(workspace, "Release 1", false);
    expect(without.elements.some((e) => "verification" in e || "validation" in e)).toBe(false);
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
    expect(coreStatus(older, "b2")).toBe("verified");
  });

  it("[SR-094/AK2] records are compared to the baseline by date and time, by day when one has no time, later ones of its version named", async () => {
    const { workspace } = await opened();
    const out = await get(workspace, "Release 1");
    // SR-0000b1: passed at 13:00 counts, failed at 15:00 does not and is named in its view.
    const b1 = entry(out, "b1").verification ?? [];
    expect(b1[0]).toMatchObject({ view: "core", status: "verified" });
    expect(b1[0]?.later?.map((r) => [r.date, r.result, r.file])).toEqual([
      ["2026-11-02T15:00:00Z", "failed", "evidence/2026-11-02-SR-0000b1-b.md"],
    ]);
    expect(b1[1]).toMatchObject({ view: ALPINE, status: "verified" });
    expect(b1[1]?.later?.map((r) => [r.date, r.variant])).toEqual([["2026-11-02T16:00:00Z", ALPINE]]);
    // SR-0000b2: the record of its version from the day after is named; the older version's is not.
    expect(entry(out, "b2").verification?.[0]?.later?.map((r) => r.date)).toEqual(["2026-11-03T09:00:00Z"]);
    // A record without time counts on the baseline's day (the day after: counting.test.ts); records
    // of another version dated after the baseline are not named.
    const record = (date: string, result: EvidenceRecord["result"], version = V.b3): EvidenceRecord => ({
      element: `${P}b3`,
      version,
      kind: "verification",
      method: "test",
      item: "build-44",
      result,
      date,
    });
    await recordsAre(workspace, [
      record("2026-11-03T08:00:00Z", "failed"),
      record("2026-11-04T09:00:00Z", "failed", V.olderB2),
      record("2026-11-02", "passed"),
      record("2026-11-01T09:00:00Z", "failed"),
    ]);
    const b3 = entry(await get(workspace, "Release 1"), "b3").verification?.[0];
    expect(b3).toMatchObject({ view: "core", status: "verified" });
    expect(b3?.later?.map((r) => r.date)).toEqual(["2026-11-03T08:00:00Z"]);
  });

  it("[SR-094/AK3] without a counting record of the baseline version the status is outdated with older ones, else open", async () => {
    const { workspace } = await opened();
    const out = await get(workspace, "Release 1");
    // SR-0000b2: a record of an older version counts; the one of its version is dated after.
    expect(coreStatus(out, "b2")).toBe("outdated");
    expect(coreStatus(out, "b3")).toBe("open");
  });

  it("[SR-094/AK4] a baseline without a variant in its selection gives a row for the core and every variant the requirement applies in", async () => {
    const { fixture, workspace } = await opened();
    const out = await get(workspace, "Release 1");
    expect(out.view).toBeUndefined();
    // Coastal excludes SR-0000b3 and replaces SR-0000b2 by SR-0000b7: no Coastal row for them, and
    // the replacing requirement has its own; SR-0000b7 is no core requirement: no core row.
    const rows = rowsOf(out);
    expect(rows["b2"]).toEqual(["core outdated +1", "alpine open"]);
    expect(rows["b3"]).toEqual(["core open", "alpine open"]);
    expect(rows["b7"]).toEqual(["coastal verified"]);
    // The rows are those of evidence.status (SR-047 AK3) when every record predates the baseline.
    const now = (await invoke(
      "evidence.status",
      { selection: { ids: [`${P}b6`, `${P}b7`] } },
      { workspace },
    )) as CommandOutput<"evidence.status">;
    expect(now.elements.map((e) => e.verification)).toEqual([
      entry(out, "b6").verification,
      entry(out, "b7").verification,
    ]);
    // A stored view core is no variant: every row.
    await fixture.write("baselines/core.yaml", baselineText("Core", ["  view: core"], ["b1"]));
    expect(rowsOf(await get(workspace, "Core"))["b1"]).toEqual(rows["b1"]);
  });

  it("[SR-094/AK5] a baseline with a variant in its selection gives only that variant's row", async () => {
    const { fixture, workspace } = await opened();
    const out = await get(workspace, "Alpine 1");
    expect(out.view).toBe(ALPINE);
    expect(rowsOf(out)).toEqual({ b1: ["alpine verified +1"], b4: ["alpine verified"] });
    // A requirement that does not apply in the variant: no row.
    await fixture.write(
      "baselines/coastal.yaml",
      baselineText("Coastal 1", [`  view: { id: ${COASTAL}, title: Coastal }`], ["b1", "b3"]),
    );
    expect(rowsOf(await get(workspace, "Coastal 1"))).toEqual({ b1: ["coastal open"], b3: [] });
  });

  it("[SR-094/AK6] a baseline's status has no indirect verification", async () => {
    const { workspace } = await opened();
    // SR-0000b5 has no record; its child SR-0000b6 passed: indirect now, open in the baseline.
    const now = (await invoke(
      "element.get",
      { ref: `${P}b5` },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(now.element.verification?.[0]).toEqual({ view: "core", status: "indirect" });
    const out = await get(workspace, "Release 1");
    expect(coreStatus(out, "b5")).toBe("open");
    expect(coreStatus(out, "b6")).toBe("verified");
  });

  it("[SR-094/AK7] a baseline gives the validation status at the baseline version by the date rule, without view", async () => {
    const { workspace } = await opened();
    const out = await get(workspace, "Release 1");
    // N-0000a1: validated at 13:00 counts, failed at 15:00 is named; N-0000a2, a need without
    // records, is open (SR-038); requirements without validation records have none.
    expect(entry(out, "a1")).toMatchObject({ validation: "validated" });
    expect(entry(out, "a1").validationLater?.map((r) => [r.date, r.result])).toEqual([
      ["2026-11-02T15:00:00Z", "failed"],
    ]);
    expect(entry(out, "a2")).toMatchObject({ validation: "open" });
    expect(entry(out, "a2").validationLater).toBeUndefined();
    expect(entry(out, "b1").validation).toBeUndefined();
    // A requirement with validation records has one too; only records of the core count (D-026),
    // and a record of another version dated after is not named.
    const record = (date: string, result: EvidenceRecord["result"], more = {}): EvidenceRecord => ({
      element: `${P}b3`,
      version: V.b3,
      kind: "validation",
      result,
      date,
      ...more,
    });
    await recordsAre(workspace, [
      record("2026-11-03T09:00:00Z", "passed", { variant: ALPINE }),
      record("2026-11-03T08:00:00Z", "passed", { version: V.olderB2 }),
      record("2026-11-02T09:00:00Z", "failed"),
    ]);
    const b3 = entry(await get(workspace, "Release 1"), "b3");
    expect(b3.validation).toBe("failed");
    expect(b3.validationLater).toBeUndefined();
  });

  it("takes the stored view alone when the selection cannot be resolved, and leaves the rows out when that cannot be either", async () => {
    const { fixture, workspace } = await opened();
    await fixture.write(
      "baselines/gone-filter.yaml",
      baselineText("Gone filter", ["  filter: gone", `  view: { id: ${ALPINE}, title: Alpine }`], ["b1"]),
    );
    await fixture.write(
      "baselines/gone-view.yaml",
      baselineText("Gone view", [`  view: { id: ${P}ff, title: Gone }`], ["a1", "b1"]).replace(
        `${P}a1, version: ${V.b1}`,
        `${P}a1, version: n1:0f4eeb8cbba2ffee`,
      ),
    );
    await fixture.write("baselines/gone-core.yaml", baselineText("Gone core", ["  filter: gone"], ["b1"]));
    await fixture.write("baselines/ids.yaml", baselineText("Ids", ["  ids:", `    - ${P}b1`], ["b1"]));
    expect(rowsOf(await get(workspace, "Ids"))["b1"]).toEqual([
      "core verified +1",
      "alpine verified +1",
      "coastal open",
    ]);
    const filter = await get(workspace, "Gone filter");
    expect(rowsOf(filter)["b1"]).toEqual(["alpine verified +1"]);
    expect(filter.problems).toHaveLength(1);
    expect(rowsOf(await get(workspace, "Gone core"))["b1"]).toHaveLength(3);
    const view = await get(workspace, "Gone view");
    expect(rowsOf(view)).toEqual({ a1: undefined, b1: undefined });
    // The validation status has no view: it stays.
    expect(entry(view, "a1").validation).toBe("validated");
    expect(view.problems?.map((p) => p.message)).toEqual([
      expect.stringContaining("stored selection"),
      expect.stringContaining("the evidence is left out"),
    ]);
    vi.mocked(variants.resolveView).mockImplementationOnce(() => {
      throw new Error("bug");
    });
    await expect(get(workspace, "Gone filter")).rejects.toThrow("Internal error in baseline.get");
  });

  it("gives every row open while the metamodel is not valid", async () => {
    const { fixture, workspace } = await opened();
    await fixture.write("metamodel/broken.yaml", "properties: [\n");
    const out = await get(workspace, "Release 1");
    expect(entry(out, "b1").verification?.every((r) => r.status === "open" && r.later === undefined)).toBe(
      true,
    );
  });
});
