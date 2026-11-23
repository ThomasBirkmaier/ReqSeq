// Cross-access scenarios of perspective.rename, in addition to the default one (harness.ts).
import { scenariosOf } from "../../scenario.js";
import { PERSPECTIVES } from "../../fixtures.js";

scenariosOf("perspective.rename", [
  {
    name: "renames the perspective and its file, keeping comments and description (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "SENSOR DRAFTS", newName: "Sensor work" },
    expect: "output",
  },
  {
    name: "a name only a faulty file holds is refused, and nothing changes (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "Sensor drafts", newName: "broken" },
    expect: "error",
  },
]);
