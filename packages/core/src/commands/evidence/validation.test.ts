// evidence.status, element.get, element.resolve and the filter show the validation status (SR-038) on
// fixtures/SR-038/validation (its README lists every element, its records and the expected status):
// one repository `system` with the standard model and Markdown records in `evidence`, no variants.
// The records come from the record files of the fixture; one test gives them through
// `evidenceRecordsState` instead (decision on #127).
import type { FixtureOptions } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState, verificationState } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.status">;
type Element = Output["elements"][number];

const U = (tail: string): string => `38383838-3838-4838-8838-00000000${tail}`;
const N1 = U("a001");
const N2 = U("a002");
const N3 = U("a003");
const N4 = U("a004");
const N5 = U("a005");
const N6 = U("a006");
const S1 = U("b001");
const S2 = U("b002");
const U1 = U("e001");

const VALIDATION: FixtureOptions = { fixture: "SR-038/validation" };

const open = async (options: FixtureOptions = VALIDATION): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const status = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("evidence.status", input, { workspace })) as Output;

const get = async (workspace: Workspace, ref: string): Promise<CommandOutput<"element.get">> =>
  (await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">;

/** Validation and verification of each element by UUID. */
const statuses = (elements: readonly Element[]): Record<string, readonly unknown[]> =>
  Object.fromEntries(elements.map((e) => [e.id, [e.validation, e.verification]]));

const where = async (workspace: Workspace, condition: unknown): Promise<string[]> =>
  (
    (await invoke(
      "element.list",
      { selection: { where: condition } },
      { workspace },
    )) as CommandOutput<"element.list">
  ).elements.map((e) => e.id);

const core = (status: string): unknown => [{ view: "core", status }];

/** What the fixture gives from its record files (its README). */
const FROM_FILES: Record<string, readonly unknown[]> = {
  [N1]: ["validated", undefined],
  [N2]: ["failed", undefined],
  [N3]: ["outdated", undefined],
  [N4]: ["open", undefined],
  [N5]: ["failed", undefined],
  [N6]: ["validated", undefined],
  [S1]: ["validated", core("failed")],
  [S2]: [undefined, core("verified")],
  [U1]: ["failed", undefined],
};

describe("validation status in element.get, element.resolve, evidence.status and the filter (SR-038)", () => {
  it("[SR-038/AK1] element.get shows the validation status of a need with a validation of the current version, apart from the verification status", async () => {
    const ws = await open();
    const need = (await get(ws, N1)).element;
    // N1 also has a failed verification record: a need has no verification status (D-012).
    expect([need.validation, need.verification]).toEqual(["validated", undefined]);
    const requirement = (await get(ws, S1)).element;
    expect([requirement.validation, requirement.verification]).toEqual(["validated", core("failed")]);
  });

  it("[SR-038/AK1] element.resolve shows the validation status as element.get does", async () => {
    const ws = await open();
    const out = (await invoke(
      "element.resolve",
      { ref: N1 },
      { workspace: ws },
    )) as CommandOutput<"element.resolve">;
    expect([out.element.validation, out.element.verification]).toEqual(["validated", undefined]);
    const s1 = (await invoke(
      "element.resolve",
      { ref: S1 },
      { workspace: ws },
    )) as CommandOutput<"element.resolve">;
    expect([s1.element.validation, s1.element.verification]).toEqual(["validated", core("failed")]);
  });

  it("[SR-038/AK2] element.get gives outdated for a need validated on an older version", async () => {
    const out = (await get(await open(), N3)).element;
    expect(out.validation).toBe("outdated");
    expect(out.problems?.map((p) => p.code)).toEqual(["evidence.outdated"]);
  });

  it("[SR-038/AK2] a validated need becomes outdated when its file changes", async () => {
    const ws = await open();
    expect((await get(ws, N1)).element.validation).toBe("validated");
    await invoke("element.update", { ref: N1, text: "Changed after the validation.\n" }, { workspace: ws });
    expect((await get(ws, N1)).element.validation).toBe("outdated");
    expect(await where(ws, { validation: ["outdated"] })).toEqual([N1, N3]);
  });

  it("[SR-038/AK3] evidence.status gives open, validated, failed and outdated by the newest record of the current version", async () => {
    const out = await status(await open());
    expect(statuses(out.elements)).toEqual(FROM_FILES);
    expect(out.total).toBe(9);
  });

  it("[SR-038/AK3] the filter condition validation finds the elements by their computed status", async () => {
    const ws = await open();
    expect(await where(ws, { validation: ["validated"] })).toEqual([N1, N6, S1]);
    expect(await where(ws, { validation: ["failed"] })).toEqual([N2, N5, U1]);
    expect(await where(ws, { validation: ["outdated"] })).toEqual([N3]);
    expect(await where(ws, { validation: ["open"] })).toEqual([N4]);
  });

  it("element.get of a validated need shows the hint of a newer record of an older version (SR-025 AK4)", async () => {
    const out = (await get(await open(), N6)).element;
    expect(out.validation).toBe("validated");
    expect(out.problems?.map((p) => p.code)).toEqual(["evidence.outdated"]);
  });

  it("gives the status from records given through evidenceRecordsState too", async () => {
    const ws = await open();
    const version = (await get(ws, N4)).element.version;
    const record: EvidenceRecord = {
      element: N4,
      version: String(version),
      kind: "validation",
      result: "failed",
      date: "2026-10-27T10:00:00Z",
    };
    await ws.replace(evidenceRecordsState, ws.get(evidenceRecordsState), Promise.resolve([record]));
    expect(statuses((await status(ws, { selection: { ids: [N1, N4, S1] } })).elements)).toEqual({
      [N1]: ["open", undefined],
      [N4]: ["failed", undefined],
      [S1]: [undefined, core("open")],
    });
  });

  it("a need whose only validation record has a variant is open, and the record stays visible in its hint (#534 Q2)", async () => {
    const record = [
      "---",
      "logreq-record: 1",
      "kind: validation",
      `element: ${N4}`,
      "version: n1:0000000000000000",
      `variant: ${U("c001")}`,
      "result: passed",
      "date: 2026-10-27T10:00:00Z",
      "---",
      "",
    ].join("\n");
    const ws = await open({ ...VALIDATION, files: { "evidence/2026-10-27-N-00a004-validation.md": record } });
    const out = (await get(ws, N4)).element;
    expect(out.validation).toBe("open");
    expect(out.problems?.map((p) => p.code)).toEqual(["evidence.outdated"]);
  });

  it("compares nothing while the metamodel is not valid: every need is open, no other element has a validation status", async () => {
    const ws = await open({ ...VALIDATION, files: { "metamodel/broken.yaml": "properties: [\n" } });
    const out = statuses((await status(ws, { selection: { ids: [N1, N4, S1, U1] } })).elements);
    expect(out).toEqual({
      [N1]: ["open", undefined],
      [N4]: ["open", undefined],
      [S1]: [undefined, core("open")],
      [U1]: [undefined, undefined],
    });
  });

  it("shows every element's own status as written (D-030) and a validation record gives no evidence (D-007)", async () => {
    const ws = await open();
    const out = await status(ws);
    expect(Object.fromEntries(out.elements.map((e) => [e.id, e.status]))).toEqual({
      [N1]: "approved",
      [N2]: "approved",
      [N3]: "approved",
      [N4]: "draft",
      [N5]: "approved",
      [N6]: "approved",
      [S1]: "approved",
      [S2]: "draft",
      [U1]: "approved",
    });
    // Only verification records point as evidence (N1, S1, S2 have one); validation records never (N2 … U1).
    expect(await where(ws, { relation: { direction: "evidence" }, exists: true })).toEqual([N1, S1, S2]);
  });

  it("element.get of a need and an evidence.status page read no version batch of their own (N-036)", async () => {
    const ws = await open();
    await get(ws, N1);
    await status(ws, { selection: { ids: [N1, N2, N3] } });
    expect((await ws.get(verificationState)).versionBatches()).toBe(0);
  });
});
