// The graph buffer's data (SR-111, D-063): the input of `trace.graph` the buffer asks with, and the words
// a node and the modeline show. Everything shown is a value of the output (ADR-0002, SR-080 AK4); the app
// only adds the size limit and the words for the marks. No React here.
import type { TraceGraphInput, TraceGraphOutput } from "@reqseq/core";
import type { GraphBuffer, GraphDepth } from "./buffers.js";
import type { GraphFilterChoice } from "./graph-choices.js";

/** The most nodes a graph asks for: the size SR-111 AK6 lays out within a second. */
export const GRAPH_LIMIT = 500;

/** The deepest number of levels before "the whole chain". */
export const MAX_DEPTH = 9;

export type GraphNode = TraceGraphOutput["nodes"][number];
export type GraphEdge = TraceGraphOutput["edges"][number];
export type GraphMark = GraphNode["marks"][number];
/** The summary of the evidence below a node (SR-111 AK3, `withEvidence`). */
export type GraphEvidence = NonNullable<TraceGraphOutput["evidence"]>[number];

/**
 * The input of `trace.graph` for the buffer: its element, depth, kinds, meanings, evidence and view, at
 * most 500 nodes.
 */
export const graphInput = (buffer: GraphBuffer): Partial<TraceGraphInput> => ({
  ref: buffer.id,
  repository: buffer.repository,
  ...(buffer.depth === "all" ? { allLevels: true } : { maxDepth: buffer.depth }),
  ...(buffer.kinds === undefined ? {} : { kinds: buffer.kinds }),
  ...(buffer.meanings === undefined ? {} : { meanings: buffer.meanings }),
  ...(buffer.withEvidence === true ? { withEvidence: true } : {}),
  ...(buffer.view === undefined ? {} : { view: buffer.view }),
  limit: GRAPH_LIMIT,
});

/** A node's key: a UUID may exist in several repositories. */
export const nodeKey = (repository: string, id: string): string => `${repository}:${id}`;

export const keyOfNode = (node: Pick<GraphNode, "repository" | "id">): string =>
  nodeKey(node.repository, node.id);

/** One level more (`+`): 1 to 9, then the whole chain, which stays. */
export const deeper = (depth: GraphDepth): GraphDepth =>
  depth === "all" || depth >= MAX_DEPTH ? "all" : depth + 1;

/** One level less (`-`): the whole chain gives 9, and 1 stays. */
export const shallower = (depth: GraphDepth): GraphDepth =>
  depth === "all" ? MAX_DEPTH : Math.max(1, depth - 1);

/** "1 level", "3 levels", "whole chain". */
export const depthLabel = (depth: GraphDepth): string =>
  depth === "all" ? "whole chain" : `${String(depth)} level${depth === 1 ? "" : "s"}`;

/**
 * "only Derivations, Based on" when the buffer follows some kinds only, each by the name of its entry in
 * the relation kind prompts (`graph-choices.ts`; the meanings first, then the kinds, then "Evidence"), a
 * key that no entry names as it is; "with Evidence" for every kind and the evidence; nothing for every
 * kind (D-062).
 */
export const filterLabel = (
  buffer: GraphBuffer,
  choices: readonly GraphFilterChoice[] = [],
): string | undefined => {
  const evidence =
    buffer.withEvidence === true
      ? (choices.find((choice) => choice.filter.withEvidence === true)?.name ?? "Evidence")
      : undefined;
  if (buffer.kinds === undefined && buffer.meanings === undefined) {
    return evidence === undefined ? undefined : `with ${evidence}`;
  }
  const named = (field: "kinds" | "meanings", key: string): string =>
    choices.find((choice) => {
      const keys: readonly string[] | undefined = choice.filter[field];
      return keys?.length === 1 && keys[0] === key;
    })?.name ?? key;
  const followed = [
    ...(buffer.meanings ?? []).map((meaning) => named("meanings", meaning)),
    ...(buffer.kinds ?? []).map((kind) => named("kinds", kind)),
    ...(evidence === undefined ? [] : [evidence]),
  ];
  return followed.length === 0 ? "nothing followed" : `only ${followed.join(", ")}`;
};

/** The words of the marks (SR-111 AK4), in the order of the output. */
export const MARK_WORDS: Readonly<Record<GraphMark, string>> = {
  outdated: "outdated",
  superseded: "superseded",
  "no-evidence": "no evidence",
};

/** What a node is called: its identifier, else its short ID. */
export const nodeId = (node: GraphNode): string => node.identifier ?? node.shortId;

/** `n thing`, `n things`. */
const counted = (n: number, thing: string): string => `${String(n)} ${thing}${n === 1 ? "" : "s"}`;

/**
 * The text of an evidence box, with the counts of the CLI's line (`present.ts`):
 * "evidence · 2 test cases, 1 record · 2 passed, 1 failed", a count of 0 left out, the results in the
 * order of the output.
 */
export const evidenceText = (summary: GraphEvidence): string => {
  const kinds = [
    ...(summary.testCases > 0 ? [counted(summary.testCases, "test case")] : []),
    ...(summary.records > 0 ? [counted(summary.records, "record")] : []),
  ].join(", ");
  const results = Object.entries(summary.results)
    .map(([result, n]) => `${String(n)} ${result}`)
    .join(", ");
  return ["evidence", ...[kinds, results].filter((part) => part !== "")].join(" · ");
};

/**
 * The accessible name of a node: "<ID> <type> <title>" and its marks, then the summary of its evidence
 * when it has one (its box is no option, so the node says it).
 */
export const nodeLabel = (node: GraphNode, typeName: string, evidence?: GraphEvidence): string =>
  [
    nodeId(node),
    typeName,
    node.title,
    ...node.marks.map((mark) => MARK_WORDS[mark]),
    ...(evidence === undefined ? [] : [evidenceText(evidence)]),
  ].join(" ");

/** The word of an inline reference in an edge's text: the metamodel names no such kind (SR-154 AK1). */
export const REFERENCE_NAME = "Refers to";

/**
 * The name of a link's kind (SR-154 AK1): the name of its relation kind or relation property from the
 * metamodel (`kindNames`, by key), its key when the metamodel names none, `REFERENCE_NAME` for an inline
 * reference.
 */
export const kindName = (link: GraphEdge, kindNames: ReadonlyMap<string, string>): string =>
  link.kind === undefined ? REFERENCE_NAME : (kindNames.get(link.kind) ?? link.kind);

/**
 * The lines of a drawn link's text (SR-154 AK1, AK2): one per link it draws, read along the arrow,
 * "SR-111 Derives from N-071", with "· outdated" when the link is outdated (SR-025). `nameOf` names
 * a node by its key.
 */
export const edgeLines = (
  links: readonly GraphEdge[],
  nameOf: (key: string) => string,
  kindNames: ReadonlyMap<string, string>,
): string[] =>
  links.map((link) =>
    [
      nameOf(nodeKey(link.sourceRepository, link.source)),
      kindName(link, kindNames),
      nameOf(nodeKey(link.targetRepository, link.target)),
      ...(link.outdated ? ["· outdated"] : []),
    ].join(" "),
  );

/**
 * The classes of a drawn link: `derivation` (a darker grey) when one of its links derives, `reference`
 * (dashed) when all are inline references, `outdated` (the accent) when one is outdated, `selected`
 * (the text colour, which `outdated` keeps its accent over) when it is a link of the selected node that
 * `spotlit` lights up.
 */
export const edgeClasses = (links: readonly GraphEdge[], selected: boolean): string =>
  [
    "graph-edge",
    ...(links.some((link) => link.meaning === "derivation") ? ["derivation"] : []),
    ...(links.every((link) => link.link === "reference") ? ["reference"] : []),
    ...(links.some((link) => link.outdated) ? ["outdated"] : []),
    ...(selected ? ["selected"] : []),
  ].join(" ");

/**
 * Whether the links of the selected node are lit up (drawn in the text colour): only when it has at least
 * one and they are at most half of the drawn links, so that lighting up says something and a big fan
 * does not darken the sheet (D-062). A graph of depth 1 or a package graph, where most links touch the
 * element, opens calm; a node with few links among many stands out.
 */
export const spotlit = (
  paths: readonly { readonly source: string; readonly target: string }[],
  selected: string,
): boolean => {
  const touching = paths.filter((path) => path.source === selected || path.target === selected).length;
  return touching > 0 && 2 * touching <= paths.length;
};
