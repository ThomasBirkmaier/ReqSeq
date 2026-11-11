// Test data for the graph buffer's tests: `trace.graph` answers built from short names. Only test files
// import it.
import type { TraceGraphOutput } from "@reqseq/core";
import type { GraphEdge, GraphNode } from "./graph.js";

export const graphNode = (name: string, level: number, extra: Partial<GraphNode> = {}): GraphNode => ({
  id: `uuid-${name}`,
  shortId: `X-${name}`,
  identifier: name,
  type: "system-requirement",
  title: `Title ${name}`,
  status: "draft",
  repository: "spec",
  file: `${name}.md`,
  expanded: true,
  level,
  marks: [],
  ...extra,
});

/** A derivation, the default link of `graphEdge`. */
export const DERIVES = { kind: "derives-from", meaning: "derivation" } as const;
export const REFERENCE = { link: "reference", meaning: "reference" } as const;
export const BASED_ON = { kind: "based-on" } as const;

export const graphEdge = (
  source: string,
  target: string,
  extra: Partial<GraphEdge> = DERIVES,
): GraphEdge => ({
  source: `uuid-${source}`,
  sourceRepository: "spec",
  target: `uuid-${target}`,
  targetRepository: "spec",
  link: "relation",
  outdated: false,
  ...extra,
});

export const graphOutput = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  extra: Partial<TraceGraphOutput> = {},
): TraceGraphOutput => ({
  root: "uuid-S1",
  nodes,
  edges,
  truncated: false,
  incomplete: false,
  problems: [],
  ...extra,
});

export const key = (name: string): string => `spec:uuid-${name}`;

/**
 * A package S1 at depth 1 (#211): its `size - 1` members M0, M1, … on level 1 are in it and each
 * derives from the member before it, in chains of `chain` members.
 */
export const chainedGraph = (size: number, chain: number): TraceGraphOutput => {
  const members = Array.from({ length: size - 1 }, (_, index) => `M${String(index)}`);
  return graphOutput(
    [graphNode("S1", 0, { type: "package" }), ...members.map((name) => graphNode(name, 1))],
    [
      ...members.map((name) => graphEdge(name, "S1", { kind: "in-package" })),
      ...members.flatMap((name, index) =>
        index % chain === 0 ? [] : [graphEdge(name, `M${String(index - 1)}`)],
      ),
    ],
  );
};

/**
 * The graph of S1 at depth 1 in fixtures/SR-111/graph as `trace.graph` gives it: S1 derives from N1, is
 * based on D1, is in package PKG, supersedes O1 and references D2; C1, C2 and C3 derive from S1 (C3 also
 * from C1), C1 is based on D1, and E references S1. D1 references S1 and D2 references C1: links that run
 * against the levels, so S1 is in a cycle with D1.
 */
export const S1_GRAPH = graphOutput(
  [
    graphNode("S1", 0, { marks: ["outdated"] }),
    graphNode("N1", -1, { type: "need" }),
    graphNode("D1", -1, { type: "decision" }),
    {
      id: "uuid-PKG",
      shortId: "PKG-1",
      type: "package",
      title: "Title PKG",
      repository: "spec",
      file: "PKG.md",
      expanded: true,
      level: -1,
      marks: [],
    },
    graphNode("O1", -1, { marks: ["superseded"] }),
    graphNode("D2", -1, { type: "decision" }),
    graphNode("C1", 1),
    graphNode("C2", 1, { marks: ["outdated"] }),
    graphNode("C3", 1),
    graphNode("E", 1, { type: "decision" }),
  ],
  [
    graphEdge("S1", "N1"),
    graphEdge("S1", "D1", BASED_ON),
    graphEdge("S1", "PKG", { kind: "packages", property: true }),
    graphEdge("S1", "O1", { kind: "supersedes", meaning: "succession" }),
    graphEdge("S1", "D2", { ...REFERENCE, outdated: true }),
    graphEdge("D1", "S1", REFERENCE),
    graphEdge("D2", "C1", REFERENCE),
    graphEdge("C1", "S1"),
    graphEdge("C1", "D1", BASED_ON),
    graphEdge("C2", "S1", { ...DERIVES, outdated: true }),
    graphEdge("C3", "S1"),
    graphEdge("C3", "C1"),
    graphEdge("E", "S1", REFERENCE),
  ],
);

const entry = (status: "open" | "verified" | "indirect" | "failed" | "outdated") => [
  { view: "core", status },
];

/**
 * A graph with the verification of SR-136: N1, a need with 60 % of 10 derived requirements; R11 open with
 * 2 of 3 criteria; R07 failed with 0 of 1; I1 indirect; R12 verified without criteria; N2, a need without
 * a valid derived requirement; D1, a decision.
 */
export const VERIFIED_GRAPH = graphOutput(
  [
    graphNode("N1", 0, {
      type: "need",
      degree: {
        share: 0.6,
        total: 10,
        counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
      },
    }),
    graphNode("R11", 1, {
      verification: entry("open"),
      criteria: { verified: 2, total: 3, notVerified: [{ criterion: 3 }] },
    }),
    graphNode("R07", 1, {
      verification: entry("failed"),
      criteria: { verified: 0, total: 1, notVerified: [{ criterion: 1 }] },
    }),
    graphNode("I1", 1, { verification: entry("indirect") }),
    graphNode("R12", 1, { verification: entry("verified") }),
    graphNode("N2", -1, {
      type: "need",
      degree: { total: 0, counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 } },
    }),
    graphNode("D1", -1, { type: "decision" }),
  ],
  [
    graphEdge("R11", "N1"),
    graphEdge("R07", "N1"),
    graphEdge("I1", "N1"),
    graphEdge("R12", "N1"),
    graphEdge("N1", "N2"),
  ],
);
