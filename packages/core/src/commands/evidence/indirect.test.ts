// evidence.status, element.get and the filter show the indirect verification (SR-034) on
// fixtures/SR-034/indirect (its README lists every element, its parent and its record): one
// repository `system` with the standard model and Markdown records in `evidence`, no variants.
// The records come from the record files of the fixture, so the versions they name are those of the
// element files; one test gives them through `evidenceRecordsState` instead (decision on #127).
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureOptions } from "@logreq/testkit";
import { createFixtureWorkspace, defaultFixturesDir } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState, verificationState } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.status">;
type Verification = Output["elements"][number]["verification"];

const U = (tail: string): string => `34343434-3434-4434-8434-00000000${tail}`;
const N1 = U("a001");
const G = U("b100");
const P1 = U("b110");
const C11 = U("b111");
const C12 = U("b112");
const C41 = U("b141");
const P2 = U("b120");
const C21 = U("b121");
const C22 = U("b122");
const C23 = U("b123");
const C24 = U("b124");
const P3 = U("b130");
const C31 = U("b131");
const C32 = U("b132");
const P5 = U("b150");
const C51 = U("b151");
const P6 = U("b160");
const C61 = U("b161");
const U1 = U("e161");
const V1 = U("c001");

const INDIRECT: FixtureOptions = { fixture: "SR-034/indirect" };
const METAMODEL = "metamodel/standard-model.yaml";

const open = async (options: FixtureOptions = INDIRECT): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** A file of the fixture with `edit` applied, to write on top of it. */
const edited = async (file: string, edit: (text: string) => string): Promise<string> =>
  edit(await fs.readFile(path.join(defaultFixturesDir, "SR-034/indirect", file), "utf8"));

const status = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("evidence.status", input, { workspace })) as Output;

/** The verification of each element of `output` by UUID; undefined for one without. */
const byId = (output: Output): Record<string, Verification> =>
  Object.fromEntries(output.elements.map((e) => [e.id, e.verification]));

const get = async (workspace: Workspace, ref: string): Promise<CommandOutput<"element.get">> =>
  (await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">;

const core = (status: string, missingChildren?: readonly string[]): Verification =>
  [{ view: "core", status, ...(missingChildren === undefined ? {} : { missingChildren }) }] as Verification;

/** What the fixture gives from its record files (its README). */
const FROM_FILES: Record<string, Verification> = {
  [N1]: undefined,
  [G]: core("indirect"),
  [P1]: core("indirect"),
  [C11]: core("verified"),
  [C12]: core("verified"),
  [P2]: core("open", [C21, C22, C23]),
  [C21]: core("failed"),
  [C22]: core("open"),
  [C23]: core("outdated"),
  [C24]: core("verified"),
  [P3]: core("indirect"),
  [C31]: core("verified"),
  [C32]: core("open"),
  [C41]: core("verified"),
  [P5]: core("outdated"),
  [C51]: core("verified"),
  [P6]: core("open"),
  [C61]: core("open"),
  [U1]: undefined,
};

describe("indirect verification in evidence.status, element.get and the filter (SR-034)", () => {
  it("[SR-034/AK1] evidence.status gives indirect for a parent whose children have passed records of their current version", async () => {
    const out = byId(await status(await open(), { selection: { ids: [G, P1] } }));
    expect(out).toEqual({ [G]: core("indirect"), [P1]: core("indirect") });
  });

  it("[SR-034/AK1] element.get shows indirect for a parent without own record", async () => {
    const ws = await open();
    expect((await get(ws, P1)).element.verification).toEqual(core("indirect"));
    expect((await get(ws, G)).element.verification).toEqual(core("indirect"));
  });

  it("[SR-034/AK1] a filter on verification indirect finds the indirectly verified parents", async () => {
    const ws = await open();
    const listed = (await invoke(
      "element.list",
      { selection: { where: { verification: ["indirect"] } } },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect(listed.elements.map((e) => e.id)).toEqual([G, P1, P3]);
    const open_ = (await invoke(
      "element.list",
      { selection: { where: { verification: ["open"] } } },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect(open_.elements.map((e) => e.id)).toEqual([P2, C22, C32, P6, C61]);
  });

  it("[SR-034/AK2] evidence.status names the missing children of a parent", async () => {
    const out = byId(await status(await open(), { selection: { ids: [P2] } }));
    expect(out).toEqual({ [P2]: core("open", [C21, C22, C23]) });
  });

  it("[SR-034/AK2] a child valid only for a variant is missing in that variant and does not count in the core", async () => {
    const variant = [
      "---",
      `id: ${V1}`,
      "type: variant",
      "status: draft",
      "title: Pro",
      "---",
      "",
      "The station for professionals.",
      "",
    ].join("\n");
    // C12 applies only in V1; its record holds only in the core.
    const c12 = await edited("requirements/SR-00000000b112.md", (text) =>
      text.replace("derives-from:", `validity:\n  - { id: ${V1}, title: Pro }\nderives-from:`),
    );
    const ws = await open({
      ...INDIRECT,
      files: { "variants/VAR-00000000c001.md": variant, "requirements/SR-00000000b112.md": c12 },
    });
    const out = byId(await status(ws, { selection: { ids: [P1, C11] } }));
    expect(out).toEqual({
      [P1]: [
        { view: "core", status: "indirect" },
        { view: V1, status: "open", missingChildren: [C11, C12] },
      ],
      [C11]: [
        { view: "core", status: "verified" },
        { view: V1, status: "open" },
      ],
    });
  });

  it("[SR-034/AK3] evidence.status does not count a child with status obsolete", async () => {
    const out = byId(await status(await open(), { selection: { ids: [P3, C32] } }));
    expect(out).toEqual({ [P3]: core("indirect"), [C32]: core("open") });
  });

  it("[SR-034/AK3] the invalid flag of the metamodel decides, not the status key", async () => {
    const metamodel = await edited(METAMODEL, (text) =>
      text.replace(
        "  - { key: obsolete, name: Obsolete, invalid: true }",
        "  - { key: obsolete, name: Obsolete }\n  - { key: withdrawn, name: Withdrawn, invalid: true }",
      ),
    );
    const c31 = await edited("requirements/SR-00000000b131.md", (text) =>
      text.replace("status: draft", "status: withdrawn"),
    );
    const ws = await open({
      ...INDIRECT,
      files: { [METAMODEL]: metamodel, "requirements/SR-00000000b131.md": c31 },
    });
    // C31 (withdrawn, invalid) does not count, C32 (obsolete, now valid) counts and has no record.
    expect(byId(await status(ws, { selection: { ids: [P3] } }))).toEqual({ [P3]: core("open", [C32]) });
  });

  it("gives every element of the fixture its status from the record files, the own status as written (D-030)", async () => {
    const ws = await open();
    const out = await status(ws);
    expect(byId(out)).toEqual(FROM_FILES);
    expect(out.total).toBe(19);
    expect(out.incomplete).toBe(false);
    const own = Object.fromEntries(out.elements.map((e) => [e.id, e.status]));
    expect([own[C32], own[C61], own[P1], own[C12]]).toEqual(["obsolete", "obsolete", "approved", "draft"]);
    for (const element of out.elements) {
      expect((await get(ws, element.id)).element.verification).toEqual(FROM_FILES[element.id]);
    }
  });

  it("gives the same status with records given through evidenceRecordsState", async () => {
    const ws = await open();
    const [c11, c12] = [(await get(ws, C11)).element.version, (await get(ws, C12)).element.version];
    const record = (
      element: string,
      version: string | undefined,
      result: EvidenceRecord["result"],
    ): EvidenceRecord => ({
      element,
      version: String(version),
      kind: "verification",
      method: "test",
      item: "build-1",
      result,
      date: "2026-10-27T10:00:00Z",
    });
    await ws.replace(
      evidenceRecordsState,
      ws.get(evidenceRecordsState),
      Promise.resolve([record(C11, c11, "passed"), record(C12, c12, "failed")]),
    );
    expect(byId(await status(ws, { selection: { ids: [G, P1] } }))).toEqual({
      [G]: core("open", [P1, C41]),
      [P1]: core("open", [C12]),
    });
  });

  it("names a child once its file changed: its record is of an older version now", async () => {
    const c11 = await edited("requirements/SR-00000000b111.md", (text) =>
      text.replace("Passed record", "Changed: passed record"),
    );
    const ws = await open({ ...INDIRECT, files: { "requirements/SR-00000000b111.md": c11 } });
    expect(byId(await status(ws, { selection: { ids: [G, P1, C11] } }))).toEqual({
      [G]: core("open", [P1]),
      [P1]: core("open", [C11]),
      [C11]: core("outdated"),
    });
  });

  it("the shared state forgets a changed child and changed records within one open workspace (review of #581, S1)", async () => {
    const ws = await open();
    expect((await get(ws, G)).element.verification).toEqual(core("indirect"));
    expect((await get(ws, P1)).element.verification).toEqual(core("indirect"));
    const before = await ws.get(verificationState);
    await invoke("element.update", { ref: C11, text: "Changed text.\n" }, { workspace: ws });
    expect((await get(ws, P1)).element.verification).toEqual(core("open", [C11]));
    expect((await get(ws, G)).element.verification).toEqual(core("open", [P1]));
    const indirect = (await invoke(
      "element.list",
      { selection: { where: { verification: ["indirect"] } } },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect(indirect.elements.map((e) => e.id)).toEqual([P3]);
    const afterUpdate = await ws.get(verificationState);
    expect(afterUpdate).not.toBe(before);
    // Records given anew: C11 passed on its new version, C12 failed.
    const version = async (id: string): Promise<string> => String((await get(ws, id)).element.version);
    const record = (element: string, v: string, result: EvidenceRecord["result"]): EvidenceRecord => ({
      element,
      version: v,
      kind: "verification",
      method: "test",
      item: "build-2",
      result,
      date: "2026-10-28T10:00:00Z",
    });
    await ws.replace(
      evidenceRecordsState,
      ws.get(evidenceRecordsState),
      Promise.resolve([record(C11, await version(C11), "passed"), record(C12, await version(C12), "failed")]),
    );
    expect((await get(ws, P1)).element.verification).toEqual(core("open", [C12]));
    expect(await ws.get(verificationState)).not.toBe(afterUpdate);
  });

  it("a second element.get of the same parent reads no current version again (plan review B1)", async () => {
    const ws = await open();
    expect((await get(ws, G)).element.verification).toEqual(core("indirect"));
    const state = await ws.get(verificationState);
    expect(state.versionBatches()).toBe(1);
    expect((await get(ws, G)).element.verification).toEqual(core("indirect"));
    expect((await get(ws, P1)).element.verification).toEqual(core("indirect"));
    expect(state.versionBatches()).toBe(1);
    // A leaf with its own record is measured against the version shown: no batch either.
    expect((await get(ws, C11)).element.verification).toEqual(core("verified"));
    expect(state.versionBatches()).toBe(1);
  });

  it("computes from the children that are visible while a repository is not on this machine (SR-006)", async () => {
    const file = await edited("logreq-workspace.yaml", (text) =>
      text.replace(
        "main: true }",
        'main: true }\n  - { name: other, url: "git@git.example.com:ws/other.git" }',
      ),
    );
    const ws = await open({ ...INDIRECT, files: { "logreq-workspace.yaml": file } });
    const out = await status(ws, { selection: { ids: [P1] } });
    expect(out.incomplete).toBe(true);
    expect(byId(out)).toEqual({ [P1]: core("indirect") });
  });

  it("compares nothing while the metamodel is not valid: every requirement is open, no child is named", async () => {
    const ws = await open({ ...INDIRECT, files: { "metamodel/broken.yaml": "properties: [\n" } });
    const out = byId(await status(ws, { selection: { ids: [G, P2, C11] } }));
    expect(out).toEqual({ [G]: core("open"), [P2]: core("open"), [C11]: core("open") });
  });

  it("without a relation kind with the meaning derivation nothing is indirect and nothing fails", async () => {
    const metamodel = await edited(METAMODEL, (text) => text.replaceAll("    meaning: derivation\n", ""));
    const ws = await open({ ...INDIRECT, files: { [METAMODEL]: metamodel } });
    const out = byId(await status(ws, { selection: { ids: [G, P1, P2, C11] } }));
    expect(out).toEqual({
      [G]: core("open"),
      [P1]: core("open"),
      [P2]: core("open"),
      [C11]: core("verified"),
    });
  });
});
