// element.list and element.search with `withVerification` (SR-137) on fixtures/SR-136/graph, against
// element.get, evidence.degree and the nodes of trace.graph (SR-136): each row shows what the element's
// node shows of its verification, in the view of the selection.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type ListOutput = CommandOutput<"element.list">;
type SearchOutput = CommandOutput<"element.search">;
type Row = NonNullable<ListOutput["rowVerification"]>[number];

const U = (tail: string): string => `37373737-3737-4737-8737-00000000${tail}`;

/** fixtures/SR-136/graph with a variant f001 and a requirement b099 valid only in it, deriving from a001. */
const IN_VARIANT_ONLY: Readonly<Record<string, string>> = {
  "variants/VAR-00000000f001.md":
    "---\nid: 37373737-3737-4737-8737-00000000f001\ntype: variant\nstatus: draft\ntitle: Coast\n---\n",
  "requirements/SR-00000000b099.md":
    "---\nid: 37373737-3737-4737-8737-00000000b099\ntype: system-requirement\nstatus: draft\n" +
    "title: Show the tide\nrequirement-type: functional\nacceptance-criteria:\n  - Given the tide, then it shows.\n" +
    "validity:\n  - { id: 37373737-3737-4737-8737-00000000f001, version: n1:0000000000000000 }\n" +
    "derives-from:\n  - { id: 37373737-3737-4737-8737-00000000a001, version: n1:0000000000000000 }\n---\n",
};

const open = async (fixture = "SR-136/graph"): Promise<Workspace> => {
  const made = await createFixtureWorkspace({ fixture });
  onTestFinished(() => made.cleanup());
  const workspace = new Workspace(made.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const list = async (workspace: Workspace, input: Record<string, unknown>): Promise<ListOutput> =>
  (await invoke(
    "element.list",
    { withVerification: true, limit: 5000, ...input },
    { workspace },
  )) as ListOutput;

/** The rows as `[short ID, what the row shows]`. */
const rowsOf = (output: ListOutput): [string, Row | undefined][] =>
  (output.elements ?? []).map((element, at) => [element.shortId, output.rowVerification?.[at]]);

/** What the node of `id` in trace.graph carries of its verification, as a row has it. */
const nodeOf = async (workspace: Workspace, id: string, view?: string): Promise<Row> => {
  const output = (await invoke(
    "trace.graph",
    { ref: id, maxDepth: 0, ...(view === undefined ? {} : { view }) },
    { workspace },
  )) as CommandOutput<"trace.graph">;
  const node = output.nodes[0];
  return {
    ...(node?.verification === undefined ? {} : { verification: node.verification }),
    ...(node?.criteria === undefined ? {} : { criteria: node.criteria }),
    ...(node?.degree === undefined ? {} : { degree: node.degree }),
  };
};

describe("element.list and element.search: the verification of the rows (SR-137)", () => {
  it("[SR-137/AK1] each requirement row gives its status in the view as element.get gives it, indirect as such", async () => {
    const workspace = await open();
    const output = await list(workspace, {});
    expect(output.rowVerification).toHaveLength(output.elements?.length ?? -1);
    const statuses = new Set<string>();
    for (const [at, element] of (output.elements ?? []).entries()) {
      const got = (await invoke(
        "element.get",
        { ref: element.id },
        { workspace },
      )) as CommandOutput<"element.get">;
      const core = got.element.verification?.filter((entry) => entry.view === "core");
      expect([element.shortId, output.rowVerification?.[at]?.verification]).toEqual([element.shortId, core]);
      for (const entry of core ?? []) {
        statuses.add(entry.status);
      }
    }
    expect([...statuses].sort()).toEqual(["failed", "indirect", "open", "outdated", "verified"]);
    // Without the flag nothing is asked, and nothing is given.
    expect((await list(workspace, { withVerification: false })).rowVerification).toBeUndefined();
  });

  it("[SR-137/AK1] a list seen through a variant gives the status in that view", async () => {
    const workspace = await open("SR-111/graph");
    const P = "5e111a7d-2b4f-4c61-9d08-";
    const GG1 = `${P}0c0000000005`;
    const V1 = `${P}0f0000000001`;
    const at = (output: ListOutput): Row | undefined =>
      output.rowVerification?.[(output.elements ?? []).findIndex((element) => element.id === GG1)];
    expect(at(await list(workspace, {}))?.verification).toBeUndefined();
    const inV1 = await list(workspace, { selection: { view: V1 } });
    expect(at(inV1)?.verification?.[0]?.view).toBe(V1);
    expect(at(inV1)).toEqual(await nodeOf(workspace, GG1, V1));
  });

  it("[SR-137/AK4] without a variant each row shows the status in the core, one not in the core's view none and no ring; with one, in its view", async () => {
    const made = await createFixtureWorkspace({ fixture: "SR-136/graph", files: IN_VARIANT_ONLY });
    onTestFinished(() => made.cleanup());
    const workspace = new Workspace(made.root);
    onTestFinished(() => workspace.close());
    const [b001, b099, coast] = [U("b001"), U("b099"), U("f001")];
    const rowOf = (output: ListOutput, id: string): Row | undefined =>
      output.rowVerification?.[(output.elements ?? []).findIndex((element) => element.id === id)];
    const core = await list(workspace, {});
    expect([rowOf(core, b001)?.verification?.map((v) => v.view), rowOf(core, b001)?.criteria]).toEqual([
      ["core"],
      { verified: 1, total: 1 },
    ]);
    expect(rowOf(core, b099)).toEqual({});
    const inCoast = await list(workspace, { selection: { view: coast } });
    expect(rowOf(inCoast, b001)?.verification?.map((v) => v.view)).toEqual([coast]);
    expect(rowOf(inCoast, b099)).toEqual({
      verification: [{ view: coast, status: "open" }],
      criteria: { verified: 0, total: 1, notVerified: [1] },
    });
  });

  it("[SR-137/AK2] the statuses of a package's requirement rows count as its verification degree", async () => {
    const workspace = await open();
    // The rows of a package page ask with `where`, its degree line with `package` (app/package-page.ts).
    const output = await list(workspace, { selection: { where: { package: U("d001") } } });
    const degree = (await invoke(
      "evidence.degree",
      { selection: { package: "PKG-00d001" } },
      { workspace },
    )) as CommandOutput<"evidence.degree">;
    const counts = { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 };
    for (const row of output.rowVerification ?? []) {
      const status = row.verification?.[0]?.status;
      if (status !== undefined) {
        counts[status] += 1;
      }
    }
    expect(counts).toEqual(degree.degree.counts);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(degree.degree.total);
  });

  it("[SR-137/AK3] each row shows the progress ring of the element's node in the graph, and none where the node has none", async () => {
    const workspace = await open();
    const output = await list(workspace, {});
    const rows = rowsOf(output);
    for (const [at, element] of (output.elements ?? []).entries()) {
      expect([element.shortId, output.rowVerification?.[at]]).toEqual([
        element.shortId,
        await nodeOf(workspace, element.id),
      ]);
    }
    const byId = new Map((output.elements ?? []).map((element, at) => [element.id, rows[at]?.[1]]));
    expect(byId.get(U("b011"))?.criteria).toEqual({ verified: 2, total: 3, notVerified: [3] });
    expect(byId.get(U("a001"))?.degree?.share).toBe(0.6);
    // No ring: indirectly verified, without acceptance criteria, a need without a valid derived requirement.
    expect(byId.get(U("b101"))?.criteria).toBeUndefined();
    expect(byId.get(U("b012"))?.criteria).toBeUndefined();
    expect(byId.get(U("a002"))?.degree?.share).toBeUndefined();
    expect([...byId.values()].some((row) => row !== undefined && Object.keys(row).length === 0)).toBe(true);
  });

  it("[SR-137/AK3] gives the rows of a page, of a grouped list and of a search as their nodes", async () => {
    const workspace = await open();
    const page = await list(workspace, { limit: 3, offset: 2 });
    expect(page.rowVerification).toHaveLength(3);
    for (const [at, element] of (page.elements ?? []).entries()) {
      expect(page.rowVerification?.[at]).toEqual(await nodeOf(workspace, element.id));
    }
    const grouped = await list(workspace, { group: "type", fields: ["identifier"] });
    expect(grouped.rowVerification).toHaveLength(grouped.partial?.length ?? -1);
    for (const [at, element] of (grouped.partial ?? []).entries()) {
      expect(grouped.rowVerification?.[at]).toEqual(await nodeOf(workspace, element.id));
    }
    const search = async (input: Record<string, unknown>): Promise<SearchOutput> =>
      (await invoke(
        "element.search",
        { query: "need", withVerification: true, ...input },
        { workspace },
      )) as SearchOutput;
    for (const found of [await search({}), await search({ group: "type" })]) {
      expect(found.hits.length).toBeGreaterThan(0);
      expect(found.rowVerification).toHaveLength(found.hits.length);
      for (const [at, hit] of found.hits.entries()) {
        expect(found.rowVerification?.[at]).toEqual(await nodeOf(workspace, hit.id));
      }
    }
    const plain = (await invoke("element.search", { query: "need" }, { workspace })) as SearchOutput;
    expect(plain.rowVerification).toBeUndefined();
  });
});
