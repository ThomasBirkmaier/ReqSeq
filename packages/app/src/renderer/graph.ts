// The graph buffer's data (SR-111, D-063): the input of `trace.graph` the buffer asks with, and the words
// a node and the modeline show. Everything shown is a value of the output (ADR-0002, SR-080 AK4); the app
// only adds the size limit and the words for the marks. No React here.
import type { TraceGraphInput, TraceGraphOutput } from "@logreq/core";
import type { GraphBuffer, GraphDepth } from "./buffers.js";

/** The most nodes a graph asks for: the size SR-111 AK6 lays out within a second. */
export const GRAPH_LIMIT = 500;

/** The deepest number of levels before "the whole chain". */
export const MAX_DEPTH = 9;

export type GraphNode = TraceGraphOutput["nodes"][number];
export type GraphEdge = TraceGraphOutput["edges"][number];
export type GraphMark = GraphNode["marks"][number];

/** The input of `trace.graph` for the buffer: its element, depth, kinds, meanings and view, at most 500 nodes. */
export const graphInput = (buffer: GraphBuffer): Partial<TraceGraphInput> => ({
  ref: buffer.id,
  repository: buffer.repository,
  ...(buffer.depth === "all" ? { allLevels: true } : { maxDepth: buffer.depth }),
  ...(buffer.kinds === undefined ? {} : { kinds: buffer.kinds }),
  ...(buffer.meanings === undefined ? {} : { meanings: buffer.meanings }),
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

/** "only derivation, based-on" when the buffer follows some kinds only; nothing for every kind (D-062). */
export const filterLabel = (buffer: GraphBuffer): string | undefined => {
  if (buffer.kinds === undefined && buffer.meanings === undefined) {
    return undefined;
  }
  const followed = [...(buffer.meanings ?? []), ...(buffer.kinds ?? [])];
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

/** The accessible name of a node: "<ID> <type> <title>" and its marks. */
export const nodeLabel = (node: GraphNode, typeName: string): string =>
  [nodeId(node), typeName, node.title, ...node.marks.map((mark) => MARK_WORDS[mark])].join(" ");

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
 * Whether the links of the selected node are lit up (drawn in the text colour): only when some drawn link
 * does not touch it, so that lighting up says something (D-062). In a graph of depth 1 every link touches
 * the element, and it opens calm.
 */
export const spotlit = (
  paths: readonly { readonly source: string; readonly target: string }[],
  selected: string,
): boolean => paths.some((path) => path.source !== selected && path.target !== selected);
