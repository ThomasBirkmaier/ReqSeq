// The short ID of the element a problem names (`elementShortId`, SR-002 AK3, #315), added in one
// place for every command: where its output leaves the runtime (`invoke`). Which parts of an output
// hold problems follows from the command's output schema alone (`problemLocator`: every place that
// references `common.schema.json#/$defs/problem`), never from the command name (ADR-0002 rule 3).
//
// Cost (ADR-0008): the short IDs come from the states the command left, and nothing is read. A
// command that names an element in a problem has read the element store and the metamodel, and
// almost always built the short IDs too (element.get resolves its reference with them), so they are
// only looked up. A check against an invalid metamodel builds no state that needs them; then they
// are built from the store in memory for this output (O(n log n), not kept). When the
// store or the metamodel is not built (or still being built), the field is left out.
// So the field depends on what a command reads, not on the calls before it on the same workspace
// (SR-080 AK2: an API server and a fresh CLI call give the same output).
import type { JsonSchema, Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { buildShortIds, elementStoreState, problemElement, shortIdState } from "../model/index.js";
import { SCHEMA_BASE } from "./contracts.js";
import { settledValue } from "./settled.js";
import type { Workspace } from "./workspace.js";

/** Where an output holds problems: the value itself, its items, or some of its properties. */
export interface ProblemLocator {
  readonly problem?: true;
  readonly items?: ProblemLocator;
  readonly properties?: ReadonlyMap<string, ProblemLocator>;
}

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The locators that are there. */
const present = (parts: readonly (ProblemLocator | undefined)[]): ProblemLocator[] =>
  parts.filter((part): part is ProblemLocator => part !== undefined);

/** One locator for the places of all of `found` (at least one). */
const mergeAll = (found: readonly ProblemLocator[]): ProblemLocator => {
  const keys = new Set(found.flatMap((part) => [...(part.properties?.keys() ?? [])]));
  const properties = new Map(
    [...keys].map((key) => [key, mergeAll(present(found.map((part) => part.properties?.get(key))))] as const),
  );
  const items = present(found.map((part) => part.items));
  return {
    ...(found.some((part) => part.problem === true) ? { problem: true } : {}),
    ...(items.length === 0 ? {} : { items: mergeAll(items) }),
    ...(properties.size === 0 ? {} : { properties }),
  };
};

/** One locator for the places of all `parts`; undefined when none holds a problem. */
const merge = (parts: readonly (ProblemLocator | undefined)[]): ProblemLocator | undefined => {
  const found = present(parts);
  return found.length === 0 ? undefined : mergeAll(found);
};

/**
 * Where values of `schema` (whose relative `$ref`s resolve against `base`) hold problems: through
 * `$ref`, `anyOf`, `oneOf`, `allOf`, `items` and `properties`; `$ref`s resolve only against
 * `schemas` (identifiers, never fetched). Undefined when they hold none. A schema that refers back to
 * itself is not followed again: the catalog has no problems inside a recursive schema (filters).
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

  const locate = (node: unknown, from: string): ProblemLocator | undefined => {
    if (!isRecord(node) || visiting.has(node)) {
      return undefined;
    }
    if (node === problemSchema) {
      return { problem: true };
    }
    visiting.add(node);
    const parts: (ProblemLocator | undefined)[] = [];
    const ref = node["$ref"];
    if (typeof ref === "string") {
      const target = resolve(ref, from);
      parts.push(locate(target.node, target.base));
    }
    for (const key of ["anyOf", "oneOf", "allOf"]) {
      const branches = node[key];
      for (const branch of Array.isArray(branches) ? (branches as unknown[]) : []) {
        parts.push(locate(branch, from));
      }
    }
    const items = locate(node["items"], from);
    if (items !== undefined) {
      parts.push({ items });
    }
    const properties = new Map<string, ProblemLocator>();
    for (const [key, value] of Object.entries(isRecord(node["properties"]) ? node["properties"] : {})) {
      const located = locate(value, from);
      if (located !== undefined) {
        properties.set(key, located);
      }
    }
    if (properties.size > 0) {
      parts.push({ properties });
    }
    visiting.delete(node);
    return merge(parts);
  };

  return locate(schema, base);
};

/** A problem that names an element. */
type NamingProblem = Problem & { readonly elementId: string };

type ShortIdOf = (problem: NamingProblem) => string | undefined;

/** Whether `value` is a problem that names an element and has no short ID yet. */
const needsShortId = (value: unknown): value is NamingProblem =>
  isRecord(value) && typeof value["elementId"] === "string" && value["elementShortId"] === undefined;

/** The properties of `value` filled at the places of `properties`; `value` itself when none changed. */
const fillProperties = (
  value: Rec,
  properties: ReadonlyMap<string, ProblemLocator>,
  shortIdOf: ShortIdOf,
): Rec => {
  let copy: Record<string, unknown> | undefined;
  for (const [key, located] of properties) {
    if (key in value) {
      const filled = fillElementShortIds(value[key], located, shortIdOf);
      if (filled !== value[key]) {
        copy ??= { ...value };
        copy[key] = filled;
      }
    }
  }
  return copy ?? value;
};

/**
 * `value` with `elementShortId` added to each problem at the places of `locator` that names an
 * element (`elementId`) and has none yet, as `shortIdOf` gives it (undefined: left out). Changes
 * nothing in place: a changed value is a copy, an unchanged one is `value` itself, so problems kept
 * in workspace states stay as they are.
 */
export const fillElementShortIds = (
  value: unknown,
  locator: ProblemLocator,
  shortIdOf: ShortIdOf,
): unknown => {
  if (locator.problem === true && needsShortId(value)) {
    const shortId = shortIdOf(value);
    return shortId === undefined ? value : { ...value, elementShortId: shortId };
  }
  const { items, properties } = locator;
  if (items !== undefined && Array.isArray(value)) {
    const filled = (value as unknown[]).map((item) => fillElementShortIds(item, items, shortIdOf));
    return filled.some((item, i) => item !== value[i]) ? filled : value;
  }
  return properties !== undefined && isRecord(value) ? fillProperties(value, properties, shortIdOf) : value;
};

/**
 * `output` of a command with the short ID of each element its problems name (see the file
 * comment): from the short IDs of `workspace` when they are built, else from its element store and
 * metamodel when both are; left out when the element is not in the store or the store is not there.
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
  const [store, metamodel] = await Promise.all([
    settledValue(workspace.peek(elementStoreState)),
    settledValue(workspace.peek(metamodelState)),
  ]);
  if (store === undefined || metamodel === undefined) {
    return output;
  }
  // Built here, not kept, when they are not built: `get` could read the store again after a reset.
  const shortIds = (await settledValue(workspace.peek(shortIdState))) ?? buildShortIds(store.byId, metamodel);
  return fillElementShortIds(output, locator, (problem) => {
    const element = problemElement(store, problem);
    return element === undefined ? undefined : shortIds.of(element);
  });
};
