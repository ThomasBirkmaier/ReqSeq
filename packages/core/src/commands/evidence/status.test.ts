// evidence.status and element.get show the verification status (SR-031) on fixtures/SR-031/status:
// one repository `system` with the standard model and an evidence location `evidence` (empty), the
// need N1, the system requirements B1 (no validity: the core and every variant), B2 (valid for the
// variant V1 only) and B3, and the variants V1 Pro and V2 Basic. Store order: needs, requirements,
// variants.
//
// The records are given through `evidenceRecordsState` (decision on #127, option 1): the readers of
// record files come with SR-028 (#40) and SR-093 (#105), which add the end-to-end tests with files.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceReadState, evidenceRecordsState } from "../../evidence/index.js";
import { elementStoreState } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.status">;
type Verification = Output["elements"][number]["verification"];

const P = "5e031a7d-2b4f-4c61-9d08-0";
const N1 = `${P}a0000000001`;
const B1 = `${P}b0000000001`;
const B2 = `${P}b0000000002`;
const B3 = `${P}b0000000003`;
const V1 = `${P}c0000000001`;
const V2 = `${P}c0000000002`;
const OLDER = "n1:0000000000000000";

const STATUS: FixtureOptions = { fixture: "SR-031/status" };

const open = async (options: FixtureOptions = STATUS): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** Gives `workspace` the evidence records `records`, in place of those of its files. */
const withRecords = async (workspace: Workspace, records: readonly EvidenceRecord[]): Promise<void> => {
  await workspace.replace(
    evidenceRecordsState,
    workspace.get(evidenceRecordsState),
    Promise.resolve(records),
  );
};

const status = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("evidence.status", input, { workspace })) as Output;

/** The verification of each element of `output` by UUID; undefined for one without. */
const byId = (output: Output): Record<string, Verification> =>
  Object.fromEntries(output.elements.map((e) => [e.id, e.verification]));

/** The current version of `id`, as element.get shows it. */
const versionOf = async (workspace: Workspace, id: string): Promise<string> => {
  const out = (await invoke("element.get", { ref: id }, { workspace })) as CommandOutput<"element.get">;
  return String(out.element.version);
};

const record = (
  element: string,
  version: string,
  date: string,
  result: EvidenceRecord["result"],
  more: Partial<EvidenceRecord> = {},
): EvidenceRecord => ({
  element,
  version,
  kind: "verification",
  method: "test",
  item: "build-1",
  result,
  date,
  ...more,
});

const ALL_OPEN = {
  [N1]: undefined,
  [B1]: [
    { view: "core", status: "open" },
    { view: V1, status: "open" },
    { view: V2, status: "open" },
  ],
  [B2]: [{ view: V1, status: "open" }],
  [B3]: [
    { view: "core", status: "open" },
    { view: V1, status: "open" },
    { view: V2, status: "open" },
  ],
  [V1]: undefined,
  [V2]: undefined,
};

describe("evidence.status (SR-031)", () => {
  it("[SR-031/AK1] evidence.status gives open for every requirement of a selection without records", async () => {
    const ws = await open();
    const out = await status(ws);
    expect(out.elements.map((e) => e.id)).toEqual([N1, B1, B2, B3, V1, V2]);
    expect(byId(out)).toEqual(ALL_OPEN);
    expect(out.total).toBe(6);
    expect(out.incomplete).toBe(false);
    // The element's own status is shown as written, never the computed one (D-030).
    expect(out.elements.map((e) => e.status)).toEqual([
      "approved",
      "draft",
      "draft",
      "approved",
      "draft",
      "draft",
    ]);
  });

  it("[SR-031/AK1] a requirement whose records name other elements stays open", async () => {
    const ws = await open();
    await withRecords(ws, [record(B1, await versionOf(ws, B1), "2026-01-01T10:00:00Z", "passed")]);
    const out = byId(await status(ws, { selection: { ids: [B3] } }));
    expect(out).toEqual({ [B3]: ALL_OPEN[B3] });
  });

  it("[SR-031/AK2] evidence.status gives verified when the newest record of the current version passed", async () => {
    const ws = await open();
    const b1 = await versionOf(ws, B1);
    await withRecords(ws, [
      record(B1, b1, "2026-01-01T10:00:00Z", "failed"),
      record(B1, b1, "2026-01-02T10:00:00Z", "passed"),
    ]);
    expect(byId(await status(ws, { selection: { ids: [B1] } }))[B1]).toEqual([
      { view: "core", status: "verified" },
      { view: V1, status: "open" },
      { view: V2, status: "open" },
    ]);
  });

  it("[SR-031/AK3] evidence.status gives failed when the newest record of the current version failed", async () => {
    const ws = await open();
    const b3 = await versionOf(ws, B3);
    await withRecords(ws, [
      record(B3, b3, "2026-01-01T10:00:00Z", "passed"),
      record(B3, b3, "2026-01-02T10:00:00Z", "failed"),
      record(B3, OLDER, "2026-01-03T10:00:00Z", "passed"),
    ]);
    expect(byId(await status(ws, { selection: { ids: [B3] } }))[B3]).toEqual([
      { view: "core", status: "failed" },
      { view: V1, status: "open" },
      { view: V2, status: "open" },
    ]);
  });

  it("[SR-031/AK4] evidence.status gives outdated when there are only records of older versions", async () => {
    const ws = await open();
    await withRecords(ws, [
      record(B1, OLDER, "2026-01-01T10:00:00Z", "passed"),
      record(B2, OLDER, "2026-01-01T10:00:00Z", "failed", { variant: V1 }),
    ]);
    const out = byId(await status(ws));
    expect(out[B1]).toEqual([
      { view: "core", status: "outdated" },
      { view: V1, status: "open" },
      { view: V2, status: "open" },
    ]);
    expect(out[B2]).toEqual([{ view: V1, status: "outdated" }]);
  });

  it("[SR-031/AK2] element.get shows the verification status of the core and of each variant", async () => {
    const ws = await open();
    const [b1, b2] = [await versionOf(ws, B1), await versionOf(ws, B2)];
    await withRecords(ws, [
      record(B1, b1, "2026-01-01T10:00:00Z", "passed"),
      record(B1, b1, "2026-01-01T10:00:00Z", "failed", { variant: V2 }),
      record(B2, b2, "2026-01-01T10:00:00Z", "passed", { variant: V1 }),
      // A record for a variant B2 does not apply in counts nowhere (SR-040).
      record(B2, b2, "2026-01-02T10:00:00Z", "failed"),
    ]);
    const get = async (ref: string): Promise<CommandOutput<"element.get">["element"]> =>
      ((await invoke("element.get", { ref }, { workspace: ws })) as CommandOutput<"element.get">).element;
    const [n1, shownB1, shownB2] = [await get(N1), await get(B1), await get(B2)];
    expect(shownB1.verification).toEqual([
      { view: "core", status: "verified" },
      { view: V1, status: "open" },
      { view: V2, status: "failed" },
    ]);
    expect(shownB1.status).toBe("draft");
    expect(shownB2.verification).toEqual([{ view: V1, status: "verified" }]);
    expect(n1.verification).toBeUndefined();
    // A need has a validation status (SR-038, open without record, #534), never a verification status.
    expect(n1.validation).toBe("open");
    // element.resolve shows the element as element.get does, with the same status.
    const resolved = (await invoke(
      "element.resolve",
      { ref: B1 },
      { workspace: ws },
    )) as CommandOutput<"element.resolve">;
    expect(resolved.element.verification).toEqual(shownB1.verification);
    // The same as evidence.status gives (SR-080).
    expect(byId(await status(ws, { selection: { ids: [B1, B2] } }))).toEqual({
      [B1]: shownB1.verification,
      [B2]: shownB2.verification,
    });
  });

  it("validation records do not count for the verification status (D-007)", async () => {
    const ws = await open();
    const b1 = await versionOf(ws, B1);
    await withRecords(ws, [
      record(B1, b1, "2026-01-01T10:00:00Z", "passed"),
      record(B1, b1, "2026-01-02T10:00:00Z", "failed", { kind: "validation" }),
    ]);
    expect(byId(await status(ws, { selection: { ids: [B1] } }))[B1]?.[0]).toEqual({
      view: "core",
      status: "verified",
    });
  });

  it("[SR-031/AK4] a passed record becomes outdated when the requirement's file changes", async () => {
    const fixture = await createFixtureWorkspace(STATUS);
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    await withRecords(ws, [record(B3, await versionOf(ws, B3), "2026-01-01T10:00:00Z", "passed")]);
    expect(byId(await status(ws, { selection: { ids: [B3] } }))[B3]?.[0]?.status).toBe("verified");
    const file = "requirements/SR-0b0000000003.md";
    const text = await fs.readFile(fixture.path(file), "utf8");
    await fixture.write(file, text.replace("comes from.", "comes from, in degrees."));
    // The watcher does this in the app; the records stay as they were given.
    await ws.reset(elementStoreState);
    expect(byId(await status(ws, { selection: { ids: [B3] } }))[B3]?.[0]?.status).toBe("outdated");
    const shown = (await invoke(
      "element.get",
      { ref: B3 },
      { workspace: ws },
    )) as CommandOutput<"element.get">;
    expect(shown.element.verification?.[0]).toEqual({ view: "core", status: "outdated" });
  });

  it("[SR-093/AK3] a skipped JUnit test case does not count as passed for the verification status", async () => {
    const fixture = await createFixtureWorkspace(STATUS);
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    const b1 = await versionOf(ws, B1);
    const b3 = await versionOf(ws, B3);
    const testCase = (name: string, element: string, version: string, date: string, body = ""): string =>
      `    <testcase classname="tests.Wind" name="${name}"><properties>` +
      `<property name="logreq:element" value="${element}"/><property name="logreq:version" value="${version}"/>` +
      `<property name="logreq:item" value="build-7"/><property name="logreq:date" value="${date}"/>` +
      `</properties>${body}</testcase>\n`;
    // B1: a skipped test case of its current version, newer than a passed one of an older version.
    // B3: only a skipped test case of its current version.
    await fixture.write(
      "evidence/ci/results.xml",
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="tests.Wind" tests="3" skipped="2">\n' +
        testCase("shows the speed", B1, OLDER, "2026-01-01T10:00:00Z") +
        testCase("shows the speed again", B1, b1, "2026-01-02T10:00:00Z", "<skipped/>") +
        testCase("shows the direction", B3, b3, "2026-01-02T10:00:00Z", "<skipped/>") +
        "</testsuite>\n",
    );
    // The watcher of evidence files (E3) does this in the app; element.get above read the folder empty.
    await ws.reset(evidenceReadState);
    const read = await ws.get(evidenceReadState);
    expect(read.records.map((r) => [r.element, r.version, r.result])).toEqual([[B1, OLDER, "passed"]]);
    expect(read.skipped.map((t) => t.elements)).toEqual([[B1], [B3]]);
    const out = byId(await status(ws, { selection: { ids: [B1, B3] } }));
    expect([out[B1]?.[0], out[B3]?.[0]]).toEqual([
      { view: "core", status: "outdated" },
      { view: "core", status: "open" },
    ]);
  });

  it("gives one page of the selection with the total of the whole selection", async () => {
    const ws = await open();
    const page = await status(ws, { limit: 2, offset: 1 });
    expect(page.elements.map((e) => e.id)).toEqual([B1, B2]);
    expect(page.total).toBe(6);
    const filtered = await status(ws, { selection: { where: { type: ["system-requirement"] }, view: V1 } });
    expect(filtered.elements.map((e) => e.id)).toEqual([B1, B2, B3]);
    expect((await status(ws, { offset: 6 })).elements).toEqual([]);
  });

  it("is incomplete when a repository of the workspace is not available", async () => {
    const ws = await open({
      ...STATUS,
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          '  - { name: results, url: "git@git.example.com:ws/results.git" }\n' +
          "metamodel: { repository: system, path: metamodel }\n" +
          "evidence:\n  - { repository: results, path: evidence }\n",
      },
    });
    const out = await status(ws, { selection: { ids: [B1] } });
    expect(out.incomplete).toBe(true);
    expect(out.elements[0]?.verification?.[0]).toEqual({ view: "core", status: "open" });
  });

  it("compares no records while the metamodel is not valid: every requirement is open", async () => {
    const ws = await open({ ...STATUS, files: { "metamodel/broken.yaml": "properties: [\n" } });
    const state = (await invoke(
      "workspace.status",
      {},
      { workspace: ws },
    )) as CommandOutput<"workspace.status">;
    expect(state.metamodel.valid).toBe(false);
    await withRecords(ws, [record(B1, OLDER, "2026-01-01T10:00:00Z", "failed")]);
    expect(byId(await status(ws, { selection: { ids: [B1] } }))[B1]?.[0]).toEqual({
      view: "core",
      status: "open",
    });
    const listed = (await invoke(
      "element.list",
      { selection: { where: { verification: ["open"] } } },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect(listed.elements.map((e) => e.id)).toEqual([B1, B3]);
    const withEvidence = (await invoke(
      "element.list",
      { selection: { where: { relation: { direction: "evidence" }, exists: true } } },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect(withEvidence.elements).toEqual([]);
  });

  it("the filter conditions verification and evidence use the records (SR-069 AK1, AK3)", async () => {
    const ws = await open();
    const [b1, b3] = [await versionOf(ws, B1), await versionOf(ws, B3)];
    await withRecords(ws, [
      record(B1, b1, "2026-01-01T10:00:00Z", "passed"),
      record(B2, OLDER, "2026-01-01T10:00:00Z", "passed", { variant: V1 }),
      record(B3, b3, "2026-01-01T10:00:00Z", "failed"),
      record(N1, OLDER, "2026-01-01T10:00:00Z", "passed", { kind: "validation" }),
    ]);
    const ids = async (where: unknown, view?: string): Promise<string[]> =>
      (
        (await invoke(
          "element.list",
          { selection: { where, ...(view === undefined ? {} : { view }) } },
          { workspace: ws },
        )) as CommandOutput<"element.list">
      ).elements.map((e) => e.id);
    expect(await ids({ verification: ["verified"] })).toEqual([B1]);
    expect(await ids({ verification: ["failed"] })).toEqual([B3]);
    expect(await ids({ verification: ["outdated"], variant: V1 })).toEqual([B2]);
    expect(await ids({ verification: ["open"] }, V1)).toEqual([B1, B3]);
    // Without evidence: no verification record in the view; a validation record is none (D-007).
    const noEvidence = { relation: { direction: "evidence" }, exists: false };
    expect(await ids({ all: [{ type: ["system-requirement"] }, noEvidence] })).toEqual([B2]);
    expect(await ids({ all: [{ type: ["system-requirement"] }, noEvidence] }, V1)).toEqual([B1, B3]);
    expect(await ids({ relation: { direction: "evidence" }, exists: true })).toEqual([B1, B3]);
    expect(await ids({ verification: ["verified"] })).toEqual([B1]);
  });
});
