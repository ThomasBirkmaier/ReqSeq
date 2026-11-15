// Cross-access scenarios of filter.delete, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { PERSPECTIVES } from "../../fixtures.js";

scenariosOf("filter.delete", [
  {
    name: "without confirm names the filter and its file and deletes nothing (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "mountain" },
    expect: "output",
  },
  {
    name: "with confirm deletes the file of the filter (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "Mountain", confirm: true },
    expect: "output",
  },
  {
    name: "a filter a perspective names is refused, and nothing changes (SR-217 AK8)",
    tag: "[SR-217/AK-z7rb]",
    fixture: PERSPECTIVES,
    input: { name: "Sensor drafts", confirm: true },
    expect: "error",
  },
]);
