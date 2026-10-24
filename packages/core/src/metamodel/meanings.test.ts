import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, expectTypeOf, it, onTestFinished } from "vitest";
import { CommandError, errorClass } from "../catalog.js";
import type { CommandName, Problem } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import type { MetamodelProperty, MetamodelType } from "../generated/types.js";
import { SCHEMA_BASE, loadContracts } from "../runtime/contracts.js";
import type {
  Located,
  Meaning,
  MeaningList,
  Metamodel,
  PropertyMeaning,
  RelationMeaning,
  TypeMeaning,
} from "./index.js";
import { assignMeanings } from "./meanings.js";
import {
  MEANINGS,
  metamodelState,
  propertyWithMeaning,
  relationKindsWithMeaning,
  requireMeaning,
  typesWithMeaning,
  workspaceAccess,
} from "./index.js";

// #127 option 1: SR-013 AK1 and AK2 are tested here, at the lowest existing level, where the core
// resolves a meaning to the keys of the metamodel. The chain (trace.chain, stage 2) and the variant
// view (SR-040, SR-043, stage 5) build on these functions and add end-to-end tests with the same
// [SR-013/AK1] and [SR-013/AK2] prefixes.

const fixture = async (options: FixtureOptions = {}): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-013/own-meanings", ...options });
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const load = async (options: FixtureOptions = {}): Promise<Metamodel> =>
  open((await fixture(options)).root).get(metamodelState);

/** The error `requireMeaning` throws, or undefined when it returns. */
const unassigned = (
  metamodel: Metamodel,
  meaning: Meaning,
  command: CommandName,
): CommandError | undefined => {
  try {
    requireMeaning(metamodel, meaning, command);
    return undefined;
  } catch (error) {
    return error as CommandError;
  }
};

const invalid = (message: string, file: string, line: number): Problem => ({
  code: "metamodel.invalid",
  severity: "error",
  repository: "system",
  message,
  file,
  line,
});

describe("built-in meanings", () => {
  it("[SR-013/AK1] follows an own relation kind marked with the meaning derivation", async () => {
    const metamodel = await load();
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    // The chain follows exactly the relation kinds with the meaning derivation, whatever their key.
    expect(relationKindsWithMeaning(metamodel, "derivation").map((r) => r.key)).toEqual(["satisfies"]);
    expect(unassigned(metamodel, "derivation", "trace.chain")).toBeUndefined();
    expect(metamodel.meanings.derivation).toEqual(["satisfies"]);
  });

  it("[SR-013/AK1] follows every relation kind that shares the meaning derivation, never one without it", async () => {
    const metamodel = await load({
      files: {
        "model/relations.yaml": [
          "logreq-metamodel: 1",
          "relations:",
          "  - { key: satisfies, name: Satisfies, meaning: derivation }",
          "  - { key: traces-to, name: Traces to }",
          "  - { key: refines, name: Refines, meaning: derivation }",
          "  - { key: obsoletes, name: Obsoletes, meaning: replacement }",
          "",
        ].join("\n"),
      },
    });
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    expect(relationKindsWithMeaning(metamodel, "derivation").map((r) => r.key)).toEqual([
      "satisfies",
      "refines",
    ]);
    expect(metamodel.meanings.derivation).toEqual(["satisfies", "refines"]);
    expect(relationKindsWithMeaning(metamodel, "replacement").map((r) => r.key)).toEqual(["obsoletes"]);
  });

  it("[SR-013/AK2] resolves the own property marked with the meaning validity, not the one keyed validity", async () => {
    const metamodel = await load();
    // The variant view reads the validity from this property of each requirement.
    expect(propertyWithMeaning(metamodel, "validity")).toEqual({
      key: "applies-to",
      name: "Applies to",
      kind: "relation",
      many: true,
      "target-types": ["edition"],
      content: true,
      meaning: "validity",
    });
    expect(unassigned(metamodel, "validity", "element.list")).toBeUndefined();
    expect(metamodel.meanings.validity).toEqual(["applies-to"]);
    // Its targets are the types with the meaning variant.
    expect(typesWithMeaning(metamodel, "variant").map((t) => t.key)).toEqual(["edition"]);
  });

  it("[SR-013/AK3] names the missing assignment when a function needs a meaning that no key has", async () => {
    const metamodel = await load({
      files: {
        "model/relations.yaml": "logreq-metamodel: 1\nrelations:\n  - { key: traces-to, name: Traces to }\n",
      },
    });
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    expect(metamodel.meanings.derivation).toEqual([]);
    const error = unassigned(metamodel, "derivation", "trace.chain");
    expect(error).toBeInstanceOf(CommandError);
    expect(error?.toJSON()).toEqual({
      code: "metamodel.meaning-unassigned",
      message:
        "No relation kind of the metamodel has the meaning derivation, which trace.chain needs. Add `meaning: derivation` to a relation kind in the metamodel files.",
      details: { meaning: "derivation", list: "relations", command: "trace.chain" },
    });
    // The workspace is fine; the call cannot be done as asked.
    expect(errorClass("metamodel.meaning-unassigned")).toBe("conflict");
  });

  it("[SR-013/AK3] names a missing property and a missing type meaning the same way", async () => {
    const metamodel = await load({
      files: {
        "model/types.yaml":
          "logreq-metamodel: 1\ntypes:\n  - { key: wish, name: Stakeholder Wish, prefix: W, properties: [label] }\n",
        "model/properties.yaml":
          "logreq-metamodel: 1\nproperties:\n  - { key: label, name: Label, kind: text, meaning: title }\n",
      },
    });
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    expect(unassigned(metamodel, "validity", "element.list")?.toJSON()).toEqual({
      code: "metamodel.meaning-unassigned",
      message:
        "No property of the metamodel has the meaning validity, which element.list needs. Add `meaning: validity` to a property in the metamodel files.",
      details: { meaning: "validity", list: "properties", command: "element.list" },
    });
    expect(unassigned(metamodel, "requirement", "evidence.coverage")?.toJSON()).toEqual({
      code: "metamodel.meaning-unassigned",
      message:
        "No type of the metamodel has the meaning requirement, which evidence.coverage needs. Add `meaning: requirement` to a type in the metamodel files.",
      details: { meaning: "requirement", list: "types", command: "evidence.coverage" },
    });
    expect(unassigned(metamodel, "title", "element.create")).toBeUndefined();
    expect(propertyWithMeaning(metamodel, "validity")).toBeUndefined();
    expect(typesWithMeaning(metamodel, "requirement")).toEqual([]);
  });

  it("lists every built-in meaning with the keys that declare it, in metamodel order", async () => {
    const metamodel = await load();
    expect(Object.keys(metamodel.meanings)).toEqual(Object.keys(MEANINGS));
    expect(metamodel.meanings).toEqual({
      requirement: ["spec-item"],
      need: ["wish"],
      variant: ["edition"],
      package: [],
      title: ["label"],
      validity: ["applies-to"],
      packages: [],
      emergent: [],
      "verification-method": [],
      statement: [],
      source: [],
      "source-identifier": [],
      "import-date": [],
      delivery: [],
      derivation: ["satisfies"],
      replacement: [],
      exclusion: [],
    });
  });

  it("knows exactly the meanings of the metamodel schema, each in its list", () => {
    expect(MEANINGS).toEqual({
      requirement: "types",
      need: "types",
      variant: "types",
      package: "types",
      title: "properties",
      validity: "properties",
      packages: "properties",
      emergent: "properties",
      "verification-method": "properties",
      statement: "properties",
      source: "properties",
      "source-identifier": "properties",
      "import-date": "properties",
      delivery: "properties",
      derivation: "relations",
      replacement: "relations",
      exclusion: "relations",
    });
  });

  it("lists the meaning enums of metamodel.schema.json, in their order", () => {
    const schema = loadContracts().schemas.find((s) => s["$id"] === `${SCHEMA_BASE}metamodel.schema.json`);
    const defs = (schema?.["$defs"] ?? {}) as Readonly<Record<string, { readonly enum?: readonly string[] }>>;
    const lists = { typeMeaning: "types", propertyMeaning: "properties", relationMeaning: "relations" };
    const fromSchema = Object.entries(lists).flatMap(([def, list]) =>
      (defs[def]?.enum ?? []).map((meaning) => [meaning, list]),
    );
    expect(fromSchema).toHaveLength(Object.keys(MEANINGS).length);
    expect(Object.entries(MEANINGS)).toEqual(fromSchema);
  });

  it("has disjoint meaning enums, so every meaning names its list", () => {
    expectTypeOf<TypeMeaning & PropertyMeaning>().toBeNever();
    expectTypeOf<TypeMeaning & RelationMeaning>().toBeNever();
    expectTypeOf<PropertyMeaning & RelationMeaning>().toBeNever();
    expectTypeOf<MeaningList<"derivation">>().toEqualTypeOf<"relations">();
  });

  it("counts an inherited meaning for the type, but not as a second assignment", async () => {
    const metamodel = await load({
      files: {
        "model/types.yaml": [
          "logreq-metamodel: 1",
          "types:",
          "  - { key: spec-item, name: Specification Item, prefix: SPI, meaning: requirement }",
          "  - { key: sub-item, name: Sub Item, prefix: SUB, extends: spec-item }",
          "  # The target type of applies-to in properties.yaml.",
          "  - { key: edition, name: Edition, prefix: ED }",
          "",
        ].join("\n"),
      },
    });
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    expect(metamodel.meanings.requirement).toEqual(["spec-item"]);
    expect(typesWithMeaning(metamodel, "requirement").map((t) => t.key)).toEqual(["spec-item", "sub-item"]);
  });

  it("reports a type or property meaning declared by a second key, with file and line, and opens read-only", async () => {
    const ws = await fixture({
      files: {
        // After types.yaml and properties.yaml in file order, so these are the second definitions.
        "model/variants.yaml": [
          "logreq-metamodel: 1",
          "types:",
          "  - key: release",
          "    name: Release",
          "    prefix: REL",
          "    meaning: variant",
          "properties:",
          "  - { key: valid-for, name: Valid for, kind: text, meaning: validity }",
          "relations:",
          "  - { key: derives-from, name: Derives from, meaning: derivation }",
          "",
        ].join("\n"),
      },
    });
    const workspace = open(ws.root);
    const metamodel = await workspace.get(metamodelState);
    const problems = [
      invalid(
        "Type release has the meaning variant, which type edition already has; a type meaning belongs to one key only",
        "model/variants.yaml",
        6,
      ),
      invalid(
        "Property valid-for has the meaning validity, which property applies-to already has; a property meaning belongs to one key only",
        "model/variants.yaml",
        8,
      ),
    ];
    expect(metamodel).toMatchObject({ valid: false, problems });
    // Both keys are listed; a relation meaning may have any number of keys.
    expect(metamodel.meanings.variant).toEqual(["edition", "release"]);
    expect(metamodel.meanings.validity).toEqual(["applies-to", "valid-for"]);
    expect(metamodel.meanings.derivation).toEqual(["satisfies", "derives-from"]);
    // The first one is used; the workspace is read-only until the metamodel is fixed (#141).
    expect(propertyWithMeaning(metamodel, "validity")?.key).toBe("applies-to");
    expect(await workspaceAccess(workspace)).toEqual({ readOnly: true, reasons: problems });
  });

  it("does not count a subtype that repeats the meaning it inherits as a second assignment", async () => {
    const metamodel = await load({
      files: {
        "model/types.yaml": [
          "logreq-metamodel: 1",
          "types:",
          "  - { key: base, name: Base, prefix: BAS, abstract: true, meaning: requirement }",
          "  - { key: spec-item, name: Specification Item, prefix: SPI, extends: base }",
          "  - { key: sub-item, name: Sub Item, prefix: SUB, extends: spec-item, meaning: requirement }",
          "  # The target type of applies-to in properties.yaml.",
          "  - { key: edition, name: Edition, prefix: ED }",
          "",
        ].join("\n"),
      },
    });
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    expect(metamodel.meanings.requirement).toEqual(["base"]);
    // Functions take the effective types: the abstract root and every subtype.
    expect(typesWithMeaning(metamodel, "requirement").map((t) => t.key)).toEqual([
      "base",
      "spec-item",
      "sub-item",
    ]);
  });

  it("counts a subtype that sets a meaning other than the one it inherits", async () => {
    // sub-item inherits need from spec-item; its requirement is a second key next to base.
    const metamodel = await load({
      files: {
        "model/types.yaml": [
          "logreq-metamodel: 1",
          "types:",
          "  - { key: base, name: Base, prefix: BAS, meaning: requirement }",
          "  - { key: spec-item, name: Specification Item, prefix: SPI, extends: base, meaning: need }",
          "  - { key: sub-item, name: Sub Item, prefix: SUB, extends: spec-item, meaning: requirement }",
          "  # The target type of applies-to in properties.yaml.",
          "  - { key: edition, name: Edition, prefix: ED }",
          "",
        ].join("\n"),
      },
    });
    expect(metamodel.valid).toBe(false);
    expect(metamodel.problems).toEqual([
      invalid(
        "Type sub-item has the meaning requirement, which type base already has; a type meaning belongs to one key only",
        "model/types.yaml",
        5,
      ),
    ]);
    expect(metamodel.meanings.need).toEqual(["spec-item"]);
  });

  it("takes a type without resolved ancestors as a root type", () => {
    const type = (key: string): Located<MetamodelType> => ({
      definition: { key, name: key, prefix: "T", meaning: "variant" },
      file: "model/types.yaml",
      lineOf: () => 3,
    });
    const assigned = assignMeanings({
      types: [type("a"), type("b")],
      effectiveTypes: [],
      properties: [],
      relations: [],
    });
    expect(assigned.meanings.variant).toEqual(["a", "b"]);
    expect(assigned.problems).toHaveLength(1);
  });

  it("reports a second key without a line when its definition has no place in a file", () => {
    const at = (key: string): Located<MetamodelProperty> => ({
      definition: { key, name: key, kind: "text", meaning: "title" },
      file: "model/properties.yaml",
      lineOf: () => undefined,
    });
    expect(
      assignMeanings({
        types: [],
        effectiveTypes: [],
        properties: [at("label"), at("name")],
        relations: [],
      }).problems,
    ).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        message:
          "Property name has the meaning title, which property label already has; a property meaning belongs to one key only",
        file: "model/properties.yaml",
      },
    ]);
  });

  it("assigns every type and property meaning of the standard model to one key, and two relation kinds to derivation and replacement", async () => {
    // SR-014 AK3 checks the standard model itself; this keeps both in step. Two relation kinds share
    // derivation (Refines, Derives from) and replacement (Supersedes, Replaces); open question #150.
    const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
    onTestFinished(() => ws.cleanup());
    const metamodel = await open(ws.root).get(metamodelState);
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    for (const [meaning, keys] of Object.entries(metamodel.meanings)) {
      const expected = meaning === "derivation" || meaning === "replacement" ? 2 : 1;
      expect(keys, meaning).toHaveLength(expected);
    }
  });

  it("has no meanings when the metamodel folder is missing", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Empty\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: model }\n",
      },
    });
    onTestFinished(() => ws.cleanup());
    const empty = await open(ws.root).get(metamodelState);
    expect(empty.valid).toBe(false);
    expect(Object.values(empty.meanings).every((keys) => keys.length === 0)).toBe(true);
    expect(unassigned(empty, "derivation", "trace.chain")?.code).toBe("metamodel.meaning-unassigned");
  });
});
