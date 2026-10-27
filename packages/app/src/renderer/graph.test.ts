import { describe, expect, it } from "vitest";
import type { GraphDepth } from "./buffers.js";
import { graphBuffer } from "./buffers.js";
import {
  GRAPH_LIMIT,
  deeper,
  depthLabel,
  edgeClasses,
  filterLabel,
  graphInput,
  keyOfNode,
  nodeId,
  nodeKey,
  nodeLabel,
  shallower,
  spotlit,
} from "./graph.js";
import { BASED_ON, DERIVES, REFERENCE, S1_GRAPH, graphEdge, graphNode } from "./graph-test-data.js";

const buffer = graphBuffer("uuid-S1", "spec", "S1 Title S1");

describe("the input of trace.graph", () => {
  it("[SR-111/AK2] asks for the element at its depth, at most 500 nodes", () => {
    expect(GRAPH_LIMIT).toBe(500);
    expect(graphInput(buffer)).toEqual({ ref: "uuid-S1", repository: "spec", maxDepth: 1, limit: 500 });
    expect(graphInput({ ...buffer, depth: "all" })).toEqual({
      ref: "uuid-S1",
      repository: "spec",
      allLevels: true,
      limit: 500,
    });
  });

  it("[SR-111/AK3] passes the kinds, meanings and view the buffer holds", () => {
    expect(
      graphInput({ ...buffer, depth: 3, kinds: ["based-on"], meanings: ["derivation"], view: "baseline" }),
    ).toEqual({
      ref: "uuid-S1",
      repository: "spec",
      maxDepth: 3,
      kinds: ["based-on"],
      meanings: ["derivation"],
      view: "baseline",
      limit: 500,
    });
  });
});

describe("depth and filter", () => {
  it("[SR-111/AK2] goes one level deeper up to 9, then the whole chain, and back", () => {
    const deep: GraphDepth[] = [1, 2, 8, 9, "all"];
    const shallow: GraphDepth[] = [1, 2, 9, "all"];
    const labelled: GraphDepth[] = [1, 2, "all"];
    expect(deep.map((depth) => deeper(depth))).toEqual([2, 3, 9, "all", "all"]);
    expect(shallow.map((depth) => shallower(depth))).toEqual([1, 1, 8, 9]);
    expect(labelled.map((depth) => depthLabel(depth))).toEqual(["1 level", "2 levels", "whole chain"]);
  });

  it("names the kinds followed only when some are chosen", () => {
    expect(filterLabel(buffer)).toBeUndefined();
    expect(filterLabel({ ...buffer, meanings: ["derivation"], kinds: ["based-on"] })).toBe(
      "only derivation, based-on",
    );
    expect(filterLabel({ ...buffer, kinds: ["packages"] })).toBe("only packages");
    expect(filterLabel({ ...buffer, meanings: [] })).toBe("nothing followed");
  });
});

describe("what a node shows", () => {
  it("[SR-111/AK4] is named by its identifier, else its short ID, with its type, title and marks", () => {
    const [s1, , , pkg, o1] = S1_GRAPH.nodes;
    expect(nodeKey("spec", "uuid-S1")).toBe("spec:uuid-S1");
    expect(keyOfNode(graphNode("C1", 1))).toBe("spec:uuid-C1");
    expect(s1 === undefined ? "" : nodeId(s1)).toBe("S1");
    expect(pkg === undefined ? "" : nodeId(pkg)).toBe("PKG-1");
    expect(o1 === undefined ? "" : nodeLabel(o1, "System Requirement")).toBe(
      "O1 System Requirement Title O1 superseded no evidence",
    );
  });

  it("draws derivations darker, references dashed, outdated links in the accent and the selected ones in the text colour", () => {
    expect(edgeClasses([graphEdge("A", "B")], false)).toBe("graph-edge derivation");
    expect(edgeClasses([graphEdge("A", "B", BASED_ON)], true)).toBe("graph-edge selected");
    expect(edgeClasses([graphEdge("A", "B", REFERENCE)], false)).toBe("graph-edge reference");
    expect(
      edgeClasses(
        [graphEdge("A", "B", REFERENCE), graphEdge("A", "B", { ...DERIVES, outdated: true })],
        false,
      ),
    ).toBe("graph-edge derivation outdated");
  });

  it("lights up the selected node's links only when some drawn link does not touch it", () => {
    const fan = [
      { source: "C1", target: "S1" },
      { source: "S1", target: "P" },
    ];
    // Every link touches S1 (a graph of depth 1): nothing is lit up.
    expect(spotlit(fan, "S1")).toBe(false);
    // A link between two other nodes: S1's links stand out.
    expect(spotlit([...fan, { source: "G", target: "C1" }], "S1")).toBe(true);
    // Selected elsewhere, the links of C1 stand out among S1's.
    expect(spotlit(fan, "C1")).toBe(true);
    expect(spotlit([], "S1")).toBe(false);
  });
});
