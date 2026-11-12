// Cross-access scenarios of metamodel.mermaid, in addition to the default one (cross-access.test.ts). The
// suite test [SR-151/AK4] also runs them through the CLI's text output.
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";
import { CHAIN } from "../../fixtures.js";

/** Inheritance and relation kinds open on a side or both (SR-130). */
const METAMODEL: FixtureOptions = { fixture: "SR-130/metamodel", git: true };

scenariosOf("metamodel.mermaid", [
  {
    name: "types with inheritance and open relation kinds (SR-151 AK2)",
    fixture: METAMODEL,
    input: {},
    expect: "output",
  },
  { name: "the standard model (SR-151 AK2)", fixture: CHAIN, input: {}, expect: "output" },
  {
    name: "a faulty metamodel file: the text of the valid files and the problem",
    fixture: {
      ...METAMODEL,
      files: { "model/broken.yaml": "reqseq-metamodel: 1\ntypes:\n  - { key: broken, name: Broken }\n" },
    },
    input: {},
    expect: "output",
  },
]);
