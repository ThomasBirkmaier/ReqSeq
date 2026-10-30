// Core requirements changed or new since a variant's newest baseline (SR-103), on
// fixtures/SR-103/since-baseline: K1, K2 are adopted by Coast and Mountain, Coast excludes K3, and B1
// (validity [Coast]) replaces K4 in Coast. The baselines are written by hand with the current
// versions of the fixture, except in AK2, which creates them with baseline.create.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput, Problem } from "../catalog.js";
import { baselineHeadersState, HEADER_BYTES } from "../baselines/index.js";
import { currentVersionsState } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

const P = "10310310-0000-4000-8000-0000000000";
const [K1, K2, K3, K4, K5, B1, COAST, MOUNTAIN] = ["a1", "a2", "a3", "a4", "a5", "b1", "c1", "c2"].map(
  (n) => `${P}${n}`,
);
const VERSIONS: Readonly<Record<string, string>> = {
  [String(K1)]: "n1:c44c2a59a7eba159",
  [String(K2)]: "n1:b817003944c5d6fb",
  [String(B1)]: "n1:4a65c37394420816",
  [String(COAST)]: "n1:878bca1d9503aac6",
  [String(MOUNTAIN)]: "n1:48710b76f8d1a3c3",
};
const K3_VERSION = "n1:fde23c6d4b73e13f";
const K4_VERSION = "n1:161691fea8fb960d";
const OLD = "n1:0000000000000000";
const FIXTURE = path.resolve(import.meta.dirname, "../../../../fixtures/SR-103/since-baseline");
const fileOf = (id: string): string =>
  `${id.endsWith("c1") || id.endsWith("c2") ? "variants/VAR" : "requirements/SR"}-0000000000${id.slice(-2)}.md`;
const CODES = new Set(["variant.core-changed-since-baseline", "variant.core-new-since-baseline"]);

/** The fixture's file of `id` with `from` replaced by `to`. */
const edited = async (id: string, from: string, to: string): Promise<string> =>
  (await fs.readFile(path.join(FIXTURE, fileOf(id)), "utf8")).replace(from, to);

/** A baseline file in the layout ReqSeq writes; `versions` overrides the fixture's. */
const baseline = (
  name: string,
  date: string,
  selection: string | undefined,
  versions: Readonly<Record<string, string>> = {},
): string => {
  const all = { ...VERSIONS, ...versions };
  const entries = Object.keys(all)
    .sort()
    .map((id) => `  - { id: ${id}, version: ${String(all[id])} }\n`);
  return `reqseq-baseline: 1\nname: ${name}\ndate: ${date}\n${selection === undefined ? "" : `selection:\n${selection}`}repositories:\n  - { name: system, commit: ${"a".repeat(40)} }\nelements:\n${entries.join("")}`;
};
const OF_COAST = `  view: { id: ${String(COAST)}, title: Coast }\n`;

const open = async (
  files: Readonly<Record<string, string>> = {},
  git?: true,
): Promise<{
  readonly workspace: Workspace;
  readonly fixture: Awaited<ReturnType<typeof createFixtureWorkspace>>;
}> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-103/since-baseline",
    files,
    ...(git ? { git } : {}),
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { workspace, fixture };
};

/** A new workspace on the files of `fixture` as they are now (the store reads them again). */
const reopened = (fixture: { readonly root: string }): Workspace => {
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const check = async (workspace: Workspace): Promise<readonly Problem[]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems;

const listed = async (
  workspace: Workspace,
  input: Record<string, unknown> = {},
): Promise<readonly Problem[]> =>
  ((await invoke("hint.list", input, { workspace })) as CommandOutput<"hint.list">).hints.filter((h) =>
    CODES.has(h.code),
  );

/** Code, element and target of each since-baseline problem. */
const rows = (problems: readonly Problem[]): unknown[] =>
  problems.filter((p) => CODES.has(p.code)).map((p) => [p.code, p.elementId, p.targetId]);

const changedK1 = async (): Promise<string> => edited(String(K1), "every minute.\n", "every 30 seconds.\n");

describe("core requirements changed since a variant's newest baseline (SR-103)", () => {
  it("[SR-103/AK1] an adopted core requirement changed since A's newest baseline is a hint at A with both versions", async () => {
    const { workspace } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
      [fileOf(String(K1))]: await changedK1(),
    });
    const problems = await check(workspace);
    // Mountain has no baseline (AK3).
    expect(rows(problems)).toEqual([["variant.core-changed-since-baseline", COAST, K1]]);
    const hint = problems.find((p) => CODES.has(p.code));
    expect(hint).toMatchObject({
      severity: "warning",
      repository: "system",
      file: fileOf(String(COAST)),
      line: 2,
      storedVersion: String(VERSIONS[String(K1)]),
    });
    expect(hint?.currentVersion).toMatch(/^n1:/);
    expect(hint?.currentVersion).not.toBe(String(VERSIONS[String(K1)]));
    expect(hint?.message).toBe(
      `Core requirement System Requirement SR-0000a1, which Variant VAR-0000c1 adopts, has changed since its newest baseline R1: version ${String(VERSIONS[String(K1)])} there, version ${String(hint?.currentVersion)} now; a new baseline of Variant VAR-0000c1 settles it (D-042)`,
    );
    expect(await listed(workspace, { variant: "VAR-0000c1" })).toEqual([hint]);
    const shown = (await invoke(
      "element.get",
      { ref: COAST },
      { workspace },
    )) as CommandOutput<"element.get">;
    expect(rows(shown.element.problems ?? [])).toEqual([["variant.core-changed-since-baseline", COAST, K1]]);
    const k1 = (await invoke("element.get", { ref: K1 }, { workspace })) as CommandOutput<"element.get">;
    expect(rows(k1.element.problems ?? [])).toEqual([]);
  });

  it("[SR-103/AK1] hint.list --variant A lists the since-baseline hints of A and none of B", async () => {
    const { workspace } = await open({
      "baselines/coast.yaml": baseline("coast", "2026-11-02T10:00:00Z", OF_COAST),
      // A hand-written view by short ID.
      "baselines/mountain.yaml": baseline("mountain", "2026-11-02T10:00:00Z", "  view: VAR-0000c2\n", {
        [String(K2)]: OLD,
        [String(K3)]: K3_VERSION,
        [String(K4)]: K4_VERSION,
      }),
      [fileOf(String(K1))]: await changedK1(),
    });
    const changed = "variant.core-changed-since-baseline";
    expect(rows(await listed(workspace))).toEqual([
      [changed, COAST, K1],
      [changed, MOUNTAIN, K1],
      [changed, MOUNTAIN, K2],
    ]);
    expect(rows(await listed(workspace, { variant: "VAR-0000c1" }))).toEqual([[changed, COAST, K1]]);
    expect(rows(await listed(workspace, { variant: "VAR-0000c2" }))).toEqual([
      [changed, MOUNTAIN, K1],
      [changed, MOUNTAIN, K2],
    ]);
    expect(await listed(workspace, { variant: "core" })).toEqual([]);
    expect(rows(await listed(workspace, { ref: "VAR-0000c1" }))).toEqual([[changed, COAST, K1]]);
  });

  it("[SR-103/AK2] a new baseline of A clears the hint", async () => {
    const { workspace, fixture } = await open({}, true);
    const create = (name: string): Promise<unknown> =>
      invoke("baseline.create", { name, selection: { view: "VAR-0000c1" } }, { workspace });
    await create("R1");
    await fixture.write(fileOf(String(K1)), await changedK1());
    await fixture.commit();
    const after = reopened(fixture);
    expect(rows(await listed(after))).toEqual([["variant.core-changed-since-baseline", COAST, K1]]);
    await invoke("baseline.create", { name: "R2", selection: { view: "VAR-0000c1" } }, { workspace: after });
    expect(await listed(after)).toEqual([]);
  });

  it("[SR-103/AK3] a variant without baseline gets no hint", async () => {
    const { workspace } = await open({ [fileOf(String(K1))]: await changedK1() });
    expect(rows(await check(workspace))).toEqual([]);
    expect(await listed(workspace, { variant: "VAR-0000c1" })).toEqual([]);
  });

  it("[SR-103/AK4] the newest baseline is the latest date, on a tie the last file", async () => {
    const stale = { [String(K1)]: OLD };
    const files = {
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST, stale),
      "baselines/R2.yaml": baseline("R2", "2026-11-09T10:00:00Z", OF_COAST),
      // The same day, earlier: the time counts.
      "baselines/R3.yaml": baseline("R3", "2026-11-09T09:00:00Z", OF_COAST, stale),
      // Newer, but no baseline of Coast: a package beside the view, the core, no selection, an
      // element that is no variant, a variant of no element, a text that names nothing.
      "baselines/S1.yaml": baseline("S1", "2026-11-10T10:00:00Z", `${OF_COAST}  package: PKG-1\n`, stale),
      "baselines/S2.yaml": baseline("S2", "2026-11-10T10:00:00Z", "  view: core\n", stale),
      "baselines/S3.yaml": baseline("S3", "2026-11-10T10:00:00Z", undefined, stale),
      "baselines/S4.yaml": baseline(
        "S4",
        "2026-11-10T10:00:00Z",
        `  view: { id: ${String(K1)}, title: K }\n`,
        stale,
      ),
      "baselines/S5.yaml": baseline(
        "S5",
        "2026-11-10T10:00:00Z",
        `  view: { id: ${P}ff, title: Gone }\n`,
        stale,
      ),
      "baselines/S6.yaml": baseline("S6", "2026-11-10T10:00:00Z", "  package: PKG-1\n", stale),
    };
    const { workspace, fixture } = await open(files);
    expect(await listed(workspace)).toEqual([]);
    // At the same instant as R2, a later file: it is the newest.
    await fixture.write("baselines/R2b.yaml", baseline("R2b", "2026-11-09T10:00:00Z", OF_COAST, stale));
    const [hint] = await listed(workspace);
    expect([hint?.targetId, hint?.storedVersion]).toEqual([K1, OLD]);
    expect(hint?.message).toContain("its newest baseline R2b:");
  });

  it("[SR-103/AK5] hint.confirm of the hint is refused: a new baseline settles it", async () => {
    const { workspace } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
      [fileOf(String(K1))]: await changedK1(),
    });
    const id = `variant.core-changed-since-baseline/system/${String(COAST)}`;
    const confirmed = (await invoke(
      "hint.confirm",
      { ref: "VAR-0000c1", kind: ["variant.core-changed-since-baseline"], hintIds: [id] },
      { workspace },
    )) as CommandOutput<"hint.confirm">;
    expect([confirmed.confirmed, confirmed.files]).toEqual([[], []]);
    // No `hint.not-found` beside the refusal: it would say there is no open hint.
    const refused = confirmed.problems ?? [];
    expect(refused.map((p) => p.code)).toEqual(["hint.not-confirmable", "hint.not-confirmable"]);
    expect(refused.map((p) => [p.hintId, p.message])).toEqual([
      [
        undefined,
        "kind variant.core-changed-since-baseline is not confirmed: a variant.core-changed-since-baseline hint is settled only by a new baseline of its variant (baseline.create with the view of the variant), not by confirming it (D-042)",
      ],
      [
        id,
        `${id} is not confirmed: a variant.core-changed-since-baseline hint is settled only by a new baseline of its variant (baseline.create with the view of the variant), not by confirming it (D-042)`,
      ],
    ]);
    expect(rows(await listed(workspace))).toHaveLength(1);
  });

  it("[SR-103/AK5] hint.confirm of the hints of A is refused with the reason, and confirms nothing else", async () => {
    const { workspace } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
      [fileOf(String(K1))]: await changedK1(),
    });
    const confirm = async (ref: string): Promise<CommandOutput<"hint.confirm">> =>
      (await invoke("hint.confirm", { ref }, { workspace })) as CommandOutput<"hint.confirm">;
    const refused = await confirm("VAR-0000c1");
    expect([refused.confirmed, refused.files]).toEqual([[], []]);
    expect(refused.problems?.map((p) => [p.code, p.severity, p.message])).toEqual([
      [
        "hint.not-confirmable",
        "error",
        "1 open hints at VAR-0000c1 (variant.core-changed-since-baseline) are not confirmed: they are settled only by a new baseline of the variant (baseline.create with the view of the variant), not by confirming them (D-042)",
      ],
    ]);
    // A variant without such hints, and another element: the usual warning.
    for (const ref of ["VAR-0000c2", "SR-0000a2"]) {
      expect((await confirm(ref)).problems?.map((p) => p.code)).toEqual(["hint.not-found"]);
    }
  });

  it("[SR-103/AK6] excluded or replaced core requirements give no hint here", async () => {
    const { workspace } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST, {
        [String(K3)]: OLD,
        [String(K4)]: OLD,
      }),
      [fileOf(String(K3))]: await edited(String(K3), "every hour.\n", "every two hours.\n"),
      [fileOf(String(K4))]: await edited(String(K4), "every ten minutes.\n", "every five minutes.\n"),
    });
    const problems = await check(workspace);
    expect(rows(problems)).toEqual([]);
    // The replaced one is SR-045's hint at its replacement, the excluded one an outdated exclusion.
    expect(problems.map((p) => [p.code, p.elementId, p.targetId])).toEqual([
      ["variant.core-changed", B1, K4],
      ["relation.outdated", COAST, K3],
    ]);
  });

  it("[SR-103/AK7] a core requirement that came into the view of A since the baseline is named new since the baseline with its current version only", async () => {
    const k5 = (await edited(String(K1), `id: ${String(K1)}`, `id: ${String(K5)}`)).replace(
      "title: Wind speed every minute",
      "title: Wind direction every minute",
    );
    const { workspace, fixture } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
      // New, and its exclusion undone.
      "requirements/SR-0000000000a5.md": k5,
      [fileOf(String(COAST))]: (await fs.readFile(path.join(FIXTURE, fileOf(String(COAST))), "utf8")).replace(
        /excludes:\n.*\n/,
        "",
      ),
    });
    const added = "variant.core-new-since-baseline";
    const hints = await listed(workspace);
    expect(rows(hints)).toEqual([
      [added, COAST, K3],
      [added, COAST, K5],
    ]);
    expect(hints[0]?.storedVersion).toBeUndefined();
    expect(hints[0]?.currentVersion).toBe(K3_VERSION);
    expect(hints[0]?.message).toBe(
      `Core requirement System Requirement SR-0000a3 has come into the view of Variant VAR-0000c1 since its newest baseline R1, which does not list it: version ${K3_VERSION} now; a new baseline of Variant VAR-0000c1 settles it (D-042)`,
    );
    // Its replacement removed.
    const b1 = await fs.readFile(path.join(FIXTURE, fileOf(String(B1))), "utf8");
    await fixture.write(fileOf(String(B1)), b1.replace(/replaces:\n.*\n/, ""));
    expect(rows(await listed(reopened(fixture))).map((r) => (r as string[])[2])).toEqual([K3, K4, K5]);
  });

  it("names a core requirement whose version cannot be computed now without a current version", async () => {
    const endless = (id: string): Promise<string> =>
      edited(id, "requirement-type: functional", "requirement-type: .inf");
    const { workspace } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST, { [`${P}ee`]: OLD }),
      [fileOf(String(K1))]: await endless(String(K1)),
      "requirements/SR-0000000000a5.md": (await endless(String(K1))).replace(
        `id: ${String(K1)}`,
        `id: ${String(K5)}`,
      ),
    });
    const hints = await listed(workspace);
    expect(rows(hints)).toEqual([
      ["variant.core-changed-since-baseline", COAST, K1],
      ["variant.core-new-since-baseline", COAST, K5],
    ]);
    expect(hints.map((h) => h.currentVersion)).toEqual([undefined, undefined]);
    expect(hints[0]?.message).toContain("there, a version that cannot be computed now;");
  });
});

describe("reading the newest baseline (baselines/newest.ts)", () => {
  it("reads a long or hand-edited header in full, skips faulty files and keeps headers by stamp", async () => {
    const ids = Array.from(
      { length: Math.ceil(HEADER_BYTES / 40) },
      (_, i) => `    - 10310310-0000-4000-8000-${String(i).padStart(12, "0")}\n`,
    );
    const { workspace, fixture } = await open({
      // A selection longer than HEADER_BYTES: no baseline of Coast (it names IDs).
      "baselines/A.yaml": baseline("A", "2026-11-12T10:00:00Z", `  ids:\n${ids.join("")}`, {
        [String(K1)]: OLD,
      }),
      // Hand-edited: read with YAML, a baseline of Coast.
      "baselines/B.yaml": `# by hand\n${baseline("B", "2026-11-02T10:00:00Z", OF_COAST, { [String(K1)]: OLD })}`,
      // Newer, but faulty: the next newest counts.
      "baselines/C.yaml": `${baseline("C", "2026-11-11T10:00:00Z", OF_COAST)}  - { id: nonsense }\n`,
      "baselines/D.yml": baseline("D", "2026-11-11T10:00:00Z", OF_COAST),
    });
    await fs.symlink(fixture.path("baselines/missing"), fixture.path("baselines/E.yaml"));
    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now + 60_000);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const targets = async (): Promise<unknown[]> =>
      (await listed(workspace)).map((h) => [h.targetId, h.message.includes("baseline B:")]);
    expect(await targets()).toEqual([[K1, true]]);
    // Kept by stamp; a file that cannot be looked at is read again.
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(new Error("gone"));
    expect(await targets()).toEqual([[K1, true]]);
    // The header of a removed file is dropped.
    const headers = workspace.get(baselineHeadersState);
    expect([...headers.keys()].some((key) => key.endsWith("baselines/A.yaml"))).toBe(true);
    await fs.rm(fixture.path("baselines/A.yaml"));
    expect(await targets()).toEqual([[K1, true]]);
    expect([...headers.keys()].some((key) => key.endsWith("baselines/A.yaml"))).toBe(false);
  });

  it("finds no baseline in a folder that is not here or cannot be read", async () => {
    const workspaceFile = await fs.readFile(path.join(FIXTURE, "reqseq-workspace.yaml"), "utf8");
    const vault = '  - { name: vault, url: "git@git.example.com:ws/vault.git", path: ../vault }\n';
    for (const [more, repositories] of [
      ["baselines: { repository: vault, path: baselines }\n", vault],
      ["baselines: { repository: system, path: reqseq-workspace.yaml }\n", ""],
    ] as const) {
      const { workspace } = await open({
        "reqseq-workspace.yaml": `${workspaceFile.replace("metamodel:", `${repositories}metamodel:`)}${more}`,
        "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
        [fileOf(String(K1))]: await changedK1(),
      });
      expect(await listed(workspace)).toEqual([]);
    }
  });
});

describe("a workspace without variants", () => {
  it("reads no baseline for these hints", async () => {
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: { "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST) },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = reopened(fixture);
    const spy = vi.spyOn(fs, "open");
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    expect(await listed(workspace)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("what hint.list computes (N-036)", () => {
  it("reads no baseline when the filters admit no since-baseline hint", async () => {
    const { workspace } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
      [fileOf(String(K1))]: await changedK1(),
    });
    // The states and the outdated relations first, so that only these hints could read files.
    await listed(workspace);
    const spy = vi.spyOn(fs, "open");
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const inputs = [
      { ref: "SR-0000a1" },
      { type: ["system-requirement"] },
      { kind: ["relation.outdated"] },
      { variant: "VAR-0000c1", ref: "VAR-0000c2" },
    ];
    for (const input of inputs) {
      expect(await listed(workspace, input)).toEqual([]);
    }
    expect(spy).not.toHaveBeenCalled();
    expect(
      rows(
        await listed(workspace, {
          type: ["variant"],
          kind: ["variant.core-new-since-baseline", "variant.core-changed-since-baseline"],
        }),
      ),
    ).toHaveLength(1);
  });
});

describe("copies of a core requirement in two repositories (SR-088)", () => {
  it("names the copy the baseline does not list, though another copy has its version", async () => {
    const workspaceFile = (await fs.readFile(path.join(FIXTURE, "reqseq-workspace.yaml"), "utf8")).replace(
      "metamodel:",
      '  - { name: sensor, url: "git@git.example.com:ws/sensor.git", path: sensor }\nmetamodel:',
    );
    const { workspace } = await open({
      "reqseq-workspace.yaml": workspaceFile,
      // The same content as K1 of the baseline, so the same version, in another repository.
      [`sensor/${fileOf(String(K1))}`]: await fs.readFile(path.join(FIXTURE, fileOf(String(K1))), "utf8"),
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
    });
    const hints = await listed(workspace);
    expect(hints.map((h) => [h.code, h.targetId, h.currentVersion])).toEqual([
      ["variant.core-new-since-baseline", K1, VERSIONS[String(K1)]],
    ]);
  });
});

describe("kept between calls", () => {
  it("carries the hints of a variant over a change elsewhere and gives what a new workspace gives", async () => {
    const { workspace, fixture } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
      [fileOf(String(K1))]: await changedK1(),
    });
    // The baseline file read is kept only once it is no longer racy (`changeStamp`).
    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now + 60_000);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const fresh = async (): Promise<unknown[]> => rows(await listed(reopened(fixture)));
    const step = async (change: () => Promise<unknown>): Promise<unknown[]> => {
      await change();
      const now = rows(await listed(workspace));
      expect(now).toEqual(await fresh());
      // element.get of the variant agrees.
      const shown = (await invoke(
        "element.get",
        { ref: COAST },
        { workspace },
      )) as CommandOutput<"element.get">;
      expect(rows(shown.element.problems ?? [])).toEqual(now);
      return now;
    };
    const changed = "variant.core-changed-since-baseline";
    const update = (ref: string, input: Record<string, unknown>): Promise<unknown> =>
      invoke("element.update", { ref, ...input }, { workspace });
    expect(await step(() => Promise.resolve(undefined))).toEqual([[changed, COAST, K1]]);
    // A core requirement changes: only its hit is computed again.
    expect(
      await step(() => update(String(K2), { text: "The station reports the temperature twice a minute.\n" })),
    ).toEqual([
      [changed, COAST, K1],
      [changed, COAST, K2],
    ]);
    // The variant and a replacement change, their rules do not; then a core requirement changes back.
    await step(() => update(String(COAST), { title: "Coast station" }));
    await step(() => update(String(B1), { text: "At the coast the rain every minute.\n" }));
    expect(
      await step(() => update(String(K2), { text: "The station reports the temperature every minute.\n" })),
    ).toEqual([[changed, COAST, K1]]);
    // A rule changes, a new core requirement, a core requirement gets a validity: computed again.
    expect(
      await step(() => invoke("variant.exclude", { variant: COAST, refs: ["SR-0000a1"] }, { workspace })),
    ).toEqual([]);
    expect(
      await step(() =>
        invoke(
          "element.create",
          { type: "system-requirement", title: "Pressure", text: "Pressure.\n" },
          { workspace },
        ),
      ),
    ).toHaveLength(1);
    await step(() => update(String(K2), { set: { validity: [{ id: String(MOUNTAIN) }] } }));
    // The versions built again, on the same store.
    await step(() => workspace.reset(currentVersionsState));
  });
});

describe("workspace.check restricted to changed files (SR-092)", () => {
  it("keeps a since-baseline hint whose core requirement changed, and drops it otherwise", async () => {
    const { workspace } = await open({
      "baselines/R1.yaml": baseline("R1", "2026-11-02T10:00:00Z", OF_COAST),
      [fileOf(String(K1))]: await changedK1(),
    });
    const restricted = async (file: string): Promise<unknown[]> =>
      rows(
        (
          (await invoke(
            "workspace.check",
            { changedFiles: [file] },
            { workspace },
          )) as CommandOutput<"workspace.check">
        ).problems,
      );
    expect(await restricted(fileOf(String(K1)))).toEqual([
      ["variant.core-changed-since-baseline", COAST, K1],
    ]);
    expect(await restricted(fileOf(String(K2)))).toEqual([]);
  });
});
