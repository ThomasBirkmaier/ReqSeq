// element.list (SR-069, SR-101) on fixtures/SR-069/filter, one repository `system` with the
// standard model and a subtype of system-requirement, software-requirement (SWR), with a number
// property `priority`:
// - needs N1 (approved) and N2 (draft); variants V1 Coastal (approved) and V2 Mountain (draft);
//   packages P1 Sensors (approved) and P2 Display (draft); decision D1 (approved);
// - SR b1 (approved, functional, topic Wind): derives from N1, in P1, based on D1;
// - SR b2 (draft, performance, topic Timing): derives from N1, valid for V1, in P1 and P2;
// - SR b3 (draft, quality): derives from b1, valid for V2, emergent;
// - SR b4 (obsolete, which is marked invalid; functional): no parent, in P2, unknown property owner;
// - SR b5 (approved, interface): derives from N2, imported from source "Supplier A" on 2026-03-01;
// - SWR f1 (draft, priority 2) derives from b1; SWR f2 (approved, priority 5) derives from b2.
// Store order: decisions, needs, packages, requirements (SR, then SWR), variants.
//
// The evidence conditions (AK1 "Nachweisstatus", AK3 "ohne Nachweis") are tested through the
// evidence provider (decision on #127, option 1); stage 4 adds end-to-end tests with records.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import type { EvidenceStatuses } from "../../query/index.js";
import { evidenceStatusState } from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.list">;

const P = "69069069-0000-4000-8000-0000000000";
const id = (tail: string): string => `${P}${tail}`;
const [D1, N1, N2, P1, P2, B1, B2, B3, B4, B5, F1, F2, V1, V2] = [
  "e1",
  "a1",
  "a2",
  "d1",
  "d2",
  "b1",
  "b2",
  "b3",
  "b4",
  "b5",
  "f1",
  "f2",
  "c1",
  "c2",
].map(id) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];
const ALL = [D1, N1, N2, P1, P2, B1, B2, B3, B4, B5, F1, F2, V1, V2];
const but = (...left: readonly string[]): string[] => ALL.filter((e) => !left.includes(e));

const FILTER: FixtureOptions = { fixture: "SR-069/filter" };

const open = async (options: FixtureOptions = FILTER): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.list", input, { workspace })) as Output;

const ids = (output: Output): string[] => output.elements.map((e) => e.id);

/** The UUIDs `where` selects, every element in one page. */
const where = async (
  workspace: Workspace,
  condition: unknown,
  extra: Record<string, unknown> = {},
): Promise<string[]> =>
  ids(await list(workspace, { selection: { where: condition, ...extra }, limit: 5000 }));

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await list(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("element.list did not fail");
};

/** The code, message and fields of the error `where` gives. */
const refused = async (
  workspace: Workspace,
  condition: unknown,
): Promise<{ code: string; message: string; fields: unknown }> => {
  const error = await failure(workspace, { selection: { where: condition } });
  return { code: error.code, message: error.message, fields: error.details?.["fields"] };
};

/** Replaces the evidence provider of `workspace` (decision on #127, option 1). */
const withEvidence = async (workspace: Workspace, statuses: EvidenceStatuses): Promise<void> => {
  const before = workspace.get(evidenceStatusState);
  await before;
  expect(await workspace.replace(evidenceStatusState, before, Promise.resolve(statuses))).toBe(true);
};

const derivation = (direction: string, exists: boolean, to?: unknown): unknown => ({
  relation: { meaning: "derivation", direction, ...(to === undefined ? {} : { to }) },
  exists,
});

describe("element.list (SR-069)", () => {
  it("[SR-069/AK1] filters on the type, with the types that extend it unless subtypes is false (SR-012)", async () => {
    const ws = await open();
    expect(await where(ws, { type: ["system-requirement"] })).toEqual([B1, B2, B3, B4, B5, F1, F2]);
    expect(await where(ws, { type: ["system-requirement"], subtypes: false })).toEqual([B1, B2, B3, B4, B5]);
    expect(await where(ws, { type: ["software-requirement"] })).toEqual([F1, F2]);
    expect(await where(ws, { type: ["need", "variant"] })).toEqual([N1, N2, V1, V2]);
    // A type key no element and no metamodel has selects none; the check reports unknown types (SR-016).
    expect(await where(ws, { type: ["nope"] })).toEqual([]);
  });

  it("[SR-069/AK1] filters on the status and on statuses marked invalid (D-044)", async () => {
    const ws = await open();
    expect(await where(ws, { status: ["draft"] })).toEqual([N2, P2, B2, B3, F1, V2]);
    expect(await where(ws, { status: ["obsolete", "approved"] })).toEqual([D1, N1, P1, B1, B4, B5, F2, V1]);
    expect(await where(ws, { invalid: true })).toEqual([B4]);
    expect(await where(ws, { invalid: false })).toEqual(but(B4));
  });

  it("[SR-069/AK1] filters on the package, named by a short ID in any case (D-040)", async () => {
    const ws = await open();
    expect(await where(ws, { package: "pkg-0000D1" })).toEqual([B1, B2]);
    expect(await where(ws, { package: P2 })).toEqual([B2, B4]);
    expect(await refused(ws, { all: [{ package: "N-0000a1" }] })).toEqual({
      code: "input.invalid",
      message:
        "selection.where.all[0].package: N-0000a1 is no package: an element whose type has the meaning package",
      fields: ["selection.where.all[0].package"],
    });
    expect((await failure(ws, { selection: { where: { package: "PKG-ffffff" } } })).code).toBe("ref.unknown");
  });

  it("[SR-069/AK1] filters on the validity: the core and each variant (SR-040)", async () => {
    const ws = await open();
    expect(await where(ws, { validFor: "core" })).toEqual(but(B2, B3));
    expect(await where(ws, { validFor: "VAR-0000c1" })).toEqual(but(B3));
    expect(await where(ws, { validFor: V2 })).toEqual(but(B2));
    expect(await refused(ws, { validFor: "N-0000a1" })).toEqual({
      code: "input.invalid",
      message:
        "N-0000a1 is no variant: selection.where.validFor takes core or a variant, an element whose type has the meaning variant",
      fields: ["selection.where.validFor"],
    });
  });

  it("[SR-069/AK1] filters on any property: text, choice by display name, number, date, unknown", async () => {
    const ws = await open();
    expect(await where(ws, { property: "topic", op: "eq", value: "Wind" })).toEqual([B1]);
    expect(await where(ws, { property: "topic", op: "ne", value: "Wind" })).toEqual(but(B1));
    // Choices by key or display name in any case, as on write (#309).
    expect(
      await where(ws, { property: "requirement-type", op: "in", value: ["Performance", "quality"] }),
    ).toEqual([B2, B3]);
    // A text that names no choice is taken as written (a file may hold it, SR-085).
    expect(await where(ws, { property: "requirement-type", op: "eq", value: "nope" })).toEqual([]);
    expect(await where(ws, { property: "requirement-type", op: "eq", value: "functional" })).toEqual([
      B1,
      B4,
      F1,
      F2,
    ]);
    expect(await where(ws, { property: "priority", op: "ge", value: 2 })).toEqual([F1, F2]);
    expect(await where(ws, { property: "priority", op: "lt", value: 5 })).toEqual([F1]);
    expect(await where(ws, { property: "priority", op: "gt", value: 5 })).toEqual([]);
    expect(await where(ws, { property: "priority", op: "le", value: 5 })).toEqual([F1, F2]);
    // A date is ISO text (YAML 1.2), so it compares as a date; a number never equals a text.
    expect(await where(ws, { property: "import-date", op: "gt", value: "2026-01-01" })).toEqual([B5]);
    expect(await where(ws, { property: "import-date", op: "ge", value: "2026-03-01" })).toEqual([B5]);
    expect(await where(ws, { property: "import-date", op: "lt", value: "2027-01-01" })).toEqual([B5]);
    expect(await where(ws, { property: "topic", op: "lt", value: 5 })).toEqual([]);
    expect(await where(ws, { property: "priority", op: "lt", value: "9" })).toEqual([]);
    expect(await where(ws, { property: "priority", op: "eq", value: "2" })).toEqual([]);
    // A property the metamodel does not know (SR-016).
    expect(await where(ws, { property: "owner", op: "eq", value: "Dana" })).toEqual([B4]);
    // Texts, ignoring case; a regular expression; every item of a list counts.
    expect(await where(ws, { property: "title", op: "contains", value: "WIND" })).toEqual([N1, B1]);
    expect(await where(ws, { property: "title", op: "matches", value: "^S\\p{Ll}" })).toEqual([
      N1,
      P1,
      B3,
      B4,
      B5,
    ]);
    expect(await where(ws, { property: "acceptance-criteria", op: "contains", value: "raw values" })).toEqual(
      [F2],
    );
    expect(await where(ws, { property: "validity", op: "exists" })).toEqual([B2, B3]);
    expect(await where(ws, { property: "topic", op: "missing" })).toEqual(but(B1, B2));
    expect(await where(ws, { source: "Supplier A" })).toEqual([B5]);
    expect(await where(ws, { source: "Supplier B" })).toEqual([]);
  });

  it("[SR-069/AK1] filters on a property that holds relations by element references (D-058)", async () => {
    const ws = await open();
    expect(await where(ws, { property: "packages", op: "eq", value: "PKG-0000d2" })).toEqual([B2, B4]);
    expect(await where(ws, { property: "packages", op: "in", value: [P1, "pkg-0000d2"] })).toEqual([
      B1,
      B2,
      B4,
    ]);
    expect(await where(ws, { property: "packages", op: "ne", value: P1 })).toEqual(but(B1, B2));
    expect(await where(ws, { property: "derives-from", op: "eq", value: "N-0000a1" })).toEqual([B1, B2]);
    expect(await where(ws, { property: "derives-from", op: "missing" })).toEqual([
      D1,
      N1,
      N2,
      P1,
      P2,
      B4,
      V1,
      V2,
    ]);
  });

  it("[SR-069/AK1] filters on the verification status per view and the validation status, through the evidence provider", async () => {
    const ws = await open();
    // Stage 3 has no evidence records: every requirement is open in each view it applies in, every need open.
    expect(await where(ws, { verification: ["open"] })).toEqual([B1, B4, B5, F1, F2]);
    expect(await where(ws, { verification: ["open"], variant: "VAR-0000c1" })).toEqual([
      B1,
      B2,
      B4,
      B5,
      F1,
      F2,
    ]);
    // Without variant, in the view of the selection (SR-047).
    expect(await where(ws, { verification: ["open"] }, { view: V2 })).toEqual([B1, B3, B4, B5, F1, F2]);
    expect(await where(ws, { verification: ["verified", "failed"] })).toEqual([]);
    expect(await where(ws, { validation: ["open"] })).toEqual([N1, N2]);
    expect(await where(ws, { validation: ["validated"] })).toEqual([]);
    // A provider with statuses, as stage 4 computes them from records (SR-031, SR-047).
    await withEvidence(ws, {
      verification: (element, view) => {
        if (element.id === B1) {
          return view.kind === "core" ? "verified" : "outdated";
        }
        return element.id === B2 && view.kind === "variant" && view.variant.id === V1 ? "failed" : undefined;
      },
      validation: (element) => (element.id === N1 ? "validated" : undefined),
      hasEvidence: () => false,
    });
    expect(await where(ws, { verification: ["verified"] })).toEqual([B1]);
    expect(await where(ws, { verification: ["failed", "outdated"], variant: V1 })).toEqual([B1, B2]);
    expect(await where(ws, { verification: ["outdated"] }, { view: V2 })).toEqual([B1]);
    expect(
      await where(ws, { all: [{ validation: ["validated"] }, { not: { verification: ["verified"] } }] }),
    ).toEqual([N1]);
  });

  it("[SR-069/AK2] combines conditions with and, or and not", async () => {
    const ws = await open();
    const requirement = { type: ["system-requirement"] };
    expect(await where(ws, { all: [requirement, { status: ["approved"] }] })).toEqual([B1, B5, F2]);
    expect(
      await where(ws, { any: [{ status: ["obsolete"] }, { property: "priority", op: "gt", value: 4 }] }),
    ).toEqual([B4, F2]);
    expect(await where(ws, { not: requirement })).toEqual([D1, N1, N2, P1, P2, V1, V2]);
    expect(
      await where(ws, { all: [requirement, { not: { any: [{ status: ["draft"] }, { invalid: true }] } }] }),
    ).toEqual([B1, B5, F2]);
    expect(await where(ws, { not: { not: { type: ["need"] } } })).toEqual([N1, N2]);
    // An empty all holds for every element, an empty any for none.
    expect(await where(ws, { all: [] })).toEqual(ALL);
    expect(await where(ws, { any: [] })).toEqual([]);
    expect(await where(ws, { not: { any: [] } })).toEqual(ALL);
  });

  it("[SR-069/AK3] filters on relations: without child, without parent, with a parent or child that meets a condition", async () => {
    const ws = await open();
    const requirement = { type: ["system-requirement"] };
    // Without child (SR-069 AK3 "ohne Child").
    expect(await where(ws, { all: [requirement, derivation("down", false)] })).toEqual([B3, B4, B5, F1, F2]);
    expect(await where(ws, derivation("down", true))).toEqual([N1, N2, B1, B2]);
    // Without parent, and with a parent that is a need.
    expect(await where(ws, derivation("up", false))).toEqual([D1, N1, N2, P1, P2, B4, V1, V2]);
    expect(await where(ws, derivation("up", true, { type: ["need"] }))).toEqual([B1, B2, B5]);
    // With an approved child; without a child that is draft.
    expect(await where(ws, derivation("down", true, { status: ["approved"] }))).toEqual([N1, N2, B2]);
    expect(await where(ws, { all: [requirement, derivation("down", false, { status: ["draft"] })] })).toEqual(
      [B2, B3, B4, B5, F1, F2],
    );
    // A relation kind, in either direction when none is given.
    expect(await where(ws, { relation: { kind: "based-on" }, exists: true })).toEqual([D1, B1]);
    expect(await where(ws, { relation: { kind: "based-on", direction: "up" }, exists: true })).toEqual([B1]);
    // A property of kind relation as the kind: the packages with members.
    expect(await where(ws, { relation: { kind: "packages", direction: "down" }, exists: true })).toEqual([
      P1,
      P2,
    ]);
    expect(
      await where(ws, {
        relation: { kind: "validity", direction: "down", to: { status: ["draft"] } },
        exists: true,
      }),
    ).toEqual([V1, V2]);
    // Without any relation of a relation kind (validity and packages are properties).
    expect(await where(ws, { relation: {}, exists: false })).toEqual([P1, P2, B4, V1, V2]);
    // A meaning with several kinds: replacement (supersedes, replaces); nothing replaces anything here.
    expect(await where(ws, { relation: { meaning: "replacement" }, exists: true })).toEqual([]);
    expect(
      await where(ws, {
        relation: { kind: "derives-from", meaning: "derivation", direction: "up" },
        exists: true,
      }),
    ).toEqual([B1, B2, B3, B5, F1, F2]);
  });

  it("[SR-069/AK3] filters on elements without evidence, through the evidence provider", async () => {
    const ws = await open();
    const noEvidence = { relation: { direction: "evidence" }, exists: false };
    // Stage 3 has no evidence records (SR-028, stage 4).
    expect(await where(ws, noEvidence)).toEqual(ALL);
    await withEvidence(ws, {
      verification: () => undefined,
      validation: () => undefined,
      hasEvidence: (element) => element.id === B1 || element.id === N1,
    });
    expect(await where(ws, { all: [{ type: ["system-requirement"] }, noEvidence] })).toEqual([
      B2,
      B3,
      B4,
      B5,
      F1,
      F2,
    ]);
    expect(await where(ws, { relation: { direction: "evidence" }, exists: true })).toEqual([N1, B1]);
    expect(
      await where(ws, { all: [derivation("down", false), noEvidence, { type: ["system-requirement"] }] }),
    ).toEqual([B3, B4, B5, F1, F2]);
  });

  it("[SR-101/AK2] a filter and a variant at once select only the elements that meet both", async () => {
    const ws = await open();
    expect(await where(ws, { status: ["draft"] }, { view: "VAR-0000c1" })).toEqual([N2, P2, B2, F1, V2]);
    expect(await where(ws, { status: ["draft"] }, { view: "core" })).toEqual([N2, P2, F1, V2]);
    const both = await list(ws, {
      selection: { package: "PKG-0000d1", view: "core", where: { status: ["approved"] } },
    });
    expect(ids(both)).toEqual([B1]);
    expect((await failure(ws, { selection: { view: "SR-0000b1" } })).message).toBe(
      "SR-0000b1 is no variant: selection.view takes core or a variant, an element whose type has the meaning variant",
    );
  });

  it("[SR-101/AK3] a list of short IDs selects exactly these elements, each once, in workspace order", async () => {
    const ws = await open();
    const out = await list(ws, { selection: { ids: ["SR-0000b3", "sr-0000B1", "SR-0000b3", V1] } });
    expect(ids(out)).toEqual([B1, B3, V1]);
    expect(out.total).toBe(3);
    expect(
      ids(
        await list(ws, { selection: { ids: ["SR-0000b3", "SR-0000b1"], where: { status: ["approved"] } } }),
      ),
    ).toEqual([B1]);
    expect(ids(await list(ws, { selection: { ids: [] } }))).toEqual([]);
    const unknown = await failure(ws, { selection: { ids: ["SR-0000b1", "SR-ffffff"] } });
    expect([unknown.code, unknown.message]).toEqual([
      "ref.unknown",
      'No element has the short ID or identifier "SR-ffffff"',
    ]);
  });

  it("selects a package as a selection: exactly its elements (SR-048 AK3)", async () => {
    const ws = await open();
    expect(ids(await list(ws, { selection: { package: "PKG-0000d2" } }))).toEqual([B2, B4]);
    const notPackage = await failure(ws, { selection: { package: "VAR-0000c1" } });
    expect(notPackage.details?.["fields"]).toEqual(["selection.package"]);
  });

  it("lists one page of the matching elements as list commands give them; total counts all", async () => {
    const ws = await open();
    const all = await list(ws, {});
    expect(ids(all)).toEqual(ALL);
    expect([all.total, all.incomplete]).toEqual([14, false]);
    const [first] = all.elements;
    expect(first).toMatchObject({
      id: D1,
      shortId: "D-0000e1",
      type: "decision",
      status: "approved",
      title: "Use ultrasound",
    });
    expect(first?.text).toBeUndefined();
    expect(first?.version).toMatch(/^n1:/);
    const page = await list(ws, {
      selection: { where: { type: ["system-requirement"] } },
      offset: 2,
      limit: 3,
    });
    expect(ids(page)).toEqual([B3, B4, B5]);
    expect(page.total).toBe(7);
    expect(ids(await list(ws, { offset: 20 }))).toEqual([]);
  });

  it("gives the text of each listed element with withText, as its file holds it now", async () => {
    const fixture = await createFixtureWorkspace(FILTER);
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    const needs = { selection: { where: { type: ["need"] } }, withText: true };
    expect((await list(ws, needs)).elements.map((e) => e.text)).toEqual([
      "N1: parent of SR-0000b1 and SR-0000b2.\n",
      "N2: parent of SR-0000b5.\n",
    ]);
    // N1 changed and N2 is gone since the store read them: N1 as it is now, N2 without text and version.
    const n1 = fixture.path("needs/N-0000000000a1.md");
    await fs.writeFile(n1, (await fs.readFile(n1, "utf8")).replace("N1: parent", "N1 now: parent"));
    await fs.rm(fixture.path("needs/N-0000000000a2.md"));
    const [now, gone] = (await list(ws, needs)).elements;
    expect(now?.text).toBe("N1 now: parent of SR-0000b1 and SR-0000b2.\n");
    expect(gone?.text).toBeUndefined();
    expect(gone?.version).toBeUndefined();
    expect(gone?.problems?.map((p) => p.code)).toEqual(["file.faulty"]);
  });

  it("is incomplete while the workspace file lists a repository that is not on this machine (SR-006 AK2)", async () => {
    const ws = await open({
      ...FILTER,
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
          '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
          "metamodel: { repository: system, path: metamodel }\n",
      },
    });
    const out = await list(ws, { selection: { where: { type: ["need"] } } });
    expect([ids(out), out.incomplete]).toEqual([[N1, N2], true]);
  });

  it("is incomplete when a condition on the other end meets a target in a repository the workspace file does not list", async () => {
    const extra = (repository: string): string =>
      `---\nid: ${P}b9\ntype: system-requirement\nstatus: draft\ntitle: Elsewhere\nrequirement-type: functional\nacceptance-criteria: [Given, when, then.]\nderives-from:\n  - { id: ${P}a1, version: n1:1111111111111111${repository} }\n---\n`;
    const elsewhere = await open({
      ...FILTER,
      files: { "requirements/SR-0000000000b9.md": extra(", repository: nowhere") },
    });
    const up = derivation("up", true, { type: ["need"] });
    const out = await list(elsewhere, { selection: { where: up } });
    expect([ids(out), out.incomplete]).toEqual([[B1, B2, B5], true]);
    // Without `to` the relation exists whatever its target; a missing target (SR-089) is the check's.
    const named = { property: "title", op: "eq", value: "Elsewhere" };
    expect(await where(elsewhere, { all: [named, derivation("up", true)] })).toEqual([`${P}b9`]);
    // An item that names no target is no relation (SR-085 reports it).
    const noTarget = extra("").replace(/derives-from:\n.*\n/, "derives-from:\n  - just text\n");
    const missing = await open({
      ...FILTER,
      files: {
        "requirements/SR-0000000000b9.md": extra("").replace(`${P}a1`, `${P}ff`),
        "requirements/SR-0000000000b8.md": noTarget.replace(`${P}b9`, `${P}b8`),
      },
    });
    const outMissing = await list(missing, { selection: { where: up } });
    expect([ids(outMissing), outMissing.incomplete]).toEqual([[B1, B2, B5], false]);
    expect(
      await where(missing, {
        all: [{ property: "title", op: "eq", value: "Elsewhere" }, derivation("up", true)],
      }),
    ).toEqual([`${P}b9`]);
    // With `to`, even one that every element meets, only an available target counts (#336).
    expect(await where(missing, { all: [named, derivation("up", true, { all: [] })] })).toEqual([]);
    expect(await where(missing, { all: [named, derivation("up", false, { all: [] })] })).toEqual([
      `${P}b8`,
      `${P}b9`,
    ]);
  });
});

describe("element.list refuses what it cannot do yet, and wrong conditions", () => {
  it("refuses an unknown saved filter, baselines and the condition emergent, naming the field", async () => {
    const ws = await open();
    expect((await failure(ws, { selection: { filter: "open ones" } })).details?.["fields"]).toEqual([
      "selection.filter",
    ]);
    expect((await failure(ws, { selection: { baseline: "v1" } })).details?.["fields"]).toEqual([
      "selection.baseline",
    ]);
    expect(await refused(ws, { any: [{ type: ["need"] }, { not: { emergent: true } }] })).toEqual({
      code: "input.invalid",
      message:
        "selection.where.any[1].not.emergent: the condition emergent comes with SR-035 (stage 4); leave it out",
      fields: ["selection.where.any[1].not.emergent"],
    });
  });

  it("refuses a value that does not fit the operator", async () => {
    const ws = await open();
    const message = async (condition: unknown): Promise<string> => (await refused(ws, condition)).message;
    expect(await message({ property: "topic", op: "exists", value: "x" })).toBe(
      "selection.where.value: op exists takes no value",
    );
    expect(await message({ property: "topic", op: "in", value: "x" })).toBe(
      "selection.where.value: op in takes a list of texts, numbers or booleans",
    );
    expect(await message({ property: "topic", op: "in", value: [{ a: 1 }] })).toBe(
      "selection.where.value: op in takes a list of texts, numbers or booleans",
    );
    expect(await message({ property: "topic", op: "eq" })).toBe(
      "selection.where.value: op eq takes a text, number or boolean",
    );
    expect(await message({ property: "topic", op: "contains", value: 3 })).toBe(
      "selection.where.value: op contains takes a text",
    );
    expect(await message({ property: "topic", op: "matches", value: true })).toBe(
      "selection.where.value: op matches takes a text",
    );
    expect(await message({ property: "topic", op: "matches", value: "(" })).toMatch(
      /^selection\.where\.value: \( is no regular expression: SyntaxError: /,
    );
    expect(await message({ property: "priority", op: "lt", value: false })).toBe(
      "selection.where.value: op lt takes a number or a text",
    );
    expect(await message({ property: "packages", op: "gt", value: P1 })).toBe(
      "selection.where.op: op gt does not apply to Property Package (packages), which holds relations; use eq, ne, in, exists or missing",
    );
    expect(await message({ property: "packages", op: "in", value: [P1, 3] })).toBe(
      "selection.where.value: Property Package (packages) holds relations: give element references",
    );
    expect((await refused(ws, { property: "packages", op: "eq", value: "PKG-ffffff" })).code).toBe(
      "ref.unknown",
    );
  });

  it("refuses a choice given by a display name that names several choices (#309)", async () => {
    const odd =
      "logreq-metamodel: 1\nproperties:\n  - key: level\n    name: Level\n    kind: choice\n    choices:\n      - { key: high, name: Low }\n      - { key: low, name: High }\n";
    const ws = await open({ ...FILTER, files: { "metamodel/odd.yaml": odd } });
    expect(await refused(ws, { property: "level", op: "eq", value: "HIGH" })).toEqual({
      code: "input.invalid",
      message: "selection.where.value: HIGH names more than one choice (high, low); give the key",
      fields: ["selection.where.value"],
    });
    // The exact key wins (findNamed); a number is never a choice name.
    expect(await where(ws, { property: "level", op: "in", value: ["high", 1] })).toEqual([]);
  });

  it("refuses a relation kind the metamodel does not have, and a kind without the meaning", async () => {
    const ws = await open();
    const message = async (condition: unknown): Promise<string> => (await refused(ws, condition)).message;
    expect(await message({ relation: { kind: "nope" }, exists: true })).toBe(
      "selection.where.relation.kind: nope is neither a relation kind nor a property of kind relation",
    );
    expect(await message({ relation: { kind: "topic" }, exists: true })).toBe(
      "selection.where.relation.kind: topic is neither a relation kind nor a property of kind relation",
    );
    expect(await message({ relation: { kind: "based-on", meaning: "derivation" }, exists: true })).toBe(
      "selection.where.relation.meaning: Relation Based on (based-on) has not the meaning derivation",
    );
    expect(await message({ relation: { kind: "validity", meaning: "derivation" }, exists: true })).toBe(
      "selection.where.relation.meaning: Property Validity (validity) has not the meaning derivation",
    );
    for (const field of ["kind", "meaning", "to"]) {
      const relation = {
        direction: "evidence",
        [field]: field === "to" ? { type: ["need"] } : field === "kind" ? "refines" : "derivation",
      };
      expect(await message({ relation, exists: false })).toBe(
        `selection.where.relation.${field}: the direction evidence takes no kind, meaning or to`,
      );
    }
  });

  it("refuses a condition whose meaning no key of the metamodel has (SR-013 AK3)", async () => {
    const bare =
      "logreq-metamodel: 1\ntypes:\n  - { key: need, name: Need, prefix: N, properties: [title] }\nproperties:\n" +
      "  - { key: title, name: Title, kind: text, meaning: title }\nrelations:\n" +
      "  - { key: derives-from, name: Derives from, inverse-name: Derived by }\nstatuses:\n  - { key: draft, name: Draft, initial: true }\n";
    const ws = await open({
      ...FILTER,
      files: { "metamodel/standard-model.yaml": bare, "metamodel/software.yaml": "logreq-metamodel: 1\n" },
    });
    const meaning = async (condition: unknown): Promise<unknown> => {
      const error = await failure(ws, { selection: { where: condition } });
      return [error.code, error.details?.["meaning"], error.details?.["command"]];
    };
    expect(await meaning({ package: P1 })).toEqual([
      "metamodel.meaning-unassigned",
      "packages",
      "element.list",
    ]);
    expect(await meaning({ source: "Supplier A" })).toEqual([
      "metamodel.meaning-unassigned",
      "source",
      "element.list",
    ]);
    expect(await meaning({ validFor: "core" })).toEqual([
      "metamodel.meaning-unassigned",
      "validity",
      "element.list",
    ]);
    expect(await meaning({ relation: { meaning: "derivation" }, exists: false })).toEqual([
      "metamodel.meaning-unassigned",
      "derivation",
      "element.list",
    ]);
    // Without meanings, the relations of every relation kind still count, and nothing is open.
    expect(await where(ws, { relation: { kind: "derives-from", direction: "down" }, exists: true })).toEqual([
      N1,
      N2,
      B1,
      B2,
    ]);
    expect(await where(ws, { any: [{ verification: ["open"] }, { validation: ["open"] }] })).toEqual([]);
  });
});

describe("element.list, the elements of a package in several repositories (SR-112, D-058)", () => {
  const PACKAGE = "7e3a5c9b-1d2f-4e6a-8b0c-2d4e6f8a0b1c";
  const NAMES = "2d4f6a8c-0e1b-4c3d-9a5b-7c9e1f3a5b7d";
  const SILENT = "3e5a7b9d-1f2c-4d4e-8b6c-8d0f2a4b6c8e";

  /** A system requirement of the repository `system` whose entry for the package is `entry`. */
  const requirement = (id: string, entry: string): string =>
    [
      "---",
      `id: ${id}`,
      "type: system-requirement",
      "status: draft",
      `title: Names the package ${id.slice(0, 4)}`,
      "requirement-type: functional",
      "acceptance-criteria:",
      "  - Given a gust, when it is measured, then the display shows it.",
      "packages:",
      `  - ${entry}`,
      "---",
      "",
    ].join("\n");

  it("[SR-112/AK1] where.package lists the members in another repository that name the package with its repository, and not those that name it without one (D-058)", async () => {
    // The package lives in the repository `platform`; the two requirements are in `system`.
    const fixture = await createFixtureWorkspace({
      fixture: "SR-005/cross-repository",
      files: {
        "system/requirements/SR-2d4f6a8c0e1b.md": requirement(
          NAMES,
          `{ id: ${PACKAGE}, version: "n1:1111111111111111", repository: platform }`,
        ),
        "system/requirements/SR-3e5a7b9d1f2c.md": requirement(
          SILENT,
          `{ id: ${PACKAGE}, version: "n1:1111111111111111" }`,
        ),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.path("system"));
    onTestFinished(() => workspace.close());
    const members = await list(workspace, { selection: { where: { package: PACKAGE } } });
    expect(ids(members)).toEqual([NAMES]);
    expect(members.elements.map((element) => element.repository)).toEqual(["system"]);
  });
});
