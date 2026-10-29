// evidence.withoutPassedTest (SR-120, spec question #532) on fixtures/SR-126/matrix (its README lists every
// element, its records and its verification status): one repository with the standard model, JUnit runs
// (one with a skipped test case) and a Markdown inspection record. The records come from the record files;
// a few tests add records through `evidenceRecordsState` on top of them, or write a variant on top. The
// same output on every access: cross-access.test.ts. The key path in the app (AK1): app/test/without-passed-test.spec.ts.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureOptions } from "@reqseq/testkit";
import { createFixtureWorkspace, defaultFixturesDir } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState } from "../../evidence/index.js";
import { getCommandRuntime, invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.withoutPassedTest">;

const COMMAND = "evidence.withoutPassedTest";
const U = (tail: string): string => `5c0e1d2a-0126-4126-8126-000000126${tail}`; // tail: 3 hex digits
const B = (n: string): string => U(`b${n}`);
const V = U("c01");
const RV = U("b31");

const MATRIX: FixtureOptions = { fixture: "SR-126/matrix" };

/** The short IDs listed on the fixture in the core: b02 failed, b04 skipped, b05 inspection, b06 none, b07 indirect. */
const LISTED = ["SR-126b02", "SR-126b04", "SR-126b05", "SR-126b06", "SR-126b07"];

const open = async (options: FixtureOptions = MATRIX): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const run = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke(COMMAND, input, { workspace })) as Output;

const shortIds = (out: Output): string[] => out.elements.map((e) => e.shortId);

/** A file of the fixture with `edit` applied, to write on top of it. */
const edited = async (file: string, edit: (text: string) => string): Promise<string> =>
  edit(await fs.readFile(path.join(defaultFixturesDir, "SR-126/matrix", file), "utf8"));

/** The current version of an element, as element.get gives it. */
const versionOf = async (workspace: Workspace, ref: string): Promise<string> =>
  String(
    ((await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">).element.version,
  );

const test = (element: string, version: string, more: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  element,
  version,
  kind: "verification",
  method: "test",
  item: "build-700",
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

describe("evidence.withoutPassedTest (SR-120)", () => {
  it("[SR-120/AK2] evidence.withoutPassedTest lists exactly the requirements without a passed test execution", async () => {
    const out = await run(await open());
    expect([shortIds(out), out.total, out.view, out.incomplete]).toEqual([LISTED, 5, "core", false]);
    // Not listed: b01 (failed, then passed), b03 (passed, older version), b08, b09 (passed), b10
    // (obsolete, D-044) and the need N-126a01.
    for (const id of ["01", "03", "08", "09", "10"]) {
      expect(out.elements.map((e) => e.id)).not.toContain(B(id));
    }
    expect(out.elements.map((e) => e.id)).not.toContain(U("a01"));
  });

  it("[SR-120/AK2] a skipped JUnit test case is no passed test execution", async () => {
    const out = await run(await open());
    const gusts = out.elements.find((e) => e.id === B("04"));
    expect(gusts?.verification).toEqual([{ view: "core", status: "open" }]);
  });

  it("[SR-120/AK2] a requirement stays out after a passed test also when a newer run failed (a regression)", async () => {
    const workspace = await open();
    const version = await versionOf(workspace, B("06"));
    await addRecords(workspace, [
      test(B("06"), version, { date: "2026-10-27T10:00:00Z" }),
      test(B("06"), version, { result: "failed" }),
    ]);
    const out = await run(workspace);
    expect(shortIds(out)).toEqual(["SR-126b02", "SR-126b04", "SR-126b05", "SR-126b07"]);
    // Its verification status is failed (SR-031): the list is not the filter `verification: failed`.
    const status = (await invoke(
      "evidence.status",
      { selection: { ids: [B("06")] } },
      { workspace },
    )) as CommandOutput<"evidence.status">;
    expect(status.elements[0]?.verification).toEqual([{ view: "core", status: "failed" }]);
  });

  it("is a read command the command prompt runs without asking: a title and no required input", async () => {
    const entry = getCommandRuntime().contracts.commands.find((c) => c.name === COMMAND);
    expect(entry?.effect).toBe("read");
    expect(entry?.title).toBe("List requirements without passed/no test");
    expect((entry?.input as { required?: unknown }).required).toBeUndefined();
    expect(shortIds(await run(await open(), {}))).toEqual(LISTED);
  });

  it("gives each row as evidence.status gives it", async () => {
    const workspace = await open();
    const out = await run(workspace);
    const status = (await invoke(
      "evidence.status",
      { selection: { ids: out.elements.map((e) => e.id) } },
      { workspace },
    )) as CommandOutput<"evidence.status">;
    expect(out.elements).toEqual(status.elements);
  });

  it("lists exactly the requirements evidence.degree counts that have no passed test in evidence.list", async () => {
    const workspace = await open();
    const out = await run(workspace);
    const degree = (await invoke("evidence.degree", {}, { workspace })) as CommandOutput<"evidence.degree">;
    const counted = ["01", "02", "03", "04", "05", "06", "07", "08", "09"].map(B);
    expect(degree.degree.total).toBe(counted.length);
    for (const id of counted) {
      const list = (await invoke(
        "evidence.list",
        { ref: id, view: "core" },
        { workspace },
      )) as CommandOutput<"evidence.list">;
      const passed = list.records.some(
        (r) => r.kind === "verification" && r.method === "test" && r.result === "passed",
      );
      expect([id, out.elements.some((e) => e.id === id)]).toEqual([id, !passed]);
    }
  });

  it("names the missing children its rows give by UUID (#588)", async () => {
    const workspace = await open();
    expect((await run(workspace)).names).toBeUndefined();
    // b08 fails after its passed run: b07 is listed open, missing b08, and b08 stays out (it passed once).
    await addRecords(workspace, [
      test(B("08"), await versionOf(workspace, B("08")), { result: "failed", date: "2026-10-29T10:00:00Z" }),
    ]);
    const out = await run(workspace);
    expect(shortIds(out)).toEqual(LISTED);
    expect(out.elements.find((e) => e.id === B("07"))?.verification).toEqual([
      { view: "core", status: "open", missingChildren: [B("08")] },
    ]);
    expect(out.names?.map((n) => n.shortId)).toEqual(["SR-126b08"]);
  });

  it("gives one page with the total of the whole list", async () => {
    const out = await run(await open(), { limit: 2, offset: 2 });
    expect([shortIds(out), out.total]).toEqual([["SR-126b05", "SR-126b06"], 5]);
  });

  it("orders by type, then identifier (digit runs as numbers), then short ID, as the app's lists", async () => {
    const workspace = await open({ fixture: "enabler-418/natural" });
    const out = await run(workspace);
    const list = (await invoke(
      "element.list",
      {
        selection: { where: { type: ["system-requirement"] } },
        sort: [{ by: "type" }, { by: "identifier" }],
      },
      { workspace },
    )) as CommandOutput<"element.list">;
    expect(out.elements.map((e) => e.id)).toEqual(list.elements.map((e) => e.id));
    expect(out.elements.map((e) => e.identifier)).toEqual(
      expect.arrayContaining(["SR-2", "SR-9", "SR-10", "SR-100"]),
    );
  });

  it("counts records in the view: a variant's record there, a core record in the core (SR-047)", async () => {
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
      "title: Show the gust warning",
      "validity:",
      `  - { id: ${V}, title: Pro }`,
      "---",
      "",
      "Valid only in Pro.",
      "",
    ];
    const workspace = await open({
      ...MATRIX,
      files: {
        "variants/VAR-000000126c01.md": variant.join("\n"),
        "requirements/SR-000000126b31.md": rv.join("\n"),
      },
    });
    await addRecords(workspace, [
      test(RV, await versionOf(workspace, RV), { variant: V }),
      test(B("06"), await versionOf(workspace, B("06")), { variant: V }),
    ]);
    // The core: RV does not apply; b06's record holds only in Pro.
    expect(shortIds(await run(workspace))).toEqual(LISTED);
    // Pro: RV and b06 have a passed test there; b01, b03, b08 and b09 have theirs only in the core.
    const pro = await run(workspace, { view: "VAR-126c01" });
    expect(pro.view).toBe(V);
    expect(shortIds(pro)).toEqual([
      "SR-126b01",
      "SR-126b02",
      "SR-126b03",
      "SR-126b04",
      "SR-126b05",
      "SR-126b07",
      "SR-126b08",
      "SR-126b09",
    ]);
    expect((await run(workspace, { view: "core" })).view).toBe("core");
  });

  it("lists every requirement while the metamodel is not valid, as evidence.status gives them open", async () => {
    const workspace = await open({ ...MATRIX, files: { "metamodel/broken.yaml": "properties: [\n" } });
    const out = await run(workspace);
    expect(out.total).toBe(9);
    expect(out.elements.every((e) => e.verification?.[0]?.status === "open")).toBe(true);
  });

  it("[SR-006/AK2] is incomplete when a repository of the workspace is not available", async () => {
    const file = await edited("logreq-workspace.yaml", (text) =>
      text.replace(
        "main: true }",
        'main: true }\n  - { name: other, url: "git@git.example.com:ws/other.git" }',
      ),
    );
    const out = await run(await open({ ...MATRIX, files: { "logreq-workspace.yaml": file } }));
    expect([shortIds(out), out.incomplete]).toEqual([LISTED, true]);
  });

  it("is incomplete when an evidence location lies in a repository that is not available", async () => {
    const file = await edited(
      "logreq-workspace.yaml",
      (text) =>
        `${text.replace("main: true }", 'main: true }\n  - { name: vault, url: "git@git.example.com:ws/vault.git" }')}  - { repository: vault, path: results }\n`,
    );
    const out = await run(await open({ ...MATRIX, files: { "logreq-workspace.yaml": file } }));
    expect([shortIds(out), out.incomplete]).toEqual([LISTED, true]);
  });

  it("follows a new record: a requirement with a passed test drops out", async () => {
    const workspace = await open();
    expect(shortIds(await run(workspace))).toEqual(LISTED);
    await addRecords(workspace, [test(B("02"), await versionOf(workspace, B("02")))]);
    expect(shortIds(await run(workspace))).toEqual(LISTED.slice(1));
  });

  it("leaves every element's status as written (D-030)", async () => {
    const workspace = await open();
    const statuses = async (): Promise<unknown> =>
      (
        (await invoke("element.list", { limit: 1000 }, { workspace })) as CommandOutput<"element.list">
      ).elements.map((e) => [e.shortId, e.status]);
    const before = await statuses();
    await run(workspace);
    expect(await statuses()).toEqual(before);
  });

  it("refuses a view that is no variant, naming the field view", async () => {
    const error = await run(await open(), { view: "SR-126b01" }).then(
      () => undefined,
      (failure: unknown) => failure as { code?: unknown; details?: { fields?: unknown } },
    );
    expect([error?.code, error?.details?.fields]).toEqual(["input.invalid", ["view"]]);
  });
});
