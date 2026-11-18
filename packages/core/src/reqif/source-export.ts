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
// - Values by the source's datatype, as the import's `holds` allows the other way: a number into
//   INTEGER (whole) or REAL, a date into DATE `T00:00:00Z`, a choice into ENUMERATION by `values`
//   (several source values for one choice: the first in the mapping's order, warning
//   `reqif.source-value-chosen`, #1835); the title, the text and a text property into any datatype:
//   STRING as plain text (Markdown as its text), XHTML from Markdown (`markdownToXhtml`, image links as
//   written, #1835) or plain text as one `div`, INTEGER, REAL, DATE (`YYYY-MM-DD`) and BOOLEAN
//   (`true`, `false`) in their lexical form, ENUMERATION by the LONG-NAME or IDENTIFIER of a value.
// - Refusals (AK7, #1886), all collected, then one `input.invalid` naming each requirement with
//   attribute or type, and nothing written: several stored types mapped to one own type; without
//   statements, several attributes of a type mapped to one title, text or property; a value that does
//   not fit its attribute (a STRING longer than MAX-LENGTH, a number outside MIN and MAX, a value no
//   enumeration value is mapped to or named by, a text not in the lexical form of its datatype, a
//   fraction into INTEGER, several values into a single-valued attribute, a value of a kind the
//   datatype cannot hold); a type without the statement attribute, for each of its requirements. Not
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

/** An own value as the export reads it: what it is, and its items (none: empty). */
interface Own {
  readonly kind: "markdown" | "plain" | "number" | "date" | "choice" | "relation";
  readonly items: readonly string[];
}

/** The kind of a value of each property kind but text. */
const KINDS: Readonly<Record<string, Own["kind"]>> = {
  number: "number",
  date: "date",
  choice: "choice",
  relation: "relation",
};

/** The own value of `field` (`title`, `text` or a property key) of `element` (see the file comment). */
const ownValue = (metamodel: Metamodel, element: SourceElement, field: string): Own => {
  if (field === "text") {
    return { kind: "markdown", items: element.text === "" ? [] : [element.text] };
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
  return { kind, items };
};

/** What a value becomes in a source attribute: its value or why it does not fit, and a warning. */
type Converted = { readonly value: Value; readonly warning?: string } | { readonly refusal: string };

const INTEGER = /^[+-]?\d+$/;
const REAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Why the number `text` lies outside MIN and MAX of `d`, if it does. */
const outside = (text: string, d: SourceDatatype): string | undefined => {
  const n = Number(text);
  if (d.min !== undefined && n < Number(d.min)) {
    return `${text} is smaller than ${d.min}, the MIN of ${nameOf(d)}`;
  }
  return d.max !== undefined && n > Number(d.max)
    ? `${text} is greater than ${d.max}, the MAX of ${nameOf(d)}`
    : undefined;
};

/** `own` as an ENUMERATION value of attribute `a` of `d` through `entry` (see the file comment). */
const enumerationValue = (
  own: Own,
  a: SourceAttribute,
  d: SourceDatatype,
  entry: AttributeEntry | undefined,
): Converted => {
  const values = d.values ?? [];
  const refs = new Set<string>();
  let warning: string | undefined;
  for (const text of own.items) {
    // A choice by the source values `values` maps to it, in the mapping's order; a text by name.
    const names =
      own.kind === "choice"
        ? Object.entries({ ...entry?.values }).flatMap(([source, key]) => (key === text ? [source] : []))
        : [text];
    const found = names.flatMap((name) => values.filter((v) => matches(name, v)));
    const [first] = found;
    if (first === undefined) {
      return { refusal: `${text} is mapped to no value of ${nameOf(d)}` };
    }
    if (found.length > 1) {
      warning = `choice ${text} is mapped to several values of ${nameOf(d)}; ${nameOf(first)} is written`;
    }
    refs.add(first.identifier);
  }
  if (refs.size > 1 && a["multi-valued"] !== true) {
    return { refusal: `${String(refs.size)} values do not fit the single-valued ${nameOf(a)}` };
  }
  const value: Value = { kind: "enumeration", definition: a.identifier, values: [...refs] };
  return warning === undefined ? { value } : { value, warning };
};

/** Whether an own value of `kind` fits datatype `d`, as the import's `holds` the other way. */
const holds = (kind: Own["kind"], d: SourceDatatype): boolean => {
  switch (kind) {
    case "number":
      return d.kind === "integer" || d.kind === "real";
    case "date":
      return d.kind === "date";
    case "choice":
      return d.kind === "enumeration";
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

/** An image link stays as the text has it (#1835). */
const asWritten = (url: string): string => url;

/** `own` as a value of attribute `a` of datatype `d` (see the file comment). */
const converted = (
  own: Own,
  a: SourceAttribute,
  d: SourceDatatype,
  entry: AttributeEntry | undefined,
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
  const [item = "", ...more] = own.items;
  if (more.length > 0) {
    return { refusal: `${String(own.items.length)} values do not fit ${kind} ${nameOf(d)}, which holds one` };
  }
  const markdown = own.kind === "markdown";
  if (datatype === "xhtml") {
    return {
      value: markdown
        ? { kind: "xhtml", definition, value: [markdownToXhtml(item, { image: asWritten }).value] }
        : div(definition, [item]),
    };
  }
  return scalarValue(
    markdown ? xhtmlText([markdownToXhtml(item, { image: asWritten }).value]).text : item,
    a,
    d,
    datatype,
  );
};

/** The plain text `text` as a value of attribute `a` of a STRING, INTEGER, REAL, DATE or BOOLEAN `d`. */
const scalarValue = (
  text: string,
  a: SourceAttribute,
  d: SourceDatatype,
  datatype: "string" | "integer" | "real" | "date" | "boolean",
): Converted => {
  const definition = a.identifier;
  const kind = datatype.toUpperCase();
  switch (datatype) {
    case "string": {
      const max = Number(d["max-length"]);
      return characters(text) > max
        ? {
            refusal: `${String(characters(text))} characters are longer than ${String(max)}, the MAX-LENGTH of ${nameOf(d)}`,
          }
        : { value: { kind: "string", definition, value: text } };
    }
    case "integer":
    case "real": {
      const fits =
        datatype === "integer" ? INTEGER.test(text) && Number.isSafeInteger(Number(text)) : REAL.test(text);
      const why = fits ? outside(text, d) : `${text} is no ${kind} of ${nameOf(d)}`;
      return why === undefined ? { value: { kind: datatype, definition, value: text } } : { refusal: why };
    }
    case "date":
      return DATE.test(text)
        ? { value: { kind: "date", definition, value: `${text}T00:00:00Z` } }
        : { refusal: `${text} is no DATE of ${nameOf(d)}` };
    case "boolean":
      return text === "true" || text === "false"
        ? { value: { kind: "boolean", definition, value: text } }
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

/** The refusals found: each reason with the requirements it concerns, in the order found. */
const refusalError = (refusals: ReadonlyMap<string, readonly string[]>): CommandError =>
  new CommandError(
    "input.invalid",
    `Not exported in the source's model: ${[...refusals].map(([reason, ids]) => `${ids.join(", ")}: ${reason}`).join("; ")}`,
    { command: COMMAND, fields: ["mapping"] },
  );

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
    const result = converted(own, a, d, entry);
    if ("refusal" in result) {
      refuse(`${nameOf(a)} of ${nameOf(t)}: ${result.refusal}`);
      return;
    }
    values.push(result.value);
    if (result.warning !== undefined) {
      problems.push({
        code: "reqif.source-value-chosen",
        severity: "warning",
        message: `${element.shortId}: ${nameOf(a)}: ${result.warning}`,
      });
    }
  };
  const attributes = typed(model, t);
  if (statement !== undefined) {
    const found = attributes.filter(({ a }) => matches(statement.attribute, a)).slice(0, 1);
    for (const x of found) {
      write(statement.property, x, attributeEntry(mapping, t, x.a));
    }
    if (found.length === 0) {
      refuse(`${nameOf(t)} of the source has no attribute ${statement.attribute} for the statement`);
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
  const refusals = new Map<string, string[]>();
  const problems: Problem[] = [];
  const used = new Set<SourceType>();
  let withoutStatement = 0;
  const specObjects = input.elements.flatMap((element) => {
    const refuse = (reason: string): void => {
      const ids = refusals.get(reason) ?? [];
      refusals.set(reason, ids.includes(element.shortId) ? ids : [...ids, element.shortId]);
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
