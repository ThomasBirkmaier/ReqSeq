// Cross-access scenarios of relation.options, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { FILTER } from "../../fixtures.js";

scenariosOf("relation.options", [
  {
    name: "the kinds a system requirement may get, with their target types (SR-067 AK1)",
    fixture: FILTER,
    input: { ref: "SR-0000b1" },
    expect: "output",
  },
  {
    name: "one chosen kind, by a short ID in lower case (SR-067 AK2)",
    fixture: FILTER,
    input: { ref: "swr-0000f1", kind: "derives-from" },
    expect: "output",
  },
  {
    name: "a kind the type does not allow: none (SR-067 AK1)",
    fixture: FILTER,
    input: { ref: "N-0000a1", kind: "derives-from" },
    expect: "output",
  },
  {
    name: "a key that is no relation kind",
    fixture: FILTER,
    input: { ref: "N-0000a1", kind: "nope" },
    expect: "error",
  },
  { name: "unknown reference", fixture: FILTER, input: { ref: "SR-ffffff" }, expect: "error" },
]);
