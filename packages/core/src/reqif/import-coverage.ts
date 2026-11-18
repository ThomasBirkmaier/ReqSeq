// The check of the mapping against the file before the plan (`checkCoverage`, SR-055). Part of
// import.ts, whose file comment says what the plan does; "the file comment" here means that one.
import { CommandError } from "../catalog.js";
import type { MetamodelProperty } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { keyDefinition } from "../metamodel/index.js";
import type { NewElementBase } from "../model/index.js";
import { newElementBase, propertyKeyRefusal } from "../model/index.js";
import type { AnyMapping } from "./mapping.js";
import type { ReqifAttributeDefinition, ReqifFile, ReqifIdentifiable, ReqifSpecType } from "./model.js";
import type { OriginKeys } from "./origin.js";
import { datatypeOf, matches, nameOf } from "./import-context.js";
import type { AttributeEntry, Coverage, Index } from "./import-context.js";

/** The mapping entry of attribute `a` of type `t`, and its index; one with `source-type` first. */
const attributeEntry = (
  mapping: AnyMapping,
  t: ReqifSpecType,
  a: ReqifAttributeDefinition,
): { readonly entry: AttributeEntry; readonly index: number } | undefined => {
  const entries = (mapping.attributes ?? []).map((entry, index) => ({ entry, index }));
  const named = entries.filter(({ entry }) => matches(entry.source, a));
  return (
    named.find(({ entry }) => matches(entry["source-type"], t)) ??
    named.find(({ entry }) => entry["source-type"] === undefined)
  );
};

/** The choice key `values` maps an enumeration value to, by LONG-NAME or IDENTIFIER. */
export const choiceOf = (entry: AttributeEntry, value: ReqifIdentifiable): string | undefined =>
  Object.entries(entry.values ?? {}).find(([source]) => matches(source, value))?.[1];

const omittedValue = (entry: AttributeEntry, value: ReqifIdentifiable): boolean =>
  (entry["omit-values"] ?? []).some((source) => matches(source, value));

/**
 * Whether a property can hold values of datatype `kind` (see the file comment): `title`, `text`
 * (undefined) and a text property hold every datatype as text.
 */
const holds = (definition: MetamodelProperty | undefined, kind: string): boolean => {
  switch (definition?.kind) {
    case undefined:
    case "text":
      return true;
    case "number":
      return kind === "integer" || kind === "real";
    case "date":
      return kind === "date";
    case "choice":
      return kind === "enumeration";
    case "relation":
      return false;
  }
};

/** Checks the entry at `i` for attribute `a` of type `t`, mapped to own type `base` (see `checkCoverage`). */
const checkAttribute = (
  coverage: Coverage,
  index: Index,
  metamodel: Metamodel,
  base: NewElementBase,
  t: ReqifSpecType,
  a: ReqifAttributeDefinition,
  { entry, index: i }: { readonly entry: AttributeEntry; readonly index: number },
): void => {
  const checked: { readonly entry: AttributeEntry; definition?: MetamodelProperty | undefined } = { entry };
  coverage.attributes.set(a.identifier, checked);
  const { property } = entry;
  if (property === undefined) {
    return;
  }
  const field = `mapping.attributes[${String(i)}].property`;
  const own = property === "title" || property === "text";
  // readMappingFile refused a key that is no property of the metamodel (or a relation kind).
  const found = own ? undefined : keyDefinition(metamodel, property);
  const definition = found?.kind === "property" ? found.definition : undefined;
  checked.definition = definition;
  const datatype = datatypeOf(index, a);
  // The keys `element.create` refuses, the origin among them (SR-057 AK3).
  const refusal = own
    ? undefined
    : propertyKeyRefusal(property, metamodel, base.type, base.titleKey, "property")?.message;
  if (refusal !== undefined) {
    coverage.wrong.push({ field, message: refusal });
    return;
  }
  if (!holds(definition, datatype.kind)) {
    coverage.wrong.push({
      field,
      message: `${property} cannot hold attribute ${nameOf(a)} of ${nameOf(t)}, a ${datatype.kind.toUpperCase()}`,
    });
    return;
  }
  if (definition?.kind !== "choice") {
    return;
  }
  for (const value of datatype.values) {
    if (choiceOf(entry, value) === undefined && !omittedValue(entry, value)) {
      coverage.unmapped.push({
        kind: "value",
        source: nameOf(value),
        sourceType: nameOf(t),
        attribute: nameOf(a),
      });
    }
  }
};

/** Checks a SPEC-OBJECT-TYPE and its attributes (see `checkCoverage`). */
const checkObjectType = (
  coverage: Coverage,
  index: Index,
  mapping: AnyMapping,
  metamodel: Metamodel,
  keys: OriginKeys,
  t: ReqifSpecType,
): void => {
  const at = (mapping.types ?? []).findIndex((e) => matches(e.source, t));
  const typeEntry = mapping.types?.[at];
  if (typeEntry === undefined) {
    // Its attributes too, so mapping the list once covers the type (SR-055 AK2).
    coverage.unmapped.push({ kind: "type", source: nameOf(t) });
    for (const a of t.attributes) {
      if (attributeEntry(mapping, t, a) === undefined) {
        coverage.unmapped.push({ kind: "attribute", source: nameOf(a), sourceType: nameOf(t) });
      }
    }
    return;
  }
  coverage.types.set(t.identifier, typeEntry.type);
  coverage.typeEntries.set(t.identifier, at);
  if (typeEntry.type === undefined) {
    return;
  }
  const base = newElementBase(metamodel, typeEntry.type, "reqif.import");
  const missing = Object.values(keys).filter((key) => !base.type.properties.includes(key));
  if (missing.length > 0) {
    coverage.wrong.push({
      field: `mapping.types[${String(at)}].type`,
      message: `type ${base.type.key} has no ${missing.join(", ")}, which hold the origin of every imported element (SR-057)`,
    });
  }
  for (const a of t.attributes) {
    const found = attributeEntry(mapping, t, a);
    if (found === undefined) {
      coverage.unmapped.push({ kind: "attribute", source: nameOf(a), sourceType: nameOf(t) });
    } else {
      checkAttribute(coverage, index, metamodel, base, t, a, found);
    }
  }
};

/**
 * Checks the mapping against the file: `reqif.unmapped` with every entry it neither maps nor omits
 * (SR-055), `input.invalid` for an attribute mapped to a property that cannot hold it or that its
 * type does not have, and for a type mapped to one without the origin properties `keys`.
 */
export const checkCoverage = (
  file: ReqifFile,
  index: Index,
  mapping: AnyMapping,
  metamodel: Metamodel,
  keys: OriginKeys,
): Coverage => {
  const coverage: Coverage = {
    attributes: new Map(),
    types: new Map(),
    typeEntries: new Map(),
    relations: new Map(),
    unmapped: [],
    wrong: [],
  };
  for (const t of file.specTypes) {
    if (t.category === "spec-relation") {
      const relationEntry = (mapping.relations ?? []).find((e) => matches(e.source, t));
      if (relationEntry === undefined) {
        coverage.unmapped.push({ kind: "relation", source: nameOf(t) });
      } else {
        coverage.relations.set(t.identifier, relationEntry.kind);
      }
    } else if (t.category === "spec-object") {
      checkObjectType(coverage, index, mapping, metamodel, keys, t);
    }
  }
  const { unmapped, wrong } = coverage;
  if (unmapped.length > 0) {
    throw new CommandError(
      "reqif.unmapped",
      `Not imported: the mapping neither maps nor omits ${unmapped.map((u) => `${u.kind} ${u.source}`).join(", ")}; map or omit each with reqif.saveMapping or in the mapping file`,
      { unmapped },
    );
  }
  if (wrong.length > 0) {
    throw new CommandError("input.invalid", wrong.map((w) => `${w.field}: ${w.message}`).join("; "), {
      fields: wrong.map((w) => w.field),
    });
  }
  return coverage;
};
