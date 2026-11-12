import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, expectTypeOf, it, onTestFinished } from "vitest";
import { CommandError, errorClass } from "../catalog.js";
import type { CommandName, Problem } from "../catalog.js";
import { Workspace } from "../runtime/workspace.js";
import type { MetamodelProperty, MetamodelRelationKind, MetamodelType } from "../generated/types.js";
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
import {
  assignMeanings,
  markdownProblems,
  meaningKindProblems,
  meaningShapeProblems,
  relationMeaningProblems,
} from "./meanings.js";
import {
  MEANINGS,
  metamodelState,
  propertyWithMeaning,
  relationKindsWithMeaning,
  requireMeaning,
  typesWithMeaning,
  workspaceAccess,
} from "./index.js";

// ThomasBirkmaier/ReqSeq-archive#127 option 1: SR-013 AK1 and AK2 are tested here, at the lowest existing level, where the core
// resolves a meaning to the keys of the metamodel. The chain (trace.chain, stage 2) and the variant
// view (SR-040, SR-043, stage 5) build on these functions and add end-to-end tests with the same
// [SR-013/AK-st9d] and [SR-013/AK-tm7f] prefixes.

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
  it("[SR-013/AK-st9d] follows an own relation kind marked with the meaning derivation", async () => {
    const metamodel = await load();
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    // The chain follows exactly the relation kinds with the meaning derivation, whatever their key.
    expect(relationKindsWithMeaning(metamodel, "derivation").map((r) => r.key)).toEqual(["satisfies"]);
    expect(unassigned(metamodel, "derivation", "trace.chain")).toBeUndefined();
    expect(metamodel.meanings.derivation).toEqual(["satisfies"]);
  });

  it("[SR-013/AK-st9d] follows every relation kind that shares the meaning derivation, never one without it", async () => {
    const metamodel = await load({
      files: {
        "model/relations.yaml": [
          "reqseq-metamodel: 1",
          "relations:",
          "  - { key: satisfies, name: Satisfies, meaning: derivation }",
          "  - { key: traces-to, name: Traces to }",
          "  - { key: refines, name: Refines, meaning: derivation }",
          "  - { key: obsoletes, name: Obsoletes, source-types: [spec-item], target-types: [spec-item], meaning: replacement }",
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

  it("[SR-013/AK-tm7f] resolves the own property marked with the meaning validity, not the one keyed validity", async () => {
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

  it("[SR-013/AK-bh0d] names the missing assignment when a function needs a meaning that no key has", async () => {
    const metamodel = await load({
      files: {
        "model/relations.yaml": "reqseq-metamodel: 1\nrelations:\n  - { key: traces-to, name: Traces to }\n",
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

  it("[SR-013/AK-bh0d] names a missing property and a missing type meaning the same way", async () => {
    const metamodel = await load({
      files: {
        "model/types.yaml":
          "reqseq-metamodel: 1\ntypes:\n  - { key: wish, name: Stakeholder Wish, prefix: W, properties: [label] }\n",
        "model/properties.yaml":
          "reqseq-metamodel: 1\nproperties:\n  - { key: label, name: Label, kind: text, meaning: title }\n",
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
      "import-version": [],
      identifier: [],
      "acceptance-criteria": [],
      derivation: ["satisfies"],
      replacement: [],
      succession: [],
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
      "import-version": "properties",
      identifier: "properties",
      "acceptance-criteria": "properties",
      derivation: "relations",
      replacement: "relations",
      succession: "relations",
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
          "reqseq-metamodel: 1",
          "types:",
          "  - { key: spec-item, name: Specification Item, prefix: SPI, meaning: requirement }",
          "  - { key: sub-item, name: Sub Item, prefix: SUB, extends: spec-item }",
          "  # The target type of applies-to in properties.yaml.",
          "  - { key: edition, name: Edition, prefix: ED, meaning: variant }",
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
          "reqseq-metamodel: 1",
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
    // The first one is used; the workspace is read-only until the metamodel is fixed (ThomasBirkmaier/ReqSeq-archive#141).
    expect(propertyWithMeaning(metamodel, "validity")?.key).toBe("applies-to");
    expect(await workspaceAccess(workspace)).toEqual({ readOnly: true, reasons: problems });
  });

  it("does not count a subtype that repeats the meaning it inherits as a second assignment", async () => {
    const metamodel = await load({
      files: {
        "model/types.yaml": [
          "reqseq-metamodel: 1",
          "types:",
          "  - { key: base, name: Base, prefix: BAS, abstract: true, meaning: requirement }",
          "  - { key: spec-item, name: Specification Item, prefix: SPI, extends: base }",
          "  - { key: sub-item, name: Sub Item, prefix: SUB, extends: spec-item, meaning: requirement }",
          "  # The target type of applies-to in properties.yaml.",
          "  - { key: edition, name: Edition, prefix: ED, meaning: variant }",
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
          "reqseq-metamodel: 1",
          "types:",
          "  - { key: base, name: Base, prefix: BAS, meaning: requirement }",
          "  - { key: spec-item, name: Specification Item, prefix: SPI, extends: base, meaning: need }",
          "  - { key: sub-item, name: Sub Item, prefix: SUB, extends: spec-item, meaning: requirement }",
          "  # The target type of applies-to in properties.yaml.",
          "  - { key: edition, name: Edition, prefix: ED, meaning: variant }",
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

  it("reports the meaning identifier on another kind than text, without a line when the place is not known (ThomasBirkmaier/ReqSeq-archive#305)", () => {
    const at = (definition: MetamodelProperty): Located<MetamodelProperty> => ({
      definition,
      file: "model/properties.yaml",
      lineOf: () => undefined,
    });
    expect(
      meaningKindProblems([
        at({ key: "a", name: "A", kind: "text", meaning: "identifier" }),
        at({ key: "b", name: "B", kind: "text", many: false, meaning: "identifier" }),
        at({ key: "c", name: "C", kind: "date", meaning: "identifier" }),
        at({ key: "d", name: "D", kind: "number", meaning: "title" }),
      ]),
    ).toEqual([
      {
        code: "metamodel.invalid",
        severity: "error",
        message:
          "Property c has the meaning identifier, which needs kind text without many (one text per element), not kind date",
        file: "model/properties.yaml",
      },
    ]);
  });

  it("#141: takes the meaning of a validity target type from its parent", async () => {
    const properties = (targets: string): string =>
      "reqseq-metamodel: 1\nproperties:\n  - { key: label, name: Label, kind: text, meaning: title }\n" +
      `  - { key: applies-to, name: Applies to, kind: relation, many: true, target-types: [${targets}], meaning: validity }\n` +
      "  - { key: validity, name: Validity note, kind: text }\n";
    const sub =
      "reqseq-metamodel: 1\ntypes:\n  - { key: sub-edition, name: Sub-edition, prefix: SE, extends: edition }\n";
    const inherited = await load({
      files: { "model/properties.yaml": properties("sub-edition"), "model/sub.yaml": sub },
    });
    expect(inherited.problems).toEqual([]);
    const wrong = await load({ files: { "model/properties.yaml": properties("wish") } });
    expect(wrong.problems.map((p) => [p.severity, p.message])).toEqual([
      [
        "error",
        "Property applies-to has the meaning validity, which needs kind relation with many to types with the meaning variant, not target types wish without the meaning variant",
      ],
    ]);
  });

  it("#141: reports a property meaning on a property of the wrong kind as an error at its meaning", () => {
    const at = (definition: MetamodelProperty): Located<MetamodelProperty> => ({
      definition,
      file: "model/properties.yaml",
      lineOf: (path) => (path[0] === "meaning" ? 7 : undefined),
    });
    const types: Readonly<Record<string, { meaning?: string }>> = {
      edition: { meaning: "variant" },
      box: { meaning: "package" },
      plain: {},
    };
    const typeOf = (key: string): { meaning?: string } | undefined => types[key];
    const messages = meaningShapeProblems(
      [
        at({ key: "t", name: "T", kind: "text", meaning: "title" }),
        at({ key: "s", name: "S", kind: "text", many: true, meaning: "statement" }),
        at({ key: "d", name: "D", kind: "text", meaning: "import-date" }),
        at({ key: "v", name: "V", kind: "relation", meaning: "validity" }),
        at({
          key: "w",
          name: "W",
          kind: "relation",
          many: true,
          "target-types": ["edition", "box", "plain", "nosuch"],
          meaning: "validity",
        }),
        at({
          key: "p",
          name: "P",
          kind: "relation",
          many: true,
          "target-types": ["box"],
          meaning: "packages",
        }),
        at({ key: "q", name: "Q", kind: "relation", many: true, meaning: "packages" }),
        at({ key: "m", name: "M", kind: "choice", meaning: "verification-method" }),
        at({ key: "e", name: "E", kind: "text", meaning: "emergent" }),
        at({ key: "x", name: "X", kind: "text" }),
      ],
      typeOf,
    );
    expect(messages).toEqual(
      [
        "Property s has the meaning statement, which needs kind text without many, not a list",
        "Property d has the meaning import-date, which needs kind date without many, not kind text",
        "Property v has the meaning validity, which needs kind relation with many to types with the meaning variant, not a single value",
        "Property w has the meaning validity, which needs kind relation with many to types with the meaning variant, not target types box, plain without the meaning variant",
        "Property q has the meaning packages, which needs kind relation with many to types with the meaning package, not every type (no target-types)",
      ].map((message) => ({
        code: "metamodel.invalid",
        severity: "error",
        message,
        file: "model/properties.yaml",
        line: 7,
      })),
    );
  });

  it("#842: warns about a relation kind with the meaning exclusion from a type that is no variant, at its source-types", async () => {
    const relations = (sources: string, targets: string): string =>
      "reqseq-metamodel: 1\nrelations:\n  - { key: satisfies, name: Satisfies, meaning: derivation }\n" +
      `  - key: excludes\n    name: Excludes\n    source-types: [${sources}]\n    target-types: [${targets}]\n    meaning: exclusion\n`;
    const misfit = await load({ files: { "model/relations.yaml": relations("wish, edition", "spec-item") } });
    expect(misfit.valid).toBe(true);
    expect(misfit.problems).toEqual([
      {
        code: "metamodel.meaning-type-mismatch",
        severity: "warning",
        message:
          "Relation kind excludes has the meaning exclusion, whose sources are types with the meaning variant, not wish (meaning need)",
        file: "model/relations.yaml",
        line: 6,
        repository: "system",
      },
    ]);
    const fitting = await load({ files: { "model/relations.yaml": relations("edition", "spec-item") } });
    expect(fitting.problems).toEqual([]);
  });

  it("#842: warns about a relation kind with the meaning replacement to a type without the validity property, at its target-types", async () => {
    const relations =
      "reqseq-metamodel: 1\nrelations:\n  - key: replaces\n    name: Replaces\n    source-types: [spec-item]\n" +
      "    target-types: [spec-item, edition]\n    meaning: replacement\n";
    const misfit = await load({ files: { "model/relations.yaml": relations } });
    expect(misfit.problems.map((p) => [p.code, p.severity, p.line, p.message])).toEqual([
      [
        "metamodel.meaning-type-mismatch",
        "warning",
        6,
        "Relation kind replaces has the meaning replacement, whose targets are types with the property of the meaning validity (applies-to), not edition",
      ],
    ]);
  });

  it("#842: a subtype fits by the meaning or the validity property it only inherits, and any type with the validity property fits (SR-041 AK8, SR-042 AK7)", async () => {
    const subtypes =
      "reqseq-metamodel: 1\ntypes:\n  - { key: sub-edition, name: Sub-edition, prefix: SE, extends: edition }\n" +
      "  - { key: sub-item, name: Sub-item, prefix: SI, extends: spec-item }\n" +
      "  - { key: valid-wish, name: Valid wish, prefix: VW, extends: wish, properties: [applies-to] }\n";
    const relations =
      "reqseq-metamodel: 1\nrelations:\n" +
      "  - { key: excludes, name: Excludes, source-types: [sub-edition], target-types: [sub-item, valid-wish], meaning: exclusion }\n" +
      "  - { key: replaces, name: Replaces, source-types: [valid-wish], target-types: [sub-item], meaning: replacement }\n";
    const fitting = await load({
      files: { "model/sub.yaml": subtypes, "model/relations.yaml": relations },
    });
    expect(fitting.problems).toEqual([]);
  });

  it("#842: checks only exclusion and replacement, skips unknown keys, names a missing list and a missing validity property", () => {
    const at = (definition: MetamodelRelationKind): Located<MetamodelRelationKind> => ({
      definition,
      file: "model/relations.yaml",
      lineOf: (path) => (path[0] === "meaning" ? 9 : undefined),
    });
    const types: Readonly<Record<string, { meaning?: string; properties: string[] }>> = {
      edition: { meaning: "variant", properties: [] },
      item: { meaning: "requirement", properties: ["validity"] },
      plain: { properties: [] },
    };
    const typeOf = (key: string): { meaning?: string; properties: string[] } | undefined => types[key];
    const replacement = at({
      key: "r",
      name: "R",
      "target-types": ["item", "plain"],
      meaning: "replacement",
    });
    const kinds = [
      at({
        key: "d",
        name: "D",
        "source-types": ["plain"],
        "target-types": ["plain"],
        meaning: "derivation",
      }),
      at({ key: "s", name: "S", meaning: "succession" }),
      at({ key: "n", name: "N", "source-types": ["plain"] }),
      at({
        key: "e",
        name: "E",
        "source-types": ["edition", "plain", "nosuch"],
        "target-types": [],
        meaning: "exclusion",
      }),
      replacement,
    ];
    const warning = (message: string, line?: number): Problem => ({
      code: "metamodel.meaning-type-mismatch",
      severity: "warning",
      message,
      file: "model/relations.yaml",
      ...(line === undefined ? {} : { line }),
    });
    expect(relationMeaningProblems(kinds, typeOf, "validity")).toEqual([
      warning(
        "Relation kind e has the meaning exclusion, whose sources are types with the meaning variant, not plain (no meaning)",
      ),
      warning(
        "Relation kind r has the meaning replacement, whose sources are types with the property of the meaning validity (validity), not every type (no source-types)",
        9,
      ),
      warning(
        "Relation kind r has the meaning replacement, whose targets are types with the property of the meaning validity (validity), not plain",
      ),
    ]);
    expect(relationMeaningProblems([replacement], typeOf, undefined).map((p) => p.message)).toEqual([
      "Relation kind r has the meaning replacement, whose sources are types with the property of the meaning validity (no property has it), not every type (no source-types)",
      "Relation kind r has the meaning replacement, whose targets are types with the property of the meaning validity (no property has it), not item, plain",
    ]);
  });

  it("#357: the meaning import-version needs kind text without many and never content, else an error on that line", () => {
    const lines: Readonly<Record<string, number>> = { kind: 3, many: 4, content: 5 };
    const at = (definition: MetamodelProperty): Located<MetamodelProperty> => ({
      definition,
      file: "model/properties.yaml",
      lineOf: (path) => lines[String(path[0])],
    });
    const problem = (key: string, line: number, not: string): Problem => ({
      code: "metamodel.invalid",
      severity: "error",
      message: `Property ${key} has the meaning import-version, which needs kind text without many and never counts to the version (D-059), not ${not}`,
      file: "model/properties.yaml",
      line,
    });
    expect(
      meaningKindProblems([
        at({ key: "a", name: "A", kind: "text", meaning: "import-version" }),
        at({ key: "b", name: "B", kind: "text", many: false, content: false, meaning: "import-version" }),
        at({ key: "c", name: "C", kind: "date", meaning: "import-version" }),
        at({ key: "d", name: "D", kind: "text", many: true, meaning: "import-version" }),
        at({ key: "e", name: "E", kind: "text", content: true, meaning: "import-version" }),
      ]),
    ).toEqual([problem("c", 3, "kind date"), problem("d", 4, "a list"), problem("e", 5, "content: true")]);
  });

  it("ThomasBirkmaier/ReqSeq-archive#591: the meaning emergent wants a single choice with the key yes, else a warning", async () => {
    const lines: Readonly<Record<string, number>> = { kind: 4, many: 5, choices: 6 };
    const at = (definition: MetamodelProperty, known = true): Located<MetamodelProperty> => ({
      definition,
      file: "model/properties.yaml",
      lineOf: (path) => (known ? lines[String(path[0])] : undefined),
    });
    const warning = (key: string, reason: string, line?: number): Problem => ({
      code: "metamodel.invalid",
      severity: "warning",
      message: `Property ${key} has the meaning emergent, which needs kind choice without many and the choice yes (the mark), not ${reason}; no element is marked emergent`,
      file: "model/properties.yaml",
      ...(line === undefined ? {} : { line }),
    });
    const yesNo = [
      { key: "yes", name: "Yes" },
      { key: "no", name: "No" },
    ];
    expect(
      meaningKindProblems([
        at({ key: "a", name: "A", kind: "text", meaning: "emergent" }),
        at({ key: "b", name: "B", kind: "choice", many: true, choices: yesNo, meaning: "emergent" }),
        at({
          key: "c",
          name: "C",
          kind: "choice",
          choices: [{ key: "ja", name: "Ja" }],
          meaning: "emergent",
        }),
        at({ key: "d", name: "D", kind: "choice", meaning: "emergent" }),
        at({ key: "e", name: "E", kind: "number", meaning: "emergent" }, false),
        at({ key: "f", name: "F", kind: "choice", many: false, choices: yesNo, meaning: "emergent" }),
        at({ key: "g", name: "G", kind: "text" }),
      ]),
    ).toEqual([
      warning("a", "kind text", 4),
      warning("b", "a list", 5),
      warning("c", "no choice yes", 6),
      warning("d", "no choice yes", 6),
      warning("e", "kind number"),
    ]);
    // The standard model complies, and a warning leaves the metamodel valid.
    expect(await load({ fixture: "SR-035/emergent" })).toMatchObject({ valid: true, problems: [] });
  });

  it("[SR-013/AK-rbh2] the meaning acceptance-criteria wants kind text with many, else a warning, and the standard model assigns it", async () => {
    const lines: Readonly<Record<string, number>> = { kind: 4, many: 5 };
    const at = (definition: MetamodelProperty): Located<MetamodelProperty> => ({
      definition,
      file: "model/properties.yaml",
      lineOf: (path) => lines[String(path[0])],
    });
    const warning = (key: string, reason: string, line: number): Problem => ({
      code: "metamodel.invalid",
      severity: "warning",
      message: `Property ${key} has the meaning acceptance-criteria, which needs kind text with many (one text per criterion), not ${reason}; no acceptance criterion is read`,
      file: "model/properties.yaml",
      line,
    });
    expect(
      meaningKindProblems([
        at({ key: "a", name: "A", kind: "text", meaning: "acceptance-criteria" }),
        at({ key: "b", name: "B", kind: "choice", many: true, meaning: "acceptance-criteria" }),
        at({ key: "c", name: "C", kind: "text", many: true, meaning: "acceptance-criteria" }),
      ]),
    ).toEqual([warning("a", "a single value", 5), warning("b", "kind choice", 4)]);
    const standard = await load({ fixture: "SR-001/two-elements" });
    expect(standard).toMatchObject({ valid: true, problems: [] });
    expect(standard.meanings["acceptance-criteria"]).toEqual(["acceptance-criteria"]);
  });

  it("[SR-127/AK-mdr7] reports markdown on another kind than text and with the meaning title or identifier, with the line of markdown when it is known", () => {
    const at = (definition: MetamodelProperty, line?: number): Located<MetamodelProperty> => ({
      definition,
      file: "model/properties.yaml",
      lineOf: (path) => (path[0] === "markdown" ? line : undefined),
    });
    const problem = (key: string, reason: string, line?: number): Record<string, unknown> => ({
      code: "metamodel.invalid",
      severity: "error",
      message: `Property ${key} is marked markdown, which needs kind text and neither the meaning title nor identifier (titles and identifiers are plain text), not ${reason}`,
      file: "model/properties.yaml",
      ...(line === undefined ? {} : { line }),
    });
    expect(
      markdownProblems([
        at({ key: "a", name: "A", kind: "text", markdown: true }),
        at({ key: "b", name: "B", kind: "text", many: true, markdown: false }),
        at({ key: "c", name: "C", kind: "choice", markdown: true }, 7),
        at({ key: "d", name: "D", kind: "text", meaning: "title", markdown: true }, 9),
        at({ key: "e", name: "E", kind: "text", meaning: "identifier", markdown: true }),
        at({ key: "f", name: "F", kind: "text", meaning: "emergent" }),
      ]),
    ).toEqual([
      problem("c", "kind choice", 7),
      problem("d", "the meaning title", 9),
      problem("e", "the meaning identifier"),
    ]);
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

  it("assigns every type and property meaning of the standard model to one key, and two relation kinds to derivation", async () => {
    // SR-014 AK3 checks the standard model itself; this keeps both in step. Two relation kinds share
    // derivation (Refines, Derives from); open question ThomasBirkmaier/ReqSeq-archive#150.
    const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
    onTestFinished(() => ws.cleanup());
    const metamodel = await open(ws.root).get(metamodelState);
    expect(metamodel).toMatchObject({ valid: true, problems: [] });
    for (const [meaning, keys] of Object.entries(metamodel.meanings)) {
      // `identifier` (ThomasBirkmaier/ReqSeq-archive#305) is no meaning of D-012; the standard model has no property with it.
      const expected = meaning === "derivation" ? 2 : meaning === "identifier" ? 0 : 1;
      expect(keys, meaning).toHaveLength(expected);
    }
  });

  it("has no meanings when the metamodel folder is missing", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "reqseq-workspace.yaml":
          "reqseq-workspace: 1\nname: Empty\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: model }\n",
      },
    });
    onTestFinished(() => ws.cleanup());
    const empty = await open(ws.root).get(metamodelState);
    expect(empty.valid).toBe(false);
    expect(Object.values(empty.meanings).every((keys) => keys.length === 0)).toBe(true);
    expect(unassigned(empty, "derivation", "trace.chain")?.code).toBe("metamodel.meaning-unassigned");
  });
});
