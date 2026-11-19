// The plan of `reqif.export` with `sourceModel` (SR-158, ADR-0013 "Export"): the elements of a source
// written in the source's own model, which the imports stored in the mapping (`source-model`,
// source-model.ts). Pure: the command picks the elements, reads their texts and writes the file.
//
// - Header: `_hd-<uuid>`, TITLE the workspace name, REQ-IF-TOOL-ID `reqseq-source-model`,
//   SOURCE-TOOL-ID `ReqSeq <version>`; no `reqseq-markdown` or `reqseq-values` (#1835).
// - Types (AK1, #1835): for each exported element the stored SPEC-OBJECT-TYPE whose `types` entry maps
//   to its own type, with all its stored attributes and the datatypes these use, every facet and
//   IDENTIFIER and LONG-NAME as stored. A SPEC-OBJECT per element, IDENTIFIER its source IDENTIFIER,
//   without LONG-NAME; one flat SPECIFICATION `_sp-<hash>` of SPEC-HIERARCHYs `_sh-<uuid>`; no
//   SPEC-RELATION (AK6).
// - Values without statements (AK6): in each attribute the mapping (`attributes`, one with
//   `source-type` first) maps to the title, the text or a property, that value; an omitted property
//   (SR-059 AK1) or an empty value has none. With statements (AK3): only the statement, in the
//   attribute `statement.attribute` names (LONG-NAME or IDENTIFIER); `statement.datatype` is not
//   used. An element without one is counted; a STRING, XHTML or ENUMERATION attribute gets an empty
//   value, the others none.
// - Values by the source's datatype, the reverse of the import: a number into INTEGER or REAL, a
//   date into DATE `T00:00:00Z`, a choice into ENUMERATION by `values` (with statements, only the
//   `values` of an entry of the statement property; several source values for one choice: the
//   first in the mapping's order, one warning `reqif.source-value-chosen` per item, #1835); a choice
//   (by its name), number or date into STRING or XHTML as text, and with statements a list joined
//   by `, ` (SR-058 AK1); the title, the text and a text property into any datatype: STRING as plain
//   text (Markdown as its text), XHTML from Markdown (`markdownToXhtml`, image links as written,
//   #1835) or plain text as one `div`, INTEGER, REAL (INF, -INF, NaN too) and DATE (a day, or an
//   xs:dateTime as the import keeps it) in the lexical form the import reads, BOOLEAN `true` or
//   `false`, ENUMERATION by the LONG-NAME or IDENTIFIER of a value, or of each of the values a
//   multi-valued attribute joins with `, `. MIN and MAX compare two integers exactly.
// - Refusals (AK7, #1886), all collected, then one `input.invalid` naming each requirement with
//   attribute or type, and nothing written: several stored types mapped to one own type; without
//   statements, several attributes of a type mapped to one title, text or property; a value that does
//   not fit its attribute (a STRING longer than MAX-LENGTH, a number outside MIN and MAX, a value no
//   enumeration value is mapped to or named by, a text not in the lexical form of its datatype, a
//   fraction into INTEGER, several values into a single-valued attribute, a value of a kind the
//   datatype cannot hold); a type without the statement attribute, or with several that match it,
//   for each of its requirements. The message names the first five reasons, `details.refusals` all. Not
//   refused: an empty value, ACCURACY of a REAL, and what is not written (omitted properties; with
//   statements, the other values).
// - Refused at once (`input.invalid`): an element whose own type no stored type maps to.
import { createHash } from "node:crypto";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { ReqifMappingFile } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { criterionText } from "../model/criterion-items.js";
import type { ElementRecord } from "../model/index.js";
import { titleKeyOrEmpty } from "../model/index.js";
import { XHTML_NAMESPACE } from "./model.js";
import type { SourceModel } from "./source-model.js";
import { entryOf } from "./source-model.js";
import type { ReqifWritable } from "./write.js";
import { markdownToXhtml } from "./xhtml-markdown.js";
import { xhtmlText } from "./xhtml-text.js";
import { DATE_TIME, LEXICAL, dayTime } from "./import-values.js";

/** REQ-IF-TOOL-ID of a file in the source's model (#1835). */
export const SOURCE_MODEL_TOOL_ID = "reqseq-source-model";

/** One element to export: its record, its text, its source IDENTIFIER and its short ID for messages. */
export interface SourceElement {
  readonly record: ElementRecord;
  readonly text: string;
  readonly identifier: string;
  readonly shortId: string;
}

export interface SourceExportInput {
  readonly metamodel: Metamodel;
  readonly mapping: ReqifMappingFile;
  /** The mapping's `source-model`. */
  readonly model: SourceModel;
  readonly title: string;
  readonly time: string;
  readonly header: string;
  readonly sourceToolId: string;
  /** In the order of the list. */
  readonly elements: readonly SourceElement[];
  /** The property keys left out (SR-059 AK1). */
  readonly omit: ReadonlySet<string>;
  /** With statements: the mapping's `statement`. */
  readonly statement: NonNullable<ReqifMappingFile["statement"]> | undefined;
}

export interface SourceExportPlan {
  readonly file: ReqifWritable;
  readonly withoutStatement: number;
  readonly problems: readonly Problem[];
}

type SourceType = SourceModel["types"][number];
type SourceAttribute = SourceType["attributes"][number];
type SourceDatatype = SourceModel["datatypes"][number];
type AttributeEntry = NonNullable<ReqifMappingFile["attributes"]>[number];
type Value = ReqifWritable["specObjects"][number]["values"][number];
interface Named {
  readonly identifier: string;
  readonly "long-name"?: string;
}

const COMMAND = "reqif.export";
const nameOf = (item: Named): string => item["long-name"] ?? item.identifier;
const matches = (source: string, item: Named): boolean =>
  source === item.identifier || source === item["long-name"];

/** Code points: a surrogate pair is one character, as MAX-LENGTH counts. */
const characters = (text: string): number => text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;

/** The mapping entry of attribute `a` of stored type `t`, one with `source-type` first (as the import). */
const attributeEntry = (
  mapping: ReqifMappingFile,
  t: SourceType,
  a: SourceAttribute,
): AttributeEntry | undefined => {
  const named = (mapping.attributes ?? []).filter((entry) => matches(entry.source, a));
  return (
    named.find((entry) => entry["source-type"] !== undefined && matches(entry["source-type"], t)) ??
    named.find((entry) => entry["source-type"] === undefined)
  );
};

/** An own value as the export reads it: what it is, its items as stored and as text (none: empty). */
interface Own {
  readonly kind: "markdown" | "plain" | "number" | "date" | "choice" | "relation";
  /** As stored: a choice by its key, Markdown as written. */
  readonly items: readonly string[];
  /** As text: a choice by its name, Markdown as its plain text (the reverse of the import's `markdownText`). */
  readonly texts: readonly string[];
  /** Each item with its text. */
  readonly pairs: readonly { readonly item: string; readonly text: string }[];
}

/** The kind of a value of each property kind but text. */
const KINDS: Readonly<Record<string, Own["kind"]>> = {
  number: "number",
  date: "date",
  choice: "choice",
  relation: "relation",
};

/** An image link stays as the text has it (#1835). */
const asWritten = (url: string): string => url;

/** The plain text of Markdown `markdown`. */
const plainOf = (markdown: string): string =>
  xhtmlText([markdownToXhtml(markdown, { image: asWritten }).value]).text;

/** An own value of `kind` with `items` and the text `textOf` gives each. */
const own = (kind: Own["kind"], items: readonly string[], textOf: (item: string) => string): Own => {
  const pairs = items.map((item) => ({ item, text: textOf(item) }));
  return { kind, items, texts: pairs.map((p) => p.text), pairs };
};

/** The own value of `field` (`title`, `text` or a property key) of `element` (see the file comment). */
const ownValue = (metamodel: Metamodel, element: SourceElement, field: string): Own => {
  if (field === "text") {
    return own("markdown", element.text === "" ? [] : [element.text], plainOf);
  }
  const key = field === "title" ? titleKeyOrEmpty(metamodel) : field;
  // checkMapping found the property in the metamodel; the title is a plain text property.
  const definition = metamodel.properties.find((p) => p.key === key);
  const value = element.record.data[key];
  const list = (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]).map(
    criterionText,
  );
  // A relation item is an object, which no datatype holds (`holds`).
  const items = list.map(String).filter((text) => text !== "");
  const kind = definition?.markdown === true ? "markdown" : (KINDS[String(definition?.kind)] ?? "plain");
  const names = new Map((definition?.choices ?? []).map((c) => [c.key, c.name]));
  return own(kind, items, (item) => (kind === "markdown" ? plainOf(item) : (names.get(item) ?? item)));
};

/** What a value becomes in a source attribute: its value and warnings, or why it does not fit. */
type Converted =
  { readonly value: Value; readonly warnings: readonly string[] } | { readonly refusal: string };

/** Whether `text` is of the lexical form of xs:integer or xs:double (`kind`), as the import reads it. */
const lexical = (kind: "integer" | "real", text: string): boolean => LEXICAL[kind]?.test(text) === true;

/** `text` of the lexical form of xs:double as a number (INF and -INF as infinities, NaN as NaN). */
const numberOf = (text: string): number => Number(text.replace(/INF$/, "Infinity"));

/** Whether `value` is less than `bound`: exactly for two integers, else as numbers. */
const less = (value: string, bound: string): boolean =>
  lexical("integer", value) && lexical("integer", bound)
    ? BigInt(value) < BigInt(bound)
    : numberOf(value) < numberOf(bound);

/** Why the number `text` lies outside MIN and MAX of `d`, if it does. */
const outside = (text: string, d: SourceDatatype): string | undefined => {
  if (d.min !== undefined && less(text, d.min)) {
    return `${text} is smaller than ${d.min}, the MIN of ${nameOf(d)}`;
  }
  return d.max !== undefined && less(d.max, text)
    ? `${text} is greater than ${d.max}, the MAX of ${nameOf(d)}`
    : undefined;
};

/** The values of `d` that `name` names by IDENTIFIER or LONG-NAME. */
const valuesNamed = (d: SourceDatatype, name: string): NonNullable<SourceDatatype["values"]> =>
  (d.values ?? []).filter((v) => matches(name, v));

/**
 * The enumeration values of one own item: a choice through the `values` of `entry`, in the mapping's
 * order, each value once; a text by the name of a value or, for a multi-valued attribute, by the
 * names it joins with `, ` (as the import joins them for a single-valued text property).
 */
const itemValues = (
  kind: Own["kind"],
  { item, text }: { readonly item: string; readonly text: string },
  a: SourceAttribute,
  d: SourceDatatype,
  entry: AttributeEntry | undefined,
): NonNullable<SourceDatatype["values"]> => {
  if (kind === "choice") {
    const sources = Object.entries({ ...entry?.values }).flatMap(([source, key]) =>
      key === item ? [source] : [],
    );
    const found = sources.flatMap((source) => valuesNamed(d, source));
    return found.filter((v, at) => found.findIndex((w) => w.identifier === v.identifier) === at);
  }
  const whole = valuesNamed(d, text).slice(0, 1);
  const parts = text.split(", ").map((part) => valuesNamed(d, part).slice(0, 1));
  return whole.length > 0 || a["multi-valued"] !== true || parts.some((p) => p.length === 0)
    ? whole
    : parts.flat();
};

/** `own` as an ENUMERATION value of attribute `a` of `d` through `entry` (see the file comment). */
const enumerationValue = (
  own: Own,
  a: SourceAttribute,
  d: SourceDatatype,
  entry: AttributeEntry | undefined,
): Converted => {
  const refs = new Set<string>();
  const warnings: string[] = [];
  for (const pair of own.pairs) {
    // A choice is named by its key, which `values` maps; a text as it is.
    const text = own.kind === "choice" ? pair.item : pair.text;
    const found = itemValues(own.kind, pair, a, d, entry);
    const [first] = found;
    if (first === undefined) {
      return { refusal: `${text} is mapped to no value of ${nameOf(d)}` };
    }
    if (own.kind === "choice" && found.length > 1) {
      warnings.push(
        `choice ${text} is mapped to several values of ${nameOf(d)}; ${nameOf(first)} is written`,
      );
    }
    for (const v of own.kind === "choice" ? [first] : found) {
      refs.add(v.identifier);
    }
  }
  if (refs.size > 1 && a["multi-valued"] !== true) {
    return { refusal: `${String(refs.size)} values do not fit the single-valued ${nameOf(a)}` };
  }
  return { value: { kind: "enumeration", definition: a.identifier, values: [...refs] }, warnings };
};

/**
 * Whether an own value of `kind` fits datatype `d`: the reverse of the import's `holds`, and a
 * choice, number or date into STRING or XHTML as its text (as the import takes every datatype into a
 * text property).
 */
const holds = (kind: Own["kind"], d: SourceDatatype): boolean => {
  const text = d.kind === "string" || d.kind === "xhtml";
  switch (kind) {
    case "number":
      return text || d.kind === "integer" || d.kind === "real";
    case "date":
      return text || d.kind === "date";
    case "choice":
      return text || d.kind === "enumeration";
    case "relation":
      return false;
    case "markdown":
    case "plain":
      return true;
  }
};

/** An XHTML value of `definition`: one `div` with `children`. */
const div = (definition: string, children: readonly string[]): Value => ({
  kind: "xhtml",
  definition,
  value: [{ name: "div", namespace: XHTML_NAMESPACE, attributes: [], children }],
});

/**
 * `own` as a value of attribute `a` of datatype `d` (see the file comment); `joined`: several items
 * of a statement go into STRING or XHTML as one text joined by `, ` (SR-058 AK1).
 */
const converted = (
  own: Own,
  a: SourceAttribute,
  d: SourceDatatype,
  entry: AttributeEntry | undefined,
  joined: boolean,
): Converted => {
  const definition = a.identifier;
  const kind = d.kind.toUpperCase();
  if (!holds(own.kind, d)) {
    return { refusal: `a ${own.kind} value does not fit ${kind} ${nameOf(d)}` };
  }
  const datatype = d.kind;
  if (datatype === "enumeration") {
    return enumerationValue(own, a, d, entry);
  }
  const text = datatype === "string" || datatype === "xhtml" ? joined : false;
  if (own.items.length > 1 && !text) {
    return { refusal: `${String(own.items.length)} values do not fit ${kind} ${nameOf(d)}, which holds one` };
  }
  const markdown = own.kind === "markdown" && own.items.length === 1;
  if (datatype === "xhtml") {
    const value = markdown
      ? {
          kind: "xhtml" as const,
          definition,
          value: own.items.map((item) => markdownToXhtml(item, { image: asWritten }).value),
        }
      : div(definition, [own.texts.join(", ")]);
    return { value, warnings: [] };
  }
  return scalarValue(own.texts.join(", "), a, d, datatype);
};

/** The time of a DATE `text` as written (`YYYY-MM-DD` alone at midnight UTC), if it names a day. */
const dateTimeOf = (text: string): string | undefined =>
  DATE_TIME.test(text) && dayTime(text.slice(0, 10)) !== undefined
    ? text.length === 10
      ? `${text}T00:00:00Z`
      : text
    : undefined;

/** The plain text `text` as a value of attribute `a` of a STRING, INTEGER, REAL, DATE or BOOLEAN `d`. */
const scalarValue = (
  raw: string,
  a: SourceAttribute,
  d: SourceDatatype,
  datatype: "string" | "integer" | "real" | "date" | "boolean",
): Converted => {
  const definition = a.identifier;
  const kind = datatype.toUpperCase();
  const text = datatype === "string" ? raw : raw.trim();
  const ok = (value: string): Converted => ({ value: { kind: datatype, definition, value }, warnings: [] });
  switch (datatype) {
    case "string": {
      const max = Number(d["max-length"]);
      return characters(text) > max
        ? {
            refusal: `${String(characters(text))} characters are longer than ${String(max)}, the MAX-LENGTH of ${nameOf(d)}`,
          }
        : ok(text);
    }
    case "integer":
    case "real": {
      const fits = lexical(datatype, text);
      const why = fits ? outside(text, d) : `${text} is no ${kind} of ${nameOf(d)}`;
      return why === undefined ? ok(text) : { refusal: why };
    }
    case "date": {
      const time = dateTimeOf(text);
      return time === undefined ? { refusal: `${text} is no DATE of ${nameOf(d)}` } : ok(time);
    }
    case "boolean":
      return text === "true" || text === "false"
        ? ok(text)
        : { refusal: `${text} is no BOOLEAN of ${nameOf(d)}` };
  }
};

/** The value of attribute `a` of `d` for an element without a statement, if it gets one. */
const emptyValue = (a: SourceAttribute, d: SourceDatatype): Value[] => {
  const definition = a.identifier;
  switch (d.kind) {
    case "string":
      return [{ kind: "string", definition, value: "" }];
    case "xhtml":
      return [div(definition, [])];
    case "enumeration":
      return [{ kind: "enumeration", definition, values: [] }];
    case "integer":
    case "real":
    case "date":
    case "boolean":
      return [];
  }
};

/** At most this many reasons are in the message; `details.refusals` has all. */
const SHOWN = 5;

/** The refusals found: each reason with the requirements it concerns, in the order found. */
const refusalError = (refusals: ReadonlyMap<string, ReadonlySet<string>>): CommandError => {
  const all = [...refusals].map(([reason, ids]) => ({ requirements: [...ids], reason }));
  const shown = all
    .slice(0, SHOWN)
    .map(({ requirements, reason }) => `${requirements.join(", ")}: ${reason}`);
  const more = all.length > SHOWN ? `; and ${String(all.length - SHOWN)} more` : "";
  return new CommandError("input.invalid", `Not exported in the source's model: ${shown.join("; ")}${more}`, {
    command: COMMAND,
    fields: ["mapping"],
    refusals: all,
  });
};

/** An attribute of a stored type with its datatype; readMappingFile made sure the model defines it. */
interface Typed {
  readonly a: SourceAttribute;
  readonly d: SourceDatatype;
}

/** The attributes of `t` with their datatypes, in order. */
const typed = (model: SourceModel, t: SourceType): Typed[] =>
  t.attributes.flatMap((a) =>
    model.datatypes
      .filter((d) => d.identifier === a.datatype)
      .slice(0, 1)
      .map((d) => ({ a, d })),
  );

/** What the values of one element take. */
interface ObjectInput {
  readonly input: SourceExportInput;
  readonly element: SourceElement;
  readonly t: SourceType;
  readonly refuse: (reason: string) => void;
  readonly problems: Problem[];
}

/** The values of `element` in stored type `t`, and whether it lacks a statement (see the file comment). */
const objectValues = ({
  input,
  element,
  t,
  refuse,
  problems,
}: ObjectInput): { values: Value[]; without: boolean } => {
  const { metamodel, mapping, model, omit, statement } = input;
  const values: Value[] = [];
  let without = false;
  const write = (field: string, { a, d }: Typed, entry: AttributeEntry | undefined): void => {
    const own = ownValue(metamodel, element, field);
    if (own.items.length === 0) {
      without = statement !== undefined;
      values.push(...(without ? emptyValue(a, d) : []));
      return;
    }
    const result = converted(own, a, d, entry, statement !== undefined);
    if ("refusal" in result) {
      refuse(`${nameOf(a)} of ${nameOf(t)}: ${result.refusal}`);
      return;
    }
    values.push(result.value);
    problems.push(
      ...result.warnings.map((warning) => ({
        code: "reqif.source-value-chosen" as const,
        severity: "warning" as const,
        message: `${element.shortId}: ${nameOf(a)}: ${warning}`,
      })),
    );
  };
  const attributes = typed(model, t);
  if (statement !== undefined) {
    const found = attributes.filter(({ a }) => matches(statement.attribute, a));
    if (found.length === 1) {
      // A choice takes the `values` of an entry of the statement property only.
      for (const x of found) {
        const entry = attributeEntry(mapping, t, x.a);
        write(statement.property, x, entry?.property === statement.property ? entry : undefined);
      }
    } else {
      refuse(
        found.length === 0
          ? `${nameOf(t)} of the source has no attribute ${statement.attribute} for the statement`
          : `attributes ${found.map((x) => x.a.identifier).join(", ")} of ${nameOf(t)} all match ${statement.attribute}, the attribute of the statement`,
      );
    }
    return { values, without };
  }
  const mapped = attributes.flatMap((x) => {
    const entry = attributeEntry(mapping, t, x.a);
    return entry?.property === undefined ? [] : [{ x, entry, field: entry.property }];
  });
  for (const { field } of mapped) {
    const same = mapped.filter((m) => m.field === field);
    if (same.length > 1) {
      refuse(`attributes ${same.map((m) => nameOf(m.x.a)).join(", ")} of ${nameOf(t)} all map to ${field}`);
    }
  }
  const titleKey = titleKeyOrEmpty(metamodel);
  for (const { x, entry, field } of mapped) {
    if (!omit.has(field === "title" ? titleKey : field)) {
      write(field, x, entry);
    }
  }
  return { values, without };
};

/** The ReqIF model of `input.elements` in the source's model (see the file comment). */
export const planSourceExport = (input: SourceExportInput): SourceExportPlan => {
  const { mapping, model, time: lastChange } = input;
  const typesOf = (own: string): SourceType[] =>
    model.types.filter((t) => mapping.types?.[entryOf(mapping, t)]?.type === own);
  const unmapped = input.elements.filter((e) => typesOf(e.record.type).length === 0);
  if (unmapped.length > 0) {
    throw new CommandError(
      "input.invalid",
      `Not exported: no type of the source's model maps to the type of ${unmapped.map((e) => `${e.shortId} (${e.record.type})`).join(", ")}; import a delivery of that type through the mapping first, or leave these elements out`,
      { command: COMMAND, fields: ["mapping"] },
    );
  }
  const refusals = new Map<string, Set<string>>();
  const problems: Problem[] = [];
  const used = new Set<SourceType>();
  let withoutStatement = 0;
  const specObjects = input.elements.flatMap((element) => {
    const refuse = (reason: string): void => {
      refusals.set(reason, (refusals.get(reason) ?? new Set<string>()).add(element.shortId));
    };
    const types = typesOf(element.record.type);
    if (types.length > 1) {
      refuse(`types ${types.map(nameOf).join(", ")} of the source all map to ${element.record.type}`);
    }
    return types.slice(0, 1).map((t) => {
      used.add(t);
      const { values, without } = objectValues({ input, element, t, refuse, problems });
      withoutStatement += without ? 1 : 0;
      return { identifier: element.identifier, lastChange, type: t.identifier, values };
    });
  });
  if (refusals.size > 0) {
    throw refusalError(refusals);
  }
  const named = (item: Named): { identifier: string; lastChange: string; longName?: string } => ({
    identifier: item.identifier,
    lastChange,
    ...(item["long-name"] === undefined ? {} : { longName: item["long-name"] }),
  });
  const usedDatatypes = [...new Set([...used].flatMap((t) => typed(model, t).map(({ d }) => d)))];
  const ids = input.elements.map((e) => e.record.id);
  return {
    file: {
      header: {
        identifier: `_hd-${input.header}`,
        title: input.title,
        creationTime: lastChange,
        toolId: SOURCE_MODEL_TOOL_ID,
        sourceToolId: input.sourceToolId,
        version: "1.0",
      },
      datatypes: usedDatatypes.map((d) => ({
        ...named(d),
        kind: d.kind,
        ...(d["max-length"] === undefined ? {} : { maxLength: d["max-length"] }),
        ...(d.min === undefined ? {} : { min: d.min }),
        ...(d.max === undefined ? {} : { max: d.max }),
        ...(d.accuracy === undefined ? {} : { accuracy: d.accuracy }),
        values: (d.values ?? []).map((v) => ({
          ...named(v),
          ...(v.key === undefined ? {} : { key: v.key }),
          ...(v["other-content"] === undefined ? {} : { otherContent: v["other-content"] }),
        })),
      })),
      specTypes: [
        ...[...used].map((t) => ({
          ...named(t),
          category: "spec-object" as const,
          attributes: typed(model, t).map(({ a, d }) => ({
            ...named(a),
            kind: d.kind,
            datatype: a.datatype,
            multiValued: a["multi-valued"] === true,
          })),
        })),
        {
          identifier: "_st-specification",
          lastChange,
          longName: "specification",
          category: "specification" as const,
          attributes: [],
        },
      ],
      specObjects,
      specRelations: [],
      specifications: [
        {
          identifier: `_sp-${createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 32)}`,
          lastChange,
          longName: input.title,
          type: "_st-specification",
          values: [],
          children: input.elements.map(({ record, identifier }) => ({
            identifier: `_sh-${record.id}`,
            lastChange,
            object: identifier,
            children: [],
          })),
        },
      ],
    },
    withoutStatement,
    problems,
  };
};
