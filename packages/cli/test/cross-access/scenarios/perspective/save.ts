// Cross-access scenarios of perspective.save, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { PERSPECTIVES } from "../../fixtures.js";

scenariosOf("perspective.save", [
  {
    name: "a new perspective as a YAML file without a view, its references as UUIDs (SR-213 AK1)",
    fixture: PERSPECTIVES,
    input: {
      name: "Coastal drafts by package",
      description: "Open work near the coast",
      filter: "mountain",
      where: { all: [{ status: ["draft"] }, { package: "pkg-0000d1" }] },
      group: "package",
      sort: [{ by: "title" }],
    },
    expect: "output",
  },
  {
    name: "an existing name replaces that perspective in its own file, keeping comments and description (SR-213 AK3)",
    fixture: PERSPECTIVES,
    input: { name: "SENSOR DRAFTS", filter: "Sensor drafts", where: { all: [] }, group: "package" },
    expect: "output",
  },
  {
    name: "a name only a faulty file holds",
    fixture: PERSPECTIVES,
    input: { name: "broken", where: { all: [] } },
    expect: "error",
  },
]);
