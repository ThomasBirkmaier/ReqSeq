// The short ID of the element each problem names, added where outputs leave the runtime (#315).
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput, JsonSchema, Problem } from "../catalog.js";
import { defineTestCommand } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import type { ShortIds } from "../model/index.js";
import {
  applyStoreChange,
  buildShortIds,
  elementStoreState,
  problemElement,
  requiredProblemsState,
  shortIdState,
  shortIdsBuiltFrom,
} from "../model/index.js";
import { SCHEMA_BASE, loadContracts } from "./contracts.js";
import type { ProblemLocator } from "./element-short-ids.js";
import type { ElementNames } from "./element-short-ids.js";
import { fillElementShortIds, problemLocator, withElementShortIds } from "./element-short-ids.js";
import { createCommandRuntime, invoke } from "./invoke.js";
import { Workspace } from "./workspace.js";

const P = "26a0b000-0000-4000-8000-0000000000";
const N1 = `${P}a1`;
const R2 = `${P}b2`;
const R4 = `${P}b4`;
const HINTS: FixtureOptions = { fixture: "SR-026/hints" };

const open = async (options: FixtureOptions = HINTS): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const { schemas } = loadContracts();
const base = `${SCHEMA_BASE}commands/test.output.json`;
const PROBLEM = { $ref: "../common.schema.json#/$defs/problem" };
const PROBLEMS = { type: "array", items: PROBLEM };
const locator = (schema: JsonSchema): ProblemLocator | undefined => problemLocator(schema, base, schemas);

/** A problem about `id` in `file` of the repository system. */
const about = (
  id: string,
  file: string,
  more: Partial<Problem> = {},
): Problem & { readonly elementId: string } => ({
  code: "element.unknown-property",
  severity: "warning",
  message: "m",
  repository: "system",
  file,
  elementId: id,
  ...more,
});

/** An output with one problem about `id`. */
const named = (id: string): { problems: Problem[] } => ({ problems: [about(id, "needs/N-0000000000a1.md")] });

describe("problemLocator", () => {
  it("finds the problems behind $ref, items, properties, anyOf, oneOf and allOf", () => {
    const problem: ProblemLocator = { problem: true };
    expect(locator(PROBLEM)).toEqual(problem);
    expect(locator({ type: "object", properties: { problems: PROBLEMS, ok: { type: "boolean" } } })).toEqual({
      properties: new Map([["problems", { items: problem }]]),
    });
    expect(
      locator({
        anyOf: [
          { properties: { a: PROBLEMS } },
          { properties: { a: PROBLEM, b: PROBLEM } },
          { type: "null" },
        ],
        oneOf: [{ items: PROBLEM }],
        allOf: [PROBLEM],
      }),
    ).toEqual({
      problem: true,
      items: problem,
      properties: new Map<string, ProblemLocator>([
        ["a", { problem: true, items: problem }],
        ["b", problem],
      ]),
    });
    // An element of data-export.schema.json, as element.get gives it: refs relative to that file.
    expect(
      locator({ properties: { element: { $ref: "../data-export.schema.json#/$defs/element" } } }),
    ).toEqual({
      properties: new Map([["element", { properties: new Map([["problems", { items: problem }]]) }]]),
    });
  });

  it("finds none where there is none, a ref that leads nowhere or a schema that refers back to itself", () => {
    expect(locator({ type: "object", properties: { ok: { type: "boolean" } } })).toBeUndefined();
    expect(locator({ $ref: "../common.schema.json#/$defs/nothing/here" })).toBeUndefined();
    expect(locator({ anyOf: "no list", items: true })).toBeUndefined();
    // A schema that refers back to itself is followed once: without problems in it (filters), or
    // with problems beside it, that is all there is.
    const tree: Record<string, unknown> = { type: "object" };
    tree["properties"] = { children: { type: "array", items: tree } };
    expect(locator(tree)).toBeUndefined();
    expect(locator({ $ref: "../filter.schema.json#/$defs/condition" })).toBeUndefined();
    expect(locator({ properties: { tree, problems: PROBLEMS } })).toEqual({
      properties: new Map([["problems", { items: { problem: true } }]]),
    });
    // Without common.schema.json there is no problem schema to find.
    expect(problemLocator(PROBLEM, base, [])).toBeUndefined();
  });

  it("throws for problems in a schema that refers back to itself: their copies deeper down would be missed", () => {
    const recursive: Record<string, unknown> = { type: "object" };
    recursive["properties"] = { child: recursive, problems: PROBLEMS };
    expect(() => locator(recursive)).toThrow(/refers back to itself/);
    const node: Record<string, unknown> = { type: "object" };
    node["properties"] = { next: { anyOf: [{ type: "null" }, { items: node }] }, problem: PROBLEM };
    // The message names where the schema is.
    expect(() => locator({ properties: { list: { items: node } } })).toThrow(
      `the problems of ${base}#/properties/list/items cannot be located: the schema refers back to itself`,
    );
  });

  it("finds the problems behind patternProperties, additionalProperties, prefixItems, then and else", () => {
    const problem: ProblemLocator = { problem: true };
    const list = { items: problem };
    expect(
      locator({
        properties: { named: PROBLEM },
        patternProperties: { "^x-": PROBLEMS, "^y-": { type: "string" } },
        additionalProperties: PROBLEM,
      }),
    ).toEqual({
      properties: new Map([["named", problem]]),
      // A pattern without problems is kept too: the properties it matches are not additional.
      patternProperties: [
        { pattern: /^x-/u, locator: list },
        { pattern: /^y-/u, locator: {} },
      ],
      additionalProperties: problem,
    });
    expect(locator({ prefixItems: [{ type: "string" }, PROBLEM], items: PROBLEMS })).toEqual({
      prefixItems: [undefined, problem],
      items: list,
    });
    expect(locator({ prefixItems: [{ type: "string" }], items: { type: "number" } })).toBeUndefined();
    expect(
      locator({ if: PROBLEM, then: { properties: { a: PROBLEM } }, else: { properties: { b: PROBLEMS } } }),
    ).toEqual({
      properties: new Map([
        ["a", problem],
        ["b", list],
      ]),
    });
    // Places that depend on the schema they are in are kept apart from the others of the value.
    expect(locator({ anyOf: [{ additionalProperties: PROBLEM }, { properties: { c: PROBLEM } }] })).toEqual({
      properties: new Map([["c", problem]]),
      also: [{ additionalProperties: problem }],
    });
    expect(locator({ allOf: [{ additionalProperties: PROBLEM }, { prefixItems: [PROBLEM] }] })).toEqual({
      also: [{ additionalProperties: problem }, { prefixItems: [problem] }],
    });
  });

  it("finds the problems of every product command that has them", () => {
    const contracts = loadContracts();
    const located = (name: string): ProblemLocator | undefined => {
      const entry = contracts.entry(name);
      return entry && problemLocator(entry.output, base, schemas);
    };
    const list = { items: { problem: true } };
    expect(located("workspace.check")).toEqual({ properties: new Map([["problems", list]]) });
    expect(located("hint.list")).toEqual({ properties: new Map([["hints", list]]) });
    expect(located("element.get")).toEqual({
      properties: new Map([["element", { properties: new Map([["problems", list]]) }]]),
    });
    expect(located("trace.affected")).toBeUndefined();
  });
});

// An independent walk over every keyword of an output schema (#319): it finds each reference to
// the problem schema and the place of the value it describes, so that a test can ask the locator
// for each of them. It knows every keyword the catalog uses and fails on any other.

/** A step from a value to a part of it, as a schema keyword names it. */
type Step =
  | { readonly property: string }
  | { readonly pattern: string }
  | { readonly additional: { readonly names: readonly string[]; readonly patterns: readonly string[] } }
  | { readonly item: number };

/** A reference to the problem schema: where the walk found it, and the place it describes (none: no place). */
interface ProblemRef {
  readonly at: string;
  readonly path: readonly Step[] | undefined;
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const entriesOf = (value: unknown): [string, unknown][] => Object.entries(isObject(value) ? value : {});
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

type Path = readonly Step[] | undefined;
/** A schema below a keyword: the schema, the rest of its location after the keyword, its place. */
type Child = readonly [node: unknown, at: string, path: Path];
/** The schemas a keyword holds, from its value and the schema it is in. */
type Keyword = (value: unknown, node: Readonly<Record<string, unknown>>, path: Path) => readonly Child[];

const to = (path: Path, step: Step): Path => path && [...path, step];
const none: Keyword = () => [];
const same: Keyword = (value, _node, path) => [[value, "", path]];
const each: Keyword = (value, _node, path) =>
  listOf(value).map((branch, i) => [branch, `/${String(i)}`, path]);
const nowhere: Keyword = (value) => [[value, "", undefined]];

/**
 * Every keyword of JSON Schema 2020-12 the walk knows (`$ref` aside): where its schemas are in the
 * value. `not`, `if`, `propertyNames`, `contains`, `unevaluated*` and `dependentSchemas` name no
 * place the locator follows; `$defs` is reached through `$ref` only; the rest hold no schema.
 */
const KEYWORDS = new Map<string, Keyword>([
  ["allOf", each],
  ["anyOf", each],
  ["oneOf", each],
  ["then", same],
  ["else", same],
  [
    "properties",
    (value, _node, path) =>
      entriesOf(value).map(([name, child]) => [child, `/${name}`, to(path, { property: name })]),
  ],
  [
    "patternProperties",
    (value, _node, path) =>
      entriesOf(value).map(([pattern, child]) => [child, `/${pattern}`, to(path, { pattern })]),
  ],
  [
    "additionalProperties",
    (value, node, path) => {
      const names = entriesOf(node["properties"]).map(([name]) => name);
      const patterns = entriesOf(node["patternProperties"]).map(([pattern]) => pattern);
      return [[value, "", to(path, { additional: { names, patterns } })]];
    },
  ],
  [
    "prefixItems",
    (value, _node, path) => listOf(value).map((item, i) => [item, `/${String(i)}`, to(path, { item: i })]),
  ],
  ["items", (value, node, path) => [[value, "", to(path, { item: listOf(node["prefixItems"]).length })]]],
  ...["not", "if", "propertyNames", "contains", "unevaluatedItems", "unevaluatedProperties"].map(
    (key) => [key, nowhere] as const,
  ),
  ["dependentSchemas", (value) => entriesOf(value).map(([name, child]) => [child, `/${name}`, undefined])],
  ...[
    ...["$defs", "definitions", "$id", "$schema", "$comment", "$anchor", "title", "description"],
    ...["default", "examples", "deprecated", "readOnly", "writeOnly", "type", "enum", "const", "format"],
    ...["pattern", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
    ...["multipleOf", "required", "minProperties", "maxProperties", "dependentRequired", "minItems"],
    ...["maxItems", "uniqueItems", "minContains", "maxContains", "contentMediaType", "contentEncoding"],
  ].map((key) => [key, none] as const),
]);

/**
 * Every reference to the problem schema in `schema`, every place of a value its schemas describe
 * (`slots`, a problem or not), and the keywords the walk does not know.
 */
const problemRefs = (
  schema: JsonSchema,
  from: string,
): { refs: ProblemRef[]; slots: ProblemRef[]; unknown: string[] } => {
  const byId = new Map(schemas.map((s) => [String(s["$id"]), s] as const));
  const common = byId.get(`${SCHEMA_BASE}common.schema.json`)?.["$defs"];
  const problem = isObject(common) ? common["problem"] : undefined;
  const refs: ProblemRef[] = [];
  const slots: ProblemRef[] = [];
  const unknown: string[] = [];
  const walking = new Set<unknown>();
  const resolve = (ref: string, base: string): { node: unknown; base: string } => {
    const url = new URL(ref, base);
    const pointer = decodeURIComponent(url.hash.slice(1));
    url.hash = "";
    const node = pointer
      .split("/")
      .slice(1)
      .reduce<unknown>(
        (at, part) => (isObject(at) ? at[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined),
        byId.get(url.href),
      );
    return { node, base: url.href };
  };
  const walk = (node: unknown, base: string, at: string, path: Path): void => {
    if (!isObject(node) || walking.has(node)) {
      return;
    }
    walking.add(node);
    if (path !== undefined) {
      slots.push({ at, path });
    }
    for (const [key, value] of Object.entries(node)) {
      const here = `${at}/${key}`;
      const keyword = KEYWORDS.get(key);
      if (key === "$ref" && typeof value === "string") {
        const target = resolve(value, base);
        if (target.node === problem) {
          refs.push({ at: here, path });
        } else {
          walk(target.node, target.base, here, path);
        }
      } else if (keyword === undefined) {
        unknown.push(here);
      } else {
        for (const [child, rest, childPath] of keyword(value, node, path)) {
          walk(child, base, here + rest, childPath);
        }
      }
    }
    walking.delete(node);
  };
  walk(schema, from, "#", []);
  return { refs, slots, unknown };
};

/** A property name for each pattern of `patternProperties` a test walks over. */
const SAMPLE_NAMES: Readonly<Record<string, string>> = { "^x-": "x-sample" };
/** The name of an additional property in a sample value. */
const ADDITIONAL = "additionalSample";

/** The property name or item index of a sample value for `step`. */
const keyOf = (step: Step): string | number => {
  if ("property" in step) {
    return step.property;
  }
  if ("item" in step) {
    return step.item;
  }
  if ("pattern" in step) {
    const name = SAMPLE_NAMES[step.pattern];
    if (name === undefined) {
      throw new Error(`add a property name for the pattern ${step.pattern} to SAMPLE_NAMES`);
    }
    return name;
  }
  const { names, patterns } = step.additional;
  if (names.includes(ADDITIONAL) || patterns.some((pattern) => new RegExp(pattern, "u").test(ADDITIONAL))) {
    throw new Error(`${ADDITIONAL} is not an additional property here: pick another name`);
  }
  return ADDITIONAL;
};

const partOf = (value: unknown, key: string | number): unknown =>
  Array.isArray(value) ? (value as unknown[])[Number(key)] : isObject(value) ? value[String(key)] : undefined;

/** Whether `fillElementShortIds` with `where` fills a problem at `path` of a sample value. */
const locates = (where: ProblemLocator | undefined, path: readonly Step[]): boolean => {
  const keys = path.map(keyOf);
  const sample = keys.reduceRight<unknown>(
    (inner, key) =>
      typeof key === "number" ? [...Array.from({ length: key }, () => null), inner] : { [key]: inner },
    about(N1, "x.md"),
  );
  const filled = where && fillElementShortIds(sample, where, () => ({ elementShortId: "N-0000a1" }));
  const leaf = keys.reduce<unknown>(partOf, filled);
  return isObject(leaf) && leaf["elementShortId"] === "N-0000a1";
};

/**
 * The places of `slots` that hold no problem by the schema (none of `refs` is there) and that
 * `where` fills all the same: a problem-like value there must stay as it is.
 */
const overfilled = (
  where: ProblemLocator | undefined,
  refs: readonly ProblemRef[],
  slots: readonly ProblemRef[],
): string[] => {
  const keysOf = (path: readonly Step[]): string => JSON.stringify(path.map(keyOf));
  const problems = new Set(refs.flatMap(({ path }) => (path === undefined ? [] : [keysOf(path)])));
  return slots.flatMap(({ at, path }) =>
    path === undefined || problems.has(keysOf(path)) || !locates(where, path) ? [] : [at],
  );
};

/**
 * Problem references of output schemas of the catalog that are at no place of the value, on
 * purpose (`command #/path/$ref`). None so far. The problems at these references get no
 * short ID.
 */
const NOT_LOCATED: readonly string[] = [];

describe("every problem of every output schema is located (#319)", () => {
  it("walks every keyword and finds each problem at its place, or at none", () => {
    const schema = {
      type: "object",
      properties: {
        plain: PROBLEMS,
        map: {
          properties: { named: PROBLEM },
          patternProperties: { "^x-": PROBLEM },
          additionalProperties: PROBLEMS,
        },
        tuple: { prefixItems: [{ type: "string" }, PROBLEM], items: PROBLEM },
        conditional: {
          if: PROBLEM,
          then: { properties: { a: PROBLEM } },
          else: { properties: { b: PROBLEMS } },
        },
        mixed: { anyOf: [{ additionalProperties: PROBLEM }, { properties: { c: PROBLEM } }] },
        nowhere: {
          not: PROBLEM,
          propertyNames: PROBLEM,
          contains: PROBLEM,
          dependentSchemas: { a: PROBLEM },
          unevaluatedProperties: PROBLEM,
          $defs: { unused: PROBLEM },
        },
        element: { $ref: "../data-export.schema.json#/$defs/element" },
        // A schema that refers back to itself is walked once.
        filter: { $ref: "../filter.schema.json#/$defs/condition" },
      },
      "x-custom": PROBLEM,
    };
    const { refs, slots, unknown } = problemRefs(schema, base);
    expect(unknown).toEqual(["#/x-custom"]);
    const where = locator(schema);
    const placed = refs.filter((ref) => ref.path !== undefined);
    expect(placed.map((ref) => ref.at)).toEqual([
      "#/properties/plain/items/$ref",
      "#/properties/map/properties/named/$ref",
      "#/properties/map/patternProperties/^x-/$ref",
      "#/properties/map/additionalProperties/items/$ref",
      "#/properties/tuple/prefixItems/1/$ref",
      "#/properties/tuple/items/$ref",
      "#/properties/conditional/then/properties/a/$ref",
      "#/properties/conditional/else/properties/b/items/$ref",
      "#/properties/mixed/anyOf/0/additionalProperties/$ref",
      "#/properties/mixed/anyOf/1/properties/c/$ref",
      "#/properties/element/$ref/allOf/0/$ref/properties/problems/items/$ref",
    ]);
    for (const ref of placed) {
      expect(ref.path && locates(where, ref.path), ref.at).toBe(true);
    }
    // No other place is filled: the string of the prefix, the root, a property that holds a list.
    expect(slots.map((slot) => slot.at)).toEqual(
      expect.arrayContaining(["#", "#/properties/tuple/prefixItems/0", "#/properties/plain"]),
    );
    expect(overfilled(where, refs, slots)).toEqual([]);
    // A locator that fills the string of the prefix is caught.
    const wrong = locator({ properties: { tuple: { items: PROBLEM } } });
    expect(overfilled(wrong, refs, slots)).toContain("#/properties/tuple/prefixItems/0");
    expect(refs.filter((ref) => ref.path === undefined).map((ref) => ref.at)).toEqual([
      "#/properties/conditional/if/$ref",
      "#/properties/nowhere/not/$ref",
      "#/properties/nowhere/propertyNames/$ref",
      "#/properties/nowhere/contains/$ref",
      "#/properties/nowhere/dependentSchemas/a/$ref",
      "#/properties/nowhere/unevaluatedProperties/$ref",
    ]);
    // A place the locator does not have is not located; a pattern or name the sample cannot take fails.
    expect(locates(locator({ properties: { other: PROBLEM } }), [{ property: "named" }])).toBe(false);
    expect(locates(undefined, [])).toBe(false);
    expect(() => keyOf({ pattern: "^z-" })).toThrow(/SAMPLE_NAMES/);
    expect(() => keyOf({ additional: { names: [ADDITIONAL], patterns: [] } })).toThrow(/another name/);
  });

  it("locates every problem of every output schema of the catalog, or names it as an exception", () => {
    const contracts = loadContracts();
    const unknown: string[] = [];
    const missed: string[] = [];
    const nowhere: string[] = [];
    const filledElsewhere: string[] = [];
    let found = 0;
    for (const entry of contracts.commands) {
      const from = `${SCHEMA_BASE}commands/${entry.name}.output.json`;
      const where = problemLocator(entry.output, from, contracts.schemas);
      const walked = problemRefs(entry.output, from);
      unknown.push(...walked.unknown.map((at) => `${entry.name} ${at}`));
      filledElsewhere.push(
        ...overfilled(where, walked.refs, walked.slots).map((at) => `${entry.name} ${at}`),
      );
      for (const { at, path } of walked.refs) {
        found += 1;
        if (path === undefined) {
          nowhere.push(`${entry.name} ${at}`);
        } else if (!locates(where, path)) {
          missed.push(`${entry.name} ${at}`);
        }
      }
    }
    expect(unknown).toEqual([]);
    expect(missed).toEqual([]);
    expect(filledElsewhere).toEqual([]);
    expect(nowhere).toEqual(NOT_LOCATED);
    // Every problem reference the outputs reach: catalog.json and data-export.schema.json. A new
    // one changes this number on purpose.
    expect(found).toBe(35);
  });
});

describe("fillElementShortIds", () => {
  const where = locator({ properties: { problems: PROBLEMS, other: PROBLEMS } }) ?? {};
  const shortIdOf = (problem: Problem & { readonly elementId: string }): ElementNames | undefined =>
    problem.elementId === N1 ? { elementShortId: "N-0000a1" } : undefined;

  it("adds the short ID to the problems that name an element, in a copy", () => {
    const named = about(N1, "needs/N-0000000000a1.md");
    const output = { problems: [{ code: "x", severity: "info", message: "m" }, named], other: [], ok: true };
    const filled = fillElementShortIds(output, where, shortIdOf);
    expect(filled).toEqual({
      ...output,
      problems: [output.problems[0], { ...named, elementShortId: "N-0000a1" }],
    });
    // The output and its problems stay as they were (they may be kept in workspace states).
    expect(named).not.toHaveProperty("elementShortId");
    expect((filled as typeof output).problems[0]).toBe(output.problems[0]);
    expect((filled as typeof output).other).toBe(output.other);
  });

  it("returns the value itself when nothing changes", () => {
    const unknown = about(R2, "x.md");
    const shown = { ...about(N1, "x.md"), elementShortId: "N-1" };
    for (const output of [
      { problems: [unknown, shown] },
      { problems: "not a list" },
      { problems: [null, 3, ["nested"]] },
      { other: [{ ...unknown, elementId: 7 }] },
      "text",
      null,
    ]) {
      expect(fillElementShortIds(output, where, shortIdOf)).toBe(output);
    }
  });
});

describe("fillElementShortIds at every place of a value (#319)", () => {
  const shortIdOf = (): ElementNames => ({ elementShortId: "N-0000a1" });
  const problem = about(N1, "x.md");
  const shown = { ...problem, elementShortId: "N-0000a1" };

  it("fills properties by name, by pattern (named ones too) and the additional ones", () => {
    const where =
      locator({
        properties: { named: PROBLEM, "x-named": { type: "object" }, plain: { type: "string" } },
        patternProperties: { "^x-": PROBLEM },
        additionalProperties: PROBLEMS,
      }) ?? {};
    const output = { named: problem, "x-named": problem, "x-other": problem, plain: "text", more: [problem] };
    expect(fillElementShortIds(output, where, shortIdOf)).toEqual({
      named: shown,
      "x-named": shown,
      "x-other": shown,
      plain: "text",
      more: [shown],
    });
    const untouched = { plain: "text", more: [] };
    expect(fillElementShortIds(untouched, where, shortIdOf)).toBe(untouched);
  });

  it("fills the items of a prefix by position and the items after it", () => {
    const where = locator({ prefixItems: [{ type: "object" }, PROBLEM], items: PROBLEMS }) ?? {};
    expect(fillElementShortIds([problem, problem, [problem], [problem]], where, shortIdOf)).toEqual([
      problem,
      shown,
      [shown],
      [shown],
    ]);
    const short = [problem];
    expect(fillElementShortIds(short, where, shortIdOf)).toBe(short);
    // A prefix without items after it: those are not places.
    const prefixOnly = locator({ prefixItems: [PROBLEM] }) ?? {};
    expect(fillElementShortIds([problem, problem], prefixOnly, shortIdOf)).toEqual([shown, problem]);
  });

  it("fills no property that is named or matched, and no item of the prefix, as an additional one or one after it", () => {
    const named = locator({ properties: { a: { type: "object" } }, additionalProperties: PROBLEM }) ?? {};
    expect(fillElementShortIds({ a: problem, b: problem }, named, shortIdOf)).toEqual({
      a: problem,
      b: shown,
    });
    const matched =
      locator({ patternProperties: { "^y-": { type: "object" } }, additionalProperties: PROBLEM }) ?? {};
    expect(fillElementShortIds({ "y-1": problem, z: problem }, matched, shortIdOf)).toEqual({
      "y-1": problem,
      z: shown,
    });
    const prefixed = locator({ prefixItems: [{ type: "object" }], items: PROBLEM }) ?? {};
    expect(fillElementShortIds([problem, problem], prefixed, shortIdOf)).toEqual([problem, shown]);
  });

  it("fills the places of every schema that applies to the value, kept apart or not", () => {
    const where =
      locator({ anyOf: [{ additionalProperties: PROBLEM }, { properties: { c: PROBLEMS } }] }) ?? {};
    expect(fillElementShortIds({ c: [problem], d: problem }, where, shortIdOf)).toEqual({
      c: [shown],
      d: shown,
    });
    // `c` is an additional property of the first branch: it is filled there when it is a problem.
    expect(fillElementShortIds({ c: problem }, where, shortIdOf)).toEqual({ c: shown });
  });
});

describe("withElementShortIds", () => {
  const where = locator({ properties: { problems: PROBLEMS } });

  it("changes nothing without problems that name an element", async () => {
    const workspace = await open();
    const output = { problems: [{ code: "x", severity: "info", message: "m" }] };
    expect(await withElementShortIds(workspace, undefined, named(N1))).toEqual(named(N1));
    expect(await withElementShortIds(workspace, where, output)).toBe(output);
    expect(workspace.peek(elementStoreState)).toBeUndefined();
  });

  it("leaves the short ID out and reads nothing when the store or the metamodel is not built (ADR-0008)", async () => {
    const workspace = await open();
    const output = named(N1);
    expect(await withElementShortIds(workspace, where, output)).toBe(output);
    expect(workspace.peek(elementStoreState)).toBeUndefined();
    expect(workspace.peek(metamodelState)).toBeUndefined();
    await workspace.get(elementStoreState);
    expect(await withElementShortIds(workspace, where, output)).toBe(output);
    expect(workspace.peek(metamodelState)).toBeUndefined();
    expect(workspace.peek(shortIdState)).toBeUndefined();
  });

  it("takes the short IDs the workspace has, else builds them from the store and metamodel without keeping them", async () => {
    const workspace = await open();
    await Promise.all([workspace.get(elementStoreState), workspace.get(metamodelState)]);
    const expected = { problems: [{ ...named(N1).problems[0], elementShortId: "N-0000a1" }] };
    expect(await withElementShortIds(workspace, where, named(N1))).toEqual(expected);
    expect(workspace.peek(shortIdState)).toBeUndefined();
    await workspace.get(shortIdState);
    expect(await withElementShortIds(workspace, where, named(N1))).toEqual(expected);
    // An element that is not in the store has no short ID.
    const stray = named(`${P}ee`);
    expect(await withElementShortIds(workspace, where, stray)).toBe(stray);
  });

  it("names the copy a problem is about when files share a UUID (SR-088)", async () => {
    const workspace = await open({
      ...HINTS,
      files: {
        "requirements/SR-0000000000a1.md":
          "---\nid: " + N1 + "\ntype: system-requirement\nstatus: draft\ntitle: Copy\n---\n",
      },
    });
    const store = await workspace.get(elementStoreState);
    await workspace.get(metamodelState);
    const copy = { problems: [about(N1, "requirements/SR-0000000000a1.md")] };
    expect(await withElementShortIds(workspace, where, copy)).toEqual({
      problems: [{ ...copy.problems[0], elementShortId: "SR-0000a1" }],
    });
    // A file that holds no copy of the UUID: none of the two is meant.
    expect(problemElement(store, about(N1, "elsewhere.md"))).toBeUndefined();
    expect(problemElement(store, about(R2, "elsewhere.md"))?.file).toBe("requirements/SR-0000000000b2.md");
  });
});

describe("withElementShortIds takes one view of the workspace (ADR-0008, #319)", () => {
  const where = locator({ properties: { problems: PROBLEMS } });
  const expected = { problems: [{ ...named(N1).problems[0], elementShortId: "N-0000a1" }] };

  /** Short IDs of a newer store, in which another UUID ends like N1's: N1's short ID grows there. */
  const newerShortIds = async (workspace: Workspace): Promise<ShortIds> => {
    const [store, metamodel] = await Promise.all([
      workspace.get(elementStoreState),
      workspace.get(metamodelState),
    ]);
    const twin = "26a0b000-0000-4000-8000-0000010000a1";
    const records = store.byId.get(N1) ?? [];
    const newer = new Map(store.byId).set(
      twin,
      records.map((record) => ({ ...record, id: twin })),
    );
    const shortIds = buildShortIds(newer, metamodel);
    expect(records.map((record) => shortIds.of(record))).toEqual(["N-00000a1"]);
    return shortIds;
  };

  it("uses kept short IDs only when they are of the store and the metamodel it takes", async () => {
    const workspace = await open();
    const [store, metamodel] = await Promise.all([
      workspace.get(elementStoreState),
      workspace.get(metamodelState),
    ]);
    const kept = workspace.get(shortIdState);
    expect(shortIdsBuiltFrom(await kept, store.byId, metamodel)).toBe(true);
    const newer = await newerShortIds(workspace);
    expect(shortIdsBuiltFrom(newer, store.byId, metamodel)).toBe(false);
    expect(await workspace.replace(shortIdState, kept, Promise.resolve(newer))).toBe(true);
    expect(await withElementShortIds(workspace, where, named(N1))).toEqual(expected);
    // Of another metamodel, or not built by buildShortIds at all.
    const other = await open();
    const otherMetamodel = await other.get(metamodelState);
    expect(shortIdsBuiltFrom(buildShortIds(store.byId, otherMetamodel), store.byId, metamodel)).toBe(false);
    expect(shortIdsBuiltFrom({ ...(await kept) }, store.byId, metamodel)).toBe(false);
  });

  it("takes the states together, so that a change while it runs does not mix two stores", async () => {
    const workspace = await open();
    await Promise.all([workspace.get(elementStoreState), workspace.get(metamodelState)]);
    const kept = workspace.get(shortIdState);
    const keptOf = vi.spyOn(await kept, "of");
    const newer = await newerShortIds(workspace);
    const newerOf = vi.spyOn(newer, "of");
    const running = withElementShortIds(workspace, where, named(N1));
    // A watcher batch replaces the short IDs after the call took its view.
    expect(await workspace.replace(shortIdState, kept, Promise.resolve(newer))).toBe(true);
    expect(await running).toEqual(expected);
    // The kept short IDs gave the short ID: none were built, the newer ones were not asked.
    expect(keptOf).toHaveBeenCalledTimes(1);
    expect(newerOf).not.toHaveBeenCalled();
  });

  it("uses the short IDs carried over a change of the store, without building them again (#184)", async () => {
    const workspace = await open();
    const [, metamodel] = await Promise.all([
      workspace.get(elementStoreState),
      workspace.get(metamodelState),
    ]);
    await workspace.get(shortIdState);
    const store = await applyStoreChange(workspace, (before) =>
      Promise.resolve({ ...before, byId: new Map(before.byId) }),
    );
    const carried = await workspace.peek(shortIdState);
    expect(store && carried && shortIdsBuiltFrom(carried, store.byId, metamodel)).toBe(true);
    const carriedOf = carried && vi.spyOn(carried, "of");
    expect(await withElementShortIds(workspace, where, named(N1))).toEqual(expected);
    expect(carriedOf).toHaveBeenCalledTimes(1);
  });

  it("names the copy outdated evidence is about by its element file when files share a UUID (SR-088)", async () => {
    const workspace = await open({
      ...HINTS,
      files: {
        "requirements/SR-0000000000b4.md":
          "---\nid: " + R4 + "\ntype: system-requirement\nstatus: draft\ntitle: Copy\n---\n",
      },
    });
    await Promise.all([workspace.get(elementStoreState), workspace.get(metamodelState)]);
    const evidence = (elementFile: string): Problem & { readonly elementId: string } =>
      about(R4, "evidence/results.xml", {
        code: "evidence.outdated",
        line: 3,
        elementRepository: "system",
        elementFile,
      });
    for (const [file, shortId] of [
      ["requirements/SAF-0000000000b4.md", "SAF-0000b4"],
      ["requirements/SR-0000000000b4.md", "SR-0000b4"],
    ] as const) {
      const output = { problems: [evidence(file)] };
      expect(await withElementShortIds(workspace, where, output)).toEqual({
        problems: [{ ...output.problems[0], elementShortId: shortId }],
      });
    }
    // The record file alone names none of the two copies.
    const unnamed = { problems: [about(R4, "evidence/results.xml", { code: "evidence.outdated" })] };
    expect(await withElementShortIds(workspace, where, unnamed)).toBe(unnamed);
  });
});

describe("every command names the short ID of the element of each problem (#315)", () => {
  it("workspace.check, hint.list and element.get give the same problems, with short IDs", async () => {
    const workspace = await open();
    const check = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    const named = check.problems.filter((p) => p.elementId !== undefined);
    expect(named.length).toBeGreaterThan(5);
    for (const problem of named) {
      expect(problem.elementShortId).toMatch(/^[A-Z]+-0000[a-f0-9]{2}$/);
    }
    // The problems kept in the workspace states stay without it.
    expect((await workspace.get(requiredProblemsState)).every((p) => p.elementShortId === undefined)).toBe(
      true,
    );
    const shown = (await invoke("element.get", { ref: R2 }, { workspace })) as CommandOutput<"element.get">;
    expect(shown.element.problems?.map((p) => p.elementShortId)).toContain("SR-0000b2");
  });

  it("gives the same short IDs against an invalid metamodel, whatever ran before on the workspace (SR-080 AK2)", async () => {
    const files = {
      "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: 5\n",
      "needs/N-1111110000a1.md": "---\nid: " + N1 + "\ntype: need\nstatus: draft\ntitle: Copy\n---\n",
    };
    const checked = async (warm: boolean): Promise<CommandOutput<"workspace.check">> => {
      const workspace = await open({ ...HINTS, files });
      if (warm) {
        await invoke("element.get", { ref: R2 }, { workspace });
        expect(workspace.peek(shortIdState)).toBeDefined();
      }
      return (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    };
    const fresh = await checked(false);
    const duplicates = fresh.problems.filter((p) => p.code === "element.duplicate-id");
    expect(duplicates.map((p) => p.elementShortId)).toEqual(["N-0000a1", "N-0000a1"]);
    expect(await checked(true)).toEqual(fresh);
  });

  it("builds the locator of a command on its first call, before the command runs (#319)", async () => {
    const recursive: Record<string, unknown> = { type: "object" };
    recursive["properties"] = { child: recursive, problems: PROBLEMS };
    const catalog = {
      "reqseq-catalog": 1,
      commands: [
        {
          name: "test.recursive",
          title: "Test command",
          summary: "Problems in a schema that refers back to itself (test only).",
          effect: "read",
          stage: 1,
          implements: ["SR-080"],
          arguments: [],
          input: { type: "object" },
          output: recursive,
        },
      ],
    };
    let runs = 0;
    const command = defineTestCommand<object, unknown>({
      name: "test.recursive",
      run: () => {
        runs += 1;
        return Promise.resolve({});
      },
    });
    // Creating the runtime builds no locator, so it does not fail here.
    const runtime = createCommandRuntime({ contracts: loadContracts({ catalog }), commands: [command] });
    const workspace = await open();
    await expect(runtime.invoke("test.recursive", {}, { workspace })).rejects.toMatchObject({
      code: "internal",
    });
    expect(runs).toBe(0);
  });

  it("leaves it out for a command that names an element without having read the store", async () => {
    const catalog = {
      "reqseq-catalog": 1,
      commands: [
        {
          name: "test.named",
          title: "Test command",
          summary: "A problem about an element (test only).",
          effect: "read",
          stage: 1,
          implements: ["SR-080"],
          arguments: [],
          input: { type: "object" },
          output: { type: "object", properties: { problems: PROBLEMS } },
        },
      ],
    };
    const command = defineTestCommand<object, unknown>({
      name: "test.named",
      run: () => Promise.resolve(named(N1)),
    });
    const runtime = createCommandRuntime({
      contracts: loadContracts({ catalog }),
      commands: [command],
      validateOutput: true,
    });
    const workspace = await open();
    expect(await runtime.invoke("test.named", {}, { workspace })).toEqual(named(N1));
    await Promise.all([workspace.get(elementStoreState), workspace.get(metamodelState)]);
    expect(await runtime.invoke("test.named", {}, { workspace })).toEqual({
      problems: [{ ...named(N1).problems[0], elementShortId: "N-0000a1" }],
    });
  });
});
