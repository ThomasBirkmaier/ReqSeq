// element.list with `selection.output` (SR-224 AK5, #1873, query/selection.ts) on fixtures/SR-061/export
// (its README lists the elements: a1 the need, b1 to b4 system requirements, e1 in the second
// repository sensor, the baseline "Release 1" with a1, b1, b3 and a UUID in no file). The inner call
// itself: runtime/output-elements.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandError, CommandName } from "../../catalog.js";
import { getCommandRuntime, invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { FullList } from "../list.test-helper.js";

/** A baseline that stores the selection of the package d1 and lists only b1, so b2 is added since. */
const BY_PACKAGE =
  "reqseq-baseline: 1\nname: By package\ndate: 2026-10-23T09:00:00Z\n" +
  "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n" +
  "selection: { package: 61061061-0000-4000-8000-0000000000d1 }\n" +
  "elements:\n  - { id: 61061061-0000-4000-8000-0000000000b1, version: n1:697a2ad17ed49170 }\n";

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-061/export",
    files: { "system/baselines/by-package.yaml": BY_PACKAGE, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The last two characters of each UUID, as the README names the elements. */
const tails = (elements: readonly { readonly id: string }[]): string[] => elements.map((e) => e.id.slice(-2));

/** Every command whose output marks a field `x-elements: "answer"`, with an input that gives more than one page. */
const ANSWERS: readonly { readonly command: CommandName; readonly input: Record<string, unknown> }[] = [
  { command: "element.list", input: { selection: { where: { type: ["system-requirement"] } } } },
  { command: "element.search", input: { query: "the" } },
  { command: "element.search", input: { query: "the", group: "type" } },
  { command: "trace.affected", input: { ref: "N-0000a1" } },
  { command: "trace.related", input: { refs: ["N-0000a1"], direction: "children" } },
  { command: "baseline.get", input: { baseline: "Release 1" } },
  { command: "evidence.status", input: { selection: { package: "PKG-0000d1" } } },
  { command: "evidence.status", input: {} },
  { command: "evidence.withoutPassedTest", input: {} },
];

/** The path of the field of `command` the catalog marks as the elements of its result. */
const answerField = (command: CommandName): string => {
  const fields = getCommandRuntime().contracts.entry(command)?.outputFields ?? [];
  const field = fields.find((f) => f.elements === "answer");
  if (field === undefined) {
    throw new Error(`${command} marks no field x-elements "answer"`);
  }
  return field.path;
};

/** The elements of `command`'s marked field over all its pages, one element a page. */
const allPages = async (
  workspace: Workspace,
  command: CommandName,
  input: Record<string, unknown>,
): Promise<{ readonly ids: Set<string>; readonly pages: number }> => {
  const field = answerField(command);
  const ids = new Set<string>();
  let pages = 0;
  for (let offset = 0; ; offset += 1) {
    const output = (await invoke(command, { ...input, offset, limit: 1 }, { workspace })) as Record<
      string,
      readonly { readonly id: string }[]
    >;
    const page = output[field] ?? [];
    if (page.length === 0) {
      return { ids, pages };
    }
    pages += 1;
    for (const element of page) {
      ids.add(element.id);
    }
  }
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<FullList> =>
  (await invoke("element.list", input, { workspace })) as FullList;

const failure = async (promise: Promise<unknown>): Promise<CommandError> =>
  promise.then(
    () => {
      throw new Error("expected an error");
    },
    (e: unknown) => e as CommandError,
  );

describe("element.list from the output of a command (SR-224 AK5)", () => {
  it("[SR-224/AK-v2bx] gives exactly the elements of the command's result over all its pages, whatever page its input names", async () => {
    const workspace = await open();
    const all = (await list(workspace, { limit: 5000 })).elements;
    const store = tails(all);
    const inStore = new Set(all.map((e) => e.id));
    for (const { command, input } of ANSWERS) {
      const { ids, pages } = await allPages(workspace, command, input);
      expect(pages, `${command} has more than one page`).toBeGreaterThan(1);
      const listed = await list(workspace, {
        selection: { output: { command, input: { ...input, offset: 1, limit: 1 } } },
        limit: 5000,
      });
      // A page of baseline.get also holds the entry that is in no file, which no list holds (assumption of #1932).
      const present = new Set([...ids].filter((id) => inStore.has(id)));
      expect(new Set(listed.elements.map((e) => e.id)), command).toEqual(present);
      expect(listed.total, command).toBe(present.size);
      // In store order, as every selection.
      const shown = tails(listed.elements);
      expect(shown, command).toEqual(store.filter((tail) => shown.includes(tail)));
    }
  });

  it("lists the copies of a baseline that are in the workspace and is incomplete for the entry that is in no file (#1932)", async () => {
    const workspace = await open();
    const listed = await list(workspace, {
      selection: { output: { command: "baseline.get", input: { baseline: "Release 1" } } },
    });
    expect(tails(listed.elements)).toEqual(["a1", "b1", "b3"]);
    // Assumption of #1932: the other elements, and the list says it is incomplete.
    expect(listed.incomplete).toBe(true);
    const added = await list(workspace, {
      selection: { output: { command: "baseline.get", input: { baseline: "By package" } } },
    });
    expect(tails(added.elements)).toEqual(["b1", "b2"]);
    expect(added.incomplete).toBe(false);
  });

  it("filters, sorts and pages the elements of the output as any list, and nests outputs", async () => {
    const workspace = await open();
    const affected = { command: "trace.affected", input: { ref: "N-0000a1" } };
    const listed = await list(workspace, {
      selection: { output: affected, where: { property: "requirement-type", op: "eq", value: "functional" } },
      sort: [{ by: "id", order: "desc" }],
      limit: 1,
    });
    expect([tails(listed.elements), listed.total]).toEqual([["b3"], 2]);
    const nested = await list(workspace, {
      selection: { output: { command: "element.list", input: { selection: { output: affected } } } },
    });
    expect(tails(nested.elements)).toEqual(["b1", "b2", "b3", "e1"]);
    // A query without a word to look for finds nothing, also over all pages.
    const none = await list(workspace, {
      selection: { output: { command: "element.search", input: { query: "!!" } } },
    });
    expect(none.total).toBe(0);
  });

  it("lists only the copy of a UUID found twice that the output holds (SR-088)", async () => {
    // A copy of b4 under another file name and title: the search finds the copy only.
    const copy =
      "---\nid: 61061061-0000-4000-8000-0000000000b4\ntype: system-requirement\nstatus: obsolete\n" +
      "title: Zebracopy\nrequirement-type: functional\n---\n\nA copy of b4.\n";
    const workspace = await open({ "system/requirements/SR-copy.md": copy });
    const search = { command: "element.search", input: { query: "Zebracopy" } };
    const hits = (await invoke("element.search", search.input, { workspace })) as {
      readonly total: number;
    };
    expect(hits.total).toBe(1);
    const listed = await list(workspace, { selection: { output: search } });
    expect(listed.elements.map((e) => [e.id.slice(-2), e.file])).toEqual([["b4", "requirements/SR-copy.md"]]);
    expect(listed.total).toBe(1);
  });

  it("is a selection of every command that takes one (baseline.create refuses it: create.test.ts)", async () => {
    const workspace = await open();
    const selection = { output: { command: "baseline.get", input: { baseline: "Release 1" } } };
    const facets = (await invoke("element.facets", { selection }, { workspace })) as {
      readonly total: number;
    };
    expect(facets.total).toBe(3);
  });

  it("refuses a write command and a command without output elements, and names the inner input's fields", async () => {
    const workspace = await open();
    const refused = async (command: string, input: Record<string, unknown>): Promise<unknown> =>
      (await failure(list(workspace, { selection: { output: { command, input } } }))).toJSON();
    expect(await refused("element.update", { ref: "SR-0000b1", title: "x" })).toEqual({
      code: "input.invalid",
      message:
        "selection.output.command: element.update writes files; selection.output runs read commands only",
      details: { command: "element.list", fields: ["selection.output.command"] },
    });
    expect(await refused("workspace.listFolder", { path: "/" })).toEqual({
      code: "input.invalid",
      message:
        'selection.output.command: workspace.listFolder lists no elements (no output field is marked x-elements "answer")',
      details: { command: "element.list", fields: ["selection.output.command"] },
    });
    // A group or sort the inner command refuses on its own is refused inside the selection too.
    for (const [command, input, field] of [
      ["element.search", { query: "the", group: "nonsense" }, "group"],
      ["element.list", { group: "nonsense" }, "group"],
      ["element.list", { sort: [{ by: "nonsense" }] }, "sort[0].by"],
    ] as const) {
      const alone = (await failure(invoke(command, input, { workspace }))).toJSON();
      expect(alone.details, command).toEqual({ command, fields: [field] });
      const under = "selection.output.input.";
      expect(await refused(command, input), command).toEqual({
        code: alone.code,
        message: `${under}${alone.message}`,
        details: { command, fields: [`${under}${field}`] },
      });
    }
    // The same holds for a count of the output (SR-224 AK4).
    const sorted = { group: "status", sort: [{ by: "nonsense" }] } as const;
    const counted = (
      await failure(
        list(workspace, {
          selection: {
            output: {
              command: "element.list",
              input: sorted,
              count: { field: "groups[].count", key: [{ value: "draft" }] },
            },
          },
        }),
      )
    ).toJSON();
    expect(counted.details).toEqual({
      command: "element.list",
      fields: ["selection.output.input.sort[0].by"],
    });
    expect(await refused("trace.affected", { ref: "SR-ffffff" })).toMatchObject({
      code: "ref.unknown",
      message: expect.stringMatching(/^selection\.output\.input: /) as unknown,
    });
  });
});
