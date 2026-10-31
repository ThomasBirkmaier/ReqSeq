// The plan of `reqif.import` (SR-053, ADR-0013 "Import"): what a parsed ReqIF file gives through a
// mapping, in memory, before any file is written.
//
// - Mapping: a type, attribute or relation type of the file is matched by LONG-NAME or IDENTIFIER;
//   an attribute entry with `source-type` wins over one without. Every SPEC-OBJECT-TYPE, every
//   attribute of a mapped type, every SPEC-RELATION-TYPE and every enumeration value of an attribute
//   mapped to a choice must be mapped or omitted, else `reqif.unmapped` with the list (SR-055). An
//   attribute whose datatype the property cannot hold is `input.invalid` at its mapping entry.
// - Elements: one per SPEC-OBJECT whose type is mapped, with a new UUID (D-056), the initial status
//   of its type (D-030), the title from the attribute mapped to `title` (else LONG-NAME, else
//   IDENTIFIER), the text from the attribute mapped to `text` (`xhtmlText`, until SR-095) and the
//   mapped properties: INTEGER and REAL as number, DATE as its date, ENUMERATION as the choice keys
//   of `values`, and every datatype as text in `title`, `text` and a text property (enumeration
//   values by name).
// - Relations: one entry per SPEC-RELATION of a mapped type whose two ends are imported, on the
//   element of its SOURCE, with the planned version of its TARGET (`plannedVersion`; relation kinds
//   do not count to a version, ADR-0005).
// - Losses (SR-053 AK2), with the codes of `common.schema.json#/$defs/reqifLoss`: an object of an
//   omitted type, a value of an omitted attribute or an omitted enumeration value, a date whose time
//   is not midnight, XHTML elements without plain form, a relation whose type is omitted or whose
//   other end is not imported, values of relations and specifications, a duplicate relation, a
//   relation the metamodel does not allow, the SPEC-HIERARCHY (once per SPECIFICATION that has one)
//   and every part of an imported object the parser did not read. A DEFAULT-VALUE is the value of
//   an object without its own (ReqIF 1.2 §10.8.3).
// - Origin (SR-057 AK1): each element gets the source name of the mapping, the object's IDENTIFIER,
//   the import date, the delivery and the import version: the element's planned version as written
//   (D-059; `import-version` never counts to it). A mapping that maps a SPEC-OBJECT-TYPE to a type
//   without all five origin properties is refused with `input.invalid` at that entry.
// - Never from the delivery: `id`, `type`, `status`, the title key (D-030) and the origin
//   properties (SR-057 AK3; `propertyKeyRefusal`).
// - Files go into the mapping's `target`, else a folder named after the source in the main
//   repository (SR-053 AK1). The own metamodel is only read (SR-054 AK3).
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { PropertyValue } from "../files/index.js";
import type {
  MetamodelProperty,
  ReqifLoss,
  ReqifObject,
  ReqifUnmapped,
  WorkspaceLocation,
} from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { allowsType, keyDefinition } from "../metamodel/index.js";
import type { NewElementBase, NewElementFile } from "../model/index.js";
import {
  fileNameFor,
  newElementBase,
  newElementBytes,
  plannedVersion,
  portableName,
  propertyKeyRefusal,
} from "../model/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { locate } from "../workspace/index.js";
import type { AnyMapping } from "./mapping.js";
import type {
  ReqifAttributeDefinition,
  ReqifDatatype,
  ReqifFile,
  ReqifIdentifiable,
  ReqifSpecObject,
  ReqifSpecRelation,
  ReqifSpecType,
  ReqifValue,
} from "./model.js";
import type { OriginKeys } from "./origin.js";
import { originKeys } from "./origin.js";
import { markdownText, xhtmlText } from "./xhtml-text.js";

/** What `planImport` gives: the files to write and what the output lists. */
export interface ImportPlan {
  readonly repository: RepositoryLocation;
  /** The target folder relative to the repository, `/` as separator. */
  readonly folder: string;
  readonly files: readonly NewElementFile[];
  readonly created: readonly ReqifObject[];
  readonly losses: readonly ReqifLoss[];
}

/** What the import itself writes into the origin of each element besides the source and IDENTIFIER. */
export interface ImportOrigin {
  /** The name of the delivery (input `delivery`). */
  readonly delivery: string;
  /** The import date, `YYYY-MM-DD` (`importDate`). */
  readonly date: string;
}

type AttributeEntry = NonNullable<AnyMapping["attributes"]>[number];

const nameOf = (item: ReqifIdentifiable): string => item.longName ?? item.identifier;
const matches = (source: string | undefined, item: ReqifIdentifiable): boolean =>
  source === item.identifier || source === item.longName;

const invalidFile = (message: string, line: number): CommandError =>
  new CommandError("reqif.invalid", `file: ${message}`, { fields: ["file"], line });

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
const choiceOf = (entry: AttributeEntry, value: ReqifIdentifiable): string | undefined =>
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

/** The file's definitions by IDENTIFIER. */
interface Index {
  readonly types: ReadonlyMap<string, ReqifSpecType>;
  readonly attributes: ReadonlyMap<
    string,
    { readonly type: ReqifSpecType; readonly a: ReqifAttributeDefinition }
  >;
  readonly datatypes: ReadonlyMap<string, ReqifDatatype>;
}

/** The file's definitions; the parser refused an IDENTIFIER used twice (ReqIF 1.2 §10.8.32). */
const indexOf = (file: ReqifFile): Index => {
  const attributes = new Map<
    string,
    { readonly type: ReqifSpecType; readonly a: ReqifAttributeDefinition }
  >();
  for (const type of file.specTypes) {
    for (const a of type.attributes) {
      attributes.set(a.identifier, { type, a });
    }
  }
  return {
    types: new Map(file.specTypes.map((t) => [t.identifier, t])),
    attributes,
    datatypes: new Map(file.datatypes.map((d) => [d.identifier, d])),
  };
};

/** The datatype of `a`, which the file must define. */
const datatypeOf = (index: Index, a: ReqifAttributeDefinition): ReqifDatatype => {
  const datatype = index.datatypes.get(a.datatype);
  if (datatype === undefined) {
    throw invalidFile(
      `attribute ${a.identifier} refers to datatype ${a.datatype}, which the file does not define`,
      a.line,
    );
  }
  return datatype;
};

/** What the mapping makes of the file's types and attributes, by IDENTIFIER; undefined: omitted. */
interface Coverage {
  /** Each attribute's entry, with the definition of its property (undefined: `title`, `text`, omitted). */
  readonly attributes: Map<
    string,
    { readonly entry: AttributeEntry; definition?: MetamodelProperty | undefined }
  >;
  /** The own type of each SPEC-OBJECT-TYPE. */
  readonly types: Map<string, string | undefined>;
  /** The relation kind of each SPEC-RELATION-TYPE. */
  readonly relations: Map<string, string | undefined>;
  readonly unmapped: ReqifUnmapped[];
  /** Attribute entries whose property cannot hold the attribute. */
  readonly wrong: { readonly field: string; readonly message: string }[];
}

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
    coverage.unmapped.push({ kind: "type", source: nameOf(t) });
    return;
  }
  coverage.types.set(t.identifier, typeEntry.type);
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
const checkCoverage = (
  file: ReqifFile,
  index: Index,
  mapping: AnyMapping,
  metamodel: Metamodel,
  keys: OriginKeys,
): Coverage => {
  const coverage: Coverage = {
    attributes: new Map(),
    types: new Map(),
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

/** One element being planned. */
interface Draft {
  readonly identifier: string;
  readonly id: string;
  readonly base: NewElementBase;
  title: string;
  text: string;
  readonly properties: Map<string, PropertyValue>;
  readonly relations: Map<string, { readonly id: string; readonly version: string }[]>;
  /** The planned version (`plannedVersion`), set once the values are planned. */
  version: string;
}

type Loss = (code: ReqifLoss["code"], reason: string) => void;

const MIDNIGHT = /^T00:00:00(?:\.0+)?(?:Z|[+-]00:00)?$/;

/** The values of the datatype that `refs` name; a reference to a value it does not define is a loss. */
const enumValuesOf = (refs: readonly string[], datatype: ReqifDatatype, loss: Loss): ReqifIdentifiable[] => {
  const found: ReqifIdentifiable[] = [];
  for (const ref of refs) {
    const v = datatype.values.find((d) => d.identifier === ref);
    if (v === undefined) {
      loss("omitted-value", `the value ${ref} is not defined in the file`);
    } else {
      found.push(v);
    }
  }
  return found;
};

/**
 * The texts of a value: XHTML as `xhtmlText` (its other elements a loss), enumeration values by
 * name, the others as written. For a Markdown target (`text`, a property with `markdown: true`)
 * each text is escaped (`markdownText`) so it reads back as written; elsewhere it stays plain.
 */
const textsOf = (value: ReqifValue, datatype: ReqifDatatype, markdown: boolean, loss: Loss): string[] => {
  if (value.kind === "xhtml") {
    const { text, unconverted } = xhtmlText(value.value, markdown);
    if (unconverted.length > 0) {
      loss(
        "xhtml-element",
        `XHTML ${unconverted.join(", ")} is not converted to Markdown yet; its text is kept`,
      );
    }
    return [text];
  }
  const texts =
    value.kind === "enumeration" ? enumValuesOf(value.values, datatype, loss).map(nameOf) : [value.value];
  return markdown ? texts.map(markdownText) : texts;
};

/** The choice keys of enumeration values through `values` (an unmapped value is a loss). */
const choiceValue = (
  refs: readonly string[],
  datatype: ReqifDatatype,
  entry: AttributeEntry,
  definition: MetamodelProperty,
  loss: Loss,
): PropertyValue | undefined => {
  const keys: string[] = [];
  for (const v of enumValuesOf(refs, datatype, loss)) {
    const key = choiceOf(entry, v);
    if (key === undefined) {
      loss("omitted-value", `the mapping omits the value ${nameOf(v)}`);
    } else if (!keys.includes(key)) {
      keys.push(key);
    }
  }
  if (definition.many === true) {
    return keys.length === 0 ? undefined : keys;
  }
  for (const key of keys.slice(1)) {
    loss("omitted-value", `${definition.key} holds one choice, so ${key} is left out`);
  }
  return keys[0];
};

/** A DATE value as a date property holds it: the day (a time other than midnight is a loss). */
const dateValue = (value: string, loss: Loss): string => {
  const date = value.slice(0, 10);
  if (value.length > 10 && !MIDNIGHT.test(value.slice(10))) {
    loss("date-time", `the time of ${value} is left out; ${date} is kept`);
  }
  return date;
};

/** Lexical forms of xs:integer and xs:double (ReqIF 1.2 §10.8.20, §10.8.22). */
const LEXICAL: Readonly<Record<string, RegExp>> = {
  integer: /^[+-]?\d+$/,
  real: /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?INF|NaN)$/,
};

/**
 * An INTEGER or REAL value as a number; a loss for one that is not of the lexical form of its
 * datatype (an empty value too), not finite, or an integer a number cannot hold exactly.
 */
const numberValue = (raw: string, kind: string, loss: Loss): number | undefined => {
  const value = raw.trim();
  if (LEXICAL[kind]?.test(value) !== true) {
    loss("omitted-value", `"${raw}" is no ${kind.toUpperCase()}`);
    return undefined;
  }
  const number = Number(value.replace(/INF$/, "Infinity"));
  if (!Number.isFinite(number)) {
    loss("omitted-value", `${value} is no finite number`);
    return undefined;
  }
  if (kind === "integer" && !Number.isSafeInteger(number)) {
    loss("omitted-value", `${value} is larger than a number holds exactly`);
    return undefined;
  }
  return number;
};

/** What a value is to its property, which `checkCoverage` let hold it. */
const propertyValue = (
  value: ReqifValue,
  datatype: ReqifDatatype,
  entry: AttributeEntry,
  definition: MetamodelProperty,
  loss: Loss,
): PropertyValue | undefined => {
  if (value.kind === "enumeration" && definition.kind === "choice") {
    return choiceValue(value.values, datatype, entry, definition, loss);
  }
  const scalar = value.kind === "enumeration" || value.kind === "xhtml" ? undefined : value.value;
  const one =
    scalar !== undefined && definition.kind === "date"
      ? dateValue(scalar, loss)
      : scalar !== undefined && definition.kind === "number"
        ? numberValue(scalar, datatype.kind, loss)
        : null;
  if (one !== null) {
    return one === undefined || definition.many !== true ? one : [one];
  }
  const texts = textsOf(value, datatype, definition.markdown === true, loss);
  return definition.many === true ? texts : texts.join(", ");
};

/** The file of a draft, with its relations or without them (for its planned version). */
const fileOf = (draft: Draft, folder: string, withRelations: boolean): NewElementFile => ({
  file: path.posix.join(folder, fileNameFor({ prefix: draft.base.type.prefix, id: draft.id })),
  bytes: newElementBytes(draft.base, draft.id, draft.title, draft.text, [
    ...draft.properties,
    ...(withRelations ? [...draft.relations] : []),
  ]),
});

/** What one planning step needs. */
interface Context {
  readonly index: Index;
  readonly coverage: Coverage;
  readonly metamodel: Metamodel;
  readonly losses: ReqifLoss[];
  readonly keys: OriginKeys;
  readonly source: string;
  readonly origin: ImportOrigin;
}

/** Takes the values of `object` into `draft` (see the file comment). */
const planValues = (context: Context, object: ReqifSpecObject, t: ReqifSpecType, draft: Draft): void => {
  const { index, coverage, losses } = context;
  // An attribute without a value of its own has its DEFAULT-VALUE (ReqIF 1.2 §10.8.3).
  const given = new Set(object.values.map((value) => value.definition));
  const defaults = t.attributes.flatMap((a) =>
    a.defaultValue === undefined || given.has(a.identifier) ? [] : [a.defaultValue],
  );
  for (const value of [...object.values, ...defaults]) {
    const known = index.attributes.get(value.definition);
    if (known?.type !== t) {
      throw invalidFile(
        `SPEC-OBJECT ${object.identifier} has a value of attribute ${value.definition}, which its type does not define`,
        object.line,
      );
    }
    const { a } = known;
    const loss: Loss = (code, reason) => {
      losses.push({ identifier: object.identifier, kind: "spec-object", id: draft.id, code, reason });
    };
    // checkCoverage found an entry for every attribute of a mapped type.
    const checked = coverage.attributes.get(a.identifier);
    const property = checked?.entry.property;
    if (checked === undefined || property === undefined) {
      loss("omitted-attribute", `the mapping omits its attribute ${nameOf(a)}`);
      continue;
    }
    const { entry, definition } = checked;
    const datatype = datatypeOf(index, a);
    const prefixed: Loss = (code, reason) => {
      loss(code, `${nameOf(a)}: ${reason}`);
    };
    if (definition === undefined) {
      const text = textsOf(value, datatype, property === "text", prefixed).join(", ");
      if (property === "title") {
        draft.title = text;
      } else {
        draft.text = text;
      }
      continue;
    }
    const result = propertyValue(value, datatype, entry, definition, prefixed);
    if (result !== undefined) {
      draft.properties.set(property, result);
    }
  }
};

/** The draft of `object`, or undefined when its type is omitted (a loss). */
const planObject = (
  context: Context,
  repository: string,
  folder: string,
  object: ReqifSpecObject,
): Draft | undefined => {
  const t = context.index.types.get(object.type);
  if (t?.category !== "spec-object") {
    throw invalidFile(
      `SPEC-OBJECT ${object.identifier} refers to type ${object.type}, which the file does not define`,
      object.line,
    );
  }
  const ownType = context.coverage.types.get(t.identifier);
  if (ownType === undefined) {
    context.losses.push({
      identifier: object.identifier,
      kind: "spec-object",
      code: "omitted-type",
      reason: `the mapping omits its type ${nameOf(t)}`,
    });
    return undefined;
  }
  const base = newElementBase(context.metamodel, ownType, "reqif.import");
  const { keys } = context;
  const draft: Draft = {
    identifier: object.identifier,
    id: randomUUID(),
    base,
    title: nameOf(object),
    text: "",
    properties: new Map(),
    relations: new Map(),
    version: "",
  };
  planValues(context, object, t, draft);
  draft.properties.set(keys.source, context.source);
  draft.properties.set(keys["source-identifier"], object.identifier);
  draft.properties.set(keys["import-date"], context.origin.date);
  draft.properties.set(keys.delivery, context.origin.delivery);
  // The import version is the version of the element as written (D-059); it never counts to it.
  draft.version = plannedVersion(context.metamodel, repository, fileOf(draft, folder, false));
  draft.properties.set(keys["import-version"], draft.version);
  return draft;
};

/**
 * The names of the attributes of `values`, which the type `t` of their owner must define (else
 * `reqif.invalid`); the import takes no value of a relation or specification over (a loss).
 */
const valueNames = (
  index: Index,
  owner: ReqifIdentifiable,
  what: string,
  t: ReqifSpecType | undefined,
  values: readonly ReqifValue[],
): string => {
  const names = values.map((value) => {
    const known = index.attributes.get(value.definition);
    if (known === undefined || known.type !== t) {
      throw invalidFile(
        `${what} ${owner.identifier} has a value of attribute ${value.definition}, which its type does not define`,
        owner.line,
      );
    }
    return nameOf(known.a);
  });
  return names.join(", ");
};

/** Adds `relation` to the draft of its source, or lists it as a loss. */
const planRelation = (
  context: Context,
  drafts: ReadonlyMap<string, Draft>,
  relation: ReqifSpecRelation,
): void => {
  const t = context.index.types.get(relation.type);
  if (t?.category !== "spec-relation") {
    throw invalidFile(
      `SPEC-RELATION ${relation.identifier} refers to type ${relation.type}, which the file does not define`,
      relation.line,
    );
  }
  const kind = context.coverage.relations.get(t.identifier);
  const source = drafts.get(relation.source);
  const target = drafts.get(relation.target);
  const loss: Loss = (code, reason) => {
    context.losses.push({
      identifier: relation.identifier,
      kind: "spec-relation",
      ...(source === undefined ? {} : { id: source.id }),
      code,
      reason,
    });
  };
  if (kind === undefined) {
    loss("omitted-type", `the mapping omits its type ${nameOf(t)}`);
  } else if (source === undefined || target === undefined) {
    const end = source === undefined ? `source ${relation.source}` : `target ${relation.target}`;
    loss("relation-end-not-imported", `its ${end} is not imported`);
  } else if (!allowed(context.metamodel, kind, source, target)) {
    loss(
      "relation-not-allowed",
      `the metamodel does not allow ${kind} from ${source.base.type.key} to ${target.base.type.key}`,
    );
  } else {
    const items = source.relations.get(kind) ?? [];
    const twice = items.some((item) => item.id === target.id);
    if (twice) {
      loss("relation-duplicate", `${kind} to ${relation.target} is imported once already`);
    } else {
      items.push({ id: target.id, version: target.version });
    }
    source.relations.set(kind, items);
  }
  if (relation.values.length > 0) {
    loss(
      "omitted-attribute",
      `the values of a SPEC-RELATION are not imported: ${valueNames(context.index, relation, "SPEC-RELATION", t, relation.values)}`,
    );
  }
};

/** Whether the relation kind `kind` may lead from the type of `source` to that of `target`. */
const allowed = (metamodel: Metamodel, kind: string, source: Draft, target: Draft): boolean => {
  const rule = metamodel.relations.find((r) => r.key === kind);
  return (
    allowsType(rule?.["source-types"], source.base.type.key, metamodel) &&
    allowsType(rule?.["target-types"], target.base.type.key, metamodel)
  );
};

/**
 * A loss for every part of an imported object, relation or specification the parser did not read
 * (`unread` with an owner: ALTERNATIVE-ID, THE-ORIGINAL-VALUE, unknown children, ...). Parts of an
 * object or relation whose type the mapping omits are not listed again.
 */
const unreadLosses = (file: ReqifFile, drafts: ReadonlyMap<string, Draft>, losses: ReqifLoss[]): void => {
  const omitted = new Set(
    losses.filter((l) => l.code === "omitted-type").map((l) => `${l.kind} ${l.identifier}`),
  );
  const sources = new Map(file.specRelations.map((r) => [r.identifier, r.source]));
  for (const { name, line, owner } of file.unread) {
    if (owner === undefined || omitted.has(`${owner.kind} ${owner.identifier}`)) {
      continue;
    }
    const { kind, identifier } = owner;
    const draft = drafts.get(kind === "spec-object" ? identifier : (sources.get(identifier) ?? ""));
    losses.push({
      identifier,
      kind,
      ...(draft === undefined ? {} : { id: draft.id }),
      code: "omitted-value",
      reason: `<${name}> on line ${String(line)} is not read`,
    });
  }
};

/** The plan of importing `file` through `mapping` as delivery `origin` (see the file comment). */
export const planImport = (
  file: ReqifFile,
  mapping: AnyMapping,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  origin: ImportOrigin,
): ImportPlan => {
  const keys = originKeys(metamodel);
  const index = indexOf(file);
  const coverage = checkCoverage(file, index, mapping, metamodel, keys);
  const location: WorkspaceLocation = mapping.target ?? {
    repository: layout.main,
    path: portableName(mapping.source.name, "source"),
  };
  const { repository, folder } = locate(layout, location);
  if (repository === undefined || folder === undefined) {
    throw new CommandError(
      "file.folder-missing",
      `Not imported: the target folder is in repository ${location.repository}, which is not available on this machine`,
      { repository: location.repository },
    );
  }
  const relative = path.relative(repository.folder, folder).split(path.sep).join("/");
  const context: Context = {
    index,
    coverage,
    metamodel,
    losses: [],
    keys,
    source: mapping.source.name,
    origin,
  };
  const drafts = new Map<string, Draft>();
  for (const object of file.specObjects) {
    const draft = planObject(context, repository.name, relative, object);
    if (draft !== undefined) {
      drafts.set(object.identifier, draft);
    }
  }
  for (const relation of file.specRelations) {
    planRelation(context, drafts, relation);
  }
  for (const specification of file.specifications) {
    if (specification.values.length > 0) {
      const names = valueNames(
        index,
        specification,
        "SPECIFICATION",
        index.types.get(specification.type),
        specification.values,
      );
      context.losses.push({
        identifier: specification.identifier,
        kind: "specification",
        code: "omitted-attribute",
        reason: `the values of a SPECIFICATION are not imported: ${names}`,
      });
    }
    if (specification.children.length > 0) {
      context.losses.push({
        identifier: specification.identifier,
        kind: "specification",
        code: "hierarchy",
        reason: `the SPEC-HIERARCHY of ${nameOf(specification)} (order and nesting) is not imported`,
      });
    }
  }
  unreadLosses(file, drafts, context.losses);
  const all = [...drafts.values()];
  return {
    repository,
    folder: relative,
    files: all.map((d) => fileOf(d, relative, true)),
    created: all.map((d) => ({ identifier: d.identifier, id: d.id })),
    losses: context.losses,
  };
};
