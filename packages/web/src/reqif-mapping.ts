// The mapping of a ReqIF file as the import page builds it: what `reqif.analyze` lists as unmapped, the choices the
// metamodel offers for each, and the mapping `reqif.saveMapping` takes, with the user's choices merged in. Pure
// functions over the outputs; ReqSeq checks the mapping when it saves it and again when it reads the file with it.
import type { ReqifAnalyzeOutput, ReqifSaveMappingInput } from "@reqseq/core";
import type { Metamodel } from "./meaning.js";
import { propsOf, propDef, sentence, typeName } from "./meaning.js";

export type Mapping = ReqifSaveMappingInput["mapping"];
export type Unmapped = ReqifAnalyzeOutput["unmapped"][number];

/** What one part of the file becomes: a key of the metamodel (or `title`, `text`), or left out. */
export type Choice = { readonly to: string } | { readonly omit: true };

/** One choice of a select: the value it stands for and its label. */
export interface Option {
  readonly key: string;
  readonly name: string;
}

/** The value of a select that leaves the part out, and the one of no choice yet; a key never looks like these. */
export const OMIT = "-";
export const NONE = "";
/** The value of a select for `key`. */
export const valueOf = (key: string): string => `=${key}`;
/** The choice a select value stands for; none for no choice yet. */
export const choiceOf = (value: string): Choice | undefined =>
  value === OMIT ? { omit: true } : value.startsWith("=") ? { to: value.slice(1) } : undefined;

/** The unmapped parts of a file, grouped as the page shows them. */
export interface Groups {
  /** Each SPEC-OBJECT-TYPE: unmapped itself or not, with its unmapped attributes. */
  readonly types: readonly {
    readonly source: string;
    readonly unmapped: boolean;
    readonly attributes: readonly string[];
  }[];
  readonly relations: readonly string[];
  /** The unmapped values of each enumeration attribute. */
  readonly values: readonly {
    readonly sourceType: string;
    readonly attribute: string;
    readonly values: readonly string[];
  }[];
}

export function groupsOf(unmapped: readonly Unmapped[]): Groups {
  const types = new Map<string, { source: string; unmapped: boolean; attributes: string[] }>();
  const typeOf = (source: string): { source: string; unmapped: boolean; attributes: string[] } => {
    const found = types.get(source) ?? { source, unmapped: false, attributes: [] };
    types.set(source, found);
    return found;
  };
  const relations: string[] = [];
  const values = new Map<string, { sourceType: string; attribute: string; values: string[] }>();
  for (const u of unmapped) {
    const sourceType = u.sourceType ?? "";
    if (u.kind === "type") {
      typeOf(u.source).unmapped = true;
    } else if (u.kind === "attribute") {
      typeOf(sourceType).attributes.push(u.source);
    } else if (u.kind === "relation") {
      relations.push(u.source);
    } else {
      const attribute = u.attribute ?? "";
      const id = JSON.stringify([sourceType, attribute]);
      const found = values.get(id) ?? { sourceType, attribute, values: [] };
      values.set(id, found);
      found.values.push(u.source);
    }
  }
  return { types: [...types.values()], relations, values: [...values.values()] };
}

/** The types an object type can become: those that can have elements, in metamodel order. */
export const typeOptions = (mm: Metamodel): Option[] =>
  mm.types.filter((t) => !t.abstract).map((t) => ({ key: t.key, name: typeName(mm, t.key) }));

/** The meanings of properties that ReqSeq writes itself on an import: the title has its own choice. */
const OWN = new Set([
  "title",
  "identifier",
  "source",
  "source-identifier",
  "import-date",
  "delivery",
  "import-version",
]);

/**
 * Where an attribute can go in elements of `type`: the title, the text, or a property of the type that is no
 * relation and that the import does not write itself.
 */
export const attributeOptions = (mm: Metamodel, type: string): Option[] => [
  { key: "title", name: "Title" },
  { key: "text", name: "Text" },
  ...propsOf(mm, type).flatMap((key) => {
    const d = propDef(mm, key);
    return d === undefined || d.kind === "relation" || (d.meaning !== undefined && OWN.has(d.meaning))
      ? []
      : [{ key, name: sentence(d.name) }];
  }),
];

export const relationOptions = (mm: Metamodel): Option[] =>
  mm.relations.map((r) => ({ key: r.key, name: r.name }));

/** The choices of the property `key`, for the values of an enumeration attribute mapped to it. */
export const valueOptions = (mm: Metamodel, key: string): Option[] =>
  (propDef(mm, key)?.choices ?? []).map((c) => ({ key: c.key, name: c.name }));

const fold = (text: string): string => text.trim().toLowerCase();

/** The option whose name or key is `source`, ignoring case: a first guess the user sees before saving. */
export const guess = (options: readonly Option[], source: string): Option | undefined =>
  options.find((o) => fold(o.name) === fold(source) || fold(o.key) === fold(source));

/** An empty mapping for the source `name`. */
export const emptyMapping = (name: string): Mapping => ({ "reqseq-reqif-mapping": 1, source: { name } });

type TypeEntry = NonNullable<Mapping["types"]>[number];
type AttributeEntry = NonNullable<Mapping["attributes"]>[number];
type RelationEntry = NonNullable<Mapping["relations"]>[number];

/** The choices of one save: each by the part of the file it is for. */
export interface Choices {
  readonly types: ReadonlyMap<string, Choice>;
  /** By `JSON.stringify([sourceType, attribute])`. */
  readonly attributes: ReadonlyMap<string, Choice>;
  readonly relations: ReadonlyMap<string, Choice>;
  /** By `JSON.stringify([sourceType, attribute, value])`. */
  readonly values: ReadonlyMap<string, Choice>;
}

export const attributeId = (sourceType: string, attribute: string): string =>
  JSON.stringify([sourceType, attribute]);
export const valueId = (sourceType: string, attribute: string, value: string): string =>
  JSON.stringify([sourceType, attribute, value]);

/** The type an object type of the source is mapped to in `mapping`, if any. */
export const mappedType = (mapping: Mapping, sourceType: string): string | undefined =>
  mapping.types?.find((e) => e.source === sourceType)?.type;

const sameAttribute = (e: AttributeEntry, sourceType: string, attribute: string): boolean =>
  e.source === attribute && (e["source-type"] ?? "") === sourceType;

/** The property an attribute of the source is mapped to in `mapping`, if any. */
export const mappedProperty = (mapping: Mapping, sourceType: string, attribute: string): string | undefined =>
  mapping.attributes?.find((e) => sameAttribute(e, sourceType, attribute))?.property;

const typeEntry = (source: string, c: Choice): TypeEntry =>
  "omit" in c ? { source, omit: true } : { source, type: c.to };
const relationEntry = (source: string, c: Choice): RelationEntry =>
  "omit" in c ? { source, omit: true } : { source, kind: c.to };
const attributeEntry = (sourceType: string, source: string, c: Choice): AttributeEntry => ({
  ...(sourceType === "" ? {} : { "source-type": sourceType }),
  source,
  ...("omit" in c ? { omit: true as const } : { property: c.to }),
});

/** `entries` with each of `added` in place of the entry with the same id, the others at the end. */
const merged = <E>(entries: readonly E[], added: readonly E[], id: (e: E) => string): E[] => {
  const byId = new Map(added.map((e) => [id(e), e]));
  const kept = entries.map((e) => {
    const next = byId.get(id(e));
    byId.delete(id(e));
    return next ?? e;
  });
  return [...kept, ...byId.values()];
};

/** `entry` with the choices for its values merged in. */
function withValues(entry: AttributeEntry, choices: ReadonlyMap<string, Choice>): AttributeEntry {
  const sourceType = entry["source-type"] ?? "";
  const values = new Map(Object.entries(entry.values ?? {}));
  const omitted = new Set(entry["omit-values"] ?? []);
  let touched = false;
  for (const [id, c] of choices) {
    const [t, a, v] = JSON.parse(id) as [string, string, string];
    if (t !== sourceType || a !== entry.source) {
      continue;
    }
    touched = true;
    if ("omit" in c) {
      omitted.add(v);
      values.delete(v);
    } else {
      values.set(v, c.to);
      omitted.delete(v);
    }
  }
  if (!touched) {
    return entry;
  }
  return {
    ...(entry["source-type"] === undefined ? {} : { "source-type": entry["source-type"] }),
    source: entry.source,
    ...(entry.property === undefined ? { omit: true as const } : { property: entry.property }),
    ...(values.size === 0 ? {} : { values: Object.fromEntries(values) }),
    ...(omitted.size === 0 ? {} : { "omit-values": [...omitted] }),
  };
}

/**
 * `mapping` with the choices merged in: a choice replaces the entry for the same part, a part without a choice
 * keeps its entry, and the attributes of a type left out need none.
 */
export function withChoices(mapping: Mapping, name: string, choices: Choices): Mapping {
  const types = merged(
    mapping.types ?? [],
    [...choices.types].map(([source, c]) => typeEntry(source, c)),
    (e) => e.source,
  );
  const omittedTypes = new Set(types.filter((e) => e.omit === true).map((e) => e.source));
  const attributes = merged(
    mapping.attributes ?? [],
    [...choices.attributes].flatMap(([id, c]) => {
      const [sourceType, source] = JSON.parse(id) as [string, string];
      return omittedTypes.has(sourceType) ? [] : [attributeEntry(sourceType, source, c)];
    }),
    (e) => attributeId(e["source-type"] ?? "", e.source),
  ).map((e) => withValues(e, choices.values));
  const relations = merged(
    mapping.relations ?? [],
    [...choices.relations].map(([source, c]) => relationEntry(source, c)),
    (e) => e.source,
  );
  return {
    ...mapping,
    source: { ...mapping.source, name },
    ...(types.length === 0 ? {} : { types }),
    ...(attributes.length === 0 ? {} : { attributes }),
    ...(relations.length === 0 ? {} : { relations }),
  };
}
