// Cross-access scenarios of perspective.delete, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { PERSPECTIVES } from "../../fixtures.js";

scenariosOf("perspective.delete", [
  {
    name: "without confirm names the perspective and its file and deletes nothing (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "SENSOR DRAFTS" },
    expect: "output",
  },
  {
    name: "with confirm deletes the file of the perspective (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "Sensor drafts", confirm: true, file: "perspectives/sensor-drafts.yaml" },
    expect: "output",
  },
]);
