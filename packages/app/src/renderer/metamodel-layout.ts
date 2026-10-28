// Where the boxes of the metamodel graph stand and how its curves run (SR-130 AK2, D-063): pure display.
// dagre (ADR-0015) ranks the boxes from the top down, each edge's target above its source, so a parent
// type stands above its subtypes and the target types of a relation kind above its source types (review
// B1). The edges are ranked in the order of the graph, the inheritance first, and an edge joins the
// ranking only while the ranked edges stay free of cycles: inheritance has none (core rejects them), so
// every parent stands above its subtypes; a relation kind or property that would close a cycle (one that
// runs from a parent to its subtype, or the opposite of a ranked edge) is drawn afterwards between the
// placed boxes, from the right quarter of each. Every curve ends in an arrowhead at its target, so the
// direction reads also where it is not "up". dagre reserves room for the label of every ranked edge and
// loop: a ranked label sits on its curve, a loop's to the right of its box, where the loop runs. A label
// of an edge drawn afterwards stands beside its curve, in the first place along it that no box and no
// other label takes.
// The height of a box follows from its lines (`styles.css` sets the same). Its width is the width of its
// widest line, measured by the view in the fonts the sheet draws them with (`Measure`), at least
// `TYPE_WIDTH`, so no name and no property is ever cut; a label is as wide as its widest line.
// Known limitations: a curve that carries both "extends" and a relation kind (one ordered pair) is drawn
// in the look of the inheritance; a curve drawn afterwards runs straight between its two boxes and may
// cross a box of a layer between them (review N1, N2 of #631).
import type { Point } from "./dagre.js";
import { layoutGraphOf, runLayout } from "./dagre.js";
import { edgePath } from "./graph-layout.js";
import type { MetamodelEdge, MetamodelGraph, MetamodelLink, MetamodelNode } from "./metamodel-graph.js";
import { linkLabel } from "./metamodel-graph.js";

/** The width of a box in CSS pixels. */
export const TYPE_WIDTH = 224;
/** Border and padding above and below the lines of a box. */
export const TYPE_PAD = 7;
/** The first line of a box: name, prefix, "abstract". */
export const TYPE_HEADER = 22;
/** One line per property. */
export const TYPE_LINE = 18;
/** The space between two boxes of a layer, and between two layers (dagre halves it around a label). */
export const NODE_SEP = 48;
export const RANK_SEP = 64;
/** One line of a label, and the padding left and right of its widest line. */
export const LABEL_LINE = 16;
const LABEL_PAD = 8;
/** Border and padding left and right of the lines of a box, the gap between the parts of its first line, and room to spare. */
const TYPE_INSET = 9;
const HEAD_GAP = 8;
const SPARE = 4;
/** How far a curve drawn afterwards leaves and enters a box straight before it bends. */
const GUIDE = RANK_SEP / 2;
/** How far a loop reaches out of the right edge of its box, and how far its ends are apart. */
const LOOP_REACH = 28;
const LOOP_SPAN = 20;
/** The gap between a curve drawn afterwards and its label beside it. */
const LABEL_GAP = 6;

/** The height of the box of `node`: the header and one line per property. */
export const typeHeight = (node: MetamodelNode): number =>
  TYPE_PAD * 2 + TYPE_HEADER + node.properties.length * TYPE_LINE;

/**
 * The fonts of the lines (`styles.css`): the name of a type, "abstract" and the prefix, a property, a
 * label line.
 */
export type TextFont = "name" | "small" | "property" | "label";

/** The width of `text` in `font`, in CSS pixels. */
export type Measure = (text: string, font: TextFont) => number;

/** Average widths of a character per font: what the layout assumes where nothing can measure (tests). */
const CHAR_WIDTH: Readonly<Record<TextFont, number>> = { name: 8.5, small: 7, property: 7.5, label: 7 };

export const estimate: Measure = (text, font) => text.length * CHAR_WIDTH[font];

/** The width of the box of `node`: its widest line with border, padding and room to spare, at least `TYPE_WIDTH`. */
export const typeWidth = (node: MetamodelNode, measure: Measure): number => {
  const head = node.any
    ? measure(node.name, "name")
    : measure(node.name, "name") +
      (node.abstract ? HEAD_GAP + measure("abstract", "small") : 0) +
      HEAD_GAP +
      measure(node.prefix, "small");
  const lines = [head, ...node.properties.map((property) => measure(property.name, "property"))];
  return Math.max(TYPE_WIDTH, Math.ceil(Math.max(...lines) + 2 * TYPE_INSET + SPARE));
};

/** The label lines of an edge, and the room they take. */
export const labelSize = (
  links: readonly MetamodelLink[],
  measure: Measure = estimate,
): { width: number; height: number } => ({
  width: Math.ceil(Math.max(...links.map((link) => measure(linkLabel(link), "label"))) + LABEL_PAD + SPARE),
  height: links.length * LABEL_LINE,
});

/** A box and its place: `x` and `y` are its top left corner; `layer` counts the layers from the top. */
export interface PlacedType {
  readonly key: string;
  readonly node: MetamodelNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly layer: number;
}

/** A label's box: its top left corner and size. */
export interface LabelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One drawn curve: its edge, the SVG path from the source to the target, and its label. */
export interface MetamodelPath {
  readonly source: string;
  readonly target: string;
  readonly links: readonly MetamodelLink[];
  readonly d: string;
  readonly label: LabelBox;
  /** Left out of the ranking (it would close a cycle) and drawn between the placed boxes. */
  readonly drawnAfter: boolean;
}

export interface MetamodelLayout {
  readonly width: number;
  readonly height: number;
  /** In the order of the graph: the types, then "Any type". */
  readonly nodes: readonly PlacedType[];
  readonly byKey: ReadonlyMap<string, PlacedType>;
  /** The layers from the top, each from left to right. */
  readonly layers: readonly (readonly PlacedType[])[];
  readonly paths: readonly MetamodelPath[];
}

/** Where a box stands, as dagre placed it. */
type Box = Pick<PlacedType, "x" | "y" | "width" | "height" | "layer">;

/**
 * A loop on the right edge of the box, out to its label and back, ending in the box. dagre reserves the
 * label's room to the right of the box, at its height, sometimes a box gap away: the loop reaches it.
 */
const loopPoints = (box: Box, label: LabelBox): Point[] => {
  const right = box.x + box.width;
  const middle = box.y + box.height / 2;
  const reach = Math.max(LOOP_REACH, label.x - LABEL_GAP - right);
  return [
    { x: right, y: middle - LOOP_SPAN / 2 },
    { x: right + reach, y: middle - LOOP_SPAN },
    { x: right + reach, y: middle + LOOP_SPAN },
    { x: right, y: middle + LOOP_SPAN / 2 },
  ];
};

/** Two boxes overlap. */
const overlap = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The first of the `candidates` places of a label that stays on the sheet (not left of or above the
 * drawing) and overlaps none of the `taken` boxes; the first candidate when none is free.
 */
export const freeSpot = (
  candidates: readonly [LabelBox, ...LabelBox[]],
  taken: readonly LabelBox[],
): LabelBox =>
  candidates.find((spot) => spot.x >= 0 && spot.y >= 0 && !taken.some((box) => overlap(spot, box))) ??
  candidates[0];

/**
 * A curve drawn after the layout from the box `from` down to the box `to` (an edge that would close a
 * cycle runs from a box to one that the ranked edges put below it), from and to the right quarter of
 * each: straight out of the bottom of `from`, across, and straight into the top of `to`. Its label may
 * stand beside the middle of the curve, then nearer to its target or its source, right or left of it:
 * the places in that order.
 */
const afterwards = (
  from: Box,
  to: Box,
  size: { width: number; height: number },
): { points: Point[]; spots: [LabelBox, ...LabelBox[]] } => {
  const start = { x: from.x + (from.width * 3) / 4, y: from.y + from.height };
  const end = { x: to.x + (to.width * 3) / 4, y: to.y };
  const first = { x: start.x, y: start.y + GUIDE };
  const last = { x: end.x, y: end.y - GUIDE };
  const beside = (share: number, right: boolean): LabelBox => {
    const x = first.x + (last.x - first.x) * share;
    const y = first.y + (last.y - first.y) * share;
    return {
      x: right ? x + LABEL_GAP : x - LABEL_GAP - size.width,
      y: y - size.height / 2,
      ...size,
    };
  };
  return {
    points: [start, first, last, end],
    spots: [
      beside(0.5, true),
      ...[0.5, 0.75, 0.25, 1, 0].flatMap((share) => [
        ...(share === 0.5 ? [] : [beside(share, true)]),
        beside(share, false),
      ]),
    ],
  };
};

/**
 * Places the boxes of the graph and draws its edges; deterministic: the same graph gives the same
 * layout. Every edge joins nodes of the graph (`metamodelGraph`); `measure` gives the width of a line.
 */
export const layoutMetamodel = (graph: MetamodelGraph, measure: Measure = estimate): MetamodelLayout => {
  // Every edge given to dagre reserves room for its label, so dagre gives each a label centre.
  const dagre = layoutGraphOf<Point>();
  dagre.setGraph({
    rankdir: "TB",
    ranker: "tight-tree",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: 0,
    marginy: 0,
  });
  for (const node of graph.nodes) {
    dagre.setNode(node.key, { width: typeWidth(node, measure), height: typeHeight(node) });
  }
  // The ranked edges from the upper end (the target) to the lower one; an edge whose source reaches its
  // target along them would close a cycle.
  const below = new Map<string, string[]>();
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const stack = [from];
    for (let key = stack.pop(); key !== undefined; key = stack.pop()) {
      for (const next of below.get(key) ?? []) {
        if (next === to) {
          return true;
        }
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return false;
  };
  const after = new Set<MetamodelEdge>();
  for (const edge of graph.edges) {
    if (edge.source !== edge.target && reaches(edge.source, edge.target)) {
      after.add(edge);
      continue;
    }
    if (edge.source !== edge.target) {
      below.set(edge.target, [...(below.get(edge.target) ?? []), edge.source]);
    }
    dagre.setEdge(edge.target, edge.source, {
      minlen: 1,
      weight: 1,
      ...labelSize(edge.links, measure),
      labelpos: "c",
    });
  }
  runLayout(dagre);
  const rows = [...new Set(graph.nodes.map((node) => dagre.node(node.key).y))].sort((a, b) => a - b);
  const boxAt = (key: string): Box => {
    const { x, y, width, height } = dagre.node(key);
    return { x: x - width / 2, y: y - height / 2, width, height, layer: rows.indexOf(y) };
  };
  const nodes = graph.nodes.map((node): PlacedType => ({ key: node.key, node, ...boxAt(node.key) }));
  // The labels dagre placed first; a label drawn afterwards takes a free place among them and the boxes.
  const placedLabels = new Map(
    graph.edges
      .filter((edge) => !after.has(edge))
      .map((edge) => {
        const placed = dagre.edge(edge.target, edge.source);
        const size = labelSize(edge.links, measure);
        return [edge, { x: placed.x - size.width / 2, y: placed.y - size.height / 2, ...size }] as const;
      }),
  );
  const taken: LabelBox[] = [...nodes, ...placedLabels.values()];
  const paths = graph.edges.map((edge): MetamodelPath => {
    const { source, target, links } = edge;
    const from = boxAt(source);
    const label = placedLabels.get(edge);
    if (label === undefined) {
      const { points, spots } = afterwards(from, boxAt(target), labelSize(links, measure));
      const spot = freeSpot(spots, taken);
      taken.push(spot);
      return { source, target, links, d: edgePath(points), label: spot, drawnAfter: true };
    }
    // dagre's points run from the upper end (the target) down to the source.
    const points =
      source === target ? loopPoints(from, label) : [...dagre.edge(target, source).points].reverse();
    return { source, target, links, d: edgePath(points), label, drawnAfter: false };
  });
  const byKey = new Map(nodes.map((box) => [box.key, box]));
  const layers = rows.map((_, layer) => nodes.filter((box) => box.layer === layer).sort((a, b) => a.x - b.x));
  // dagre's drawing starts at 0; a curve drawn afterwards, and its label, may reach beyond its right edge.
  const right = paths.map((path) => path.label.x + path.label.width);
  return {
    width: Math.max(dagre.graph().width, ...right),
    height: dagre.graph().height,
    nodes,
    byKey,
    layers,
    paths,
  };
};
