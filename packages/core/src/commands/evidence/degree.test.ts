// evidence.degree (SR-037, SR-101 AK1, D-044) on fixtures/SR-037/degree (its README lists every element,
// its record, its verification status and its packages): one repository with the standard model and
// Markdown records in `evidence`, no variants (the variant case writes one on top). The records come from
// the record files, so the versions they name are those of the element files; two tests give them through
// `evidenceRecordsState` on top of the files. The same output on every access: cross-access.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureOptions } from "@reqseq/testkit";
import { createFixtureWorkspace, defaultFixturesDir } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState, verificationState } from "../../evidence/index.js";
import type { VerificationStatus } from "../../generated/types.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.degree">;

const U = (tail: string): string => `37373737-3737-4737-8737-00000000${tail}`;
const R01 = U("b001");
const R09 = U("b009");
const V = U("c001");
const RV = U("b301");

const DEGREE: FixtureOptions = { fixture: "SR-037/degree" };

const open = async (options: FixtureOptions = DEGREE): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** A file of the fixture with `edit` applied, to write on top of it. */
const edited = async (file: string, edit: (text: string) => string): Promise<string> =>
  edit(await fs.readFile(path.join(defaultFixturesDir, "SR-037/degree", file), "utf8"));

const degree = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("evidence.degree", input, { workspace })) as Output;

const counts = (open: number, verified: number, indirect: number, failed: number, outdated: number) => ({
  open,
  verified,
  indirect,
  failed,
  outdated,
});

/** P1 of the fixture, and P3 (AK3): R01–R10. */
const P1_DEGREE: Output = {
  degree: { share: 0.6, total: 10, counts: counts(2, 6, 0, 1, 1) },
  view: "core",
  incomplete: false,
};

/** The whole workspace: R01–R10, I1, C1–C3. */
const WHOLE: Output["degree"] = { share: 9 / 14, total: 14, counts: counts(2, 8, 1, 2, 1) };

const STATUSES: readonly VerificationStatus[] = ["open", "verified", "indirect", "failed", "outdated"];

/** The current version of an element, as element.get gives it. */
const versionOf = async (workspace: Workspace, ref: string): Promise<string> =>
  String(
    ((await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">).element.version,
  );

const passed = (element: string, version: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element,
  version,
  kind: "verification",
  method: "test",
  item: "build-38",
  result: "passed",
  date: "2026-10-28T10:00:00Z",
  ...more,
});

/** Gives `more` records on top of those of the record files. */
const addRecords = async (workspace: Workspace, more: readonly EvidenceRecord[]): Promise<void> => {
  const current = workspace.get(evidenceRecordsState);
  const files = await current;
  await workspace.replace(evidenceRecordsState, current, Promise.resolve([...files, ...more]));
};

describe("evidence.degree (SR-037)", () => {
  it("[SR-037/AK1] [SR-101/AK1] evidence.degree of a package of 10 valid requirements gives 0.6 and the count per status, for exactly the elements of the package", async () => {
    expect(await degree(await open(), { selection: { package: "PKG-00d001" } })).toEqual(P1_DEGREE);
  });

  it("[SR-037/AK1] the counts are those evidence.status and the filter give for the same selection", async () => {
    const workspace = await open();
    const out = await degree(workspace);
    expect(out.degree).toEqual(WHOLE);
    // evidence.status: the core status of each requirement whose status is not obsolete.
    const listed = (await invoke(
      "evidence.status",
      { limit: 5000 },
      { workspace },
    )) as CommandOutput<"evidence.status">;
    const tally = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const element of listed.elements) {
      const core = element.verification?.find((v) => v.view === "core");
      if (core !== undefined && element.status !== "obsolete") {
        tally[core.status] = (tally[core.status] ?? 0) + 1;
      }
    }
    expect(tally).toEqual(out.degree.counts);
    // The filter: the same state (`verificationState`), so the same count per status (SR-080 AK2).
    for (const status of STATUSES) {
      const list = (await invoke(
        "element.list",
        { selection: { where: { all: [{ verification: [status] }, { not: { invalid: true } }] } }, limit: 1 },
        { workspace },
      )) as CommandOutput<"element.list">;
      expect([status, list.total]).toEqual([status, out.degree.counts[status]]);
    }
  });

  it("[SR-037/AK2] evidence.degree counts an indirectly verified requirement as verified and apart", async () => {
    expect(await degree(await open(), { selection: { package: "PKG-00d002" } })).toEqual({
      degree: { share: 0.6, total: 5, counts: counts(1, 2, 1, 1, 0) },
      view: "core",
      incomplete: false,
    });
  });

  it("[SR-037/AK3] evidence.degree leaves out the requirements with an obsolete status", async () => {
    const workspace = await open();
    // P3 holds P1's requirements, the obsolete O1 (verified) and O2 (failed), and the need N1.
    expect(await degree(workspace, { selection: { package: "PKG-00d003" } })).toEqual(P1_DEGREE);
    // Named one by one: still not counted.
    expect(
      (await degree(workspace, { selection: { ids: ["SR-00b201", "SR-00b202", "SR-00b001"] } })).degree,
    ).toEqual({ share: 1, total: 1, counts: counts(0, 1, 0, 0, 0) });
  });

  it("gives 9 of 14 for the whole workspace", async () => {
    expect(await degree(await open())).toEqual({ degree: WHOLE, view: "core", incomplete: false });
  });

  it("counts in the view of the selection, else of its saved filter; without a view in the core (#592 Q1)", async () => {
    const variant = [
      "---",
      `id: ${V}`,
      "type: variant",
      "status: draft",
      "title: Pro",
      "---",
      "",
      "Pro.",
      "",
    ];
    const rv = [
      "---",
      `id: ${RV}`,
      "type: system-requirement",
      "status: draft",
      "title: Show gusts",
      "validity:",
      `  - { id: ${V}, title: Pro }`,
      "---",
      "",
      "Valid only in Pro.",
      "",
    ];
    const workspace = await open({
      ...DEGREE,
      files: {
        "variants/VAR-00000000c001.md": variant.join("\n"),
        "requirements/SR-00000000b301.md": rv.join("\n"),
        "filters/pro.yaml":
          "logreq-filter: 1\nname: Pro\nview: VAR-00c001\nwhere: { type: [system-requirement] }\n",
      },
    });
    await addRecords(workspace, [passed(RV, await versionOf(workspace, RV), { variant: V })]);
    // In Pro: RV verified by its record for Pro; R01's record holds only in the core. `names` names
    // the variant of the view for readers (#588).
    const pro = { id: V, repository: "system", shortId: "VAR-00c001", title: "Pro" };
    expect(await degree(workspace, { selection: { ids: [R01, RV], view: "VAR-00c001" } })).toEqual({
      degree: { share: 0.5, total: 2, counts: counts(1, 1, 0, 0, 0) },
      view: V,
      incomplete: false,
      names: [pro],
    });
    // Without a view: the core, where RV has no status.
    expect(await degree(workspace, { selection: { ids: [R01, RV] } })).toEqual({
      degree: { share: 1, total: 1, counts: counts(0, 1, 0, 0, 0) },
      view: "core",
      incomplete: false,
    });
    // The saved filter's view: every requirement that applies in Pro, only RV verified there.
    const filtered = await degree(workspace, { selection: { filter: "Pro" } });
    expect([filtered.view, filtered.names]).toEqual([V, [pro]]);
    expect(filtered.degree).toEqual({ share: 1 / 15, total: 15, counts: counts(14, 1, 0, 0, 0) });
  });

  it("counts every requirement open while the metamodel is not valid", async () => {
    const workspace = await open({ ...DEGREE, files: { "metamodel/broken.yaml": "properties: [\n" } });
    expect((await degree(workspace)).degree).toEqual({ share: 0, total: 14, counts: counts(14, 0, 0, 0, 0) });
  });

  it("[SR-006/AK2] marks the degree incomplete when a repository of the workspace is not available", async () => {
    const file = await edited("logreq-workspace.yaml", (text) =>
      text.replace(
        "main: true }",
        'main: true }\n  - { name: other, url: "git@git.example.com:ws/other.git" }',
      ),
    );
    const out = await degree(await open({ ...DEGREE, files: { "logreq-workspace.yaml": file } }), {
      selection: { package: "PKG-00d001" },
    });
    expect(out).toEqual({ ...P1_DEGREE, incomplete: true });
  });

  it("marks the degree incomplete when an evidence location lies in a repository that is not available", async () => {
    const file = await edited(
      "logreq-workspace.yaml",
      (text) => `${text}  - { repository: vault, path: results }\n`,
    );
    const vault = file.replace(
      "main: true }",
      'main: true }\n  - { name: vault, url: "git@git.example.com:ws/vault.git" }',
    );
    const out = await degree(await open({ ...DEGREE, files: { "logreq-workspace.yaml": vault } }));
    expect(out).toEqual({ degree: WHOLE, view: "core", incomplete: true });
  });

  it("follows a changed record: the state is built anew", async () => {
    const workspace = await open();
    expect(await degree(workspace, { selection: { package: "PKG-00d001" } })).toEqual(P1_DEGREE);
    await addRecords(workspace, [passed(R09, await versionOf(workspace, R09))]);
    expect((await degree(workspace, { selection: { package: "PKG-00d001" } })).degree).toEqual({
      share: 0.7,
      total: 10,
      counts: counts(1, 7, 0, 1, 1),
    });
  });

  it("reads the current versions once: a second degree and a degree after the filter read none (no second walk)", async () => {
    const workspace = await open();
    await degree(workspace);
    const state = await workspace.get(verificationState);
    expect(state.versionBatches()).toBe(1);
    expect((await degree(workspace)).degree).toEqual(WHOLE);
    expect((await degree(workspace, { selection: { package: "PKG-00d002" } })).degree.total).toBe(5);
    expect(state.versionBatches()).toBe(1);
    // The filter first, then the degree: the filter's batch covers the degree's requirements.
    const other = await open();
    await invoke(
      "element.list",
      { selection: { where: { verification: ["verified"] } } },
      { workspace: other },
    );
    const shared = await other.get(verificationState);
    expect(shared.versionBatches()).toBe(1);
    expect((await degree(other)).degree).toEqual(WHOLE);
    expect(shared.versionBatches()).toBe(1);
  });

  it("leaves every element's status as written (D-030)", async () => {
    const workspace = await open();
    const statuses = async (): Promise<unknown> =>
      (
        (await invoke("element.list", { limit: 1000 }, { workspace })) as CommandOutput<"element.list">
      ).elements.map((e) => [e.shortId, e.status]);
    const before = await statuses();
    await degree(workspace);
    await degree(workspace, { selection: { package: "PKG-00d003" } });
    expect(await statuses()).toEqual(before);
  });

  it("an unknown package gives the error element.list gives", async () => {
    const workspace = await open();
    const input = { selection: { package: "PKG-ffffff" } };
    const failure = async (name: "evidence.degree" | "element.list"): Promise<unknown> =>
      invoke(name, input, { workspace }).then(
        () => "no error",
        (error: unknown) => (error as { code?: unknown }).code,
      );
    const code = await failure("evidence.degree");
    expect(code).not.toBe("no error");
    expect(code).toBe(await failure("element.list"));
  });
});
