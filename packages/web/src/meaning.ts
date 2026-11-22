// The metamodel by meaning. The UI names no type, property, relation or status key of a workspace: it finds them
// through the built-in meanings of `metamodel.get` (need, requirement, variant, package; title, identifier,
// acceptance-criteria, packages, validity, verification-method; derivation, replacement, succession, exclusion) and
// the status marks initial and invalid, so any workspace with any keys works. Pure functions over the output.
import type { MetamodelGetOutput } from "@reqseq/core";

export type Metamodel = Pick<MetamodelGetOutput, "types" | "properties" | "relations" | "statuses">;
type TypeMeaning = NonNullable<Metamodel["types"][number]["meaning"]>;
type PropertyMeaning = NonNullable<Metamodel["properties"][number]["meaning"]>;

export const typeDef = (mm: Metamodel, key: string | undefined): Metamodel["types"][number] | undefined =>
  mm.types.find((t) => t.key === key);
export const propDef = (mm: Metamodel, key: string): Metamodel["properties"][number] | undefined =>
  mm.properties.find((p) => p.key === key);
export const relKind = (mm: Metamodel, key: string): Metamodel["relations"][number] | undefined =>
  mm.relations.find((r) => r.key === key);
export const statusDef = (
  mm: Metamodel,
  key: string | undefined,
): Metamodel["statuses"][number] | undefined => mm.statuses.find((s) => s.key === key);

/** Whether `type` has `meaning`; `metamodel.get` gives each type its effective meaning, inherited ones included. */
export const hasMeaning = (mm: Metamodel, type: string | undefined, meaning: TypeMeaning): boolean =>
  typeDef(mm, type)?.meaning === meaning;
/** The types that can have elements and have `meaning`, in metamodel order. */
export const typesWith = (mm: Metamodel, meaning: TypeMeaning): string[] =>
  mm.types.filter((t) => !t.abstract && t.meaning === meaning).map((t) => t.key);
/** The key of the property with `meaning`, if the metamodel has one. */
export const propKey = (mm: Metamodel, meaning: PropertyMeaning): string | undefined =>
  mm.properties.find((p) => p.meaning === meaning)?.key;
export const isReq = (mm: Metamodel, type: string | undefined): boolean =>
  hasMeaning(mm, type, "requirement");
export const isNeed = (mm: Metamodel, type: string | undefined): boolean => hasMeaning(mm, type, "need");

/** The keys of the properties of `type`, its own and inherited. */
export const propsOf = (mm: Metamodel, type: string | undefined): readonly string[] =>
  typeDef(mm, type)?.properties ?? [];
/** The key of the property with `meaning` when `type` has it. */
export const propOfType = (
  mm: Metamodel,
  type: string | undefined,
  meaning: PropertyMeaning,
): string | undefined => {
  const key = propKey(mm, meaning);
  return key !== undefined && propsOf(mm, type).includes(key) ? key : undefined;
};

/** The status new elements get (marked initial). */
export const initialStatus = (mm: Metamodel): string | undefined =>
  mm.statuses.find((s) => s.initial === true)?.key;
/** The statuses that are neither initial nor invalid ("settled": approved and the like). */
export const settledStatuses = (mm: Metamodel): string[] =>
  mm.statuses.filter((s) => s.initial !== true && s.invalid !== true).map((s) => s.key);
export const isInitial = (mm: Metamodel, status: string | undefined): boolean =>
  statusDef(mm, status)?.initial === true;
export const isInvalid = (mm: Metamodel, status: string | undefined): boolean =>
  statusDef(mm, status)?.invalid === true;
/** The look of a status pill by its role in the metamodel, never by its key. */
export const statusRole = (
  mm: Metamodel,
  status: string | undefined,
): "initial" | "settled" | "invalid" | "" => {
  const found = statusDef(mm, status);
  return found === undefined
    ? ""
    : found.invalid === true
      ? "invalid"
      : found.initial === true
        ? "initial"
        : "settled";
};

/** "Glossary Term" becomes "Glossary term": type and property names in sentence case. */
export const sentence = (name: string): string =>
  name.replace(/(?<=\s)([A-Z])(?=[a-z])/g, (c) => c.toLowerCase());
export const typeName = (mm: Metamodel, key: string | undefined): string =>
  sentence(typeDef(mm, key)?.name ?? key ?? "");
/** The English plural of a type's sentence-case name. */
export function typePlural(mm: Metamodel, key: string): string {
  const name = typeName(mm, key);
  if (/[^aeiou]y$/i.test(name)) {
    return `${name.slice(0, -1)}ies`;
  }
  if (/is$/i.test(name)) {
    return `${name.slice(0, -2)}es`;
  }
  if (/(ss|us|x|z|ch|sh)$/i.test(name)) {
    return `${name}es`;
  }
  // A name that ends in s already is taken as a plural ("Requirements").
  return /s$/i.test(name) ? name : `${name}s`;
}
export const statusName = (mm: Metamodel, key: string | undefined): string =>
  statusDef(mm, key)?.name ?? key ?? "";
/** The name of a fixed value of a choice property. */
export const choiceName = (mm: Metamodel, prop: string, value: unknown): string =>
  propDef(mm, prop)?.choices?.find((c) => c.key === value)?.name ?? String(value);

/** Choice properties a type requires (other than built-in meanings): shown beside its type as its kind. */
export const kindProps = (mm: Metamodel, type: string | undefined): string[] =>
  (typeDef(mm, type)?.required ?? []).filter((key) => {
    const d = propDef(mm, key);
    return d?.kind === "choice" && d.many !== true && d.meaning === undefined;
  });
/** Notes of a type (rationale, definition…): single Markdown text properties without a built-in meaning. */
export const noteProps = (mm: Metamodel, type: string | undefined): string[] =>
  propsOf(mm, type).filter((key) => {
    const d = propDef(mm, key);
    return d?.kind === "text" && d.markdown === true && d.many !== true && d.meaning === undefined;
  });
/** Numbered lists of a type (validation criteria…): text lists without a built-in meaning. */
export const listProps = (mm: Metamodel, type: string | undefined): string[] =>
  propsOf(mm, type).filter((key) => {
    const d = propDef(mm, key);
    return d?.kind === "text" && d.many === true && d.meaning === undefined;
  });

/** Words for ReqSeq's meanings in the workspace's own names: one type its name, two both, else `fallback`. */
export function namesOf(mm: Metamodel, keys: readonly string[], fallback: string): string {
  const [one, two] = keys;
  if (one !== undefined && keys.length === 1) {
    return typePlural(mm, one).toLowerCase();
  }
  if (one !== undefined && two !== undefined && keys.length === 2) {
    return `${typePlural(mm, one).toLowerCase()} and ${typePlural(mm, two).toLowerCase()}`;
  }
  return fallback;
}
export const reqWords = (mm: Metamodel): string => namesOf(mm, typesWith(mm, "requirement"), "requirements");
export const needWords = (mm: Metamodel): string => namesOf(mm, typesWith(mm, "need"), "needs");
/** What the workspace calls its packages, for labels. */
export const packageWord = (mm: Metamodel): string => {
  const key = typesWith(mm, "package")[0];
  return key === undefined ? "Package" : typeName(mm, key);
};
/** The names of the settled statuses ("Approved", or "Agreed or shipped"), for titles. */
export const settledWords = (mm: Metamodel): string => {
  const names = settledStatuses(mm).map((key) => statusName(mm, key));
  const [first, ...rest] = names;
  return first === undefined ? "Settled" : [first, ...rest.map((n) => n.toLowerCase())].join(" or ");
};

export const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
