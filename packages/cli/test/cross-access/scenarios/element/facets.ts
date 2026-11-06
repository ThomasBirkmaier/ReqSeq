// Cross-access scenarios of element.facets, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { FILTER } from "../../fixtures.js";

scenariosOf("element.facets", [
  {
    name: "values of a filtered list (ThomasBirkmaier/ReqSeq-archive#425)",
    fixture: FILTER,
    input: { selection: { where: { type: ["system-requirement"] } } },
    expect: "output",
  },
  {
    name: "free text with a low maxValues (ThomasBirkmaier/ReqSeq-archive#425)",
    fixture: FILTER,
    input: { maxValues: 1 },
    expect: "output",
  },
  {
    name: "a selection that is not there yet (ThomasBirkmaier/ReqSeq-archive#425)",
    fixture: FILTER,
    input: { selection: { baseline: "v1" } },
    expect: "error",
  },
]);
