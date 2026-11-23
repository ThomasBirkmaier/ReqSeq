// Cross-access scenarios of baseline.create, in addition to the default one (harness.ts).
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

scenariosOf("baseline.create", [
  {
    name: "a baseline file of a package with the commit and the elements (SR-050 AK1)",
    fixture: EXPORT,
    root: "system",
    input: { name: "Release 2", selection: { package: "PKG-0000d1" } },
    tag: "[SR-050/AK-cvrg]",
    expect: "output",
  },
  {
    name: "a name a baseline has, nothing written (SR-050 AK6)",
    fixture: EXPORT,
    root: "system",
    input: { name: "release 1", selection: { package: "PKG-0000d1" } },
    tag: "[SR-050/AK-g01t]",
    expect: "error",
  },
  {
    name: "a baseline as the selection, refused naming selection.baseline (SR-050 AK9)",
    fixture: EXPORT,
    root: "system",
    input: { name: "Release 2", selection: { baseline: "Release 1" } },
    tag: "[SR-050/AK-b59n]",
    expect: "error",
  },
  {
    name: "a command output as the selection, refused naming selection.output (SR-050 AK9)",
    fixture: EXPORT,
    root: "system",
    input: {
      name: "Release 2",
      selection: { output: { command: "element.list", input: { selection: { package: "PKG-0000d1" } } } },
    },
    tag: "[SR-050/AK-b59n]",
    expect: "error",
  },
]);
