// A metamodel for the tests of "Create element" (SR-064): the output of `metamodel.get` on the fixture of
// SR-130 (`metamodel-test-data.ts`) and one more type whose required properties have every kind of value,
// with a relation property that may point at no type and a required key the metamodel does not define.
import type { MetamodelGetOutput } from "@reqseq/core";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";

export const CREATE_METAMODEL: MetamodelGetOutput = {
  ...FIXTURE_METAMODEL,
  types: [
    ...FIXTURE_METAMODEL.types,
    {
      key: "report",
      name: "Report",
      prefix: "REP",
      abstract: false,
      ancestors: [],
      properties: ["title", "severity", "packages", "component", "rationale"],
      required: ["severity", "title", "owner", "packages", "component"],
      statuses: [],
    },
    {
      key: "note",
      name: "Note",
      prefix: "NOTE",
      abstract: false,
      ancestors: [],
      properties: ["title", "related", "scope"],
      required: ["title", "related", "scope"],
      statuses: [],
    },
  ],
  properties: [
    ...FIXTURE_METAMODEL.properties,
    { key: "related", name: "Related", kind: "relation" },
    { key: "scope", name: "Scope", kind: "relation", "target-types": [] },
  ],
};
