// Cross-access scenarios of data.export, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

scenariosOf("data.export", [
  {
    name: "the whole workspace with record files",
    fixture: EXPORT,
    root: "system",
    input: {},
    tag: "[SR-061/AK1]",
    expect: "output",
  },
  {
    name: "a baseline by its file name and a variant view",
    fixture: EXPORT,
    root: "system",
    input: { selection: { baseline: "release-1", view: "VAR-0000c1" } },
    tag: "[SR-061/AK2]",
    expect: "output",
  },
  {
    name: "a baseline in a faulty file",
    fixture: EXPORT,
    root: "system",
    input: { selection: { baseline: "broken" } },
    expect: "error",
  },
]);
