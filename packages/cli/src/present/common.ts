// Part of the CLI output for people (`../present.ts`, whose comment describes the layout): the
// helpers every kind of output shares, and the elements an output names by UUID (`names`).
import { degreePercent, degreeShareOf } from "@reqseq/core";
import { stringify } from "yaml";
import type { Style } from "../style.js";

export type Rec = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The longest reason a line shows; a longer one ends in `…` (`--json` and `--yaml` keep it whole). */
const REASON_LENGTH = 120;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * A reason (SR-172) on one line: each run of white space and control characters one space, cut to
 * `REASON_LENGTH` characters as the reader sees them (graphemes), so an emoji is never split.
 */
export const reasonText = (value: unknown): string => {
  const line = text(value)
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  // A string never has more graphemes than UTF-16 units, so a short one needs no segmenting, and
  // a long one is segmented only up to the cut.
  if (line.length <= REASON_LENGTH) {
    return line;
  }
  const kept: string[] = [];
  for (const { segment } of GRAPHEMES.segment(line)) {
    if (kept.length === REASON_LENGTH) {
      return `${kept.slice(0, REASON_LENGTH - 1).join("")}…`;
    }
    kept.push(segment);
  }
  return line;
};

/** The parts that are not empty, two spaces apart. */
export const join = (...parts: readonly string[]): string => parts.filter((part) => part !== "").join("  ");

// No anchors and aliases: a record that is both an execution and `last` of a test case reads in full twice.
export const yamlOf = (value: unknown): string =>
  stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });

/**
 * Appends `items` to `target` one by one: `target.push(...items)` passes every item as an argument
 * and overflows the stack for a few hundred thousand lines (#1786).
 */
export const appendAll = <T>(target: T[], items: readonly T[]): void => {
  for (const item of items) {
    target.push(item);
  }
};

/** The largest of `values`, at least `floor`, without spreading them into arguments (#1786). */
export const maxOf = (values: readonly number[], floor: number): number =>
  values.reduce((max, value) => (value > max ? value : max), floor);

export const indent = (lines: readonly string[], by = "  "): string[] => lines.map((line) => `${by}${line}`);

/** `value` when it is a list, else an empty one. */
export const listOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? (value as unknown[]) : [];

/** `value` as YAML lines. */
export const yamlLines = (value: unknown): string[] => yamlOf(value).replace(/\n$/, "").split("\n");

/** `value` with the share of every verification degree in it, in objects and lists, as its percentage (SR-037). */
export const withPercent = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(withPercent);
  }
  if (!isRecord(value)) {
    return value;
  }
  const share = degreeShareOf(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "share" && share !== undefined ? degreePercent(share) : withPercent(item),
    ]),
  );
};

/** An element a number of a write command counts (`common.schema.json#/$defs/countedElement`): exactly `id`, `shortId` and `repository`. */
export const isCountedElement = (value: unknown): value is Rec & { readonly shortId: string } =>
  isRecord(value) &&
  Object.keys(value).length === 3 &&
  typeof value["id"] === "string" &&
  typeof value["shortId"] === "string" &&
  typeof value["repository"] === "string";

/** How many short IDs a list of counted elements shows before it is cut. */
const SHOWN_COUNTED = 10;

/**
 * A list of counted elements on one line: their short IDs, cut after `SHOWN_COUNTED`, `none` when empty
 * (a write can count 50,000 elements, N-036).
 */
export const countedElementsText = (list: readonly { readonly shortId: string }[]): string => {
  if (list.length === 0) {
    return "none";
  }
  const shown = list
    .slice(0, SHOWN_COUNTED)
    .map((element) => element.shortId)
    .join(", ");
  const more = list.length - SHOWN_COUNTED;
  return more > 0 ? `${shown} … and ${String(more)} more (--yaml lists them)` : shown;
};

/** `value` with every list of counted elements in it, in objects and lists, as `countedElementsText`. */
export const withCountedLists = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isCountedElement)
      ? countedElementsText(value)
      : (value as unknown[]).map(withCountedLists);
  }
  return isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withCountedLists(item)]))
    : value;
};

/** An element as outputs name it: at least its short ID and title. */
export const isElement = (
  value: unknown,
): value is Rec & { readonly shortId: string; readonly title: string } =>
  isRecord(value) && typeof value["shortId"] === "string" && typeof value["title"] === "string";

/** A finding: `common.schema.json#/$defs/problem`. */
export const isProblem = (value: unknown): value is Rec =>
  isRecord(value) &&
  typeof value["code"] === "string" &&
  typeof value["severity"] === "string" &&
  typeof value["message"] === "string";

/**
 * A short ID with the identifier next to it when there is one (ThomasBirkmaier/ReqSeq-archive#305): `SR-3c90b0 (SR-036)`; the
 * short ID alone otherwise.
 */
export const withIdentifier = (shortId: string, identifier: unknown): string =>
  text(identifier) === "" ? shortId : `${shortId} (${text(identifier)})`;

/**
 * An element named on a terminal (#988): the short ID strong, the identifier faint in brackets behind
 * it, `SR-3c90b0 (SR-036)` as in plain text (SR-084 AK4); the short ID alone when it has none.
 * `withIdentifier` in plain text.
 */
export const nameOn = (style: Style | undefined, shortId: string, identifier: unknown): string => {
  if (style === undefined) {
    return withIdentifier(shortId, identifier);
  }
  return text(identifier) === ""
    ? style.strong(shortId)
    : `${style.strong(shortId)} ${style.faint(`(${text(identifier)})`)}`;
};

/** Names an element by repository and UUID: its short ID when the list has it, else its UUID. */
export type Namer = (repository: string, id: string) => string;

/** An element as `names` gives it (`common.schema.json#/$defs/elementName`, ThomasBirkmaier/ReqSeq-archive#588). */
const isElementName = (value: unknown): value is Rec & { readonly shortId: string; readonly title: string } =>
  isElement(value) && typeof value["id"] === "string" && typeof value["repository"] === "string";

/** The elements of `names` by UUID (the first of a UUID), when the output has them (ThomasBirkmaier/ReqSeq-archive#588). */
export type Names = ReadonlyMap<string, Rec & { readonly shortId: string; readonly title: string }>;

/** `names` of an output by UUID (core gives each UUID once); empty when it has none or it is not a list of names. */
export const namesIn = (output: Rec): Names => {
  const names = output["names"];
  if (!Array.isArray(names) || !names.every(isElementName)) {
    return new Map();
  }
  return new Map(names.map((name) => [text(name["id"]), name] as const));
};

/** A named element in a line: `SHORT-ID (IDENTIFIER)  title`. */
const nameText = (name: Rec & { readonly shortId: string; readonly title: string }): string =>
  join(withIdentifier(name.shortId, name["identifier"]), name.title);

/** A variant of a record by `nameText` when `names` has it, else its UUID (#676). */
export const variantName = (id: string, names: Names): string => {
  const name = names.get(id);
  return name === undefined ? id : nameText(name);
};

/** `value` with every string that is a UUID of `names` as the element it names (`nameText`), in objects and lists. */
export const withNames = (value: unknown, names: Names): unknown => {
  if (names.size === 0) {
    return value;
  }
  if (typeof value === "string") {
    const name = names.get(value);
    return name === undefined ? value : nameText(name);
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => withNames(item, names));
  }
  return isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withNames(item, names)]))
    : value;
};

/** A namer from the elements of a list. */
export const namerOf =
  (elements: readonly Rec[]): Namer =>
  (repository, id) =>
    text(elements.find((e) => e["id"] === id && e["repository"] === repository)?.["shortId"]) || id;

export const nodeKey = (direction: string, repository: string, id: string): string =>
  JSON.stringify([direction, repository, id]);
