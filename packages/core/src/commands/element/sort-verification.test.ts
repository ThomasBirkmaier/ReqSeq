// element.list sorted by the verification status (SR-075 AK5) on fixtures/SR-136/graph, with a variant
// Coast (f001) and a requirement b099 valid only in it. The elements listed, in store order: the need
// a001 and the package d001 (no verification status), b001 verified, b007 failed, b008 outdated,
// b009 open, b099 (none in the core, open in Coast), b101 indirect. Coast has no records: every
// requirement in it is open.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { resolveSelection, sortElements } from "../../query/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type ListOutput = CommandOutput<"element.list">;

const U = (tail: string): string => `37373737-3737-4737-8737-00000000${tail}`;

const COAST = U("f001");

/** fixtures/SR-136/graph with the variant Coast and b099, valid only in it. */
const IN_VARIANT_ONLY: Readonly<Record<string, string>> = {
  "variants/VAR-00000000f001.md": `---\nid: ${COAST}\ntype: variant\nstatus: draft\ntitle: Coast\n---\n`,
  "requirements/SR-00000000b099.md":
    `---\nid: ${U("b099")}\ntype: system-requirement\nstatus: draft\n` +
    "title: Show the tide\nrequirement-type: functional\nacceptance-criteria:\n  - Given the tide, then it shows.\n" +
    `validity:\n  - { id: ${COAST}, version: n1:0000000000000000 }\n` +
    `derives-from:\n  - { id: ${U("a001")}, version: n1:0000000000000000 }\n---\n`,
};

const LISTED = ["a001", "d001", "b001", "b007", "b008", "b009", "b099", "b101"];

const open = async (): Promise<Workspace> => {
  const made = await createFixtureWorkspace({ fixture: "SR-136/graph", files: IN_VARIANT_ONLY });
  onTestFinished(() => made.cleanup());
  const workspace = new Workspace(made.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const SELECTION = { ids: LISTED.map(U) };

/** The tails of the UUIDs of the rows. */
const tails = (output: ListOutput): string[] =>
  (output.elements ?? []).map((element) => element.id.slice(-4));

const sorted = async (workspace: Workspace, input: Record<string, unknown>): Promise<string[]> =>
  tails(
    (await invoke(
      "element.list",
      { selection: SELECTION, limit: 5000, ...input },
      { workspace },
    )) as ListOutput,
  );

describe("element.list sorted by the verification status (SR-075 AK5)", () => {
  it("[SR-075/AK-c3cc] sorts failed, open, outdated, verified ascending and the reverse descending, indirect as verified, elements without a status last in both orders", async () => {
    const workspace = await open();
    expect(await sorted(workspace, { sort: [{ by: "verification" }] })).toEqual([
      "b007",
      "b009",
      "b008",
      "b001",
      "b101",
      "a001",
      "d001",
      "b099",
    ]);
    expect(await sorted(workspace, { sort: [{ by: "verification", order: "desc" }] })).toEqual([
      "b001",
      "b101",
      "b008",
      "b009",
      "b007",
      "a001",
      "d001",
      "b099",
    ]);
  });

  it("[SR-075/AK-c3cc] gives equal statuses to the next key, then the workspace order (AK1)", async () => {
    const workspace = await open();
    // verified (b001) and indirect (b101) are equal; so are the three without a status.
    expect(await sorted(workspace, { sort: [{ by: "verification" }, { by: "id", order: "desc" }] })).toEqual([
      "b007",
      "b009",
      "b008",
      "b101",
      "b001",
      "b099",
      "d001",
      "a001",
    ]);
    const first = await sorted(workspace, { sort: [{ by: "verification" }] });
    expect(await sorted(workspace, { sort: [{ by: "verification" }] })).toEqual(first);
  });

  it("[SR-075/AK-c3cc] sorts in the view of the selection, the core without one", async () => {
    const workspace = await open();
    // In the core b099 has no status (not in its view, SR-137 AK4): last. In Coast every requirement is open.
    expect((await sorted(workspace, { sort: [{ by: "verification" }] })).at(-1)).toBe("b099");
    expect(
      await sorted(workspace, { selection: { ...SELECTION, view: COAST }, sort: [{ by: "verification" }] }),
    ).toEqual(["b001", "b007", "b008", "b009", "b099", "b101", "a001", "d001"]);
  });

  it("[SR-075/AK-c3cc] sorts by the stored sort of a saved filter, inside groups and in the rows of trace.matrix as element.list does", async () => {
    const workspace = await open();
    const sort = [{ by: "verification", order: "desc" }];
    const listed = await sorted(workspace, { sort });
    const where = { type: ["need", "package", "system-requirement"] };
    await invoke("filter.save", { name: "by verification", where, sort }, { workspace });
    expect(await sorted(workspace, { selection: { ...SELECTION, filter: "by verification" } })).toEqual(
      listed,
    );
    // Grouped by type in metamodel order: the need, the requirements in the order of the sort, the package.
    expect(await sorted(workspace, { sort, group: "type" })).toEqual([
      "a001",
      "b001",
      "b101",
      "b008",
      "b009",
      "b007",
      "b099",
      "d001",
    ]);
    const matrix = (await invoke(
      "trace.matrix",
      { selection: SELECTION, sort, limit: 5000 },
      { workspace },
    )) as CommandOutput<"trace.matrix">;
    expect(matrix.rows.map((row) => row.id.slice(-4))).toEqual(listed);
  });

  it("refuses to sort by verification without the statuses read for it (sortValuesFor)", async () => {
    const workspace = await open();
    const readOutputElements = (): Promise<never> => Promise.reject(new Error("no selection.output here"));
    const selected = await resolveSelection({ workspace, readOutputElements }, {}, "element.list");
    const keys = [{ by: "verification", order: "asc" }] as const;
    // Checking the keys reads no value (filter.save, perspective.save).
    expect(sortElements({ ...selected, command: "element.list" }, [], keys).elements).toEqual([]);
    expect(() => sortElements({ ...selected, command: "element.list" }, selected.elements, keys)).toThrow(
      "a sort by verification needs context.values.verification",
    );
  });
});
