// Built-in meanings (SR-013, D-012, D-059): the tool knows a fixed set of meanings, and the
// metamodel assigns them to its own keys with `meaning` on a type, a property or a relation kind.
// Functions never look for a key such as `derives-from` or `validity`; they ask for the keys with
// a meaning (the chain for `derivation`, the variant view for `validity`, ...), and report which
// assignment is missing when there is none (SR-013 AK3).
//
// A type or property meaning belongs to one key only (metamodel.schema.json); a second key is a
// metamodel error with file and line, so the workspace opens read-only (open question #141). Only
// the meanings a definition declares itself count: a type that inherits a meaning (SR-012), or
// repeats the one it inherits, is no second assignment. Several relation kinds may share a meaning
// (Refines and Derives from are both `derivation`, D-012).
//
// Not in this table: the structural keys `id`, `type` and `status` of every element file, and the
// flags `content` of a property (D-013, D-057) and `invalid` of a status (D-044), which are fields
// of the definitions.
import type { CommandName, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type {
  MetamodelKey,
  MetamodelProperty,
  MetamodelPropertyMeaning,
  MetamodelRelationKind,
  MetamodelRelationMeaning,
  MetamodelType,
  MetamodelTypeMeaning,
} from "../generated/types.js";
import type { EffectiveType, Located } from "./inheritance.js";
import type { Metamodel } from "./load.js";

export type TypeMeaning = MetamodelTypeMeaning;
export type PropertyMeaning = MetamodelPropertyMeaning;
export type RelationMeaning = MetamodelRelationMeaning;
/** Every built-in meaning the metamodel assigns with `meaning`. */
export type Meaning = TypeMeaning | PropertyMeaning | RelationMeaning;

/**
 * The metamodel list whose definitions carry a meaning. The three enums of the schema are disjoint
 * (meanings.test.ts checks it), so each meaning has exactly one list.
 */
export type MeaningList<M extends Meaning = Meaning> = M extends TypeMeaning
  ? "types"
  : M extends PropertyMeaning
    ? "properties"
    : "relations";

/**
 * All built-in meanings and the list that assigns each, in the order of metamodel.schema.json. The
 * type makes a new meaning of the schema fail to compile until it is listed here, in its list.
 */
export const MEANINGS: { readonly [M in Meaning]: MeaningList<M> } = {
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
  derivation: "relations",
  replacement: "relations",
  succession: "relations",
  exclusion: "relations",
};

const ALL_MEANINGS = Object.keys(MEANINGS) as readonly Meaning[];

/** For every meaning, the keys whose own definition declares it, in metamodel order. */
export type MeaningAssignment = Readonly<Record<Meaning, readonly MetamodelKey[]>>;

export interface AssignedMeanings {
  readonly meanings: MeaningAssignment;
  /** `metamodel.invalid` errors for a type or property meaning that a second key declares. */
  readonly problems: readonly Problem[];
}

/** A definition of a list as messages name it, inside and at the start of a sentence. */
const LABELS: Readonly<Record<MeaningList, { readonly label: string; readonly start: string }>> = {
  types: { label: "type", start: "Type" },
  properties: { label: "property", start: "Property" },
  relations: { label: "relation kind", start: "Relation kind" },
};

interface WithMeaning {
  readonly key: MetamodelKey;
  readonly meaning?: Meaning;
}

/**
 * The meaning a type would inherit: the own meaning of its closest ancestor that has one.
 * `ancestors` is the parent first, as in `EffectiveType`.
 */
const inheritedMeaning = (
  ancestors: readonly MetamodelKey[],
  ownMeanings: ReadonlyMap<MetamodelKey, TypeMeaning | undefined>,
): TypeMeaning | undefined =>
  ancestors.map((key) => ownMeanings.get(key)).find((meaning) => meaning !== undefined);

/**
 * Assigns the meanings of the merged definitions (each list in metamodel order, keys unique).
 * Types first, then properties, then relation kinds; the problems come in the same order.
 * `effectiveTypes` are the resolved `types` (inheritance.ts): a type that sets the meaning it
 * inherits anyway is left out, as if it did not repeat it.
 */
export const assignMeanings = (lists: {
  readonly types: readonly Located<MetamodelType>[];
  readonly effectiveTypes: readonly EffectiveType[];
  readonly properties: readonly Located<MetamodelProperty>[];
  readonly relations: readonly Located<MetamodelRelationKind>[];
}): AssignedMeanings => {
  const meanings = {} as Record<Meaning, MetamodelKey[]>;
  for (const meaning of ALL_MEANINGS) {
    meanings[meaning] = [];
  }
  const problems: Problem[] = [];
  const assign = (list: MeaningList, located: readonly Located<WithMeaning>[]): void => {
    for (const { definition, file, lineOf } of located) {
      const { key, meaning } = definition;
      if (meaning === undefined) {
        continue;
      }
      const assigned = meanings[meaning];
      const [first] = assigned;
      if (first !== undefined && list !== "relations") {
        const { label, start } = LABELS[list];
        const line = lineOf(["meaning"]);
        problems.push({
          code: "metamodel.invalid",
          severity: "error",
          message: `${start} ${key} has the meaning ${meaning}, which ${label} ${first} already has; a ${label} meaning belongs to one key only`,
          file,
          ...(line === undefined ? {} : { line }),
        });
      }
      assigned.push(key);
    }
  };
  const ownMeanings = new Map(lists.types.map((t) => [t.definition.key, t.definition.meaning]));
  const ancestors = new Map(lists.effectiveTypes.map((t) => [t.key, t.ancestors]));
  assign(
    "types",
    // A type without resolved ancestors counts as a root type.
    lists.types.filter(
      ({ definition: { key, meaning } }) =>
        meaning !== inheritedMeaning(ancestors.get(key) ?? [], ownMeanings),
    ),
  );
  assign("properties", lists.properties);
  assign("relations", lists.relations);
  return { meanings, problems };
};

/** A `metamodel.invalid` problem of `file`, with its line when it is known. */
const problemAt = (
  file: string,
  line: number | undefined,
  message: string,
  severity: Problem["severity"],
): Problem => ({
  code: "metamodel.invalid",
  severity,
  message,
  file,
  ...(line === undefined ? {} : { line }),
});

/**
 * The choice key that marks an element emergent (SR-035, assumption of spec question #591 Q1): the
 * check below and the mark of `model/emergent.ts` share it.
 */
export const EMERGENT_CHOICE = "yes";

/**
 * Why a property with the meaning `import-version` (the Importfassung, D-059) is wrong, and the key
 * whose line names it; undefined when it is right. It must be one text per element and never count
 * to the version, else every imported element would read as locally changed (#357).
 */
const importVersionProblem = ({
  kind,
  many,
  content,
}: MetamodelProperty): { readonly at: string; readonly reason: string } | undefined => {
  if (kind !== "text") {
    return { at: "kind", reason: `kind ${kind}` };
  }
  if (many === true) {
    return { at: "many", reason: "a list" };
  }
  return content === true ? { at: "content", reason: "content: true" } : undefined;
};

/**
 * Why a property with the meaning `emergent` cannot hold the mark, and the key whose line names it;
 * undefined when it can (#591 Q1). Without the mark no element is emergent (`model/emergent.ts`).
 */
export const emergentProblem = (
  property: MetamodelProperty,
): { readonly reason: string; readonly at: string } | undefined => {
  if (property.kind !== "choice") {
    return { reason: `kind ${property.kind}`, at: "kind" };
  }
  if (property.many === true) {
    return { reason: "a list", at: "many" };
  }
  if (property.choices?.some((choice) => choice.key === EMERGENT_CHOICE) !== true) {
    return { reason: `no choice ${EMERGENT_CHOICE}`, at: "choices" };
  }
  return undefined;
};

/**
 * The problems of a property whose meaning needs another value kind, each with the file and the line
 * of its `kind` (or `many`, `choices`):
 * - errors for the meaning `identifier` (#305): it names an element by one text, so its property is
 *   of kind `text` without `many`;
 * - warnings for the meaning `emergent` (SR-035, assumption of spec question #591 Q1): the mark is the
 *   choice key `yes` of a property of kind `choice` without `many`. Otherwise no element is marked
 *   emergent; as D-012 wants for metamodel transitions („Das Tool zeigt sie als Hinweis an, blockiert
 *   aber nichts.“), the metamodel stays valid and the workspace writable.
 */
export const meaningKindProblems = (properties: readonly Located<MetamodelProperty>[]): Problem[] =>
  properties.flatMap(({ definition, file, lineOf }): Problem[] => {
    const { key, kind, many, meaning } = definition;
    const importVersion = meaning === "import-version" ? importVersionProblem(definition) : undefined;
    if (importVersion !== undefined) {
      return [
        problemAt(
          file,
          lineOf([importVersion.at]),
          `Property ${key} has the meaning import-version, which needs kind text without many and never counts to the version (D-059), not ${importVersion.reason}`,
          "error",
        ),
      ];
    }
    if (meaning === "identifier" && (kind !== "text" || many === true)) {
      return [
        problemAt(
          file,
          lineOf([kind === "text" ? "many" : "kind"]),
          `Property ${key} has the meaning identifier, which needs kind text without many (one text per element), not ${kind === "text" ? "a list" : `kind ${kind}`}`,
          "error",
        ),
      ];
    }
    const emergent = meaning === "emergent" ? emergentProblem(definition) : undefined;
    if (emergent === undefined) {
      return [];
    }
    return [
      problemAt(
        file,
        lineOf([emergent.at]),
        `Property ${key} has the meaning emergent, which needs kind choice without many and the choice ${EMERGENT_CHOICE} (the mark), not ${emergent.reason}; no element is marked emergent`,
        "warning",
      ),
    ];
  });

/**
 * `metamodel.invalid` errors for a property marked `markdown` that cannot hold Markdown (SR-127
 * AK5): only a property of kind `text` can, and the title and an identifier stay plain text (they
 * are names, shown and searched as written). Each with the file and the line of its `markdown`.
 */
export const markdownProblems = (properties: readonly Located<MetamodelProperty>[]): Problem[] =>
  properties.flatMap(({ definition, file, lineOf }): Problem[] => {
    const { key, kind, meaning, markdown } = definition;
    const reason =
      markdown !== true
        ? undefined
        : kind !== "text"
          ? `kind ${kind}`
          : meaning === "title" || meaning === "identifier"
            ? `the meaning ${meaning}`
            : undefined;
    if (reason === undefined) {
      return [];
    }
    const line = lineOf(["markdown"]);
    return [
      {
        code: "metamodel.invalid",
        severity: "error",
        message: `Property ${key} is marked markdown, which needs kind text and neither the meaning title nor identifier (titles and identifiers are plain text), not ${reason}`,
        file,
        ...(line === undefined ? {} : { line }),
      },
    ];
  });

/**
 * The effective types with this meaning, own or inherited (SR-012), in metamodel order: e.g. all
 * requirement types that evidence may point at (D-007).
 */
export const typesWithMeaning = (metamodel: Metamodel, meaning: TypeMeaning): readonly EffectiveType[] =>
  metamodel.effectiveTypes.filter((t) => t.meaning === meaning);

/**
 * The property with this meaning, e.g. the validity a variant view evaluates (D-020); undefined when
 * no property has it. Should a second one have it (a metamodel error), the first one counts.
 */
export const propertyWithMeaning = (
  metamodel: Metamodel,
  meaning: PropertyMeaning,
): MetamodelProperty | undefined => metamodel.properties.find((p) => p.meaning === meaning);

/**
 * The meanings of the origin of an imported element (SR-057, D-059): source, source IDENTIFIER,
 * import date, delivery and import version, in this order. Only `reqif.import` writes them.
 */
export const ORIGIN_MEANINGS = [
  "source",
  "source-identifier",
  "import-date",
  "delivery",
  "import-version",
] as const satisfies readonly PropertyMeaning[];

/** The origin meaning of a definition, if it is a property of the origin (`ORIGIN_MEANINGS`). */
export const originMeaning = (
  definition: { readonly meaning?: string | undefined } | undefined,
): (typeof ORIGIN_MEANINGS)[number] | undefined =>
  ORIGIN_MEANINGS.find((meaning) => meaning === definition?.meaning);

/** The relation kinds with this meaning, in metamodel order, e.g. all kinds the chain follows. */
export const relationKindsWithMeaning = (
  metamodel: Metamodel,
  meaning: RelationMeaning,
): readonly MetamodelRelationKind[] => metamodel.relations.filter((r) => r.meaning === meaning);

/**
 * Checks that the metamodel assigns `meaning` to a key before a function uses it; the function then
 * takes the definitions from `typesWithMeaning`, `propertyWithMeaning` or `relationKindsWithMeaning`
 * (for a type meaning, the effective types, so subtypes count). Throws `metamodel.meaning-unassigned`
 * naming the meaning, the list it belongs in and the command when no key has it (SR-013 AK3).
 */
export const requireMeaning = (metamodel: Metamodel, meaning: Meaning, command: CommandName): void => {
  if (metamodel.meanings[meaning].length > 0) {
    return;
  }
  throw meaningUnassigned(meaning, command);
};

/** The `metamodel.meaning-unassigned` error `requireMeaning` throws (SR-013 AK3). */
export const meaningUnassigned = (meaning: Meaning, command: CommandName): CommandError =>
  new CommandError("metamodel.meaning-unassigned", meaningUnassignedMessage(meaning, command), {
    meaning,
    list: MEANINGS[meaning],
    command,
  });

/**
 * The message of `metamodel.meaning-unassigned` (SR-013 AK3): no key has `meaning`, which `command`
 * needs, and where to add it. `requireMeaning` throws it; a read command that works without the
 * meaning gives it as a hint.
 */
export const meaningUnassignedMessage = (meaning: Meaning, command: CommandName): string => {
  const { label } = LABELS[MEANINGS[meaning]];
  return `No ${label} of the metamodel has the meaning ${meaning}, which ${command} needs. Add \`meaning: ${meaning}\` to a ${label} in the metamodel files.`;
};
