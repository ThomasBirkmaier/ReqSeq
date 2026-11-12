// Cross-access scenarios of trace.mermaid, in addition to the default one (cross-access.test.ts). The
// suite test [SR-151/AK4] also runs them through the CLI's text output.
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";

/** An element with parents, children, a superseded and an outdated link and a variant (SR-111). */
const GRAPH: FixtureOptions = { fixture: "SR-111/graph", git: true };
/** The UUID of the element S1 of GRAPH. */
const S1 = "5e111a7d-2b4f-4c61-9d08-0b0000000001";

scenariosOf("trace.mermaid", [
  {
    name: "the direct neighbours of a requirement over every kind, with marks",
    fixture: GRAPH,
    input: { ref: S1 },
    tag: "[SR-151/AK4]",
    expect: "output",
  },
  {
    name: "the whole chain in the core view, cut by limit",
    fixture: GRAPH,
    input: { ref: S1, allLevels: true, view: "core", limit: 4 },
    tag: "[SR-151/AK4]",
    expect: "output",
  },
]);
