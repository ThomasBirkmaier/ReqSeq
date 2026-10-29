import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { CommandError } from "../catalog.js";
import { metamodelState, STANDARD_MODEL_TEXT } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { childrenOf } from "./graph.js";
import type { DerivationGraph } from "./graph.js";
import { closedCycle, upwardGraph } from "./new-cycle.js";

/** fixtures/SR-090/cycle: A -> the need and B, B -> C, C -> A (the cycle), D -> A. */
const P = "5e9c0a7d-2b4f-4c61-9d08-0";
const NEED = `${P}a0000000001`;
const A = `${P}b0000000001`;
const B = `${P}b0000000002`;
const C = `${P}b0000000003`;
const D = `${P}b0000000004`;

const open = async (options: FixtureOptions = { fixture: "SR-090/cycle" }): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const graphOf = async (workspace: Workspace): Promise<DerivationGraph> =>
  upwardGraph(
    {
      layout: await workspace.get(workspaceLayoutState),
      metamodel: await workspace.get(metamodelState),
      store: await workspace.get(elementStoreState),
    },
    "relation.add",
  );

const record = (graph: DerivationGraph, id: string): ElementRecord => {
  const [found] = graph.store.byId.get(id) ?? [];
  if (found === undefined) {
    throw new Error(`no element ${id}`);
  }
  return found;
};

describe("closedCycle: the cycle one derivation relation closes (SR-067 AK3)", () => {
  it("gives the elements from the child up and the edges, the relation first", async () => {
    const graph = await graphOf(await open());
    // C's relation to A (derives-from, item 0) closes A -> B -> C -> A.
    const [cycle, ...more] = closedCycle(graph, record(graph, C), "derives-from", 0);
    expect(more).toEqual([]);
    expect(cycle?.elements.map((e) => e.id)).toEqual([C, A, B]);
    expect(cycle?.edges.map((e) => [e.from.id, e.to.id, e.link.key, e.link.index])).toEqual([
      [C, A, "derives-from", 0],
      [A, B, "derives-from", 1],
      [B, C, "derives-from", 0],
    ]);
  });

  it("takes any record of the child's file and gives the store's records", async () => {
    const graph = await graphOf(await open());
    const copy = { ...record(graph, C) };
    const [cycle] = closedCycle(graph, copy, "derives-from", 0);
    expect(cycle?.elements[0]).toBe(record(graph, C));
    expect(cycle?.edges[0]?.from).toBe(record(graph, C));
    expect(cycle?.edges[0]?.link.source).toBe(record(graph, C));
  });

  it("gives none for a relation that closes no cycle, another item or an item that is no edge", async () => {
    const graph = await graphOf(await open());
    // D derives from A, which never leads back to D.
    expect(closedCycle(graph, record(graph, D), "derives-from", 0)).toEqual([]);
    // A's relation to the need: the need has no parents.
    expect(closedCycle(graph, record(graph, A), "derives-from", 0)).toEqual([]);
    // No item there, or under another key.
    expect(closedCycle(graph, record(graph, C), "derives-from", 5)).toEqual([]);
    expect(closedCycle(graph, record(graph, C), "refines", 0)).toEqual([]);
    expect(graph.store.byId.has(NEED)).toBe(true);
  });

  it("gives a cycle of one element for a relation of an element to itself", async () => {
    const self = `---\nid: ${D}\ntype: system-requirement\nstatus: draft\ntitle: D\nrefines:\n  - { id: ${D}, version: n1:1111111111111111 }\n---\n`;
    const graph = await graphOf(
      await open({ fixture: "SR-090/cycle", files: { "requirements/SR-0b0000000004.md": self } }),
    );
    const [cycle] = closedCycle(graph, record(graph, D), "refines", 0);
    expect(cycle?.elements.map((e) => e.id)).toEqual([D]);
    expect(cycle?.edges.map((e) => [e.from.id, e.to.id])).toEqual([[D, D]]);
  });
});

describe("upwardGraph: the derivation graph without the incoming index", () => {
  it("finds no children: it is for walks up only", async () => {
    const graph = await graphOf(await open());
    expect(childrenOf(graph, record(graph, A)).steps).toEqual([]);
    expect(graph.kinds.map((k) => k.key)).toEqual(["refines", "derives-from"]);
  });

  it("throws metamodel.meaning-unassigned when no relation kind has the meaning derivation (SR-013 AK3)", async () => {
    const workspace = await open({
      fixture: "SR-090/cycle",
      files: { "metamodel/standard-model.yaml": STANDARD_MODEL_TEXT.replaceAll("meaning: derivation", "") },
    });
    const error = await graphOf(workspace).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).code).toBe("metamodel.meaning-unassigned");
  });
});
