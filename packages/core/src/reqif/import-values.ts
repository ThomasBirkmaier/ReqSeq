// The values of an object through the mapping (`planValues`): texts, Markdown, choices, dates and
// numbers. Part of import.ts, whose file comment says what the plan does; "the file comment" here
// means that one.
import type { PropertyValue } from "../files/index.js";
import type { MetamodelProperty } from "../generated/types.js";
import type {
  ReqifDatatype,
  ReqifIdentifiable,
  ReqifSpecObject,
  ReqifSpecType,
  ReqifValue,
  XhtmlElement,
  XhtmlNode,
} from "./model.js";
import { XHTML_NAMESPACE } from "./model.js";
import { prepareMarkdown } from "./xhtml-markdown.js";
import { markdownText, xhtmlText } from "./xhtml-text.js";
import { datatypeOf, invalidFile, nameOf } from "./import-context.js";
import type { AttributeEntry, Context, Draft, Loss } from "./import-context.js";
import { choiceOf } from "./import-coverage.js";
import { ownOnly } from "./import-own.js";

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
export const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?|24:00:00(?:\.0+)?)(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?)?$/;

/** The time of xs:dateTime that is the first instant of the next day (XSD 1.1 Part 2 §3.3.8). */
const END_OF_DAY = /^T24:00:00(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})?$/;

/** The time of `date` (`YYYY-MM-DD`) in UTC, if it is a day of the calendar. */
export const dayTime = (date: string): number | undefined => {
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
export const LEXICAL: Readonly<Record<string, RegExp>> = {
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
  const target = definition.markdown === true ? "markdown" : "plain";
  return definition.many === true
    ? manyTexts(context, draft, value, datatype, target, loss)
    : (await textsOf(context, draft, value, datatype, target, loss)).join(", ");
};

/**
 * The items of a value for a text property with `many`: of a file of ReqSeq one per item of a list
 * (`listItems`), else `textsOf`. A file of another tool keeps a list as one item (its Markdown).
 */
const manyTexts = async (
  context: Context,
  draft: Draft,
  value: ReqifValue,
  datatype: ReqifDatatype,
  target: Target,
  loss: Loss,
): Promise<string[]> => {
  const items = context.own && value.kind === "xhtml" ? listItems(value.value) : undefined;
  if (items === undefined) {
    return textsOf(context, draft, value, datatype, target, loss);
  }
  const texts: string[] = [];
  for (const item of items) {
    texts.push(await itemText(context, draft, value.definition, item, datatype, target, loss));
  }
  return texts;
};

/** Whether `node` is white space only, which XHTML lets stand between blocks. */
const blank = (node: XhtmlNode): boolean => typeof node === "string" && node.trim() === "";

/** Whether `node` is an XHTML element named one of `names`, without attributes, as the export writes it. */
const bare = (node: XhtmlNode | undefined, names: readonly string[]): node is XhtmlElement =>
  node !== undefined &&
  typeof node !== "string" &&
  node.namespace === XHTML_NAMESPACE &&
  node.attributes.length === 0 &&
  names.includes(node.name);

/** The one node of `nodes` apart from white space, if there is exactly one. */
const onlyNode = (nodes: readonly XhtmlNode[]): XhtmlNode | undefined => {
  const rest = nodes.filter((node) => !blank(node));
  return rest.length === 1 ? rest[0] : undefined;
};

/**
 * The items of an XHTML value of a file of ReqSeq that is exactly one list (`ul` or `ol`, alone or
 * in one `div`, white space aside) of `li` elements, each in the XHTML namespace and without
 * attributes, as the export writes a text property with `many` (own.ts); else undefined, and the
 * value is one item, its losses reported as before (SR-095 AK3). So a list another tool edited
 * reads back as its items, and an unchanged item keeps its criterion key by its text (SR-204 AK4).
 */
const listItems = (value: readonly XhtmlNode[]): readonly (readonly XhtmlNode[])[] | undefined => {
  const outer = onlyNode(value);
  const list = bare(outer, ["div"]) ? onlyNode(outer.children) : outer;
  if (!bare(list, ["ul", "ol"])) {
    return undefined;
  }
  const nodes = list.children.filter((node) => !blank(node));
  const items = nodes.flatMap((node) => (bare(node, ["li"]) ? [node.children] : []));
  return items.length === nodes.length ? items : undefined;
};

/**
 * The text of one list item (`listItems`): an item of text only as written, since the export writes
 * each item so (own.ts), like a STRING of a file of ReqSeq (`textsOf`); else its XHTML as `textsOf`
 * reads it.
 */
const itemText = async (
  context: Context,
  draft: Draft,
  definition: string,
  item: readonly XhtmlNode[],
  datatype: ReqifDatatype,
  target: Target,
  loss: Loss,
): Promise<string> =>
  item.every((node) => typeof node === "string")
    ? item.join("")
    : (
        await textsOf(context, draft, { kind: "xhtml", definition, value: item }, datatype, target, loss)
      ).join("");

/** Takes the values of `object` into `draft` (see the file comment). */
export const planValues = async (
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
