import { describe, expect, it } from "vitest";
import type { GraphDepth } from "./buffers.js";
import { graphBuffer } from "./buffers.js";
import {
  GRAPH_LIMIT,
  accentStatus,
  deeper,
  depthLabel,
  edgeClasses,
  edgeLines,
  evidenceText,
  filterLabel,
  graphInput,
  keyOfNode,
  nodeId,
  nodeKey,
  nodeLabel,
  ringOf,
  shallower,
  spotlit,
  statusOf,
} from "./graph.js";
import {
  BASED_ON,
  DERIVES,
  REFERENCE,
  S1_GRAPH,
  VERIFIED_GRAPH,
  graphEdge,
  graphNode,
} from "./graph-test-data.js";

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

  it("[SR-111/AK3] asks for the evidence while the buffer shows it", () => {
    expect(graphInput({ ...buffer, kinds: [], withEvidence: true })).toEqual({
      ref: "uuid-S1",
      repository: "spec",
      maxDepth: 1,
      kinds: [],
      withEvidence: true,
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

  it("[SR-111/AK3] names the evidence after the kinds, by the name of its entry", () => {
    const evidence = [{ name: "Nachweise", filter: { withEvidence: true as const } }];
    expect(filterLabel({ ...buffer, kinds: [], withEvidence: true })).toBe("only Evidence");
    expect(filterLabel({ ...buffer, kinds: [], withEvidence: true }, evidence)).toBe("only Nachweise");
    expect(filterLabel({ ...buffer, meanings: ["derivation"], withEvidence: true })).toBe(
      "only derivation, Evidence",
    );
    // Every link and the evidence.
    expect(filterLabel({ ...buffer, withEvidence: true })).toBe("with Evidence");
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
      "O1 System Requirement Title O1 superseded",
    );
  });

  it("[SR-111/AK3] sums up the evidence below a node with the counts of the CLI, and the node's name says it", () => {
    const summary = {
      id: "uuid-S1",
      repository: "spec",
      level: 1,
      testCases: 2,
      records: 1,
      results: { passed: 2, failed: 1 },
    };
    expect(evidenceText(summary)).toBe("evidence · 2 test cases, 1 record · 2 passed, 1 failed");
    expect(evidenceText({ ...summary, testCases: 1, records: 0, results: { skipped: 1 } })).toBe(
      "evidence · 1 test case · 1 skipped",
    );
    expect(evidenceText({ ...summary, testCases: 0, records: 2, results: {} })).toBe("evidence · 2 records");
    const [s1] = S1_GRAPH.nodes;
    expect(s1 === undefined ? "" : nodeLabel(s1, "System Requirement", summary)).toBe(
      "S1 System Requirement Title S1 outdated evidence · 2 test cases, 1 record · 2 passed, 1 failed",
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

  it("lights up the selected node's links only when they are at most half of the drawn links", () => {
    const fan = [
      { source: "C1", target: "S1" },
      { source: "C2", target: "S1" },
      { source: "S1", target: "P" },
    ];
    // Every link touches S1 (a graph of depth 1): nothing is lit up.
    expect(spotlit(fan, "S1")).toBe(false);
    // Three of four links touch S1, more than half: a big fan stays calm.
    expect(spotlit([...fan, { source: "G", target: "C1" }], "S1")).toBe(false);
    // Three of six, exactly half: S1's links stand out.
    const wider = [
      ...fan,
      { source: "G", target: "C1" },
      { source: "H", target: "C1" },
      { source: "C2", target: "P" },
    ];
    expect(spotlit(wider, "S1")).toBe(true);
    // Selected elsewhere, the one link of C1 stands out among S1's.
    expect(spotlit(fan, "C1")).toBe(true);
    // A node without drawn links, and a graph without links: nothing to light up.
    expect(spotlit(fan, "G")).toBe(false);
    expect(spotlit([], "S1")).toBe(false);
  });
});

describe("the text of a link", () => {
  const names = new Map([
    ["derives-from", "Derives from"],
    ["property:packages", "Package"],
    ["packages", "A kind named packages"],
  ]);
  const nameOf = (key: string): string => key.replace("spec:uuid-", "");

  it("[SR-154/AK1] reads along the arrow with the kind's name from the metamodel, and says outdated", () => {
    expect(
      edgeLines(
        [
          graphEdge("S1", "N1"),
          graphEdge("S1", "D2", { ...REFERENCE, outdated: true }),
          graphEdge("S1", "PKG", { kind: "packages", property: true }),
          graphEdge("S1", "D1", BASED_ON),
        ],
        nameOf,
        names,
      ),
    ).toEqual(["S1 Derives from N1", "S1 Refers to D2 · outdated", "S1 Package PKG", "S1 based-on D1"]);
  });

  it("[SR-154/AK2] gives one line for each link a curve draws", () => {
    expect(edgeLines([graphEdge("C1", "S1"), graphEdge("C1", "S1", BASED_ON)], nameOf, names)).toEqual([
      "C1 Derives from S1",
      "C1 based-on S1",
    ]);
  });
});

describe("the verification of a node", () => {
  const node = (name: string) => {
    const found = VERIFIED_GRAPH.nodes.find((each) => each.id === `uuid-${name}`);
    if (found === undefined) {
      throw new Error(name);
    }
    return found;
  };

  it("[SR-136/AK2] a requirement's ring counts its verified criteria, a need's its degree", () => {
    expect(ringOf(node("R11"))).toEqual({ part: 2 / 3, text: "2 of 3" });
    expect(ringOf(node("N1"))).toEqual({ part: 0.6, text: "60 %" });
    expect([ringOf(node("I1")), ringOf(node("N2")), ringOf(node("D1"))]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("[SR-136/AK1] the status of a requirement, failed and outdated in the accent colour", () => {
    expect([statusOf(node("R11")), statusOf(node("N1"))]).toEqual(["open", undefined]);
    expect(["open", "verified", "indirect", "failed", "outdated"].map(accentStatus)).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(nodeLabel(node("R11"), "System Requirement")).toBe(
      "R11 System Requirement Title R11 verification open 2 of 3",
    );
  });
});
