// Part of the CLI output for people (`../present.ts`, whose comment describes the layout): a chain
// (trace.chain) as a tree per direction.
import type { Names, Rec } from "./common.js";
import { isElement, isRecord, join, listOf, nodeKey, text, withIdentifier } from "./common.js";
import { elementLine } from "./element.js";
import { evidenceLines, recordLine } from "./evidence.js";

/** A node of a chain (trace.chain `nodes`), as far as the tree reads it. */
interface ChainNode extends Rec {
  readonly id: string;
  readonly repository: string;
  readonly shortId: string;
  readonly title: string;
  readonly depth: number;
}

/** An edge of a chain: from the child that stores it (`source`) to its parent (`target`). */
interface ChainEdge extends Rec {
  readonly source: string;
  readonly sourceRepository: string;
  readonly target: string;
  readonly targetRepository: string;
  readonly direction: string;
  readonly cyclic: boolean;
}

/**
 * How a trace.neighbourhood edge (one with `link`) relates when its meaning is not `derivation`: the
 * relation kind, else the link (`reference`); "" for a derivation and for an edge of trace.chain (#643).
 */
const otherKindOf = (edge: ChainEdge): string => {
  if (typeof edge["link"] !== "string" || edge["meaning"] === "derivation") {
    return "";
  }
  return typeof edge["kind"] === "string" ? edge["kind"] : edge["link"];
};

/** What the tree of a chain reads (`trace.chain`); gaps and unresolved derivations are read loosely. */
interface Chain extends Rec {
  readonly nodes: readonly ChainNode[];
  readonly edges: readonly ChainEdge[];
}

const isChainNode = (value: unknown): value is ChainNode =>
  isElement(value) &&
  typeof value["id"] === "string" &&
  typeof value["repository"] === "string" &&
  typeof value["depth"] === "number";

const isChainEdge = (value: unknown): value is ChainEdge =>
  isRecord(value) &&
  ["source", "sourceRepository", "target", "targetRepository", "direction"].every(
    (key) => typeof value[key] === "string",
  ) &&
  typeof value["cyclic"] === "boolean";

/** A chain: nodes with an ID, repository and depth, and edges between them. */
export const isChain = (output: Rec): output is Chain =>
  Array.isArray(output["nodes"]) &&
  Array.isArray(output["edges"]) &&
  output["nodes"].every(isChainNode) &&
  output["edges"].every(isChainEdge);

/** The short ID of an element of the chain, its UUID when it is not on this page. */
const shortIdIn = (chain: Chain, repository: string, id: string): string =>
  chain.nodes.find((n) => n.id === id && n.repository === repository)?.shortId ?? id;

/**
 * A derivation the chain could not follow: `up from SHORT-ID  kind  SHORT-ID  title  [state]`, the
 * other end by short ID when it has one, else by UUID.
 */
const unresolvedLine = (item: Rec, chain: Chain): string => {
  const other = text(item["shortId"]);
  return join(
    `${text(item["direction"])} from ${shortIdIn(chain, text(item["fromRepository"]), text(item["from"]))}`,
    text(item["kind"]),
    other === "" ? text(item["id"]) : withIdentifier(other, item["identifier"]),
    text(item["title"]),
    `[${text(item["targetState"])}]`,
  );
};

/** The key of the root among the nodes; `root/up` and `root/down` hold its parents and children. */
const ROOT = "root";

/** Marks by node key: `JSON` of `[direction, repository, id]`, or `root`. */
type Marks = Map<string, string[]>;

export const mark = (marks: Marks, key: string, text: string): void => {
  marks.set(key, [...(marks.get(key) ?? []), text]);
};

/**
 * The mark of a gap: `[gap: no evidence]`; a requirement the view does not hold is no gap (#674):
 * `[not in view, holds in core, VAR-x]`, the variants by short ID when `names` has them.
 */
const gapMark = (gap: Rec, names: Names): string => {
  if (gap["kind"] !== "not-in-view") {
    return `[gap: ${text(gap["kind"]).replaceAll("-", " ")}]`;
  }
  const views = listOf(gap["views"]).map((view) => names.get(text(view))?.shortId ?? text(view));
  return `[not in view${views.length === 0 ? ", holds in no view" : `, holds in ${views.join(", ")}`}]`;
};

/** The marks of the gaps of each element of the chain, by `nodeKey("", repository, id)`. */
const gapMarks = (chain: Chain, names: Names): Marks => {
  const gaps: Marks = new Map();
  for (const gap of listOf(chain["gaps"]).filter(isRecord)) {
    mark(gaps, nodeKey("", text(gap["repository"]), text(gap["id"])), gapMark(gap, names));
  }
  return gaps;
};

/** The evidence items of a chain (`evidence`) by `nodeKey("", repository, id)`, read loosely. */
const evidenceByNode = (chain: Chain): ReadonlyMap<string, Rec> =>
  new Map(
    listOf(chain["evidence"])
      .filter(isRecord)
      .map((item) => [nodeKey("", text(item["repository"]), text(item["id"])), item]),
  );

/**
 * The mark of an edge from another page on the node it leads to: `[under X]` for the edge the node
 * was reached by (`first`; never the root, which no edge reaches: an edge into it closes a cycle),
 * else `[cycle from X]` or `[also under X]`.
 */
const offPageMark = (first: boolean, cyclic: boolean, from: string): string =>
  first ? `[under ${from}]` : cyclic ? `[cycle from ${from}]` : `[also under ${from}]`;

/** The tree of a chain (see `treeOf`). */
interface Tree {
  readonly children: ReadonlyMap<
    string,
    readonly { readonly key: string; readonly node: ChainNode; readonly kind: string }[]
  >;
  /** References printed below the node an edge starts at (that node is on the page). */
  readonly references: ReadonlyMap<string, readonly string[]>;
  /** Marks on the node an edge leads to, for edges that start on another page. */
  readonly marks: Marks;
  readonly placed: ReadonlySet<string>;
}

/**
 * Tree edges: the first edge that reaches a node from a node of this page one level nearer the root.
 * Every other edge to it is a reference: below the node it starts at (`SHORT-ID  [cycle]`,
 * `SHORT-ID  [listed elsewhere]`), or, when that node is on another page, a mark on the node it leads
 * to: `[under X]` for the first edge to it (the one it was reached by), then `[cycle from X]` or
 * `[also under X]`.
 */
const treeOf = (chain: Chain, nodes: ReadonlyMap<string, ChainNode>, root: ChainNode | undefined): Tree => {
  const children = new Map<
    string,
    { readonly key: string; readonly node: ChainNode; readonly kind: string }[]
  >();
  const references: Marks = new Map();
  const marks: Marks = new Map();
  const placed = new Set<string>();
  const isRoot = (repository: string, id: string): boolean =>
    root?.repository === repository && root.id === id;
  for (const edge of chain.edges) {
    const [nearRepository, near, farRepository, far] =
      edge.direction === "up"
        ? [edge.sourceRepository, edge.source, edge.targetRepository, edge.target]
        : [edge.targetRepository, edge.target, edge.sourceRepository, edge.source];
    const nearKey = isRoot(nearRepository, near)
      ? `${ROOT}/${edge.direction}`
      : nodeKey(edge.direction, nearRepository, near);
    const nearNode = isRoot(nearRepository, near) ? root : nodes.get(nearKey);
    const farKey = isRoot(farRepository, far) ? ROOT : nodeKey(edge.direction, farRepository, far);
    const farNode = nodes.get(farKey);
    const farLabel = shortIdIn(chain, farRepository, far);
    const nearLabel = shortIdIn(chain, nearRepository, near);
    if (nearNode === undefined) {
      // The edge starts on another page: shown at the node it leads to.
      const first = farKey !== ROOT && !placed.has(farKey) && !marks.has(farKey);
      mark(marks, farKey, offPageMark(first, edge.cyclic, nearLabel));
    } else if (farNode !== undefined && !placed.has(farKey) && nearNode.depth === farNode.depth - 1) {
      placed.add(farKey);
      children.set(nearKey, [
        ...(children.get(nearKey) ?? []),
        { key: farKey, node: farNode, kind: otherKindOf(edge) },
      ]);
    } else {
      mark(references, nearKey, join(farLabel, edge.cyclic ? "[cycle]" : "[listed elsewhere]"));
    }
  }
  return { children, references, marks, placed };
};

/** The chain as a tree per direction: the root, then `parents:` and `children:` (see the file comment). */
export const chainLines = (chain: Chain, names: Names): string[] => {
  const width = String(Math.max(...chain.nodes.map((n) => n.depth), 0)).length;
  const gaps = gapMarks(chain, names);
  const keyOf = (node: ChainNode): string =>
    node.depth === 0 ? ROOT : nodeKey(text(node["direction"]), node.repository, node.id);
  const nodes = new Map(chain.nodes.map((node) => [keyOf(node), node]));
  const root = nodes.get(ROOT);
  const { children, references, marks, placed } = treeOf(chain, nodes, root);
  const evidence = evidenceByNode(chain);
  const line = (node: ChainNode, kind = ""): string =>
    join(
      elementLine(node),
      kind === "" ? "" : `[${kind}]`,
      ...(gaps.get(nodeKey("", node.repository, node.id)) ?? []),
      node["expanded"] === false ? "[not expanded]" : "",
      ...(marks.get(keyOf(node)) ?? []),
    );
  // The depth in front, then two spaces per level of the tree below the first.
  const prefix = (depth: number, level: number): string =>
    `  ${String(depth).padStart(width)}  ${"  ".repeat(level - 1)}`;
  const lines: string[] = root === undefined ? [] : [line(root)];
  // The evidence of a node of the downward chain (or the root) one level below it.
  const evidenceOf = (node: ChainNode, level: number): void => {
    const item = node["direction"] === "up" ? undefined : evidence.get(nodeKey("", node.repository, node.id));
    if (item !== undefined) {
      const at = prefix(node.depth + 1, level + 1);
      lines.push(...evidenceLines(item, at, `${" ".repeat(at.length)}  `, names));
    }
  };
  if (root !== undefined) {
    evidenceOf(root, 0);
    // The root's validation records (#646), one level below it, each with its version (SR-038 AK2).
    for (const record of listOf(chain["validationRecords"]).filter(isRecord)) {
      lines.push(
        `${prefix(1, 1)}${join(
          "validation",
          recordLine(record, true, names),
          text(record["version"]) === "" ? "" : `[version ${text(record["version"])}]`,
        )}`,
      );
    }
  }
  const walk = (key: string, depth: number, level: number): void => {
    for (const child of children.get(key) ?? []) {
      lines.push(`${prefix(child.node.depth, level + 1)}${line(child.node, child.kind)}`);
      evidenceOf(child.node, level + 1);
      walk(child.key, child.node.depth, level + 1);
    }
    for (const reference of references.get(key) ?? []) {
      lines.push(`${prefix(depth + 1, level + 1)}${reference}`);
    }
  };
  for (const [direction, label, otherLabel] of [
    ["up", "parents:", "upward:"],
    ["down", "children:", "downward:"],
  ] as const) {
    const section = chain.nodes.filter((node) => node["direction"] === direction);
    if (section.length > 0) {
      const derivedOnly = chain.edges.every(
        (edge) => edge.direction !== direction || otherKindOf(edge) === "",
      );
      lines.push(derivedOnly ? label : otherLabel);
      walk(`${ROOT}/${direction}`, 0, 0);
      // Nodes whose parent is on another page: not nested, the parent named by `[under X]`.
      for (const node of section) {
        const key = keyOf(node);
        if (!placed.has(key)) {
          lines.push(`${prefix(node.depth, 1)}${line(node)}`);
          evidenceOf(node, 1);
          walk(key, node.depth, 1);
        }
      }
    }
  }
  const unresolved = listOf(chain["unresolved"])
    .filter(isRecord)
    .map((item) => `  ${unresolvedLine(item, chain)}`);
  return [...lines, ...(unresolved.length === 0 ? [] : ["unresolved:", ...unresolved])];
};
