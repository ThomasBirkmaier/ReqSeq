// The ReqIF form of ReqSeq's own files (ADR-0013 "Export"), shared by the export and by the import of
// a file of ReqSeq (REQ-IF-TOOL-ID `reqseq`, SR-052 AK3): the IDENTIFIERs, the attributes of a type
// and the readable values of an element. The import writes the readable values again from the two
// round-trip attributes and takes those only when they equal the file's, so both sides build them
// here.
//
// - IDENTIFIERs start with `_` and a category, parts joined with `.` (ADR-0013 table).
// - Attributes of a type: `title` (STRING), `text` (XHTML), each property of the type but the title
//   in the type's order, `status` (ENUMERATION, for information), `reqseq-markdown` and
//   `reqseq-values` (STRING). A text property is STRING, with `many` an XHTML list of its items as
//   written; a number REAL; a date DATE at `T00:00:00Z`; a choice ENUMERATION (`MULTI-VALUED` with
//   `many`); a relation-valued property (validity, packages) STRING of the short IDs of its targets.
// - Readable values: one per attribute that has a value. A value the attribute cannot carry (a
//   number that is not finite, a date that is no `YYYY-MM-DD`, a choice or status the metamodel does
//   not define) has no readable value; `reqseq-values` still holds it as stored.
// - `reqseq-values`: the frontmatter as stored without `id` and `type`, as JSON.
// - The one-to-one mapping of a file of ReqSeq (`ownMapping`, SR-052 AK3, SR-054): by IDENTIFIER,
//   each `_ot-<type>` to that type when the metamodel has it and it is not abstract, each
//   `_ad-<type>.<key>` to that property of the type (`title`, `text`; a choice with its values
//   `_ev-<key>.<choice>`), each `_rt-<kind>` to that kind; omitted: the status (D-030), the origin
//   properties (only the import writes them, SR-057 AK3), relation-valued properties (their STRING
//   of short IDs is for reading; `reqseq-values` carries them), both round-trip attributes, and
//   whatever the metamodel does not know.
import type { MetamodelProperty, ReqifMappingFile } from "../generated/types.js";
import type { EffectiveType, Metamodel } from "../metamodel/index.js";
import { findType } from "../metamodel/index.js";
import type { TargetItem } from "../model/index.js";
import { hasId } from "../model/index.js";
import type {
  ReqifAttributeDefinition,
  ReqifDatatypeKind,
  ReqifFile,
  ReqifValue,
  XhtmlNode,
} from "./model.js";
import { XHTML_NAMESPACE } from "./model.js";
import type { ReqifWritable } from "./write.js";
import { markdownToXhtml } from "./xhtml-markdown.js";

/** REQ-IF-TOOL-ID of a file ReqSeq writes. */
export const OWN_TOOL_ID = "reqseq";
/** The pseudo-property key of the status attribute and its enumeration. */
const STATUS = "status";
/** The SPEC-OBJECT-TYPE of a target whose element is missing or not on this machine (N-041, D-058). */
export const MISSING_TYPE = "_ot.missing";

/** The IDENTIFIERs of the export (ADR-0013). */
export const ownId = {
  element: (id: string): string => `_${id}`,
  objectType: (type: string): string => `_ot-${type}`,
  attribute: (type: string, key: string): string => `_ad-${type}.${key}`,
  markdown: (type: string): string => `_rq-${type}.markdown`,
  values: (type: string): string => `_rq-${type}.values`,
  enumeration: (property: string): string => `_dt-enum.${property}`,
  enumValue: (property: string, choice: string): string => `_ev-${property}.${choice}`,
  relationType: (kind: string): string => `_rt-${kind}`,
} as const;

/** The datatype IDENTIFIER of each kind but enumeration. */
export const OWN_DATATYPES = {
  string: "_dt-string",
  xhtml: "_dt-xhtml",
  real: "_dt-real",
  date: "_dt-date",
} as const;

/** What an attribute of an own type holds. */
export type OwnRole = "title" | "text" | "property" | "status" | "markdown" | "values";

interface OwnAttributeBase {
  readonly identifier: string;
  readonly longName: string;
  readonly kind: Exclude<ReqifDatatypeKind, "integer" | "boolean">;
  readonly datatype: string;
  readonly multiValued: boolean;
}

/** One attribute of an own type, without LAST-CHANGE; a `property` one with its definition. */
export type OwnAttribute =
  | (OwnAttributeBase & { readonly role: Exclude<OwnRole, "property">; readonly property?: undefined })
  | (OwnAttributeBase & { readonly role: "property"; readonly property: MetamodelProperty });

const attribute = (
  identifier: string,
  longName: string,
  kind: OwnAttribute["kind"],
  datatype: string,
  role: Exclude<OwnRole, "property">,
): OwnAttribute => ({ identifier, longName, kind, datatype, multiValued: false, role });

/** The attribute of property `property` of type `type` (see the file comment). */
const propertyAttribute = (type: string, property: MetamodelProperty): OwnAttribute => {
  const made = (kind: OwnAttribute["kind"], datatype: string, multiValued = false): OwnAttribute => ({
    identifier: ownId.attribute(type, property.key),
    longName: property.key,
    kind,
    datatype,
    multiValued,
    role: "property",
    property,
  });
  const many = property.many === true;
  switch (property.kind) {
    case "text":
      return many ? made("xhtml", OWN_DATATYPES.xhtml) : made("string", OWN_DATATYPES.string);
    case "number":
      return made("real", OWN_DATATYPES.real);
    case "date":
      return made("date", OWN_DATATYPES.date);
    case "choice":
      return made("enumeration", ownId.enumeration(property.key), many);
    case "relation":
      return made("string", OWN_DATATYPES.string);
  }
};

/** The attributes of own type `type` (`key` when the metamodel does not know it), in order. */
export const ownAttributes = (
  metamodel: Metamodel,
  key: string,
  type: EffectiveType | undefined,
  titleKey: string,
): OwnAttribute[] => {
  const properties = (type?.properties ?? []).flatMap((p) => {
    const definition = metamodel.properties.find((d) => d.key === p);
    return definition === undefined || p === titleKey ? [] : [propertyAttribute(key, definition)];
  });
  return [
    attribute(ownId.attribute(key, "title"), "title", "string", OWN_DATATYPES.string, "title"),
    attribute(ownId.attribute(key, "text"), "text", "xhtml", OWN_DATATYPES.xhtml, "text"),
    ...properties,
    attribute(ownId.attribute(key, STATUS), STATUS, "enumeration", ownId.enumeration(STATUS), "status"),
    attribute(ownId.markdown(key), "reqseq-markdown", "string", OWN_DATATYPES.string, "markdown"),
    attribute(ownId.values(key), "reqseq-values", "string", OWN_DATATYPES.string, "values"),
  ];
};

/** The attribute definitions of `attributes`, as the writer takes them. */
export const ownDefinitions = (
  attributes: readonly OwnAttribute[],
  lastChange: string,
): ReqifWritable["specTypes"][number]["attributes"] =>
  attributes.map((a): Omit<ReqifAttributeDefinition, "line" | "defaultValue"> => ({
    identifier: a.identifier,
    lastChange,
    longName: a.longName,
    kind: a.kind,
    datatype: a.datatype,
    multiValued: a.multiValued,
  }));

/** What a readable value needs beyond the element. */
export interface ReadableOptions {
  /** The short ID of a relation target, for a relation-valued property. */
  readonly shortId: (item: TargetItem) => string;
}

/** A text as it is stored: a scalar as its text; anything else has none. */
const scalarText = (value: unknown): string | undefined =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : undefined;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The XHTML list of the items of a text property with `many`, each as written. */
const listOf = (items: readonly string[]): XhtmlNode[] => [
  {
    name: "div",
    namespace: XHTML_NAMESPACE,
    attributes: [],
    children: [
      {
        name: "ul",
        namespace: XHTML_NAMESPACE,
        attributes: [],
        children: items.map((item) => ({
          name: "li",
          namespace: XHTML_NAMESPACE,
          attributes: [],
          children: item === "" ? [] : [item],
        })),
      },
    ],
  },
];

/** The values of a property, a list as it is and anything else as a list of one; nothing for an absent value. */
const asList = (value: unknown): readonly unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/** The enumeration references of the keys in `value` that `known` defines. */
const enumRefs = (property: string, value: unknown, known: ReadonlySet<string>): string[] =>
  asList(value).flatMap((key) =>
    typeof key === "string" && known.has(key) ? [ownId.enumValue(property, key)] : [],
  );

/** The readable value of text property `property` for `value`: STRING, with `many` an XHTML list. */
const textValue = (
  definition: string,
  property: MetamodelProperty,
  value: unknown,
): ReqifValue | undefined => {
  if (property.many === true) {
    const items = asList(value).flatMap((item) => {
      const text = scalarText(item);
      return text === undefined ? [] : [text];
    });
    return items.length === 0 ? undefined : { kind: "xhtml", definition, value: listOf(items) };
  }
  const text = scalarText(value);
  return text === undefined ? undefined : { kind: "string", definition, value: text };
};

/** The readable value of property attribute `a` for `value`, or undefined (see the file comment). */
const propertyValue = (
  a: OwnAttribute,
  property: MetamodelProperty,
  value: unknown,
  options: ReadableOptions,
): ReqifValue | undefined => {
  const definition = a.identifier;
  switch (property.kind) {
    case "text":
      return textValue(definition, property, value);
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? { kind: "real", definition, value: String(value) }
        : undefined;
    case "date":
      return typeof value === "string" && DATE.test(value)
        ? { kind: "date", definition, value: `${value}T00:00:00Z` }
        : undefined;
    case "choice": {
      const refs = enumRefs(property.key, value, new Set((property.choices ?? []).map((c) => c.key)));
      return refs.length === 0 ? undefined : { kind: "enumeration", definition, values: refs };
    }
    case "relation": {
      const ids = asList(value).flatMap((item) => (hasId(item) ? [options.shortId(item)] : []));
      return ids.length === 0 ? undefined : { kind: "string", definition, value: ids.join(", ") };
    }
  }
};

/** An element as the export reads it: its frontmatter as stored and its text. */
export interface OwnElement {
  readonly data: Readonly<Record<string, unknown>>;
  readonly text: string;
}

/** The `reqseq-values` of `element`: its frontmatter without `id` and `type`, as JSON. */
export const ownValuesText = (element: OwnElement): string =>
  JSON.stringify(
    Object.fromEntries(Object.entries(element.data).filter(([key]) => key !== "id" && key !== "type")),
  );

/**
 * The values of `element` for `attributes` (`ownAttributes`), in their order (see the file
 * comment). `channels: false` leaves out `reqseq-markdown` and `reqseq-values`.
 */
export const readableValues = (
  metamodel: Metamodel,
  attributes: readonly OwnAttribute[],
  element: OwnElement,
  titleKey: string,
  options: ReadableOptions,
  channels = true,
): ReqifValue[] => {
  const statuses = new Set(metamodel.statuses.map((s) => s.key));
  return attributes.flatMap((a): ReqifValue[] => {
    const definition = a.identifier;
    switch (a.role) {
      case "title": {
        const title = scalarText(element.data[titleKey]);
        return title === undefined ? [] : [{ kind: "string", definition, value: title }];
      }
      case "text":
        return element.text === ""
          ? []
          : [
              {
                kind: "xhtml",
                definition,
                // Image links as the text has them: the export copies no images yet.
                value: [markdownToXhtml(element.text).value],
              },
            ];
      case "status": {
        const refs = enumRefs(STATUS, element.data[STATUS], statuses);
        return refs.length === 0 ? [] : [{ kind: "enumeration", definition, values: refs }];
      }
      case "markdown":
        return channels ? [{ kind: "string", definition, value: element.text }] : [];
      case "values":
        return channels ? [{ kind: "string", definition, value: ownValuesText(element) }] : [];
      case "property": {
        const value = propertyValue(a, a.property, element.data[a.property.key], options);
        return value === undefined ? [] : [value];
      }
    }
  });
};

type TypeEntry = NonNullable<ReqifMappingFile["types"]>[number];
type AttributeEntry = NonNullable<ReqifMappingFile["attributes"]>[number];
type RelationEntry = NonNullable<ReqifMappingFile["relations"]>[number];

/** The part of `identifier` after `prefix`, or undefined when it does not start with it. */
const after = (identifier: string, prefix: string): string | undefined =>
  identifier.startsWith(prefix) ? identifier.slice(prefix.length) : undefined;

/** The entry of attribute `identifier` of own type `type` (see the file comment). */
const ownAttributeEntry = (
  metamodel: Metamodel,
  type: EffectiveType,
  identifier: string,
  values: readonly string[],
  skipped: ReadonlySet<string>,
): AttributeEntry => {
  const key = after(identifier, `_ad-${type.key}.`);
  if (key === "title" || key === "text") {
    return { source: identifier, property: key };
  }
  const definition =
    key === undefined || skipped.has(key) || !type.properties.includes(key)
      ? undefined
      : metamodel.properties.find((p) => p.key === key);
  if (definition === undefined || definition.kind === "relation") {
    return { source: identifier, omit: true };
  }
  if (definition.kind !== "choice") {
    return { source: identifier, property: definition.key };
  }
  const choices = new Set((definition.choices ?? []).map((c) => c.key));
  const mapped: Record<string, string> = {};
  const omitted: string[] = [];
  for (const value of values) {
    const choice = after(value, `_ev-${definition.key}.`);
    if (choice !== undefined && choices.has(choice)) {
      mapped[value] = choice;
    } else {
      omitted.push(value);
    }
  }
  return {
    source: identifier,
    property: definition.key,
    values: mapped,
    ...(omitted.length > 0 ? { "omit-values": omitted } : {}),
  };
};

/**
 * The one-to-one mapping of the file of ReqSeq `file` for source `name` (see the file comment);
 * `skipped` are the property keys never mapped (the title key and the origin properties).
 */
export const ownMapping = (
  file: ReqifFile,
  metamodel: Metamodel,
  name: string,
  skipped: ReadonlySet<string>,
): ReqifMappingFile => {
  const datatypes = new Map(file.datatypes.map((d) => [d.identifier, d]));
  const types: TypeEntry[] = [];
  const attributes: AttributeEntry[] = [];
  const relations: RelationEntry[] = [];
  for (const t of file.specTypes) {
    if (t.category === "spec-relation") {
      const kind = after(t.identifier, "_rt-");
      relations.push(
        kind !== undefined && metamodel.relations.some((r) => r.key === kind)
          ? { source: t.identifier, kind }
          : { source: t.identifier, omit: true },
      );
      continue;
    }
    if (t.category !== "spec-object") {
      continue;
    }
    const key = after(t.identifier, "_ot-");
    const type = key === undefined ? undefined : findType(metamodel, key);
    if (type === undefined || type.abstract) {
      types.push({ source: t.identifier, omit: true });
      continue;
    }
    types.push({ source: t.identifier, type: type.key });
    for (const a of t.attributes) {
      const values = (datatypes.get(a.datatype)?.values ?? []).map((v) => v.identifier);
      attributes.push(ownAttributeEntry(metamodel, type, a.identifier, values, skipped));
    }
  }
  return {
    "reqseq-reqif-mapping": 1,
    source: { name, "tool-id": OWN_TOOL_ID },
    types,
    attributes,
    relations,
  };
};
