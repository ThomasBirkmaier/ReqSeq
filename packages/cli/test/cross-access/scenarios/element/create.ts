// Cross-access scenarios of element.create, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import type { Written } from "../../fixtures.js";
import { FILTER, NESTED, NESTED_A, requiredKey } from "../../fixtures.js";

scenariosOf("element.create", [
  {
    name: "relations by short ID are written into the new file with UUID and version (#175)",
    fixture: FILTER,
    input: {
      type: "system-requirement",
      title: "Survive hail",
      relations: { "derives-from": ["N-0000a1"], "based-on": ["D-0000e1"] },
    },
    expect: "output",
    newElement: true,
  },
  {
    name: "a variant is an element file of type variant in the workspace of the core",
    fixture: { fixture: "SR-040/validity", git: true },
    input: { type: "variant", title: "Valley" },
    tag: "[SR-039/AK1]",
    expect: "output",
    newElement: true,
  },
  {
    name: "a variant with validity entries is refused (variant.nested)",
    fixture: NESTED,
    input: { type: "variant", title: "South coast", properties: { validity: [{ id: NESTED_A }] } },
    tag: "[SR-039/AK2]",
    expect: "error",
  },
  {
    name: "new element in a new folder",
    input: {
      type: "system-requirement",
      title: "Show gusts",
      text: "The station shows gusts.\n",
      folder: "requirements/new",
      properties: {
        "requirement-type": "functional",
        "acceptance-criteria": ["Given a gust, then it is shown."],
      },
    },
    expect: "output",
    newElement: true,
  },
  { name: "unknown type", input: { type: "nope", title: "x" }, expect: "error" },
  {
    name: "required properties empty: saved, with the hint",
    input: { type: "system-requirement", title: "Show gusts" },
    tag: "[SR-064/AK2]",
    expect: "output",
    newElement: true,
    check: (results) => {
      const output = (results["core"]?.outcome as { output: Written }).output;
      expect(output.problems.map((p) => [p.code, p.severity, requiredKey(p.message)])).toEqual([
        ["element.missing-required", "warning", "requirement-type"],
        ["element.missing-required", "warning", "acceptance-criteria"],
        ["trace.no-parent", "warning", undefined],
      ]);
      // Saved: the file is on disk with only what was given, whatever the access (placeholders, newElement).
      const file = "system-requirement/SR-<tail12>.md";
      expect(output.files).toEqual([file]);
      expect(results["core"]?.files[file]).toBe(
        "---\nid: <id>\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\n---\n",
      );
    },
  },
  {
    name: "a package is an element file of type package",
    input: { type: "package", title: "Release 3" },
    tag: "[SR-048/AK1]",
    expect: "output",
    newElement: true,
    check: (results) => {
      const output = (results["core"]?.outcome as { output: Written }).output;
      const file = "package/PKG-<tail12>.md";
      expect(output.files).toEqual([file]);
      expect(results["core"]?.files[file]).toBe(
        "---\nid: <id>\ntype: package\nstatus: draft\ntitle: Release 3\n---\n",
      );
    },
  },
  {
    name: "choice values by display name, in any case, written as keys (#309)",
    input: {
      type: "system-requirement",
      title: "Show gusts",
      properties: { "requirement-type": "Functional", "verification-method": "TEST" },
    },
    expect: "output",
    newElement: true,
  },
  {
    name: "a choice value that is no choice is refused (#309, spec question #316)",
    input: {
      type: "system-requirement",
      title: "Show gusts",
      properties: { "requirement-type": "sometimes" },
    },
    expect: "error",
  },
  {
    name: "malformed input: readable messages, no regular expression (#309)",
    input: { type: "System Requirement", title: 3 },
    expect: "error",
  },
]);
