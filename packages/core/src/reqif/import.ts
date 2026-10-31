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
//   IDENTIFIER), the text from the attribute mapped to `text` (XHTML as Markdown, `xhtmlToMarkdown`, SR-095) and the
//   mapped properties: INTEGER and REAL as number, DATE as its date, ENUMERATION as the choice keys
//   of `values`, and every datatype as text in `title`, `text` and a text property (enumeration
//   values by name).
// - Relations: one entry per SPEC-RELATION of a mapped type whose two ends are imported, on the
//   element of its SOURCE, with the planned version of its TARGET (`plannedVersion`; relation kinds
//   do not count to a version, ADR-0005).
// - Losses (SR-053 AK2), with the codes of `common.schema.json#/$defs/reqifLoss`: an object of an
//   omitted type, a value of an omitted attribute or an omitted enumeration value, a number or date
//   not in its lexical form, a date whose time is not midnight, XHTML elements without plain form,
//   a relation whose type is omitted or whose other end is not imported, values of relations and
//   specifications, a duplicate relation, a relation the metamodel does not allow, the SPEC-
//   HIERARCHY (once per SPECIFICATION that has one) and every part of an imported object the parser
//   did not read. A DEFAULT-VALUE is the value of an object without its own (ReqIF 1.2 §10.8.3).
// - Origin (SR-057 AK1): each element gets the source name of the mapping, the object's IDENTIFIER,
//   the import date, the delivery and the import version: the element's planned version as written
//   (D-059; `import-version` never counts to it). A mapping that maps a SPEC-OBJECT-TYPE to a type
//   without all five origin properties is refused with `input.invalid` at that entry.
// - Never from the delivery: `id`, `type`, `status`, the title key (D-030) and the origin
//   properties (SR-057 AK3; `propertyKeyRefusal`).
// - Files go into the mapping's `target`, else a folder named after the source in the main
//   repository (SR-053 AK1). The own metamodel is only read (SR-054 AK3).
// - A file of ReqSeq (`own`, SR-052 AK3; ADR-0013 "Import"): a SPEC-OBJECT without values is a stub
//   and never an element. For a type whose mapping, relation types included, is the one-to-one one
//   (`oneToOneTypes`), an object whose readable values `readableValues` (own.ts) writes again from
//   `reqseq-markdown` and `reqseq-values` equal to the file's (relation-valued properties, whose
//   short IDs depend on the workspace, aside), whose SPEC-RELATIONs are those of `reqseq-values`
//   and whose text has as many images takes the title, the text byte for byte (its image links
//   pointed at the copies), the properties of its type and the relations from those two; the status
//   and the origin stored there are not taken, and a relation the metamodel does not allow is a
//   loss (`checkOwnRelations`). Otherwise another tool changed it, or a mapping differs: the
//   readable attributes and SPEC-RELATIONs are imported through the mapping, with a warning
//   `reqif.edited-elsewhere` for a changed object. A target of a relation or relation-valued
//   property that is imported in this call becomes that element with its planned version (so the
//   version of a relation-valued property naming it is new, spec question #565); any other target
//   stays as stored, a missing target with its stored version (N-041, D-045, D-058). Not yet: a
//   target of an earlier delivery or of the workspace (ADR-0013 steps 2 and 3); the links of
//   reference-style images.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { Problem } from "../catalog.js";
import type { FlowMappingValue, ItemValue, PropertyValue, ScalarValue } from "../files/index.js";
import type {
  MetamodelProperty,
  ReqifLoss,
  ReqifObject,
  ReqifUnmapped,
  WorkspaceLocation,
} from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { allowsType, findType, keyDefinition } from "../metamodel/index.js";
import type { NewElementBase, NewElementFile } from "../model/index.js";
import {
  fileNameFor,
  hasId,
  imageLink,
  isUuid,
  markdownLinks,
  newElementBase,
  newElementBytes,
  plannedVersion,
  portableName,
  propertyKeyRefusal,
  titleKeyOrEmpty,
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
  XhtmlNode,
} from "./model.js";
import type { OriginKeys } from "./origin.js";
import { originKeys } from "./origin.js";
import { ownAttributes, ownId, ownMapping, ownRelationKeys, readableValues } from "./own.js";
import type { ImageFile, ImageReader } from "./images.js";
import { ImageNames } from "./images.js";
import type { XhtmlImage } from "./xhtml-markdown.js";
import { prepareMarkdown } from "./xhtml-markdown.js";
import { markdownText, xhtmlText } from "./xhtml-text.js";

/** A copy of an image in the image folder of an element. */
export interface PlannedImage {
  /** The element file name without `.md`. */
  readonly stem: string;
  readonly name: string;
  readonly file: ImageFile;
}

/** What `planImport` gives: the files to write and what the output lists. */
export interface ImportPlan {
  readonly repository: RepositoryLocation;
  /** The target folder relative to the repository, `/` as separator. */
  readonly folder: string;
  readonly files: readonly NewElementFile[];
  /** The copies of the images the texts embed: `name` in the image folder `stem` of an element (SR-095 AK2). */
  readonly images: readonly PlannedImage[];
  readonly created: readonly ReqifObject[];
  readonly losses: readonly ReqifLoss[];
  /** Warnings: `reqif.edited-elsewhere` for an object of a file of ReqSeq another tool changed. */
  readonly problems: readonly Problem[];
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
  readonly relations: Map<string, Record<string, ScalarValue>[]>;
  /** Of a file of ReqSeq: the relation kinds as `reqseq-values` holds them; set: its SPEC-RELATIONs are not read. */
  ownRelations?: Map<string, PropertyValue>;
  /** A relation-valued property took a target from a SPEC-RELATION, so the version is planned again. */
  relationProperties?: true;
  /** The planned version (`plannedVersion`), set once the values are planned. */
  version: string;
  /** The file name without `.md`, which is also the name of its image folder. */
  readonly stem: string;
  /** The images copied next to it. */
  readonly images: ImageNames;
  /** The images the text embeds, which count to the version (D-057). */
  readonly textImages: Map<string, string>;
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

/** Where a text goes: the element text, a property with `markdown: true`, or a plain one. */
type Target = "text" | "markdown" | "plain";

/**
 * The Markdown of an XHTML value (`prepareMarkdown`, SR-095), converted once: its losses, and each
 * image it embeds copied next to the element (`ImageNames`) with the link to the copy. An image that
 * cannot be copied is a loss (`image-missing`, `image-outside`) and stays as its alt text or file
 * name without a link, so the text never points outside the element.
 */
const markdownOf = async (
  context: Context,
  draft: Draft,
  value: readonly XhtmlNode[],
  target: Target,
  loss: Loss,
): Promise<string> => {
  const prepared = prepareMarkdown(value);
  for (const lost of prepared.losses) {
    loss(lost.code, lost.reason);
  }
  const links: (string | undefined)[] = [];
  for (const image of prepared.images) {
    const read = await context.images(image);
    if (read.kind === "found") {
      const link = `${draft.stem}/${draft.images.nameOf(read.file)}`;
      links.push(link);
      if (target === "text") {
        draft.textImages.set(link, read.file.sha256);
      }
    } else {
      loss(read.kind, read.reason);
      links.push(undefined);
    }
  }
  return prepared.markdown((_image, at) => links[at]);
};

/**
 * The texts of a value: XHTML as Markdown (`markdownOf`) for a Markdown target and as plain text
 * (`xhtmlText`, its other elements a loss) for a plain one, enumeration values by name, the others
 * as written. For a Markdown target the texts that are not XHTML are escaped (`markdownText`) so
 * they read back as written, but not those of a file of ReqSeq, which are Markdown already; elsewhere
 * they stay plain.
 */
const textsOf = async (
  context: Context,
  draft: Draft,
  value: ReqifValue,
  datatype: ReqifDatatype,
  target: Target,
  loss: Loss,
): Promise<string[]> => {
  if (value.kind === "xhtml") {
    if (target !== "plain") {
      return [await markdownOf(context, draft, value.value, target, loss)];
    }
    const { text, unconverted } = xhtmlText(value.value);
    if (unconverted.length > 0) {
      loss("xhtml-element", `XHTML ${unconverted.join(", ")} has no form in a plain text; its text is kept`);
    }
    return [text];
  }
  const texts =
    value.kind === "enumeration" ? enumValuesOf(value.values, datatype, loss).map(nameOf) : [value.value];
  // A file of ReqSeq writes a text property as its Markdown (own.ts), so it reads back as written.
  return target === "plain" || context.own ? texts : texts.map(markdownText);
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

/**
 * The lexical form of xs:dateTime (ReqIF 1.2 §10.8.7) with a four-digit year, which a date property
 * can hold, or of its day alone.
 */
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?|24:00:00(?:\.0+)?)(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?)?$/;

/** The time of xs:dateTime that is the first instant of the next day (XSD 1.1 Part 2 §3.3.8). */
const END_OF_DAY = /^T24:00:00(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** The time of `date` (`YYYY-MM-DD`) in UTC, if it is a day of the calendar. */
const dayTime = (date: string): number | undefined => {
  const time = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(date) ? time : undefined;
};

const DAY_MS = 86_400_000;

/**
 * A DATE value as a date property holds it: the day (a time other than midnight is a loss; 24:00:00
 * is midnight of the next day). A value that is not of the lexical form of xs:dateTime (an empty
 * value too; white space around it is collapsed) or names no day a date property holds is a loss.
 */
const dateValue = (raw: string, loss: Loss): string | undefined => {
  const value = raw.trim();
  const written = value.slice(0, 10);
  const time = DATE_TIME.test(value) ? dayTime(written) : undefined;
  const endOfDay = END_OF_DAY.test(value.slice(10));
  const date =
    time === undefined ? undefined : endOfDay ? new Date(time + DAY_MS).toISOString().slice(0, 10) : written;
  if (date === undefined || !/^\d{4}-/.test(date)) {
    loss("omitted-value", `"${raw}" is no DATE`);
    return undefined;
  }
  if (value.length > 10 && !endOfDay && !MIDNIGHT.test(value.slice(10))) {
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
const propertyValue = async (
  context: Context,
  draft: Draft,
  value: ReqifValue,
  datatype: ReqifDatatype,
  entry: AttributeEntry,
  definition: MetamodelProperty,
  loss: Loss,
): Promise<PropertyValue | undefined> => {
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
  const texts = await textsOf(
    context,
    draft,
    value,
    datatype,
    definition.markdown === true ? "markdown" : "plain",
    loss,
  );
  return definition.many === true ? texts : texts.join(", ");
};

/** The file of a draft, with its relations or without them (for its planned version). */
const fileOf = (draft: Draft, folder: string, withRelations: boolean): NewElementFile => ({
  file: path.posix.join(folder, fileNameFor({ prefix: draft.base.type.prefix, id: draft.id })),
  bytes: newElementBytes(draft.base, draft.id, draft.title, draft.text, [
    ...draft.properties,
    ...(withRelations ? [...draft.relations, ...(draft.ownRelations ?? [])] : []),
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
  /** The new UUID of each object that becomes an element, by IDENTIFIER. */
  readonly ids: ReadonlyMap<string, string>;
  /** A file of ReqSeq (see the file comment). */
  readonly own: boolean;
  readonly problems: Problem[];
  /** Relation items that name an object of this call, whose version is set once all are planned. */
  readonly pending: Map<string, Record<string, ScalarValue>[]>;
  /** Of a file of ReqSeq: the targets of the SPEC-RELATIONs of each object, as `<type>|<target>`. */
  readonly ownRelationsOf: ReadonlyMap<string, ReadonlySet<string>>;
  /** Of a file of ReqSeq: the `reqseq-values` of each object whose channels are not taken, if JSON. */
  readonly stored: Map<string, Readonly<Record<string, unknown>>>;
  /** Of a file of ReqSeq: the types whose mapping (with the relation types) is the one-to-one one. */
  readonly oneToOne: ReadonlySet<string>;
  readonly images: ImageReader;
  readonly layout: WorkspaceLayout;
}

/**
 * Whether `a` of type `t` of a file of ReqSeq holds nothing the one-to-one mapping maps: the
 * round-trip attributes, the status (D-030) and a relation-valued property, whose targets are its
 * SPEC-RELATIONs; its omission is no loss.
 */
const ownOnly = (metamodel: Metamodel, t: ReqifSpecType, a: ReqifAttributeDefinition): boolean => {
  const key = t.identifier.slice("_ot-".length);
  return (
    a.identifier === ownId.markdown(key) ||
    a.identifier === ownId.values(key) ||
    a.identifier === ownId.attribute(key, "status") ||
    metamodel.properties.some((p) => p.kind === "relation" && a.identifier === ownId.attribute(key, p.key))
  );
};

/** Takes the values of `object` into `draft` (see the file comment). */
const planValues = async (
  context: Context,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  draft: Draft,
): Promise<void> => {
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
      if (!(context.own && ownOnly(context.metamodel, t, a))) {
        loss("omitted-attribute", `the mapping omits its attribute ${nameOf(a)}`);
      }
      continue;
    }
    const { entry, definition } = checked;
    const datatype = datatypeOf(index, a);
    const prefixed: Loss = (code, reason) => {
      loss(code, `${nameOf(a)}: ${reason}`);
    };
    if (definition === undefined) {
      const target = property === "text" ? "text" : "plain";
      const text = (await textsOf(context, draft, value, datatype, target, prefixed)).join(", ");
      if (property === "title") {
        draft.title = text;
      } else {
        draft.text = text;
      }
      continue;
    }
    const result = await propertyValue(context, draft, value, datatype, entry, definition, prefixed);
    if (result !== undefined) {
      draft.properties.set(property, result);
    }
  }
};

/** What `reqseq-markdown` and `reqseq-values` of an object hold, and the images of its text. */
interface Channels {
  readonly data: Readonly<Record<string, unknown>>;
  readonly text: string;
  /** Each image link of the text (its URL) with the `object` the file has for it, in order. */
  readonly images: readonly { readonly url: string; readonly image: XhtmlImage }[];
}

/** The value of attribute `definition` as a STRING, if the object has one. */
const stringValue = (object: ReqifSpecObject, definition: string): string | undefined => {
  const value = object.values.find((v) => v.definition === definition);
  return value?.kind === "string" ? value.value : undefined;
};

/** The JSON object of `text`, or undefined when it is none. */
const jsonObject = (text: string): Readonly<Record<string, unknown>> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
};

/** Values in a form two sets compare by, ordered by attribute. */
const comparable = (values: readonly ReqifValue[]): string =>
  JSON.stringify([...values].sort((a, b) => (a.definition < b.definition ? -1 : 1)));

/** The SPEC-RELATIONs `data` gives an object, as `<type>|<target>` (export.ts: items with a UUID). */
const storedRelations = (metamodel: Metamodel, data: Readonly<Record<string, unknown>>): Set<string> =>
  new Set(
    ownRelationKeys(metamodel).flatMap((key) =>
      [data[key]]
        .flat()
        .flatMap((item) =>
          hasId(item) && isUuid(item.id) ? [`${ownId.relationType(key)}|${ownId.element(item.id)}`] : [],
        ),
    ),
  );

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * The round-trip channels of `object` of a file of ReqSeq, when the readable values written again
 * from them equal the file's and its SPEC-RELATIONs those `reqseq-values` names (see the file
 * comment); else undefined, with the warning.
 */
const ownChannels = (
  context: Context,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  ownType: string,
): Channels | undefined => {
  const { metamodel } = context;
  const key = t.identifier.slice("_ot-".length);
  const markdownId = ownId.markdown(key);
  const valuesId = ownId.values(key);
  const text = stringValue(object, markdownId);
  const data = jsonObject(stringValue(object, valuesId) ?? "");
  const titleKey = titleKeyOrEmpty(metamodel);
  const attributes = ownAttributes(metamodel, key, findType(metamodel, ownType), titleKey);
  // Compared: the readable attributes this metamodel knows (one it does not know is not imported),
  // but not those of relation-valued properties, whose SPEC-RELATIONs are compared below.
  const compared = new Set(
    attributes
      .filter((a) => a.property?.kind !== "relation" && a.role !== "markdown" && a.role !== "values")
      .map((a) => a.identifier),
  );
  const known = (v: ReqifValue): boolean => compared.has(v.definition);
  // The images of the text in the order `markdownToXhtml` writes them, paired with its links.
  const textValue = object.values.find((v) => v.definition === ownId.attribute(key, "text"));
  const objects = textValue?.kind === "xhtml" ? prepareMarkdown(textValue.value).images : [];
  const images: { url: string; image: XhtmlImage }[] = [];
  const image = (url: string): string => {
    const found = objects[images.length];
    images.push({ url, image: found ?? { data: url } });
    return found?.data ?? url;
  };
  const same =
    text !== undefined &&
    data !== undefined &&
    comparable(
      readableValues(
        metamodel,
        attributes,
        { data, text },
        titleKey,
        { shortId: () => "", image },
        false,
      ).filter(known),
    ) === comparable(object.values.filter(known)) &&
    images.length === objects.length &&
    sameSet(storedRelations(metamodel, data), context.ownRelationsOf.get(object.identifier) ?? new Set());
  if (same) {
    return { data, text, images };
  }
  if (data !== undefined) {
    context.stored.set(object.identifier, data);
  }
  context.problems.push({
    code: "reqif.edited-elsewhere",
    severity: "warning",
    message: `${object.identifier}: its attributes or relations differ from reqseq-markdown and reqseq-values, so another tool changed it; its readable attributes and SPEC-RELATIONs are imported`,
  });
  return undefined;
};

/** `value` with each relation item that names an object of this call pointed at its element. */
const ownTargets = (context: Context, value: unknown): PropertyValue => {
  const mapped = (item: unknown): unknown => {
    if (!hasId(item)) {
      return item;
    }
    const id = context.ids.get(ownId.element(item.id));
    if (id === undefined) {
      return item;
    }
    // The element lies in the repository of this call, so a stored repository no longer applies.
    const { repository: _repository, ...rest } = item;
    const pointed: Record<string, ScalarValue> = { ...(rest as FlowMappingValue), id, version: "" };
    context.pending.set(id, [...(context.pending.get(id) ?? []), pointed]);
    return pointed;
  };
  return (Array.isArray(value) ? value.map(mapped) : mapped(value)) as PropertyValue;
};

/** The folder `imageLink` resolves the links of a text against when only their paths are compared. */
const ANY_ELEMENT = "a/b/c/d/e/f/g/h/element.md";

/**
 * `text` with each image link of `images` that the file has an image for pointed at its copy in the
 * image folder of `draft` (SR-095 AK2); an image that cannot be copied is a loss and keeps its link.
 * Reference-style images keep their links.
 */
const ownImages = async (
  context: Context,
  draft: Draft,
  text: string,
  images: Channels["images"],
  loss: Loss,
): Promise<string> => {
  const copies = new Map<string, string>();
  for (const { url, image } of images) {
    const link = imageLink(ANY_ELEMENT, url, () => false);
    if (link === undefined || copies.has(link.path)) {
      continue;
    }
    const read = await context.images(image);
    if (read.kind === "found") {
      const copy = `${draft.stem}/${draft.images.nameOf(read.file)}`;
      copies.set(link.path, copy);
      draft.textImages.set(copy, read.file.sha256);
    } else {
      loss(read.kind, read.reason);
    }
  }
  let out = text;
  for (const { image, destination, start, end } of markdownLinks(text).reverse()) {
    const copy = image ? copies.get(imageLink(ANY_ELEMENT, destination, () => false)?.path ?? "") : undefined;
    if (copy !== undefined) {
      out = `${out.slice(0, start)}${copy}${out.slice(end)}`;
    }
  }
  return out;
};

/** A stored scalar as text, as the export writes the title; anything else is none. */
const scalarTitle = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";

/** Takes the title, text, properties and relations of `draft` from the channels (see the file comment). */
const planOwnValues = async (
  context: Context,
  channels: Channels,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  draft: Draft,
): Promise<void> => {
  const { metamodel, keys } = context;
  const { data } = channels;
  const origin = new Set<string>(Object.values(keys));
  const loss: Loss = (code, reason) => {
    context.losses.push({ identifier: object.identifier, kind: "spec-object", id: draft.id, code, reason });
  };
  // A value of an attribute the mapping omits (this metamodel does not know it) is a loss, as on
  // the readable path; `reqseq-values` holds it too, but only the type's properties are taken.
  const given = new Set(object.values.map((v) => v.definition));
  for (const a of t.attributes) {
    const omitted = context.coverage.attributes.get(a.identifier)?.entry.property === undefined;
    if (given.has(a.identifier) && omitted && !ownOnly(metamodel, t, a)) {
      loss("omitted-attribute", `the mapping omits its attribute ${nameOf(a)}`);
    }
  }
  draft.title = scalarTitle(data[draft.base.titleKey]);
  draft.text = await ownImages(context, draft, channels.text, channels.images, loss);
  for (const key of draft.base.type.properties) {
    const value = data[key];
    if (key === draft.base.titleKey || origin.has(key) || value === undefined || value === null) {
      continue;
    }
    const relation = metamodel.properties.find((p) => p.key === key)?.kind === "relation";
    draft.properties.set(key, relation ? ownTargets(context, value) : (value as PropertyValue));
  }
  draft.ownRelations = new Map(
    metamodel.relations.flatMap((r) =>
      data[r.key] === undefined ? [] : [[r.key, ownTargets(context, data[r.key])] as const],
    ),
  );
};

/**
 * Removes each relation item of a draft planned from its channels that names an element of this
 * call the metamodel does not allow from its type (a loss `relation-not-allowed`), as `planRelation`
 * does for a SPEC-RELATION.
 */
const checkOwnRelations = (context: Context, drafts: ReadonlyMap<string, Draft>): void => {
  const { metamodel } = context;
  const byId = new Map([...drafts.values()].map((d) => [d.id, d]));
  for (const source of drafts.values()) {
    const { ownRelations } = source;
    if (ownRelations === undefined) {
      continue;
    }
    /** Whether `item` may stay: it names no element of this call, or one `target` allows. */
    const keep = (key: string, item: unknown, target: (to: Draft) => boolean): boolean => {
      const to = hasId(item) ? byId.get(item.id) : undefined;
      if (to === undefined || target(to)) {
        return true;
      }
      context.losses.push({
        identifier: source.identifier,
        kind: "spec-object",
        id: source.id,
        code: "relation-not-allowed",
        reason: `the metamodel does not allow ${key} from ${source.base.type.key} to ${to.base.type.key}`,
      });
      return false;
    };
    for (const [key, value] of ownRelations) {
      if (Array.isArray(value)) {
        ownRelations.set(
          key,
          value.filter((item) => keep(key, item, (to) => allowed(metamodel, key, source, to))),
        );
      }
    }
    for (const property of metamodel.properties.filter((p) => p.kind === "relation")) {
      const value = source.properties.get(property.key);
      const allows = (to: Draft): boolean =>
        allowsType(property["target-types"], to.base.type.key, metamodel);
      const items = itemsOf(value);
      const rest = items.filter((item) => keep(property.key, item, allows));
      if (rest.length < items.length) {
        // A removed target of a relation-valued property changes what counts to the version (D-057).
        source.relationProperties = true;
        if (rest.length > 0) {
          source.properties.set(property.key, rest as ItemValue[]);
        } else {
          source.properties.delete(property.key);
        }
      }
    }
  }
};

/** The draft of `object`, or undefined when its type is omitted (a loss). */
const planObject = async (
  context: Context,
  repository: RepositoryLocation,
  folder: string,
  object: ReqifSpecObject,
): Promise<Draft | undefined> => {
  const t = context.index.types.get(object.type);
  if (t?.category !== "spec-object") {
    throw invalidFile(
      `SPEC-OBJECT ${object.identifier} refers to type ${object.type}, which the file does not define`,
      object.line,
    );
  }
  if (context.own && object.values.length === 0) {
    // A stub of a file of ReqSeq: a target outside its export, never an element.
    return undefined;
  }
  const ownType = context.coverage.types.get(t.identifier);
  // Every object of a mapped type that is no stub has its UUID.
  const id = context.ids.get(object.identifier);
  if (ownType === undefined || id === undefined) {
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
    id,
    base,
    title: nameOf(object),
    text: "",
    properties: new Map(),
    relations: new Map(),
    version: "",
    stem: fileNameFor({ prefix: base.type.prefix, id }).slice(0, -".md".length),
    images: new ImageNames(),
    textImages: new Map(),
  };
  const channels =
    context.own && context.oneToOne.has(t.identifier) ? ownChannels(context, object, t, ownType) : undefined;
  if (channels === undefined) {
    await planValues(context, object, t, draft);
  } else {
    await planOwnValues(context, channels, object, t, draft);
  }
  draft.properties.set(keys.source, context.source);
  draft.properties.set(keys["source-identifier"], object.identifier);
  draft.properties.set(keys["import-date"], context.origin.date);
  draft.properties.set(keys.delivery, context.origin.delivery);
  // The import version is the version of the element as written (D-059); it never counts to it.
  draft.version = await plannedVersion(
    context.metamodel,
    context.layout,
    repository,
    fileOf(draft, folder, false),
    draft.textImages,
  );
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
  if (source?.ownRelations !== undefined) {
    // Its relations come from `reqseq-values` (see the file comment).
    return;
  }
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
  } else {
    const target = drafts.get(relation.target) ?? ownMissingTarget(context, relation, kind);
    if (source === undefined || target === undefined) {
      const end = source === undefined ? `source ${relation.source}` : `target ${relation.target}`;
      loss("relation-end-not-imported", `its ${end} is not imported`);
    } else {
      addRelation(context, source, kind, target, relation, loss);
    }
  }
  if (relation.values.length > 0) {
    loss(
      "omitted-attribute",
      `the values of a SPEC-RELATION are not imported: ${valueNames(context.index, relation, "SPEC-RELATION", t, relation.values)}`,
    );
  }
};

/** A target of a relation: an element of this call, or a missing one kept as stored (`ownMissingTarget`). */
type RelationEnd = Draft | { readonly id: string; readonly version: string };

/**
 * The target of a SPEC-RELATION of a file of ReqSeq that is not imported (a stub): kept to its UUID
 * with the version `reqseq-values` of the source stores for it (ADR-0013 step 4, N-041, D-058);
 * undefined in a file of another tool or without a stored version.
 */
const ownMissingTarget = (
  context: Context,
  relation: ReqifSpecRelation,
  kind: string,
): RelationEnd | undefined => {
  const stored = context.stored.get(relation.source)?.[kind];
  const item = [stored].flat().find((i) => hasId(i) && ownId.element(i.id) === relation.target);
  const version = hasId(item) ? item["version"] : undefined;
  return context.own && hasId(item) && typeof version === "string" ? { id: item.id, version } : undefined;
};

/** A value as its items: a list as it is, one value as one item, none as none. */
const itemsOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

/**
 * Why the relation or relation-valued property `kind` (`property`) must not lead from `source` to
 * `target`: undefined when it may, else the target's type (null for a target outside the file).
 */
const relationRefusal = (
  metamodel: Metamodel,
  source: Draft,
  kind: string,
  property: MetamodelProperty | undefined,
  target: RelationEnd,
): string | null | undefined => {
  const to = "base" in target ? target.base.type.key : null;
  const fits =
    to === null ||
    (property === undefined
      ? allowed(metamodel, kind, source, target as Draft)
      : allowsType(property["target-types"], to, metamodel));
  return fits && (property === undefined || source.base.type.properties.includes(kind)) ? undefined : to;
};

/** Adds the relation `kind` from `source` to `target` (see `planRelation`). */
const addRelation = (
  context: Context,
  source: Draft,
  kind: string,
  target: RelationEnd,
  relation: ReqifSpecRelation,
  loss: Loss,
): void => {
  const property = context.metamodel.properties.find((p) => p.key === kind);
  const refusal = relationRefusal(context.metamodel, source, kind, property, target);
  if (refusal !== undefined) {
    loss(
      "relation-not-allowed",
      `the metamodel does not allow ${kind} from ${source.base.type.key} to ${refusal ?? relation.target}`,
    );
    return;
  }
  const item: Record<string, ScalarValue> = {
    id: target.id,
    version: "base" in target ? "" : target.version,
  };
  if ("base" in target) {
    context.pending.set(target.id, [...(context.pending.get(target.id) ?? []), item]);
  }
  const items = itemsOf(property === undefined ? source.relations.get(kind) : source.properties.get(kind));
  if (items.some((i) => hasId(i) && i.id === target.id)) {
    loss("relation-duplicate", `${kind} to ${relation.target} is imported once already`);
  } else if (property === undefined) {
    source.relations.set(kind, [...(items as Record<string, ScalarValue>[]), item]);
  } else if (property.many !== true && items.length > 0) {
    loss("relation-duplicate", `${kind} holds one target, so ${relation.target} is not imported`);
  } else {
    // A relation-valued property can count to the version (validity, D-057).
    source.relationProperties = true;
    source.properties.set(kind, property.many === true ? [...(items as ItemValue[]), item] : item);
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

/** The SPEC-RELATIONs of `file` by source, as `<type>|<target>`. */
const relationsBySource = (file: ReqifFile): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const r of file.specRelations) {
    out.set(r.source, new Set([...(out.get(r.source) ?? []), `${r.type}|${r.target}`]));
  }
  return out;
};

/** An attribute or relation entry in a form two entries compare by. */
const entryForm = (entry: AttributeEntry | undefined): string =>
  JSON.stringify([
    entry?.omit === true || entry === undefined ? null : entry.property,
    Object.entries(entry?.values ?? {}).sort(),
    [...(entry?.["omit-values"] ?? [])].sort(),
  ]);

/**
 * The object types of a file of ReqSeq that `coverage` maps as `ownMapping` does, attribute for
 * attribute, while it also maps every relation type so: only their objects take the round-trip
 * channels, so a mapping that omits or maps otherwise is never bypassed (see the file comment).
 */
const oneToOneTypes = (
  file: ReqifFile,
  coverage: Coverage,
  metamodel: Metamodel,
  name: string,
  keys: OriginKeys,
): Set<string> => {
  const one = ownMapping(
    file,
    metamodel,
    name,
    new Set([titleKeyOrEmpty(metamodel), ...Object.values(keys)]),
  );
  const relationsAgree = one.relations.every((e) => coverage.relations.get(e.source) === e.kind);
  const attributes = new Map(one.attributes.map((e) => [e.source, e]));
  return new Set(
    file.specTypes
      .filter(
        (t) =>
          relationsAgree &&
          t.category === "spec-object" &&
          coverage.types.get(t.identifier) === one.types.find((e) => e.source === t.identifier)?.type &&
          t.attributes.every(
            (a) =>
              entryForm(coverage.attributes.get(a.identifier)?.entry) ===
              entryForm(attributes.get(a.identifier)),
          ),
      )
      .map((t) => t.identifier),
  );
};

/**
 * The versions once every relation is planned: again for a draft whose relation-valued properties
 * changed, then in every relation item that names a draft of this call (`pending`).
 */
const settleVersions = async (
  context: Context,
  drafts: ReadonlyMap<string, Draft>,
  repository: RepositoryLocation,
  relative: string,
): Promise<void> => {
  for (const draft of drafts.values()) {
    if (draft.relationProperties === true) {
      draft.version = await plannedVersion(
        context.metamodel,
        context.layout,
        repository,
        fileOf(draft, relative, false),
        draft.textImages,
      );
      draft.properties.set(context.keys["import-version"], draft.version);
    }
  }
  for (const draft of drafts.values()) {
    for (const item of context.pending.get(draft.id) ?? []) {
      item["version"] = draft.version;
    }
  }
};

/** The losses of each SPECIFICATION: its values and its hierarchy are not imported. */
const specificationLosses = (context: Context, file: ReqifFile): void => {
  const { index } = context;
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
};

/**
 * The plan of importing `file` through `mapping` as delivery `origin`, reading the images it embeds
 * with `images` (see the file comment).
 */
export const planImport = async (
  file: ReqifFile,
  mapping: AnyMapping,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  origin: ImportOrigin,
  images: ImageReader,
  own = false,
): Promise<ImportPlan> => {
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
  const ids = new Map(
    file.specObjects.flatMap((o) => {
      const mapped = coverage.types.get(o.type) !== undefined;
      return mapped && !(own && o.values.length === 0) ? [[o.identifier, randomUUID()] as const] : [];
    }),
  );
  const context: Context = {
    index,
    coverage,
    metamodel,
    losses: [],
    keys,
    source: mapping.source.name,
    origin,
    ids,
    own,
    problems: [],
    pending: new Map(),
    ownRelationsOf: own ? relationsBySource(file) : new Map(),
    stored: new Map(),
    oneToOne: own ? oneToOneTypes(file, coverage, metamodel, mapping.source.name, keys) : new Set(),
    images,
    layout,
  };
  const drafts = new Map<string, Draft>();
  for (const object of file.specObjects) {
    const draft = await planObject(context, repository, relative, object);
    if (draft !== undefined) {
      drafts.set(object.identifier, draft);
    }
  }
  checkOwnRelations(context, drafts);
  for (const relation of file.specRelations) {
    planRelation(context, drafts, relation);
  }
  await settleVersions(context, drafts, repository, relative);
  specificationLosses(context, file);
  unreadLosses(file, drafts, context.losses);
  const all = [...drafts.values()];
  return {
    repository,
    folder: relative,
    files: all.map((d) => fileOf(d, relative, true)),
    images: all.flatMap((d) => d.images.files.map(({ name, file }) => ({ stem: d.stem, name, file }))),
    created: all.map((d) => ({ identifier: d.identifier, id: d.id })),
    losses: context.losses,
    problems: context.problems,
  };
};
