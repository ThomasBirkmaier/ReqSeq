// Cross-access scenarios of element.search, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { FILTER, IDENTIFIERS, SAVED } from "../../fixtures.js";

scenariosOf("element.search", [
  {
    name: "a word only in a property, with a typo, in another case (SR-068 AK1, AK2)",
    fixture: FILTER,
    input: { query: "SUPLIER" },
    expect: "output",
  },
  {
    name: "within a view and a filter, one page (SR-068 AK3)",
    fixture: FILTER,
    input: {
      query: "measure",
      selection: { view: "VAR-0000c1", where: { status: ["approved", "draft"] } },
      limit: 1,
      offset: 1,
    },
    expect: "output",
  },
  {
    name: "a short ID in lower case, in title and IDs only (SR-068 AK1, SR-066)",
    fixture: FILTER,
    input: { query: "sr-0000B2", fields: ["title", "id"] },
    expect: "output",
  },
  {
    name: "an identifier, first, with the words of its property (ThomasBirkmaier/ReqSeq-archive#305)",
    fixture: IDENTIFIERS,
    input: { query: "sr-036" },
    expect: "output",
  },
  {
    name: "within a saved filter with its view (SR-068 AK3, SR-070)",
    fixture: SAVED,
    input: { query: "measure", selection: { filter: "mountain" } },
    expect: "output",
  },
  {
    name: "a selection that is not there yet",
    fixture: FILTER,
    input: { query: "wind", selection: { baseline: "v1" } },
    expect: "error",
  },
  {
    name: "a target of a chosen relation kind: only its target types (SR-067 AK2)",
    fixture: FILTER,
    input: {
      query: "draft",
      selection: {
        where: { type: ["software-requirement", "need", "use-case", "system-requirement"] },
      },
    },
    expect: "output",
  },
]);
