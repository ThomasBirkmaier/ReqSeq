// Cross-access scenarios of element.create, in addition to the default one (harness.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import type { FixtureOptions } from "@reqseq/testkit";
import type { Result } from "../../scenario.js";
import type { Written } from "../../fixtures.js";
import {
  FILTER,
  IDENTIFIERS,
  NESTED,
  NESTED_A,
  NEW_CRITERION_KEYS,
  changedFiles,
  requiredKey,
} from "../../fixtures.js";

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
/** Statuses per type: draft is the initial status, which decisions do not have (SR-064). */
const STATUSES: FixtureOptions = { fixture: "enabler-306/statuses-per-type", git: true };
/** Two repositories, system the main one (SR-064). */
const TWO_REPOSITORIES: FixtureOptions = { fixture: "SR-021/targets", git: ["system", "sensor"] };
/** A list property with max-items 3 (SR-171 AK4). */
const MAX_ITEMS: FixtureOptions = { fixture: "SR-171/max-items", git: true };

/** A requirement of fixtures/enabler-305/identifiers with the spec ID `specId` (SR-245). */
const specRequirement = (tail: string, specId: string): Record<string, string> => ({
  [`requirements/SR-0000000b${tail}.md`]:
    `---\nid: 30500000-0000-4000-8000-0000000b${tail}\ntype: system-requirement\nstatus: draft\n` +
    `title: Requirement ${tail}\nspec-id: ${specId}\n---\n`,
});
/** The spec IDs of fixtures/enabler-305/identifiers and more requirements (SR-245). */
const identifiersWith = (files: Record<string, string>): FixtureOptions => ({ ...IDENTIFIERS, files });
/** IDENTIFIERS with the decision's spec ID `D-`, which ends in no digit, so no decision identifier counts (SR-245 AK8). */
const NO_DECISION_IDENTIFIER = identifiersWith({
  "decisions/D-0000000c0047.md":
    "---\nid: 30500000-0000-4000-8000-0000000c0047\ntype: decision\nstatus: draft\ntitle: The spec lives in ReqSeq\nspec-id: D-\n---\n",
});
/** IDENTIFIERS whose workspace file lists a second repository, vault, that is not on this machine (SR-245 AK9). */
const IDENTIFIERS_WITHOUT_VAULT = identifiersWith({
  "reqseq-workspace.yaml":
    "reqseq-workspace: 1\nname: ReqSeq spec\nrepositories:\n" +
    '  - { name: spec, url: "git@git.example.com:reqseq/spec.git", main: true }\n' +
    '  - { name: vault, url: "git@git.example.com:reqseq/vault.git", path: ../vault }\n' +
    "metamodel: { repository: spec, path: metamodel }\n",
});

/** The identifier of the new element core gives (SR-245). */
const identifierOf = (result: Result | undefined): unknown =>
  (result?.outcome as { output: Written }).output.element.properties["spec-id"];

/** The error core gives, as far as these checks read it. */
const errorOf = (result: Result | undefined): { code?: string; details?: Record<string, unknown> } =>
  (result?.outcome as { error: { code?: string; details?: Record<string, unknown> } }).error;

scenariosOf("element.create", [
  {
    name: "a number given as text is refused, nothing is written (#614)",
    tag: "[SR-085/AK-jx8c]",
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
    name: "properties and relations, each entry with its value: the same file by every access but the UUID",
    fixture: FILTER,
    input: {
      type: "system-requirement",
      title: "Survive gusts",
      properties: {
        "requirement-type": "functional",
        rationale: "Gusts break masts",
        packages: [{ id: "69069069-0000-4000-8000-0000000000d1", repository: "system" }],
      },
      relations: {
        "derives-from": ["69069069-0000-4000-8000-0000000000a1", "69069069-0000-4000-8000-0000000000a2"],
        "based-on": "69069069-0000-4000-8000-0000000000e1",
      },
    },
    expect: "output",
    newElement: true,
  },
  {
    name: "a variant is an element file of type variant in the workspace of the core",
    fixture: { fixture: "SR-040/validity", git: true },
    input: { type: "variant", title: "Valley" },
    tag: "[SR-039/AK-w7mx]",
    expect: "output",
    newElement: true,
  },
  {
    name: "a variant with validity entries is refused (variant.nested)",
    fixture: NESTED,
    input: { type: "variant", title: "South coast", properties: { validity: [{ id: NESTED_A }] } },
    tag: "[SR-039/AK-nvfq]",
    expect: "error",
  },
  {
    name: "new element in a new folder",
    tag: "[SR-064/AK-p5w1]",
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
    masks: NEW_CRITERION_KEYS,
    check: (results) => {
      expect((results["core"]?.outcome as { output: Written }).output.files).toEqual([
        "requirements/new/SR-<tail12>.md",
      ]);
    },
  },
  {
    name: "a new element's criterion gets a criterion key",
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
    tag: "[SR-204/AK-qg2w]",
    expect: "output",
    newElement: true,
    masks: NEW_CRITERION_KEYS,
    // Each access gives the criterion a criterion key of its own (SR-204 AK1).
    check: (results) => {
      for (const result of Object.values(results)) {
        const output = (result.outcome as { output: Written }).output;
        expect(output.element.properties["acceptance-criteria"]).toEqual([
          { key: "<masked>", text: "Given a gust, then it is shown." },
        ]);
      }
    },
  },
  {
    name: "without repository and folder, the file is in the main repository in the folder of the type key",
    tag: "[SR-064/AK-p5w1]",
    fixture: TWO_REPOSITORIES,
    root: "system",
    input: { type: "system-requirement", title: "Show gusts" },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect((results["core"]?.outcome as { output: Written }).output.files).toEqual([
        "system-requirement/SR-<tail12>.md",
      ]);
      expect(changedFiles(results["core"])).toEqual(["system/system-requirement/SR-<tail12>.md"]);
    },
  },
  { name: "unknown type", input: { type: "nope", title: "x" }, expect: "error" },
  {
    name: "an abstract type is refused, nothing is written",
    tag: "[SR-012/AK-hwvc]",
    fixture: ABSTRACT,
    input: { type: "base", title: "x" },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({ reason: "abstract" });
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "a type that inherits from an abstract one without the mark is not abstract",
    tag: "[SR-012/AK-hwvc]",
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
    tag: "[SR-016/AK-qdr5]",
    input: { type: "system-requirement", title: "Show gusts", properties: { colour: "red" } },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).code).toBe("input.invalid");
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "a relation the metamodel does not allow for the type is refused, nothing is written",
    tag: "[SR-067/AK-r039]",
    fixture: FILTER,
    input: { type: "system-requirement", title: "Show gusts", relations: { "based-on": ["SR-0000b1"] } },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).code).toBe("relation.not-allowed");
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "a type without the initial status gets its first valid status in metamodel order",
    tag: "[SR-064/AK-vv9g]",
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
    tag: "[SR-171/AK-nx3d]",
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
    tag: "[SR-064/AK-yhn7]",
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
    tag: "[SR-048/AK-fbss]",
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
    tag: "[SR-064/AK-yhn7]",
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
  {
    name: "nextIdentifier gives the identifier after the highest of the type (SR-245)",
    tag: "[SR-245/AK-tskf]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Next", nextIdentifier: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect(identifierOf(results["core"])).toBe("SR-038");
      expect(results["core"]?.files["system-requirement/SR-<tail12>.md"]).toContain("spec-id: SR-038\n");
    },
  },
  {
    name: "nextIdentifier keeps the digits of the identifier it follows, at least as many as the number needs (SR-245)",
    tag: "[SR-245/AK-w5bw]",
    fixture: identifiersWith(specRequirement("0999", "SR-0999")),
    input: { type: "system-requirement", title: "Next", nextIdentifier: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect(identifierOf(results["core"])).toBe("SR-1000");
    },
  },
  {
    name: "nextIdentifier without a prefix is refused while the identifiers carry several, and names them (SR-245)",
    tag: "[SR-245/AK-zh91]",
    fixture: identifiersWith(specRequirement("0100", "REQ-7")),
    input: { type: "system-requirement", title: "Next", nextIdentifier: true },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({
        reason: "several-prefixes",
        count: 2,
        // SR- has two identifiers, SR-036 and SR-037, so it comes first.
        prefixes: ["SR-", "REQ-"],
      });
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "nextIdentifier with a prefix no identifier carries starts with 1 (SR-245)",
    tag: "[SR-245/AK-kscz]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Next", nextIdentifier: true, identifierPrefix: "Story-" },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect(identifierOf(results["core"])).toBe("Story-1");
    },
  },
  {
    name: "a new identifier prefix that ends with a digit is refused, nothing is written (SR-245)",
    tag: "[SR-245/AK-kvz3]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Next", nextIdentifier: true, identifierPrefix: "Story-1" },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({ reason: "invalid-prefix" });
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "nextIdentifier for a type without a property with the meaning identifier is refused (SR-245)",
    tag: "[SR-245/AK-qp1p]",
    input: { type: "system-requirement", title: "Next", nextIdentifier: true },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({ reason: "no-identifier-property" });
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "nextIdentifier with the identifier also given as a property is refused (SR-245)",
    tag: "[SR-245/AK-pf8m]",
    fixture: IDENTIFIERS,
    input: {
      type: "system-requirement",
      title: "Next",
      nextIdentifier: true,
      properties: { "spec-id": "SR-100" },
    },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({ reason: "identifier-given" });
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "nextIdentifier without an identifier that counts and without a prefix is refused (SR-245)",
    tag: "[SR-245/AK-fk37]",
    fixture: NO_DECISION_IDENTIFIER,
    input: { type: "decision", title: "Next", nextIdentifier: true },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({ reason: "no-identifiers" });
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "nextIdentifier while a repository is missing follows the elements here and is incomplete (SR-245)",
    tag: "[SR-245/AK-tc56]",
    fixture: IDENTIFIERS_WITHOUT_VAULT,
    input: { type: "system-requirement", title: "Next", nextIdentifier: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect(identifierOf(results["core"])).toBe("SR-038");
      expect((results["core"]?.outcome as { output: { incomplete?: boolean } }).output.incomplete).toBe(true);
    },
  },
  {
    name: "an identifier prefix without nextIdentifier is refused (SR-245)",
    tag: "[SR-245/AK-cyr4]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Next", identifierPrefix: "SR-" },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).details).toMatchObject({ reason: "prefix-without-next-identifier" });
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "a dry run creates no file or folder (SR-246)",
    tag: "[SR-246/AK-x516]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Preview", folder: "new/deeper", dryRun: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "a dry run of an invalid input is refused as without it (SR-246)",
    tag: "[SR-246/AK-x4c8]",
    fixture: FILTER,
    input: { type: "software-requirement", title: "Smooth", properties: { priority: "3" }, dryRun: true },
    expect: "error",
    check: (results) => {
      expect(errorOf(results["core"]).code).toBe("input.invalid");
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
  {
    name: "a dry run gives the element and its problems (SR-246)",
    tag: "[SR-246/AK-pwg2]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Preview", dryRun: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      const { output } = results["core"]?.outcome as { output: Written & { problems: { code: string }[] } };
      expect(output.element).toMatchObject({ type: "system-requirement", title: "Preview", status: "draft" });
      expect(output.problems.map((p) => p.code)).toEqual(["trace.no-parent"]);
    },
  },
  {
    name: "a dry run is marked, names the file to write and no written file (SR-246)",
    tag: "[SR-246/AK-y5vf]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Preview", dryRun: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect((results["core"]?.outcome as { output: unknown }).output).toMatchObject({
        dryRun: true,
        files: [],
        filesToWrite: ["system-requirement/SR-<tail12>.md"],
      });
    },
  },
  {
    name: "the file a dry run names is not in the workspace (SR-246)",
    tag: "[SR-246/AK-tcxn]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Preview", dryRun: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect(Object.keys(results["core"]?.files ?? {})).not.toContain("system-requirement/SR-<tail12>.md");
    },
  },
  {
    name: "a dry run with nextIdentifier names the identifier a create gives now (SR-246)",
    tag: "[SR-246/AK-jbkb]",
    fixture: IDENTIFIERS,
    input: { type: "system-requirement", title: "Next", nextIdentifier: true, dryRun: true },
    expect: "output",
    newElement: true,
    check: (results) => {
      expect(identifierOf(results["core"])).toBe("SR-038");
      expect(changedFiles(results["core"])).toEqual([]);
    },
  },
]);
