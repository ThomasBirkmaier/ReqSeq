// The choices of a graph (SR-111 AK2 and AK3): its depth, and the relation kinds it follows. The command
// prompt offers them on a graph ("Graph depth", "Show only relation kind", "Also show relation kind",
// `actions.ts`); each entry gives the graph buffer to show, whose input `trace.graph` answers again
// (`graphInput`). The kinds come from the catalog and the metamodel as they are, by their names: the
// meanings of `trace.graph`'s input and every relation kind and property of kind `relation` (ADR-0002).
// The app decides nothing about them: core follows a link whose key is in `kinds` or whose meaning is in
// `meanings`. No React here.
import type { MetamodelGetOutput, TraceGraphInput } from "@logreq/core";
import type { CommandListing } from "../shared/protocol.js";
import type { GraphBuffer, GraphDepth } from "./buffers.js";
import { MAX_DEPTH } from "./graph.js";

type Meaning = NonNullable<TraceGraphInput["meanings"]>[number];

/** The links a graph follows: the input of `trace.graph` without both lists means every link. */
export interface GraphFilter {
  readonly kinds?: TraceGraphInput["kinds"];
  readonly meanings?: TraceGraphInput["meanings"];
}

/**
 * One entry of the relation kind prompts: its name, the key as hint, and the links it stands for. A later
 * named view (a preset of several kinds) is one more entry of the same shape.
 */
export interface GraphFilterChoice {
  readonly name: string;
  readonly hint?: string;
  readonly filter: GraphFilter;
  /**
   * The meaning of a relation kind in the metamodel: core follows the kind too when the filter holds that
   * meaning, so "Also show" does not offer it then (SR-110 AK1: no entry that changes nothing).
   */
  readonly meaning?: string;
}

/** One entry of a graph's prompt: what it is called, and the graph buffer that taking it shows. */
export interface GraphChoice {
  readonly id: string;
  readonly name: string;
  readonly hint?: string;
  readonly buffer: GraphBuffer;
}

/** The hint of the current depth in "Graph depth": the keys that go one level more or less from it. */
export const DEPTH_KEYS = "+ / -";

/** The names of the meanings of `trace.graph`'s input; a meaning not named here is shown as it is. */
const MEANING_NAMES: Readonly<Record<string, string>> = {
  derivation: "Derivations",
  replacement: "Replacements",
  exclusion: "Exclusions",
  reference: "Inline references",
};

/** "Everything": no filter, every relation and inline reference is followed. */
export const EVERYTHING: GraphFilterChoice = { name: "Everything", filter: {} };

/** The meanings that `trace.graph` takes, from its input schema in the catalog; none when it is not listed. */
export const graphMeanings = (catalog: readonly CommandListing[]): readonly string[] => {
  const graph = catalog.find((command) => command.name === "trace.graph");
  const input = graph?.input as
    | {
        readonly properties?: Readonly<
          Record<string, { readonly items?: { readonly enum?: readonly unknown[] } } | undefined>
        >;
      }
    | undefined;
  return (input?.properties?.["meanings"]?.items?.enum ?? []).map(String);
};

/**
 * The entries of "Show only relation kind": "Everything", the meanings of `trace.graph` by their names,
 * then every relation kind and every property of kind `relation` by its name in the metamodel, with its
 * key as hint.
 */
export const graphFilterChoices = (
  meanings: readonly string[],
  metamodel: Pick<MetamodelGetOutput, "relations" | "properties">,
): readonly GraphFilterChoice[] => [
  EVERYTHING,
  // The values are the enum of the input schema; core checks them like any input.
  ...meanings.map((meaning) => ({
    name: MEANING_NAMES[meaning] ?? meaning,
    filter: { meanings: [meaning as Meaning] },
  })),
  ...metamodel.relations.map((kind) => ({
    name: kind.name,
    hint: kind.key,
    filter: { kinds: [kind.key] },
    ...(kind.meaning === undefined ? {} : { meaning: kind.meaning }),
  })),
  ...metamodel.properties
    .filter((property) => property.kind === "relation")
    .map((property) => ({ name: property.name, hint: property.key, filter: { kinds: [property.key] } })),
];

/** The graph buffer follows some kinds only. */
export const hasFilter = (buffer: GraphBuffer): boolean =>
  buffer.kinds !== undefined || buffer.meanings !== undefined;

/** The buffer with `filter` in place of its own; the depth, view and selection stay. */
const withFilter = (buffer: GraphBuffer, filter: GraphFilter): GraphBuffer => {
  const { kinds: _kinds, meanings: _meanings, ...rest } = buffer;
  return { ...rest, ...filter };
};

const union = <T>(
  held: readonly T[] | undefined,
  added: readonly T[] | undefined,
): readonly T[] | undefined =>
  held === undefined && added === undefined ? undefined : [...new Set([...(held ?? []), ...(added ?? [])])];

/** The buffer that also follows what `filter` follows: core follows the union of kinds and meanings. */
const withAlso = (buffer: GraphBuffer, filter: GraphFilter): GraphBuffer => {
  const kinds = union(buffer.kinds, filter.kinds);
  const meanings = union(buffer.meanings, filter.meanings);
  return withFilter(buffer, {
    ...(kinds === undefined ? {} : { kinds }),
    ...(meanings === undefined ? {} : { meanings }),
  });
};

/**
 * Whether everything the entry follows is followed already: its kinds and meanings are in the filter, or
 * it is a relation kind whose meaning the filter holds (core follows a link whose key is in `kinds` or
 * whose meaning is in `meanings`).
 */
const followed = (buffer: GraphBuffer, choice: GraphFilterChoice): boolean =>
  (buffer.meanings ?? []).some((meaning) => meaning === choice.meaning) ||
  ((choice.filter.kinds ?? []).every((kind) => buffer.kinds?.includes(kind) === true) &&
    (choice.filter.meanings ?? []).every((meaning) => buffer.meanings?.includes(meaning) === true));

/** The ID of an entry: what it follows ("everything" for nothing in particular). */
const idOf = (choice: GraphFilterChoice): string => {
  const keys = [
    ...(choice.filter.meanings ?? []).map((meaning) => `meaning:${meaning}`),
    ...(choice.filter.kinds ?? []).map((kind) => `kind:${kind}`),
  ];
  return keys.length === 0 ? "everything" : keys.join(" ");
};

const entry = (choice: GraphFilterChoice, buffer: GraphBuffer): GraphChoice => ({
  id: idOf(choice),
  name: choice.name,
  ...(choice.hint === undefined ? {} : { hint: choice.hint }),
  buffer,
});

/** The name of a depth in "Graph depth". */
const depthName = (depth: GraphDepth): string =>
  depth === "all" ? "Whole chain" : depth === 1 ? "Direct neighbours" : `${String(depth)} levels`;

/**
 * "Graph depth" (AK2): the direct neighbours, 2 to 9 levels and the whole chain; the current one has the
 * keys `+ / -` as hint. Taking one shows the graph at that depth, as `+` and `-` do.
 */
export const depthChoices = (buffer: GraphBuffer): readonly GraphChoice[] =>
  [...Array.from({ length: MAX_DEPTH }, (_, index): GraphDepth => index + 1), "all" as const].map(
    (depth) => ({
      id: `depth:${String(depth)}`,
      name: depthName(depth),
      ...(depth === buffer.depth ? { hint: DEPTH_KEYS } : {}),
      buffer: { ...buffer, depth },
    }),
  );

/** "Show only relation kind" (AK3): every entry; taking one replaces the filter. */
export const onlyChoices = (
  buffer: GraphBuffer,
  choices: readonly GraphFilterChoice[],
): readonly GraphChoice[] => choices.map((choice) => entry(choice, withFilter(buffer, choice.filter)));

/**
 * "Also show relation kind" (AK3): the entries without "Everything" and without those the filter follows
 * already (a relation kind whose meaning it holds too); taking one adds it to the filter. None without a
 * filter: then everything is followed.
 */
export const alsoChoices = (
  buffer: GraphBuffer,
  choices: readonly GraphFilterChoice[],
): readonly GraphChoice[] =>
  hasFilter(buffer)
    ? choices
        .filter((choice) => choice !== EVERYTHING && !followed(buffer, choice))
        .map((choice) => entry(choice, withAlso(buffer, choice.filter)))
    : [];
