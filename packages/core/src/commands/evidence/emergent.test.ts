// evidence.status, element.get, element.update and the filter with emergent requirements (SR-035) on
// fixtures/SR-035/emergent (its README lists every element, its mark, its parent and its record): one
// repository `system` with the standard model and Markdown records in `evidence`, no variants. The
// records come from the record files of the fixture; one test gives them through
// `evidenceRecordsState` instead (decision on #127). The pure rule is tested in evidence/indirect.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureOptions } from "@reqseq/testkit";
import { createFixtureWorkspace, defaultFixturesDir } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { EvidenceRecord } from "../../evidence/index.js";
import { evidenceRecordsState } from "../../evidence/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"evidence.status">;
type Verification = Output["elements"][number]["verification"];
type Got = CommandOutput<"element.get">;

const U = (tail: string): string => `35353535-3535-4535-8535-00000000${tail}`;
const N1 = U("a001");
const G = U("b100");
const E1 = U("b110");
const C11 = U("b111");
const C12 = U("b112");
const P1 = U("b120");
const C13 = U("b121");
const E2 = U("b130");
const C21 = U("b131");
const E3 = U("b140");
const C31 = U("b141");
const E4 = U("b150");
const EMERGENT = [E1, E2, E3, E4];

const FIXTURE: FixtureOptions = { fixture: "SR-035/emergent" };
const METAMODEL = "metamodel/standard-model.yaml";

const open = async (options: FixtureOptions = FIXTURE): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** A file of the fixture with `edit` applied, to write on top of it. */
const edited = async (file: string, edit: (text: string) => string): Promise<string> =>
  edit(await fs.readFile(path.join(defaultFixturesDir, "SR-035/emergent", file), "utf8"));

const status = async (workspace: Workspace, input: Readonly<Record<string, unknown>> = {}): Promise<Output> =>
  (await invoke("evidence.status", input, { workspace })) as Output;

const byId = (output: Output): Record<string, Verification> =>
  Object.fromEntries(output.elements.map((e) => [e.id, e.verification]));

const get = async (workspace: Workspace, ref: string): Promise<Got> =>
  (await invoke("element.get", { ref }, { workspace })) as Got;

const where = async (workspace: Workspace, condition: unknown): Promise<string[]> =>
  (
    (await invoke(
      "element.list",
      { selection: { where: condition }, limit: 5000 },
      { workspace },
    )) as CommandOutput<"element.list">
  ).elements.map((e) => e.id);

const update = async (
  workspace: Workspace,
  input: Readonly<Record<string, unknown>>,
): Promise<CommandOutput<"element.update">> =>
  (await invoke("element.update", input, { workspace })) as CommandOutput<"element.update">;

const core = (state: string, missingChildren?: readonly string[]): Verification =>
  [
    { view: "core", status: state, ...(missingChildren === undefined ? {} : { missingChildren }) },
  ] as Verification;

/** What the fixture gives from its record files (its README). */
const FROM_FILES: Record<string, Verification> = {
  [N1]: undefined,
  [G]: core("open", [E1]),
  [E1]: core("open"),
  [C11]: core("verified"),
  [C12]: core("verified"),
  [P1]: core("indirect"),
  [C13]: core("verified"),
  [E2]: core("verified"),
  [C21]: core("verified"),
  [E3]: core("outdated"),
  [C31]: core("verified"),
  [E4]: core("open"),
};

/** The UUIDs of the elements of `output` that carry `emergent: true`; no element carries `false`. */
const marked = (elements: readonly { id: string; emergent?: boolean }[]): string[] => {
  expect(elements.map((e) => e.emergent).filter((value) => value !== undefined && !value)).toEqual([]);
  return elements.filter((e) => e.emergent === true).map((e) => e.id);
};

/** The fixture with the property `emergent` of kind text: a misdefined mark (#591 Q1). */
const misdefined = async (): Promise<FixtureOptions> => ({
  ...FIXTURE,
  files: {
    [METAMODEL]: await edited(METAMODEL, (text) => {
      const definition = [
        "    kind: choice",
        "    meaning: emergent",
        "    choices:",
        '      - { key: "yes", name: "Yes" }',
        '      - { key: "no", name: "No" }',
        "",
      ].join("\n");
      expect(text).toContain(definition);
      return text.replace(definition, "    kind: text\n    meaning: emergent\n");
    }),
  },
});

describe("emergent requirements need their own record (SR-035)", () => {
  it("[SR-035/AK1] evidence.status gives open, not indirect, for an emergent requirement whose children are verified, and its parent names it missing", async () => {
    const out = await status(await open());
    expect(byId(out)).toEqual(FROM_FILES);
    expect(out.total).toBe(12);
  });

  it("[SR-035/AK1] element.get gives an emergent requirement the status of its own record", async () => {
    const ws = await open();
    expect((await get(ws, E2)).element.verification).toEqual(core("verified"));
    expect((await get(ws, E3)).element.verification).toEqual(core("outdated"));
    expect((await get(ws, E1)).element.verification).toEqual(core("open"));
  });

  it("[SR-035/AK1] marking a requirement emergent with element.update takes away its indirect verification", async () => {
    const ws = await open();
    expect((await get(ws, P1)).element.verification).toEqual(core("indirect"));
    expect(await where(ws, { verification: ["indirect"] })).toEqual([P1]);
    await update(ws, { ref: P1, set: { emergent: "yes" } });
    expect((await get(ws, P1)).element.verification).toEqual(core("open"));
    expect((await get(ws, G)).element.verification).toEqual(core("open", [E1, P1]));
    expect(await where(ws, { verification: ["indirect"] })).toEqual([]);
    expect(await where(ws, { emergent: true })).toEqual([E1, P1, E2, E3, E4]);
  });

  it("[SR-035/AK2] element.get, element.list and evidence.status show emergent true for a marked requirement and leave it out for the others", async () => {
    const ws = await open();
    const listed = (await invoke(
      "element.list",
      { limit: 5000 },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect(marked(listed.elements)).toEqual(EMERGENT);
    expect(marked((await status(ws)).elements)).toEqual(EMERGENT);
    for (const id of [N1, G, E1, P1, E4]) {
      const { element } = await get(ws, id);
      expect(marked([element])).toEqual(EMERGENT.includes(id) ? [id] : []);
    }
    // The property stays a property: the person sets it, the tool only reads it.
    expect((await get(ws, E4)).element.properties["emergent"]).toBe("yes");
    expect((await get(ws, P1)).element.properties["emergent"]).toBe("no");
  });

  it("gives the same status with records given through evidenceRecordsState", async () => {
    const ws = await open();
    const version = async (id: string): Promise<string> => String((await get(ws, id)).element.version);
    const record = (element: string, v: string): EvidenceRecord => ({
      element,
      version: v,
      kind: "verification",
      method: "test",
      item: "build-1",
      result: "passed",
      date: "2026-10-27T10:00:00Z",
    });
    await ws.replace(
      evidenceRecordsState,
      ws.get(evidenceRecordsState),
      Promise.resolve([
        record(C11, await version(C11)),
        record(C12, await version(C12)),
        record(E4, await version(E4)),
      ]),
    );
    expect(byId(await status(ws, { selection: { ids: [G, E1, E4] } }))).toEqual({
      [G]: core("open", [E1, P1]),
      [E1]: core("open"),
      [E4]: core("verified"),
    });
  });

  it("marking a requirement emergent leaves its version (D-057, #378)", async () => {
    const ws = await open();
    const before = (await get(ws, E2)).element.version;
    const out = await update(ws, { ref: E2, set: { emergent: "no" } });
    expect(out.affected).toBe(0);
    const after = await get(ws, E2);
    expect(after.element.version).toBe(before);
    // Its own record stays current; it is no longer emergent, but its own record decides.
    expect(after.element.verification).toEqual(core("verified"));
    const child = await get(ws, C21);
    expect(child.element.problems?.filter((p) => p.code === "relation.outdated") ?? []).toEqual([]);
    // The same for P1 when it is marked.
    await update(ws, { ref: P1, set: { emergent: "yes" } });
    const c13 = await get(ws, C13);
    expect(c13.element.problems?.filter((p) => p.code === "relation.outdated") ?? []).toEqual([]);
  });

  it("a misdefined emergent property gives a warning and marks nothing (#591 Q1)", async () => {
    const ws = await open(await misdefined());
    const metamodel = (await invoke(
      "metamodel.get",
      {},
      { workspace: ws },
    )) as CommandOutput<"metamodel.get">;
    const workspace = (await invoke(
      "workspace.status",
      {},
      { workspace: ws },
    )) as CommandOutput<"workspace.status">;
    expect([workspace.metamodel.valid, workspace.readOnly]).toEqual([true, false]);
    expect(workspace.problems).toContainEqual(expect.objectContaining({ severity: "warning", line: 98 }));
    expect(metamodel.problems).toEqual([
      expect.objectContaining({
        code: "metamodel.invalid",
        severity: "warning",
        file: METAMODEL,
        line: 98,
        message:
          "Property emergent has the meaning emergent, which needs kind choice without many and the choice yes (the mark), not kind text; no element is marked emergent",
      }),
    ]);
    const out = await status(ws);
    expect(marked(out.elements)).toEqual([]);
    const statuses = byId(out);
    expect([statuses[E2], statuses[E1], statuses[G]]).toEqual([
      core("verified"),
      core("indirect"),
      core("indirect"),
    ]);
    expect(await where(ws, { emergent: true })).toEqual([]);
    expect(await where(ws, { emergent: false })).toHaveLength(12);
    // The workspace stays writable (no SR-011 AK3).
    expect((await update(ws, { ref: P1, text: "Changed.\n" })).files).toEqual([
      "requirements/SR-00000000b120.md",
    ]);
  });

  it("never touches the status as written (D-030), and reads the mark while the metamodel is not valid", async () => {
    const ws = await open();
    const out = await status(ws);
    expect(new Set(out.elements.map((e) => e.status))).toEqual(new Set(["approved"]));
    const broken = await open({ ...FIXTURE, files: { "metamodel/broken.yaml": "properties: [\n" } });
    const invalid = await status(broken, { selection: { ids: [G, E1, E2, P1] } });
    expect(byId(invalid)).toEqual({
      [G]: core("open"),
      [E1]: core("open"),
      [E2]: core("open"),
      [P1]: core("open"),
    });
    expect(marked(invalid.elements)).toEqual([E1, E2]);
  });
});
