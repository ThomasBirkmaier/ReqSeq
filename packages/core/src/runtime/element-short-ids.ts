// The short ID of the element a problem names (`elementShortId`, SR-002 AK3, #315), and its
// identifier when it has one (`elementIdentifier`, #305), added in one place for every command:
// where its output leaves the runtime (`invoke`). Which parts of an output hold problems follows
// from the command's output schema alone (`problemLocator`: every place that references
// `common.schema.json#/$defs/problem`), never from the command name (ADR-0002 rule 3).
//
// Cost (ADR-0008): the short IDs come from the states the command left, and nothing is read. A
// command that names an element in a problem has read the element store and the metamodel, and
// almost always built the short IDs too (element.get resolves its reference with them), so they are
// only looked up. A check against an invalid metamodel builds no state that needs them; then they
// are built from the store in memory for this output (O(n log n), not kept). When the
// store or the metamodel is not built (or still being built), the field is left out. The store,
// the metamodel and the short IDs are taken as one view (ADR-0008, #319): a server's watcher may
// reset or replace them while a command runs.
// So the field depends on what a command reads, not on the calls before it on the same workspace
// (SR-080 AK2: an API server and a fresh CLI call give the same output).
import type { JsonSchema, Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import {
  buildShortIds,
  elementStoreState,
  problemElement,
  shortIdState,
  shortIdsBuiltFrom,
} from "../model/index.js";
import { SCHEMA_BASE } from "./contracts.js";
import { settledValue } from "./settled.js";
import type { Workspace } from "./workspace.js";

/**
 * Where an output holds problems (`problemLocator`): the value itself, or places in it, each named
 * after the schema keyword that gives it.
 */
export interface ProblemLocator {
  /** The value itself is a problem. */
  readonly problem?: true;
  /** Some of its properties (`properties`). */
  readonly properties?: ReadonlyMap<string, ProblemLocator>;
  /** The properties whose names match, also those in `properties` (`patternProperties`). */
  readonly patternProperties?: readonly PatternLocator[];
  /** The properties neither in `properties` nor matched by `patternProperties` (`additionalProperties`). */
  readonly additionalProperties?: ProblemLocator;
  /** Its first items, by position; undefined where an item holds none (`prefixItems`). */
  readonly prefixItems?: readonly (ProblemLocator | undefined)[];
  /** Its items after those of `prefixItems` (`items`). */
  readonly items?: ProblemLocator;
  /** More places in the same value, from schemas that apply to it too and could not be merged (`merge`). */
  readonly also?: readonly ProblemLocator[];
}

/** The properties a pattern of `patternProperties` matches, and where they hold problems. */
export interface PatternLocator {
  readonly pattern: RegExp;
  readonly locator: ProblemLocator;
}

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The locators that are there. */
const present = (parts: readonly (ProblemLocator | undefined)[]): ProblemLocator[] =>
  parts.filter((part): part is ProblemLocator => part !== undefined);

/**
 * Whether `part` names its places by `properties` and `items` only. Such parts merge into one:
 * the places of a key or of the items are those of every part. A part with patterns, additional
 * properties or a prefix does not (which properties are additional, or which items come after the
 * prefix, depends on its own schema), so it is kept as it is in `also`.
 */
const isPlain = (part: ProblemLocator): boolean =>
  part.patternProperties === undefined &&
  part.additionalProperties === undefined &&
  part.prefixItems === undefined;

/** One locator for the places of all of `found` (at least one) in the same value. */
const mergeAll = (found: readonly ProblemLocator[]): ProblemLocator => {
  const [only] = found;
  if (found.length === 1 && only !== undefined) {
    return only;
  }
  const plain = found.filter(isPlain);
  const keys = new Set(plain.flatMap((part) => [...(part.properties?.keys() ?? [])]));
  const properties = new Map(
    [...keys].map((key) => [key, mergeAll(present(plain.map((part) => part.properties?.get(key))))] as const),
  );
  const items = present(plain.map((part) => part.items));
  const also = [...plain.flatMap((part) => part.also ?? []), ...found.filter((part) => !isPlain(part))];
  return {
    ...(plain.some((part) => part.problem === true) ? { problem: true } : {}),
    ...(properties.size === 0 ? {} : { properties }),
    ...(items.length === 0 ? {} : { items: mergeAll(items) }),
    ...(also.length === 0 ? {} : { also }),
  };
};

/** One locator for the places of all `parts` in the same value; undefined when none holds a problem. */
const merge = (parts: readonly (ProblemLocator | undefined)[]): ProblemLocator | undefined => {
  const found = present(parts);
  return found.length === 0 ? undefined : mergeAll(found);
};

/** `key` as a part of a JSON pointer. */
const escape = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");

/** The keywords whose schemas (one, or a list) apply to the value itself. */
const SAME_VALUE = ["allOf", "anyOf", "oneOf", "then", "else"] as const;

/**
 * Where values of `schema` (whose relative `$ref`s resolve against `base`) hold problems: through
 * `$ref`, `allOf`, `anyOf`, `oneOf`, `then`, `else`, `properties`, `patternProperties`,
 * `additionalProperties`, `prefixItems` and `items`; `$ref`s resolve only against `schemas`
 * (identifiers, never fetched). Undefined when they hold none. Other keywords name no place of a
 * value (`not`, `if`, `propertyNames`) or are not used for problems; the catalog test makes sure
 * no problem of an output schema lies there. A schema that refers back to itself is followed once;
 * when it holds problems, the copies deeper down would be missed, so that throws (a programming
 * error of the catalog, #319).
 */
export const problemLocator = (
  schema: JsonSchema,
  base: string,
  schemas: readonly JsonSchema[],
): ProblemLocator | undefined => {
  const byId = new Map<string, JsonSchema>(schemas.map((s) => [String(s["$id"]), s]));
  const common = byId.get(`${SCHEMA_BASE}common.schema.json`)?.["$defs"];
  const problemSchema = isRecord(common) ? common["problem"] : undefined;
  const visiting = new Set<unknown>();
  // Schemas met again while they were followed: they refer back to themselves.
  const recursive = new Set<unknown>();

  const resolve = (ref: string, from: string): { node: unknown; base: string } => {
    const url = new URL(ref, from);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    let node: unknown = byId.get(url.href);
    for (const part of pointer.split("/").slice(1)) {
      node = isRecord(node) ? node[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
    }
    return { node, base: url.href };
  };

  /**
   * The places that `node` (at `at`) itself names, in properties and items. When its additional
   * properties hold problems, every property it names or matches is kept, also one without
   * problems (an empty locator): that one is not additional. Likewise every item of its prefix is
   * kept when the items after it hold problems.
   */
  const places = (node: Rec, from: string, at: string): ProblemLocator | undefined => {
    const additionalProperties = locate(node["additionalProperties"], from, `${at}/additionalProperties`);
    const located = (keyword: string): [string, ProblemLocator][] => {
      const value = node[keyword];
      return Object.entries(isRecord(value) ? value : {}).flatMap(([key, child]) => {
        const found = locate(child, from, `${at}/${keyword}/${escape(key)}`);
        if (found !== undefined) {
          return [[key, found]];
        }
        return additionalProperties === undefined ? [] : [[key, {}]];
      });
    };
    const properties = new Map(located("properties"));
    const patternProperties = located("patternProperties").map(([pattern, locator]) => ({
      // As the schema validator reads patterns (Unicode).
      pattern: new RegExp(pattern, "u"),
      locator,
    }));
    const prefix = Array.isArray(node["prefixItems"]) ? (node["prefixItems"] as unknown[]) : [];
    const prefixItems = prefix.map((item, i) => locate(item, from, `${at}/prefixItems/${String(i)}`));
    const items = locate(node["items"], from, `${at}/items`);
    const found: ProblemLocator = {
      ...(properties.size === 0 ? {} : { properties }),
      ...(patternProperties.length === 0 ? {} : { patternProperties }),
      ...(additionalProperties === undefined ? {} : { additionalProperties }),
      ...(prefix.length > 0 && (items !== undefined || present(prefixItems).length > 0)
        ? { prefixItems }
        : {}),
      ...(items === undefined ? {} : { items }),
    };
    return Object.keys(found).length === 0 ? undefined : found;
  };

  /** Where values of `node`, at the JSON pointer `at`, hold problems. */
  const locate = (node: unknown, from: string, at: string): ProblemLocator | undefined => {
    if (!isRecord(node)) {
      return undefined;
    }
    if (node === problemSchema) {
      return { problem: true };
    }
    if (visiting.has(node)) {
      recursive.add(node);
      return undefined;
    }
    visiting.add(node);
    const parts: (ProblemLocator | undefined)[] = [];
    const ref = node["$ref"];
    if (typeof ref === "string") {
      const target = resolve(ref, from);
      parts.push(locate(target.node, target.base, new URL(ref, from).href));
    }
    for (const key of SAME_VALUE) {
      const value = node[key];
      if (Array.isArray(value)) {
        (value as unknown[]).forEach((branch, i) =>
          parts.push(locate(branch, from, `${at}/${key}/${String(i)}`)),
        );
      } else {
        parts.push(locate(value, from, `${at}/${key}`));
      }
    }
    parts.push(places(node, from, at));
    visiting.delete(node);
    const found = merge(parts);
    if (found !== undefined && recursive.has(node)) {
      throw new Error(`the problems of ${at} cannot be located: the schema refers back to itself`);
    }
    return found;
  };

  return locate(schema, base, `${base}#`);
};

/** A problem that names an element. */
type NamingProblem = Problem & { readonly elementId: string };

/** What a problem that names an element gets: its short ID and, when it has one, its identifier. */
export interface ElementNames {
  readonly elementShortId: string;
  readonly elementIdentifier?: string;
}

type ShortIdOf = (problem: NamingProblem) => ElementNames | undefined;

/** Whether `value` is a problem that names an element and has no short ID yet. */
const needsShortId = (value: unknown): value is NamingProblem =>
  isRecord(value) && typeof value["elementId"] === "string" && value["elementShortId"] === undefined;

/** The properties of `value` filled at the places of `locator`; `value` itself when none changed. */
const fillProperties = (value: Rec, locator: ProblemLocator, shortIdOf: ShortIdOf): Rec => {
  const { properties, patternProperties = [], additionalProperties } = locator;
  // Every key only when patterns or additional properties may name it; else the named keys.
  const keys =
    patternProperties.length === 0 && additionalProperties === undefined
      ? [...(properties?.keys() ?? [])].filter((key) => key in value)
      : Object.keys(value);
  let copy: Record<string, unknown> | undefined;
  for (const key of keys) {
    const named = properties?.get(key);
    const matched = patternProperties.filter(({ pattern }) => pattern.test(key)).map((p) => p.locator);
    const additional = named === undefined && matched.length === 0 ? additionalProperties : undefined;
    const filled = present([named, ...matched, additional]).reduce<unknown>(
      (current, place) => fillElementShortIds(current, place, shortIdOf),
      value[key],
    );
    if (filled !== value[key]) {
      copy ??= { ...value };
      copy[key] = filled;
    }
  }
  return copy ?? value;
};

/** The items of `value` filled at the places of `locator`; `value` itself when none changed. */
const fillItems = (value: readonly unknown[], locator: ProblemLocator, shortIdOf: ShortIdOf): unknown => {
  const { prefixItems = [], items } = locator;
  if (prefixItems.length === 0 && items === undefined) {
    return value;
  }
  const filled = value.map((item, i) => {
    const place = i < prefixItems.length ? prefixItems[i] : items;
    return place === undefined ? item : fillElementShortIds(item, place, shortIdOf);
  });
  return filled.some((item, i) => item !== value[i]) ? filled : value;
};

/**
 * `value` with `elementShortId` (and `elementIdentifier`) added to each problem at the places of
 * `locator` that names an element (`elementId`) and has none yet, as `shortIdOf` gives them
 * (undefined: left out). Changes nothing in place: a changed value is a copy, an unchanged one is
 * `value` itself, so problems kept in workspace states stay as they are. A problem that has its
 * short ID is left alone, so the places of `also` are filled one after the other.
 */
export const fillElementShortIds = (
  value: unknown,
  locator: ProblemLocator,
  shortIdOf: ShortIdOf,
): unknown => {
  if (locator.problem === true && needsShortId(value)) {
    const names = shortIdOf(value);
    return names === undefined ? value : { ...value, ...names };
  }
  const own = Array.isArray(value)
    ? fillItems(value, locator, shortIdOf)
    : isRecord(value)
      ? fillProperties(value, locator, shortIdOf)
      : value;
  return (locator.also ?? []).reduce<unknown>(
    (current, place) => fillElementShortIds(current, place, shortIdOf),
    own,
  );
};

/**
 * `output` of a command with the short ID (and identifier) of each element its problems name (see
 * the file comment): from the short IDs of `workspace` when they are built from its element store
 * and metamodel as they are now, else from that store and metamodel when both are built; left out
 * when the element is not in the store or the store is not there.
 */
export const withElementShortIds = async (
  workspace: Workspace,
  locator: ProblemLocator | undefined,
  output: unknown,
): Promise<unknown> => {
  if (locator === undefined) {
    return output;
  }
  const named: NamingProblem[] = [];
  fillElementShortIds(output, locator, (problem) => {
    named.push(problem);
    return undefined;
  });
  if (named.length === 0) {
    return output;
  }
  // One view of the workspace (ADR-0008): the three states are taken in the same step, so that a
  // watcher batch cannot land between them, and kept short IDs count only when they are of that
  // store and metamodel. Else they are built here, not kept: `get` could read the store again.
  const [store, metamodel, kept] = await Promise.all([
    settledValue(workspace.peek(elementStoreState)),
    settledValue(workspace.peek(metamodelState)),
    settledValue(workspace.peek(shortIdState)),
  ]);
  if (store === undefined || metamodel === undefined) {
    return output;
  }
  const shortIds =
    kept !== undefined && shortIdsBuiltFrom(kept, store.byId, metamodel)
      ? kept
      : buildShortIds(store.byId, metamodel);
  return fillElementShortIds(output, locator, (problem) => {
    const element = problemElement(store, problem);
    if (element === undefined) {
      return undefined;
    }
    const identifier = shortIds.identifierOf(element);
    return {
      elementShortId: shortIds.of(element),
      ...(identifier === undefined ? {} : { elementIdentifier: identifier }),
    };
  });
};
