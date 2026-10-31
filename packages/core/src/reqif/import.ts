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
// - A repeated delivery (SR-056, `repeat.ts`): an object whose element an earlier delivery made
//   (same source and source IDENTIFIER) keeps that element, its UUID and its file. Its planned
//   version P (the file with the delivery's fields, `editElementFile`) is compared with the stored
//   import version I and the current version C: *changed* when P differs from I, a *conflict* when
//   C differs from both; changed only locally (P = I, C differs) leaves it as it is (#575/1), and
//   with neither changed it is written only when its mapped fields or relations differ from the
//   file, with a `reqif.replaces-local` warning (#575/3, #575/4). A conflict needs `take` or `keep`
//   (`reqif.conflict` otherwise); `keep` writes only the origin with P as import version (#575/6).
//   Relations to such an element carry P when the delivery is written into it, else C.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CommandError } from "../catalog.js";
import type { FileEditResult, FrontmatterEdit, PropertyValue } from "../files/index.js";
import { bodyForText, editElementFile } from "../files/index.js";
import type {
  MetamodelProperty,
  Problem,
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
import type { ElementFileWrite } from "../model/write.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { locate } from "../workspace/index.js";
import type { AnyMapping } from "./mapping.js";
import type { ExistingElement, ExistingElements, RelationItem } from "./repeat.js";
import { NO_EXISTING, relationEdits, targetsDiffer } from "./repeat.js";
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
import type { ImageFile, ImageReader } from "./images.js";
import { ImageNames } from "./images.js";
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
  /** The writes into elements of an earlier delivery (SR-056): from the delivery (update, take) or only the origin (keep). */
  readonly updates: readonly PlannedUpdate[];
  /** The copies of the images the texts of updated elements embed, into each one's image folder. */
  readonly updateImages: readonly PlannedUpdateImage[];
  /** Every element the delivery changes (SR-056 AK1), conflicts included. */
  readonly changed: readonly ReqifObject[];
  /** The changed elements that were also changed locally (SR-056 AK4). */
  readonly conflicts: readonly ReqifObject[];
  /** The elements of the source the delivery no longer has (SR-056 AK3). */
  readonly dropped: readonly ReqifObject[];
  /** Warnings: `reqif.replaces-local`, `reqif.choice-unused`. */
  readonly problems: readonly Problem[];
}

/** A write into an element of an earlier delivery. */
export interface PlannedUpdate {
  readonly identifier: string;
  readonly id: string;
  readonly kind: "updated" | "kept";
  readonly write: ElementFileWrite;
}

/** A copy of an image into the image folder of an updated element. */
export interface PlannedUpdateImage {
  readonly repository: RepositoryLocation;
  /** Relative to the repository, `/` as separator. */
  readonly file: string;
  readonly name: string;
  readonly image: ImageFile;
}

/** `take` or `keep` for each conflict, by source IDENTIFIER. */
export type ConflictChoices = ReadonlyMap<string, "take" | "keep">;

/** What a repeated delivery adds to the plan: the elements of the source and, for an import, the choices. */
export interface RepeatOptions {
  readonly existing: ExistingElements;
  /**
   * The choice for each conflict, with the warnings for entries that name none; undefined for a
   * preview (`reqif.analyze`), which lists the conflicts instead of refusing.
   */
  readonly choose?: (conflicts: readonly ReqifObject[]) => {
    readonly choices: ConflictChoices;
    readonly problems: readonly Problem[];
  };
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
  /** The index of the mapping entry of each mapped SPEC-OBJECT-TYPE. */
  readonly typeEntries: Map<string, number>;
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

/** One element being planned. */
interface Draft {
  readonly identifier: string;
  readonly id: string;
  readonly base: NewElementBase;
  title: string;
  text: string;
  readonly properties: Map<string, PropertyValue>;
  readonly relations: Map<string, RelationItem[]>;
  /** The planned version (`plannedVersion`), set once the values are planned. */
  version: string;
  /** The workspace name of its repository. */
  readonly repository: string;
  /** The element of an earlier delivery it updates (SR-056). */
  readonly existing?: ExistingElement;
  /** Its current version (C) when it is such an element, else empty. */
  readonly current: string;
  /** The property keys the mapping maps for its type (removed when the delivery has no value). */
  readonly mapped: readonly string[];
  /** Those of them that do not count to the version (D-057). */
  readonly uncounted: readonly string[];
  /** What the repeated delivery does with an existing element; `new` for a new one. */
  case: "new" | "update" | "conflict" | "local" | "same";
  /** Whether the delivery's content is written (new, update, take, same); else relations get its current version. */
  deliveryWins: boolean;
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
 * they read back as written; elsewhere they stay plain.
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
  return target === "plain" ? texts : texts.map(markdownText);
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
  readonly images: ImageReader;
  readonly layout: WorkspaceLayout;
  readonly mapping: AnyMapping;
  readonly existing: ExistingElements;
}

/** The version a relation to `draft` carries: P when the delivery is written into it, else its current one (C). */
const targetVersion = (draft: Draft): string => (draft.deliveryWins ? draft.version : draft.current);

/**
 * The file of an existing element with the delivery's title, text, mapped properties and origin
 * (`omit`: origin keys left as they are), plus `extra` edits; only changed keys are rewritten.
 */
const updatedFile = (
  draft: Draft,
  existing: ExistingElement,
  extra: readonly FrontmatterEdit[],
  omit: readonly string[] = [],
): FileEditResult => {
  const { file } = existing.current;
  const removed = draft.mapped.filter((key) => !draft.properties.has(key));
  return editElementFile(file, {
    edits: [
      { kind: "set", key: draft.base.titleKey, value: draft.title },
      ...[...draft.properties]
        .filter(([key]) => !omit.includes(key))
        .map(([key, value]): FrontmatterEdit => ({ kind: "set", key, value })),
      ...removed
        .filter((key) => existing.record.data[key] !== undefined)
        .map((key): FrontmatterEdit => ({ kind: "remove", key })),
      ...extra,
    ],
    body: bodyForText(file.body, draft.text),
    keyOrder: draft.base.type.properties,
  });
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
      loss("omitted-attribute", `the mapping omits its attribute ${nameOf(a)}`);
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

/**
 * The element of an earlier delivery `object` updates (SR-056), refused when the mapping now gives
 * it another type or it has no current version.
 */
const matchedElement = (
  context: Context,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  ownType: string,
): ExistingElement | undefined => {
  const existing = context.existing.matched.get(object.identifier);
  if (existing === undefined) {
    return undefined;
  }
  const { record } = existing;
  if (record.type !== ownType) {
    const at = context.coverage.typeEntries.get(t.identifier);
    throw new CommandError(
      "input.invalid",
      `Not imported: ${object.identifier} is ${record.file} of type ${record.type}, which an import does not change to ${ownType}`,
      { fields: [`mapping.types[${String(at)}].type`], identifier: object.identifier, id: record.id },
    );
  }
  if (existing.version === undefined) {
    throw new CommandError(
      "input.invalid",
      `Not imported: ${record.file} (${object.identifier}) has no current version, so a local change cannot be told: ${String(existing.unknown)}`,
      { id: record.id, identifier: object.identifier, file: record.file, reason: "no-version" },
    );
  }
  return existing;
};

/** The empty draft of `object`: a new element, or the element of an earlier delivery with its UUID, file name and images. */
const draftOf = (
  context: Context,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  base: NewElementBase,
  existing: ExistingElement | undefined,
  repository: RepositoryLocation,
): Draft => {
  const id = existing?.record.id ?? randomUUID();
  const images = new ImageNames();
  for (const { name, sha256 } of existing?.images ?? []) {
    images.reserve(name, sha256);
  }
  // The property each attribute of the type is mapped to, when it is one (not title, text or omitted).
  const mapped = t.attributes.flatMap((a) => {
    const definition = context.coverage.attributes.get(a.identifier)?.definition;
    return definition === undefined ? [] : [definition];
  });
  const file =
    existing === undefined
      ? fileNameFor({ prefix: base.type.prefix, id })
      : path.posix.basename(existing.record.file);
  return {
    identifier: object.identifier,
    id,
    base,
    title: nameOf(object),
    text: "",
    properties: new Map(),
    relations: new Map(),
    version: "",
    stem: file.slice(0, -".md".length),
    images,
    textImages: new Map(),
    repository: existing?.record.repository ?? repository.name,
    ...(existing === undefined ? {} : { existing }),
    current: existing === undefined ? "" : String(existing.version),
    mapped: mapped.map((d) => d.key),
    uncounted: mapped.filter((d) => d.content !== true).map((d) => d.key),
    case: "new",
    deliveryWins: true,
  };
};

/** What the delivery does with an existing element of planned version `planned` (P), by I and C. */
const caseOf = (planned: string, existing: ExistingElement): Draft["case"] => {
  // matchedElement refused an element without current version.
  const current = existing.version;
  if (planned === existing.imported) {
    return current === existing.imported ? "same" : "local";
  }
  // The same result on both sides is no conflict (#575/2).
  return current !== existing.imported && current !== planned ? "conflict" : "update";
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
  const existing = matchedElement(context, object, t, ownType);
  const draft = draftOf(context, object, t, base, existing, repository);
  await planValues(context, object, t, draft);
  draft.properties.set(keys.source, context.source);
  draft.properties.set(keys["source-identifier"], object.identifier);
  draft.properties.set(keys["import-date"], context.origin.date);
  draft.properties.set(keys.delivery, context.origin.delivery);
  // The import version is the version of the element as written (D-059); it never counts to it.
  draft.version = await plannedVersion(
    context.metamodel,
    context.layout,
    existing?.repository ?? repository,
    existing === undefined
      ? fileOf(draft, folder, false)
      : { file: existing.record.file, bytes: updatedFile(draft, existing, []).bytes },
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
      // A target in another repository names it (ADR-0004, D-058).
      items.push({
        id: target.id,
        version: targetVersion(target),
        ...(target.repository === source.repository ? {} : { repository: target.repository }),
      });
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
  repeat: RepeatOptions = { existing: NO_EXISTING },
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
  const context: Context = {
    index,
    coverage,
    metamodel,
    losses: [],
    keys,
    source: mapping.source.name,
    origin,
    images,
    layout,
    mapping,
    existing: repeat.existing,
  };
  const drafts = new Map<string, Draft>();
  for (const object of file.specObjects) {
    const draft = await planObject(context, repository, relative, object);
    if (draft !== undefined) {
      drafts.set(object.identifier, draft);
    }
  }
  const { changed, conflicts, problems, choices } = classify(drafts, repeat);
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
  const all = [...drafts.values()].filter((d) => d.existing === undefined);
  const updates = planUpdates(context, drafts, choices, problems);
  return {
    repository,
    folder: relative,
    files: all.map((d) => fileOf(d, relative, true)),
    images: all.flatMap((d) => d.images.files.map(({ name, file }) => ({ stem: d.stem, name, file }))),
    created: all.map((d) => ({ identifier: d.identifier, id: d.id })),
    losses: context.losses,
    ...updates,
    changed,
    conflicts,
    dropped: repeat.existing.dropped,
    problems,
  };
};

/**
 * Sorts the drafts of existing elements by P, I and C (see the file comment) and, for an import,
 * takes the choices for the conflicts: `reqif.conflict` names those without one.
 */
const classify = (
  drafts: ReadonlyMap<string, Draft>,
  repeat: RepeatOptions,
): {
  readonly changed: ReqifObject[];
  readonly conflicts: ReqifObject[];
  readonly problems: Problem[];
  readonly choices: ConflictChoices;
} => {
  const changed: ReqifObject[] = [];
  const conflicts: ReqifObject[] = [];
  for (const draft of drafts.values()) {
    const { existing } = draft;
    if (existing === undefined) {
      continue;
    }
    const object = { identifier: draft.identifier, id: draft.id };
    draft.case = caseOf(draft.version, existing);
    if (draft.case === "update" || draft.case === "conflict") {
      changed.push(object);
    }
    if (draft.case === "conflict") {
      conflicts.push(object);
    }
  }
  const chosen = repeat.choose?.(conflicts) ?? { choices: new Map<string, "take" | "keep">(), problems: [] };
  if (repeat.choose !== undefined) {
    const missing = conflicts.filter((c) => !chosen.choices.has(c.identifier));
    if (missing.length > 0) {
      throw new CommandError(
        "reqif.conflict",
        `Not imported: ${missing.map((c) => c.identifier).join(", ")} changed locally and in the delivery; name each in take or keep`,
        { conflicts: missing },
      );
    }
  }
  for (const draft of drafts.values()) {
    draft.deliveryWins =
      draft.case === "conflict" ? chosen.choices.get(draft.identifier) === "take" : draft.case !== "local";
  }
  return { changed, conflicts, problems: [...chosen.problems], choices: chosen.choices };
};

/**
 * The writes into existing elements and the image copies they need: the delivery for update, take
 * and same (only when the file would differ apart from delivery and import date, with a
 * `reqif.replaces-local` warning naming the keys), the origin alone for keep, nothing for an
 * element changed only locally.
 */
const planUpdates = (
  context: Context,
  drafts: ReadonlyMap<string, Draft>,
  choices: ConflictChoices,
  problems: Problem[],
): Pick<ImportPlan, "updates" | "updateImages"> => {
  const { keys } = context;
  const kinds = [
    ...new Set([...context.coverage.relations.values()].flatMap((k) => (k === undefined ? [] : [k]))),
  ];
  const updates: PlannedUpdate[] = [];
  const updateImages: PlannedUpdateImage[] = [];
  for (const draft of drafts.values()) {
    const { existing } = draft;
    if (existing === undefined) {
      continue;
    }
    const { identifier, id } = draft;
    const write = (kind: PlannedUpdate["kind"], bytes: Uint8Array): void => {
      updates.push({ identifier, id, kind, write: { ...existing, bytes } });
    };
    if (draft.case === "conflict" && choices.get(identifier) === "keep") {
      const origin = [keys["import-version"], keys.delivery, keys["import-date"]];
      const edits = origin.map((key): FrontmatterEdit => ({
        kind: "set",
        key,
        // The planner set every origin key to text.
        value: draft.properties.get(key) as string,
      }));
      write(
        "kept",
        editElementFile(existing.current.file, { edits, keyOrder: draft.base.type.properties }).bytes,
      );
      continue;
    }
    if (!draft.deliveryWins) {
      continue;
    }
    const { data } = existing.record;
    const relations = kinds.map((kind) => {
      const items = draft.relations.get(kind) ?? [];
      return {
        kind,
        edits: relationEdits(data, kind, items, context.existing.ids),
        targets: targetsDiffer(data, kind, items, context.existing.ids),
      };
    });
    const extra = relations.flatMap((r) => r.edits);
    if (
      draft.case === "same" &&
      !updatedFile(draft, existing, extra, [keys.delivery, keys["import-date"]]).changed
    ) {
      continue;
    }
    // What the file holds otherwise and the version cannot show (#575/4): the title, mapped
    // properties that do not count, and relation targets; a new version of a target alone is silent.
    const replaced = [
      ...(data[draft.base.titleKey] === draft.title ? [] : [draft.base.titleKey]),
      ...draft.uncounted.filter((key) => !isDeepStrictEqual(data[key], draft.properties.get(key))),
      ...relations.filter((r) => r.targets).map((r) => r.kind),
    ];
    if (replaced.length > 0) {
      problems.push({
        code: "reqif.replaces-local",
        severity: "warning",
        message: `${identifier}: the delivery writes ${replaced.join(", ")} into ${existing.record.file}, which holds other values there`,
        repository: existing.record.repository,
        file: existing.record.file,
        elementId: id,
      });
    }
    write("updated", updatedFile(draft, existing, extra).bytes);
    const folder = path.posix.dirname(existing.record.file);
    for (const { name, file } of draft.images.files) {
      updateImages.push({
        repository: existing.repository,
        file: path.posix.join(folder, draft.stem, name),
        name,
        image: file,
      });
    }
  }
  return { updates, updateImages };
};
