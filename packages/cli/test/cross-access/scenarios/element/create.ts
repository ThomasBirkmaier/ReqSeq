// Cross-access scenarios of element.create, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import type { FixtureOptions } from "@reqseq/testkit";
import type { Result } from "../../scenario.js";
import type { Written } from "../../fixtures.js";
import { FILTER, NESTED, NESTED_A, ONE_REPOSITORY, changedFiles, requiredKey } from "../../fixtures.js";

/** SR-013/own-meanings with an abstract type and a type that inherits from it without the mark (SR-012 AK4). */
const ABSTRACT: FixtureOptions = {
  fixture: "SR-013/own-meanings",
  git: true,
  files: {
    "model/abstract.yaml":
      "reqseq-metamodel: 1\ntypes:\n  - { key: base, name: Base, prefix: B, abstract: true, properties: [label] }\n" +
      "  - { key: derived, name: Derived, prefix: DV, extends: base }\n",
  },
};
/** Statuses per type: draft is the initial status, which decisions do not have (SR-064 AK4). */
const STATUSES: FixtureOptions = { fixture: "enabler-306/statuses-per-type", git: true };
/** Two repositories, system the main one (SR-064 AK5). */
const TWO_REPOSITORIES: FixtureOptions = { fixture: "SR-021/targets", git: ["system", "sensor"] };
/** A list property with max-items 3 (SR-171 AK4). */
const MAX_ITEMS: FixtureOptions = { fixture: "SR-171/max-items", git: true };

/** The error core gives, as far as these checks read it. */
const errorOf = (result: Result | undefined): { code?: string; details?: Record<string, unknown> } =>
  (result?.outcome as { error: { code?: string; details?: Record<string, unknown> } }).error;

scenariosOf("element.create", [
  {
    name: "a number given as text is refused, nothing is written (#614)",
    tag: "[SR-085/AK4]",
    fixture: FILTER,
    input: { type: "software-requirement", title: "Smooth", properties: { priority: "3" } },
    expect: "error",
  },
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
    tag: "[SR-064/AK5]",
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
    check: (results) => {
      expect((results["core"]?.outcome as { output: Written }).output.files).toEqual([
        "requirements/new/SR-<tail12>.md",
      ]);
    },
  },
  {
    name: "without repository and folder, the file is in the main repository in the folder of the type key",
    tag: "[SR-064/AK5]",
    fixture: TWO_REPOSITORIES,
    root: "system",
    input: { type: "system-requirement", title: "Show gusts" },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect((results["core"]?.outcome as { output: Written }).output.files).toEqual([
        "system-requirement/SR-<tail12>.md",
      ]);
      expect(changedFiles(TWO_REPOSITORIES, results["core"])).toEqual([
        "system/system-requirement/SR-<tail12>.md",
      ]);
    },
  },
  { name: "unknown type", input: { type: "nope", title: "x" }, expect: "error" },
  {
    name: "an abstract type is refused, nothing is written",
    tag: "[SR-012/AK4]",
    fixture: ABSTRACT,
    input: { type: "base", title: "x" },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({ reason: "abstract" });
      expect(changedFiles(ABSTRACT, results["core"])).toEqual([]);
    },
  },
  {
    name: "a type that inherits from an abstract one without the mark is not abstract",
    tag: "[SR-012/AK4]",
    fixture: ABSTRACT,
    input: { type: "derived", title: "x" },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect((results["core"]?.outcome as { output: Written }).output.files).toEqual([
        "derived/DV-<tail12>.md",
      ]);
    },
  },
  {
    name: "a property the type does not have is refused, nothing is written",
    tag: "[SR-016/AK4]",
    input: { type: "system-requirement", title: "Show gusts", properties: { colour: "red" } },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).code).toBe("input.invalid");
      expect(changedFiles(ONE_REPOSITORY, results["core"])).toEqual([]);
    },
  },
  {
    name: "a relation the metamodel does not allow for the type is refused, nothing is written",
    tag: "[SR-067/AK4]",
    fixture: FILTER,
    input: { type: "system-requirement", title: "Show gusts", relations: { "based-on": ["SR-0000b1"] } },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).code).toBe("relation.not-allowed");
      expect(changedFiles(FILTER, results["core"])).toEqual([]);
    },
  },
  {
    name: "a type without the initial status gets its first valid status in metamodel order",
    tag: "[SR-064/AK4]",
    fixture: STATUSES,
    input: { type: "decision", title: "Use knots" },
    expect: "output",
    newElement: true,
    check: (results) => {
      const output = (results["core"]?.outcome as { output: Written }).output;
      expect(output.files).toEqual(["decision/D-<tail12>.md"]);
      expect(results["core"]?.files["decision/D-<tail12>.md"]).toBe(
        "---\nid: <id>\ntype: decision\nstatus: accepted\ntitle: Use knots\n---\n",
      );
    },
  },
  {
    name: "more acceptance criteria than max-items are saved, with the hint",
    tag: "[SR-171/AK4]",
    fixture: MAX_ITEMS,
    input: {
      type: "system-requirement",
      title: "Four criteria",
      properties: { "acceptance-criteria": ["One.", "Two.", "Three.", "Four."] },
    },
    expect: "output",
    newElement: true,
    check: (results) => {
      const output = (results["core"]?.outcome as { output: Written }).output;
      expect(output.element.properties["acceptance-criteria"]).toEqual(["One.", "Two.", "Three.", "Four."]);
      expect(
        output.problems.filter((p) => p.code === "element.too-many-items").map((p) => p.severity),
      ).toEqual(["warning"]);
    },
  },
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
    name: "choice values by display name, in any case, written as keys (ThomasBirkmaier/ReqSeq-archive#309)",
    input: {
      type: "system-requirement",
      title: "Show gusts",
      properties: { "requirement-type": "Functional", "verification-method": "TEST" },
    },
    expect: "output",
    newElement: true,
  },
  {
    name: "a choice value that is no choice is refused (ThomasBirkmaier/ReqSeq-archive#309, spec question ThomasBirkmaier/ReqSeq-archive#316)",
    input: {
      type: "system-requirement",
      title: "Show gusts",
      properties: { "requirement-type": "sometimes" },
    },
    expect: "error",
  },
  {
    name: "an empty string of a required choice property is no value: saved, with the hint (#242)",
    input: { type: "system-requirement", title: "Show gusts", properties: { "requirement-type": "" } },
    tag: "[SR-064/AK2]",
    expect: "output",
    newElement: true,
    check: (results) => {
      const output = (results["core"]?.outcome as { output: Written }).output;
      expect(output.problems.map((p) => [p.code, requiredKey(p.message)])).toEqual([
        ["element.missing-required", "requirement-type"],
        ["element.missing-required", "acceptance-criteria"],
        ["trace.no-parent", undefined],
      ]);
      const file = "system-requirement/SR-<tail12>.md";
      expect(results["core"]?.files[file]).toBe(
        '---\nid: <id>\ntype: system-requirement\nstatus: draft\ntitle: Show gusts\nrequirement-type: ""\n---\n',
      );
    },
  },
  {
    name: "malformed input: readable messages, no regular expression (ThomasBirkmaier/ReqSeq-archive#309)",
    input: { type: "System Requirement", title: 3 },
    expect: "error",
  },
]);
