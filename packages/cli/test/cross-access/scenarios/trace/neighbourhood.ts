// Cross-access scenarios of trace.neighbourhood, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";

/** Every kind of link around a few elements: derivations, a package, an exclusion, inline references (SR-107). */
const NEIGHBOURHOOD: FixtureOptions = { fixture: "SR-107/neighbourhood", git: true };
const NB = "5e107a7d-2b4f-4c61-9d08-";

scenariosOf("trace.neighbourhood", [
  {
    name: "the direct neighbours of a requirement over every kind (SR-107 AK2)",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001` },
    expect: "output",
  },
  {
    name: "children level by level, derivations only, one page (SR-107 AK2, AK3)",
    fixture: NEIGHBOURHOOD,
    input: {
      ref: `${NB}0a0000000001`,
      direction: "down",
      meanings: ["derivation"],
      maxDepth: 2,
      limit: 2,
      offset: 2,
    },
    expect: "output",
  },
  {
    name: "the whole way up along one relation kind (SR-107 AK1)",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0c0000000001`, direction: "up", kinds: ["derives-from"], allLevels: true },
    expect: "output",
  },
  {
    name: "a key that is no relation kind",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001`, kinds: ["nope"] },
    expect: "error",
  },
  {
    name: "the element in the repository the app names (SR-107)",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001`, repository: "system", direction: "down", meanings: ["derivation"] },
    expect: "output",
  },
  {
    name: "a repository that holds no such element",
    fixture: NEIGHBOURHOOD,
    input: { ref: `${NB}0b0000000001`, repository: "vault" },
    expect: "error",
  },
  { name: "unknown reference", fixture: NEIGHBOURHOOD, input: { ref: "SR-ffffff" }, expect: "error" },
]);
