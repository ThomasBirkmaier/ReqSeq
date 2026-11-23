// Cross-access scenarios of filter.save, in addition to the default one (harness.ts).
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
    name: "conditions in their order under all: the same file by every access",
    fixture: SAVED,
    input: {
      name: "Drafts without child",
      where: {
        all: [
          { status: ["draft"] },
          { relation: { meaning: "derivation", direction: "down" }, exists: false },
          { text: "coast" },
        ],
      },
    },
    expect: "output",
  },
  {
    name: "sort keys in their order: the same file by every access",
    fixture: SAVED,
    input: {
      name: "By tree then title",
      where: { all: [] },
      sort: [
        { by: "hierarchy", order: "asc" },
        { by: "title", order: "desc" },
      ],
    },
    expect: "output",
  },
  {
    name: "the empty sort of workspace order",
    fixture: SAVED,
    input: { name: "In workspace order", where: { all: [] }, sort: [] },
    expect: "output",
  },
  {
    name: "conditions under all with a sort: the same file by every access",
    fixture: SAVED,
    input: {
      name: "Measured drafts",
      where: { all: [{ type: ["system-requirement"] }, { text: "measure" }, { status: ["draft"] }] },
      sort: [{ by: "title", order: "desc" }],
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
