// Cross-access scenarios of filter.save, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { SAVED } from "../../fixtures.js";

scenariosOf("filter.save", [
  {
    name: "a new filter as a YAML file, its references as UUIDs (SR-070 AK1)",
    fixture: SAVED,
    input: {
      name: "Coastal drafts",
      description: "Open work near the coast",
      view: "var-0000c1",
      where: { all: [{ status: ["draft"] }, { package: "pkg-0000d1" }] },
      sort: [{ by: "title" }],
    },
    expect: "output",
  },
  {
    name: "an existing name replaces that filter in its own file, keeping its comments (SR-070 AK1)",
    fixture: SAVED,
    input: {
      name: "SENSOR DRAFTS",
      where: { all: [{ package: "PKG-0000d1" }, { status: ["draft", "approved"] }] },
    },
    expect: "output",
  },
  {
    name: "a condition that is wrong",
    fixture: SAVED,
    input: { name: "Wrong", where: { package: "SR-0000b1" } },
    expect: "error",
  },
]);
