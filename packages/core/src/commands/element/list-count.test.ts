// element.list with `selection.output.count` (SR-224 AK4, #1915) on the product commands: every number the
// catalog marks as counting elements, in each entry of its lists, lists as many elements as it says when the
// list is complete, whatever page the inner input names. The check through the API with the catalog it
// gives and the identity of the elements: packages/api/src/catalog-counts.test.ts. The inner call:
// runtime/output-count.test.ts.
import type { FixtureOptions } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandError, CommandName } from "../../catalog.js";
import { getCommandRuntime, invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { FullList } from "../list.test-helper.js";

interface Field {
  readonly path: string;
  readonly elements?: unknown;
  readonly keys?: readonly (readonly string[])[];
}

/** One number of an output: its field, the key of each list it is in and its value. */
interface Instance {
  readonly field: string;
  readonly key: readonly Readonly<Record<string, unknown>>[];
  readonly value: number;
}

const isNumber = (field: Field): boolean =>
  field.elements !== undefined && field.elements !== true && field.elements !== "answer";

/** Every value at `path` of `output`, with the key of each list entry on the way (the fields `keys` names). */
const instancesAt = (output: unknown, field: Field): Instance[] => {
  const keys = field.keys ?? [];
  let at: { value: unknown; key: Readonly<Record<string, unknown>>[] }[] = [{ value: output, key: [] }];
  for (const segment of field.path.split(".")) {
    const list = segment.endsWith("[]");
    const name = list ? segment.slice(0, -2) : segment;
    at = at.flatMap(({ value, key }) => {
      const inner = (value as Record<string, unknown> | undefined)?.[name];
      if (!list) {
        return inner === undefined ? [] : [{ value: inner, key }];
      }
      const fields = keys[key.length] ?? [];
      return ((inner as readonly Record<string, unknown>[] | undefined) ?? []).map((entry) => ({
        value: entry,
        key: [
          ...key,
          Object.fromEntries(fields.filter((f) => entry[f] !== undefined).map((f) => [f, entry[f]])),
        ],
      }));
    });
  }
  return at.map(({ value, key }) => ({ field: field.path, key, value: value as number }));
};

const X = "61061061-0000-4000-8000-0000000000";
const BASELINE =
  "reqseq-baseline: 1\nname: Counts\ndate: 2026-10-23T09:00:00Z\n" +
  "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n" +
  `selection: { package: ${X}d1 }\n` +
  "elements:\n" +
  `  - { id: ${X}b1, version: n1:697a2ad17ed49170 }\n` +
  `  - { id: ${X}b2, version: n1:0000000000000000 }\n` +
  `  - { id: ${X}b4, version: n1:1e68aa41d13d05b1 }\n` +
  `  - { id: ${X}b3, version: n1:4b17a5494b8e80e5 }\n` +
  `  - { id: ${X}ff, version: n1:2222222222222222 }\n`;
const BY_PACKAGE =
  "reqseq-baseline: 1\nname: By package\ndate: 2026-10-23T09:00:00Z\n" +
  "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n" +
  `selection: { package: ${X}d1 }\n` +
  `elements:\n  - { id: ${X}b1, version: n1:697a2ad17ed49170 }\n`;
const EXPORT: FixtureOptions = {
  fixture: "SR-061/export",
  files: { "system/baselines/counts.yaml": BASELINE, "system/baselines/by-package.yaml": BY_PACKAGE },
};
/** The repository `archive` is not on this machine: its entry is inaccessible. */
const ARCHIVE: FixtureOptions = {
  fixture: "SR-061/export",
  files: {
    "system/reqseq-workspace.yaml":
      "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
      '  - { name: sensor, url: "git@git.example.com:ws/sensor.git" }\n' +
      '  - { name: archive, url: "git@git.example.com:ws/archive.git" }\n' +
      "metamodel: { repository: system, path: metamodel }\nevidence:\n  - { repository: system, path: evidence }\n",
    "system/baselines/archive.yaml":
      "reqseq-baseline: 1\nname: Archive\ndate: 2026-10-23T09:00:00Z\n" +
      "repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n" +
      `elements:\n  - { id: ${X}b1, version: n1:697a2ad17ed49170 }\n  - { id: ${X}aa, version: n1:2222222222222222, repository: archive }\n`,
  },
};
/** A need found twice (SR-088), only its copy approved: a selection holds one of the two records. */
const COPIED: FixtureOptions = {
  fixture: "SR-088/copied-file",
  files: {
    "system/copies/N-00606ccf2661.md":
      "---\nid: 948a10f1-05c3-4212-bd19-00606ccf2661\ntype: need\nstatus: approved\n" +
      "title: Wind speed visible at a glance (copy)\n---\n\nThe wind speed is visible from across the room.\n",
  },
};
const GRAPH: FixtureOptions = { fixture: "SR-136/graph" };
const GROUP: FixtureOptions = { fixture: "SR-149/group" };
const MATRIX: FixtureOptions = { fixture: "SR-125/matrix" };

/** Each read command with a number of elements, with inputs whose numbers are not all 0. */
const CASES: readonly {
  readonly options: FixtureOptions;
  readonly root?: string;
  readonly command: CommandName;
  readonly input: Record<string, unknown>;
}[] = [
  { options: GRAPH, command: "evidence.degree", input: {} },
  { options: GRAPH, command: "evidence.degree", input: { selection: { package: "PKG-00d001" } } },
  { options: GRAPH, command: "element.list", input: { withVerification: true, limit: 1 } },
  { options: GRAPH, command: "element.list", input: { withVerification: true, group: "status", limit: 1 } },
  { options: GRAPH, command: "element.search", input: { query: "weather", withVerification: true } },
  { options: GRAPH, command: "element.search", input: { query: "show", group: "package", limit: 1 } },
  { options: GROUP, command: "element.search", input: { query: "wind", group: "package", limit: 1 } },
  { options: GRAPH, command: "trace.graph", input: { ref: "N-00a001" } },
  { options: GRAPH, command: "trace.matrix", input: { limit: 1 } },
  { options: GRAPH, command: "tool.info", input: {} },
  {
    options: GRAPH,
    command: "trace.related",
    input: { refs: ["N-00a001"], direction: "children", limit: 1 },
  },
  { options: GRAPH, command: "trace.affected", input: { ref: "N-00a001", limit: 1 } },
  { options: GRAPH, command: "evidence.status", input: { limit: 1 } },
  { options: GRAPH, command: "evidence.withoutPassedTest", input: { limit: 1 } },
  { options: GRAPH, command: "workspace.check", input: {} },
  { options: GROUP, command: "element.list", input: { group: "package", limit: 1 } },
  { options: MATRIX, command: "trace.matrix", input: { limit: 1 } },
  { options: MATRIX, command: "trace.matrix", input: { kinds: ["packages", "based-on"], limit: 1 } },
  { options: EXPORT, root: "system", command: "element.facets", input: {} },
  { options: EXPORT, root: "system", command: "element.list", input: { limit: 1 } },
  { options: EXPORT, root: "system", command: "evidence.coverage", input: {} },
  {
    options: COPIED,
    root: "system",
    command: "evidence.coverage",
    input: { selection: { where: { status: ["approved"] } } },
  },
  { options: EXPORT, root: "system", command: "baseline.get", input: { baseline: "Counts", limit: 1 } },
  { options: EXPORT, root: "system", command: "baseline.get", input: { baseline: "By package" } },
  { options: EXPORT, root: "system", command: "baseline.list", input: {} },
  { options: ARCHIVE, root: "system", command: "baseline.get", input: { baseline: "Archive" } },
];

const opened = new Map<FixtureOptions, Workspace>();
const open = async (options: FixtureOptions, root = "."): Promise<Workspace> => {
  const known = opened.get(options);
  if (known !== undefined) {
    return known;
  }
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path(root));
  onTestFinished(async () => {
    opened.delete(options);
    await workspace.close();
  });
  opened.set(options, workspace);
  return workspace;
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

describe("element.list from a number of a command's output (SR-224 AK4)", () => {
  it("lists as many elements as each number counts, in each entry, over all pages", async () => {
    const counted = new Set<string>();
    const nonZero = new Set<string>();
    for (const { options, root, command, input } of CASES) {
      const workspace = await open(options, root);
      const fields = (getCommandRuntime().contracts.entry(command)?.outputFields ?? []) as readonly Field[];
      const output = await invoke(command, input, { workspace });
      for (const field of fields.filter(isNumber)) {
        counted.add(`${command} ${field.path}`);
        for (const { key, value } of instancesAt(output, field)) {
          const listed = await list(workspace, {
            selection: {
              // The paged input starts at its first page; what element.list gives does not depend on it.
              output: {
                command,
                input: "limit" in input ? { ...input, offset: 0, limit: 1 } : input,
                count: { field: field.path, key },
              },
            },
            limit: 5000,
          });
          const at = `${command} ${JSON.stringify(input)} ${field.path} ${JSON.stringify(key)}`;
          if (listed.incomplete === true) {
            expect(listed.total, at).toBeLessThanOrEqual(value);
          } else {
            expect(listed.total, at).toBe(value);
          }
          if (value > 0) {
            nonZero.add(`${command} ${field.path}`);
          }
        }
      }
    }
    // Every read command with a number, every number, each with an instance that counts something.
    const marked = getCommandRuntime()
      .contracts.commands.filter((entry) => entry.effect === "read")
      .flatMap((entry) =>
        ((entry.outputFields ?? []) as readonly Field[])
          .filter(isNumber)
          .map((f) => `${entry.name} ${f.path}`),
      );
    expect(marked.filter((name) => !counted.has(name))).toEqual([]);
    expect(marked.filter((name) => !nonZero.has(name)).sort()).toEqual([
      // No need of the fixture has an indirectly verified child.
      "element.list rowVerification[].degree.counts.indirect",
      "element.search rowVerification[].degree.counts.indirect",
      "trace.graph nodes[].degree.counts.indirect",
    ]);
  });

  it("is incomplete for the entries of a baseline that are not in the workspace, and complete for the others (#1915 F1)", async () => {
    const workspace = await open(EXPORT, "system");
    const of = async (state: string): Promise<FullList> =>
      list(workspace, {
        selection: {
          output: {
            command: "baseline.get",
            input: { baseline: "Counts" },
            count: { field: `counts.${state}` },
          },
        },
      });
    const tails = (output: FullList): string[] => output.elements.map((e) => e.id.slice(-2));
    expect([tails(await of("unchanged")), (await of("unchanged")).incomplete]).toEqual([["b1"], false]);
    expect([tails(await of("changed")), (await of("changed")).incomplete]).toEqual([["b2"], false]);
    expect(tails(await of("superseded"))).toEqual(["b4"]);
    expect(tails(await of("removed"))).toEqual(["b3"]);
    expect([tails(await of("missing")), (await of("missing")).incomplete]).toEqual([[], true]);
    expect([tails(await of("inaccessible")), (await of("inaccessible")).incomplete]).toEqual([[], false]);
  });

  it("lists a degree in the view it was counted in, and refuses another view", async () => {
    const workspace = await open(EXPORT, "system");
    const degree = (input: Record<string, unknown>, view?: string): Promise<FullList> =>
      list(workspace, {
        selection: {
          output: { command: "evidence.degree", input, count: { field: "degree.counts.verified" } },
          ...(view === undefined ? {} : { view }),
        },
        withVerification: true,
      });
    // b1 is verified in VAR-0000c1 only.
    const inC1 = await degree({ selection: { view: "VAR-0000c1" } });
    expect([inC1.elements.map((e) => e.shortId), inC1.rowVerification?.[0]?.verification?.[0]?.view]).toEqual(
      [["SR-0000b1"], `${X}c1`],
    );
    expect((await degree({ selection: { view: "VAR-0000c1" } }, "VAR-0000c1")).total).toBe(1);
    expect((await degree({})).total).toBe(0);
    const refused = await failure(degree({ selection: { view: "VAR-0000c1" } }, "core"));
    expect(refused.toJSON()).toEqual({
      code: "input.invalid",
      message:
        "selection.view: the number of selection.output is counted in another view; leave the view out or name that one",
      details: { command: "element.list", fields: ["selection.view"] },
    });
    expect((await failure(degree({}, "VAR-0000c1"))).code).toBe("input.invalid");
  });

  it("gives no elements for an entry the output does not have", async () => {
    const graph = await open(GRAPH);
    const none = async (
      workspace: Workspace,
      command: string,
      input: Record<string, unknown>,
      field: string,
      key: readonly Record<string, unknown>[],
    ): Promise<number> =>
      (await list(workspace, { selection: { output: { command, input, count: { field, key } } } })).total;
    const node = {
      id: "37373737-3737-4737-8737-00000000a001",
      repository: "system",
      file: "needs/N-00000000a001.md",
    };
    // Not a node of the graph within its limit, and a node that is no need.
    expect(
      await none(graph, "trace.graph", { ref: "SR-00b001", maxDepth: 0 }, "nodes[].degree.total", [node]),
    ).toBe(0);
    expect(
      await none(graph, "trace.graph", { ref: "N-00a001" }, "nodes[].degree.total", [{ ...node, file: "x" }]),
    ).toBe(0);
    expect(await none(graph, "trace.graph", { ref: "N-00a001" }, "nodes[].degree.total", [node])).toBe(10);
    const requirement = {
      id: "37373737-3737-4737-8737-00000000b001",
      repository: "system",
      file: "requirements/SR-00000000b001.md",
    };
    expect(await none(graph, "trace.graph", { ref: "N-00a001" }, "nodes[].degree.total", [requirement])).toBe(
      0,
    );
    // A row's degree only with the verification of the rows, and not a group of an ungrouped list.
    expect(await none(graph, "element.list", {}, "rowVerification[].degree.total", [node])).toBe(0);
    expect(await none(graph, "element.list", {}, "groups[].count", [{}])).toBe(0);
    const group = await open(GROUP);
    expect(
      await none(group, "element.list", { group: "package" }, "groups[].unavailable", [
        { value: "PKG-0000d1" },
      ]),
    ).toBe(0);
    expect(
      await none(group, "element.list", { group: "package" }, "groups[].count", [{ value: "PKG-0000ff" }]),
    ).toBe(0);
    const matrix = await open(MATRIX);
    const column = { kind: "derives-from", direction: "in" };
    expect(await none(matrix, "trace.matrix", {}, "columns[].count", [column])).toBeGreaterThan(0);
    expect(await none(matrix, "trace.matrix", {}, "columns[].expected", [column])).toBe(0);
    expect(await none(matrix, "trace.matrix", {}, "columns[].count", [{ ...column, direction: "up" }])).toBe(
      0,
    );
    expect(
      await none(matrix, "trace.matrix", {}, "columns[].count", [{ kind: "nothing", direction: "out" }]),
    ).toBe(0);
    expect(await none(group, "trace.matrix", {}, "evidence.degree.total", [])).toBe(0);
    const exported = await open(EXPORT, "system");
    expect(
      await none(exported, "baseline.list", {}, "baselines[].elements", [
        { repository: "system", file: "x" },
      ]),
    ).toBe(0);
    expect(await none(exported, "element.facets", {}, "properties[].count", [{ key: "nothing" }])).toBe(0);
    expect(
      await none(exported, "evidence.coverage", {}, "levels[].withChildren", [{ type: "nothing" }]),
    ).toBe(0);
    expect(
      await none(exported, "element.facets", {}, "properties[].values[].count", [
        { key: "requirement-type" },
        { value: "none" },
      ]),
    ).toBe(0);
    const hits = (await invoke("element.search", { query: "wind" }, { workspace: exported })) as {
      readonly total: number;
    };
    expect(await none(exported, "element.facets", { search: { query: "wind" } }, "total", [])).toBe(
      hits.total,
    );
    const share = await failure(none(exported, "evidence.degree", {}, "degree.share", []));
    expect(share.message).toBe(
      "selection.output.count.field: degree.share of evidence.degree is no number of elements; the catalog marks those in outputFields with elements",
    );
  });
});
