// Checking property values against their value kind (SR-085, D-043). Every top-level key of an
// element that the metamodel defines as a property or relation kind is checked against the kind of
// its definition; a mismatch is a hint (`warning`: it blocks nothing and changes no status, glossary
// "Hinweis"), never an error, and the file is still read and kept unchanged. Keys the metamodel does
// not know are SR-016 (D-012); which target types a relation may have is SR-086: this check decides
// only whether a value is a relation target at all.
import type { Problem } from "../catalog.js";
import type { MetamodelNamed, MetamodelProperty } from "../generated/types.js";
import type { KeyDefinition, Metamodel } from "../metamodel/index.js";
import { keyDefinition, metamodelState } from "../metamodel/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS } from "./elements.js";
import { locateFindings } from "./locate.js";
import { isRelationTarget } from "./relations.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

/** Value kind (Wertart) of a property; a relation kind holds relation targets. */
export type ValueKind = MetamodelProperty["kind"];

/** Where a wrong value sits in the frontmatter: its key, and the index of the item in a list. */
export type ValuePath = readonly [key: string] | readonly [key: string, item: number];

/** A value of the wrong kind, before its line is known (`locateFindings` adds it). */
export interface ValueFinding {
  /** The element whose file holds the value. */
  readonly element: ElementRecord;
  readonly path: ValuePath;
  /** `element.wrong-value-kind`, severity `warning`, with repository, file and element ID; no line yet. */
  readonly problem: Problem;
}

/** What the metamodel says a key's value must be. */
interface ValueDefinition {
  /** How messages name the key: kind of definition, display name and key (D-043). */
  readonly label: string;
  readonly kind: ValueKind;
  readonly many: boolean;
  /** The allowed keys of a choice. */
  readonly choices: ReadonlySet<string>;
  /** What the kind expects, for messages; a choice lists its allowed values (SR-085 AK2). */
  readonly expected: string;
}

const isDate = (value: unknown): boolean => fileSchemaValidator("common.schema.json#/$defs/date")(value);

/** Choice values listed in a message; a longer list is cut. */
const LISTED_CHOICES = 20;

const allowedValues = (choices: readonly MetamodelNamed[]): string => {
  if (choices.length === 0) {
    return "a choice value, but the metamodel defines none";
  }
  const listed = choices.slice(0, LISTED_CHOICES).map((c) => `${c.key} (${c.name})`);
  return `one of ${listed.join(", ")}${choices.length > LISTED_CHOICES ? ", …" : ""}`;
};

const EXPECTED: Readonly<Record<Exclude<ValueKind, "choice">, string>> = {
  text: "text",
  number: "a number",
  date: "a date YYYY-MM-DD",
  relation: "a relation target { id, version }",
};

const propertyDefinition = (property: MetamodelProperty): ValueDefinition => {
  const choices = property.choices ?? [];
  return {
    label: `Property ${property.name} (${property.key})`,
    kind: property.kind,
    many: property.many === true,
    choices: new Set(choices.map((c) => c.key)),
    expected: property.kind === "choice" ? allowedValues(choices) : EXPECTED[property.kind],
  };
};

/** A relation kind holds a list of relation targets (ADR-0004). */
const valueDefinition = ({ kind, definition }: KeyDefinition): ValueDefinition =>
  kind === "property"
    ? propertyDefinition(definition)
    : {
        label: `Relation ${definition.name} (${definition.key})`,
        kind: "relation",
        many: true,
        choices: new Set(),
        expected: EXPECTED.relation,
      };

/** What the metamodel says a key's value must be, undefined for a key it does not know. */
type Definitions = (key: string) => ValueDefinition | undefined;

/** One cache per metamodel object; a reset of the metamodel state makes a new object. */
const indexes = new WeakMap<Metamodel, Definitions>();

/** The definitions by key (`keyDefinition`: a property wins over a relation kind), built on first use. */
const definitionsOf = (metamodel: Metamodel): Definitions => {
  const known = indexes.get(metamodel);
  if (known !== undefined) {
    return known;
  }
  const cache = new Map<string, ValueDefinition | undefined>();
  const definitions: Definitions = (key) => {
    if (!cache.has(key)) {
      const found = keyDefinition(metamodel, key);
      cache.set(key, found === undefined ? undefined : valueDefinition(found));
    }
    return cache.get(key);
  };
  indexes.set(metamodel, definitions);
  return definitions;
};

/** Whether one value (a single value or one item of a list) has the kind of `definition`. */
const hasKind = (definition: ValueDefinition, value: unknown): boolean => {
  switch (definition.kind) {
    case "text":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "date":
      return isDate(value);
    case "choice":
      return typeof value === "string" && definition.choices.has(value);
    case "relation":
      return isRelationTarget(value);
  }
};

/** Longest text of a value shown in a message. */
const SHOWN_TEXT = 40;

/**
 * A short description of a value for messages; long texts are cut. A number or boolean where text
 * is expected is what YAML made of unquoted text (`1.0` is read as 1), so the message says how to
 * keep it as text.
 */
const describe = (value: unknown, kind?: ValueKind): string => {
  if (typeof value === "string") {
    const shown = value.length > SHOWN_TEXT ? `${value.slice(0, SHOWN_TEXT)}...` : value;
    return `the text ${JSON.stringify(shown)}`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const described = `the ${typeof value} ${String(value)}`;
    return kind === "text" ? `${described}; write it in quotes to keep it as text` : described;
  }
  if (value === null) {
    return "empty";
  }
  return Array.isArray(value) ? "a list" : "a mapping";
};

const finding = (element: ElementRecord, path: ValuePath, message: string): ValueFinding => ({
  element,
  path,
  problem: {
    code: "element.wrong-value-kind",
    severity: "warning",
    message,
    repository: element.repository,
    file: element.file,
    elementId: element.id,
  },
});

/** The findings of one key. An empty value (`key:` without value) is no wrong kind (SR-064). */
const keyFindings = (
  element: ElementRecord,
  key: string,
  definition: ValueDefinition,
  value: unknown,
  out: ValueFinding[],
): void => {
  if (value === null) {
    return;
  }
  const { label, expected } = definition;
  if (!definition.many) {
    if (Array.isArray(value)) {
      out.push(finding(element, [key], `${label} expects ${expected}, not a list`));
    } else if (!hasKind(definition, value)) {
      out.push(
        finding(
          element,
          [key],
          `${label} expects ${expected}; the value is ${describe(value, definition.kind)}`,
        ),
      );
    }
    return;
  }
  if (!Array.isArray(value)) {
    out.push(
      finding(
        element,
        [key],
        `${label} expects a list, each item ${expected}; the value is ${describe(value)}`,
      ),
    );
    return;
  }
  value.forEach((item: unknown, i) => {
    if (!hasKind(definition, item)) {
      out.push(
        finding(
          element,
          [key, i],
          `${label} expects each item to be ${expected}; item ${String(i + 1)} is ${describe(item, definition.kind)}`,
        ),
      );
    }
  });
};

const collect = (element: ElementRecord, definitions: Definitions, out: ValueFinding[]): void => {
  for (const [key, value] of Object.entries(element.data)) {
    const definition = definitions(key);
    if (definition !== undefined && !STRUCTURAL_KEYS.includes(key)) {
      keyFindings(element, key, definition, value, out);
    }
  }
};

/**
 * The values of one element that do not have the kind the metamodel gives their key, in the order
 * of the keys in the file, then of the list items. For a command about one element: `element.get`
 * (with `locateFindings` for the lines of just this element) and `element.update`/`element.create`
 * (SR-001, lines from the file at hand or `locateFindings`).
 */
export const valueFindings = (element: ElementRecord, metamodel: Metamodel): readonly ValueFinding[] => {
  const out: ValueFinding[] = [];
  collect(element, definitionsOf(metamodel), out);
  return out;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const valueKindFindings = (store: ElementStore, metamodel: Metamodel): readonly ValueFinding[] => {
  const definitions = definitionsOf(metamodel);
  const out: ValueFinding[] = [];
  for (const element of store.elements) {
    collect(element, definitions, out);
  }
  return out;
};

/**
 * Every value of the wrong kind in the workspace as a problem with repository, file, line and
 * element ID (SR-085), for `workspace.check` (SR-019); one element's come from `valueFindings`.
 * Reads every file with findings again for the lines (`locateFindings`): at 50,000 elements that
 * all have a finding that is a full read of the workspace. Kept until the element store or the
 * metamodel is reset.
 */
export const valueKindProblemsState = defineWorkspaceState(
  "value-kinds",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, valueKindFindings(store, metamodel));
  },
  { dependsOn: [elementStoreState, metamodelState] },
);
