import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { Metamodel } from "./load.js";
import type { Meaning } from "./meanings.js";
import { MEANINGS } from "./meanings.js";
import { markdownKeysOf } from "./lookup.js";
import { STANDARD_MODEL_FILE, STANDARD_MODEL_TEXT } from "./standard-model.js";
import { metamodelState } from "./state.js";

const EXAMPLE = new URL("../../../../schemas/examples/metamodel/standard-model.yaml", import.meta.url);
const FIXTURES = new URL("../../../../fixtures/", import.meta.url);
/** Fixture cases whose metamodel is the standard model; other cases hold their own models. */
const FIXTURE_COPIES = [
  "SR-001/two-elements/metamodel/standard-model.yaml",
  "SR-004/one-repository/metamodel/standard-model.yaml",
  "SR-004/three-repositories/system/metamodel/standard-model.yaml",
  "SR-005/cross-repository/system/metamodel/standard-model.yaml",
  "SR-021/targets/system/metamodel/standard-model.yaml",
  "SR-040/validity/metamodel/standard-model.yaml",
  "SR-072/supersede/metamodel/standard-model.yaml",
];

/**
 * The shipped standard model, checked like any metamodel: as the only file of a metamodel folder
 * (#127 option 1: `workspace.check` comes later, so the check is the metamodel load of SR-011).
 */
const standardModel = async (): Promise<Metamodel> => {
  const ws = await createFixtureWorkspace({
    files: {
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Standard\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\n",
      [`metamodel/${STANDARD_MODEL_FILE}`]: STANDARD_MODEL_TEXT,
    },
  });
  onTestFinished(() => ws.cleanup());
  const workspace = new Workspace(ws.root);
  onTestFinished(() => workspace.close());
  const metamodel = await workspace.get(metamodelState);
  expect(metamodel).toMatchObject({ valid: true, problems: [] });
  return metamodel;
};

/** `[key, name]` pairs of a list. */
const pairs = (list: readonly { readonly key: string; readonly name: string }[]): string[][] =>
  list.map((d) => [d.key, d.name]);

/** Keys are English words in lower case with dashes (D-019, D-043); names English words. */
const KEY = /^[a-z]+(-[a-z]+)*$/;
const NAME = /^[A-Z][a-z]*( [A-Za-z][a-z]*)*$/;

describe("standard model", () => {
  it("is the example of the metamodel format, byte for byte", async () => {
    // pnpm contracts:check keeps generated/standard-model.json up to date; this checks the content.
    expect(STANDARD_MODEL_FILE).toBe("standard-model.yaml");
    expect(STANDARD_MODEL_TEXT).toBe((await fs.readFile(EXAMPLE, "utf8")).replaceAll("\r\n", "\n"));
  });

  it("has the same bytes in the fixture copies that tests use as the standard model", async () => {
    const example = await fs.readFile(EXAMPLE);
    for (const copy of FIXTURE_COPIES) {
      expect((await fs.readFile(new URL(copy, FIXTURES))).equals(example), copy).toBe(true);
    }
  });

  it("[SR-014/AK2] contains the types, properties, relation kinds and statuses of this spec with English names and keys", async () => {
    const metamodel = await standardModel();
    // D-037: "die Typen Need, Use Case, System Requirement, Decision, Variant und Package".
    expect(pairs(metamodel.types)).toEqual([
      ["need", "Need"],
      ["use-case", "Use Case"],
      ["system-requirement", "System Requirement"],
      ["decision", "Decision"],
      ["variant", "Variant"],
      ["package", "Package"],
    ]);
    // D-037: "die Beziehungsarten Refines, Derives from, Based on, Supersedes und Replaces";
    // D-059: "eine Variante nennt ihre Ausschlüsse in der Property Excludes" (a relation kind key
    // in the variant's frontmatter, ADR-0004).
    expect(pairs(metamodel.relations)).toEqual([
      ["refines", "Refines"],
      ["derives-from", "Derives from"],
      ["based-on", "Based on"],
      ["supersedes", "Supersedes"],
      ["replaces", "Replaces"],
      ["excludes", "Excludes"],
    ]);
    // D-037: "die Properties Title, Status, Rationale, Requirement Type, Acceptance Criteria und
    // Validity"; D-059: "zusätzlich die Properties Package, Emergent, Verification Method und
    // Statement sowie für die Herkunft Source, Source Identifier, Import Date und Delivery"; D-060:
    // "Das Standardmodell enthält zusätzlich zu D-037 die Property Topic (Schlüssel `topic`)".
    // Status is the structural key `status` of every element (D-012), its values are the statuses.
    expect(pairs(metamodel.properties)).toEqual([
      ["title", "Title"],
      ["rationale", "Rationale"],
      ["requirement-type", "Requirement Type"],
      ["acceptance-criteria", "Acceptance Criteria"],
      ["validity", "Validity"],
      ["packages", "Package"],
      ["emergent", "Emergent"],
      ["verification-method", "Verification Method"],
      ["statement", "Statement"],
      ["source", "Source"],
      ["source-identifier", "Source Identifier"],
      ["import-date", "Import Date"],
      ["delivery", "Delivery"],
      ["import-version", "Import Version"],
      ["topic", "Topic"],
    ]);
    // D-030: "Das Standardmodell bringt Draft, Approved und Obsolete mit."
    expect(pairs(metamodel.statuses)).toEqual([
      ["draft", "Draft"],
      ["approved", "Approved"],
      ["obsolete", "Obsolete"],
    ]);
    // The values this spec uses: requirement types and verification methods ("Inspektion" is Inspection).
    const choices = (key: string): string[][] =>
      pairs(metamodel.properties.find((p) => p.key === key)?.choices ?? []);
    expect(choices("requirement-type")).toEqual([
      ["functional", "Functional"],
      ["quality", "Quality"],
      ["performance", "Performance"],
      ["interface", "Interface"],
      ["constraint", "Constraint"],
    ]);
    expect(choices("verification-method")).toEqual([
      ["test", "Test"],
      ["analysis", "Analysis"],
      ["inspection", "Inspection"],
      ["demonstration", "Demonstration"],
    ]);
    // Topic as this spec uses it ("thema"): one free-text value on needs and system requirements,
    // which groups elements and does not count to the version (D-013); the topics are the project's.
    expect(metamodel.properties.find((p) => p.key === "topic")).toEqual({
      key: "topic",
      name: "Topic",
      kind: "text",
      description: "The topic the element belongs to, as the project names its topics.",
    });
    const withTopic = metamodel.types.filter((t) => t.properties?.includes("topic") === true);
    expect(withTopic.map((t) => t.key)).toEqual(["need", "system-requirement"]);
    for (const type of withTopic) {
      expect(type.required, type.key).not.toContain("topic");
    }
    // English names and keys throughout (D-019).
    const all = [...metamodel.types, ...metamodel.properties, ...metamodel.relations, ...metamodel.statuses];
    for (const definition of all) {
      expect(definition.key, definition.key).toMatch(KEY);
      expect(definition.name, definition.key).toMatch(NAME);
    }
    for (const relation of metamodel.relations) {
      expect(relation["inverse-name"], relation.key).toMatch(NAME);
    }
  });

  it("restricts no type's statuses: every type of the standard model has every status (#306)", async () => {
    const metamodel = await standardModel();
    expect(metamodel.types.every((t) => t.statuses === undefined)).toBe(true);
    expect(new Set(metamodel.effectiveTypes.map((t) => t.statuses.join(",")))).toEqual(
      new Set(["draft,approved,obsolete"]),
    );
  });

  it("[SR-127/AK5] marks the acceptance criteria and the rationale as Markdown, and no other property", async () => {
    const metamodel = await standardModel();
    expect(metamodel.properties.filter((p) => p.markdown === true).map((p) => p.key)).toEqual([
      "rationale",
      "acceptance-criteria",
    ]);
    expect(markdownKeysOf(metamodel)).toEqual(new Set(["rationale", "acceptance-criteria"]));
  });

  it("[SR-014/AK3] assigns every meaning of D-012 to a key: each type and property meaning to exactly one", async () => {
    const metamodel = await standardModel();
    // Open question #150, option 1 (assumption): a relation meaning may have several relation kinds
    // (D-012: "Jede Beziehungsart ist entweder eine Parent-Child-Beziehung ..."); the standard
    // model has two for derivation (Refines, Derives from).
    const expected: Readonly<Record<Meaning, readonly string[]>> = {
      requirement: ["system-requirement"],
      need: ["need"],
      variant: ["variant"],
      package: ["package"],
      title: ["title"],
      validity: ["validity"],
      packages: ["packages"],
      emergent: ["emergent"],
      "verification-method": ["verification-method"],
      statement: ["statement"],
      source: ["source"],
      "source-identifier": ["source-identifier"],
      "import-date": ["import-date"],
      delivery: ["delivery"],
      "import-version": ["import-version"],
      // Not a meaning of D-012 (#305): the spec defines no property for IDs from other sources yet,
      // so the standard model has none; a workspace adds one with `meaning: identifier`.
      identifier: [],
      derivation: ["refines", "derives-from"],
      replacement: ["replaces"],
      succession: ["supersedes"],
      exclusion: ["excludes"],
    };
    expect(metamodel.meanings).toEqual(expected);
    // Every meaning of D-012 the tool knows (MEANINGS follows metamodel.schema.json) has a key.
    for (const [meaning, keys] of Object.entries(metamodel.meanings)) {
      if (meaning === "identifier") {
        continue;
      }
      if (MEANINGS[meaning as Meaning] === "relations") {
        expect(keys.length, meaning).toBeGreaterThanOrEqual(1);
      } else {
        expect(keys, meaning).toHaveLength(1);
      }
    }
    // Flags that D-012 also fixes: the content flag (D-013, D-057; #129 option 1) and the invalid status (D-044).
    expect(metamodel.properties.filter((p) => p.content === true).map((p) => p.key)).toEqual([
      "requirement-type",
      "acceptance-criteria",
      "validity",
    ]);
    expect(metamodel.statuses.filter((s) => s.invalid === true).map((s) => s.key)).toEqual(["obsolete"]);
    expect(metamodel.statuses.filter((s) => s.initial === true).map((s) => s.key)).toEqual(["draft"]);
  });
});
