import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandName, CommandOutput } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { nestedVariantsState } from "./nested.js";

/** Elements of fixtures/SR-039/nested: A, B (validity names A, relation to A), C (relation to A only). */
const A = "39039039-0000-4000-8000-0000000000a1";
const B = "39039039-0000-4000-8000-0000000000b2";
const C = "39039039-0000-4000-8000-0000000000c3";
const FILE_B = "variants/VAR-0000000000b2.md";
const FILE_C = "variants/VAR-0000000000c3.md";
const NESTED_B =
  "Property Validity (validity) of Variant VAR-0000b2 names Variant VAR-0000a1, but a variant builds only on the core (D-020)";

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions): Promise<Opened> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const nested = (files: FixtureOptions["files"] = {}): Promise<Opened> =>
  open({ fixture: "SR-039/nested", files });

const run = async <C extends CommandName>(
  opened: Opened,
  command: C,
  input: Record<string, unknown>,
): Promise<CommandOutput<C>> =>
  (await invoke(command, input, { workspace: opened.workspace })) as CommandOutput<C>;

const failure = async (
  opened: Opened,
  command: CommandName,
  input: Record<string, unknown>,
): Promise<unknown> => {
  try {
    await run(opened, command, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error.toJSON();
    }
    throw error;
  }
  throw new Error(`expected ${command} to fail`);
};

const read = (opened: Opened, file: string): Promise<string> =>
  fs.readFile(opened.fixture.path(file), "utf8");

describe("a variant as an element (SR-039)", () => {
  it("[SR-039/AK1] element.create of type variant writes a variant file in the workspace of the core", async () => {
    const opened = await open({ fixture: "SR-040/validity", git: true });
    const head = await opened.fixture.head();
    const out = await run(opened, "element.create", { type: "variant", title: "Valley" });
    const file = `variant/VAR-${out.element.id.replaceAll("-", "").slice(-12)}.md`;
    expect([out.element.type, out.element.repository, out.files]).toEqual(["variant", "system", [file]]);
    expect(await read(opened, file)).toBe(
      `---\nid: ${out.element.id}\ntype: variant\nstatus: draft\ntitle: Valley\n---\n`,
    );
    // The same repository as the core requirements; Git is only read (D-010, D-036).
    const core = await run(opened, "element.get", { ref: "40a0e000-0000-4000-8000-000000000a11" });
    expect(core.element.repository).toBe(out.element.repository);
    expect(await opened.fixture.head()).toBe(head);
    expect((await opened.fixture.git(["branch", "--list"])).trim()).toBe("* main");
  });

  it("[SR-039/AK2] element.create, update and bulkUpdate refuse a variant whose validity names a variant, naming the reason; a relation between variants is allowed", async () => {
    const opened = await nested();
    const before = await Promise.all([FILE_B, FILE_C].map((f) => read(opened, f)));
    const refused = (message: string, command: CommandName, elements: readonly string[]): unknown => ({
      code: "variant.nested",
      message: `Not written: ${message}. Write the variant without validity entries; a relation between variants is allowed`,
      details: { command, elements },
    });
    // element.create: nothing is written, not even the type folder.
    expect(
      await failure(opened, "element.create", {
        type: "variant",
        title: "South coast",
        properties: { validity: [{ id: A }] },
      }),
    ).toEqual(
      refused(
        "Property Validity (validity) of the new variant names Variant VAR-0000a1, but a variant builds only on the core (D-020)",
        "element.create",
        [],
      ),
    );
    await expect(fs.stat(opened.fixture.path("variant"))).rejects.toThrow();
    // element.update: B keeps its validity, so even a new title is refused.
    expect(await failure(opened, "element.update", { ref: B, title: "North" })).toEqual(
      refused(NESTED_B, "element.update", [B]),
    );
    // element.bulkUpdate: the preview names the element at the line of the entry, the confirmation is refused.
    const bulk = { selection: { ids: [C] }, property: "validity", operation: "add", value: { id: A } };
    const preview = await run(opened, "element.bulkUpdate", bulk);
    expect(preview.problems.filter((p) => p.code === "variant.nested")).toEqual([
      {
        code: "variant.nested",
        severity: "warning",
        message:
          "Property Validity (validity) of Variant VAR-0000c3 names Variant VAR-0000a1, but a variant builds only on the core (D-020)",
        repository: "system",
        file: FILE_C,
        line: 9,
        elementId: C,
        elementShortId: "VAR-0000c3",
        targetId: A,
      },
    ]);
    expect(await failure(opened, "element.bulkUpdate", { ...bulk, confirm: true })).toEqual(
      refused(
        "Property Validity (validity) of Variant VAR-0000c3 names Variant VAR-0000a1, but a variant builds only on the core (D-020)",
        "element.bulkUpdate",
        [C],
      ),
    );
    expect(await Promise.all([FILE_B, FILE_C].map((f) => read(opened, f)))).toEqual(before);
    // Only the validity decides: C relates to A and is written; B without its validity is too.
    expect((await run(opened, "element.update", { ref: C, title: "Mountains" })).files).toEqual([FILE_C]);
    const fixed = await run(opened, "element.update", { ref: B, unset: ["validity"] });
    expect([fixed.files, fixed.element.relations.map((r) => r.kind)]).toEqual([[FILE_B], ["relates-to"]]);
  });

  it("[SR-039/AK2] in the standard model a variant has no validity, so the case does not arise", async () => {
    const opened = await open({ fixture: "SR-040/validity" });
    expect(
      await failure(opened, "element.create", { type: "variant", title: "x", properties: { validity: [] } }),
    ).toMatchObject({ code: "input.invalid" });
    const out = await run(opened, "element.bulkUpdate", {
      selection: { where: { type: ["variant"] } },
      property: "validity",
      operation: "add",
      value: { id: "40a0e000-0000-4000-8000-a1a1a1a1a1a1" },
    });
    expect([out.count, out.skipped.length, out.problems]).toEqual([0, 3, []]);
  });

  it("[SR-039/AK3] workspace.check and hint.list report a hand-written validity of a variant at its line", async () => {
    const opened = await nested({
      // An entry whose target is no element of the workspace, and one that names none.
      "variants/VAR-0000000000d4.md": `---\nid: 39039039-0000-4000-8000-0000000000d4\ntype: variant\nstatus: draft\ntitle: Desert\nvalidity:\n  - { id: 39039039-0000-4000-8000-0000000000ff }\n  - Coast\n---\n`,
    });
    const hint = {
      code: "variant.nested",
      severity: "warning",
      message: NESTED_B,
      repository: "system",
      file: FILE_B,
      line: 7,
      elementId: B,
      elementShortId: "VAR-0000b2",
      targetId: A,
    };
    const desert = (line: number, named: string): unknown => ({
      code: "variant.nested",
      severity: "warning",
      message: `Property Validity (validity) of Variant VAR-0000d4 names ${named}, but a variant builds only on the core (D-020)`,
      repository: "system",
      file: "variants/VAR-0000000000d4.md",
      line,
      elementId: "39039039-0000-4000-8000-0000000000d4",
      elementShortId: "VAR-0000d4",
    });
    const expected = [hint, desert(7, "39039039-0000-4000-8000-0000000000ff"), desert(8, "no element")];
    const checked = await run(opened, "workspace.check", {});
    expect(checked.problems.filter((p) => p.code === "variant.nested")).toEqual(expected);
    const listed = await run(opened, "hint.list", { kind: ["variant.nested"] });
    expect(listed.hints).toEqual(expected);
    const shown = await run(opened, "element.get", { ref: B });
    expect((shown.element.problems ?? []).filter((p) => p.code === "variant.nested")).toEqual([hint]);
  });

  it("gives no hint while the metamodel is not valid", async () => {
    const opened = await nested({ "metamodel/model.yaml": "reqseq-metamodel: 1\ntypes: nope\n" });
    expect(await opened.workspace.get(nestedVariantsState)).toEqual([]);
  });
});
