// variant.exclude (SR-042) on fixtures/SR-043/example: core requirements K1 to K4 (SR-0000a1 to
// a4), variant A (VAR-0000c1, Coast) replaces K1 by A1 (b1, validity [A]), excludes K2 and adds A2
// (b2, validity [A]); variants B and C change nothing; need N1 (d1), package P1 (f1).
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandInput, CommandOutput } from "../../catalog.js";

type Input = Omit<CommandInput<"variant.exclude">, "undo"> & { readonly undo?: boolean };
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const P = "43043043-0000-4000-8000-0000000000";
const A = "VAR-0000c1";
const A_FILE = "variants/VAR-0000000000c1.md";

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-043/example", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exclude = async (workspace: Workspace, input: Input): Promise<CommandOutput<"variant.exclude">> =>
  (await invoke("variant.exclude", input, { workspace })) as CommandOutput<"variant.exclude">;

const refused = async (workspace: Workspace, input: Input): Promise<CommandError> => {
  const error = await exclude(workspace, input).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** The tails of the system requirements `element.list` gives in `view`. */
const requirementsIn = async (workspace: Workspace, view: string): Promise<string[]> => {
  const out = (await invoke(
    "element.list",
    { selection: { view, where: { type: ["system-requirement"] } } },
    { workspace },
  )) as CommandOutput<"element.list">;
  return out.elements.map((e) => e.id.slice(-2));
};

const read = (fixture: FixtureWorkspace, file: string): Promise<string> =>
  fs.readFile(path.join(fixture.root, file), "utf8");

describe("variant.exclude (SR-042)", () => {
  it("[SR-042/AK1] variant.exclude removes K3 from the view of A only", async () => {
    const { workspace } = await open();
    const out = await exclude(workspace, { variant: A, refs: ["SR-0000a3"] });
    expect(out).toEqual({ files: [A_FILE], problems: [] });
    expect(await requirementsIn(workspace, A)).toEqual(["a4", "b1", "b2"]);
    expect(await requirementsIn(workspace, "VAR-0000c2")).toEqual(["a1", "a2", "a3", "a4"]);
    expect(await requirementsIn(workspace, "core")).toEqual(["a1", "a2", "a3", "a4"]);
  });

  it("[SR-042/AK2] the exclusion is written into the variant file and K3's file is unchanged", async () => {
    const { fixture, workspace } = await open();
    const core = await read(fixture, "requirements/SR-0000000000a3.md");
    await exclude(workspace, { variant: A, refs: ["SR-0000a3", "SR-0000a4"] });
    expect(await read(fixture, "requirements/SR-0000000000a3.md")).toBe(core);
    expect(await read(fixture, A_FILE)).toMatch(
      new RegExp(
        `^excludes:\\n  - \\{ id: ${P}a2, version: n1:67ebd0624004c969, title: Measure the wind \\}\\n` +
          `  - \\{ id: ${P}a3, version: n1:[0-9a-f]{16}, title: Measure the rain \\}\\n` +
          `  - \\{ id: ${P}a4, version: n1:[0-9a-f]{16}, title: Show the temperature \\}\\n`,
        "m",
      ),
    );
    // Already excluded: nothing is written again.
    expect(await exclude(workspace, { variant: A, refs: ["SR-0000a2", "SR-0000a3"] })).toEqual({
      files: [],
      problems: [],
    });
  });

  it("[SR-042/AK3] coverage and degree in A do not count the excluded K2 and K3", async () => {
    const { workspace } = await open();
    await exclude(workspace, { variant: A, refs: ["SR-0000a3"] });
    const selection = { view: A };
    const coverage = (await invoke(
      "evidence.coverage",
      { selection },
      { workspace },
    )) as CommandOutput<"evidence.coverage">;
    const level = coverage.levels.find((l) => l.type === "system-requirement");
    expect([level?.total, level?.elements.withoutEvidence?.map((id) => id.slice(-2))]).toEqual([
      3,
      ["a4", "b1", "b2"],
    ]);
    const degree = (await invoke(
      "evidence.degree",
      { selection },
      { workspace },
    )) as CommandOutput<"evidence.degree">;
    expect(degree.degree.total).toBe(3);
  });

  it("[SR-042/AK4] variant.exclude refuses a requirement with validity: only core requirements", async () => {
    const { fixture, workspace } = await open();
    const before = await read(fixture, A_FILE);
    const error = await refused(workspace, { variant: A, refs: ["SR-0000a3", "SR-0000b2", "N-0000d1"] });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { reason: "not-core", refs: ["SR-0000b2", "N-0000d1"] },
    ]);
    expect(error.message).toBe(
      "Only core requirements can be excluded; no core requirement (it has a validity, or its type has no validity property): System Requirement SR-0000b2, Need N-0000d1. Nothing written",
    );
    expect(await read(fixture, A_FILE)).toBe(before);
  });

  it("[SR-042/AK6] variant.exclude with undo removes the entry and K2 is back in A", async () => {
    const { fixture, workspace } = await open();
    const out = await exclude(workspace, { variant: A, refs: ["SR-0000a2", "SR-0000a3"], undo: true });
    expect(out.files).toEqual([A_FILE]);
    expect(out.problems?.map((p) => [p.code, p.severity, p.message])).toEqual([
      [
        "relation.not-found",
        "info",
        "Variant VAR-0000c1 has no relation Excludes (excludes) to SR-0000a3; nothing removed",
      ],
    ]);
    expect(await read(fixture, A_FILE)).not.toContain("excludes");
    expect(await requirementsIn(workspace, A)).toEqual(["a2", "a3", "a4", "b1", "b2"]);
  });

  it("undo removes an entry by UUID, also one of no core requirement, and checks short IDs before a write", async () => {
    const { fixture, workspace } = await open({
      [A_FILE]: `---\nid: ${P}c1\ntype: variant\nstatus: draft\ntitle: Coast\nexcludes: [{ id: ${P}a2 }, { id: ${P}d1 }]\n---\n`,
    });
    const error = await refused(workspace, { variant: A, refs: [`${P}d1`, "SR-0000ff"], undo: true });
    expect(error.code).toBe("ref.unknown");
    expect(await exclude(workspace, { variant: A, refs: [`${P}D1`], undo: true })).toEqual({
      files: [A_FILE],
      problems: [],
    });
    expect(await read(fixture, A_FILE)).toContain(`excludes:\n  - { id: ${P}a2 }\n---\n`);
  });

  it("refuses an element that is no variant", async () => {
    const { workspace } = await open();
    const error = await refused(workspace, { variant: "SR-0000a1", refs: ["SR-0000a3"] });
    expect([error.code, error.details]).toEqual([
      "input.invalid",
      { ref: "SR-0000a1", reason: "not-a-variant" },
    ]);
  });

  it("refuses a core requirement of a type no exclusion kind allows as target, before any write", async () => {
    const { fixture, workspace } = await open({
      "metamodel/software.yaml":
        "reqseq-metamodel: 1\ntypes:\n  - { key: software-requirement, name: Software Requirement, prefix: SWR, properties: [title, validity] }\n",
      "requirements/SWR-0000000000a9.md": `---\nid: ${P}a9\ntype: software-requirement\nstatus: draft\ntitle: S\n---\n`,
    });
    const before = await read(fixture, A_FILE);
    const error = await refused(workspace, { variant: A, refs: ["SR-0000a3", "SWR-0000a9"] });
    expect([error.code, error.details]).toEqual([
      "relation.not-allowed",
      { sourceType: "variant", targetType: "software-requirement" },
    ]);
    expect(await read(fixture, A_FILE)).toBe(before);
  });
});
