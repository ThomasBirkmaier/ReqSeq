// Cross-access scenarios of filter.rename, in addition to the default one (harness.ts).
import { scenariosOf } from "../../scenario.js";
import { PERSPECTIVES } from "../../fixtures.js";

scenariosOf("filter.rename", [
  {
    name: "renames the filter and its file, and the perspective that names it first (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "sensor drafts", newName: "Sensor work" },
    expect: "output",
  },
  {
    name: "a name another filter holds is refused, and nothing changes (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "Sensor drafts", newName: "MOUNTAIN" },
    expect: "error",
  },
]);
