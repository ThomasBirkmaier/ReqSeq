// Cross-access scenarios of trace.graph, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";

/** An element with parents, children, a superseded and an outdated link and a variant (SR-111). */
const GRAPH: FixtureOptions = { fixture: "SR-111/graph", git: true };
/** The UUID prefix of GRAPH. */
const GR = "5e111a7d-2b4f-4c61-9d08-";

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
