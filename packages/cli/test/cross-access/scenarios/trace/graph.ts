// Cross-access scenarios of trace.graph, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

/** An element with parents, children, a superseded and an outdated link and a variant (SR-111). */
const GRAPH: FixtureOptions = { fixture: "SR-111/graph", git: true };
/** The UUID prefix of GRAPH. */
const GR = "5e111a7d-2b4f-4c61-9d08-";

/** The criterion not verified, as outputs name it (SR-205 AK2). */
const GRAPH_THIRD = {
  criterion: 3,
  text: "Given the station runs, when it is checked, then it shows the third reading.",
};

scenariosOf("trace.graph", [
  {
    name: "the direct neighbours of a requirement over every kind, with marks (SR-111 AK1, AK4)",
    fixture: GRAPH,
    input: { ref: `${GR}0b0000000001` },
    expect: "output",
  },
  {
    name: "the whole derivation chain (SR-111 AK2, AK3)",
    fixture: GRAPH,
    input: { ref: `${GR}0b0000000001`, allLevels: true, meanings: ["derivation"] },
    expect: "output",
  },
  {
    name: "one relation kind in the repository the app names, two levels (SR-111 AK2, AK3)",
    fixture: GRAPH,
    input: { ref: `${GR}0b0000000001`, repository: "system", kinds: ["based-on"], maxDepth: 2 },
    expect: "output",
  },
  {
    name: "the core view, cut by limit (SR-111 AK2, SR-040)",
    fixture: GRAPH,
    input: { ref: `${GR}0b0000000001`, allLevels: true, view: "core", limit: 8 },
    expect: "output",
  },
  {
    name: "the derivation chain with the evidence below each node (SR-111 AK3)",
    fixture: GRAPH,
    input: { ref: `${GR}0b0000000001`, allLevels: true, meanings: ["derivation"], withEvidence: true },
    tag: "[SR-111/AK3]",
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { evidence: unknown[] } }).output;
      expect(output.evidence).toEqual([
        {
          id: `${GR}0b0000000001`,
          repository: "system",
          level: 1,
          testCases: 2,
          records: 1,
          results: { passed: 2, failed: 1 },
        },
        {
          id: `${GR}0c0000000001`,
          repository: "system",
          level: 2,
          testCases: 1,
          records: 0,
          results: { skipped: 1 },
        },
      ]);
    },
  },
  {
    name: "the status of each requirement and the degree of a need, whatever is followed (SR-136)",
    fixture: { fixture: "SR-136/graph", git: true },
    input: { ref: "37373737-3737-4737-8737-00000000a001", maxDepth: 1, kinds: ["packages"] },
    tag: "[SR-136/AK3]",
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as { output: { nodes: { degree?: unknown; verification?: unknown }[] } }
      ).output;
      expect(output.nodes[0]?.degree).toEqual({
        share: 0.6,
        total: 10,
        counts: { open: 2, verified: 6, indirect: 0, failed: 1, outdated: 1 },
      });
    },
  },
  {
    name: "the status and the count of criteria of a requirement (SR-136)",
    fixture: { fixture: "SR-136/graph", git: true },
    input: { ref: "37373737-3737-4737-8737-00000000b011", maxDepth: 0 },
    tag: "[SR-136/AK1]",
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as { output: { nodes: { verification?: unknown; criteria?: unknown }[] } }
      ).output;
      expect([output.nodes[0]?.verification, output.nodes[0]?.criteria]).toEqual([
        [{ view: "core", status: "open", criteria: { verified: 2, total: 3, notVerified: [GRAPH_THIRD] } }],
        { verified: 2, total: 3, notVerified: [GRAPH_THIRD] },
      ]);
    },
  },
  {
    name: "maxDepth and allLevels together",
    fixture: GRAPH,
    input: { ref: `${GR}0b0000000001`, maxDepth: 1, allLevels: true },
    expect: "error",
  },
  {
    name: "a key that is no relation kind",
    fixture: GRAPH,
    input: { ref: `${GR}0b0000000001`, kinds: ["nope"] },
    expect: "error",
  },
  { name: "unknown reference", fixture: GRAPH, input: { ref: "SR-ffffff" }, expect: "error" },
]);
