// Cross-access scenarios of relation.remove, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

scenariosOf("relation.remove", [
  {
    name: "a relation that closed a cycle",
    fixture: { fixture: "SR-090/cycle", git: true },
    input: { source: "SR-b0000000003", kind: "derives-from", target: "SR-b0000000001" },
    expect: "output",
  },
  {
    name: "only relations into the repository given",
    fixture: { fixture: "SR-090/cycle", git: true },
    input: {
      source: "SR-b0000000003",
      kind: "derives-from",
      target: "5e9c0a7d-2b4f-4c61-9d08-0b0000000001",
      repository: "system",
    },
    expect: "output",
  },
  {
    name: "no relation kind",
    fixture: { fixture: "SR-090/cycle", git: true },
    input: { source: "SR-b0000000003", kind: "nope", target: "SR-b0000000001" },
    expect: "error",
  },
]);
