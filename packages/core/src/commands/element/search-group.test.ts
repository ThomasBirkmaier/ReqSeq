// element.search grouped (SR-149 AK6) on fixtures/SR-149/group (see group.test.ts for its elements):
// the hits are grouped as element.list groups the same elements, and inside each group they keep the
// order of the search. The grouping rules themselves are tested in group.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type { FullList } from "../list.test-helper.js";

type Output = CommandOutput<"element.search">;

const P = "14914914-0000-4000-8000-0000000000";
const B1 = `${P}b1`;
const SR = { where: { type: ["system-requirement"] } };

const open = async (): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-149/group" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const search = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.search", input, { workspace })) as Output;

const tail = (id: string): string => id.slice(P.length);

/** The groups as `heading: hits` lines, the hits named by the tail of their UUID. */
const groupLines = (output: Output): string[] =>
  (output.groups ?? []).map((group) => {
    const start = group.offset - (output.offset ?? 0);
    const rows = output.hits.slice(Math.max(0, start), Math.max(0, start + group.count));
    return `${group.value === undefined ? "-" : String(group.value)}: ${rows.map((hit) => tail(hit.id)).join(" ")}`;
  });

/**
 * The groups element.list gives the same elements by `group`, each with the hits of `order` in it,
 * in that order: what a grouped search must give (AK6).
 */
const expected = async (
  workspace: Workspace,
  order: readonly string[],
  group: string,
  selection: Record<string, unknown> = {},
): Promise<string[]> => {
  const listed = (await invoke(
    "element.list",
    { selection: { ...selection, ids: [...order] }, group, limit: 5000 },
    { workspace },
  )) as FullList;
  return (listed.groups ?? []).map((head) => {
    const members = new Set(listed.elements.slice(head.offset, head.offset + head.count).map((e) => e.id));
    const hits = order.filter((id) => members.has(id)).map(tail);
    return `${head.value === undefined ? "-" : String(head.value)}: ${hits.join(" ")}`;
  });
};

describe("element.search grouped (SR-149 AK6)", () => {
  it("[SR-149/AK-byyt] groups the hits as any list by package, and keeps their relevance order inside each group", async () => {
    const workspace = await open();
    const plain = await search(workspace, { query: "wind" });
    const order = plain.hits.map((hit) => hit.id);
    const grouped = await search(workspace, { query: "wind", group: "package" });
    expect(groupLines(grouped)).toEqual(await expected(workspace, order, "package"));
    // Relevance puts b2 ("Show the wind") before b1, against the store order b1, b2.
    expect(order.map(tail)).toEqual(["b2", "b1", "d1", "a1", "b3"]);
    expect(groupLines(grouped)).toEqual(["PKG-0000d2: b1", "PKG-0000d1: b2 b1", "-: d1 a1 b3"]);
    // b1 is in two packages; b3 names only d9, not in the workspace.
    expect(
      grouped.groups?.map((group) => group.value ?? `- (${String(group.unavailable)} unavailable)`),
    ).toEqual(["PKG-0000d2", "PKG-0000d1", "- (1 unavailable)"]);
    expect(grouped.hits.filter((hit) => hit.id === B1)).toHaveLength(2);
    expect([grouped.total, grouped.rows, grouped.offset]).toEqual([plain.total, plain.total + 1, 0]);
    // Each row is the hit as the search without groups gives it.
    const byId = new Map(plain.hits.map((hit) => [hit.id, hit]));
    for (const hit of grouped.hits) {
      expect(hit).toEqual(byId.get(hit.id));
    }
  });

  it("[SR-149/AK-byyt] groups the hits within a filter by status and by a choice property", async () => {
    const workspace = await open();
    const order = (await search(workspace, { query: "wind", selection: SR })).hits.map((hit) => hit.id);
    for (const group of ["status", "area", "type"]) {
      const grouped = await search(workspace, { query: "wind", selection: SR, group });
      expect(groupLines(grouped)).toEqual(await expected(workspace, order, group, SR));
      expect(grouped.total).toBe(order.length);
    }
  });

  it("pages over the rows of the groups: a page starting inside a group, and one past the last row", async () => {
    const workspace = await open();
    const all = await search(workspace, { query: "wind", group: "package" });
    const page = await search(workspace, { query: "wind", group: "package", offset: 1, limit: 2 });
    expect(page.hits).toEqual(all.hits.slice(1, 3));
    expect([page.offset, page.rows, page.groups]).toEqual([1, all.rows, all.groups]);
    const past = await search(workspace, { query: "wind", group: "package", offset: 50 });
    expect([past.hits, past.rows, past.total]).toEqual([[], all.rows, all.total]);
  });

  it("gives no group for a query without hits, and refuses a key it cannot group by whatever the query finds", async () => {
    const workspace = await open();
    expect(await search(workspace, { query: "zzzzzz", group: "status" })).toEqual({
      hits: [],
      groups: [],
      offset: 0,
      rows: 0,
      total: 0,
      incomplete: false,
    });
    for (const query of ["wind", "zzzzzz", "--"]) {
      const error = await search(workspace, { query, group: "title" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CommandError);
      expect(error).toMatchObject({ code: "input.invalid" });
      expect((error as CommandError).message).toContain("group");
    }
  });
});

describe("element.search within a filter (SR-124 AK4)", () => {
  it("[SR-124/AK-mtm9] a filter narrows the hits, and those left keep their relevance order", async () => {
    const workspace = await open();
    const order = (await search(workspace, { query: "wind" })).hits.map((hit) => tail(hit.id));
    const filtered = await search(workspace, { query: "wind", selection: { where: { status: ["draft"] } } });
    const left = filtered.hits.map((hit) => tail(hit.id));
    expect(left.length).toBeGreaterThan(1);
    expect(left.length).toBeLessThan(order.length);
    expect(left).toEqual(order.filter((id) => left.includes(id)));
    expect(filtered.hits.every((hit) => hit.status === "draft")).toBe(true);
  });
});
