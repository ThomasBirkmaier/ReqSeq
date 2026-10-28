import { describe, expect, it } from "vitest";
import type { Point } from "./dagre.js";
import type { MetamodelEdge, MetamodelGraph, TypeNode } from "./metamodel-graph.js";
import { metamodelGraph } from "./metamodel-graph.js";
import type { MetamodelLayout, PlacedType } from "./metamodel-layout.js";
import {
  TYPE_HEADER,
  TYPE_LINE,
  TYPE_PAD,
  TYPE_WIDTH,
  estimate,
  freeSpot,
  labelSize,
  typeWidth,
  layoutMetamodel,
} from "./metamodel-layout.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";

/** The points a path passes through: its start, the ends of its pieces and of its lines. */
const onCurve = (d: string): Point[] =>
  [...d.matchAll(/([MLC])([^MLC]*)/g)].map(([, command, numbers]) => {
    const values = (numbers ?? "").trim().split(/[ ,]/).map(Number);
    const [x, y] = command === "C" ? values.slice(4) : values;
    return { x: x ?? Number.NaN, y: y ?? Number.NaN };
  });

const box = (layout: MetamodelLayout, key: string): PlacedType => {
  const found = layout.byKey.get(key);
  if (found === undefined) {
    throw new Error(`no box ${key}`);
  }
  return found;
};

const inside = (point: Point, area: { x: number; y: number; width: number; height: number }): boolean =>
  point.x >= area.x - 0.1 &&
  point.x <= area.x + area.width + 0.1 &&
  point.y >= area.y - 0.1 &&
  point.y <= area.y + area.height + 0.1;

/** On an edge of the box (within 0.1 px). */
const onEdge = (point: Point, area: PlacedType): boolean =>
  inside(point, area) &&
  ([area.x, area.x + area.width].some((x) => Math.abs(point.x - x) < 0.1) ||
    [area.y, area.y + area.height].some((y) => Math.abs(point.y - y) < 0.1));

/**
 * A curve from its source to its target, its label as large as its lines: a loop on the right edge of
 * its box with the label right of it; a curve drawn afterwards with its label between its boxes; a
 * ranked curve with its target above its source, passing through its label.
 */
const expectCurve = (layout: MetamodelLayout, path: MetamodelLayout["paths"][number]): void => {
  const source = box(layout, path.source);
  const target = box(layout, path.target);
  const points = onCurve(path.d);
  const name = `${path.source} > ${path.target}`;
  expect(path.label).toMatchObject(labelSize(path.links));
  // From the source to the target: the arrowhead the view puts at its end points at the target.
  expect(onEdge(points[0] ?? { x: -1, y: -1 }, source), `${name} starts at its source`).toBe(true);
  expect(onEdge(points.at(-1) ?? { x: -1, y: -1 }, target), `${name} ends at its target`).toBe(true);
  if (path.source === path.target) {
    // A loop on the right edge of its box, its label right of the loop at the height of the box.
    expect(Math.min(...points.map((point) => point.x)), name).toBeCloseTo(source.x + source.width, 0);
    expect(path.label.x, name).toBeGreaterThan(Math.max(...points.map((point) => point.x)));
    expect(path.label.y + path.label.height / 2, name).toBeCloseTo(source.y + source.height / 2, 0);
  } else if (path.drawnAfter) {
    // Beside its curve, between the bottom of the source and the top of the target, on the sheet.
    expect(path.label.y, name).toBeGreaterThanOrEqual(source.y + source.height);
    expect(path.label.y + path.label.height, name).toBeLessThanOrEqual(target.y);
    expect(path.label.x, name).toBeGreaterThanOrEqual(0);
  } else {
    // The target above the source, and the curve passing through its label.
    expect(target.y + target.height, name).toBeLessThan(source.y);
    expect(
      points.some((point) => inside(point, path.label)),
      name,
    ).toBe(true);
  }
};

const typeNode = (key: string, properties = 0): TypeNode => ({
  key,
  any: false,
  type: key,
  name: key,
  prefix: "X",
  abstract: false,
  properties: Array.from({ length: properties }, (_, index) => ({
    key: `p${String(index)}`,
    name: `P${String(index)}`,
    inherited: false,
  })),
});

const edge = (source: string, target: string, name = `${source}-${target}`): MetamodelEdge => ({
  source,
  target,
  links: [{ link: "relation", kind: name, name }],
});

const graphOf = (keys: readonly string[], edges: readonly MetamodelEdge[]): MetamodelGraph => ({
  nodes: keys.map((key) => typeNode(key)),
  edges,
});

describe("layoutMetamodel", () => {
  it("[SR-130/AK2] places every parent and every target type above, each node as tall as its properties, a loop beside its node and every label on its curve", () => {
    const graph = metamodelGraph(FIXTURE_METAMODEL);
    const layout = layoutMetamodel(graph);
    expect(layout.nodes.map((placed) => [placed.key, placed.width, placed.height])).toEqual([
      ["type:item", TYPE_WIDTH, 2 * TYPE_PAD + TYPE_HEADER + TYPE_LINE],
      ["type:requirement", TYPE_WIDTH, 2 * TYPE_PAD + TYPE_HEADER + 3 * TYPE_LINE],
      ["type:software-requirement", TYPE_WIDTH, 2 * TYPE_PAD + TYPE_HEADER + 4 * TYPE_LINE],
      ["type:decision", TYPE_WIDTH, 2 * TYPE_PAD + TYPE_HEADER + TYPE_LINE],
      ["type:package", TYPE_WIDTH, 2 * TYPE_PAD + TYPE_HEADER + TYPE_LINE],
      ["any", TYPE_WIDTH, 2 * TYPE_PAD + TYPE_HEADER],
    ]);
    // No two boxes overlap.
    for (const a of layout.nodes) {
      for (const b of layout.nodes.filter((other) => other !== a)) {
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${a.key} and ${b.key}`).toBe(true);
      }
    }
    expect(layout.paths).toHaveLength(graph.edges.length);
    for (const path of layout.paths) {
      expectCurve(layout, path);
    }
    // Every parent above its subtypes.
    for (const path of layout.paths.filter((candidate) =>
      candidate.links.some((link) => link.link === "extends"),
    )) {
      expect(path.drawnAfter).toBe(false);
      expect(box(layout, path.target).y + box(layout, path.target).height).toBeLessThan(
        box(layout, path.source).y,
      );
    }
    // No label covers a box or another label.
    const areas = [...layout.nodes, ...layout.paths.map((path) => path.label)];
    for (const [index, a] of areas.entries()) {
      for (const b of areas.slice(index + 1)) {
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, JSON.stringify([a, b])).toBe(true);
      }
    }
    // Every label within the drawing.
    for (const path of layout.paths) {
      expect(path.label.x).toBeGreaterThanOrEqual(0);
      expect(path.label.x + path.label.width).toBeLessThanOrEqual(layout.width);
      expect(path.label.y + path.label.height).toBeLessThanOrEqual(layout.height);
    }
    for (const placed of layout.nodes) {
      expect(placed.x + placed.width).toBeLessThanOrEqual(layout.width);
      expect(placed.y + placed.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it("[SR-130/AK2] keeps a parent above its subtype when a relation kind runs from the parent to the subtype, and draws that curve and the opposite of a ranked one afterwards, down to their targets", () => {
    const layout = layoutMetamodel(metamodelGraph(FIXTURE_METAMODEL));
    expect(
      layout.paths.filter((path) => path.drawnAfter).map((path) => `${path.source} > ${path.target}`),
    ).toEqual(["type:requirement > type:software-requirement", "type:decision > any"]);
    const parent = box(layout, "type:requirement");
    const child = box(layout, "type:software-requirement");
    expect(parent.y + parent.height).toBeLessThan(child.y);
    const decision = box(layout, "type:decision");
    const any = box(layout, "any");
    expect(decision.y + decision.height).toBeLessThan(any.y);
    // Based on (any > decision) is ranked: Decision above "Any type"; Traces to runs down from Decision
    // and ends on the top of "Any type", from the right quarter of each box.
    const traces = layout.paths.find((path) => path.source === "type:decision" && path.target === "any");
    const points = onCurve(traces?.d ?? "");
    expect(points[0]).toEqual({ x: decision.x + (decision.width * 3) / 4, y: decision.y + decision.height });
    expect(points.at(-1)).toEqual({ x: any.x + (any.width * 3) / 4, y: any.y });
  });

  it("gives the layers from the top, each from left to right, and the same layout for the same graph", () => {
    const layout = layoutMetamodel(metamodelGraph(FIXTURE_METAMODEL));
    expect(
      layout.layers
        .flat()
        .map((placed) => placed.key)
        .sort(),
    ).toEqual(layout.nodes.map((placed) => placed.key).sort());
    for (const [index, layer] of layout.layers.entries()) {
      expect(layer.every((placed) => placed.layer === index)).toBe(true);
      expect(layer.map((placed) => placed.x)).toEqual(
        [...layer.map((placed) => placed.x)].sort((a, b) => a - b),
      );
    }
    expect(layout.layers.map((layer) => layer.map((placed) => placed.key))).toEqual([
      ["type:package", "type:item"],
      ["type:requirement", "type:decision"],
      ["type:software-requirement", "any"],
    ]);
    expect(layoutMetamodel(metamodelGraph(FIXTURE_METAMODEL))).toEqual(layout);
  });

  it("lays out a cycle of three, an opposite pair, a diamond and loops without throwing, each cycle closed by one curve drawn afterwards", () => {
    const layout = layoutMetamodel(
      graphOf(
        ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
        [
          edge("a", "b"),
          edge("b", "c"),
          edge("c", "a"),
          edge("d", "e"),
          edge("e", "d"),
          edge("a", "f"),
          edge("f", "f"),
          edge("c", "f"),
          edge("a", "a"),
          // A diamond above j: g is reached from j by two ways, and g > k closes no cycle.
          edge("h", "g"),
          edge("i", "g"),
          edge("j", "h"),
          edge("j", "i"),
          edge("g", "k"),
        ],
      ),
    );
    expect(
      layout.paths.filter((path) => path.drawnAfter).map((path) => `${path.source}>${path.target}`),
    ).toEqual(["c>a", "e>d"]);
    expect(layout.nodes.every((placed) => Number.isFinite(placed.x) && Number.isFinite(placed.y))).toBe(true);
  });

  it("makes a label as wide as its longest line and a line high per link, and a graph without edges as wide as its boxes", () => {
    expect(
      labelSize([{ link: "extends" }, { link: "relation", kind: "r", name: "Refines", open: "both" }]),
    ).toEqual({ width: 31 * 7 + 8 + 4, height: 32 });
    const layout = layoutMetamodel(graphOf(["a", "b"], []));
    expect(layout.width).toBe(2 * TYPE_WIDTH + 48);
    expect(layout.height).toBe(2 * TYPE_PAD + TYPE_HEADER);
    expect(layout.layers).toHaveLength(1);
  });

  it("puts a label in the first place that stays on the sheet and is free, else in the first place", () => {
    const at = (x: number, y: number) => ({ x, y, width: 10, height: 10 });
    const taken = [at(0, 0)];
    expect(freeSpot([at(5, 5), at(-20, 0), at(0, -20), at(20, 0)], taken)).toEqual(at(20, 0));
    expect(freeSpot([at(5, 5), at(-20, 0)], taken)).toEqual(at(5, 5));
    // Touching edges do not overlap.
    expect(freeSpot([at(10, 0)], taken)).toEqual(at(10, 0));
  });

  it("makes a box as wide as its widest line, in the widths `measure` gives, and at least 224 px", () => {
    const wide = { ...typeNode("t", 1), name: "N".repeat(30), prefix: "PRE", abstract: true };
    // Every character 10 px: the head is name, gap, "abstract", gap, prefix, inside border and padding.
    const tens = (text: string): number => text.length * 10;
    expect(typeWidth(wide, tens)).toBe(300 + 8 + 80 + 8 + 30 + 18 + 4);
    expect(typeWidth({ ...wide, abstract: false }, tens)).toBe(300 + 8 + 30 + 18 + 4);
    const property = { ...typeNode("t"), properties: [{ key: "p", name: "P".repeat(40), inherited: true }] };
    expect(typeWidth(property, tens)).toBe(400 + 18 + 4);
    expect(typeWidth({ key: "any", any: true, name: "Any type", properties: [] }, tens)).toBe(TYPE_WIDTH);
    expect(typeWidth(typeNode("t"), estimate)).toBe(TYPE_WIDTH);
    // The layout places a box with that width, and a label with the width of its widest line.
    const layout = layoutMetamodel(
      { nodes: [wide, typeNode("u")], edges: [edge("t", "u", "Long name")] },
      tens,
    );
    expect(layout.nodes[0]?.width).toBe(typeWidth(wide, tens));
    expect(layout.paths[0]?.label.width).toBe(90 + 8 + 4);
  });
});
