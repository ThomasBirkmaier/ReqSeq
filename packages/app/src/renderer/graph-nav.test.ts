import { describe, expect, it } from "vitest";
import type { EdgePath, GraphLayout, PlacedNode } from "./graph-layout.js";
import { GRAPH_MOVES, graphStep } from "./graph-nav.js";
import { graphNode } from "./graph-test-data.js";

// Fixed places, three layers:
//        P1(0)        P2(300)
//               R(150)
//   C1(0)   C2(200)   C3(400)
// Links: R to P1 and P2; C1, C2 and C3 to R; C3 to P2 (past R).
const place = (name: string, x: number, layer: number): PlacedNode => ({
  key: name,
  node: graphNode(name, layer - 1),
  x,
  y: layer * 100,
  layer,
});
const nodes = [
  place("R", 150, 1),
  place("P1", 0, 0),
  place("P2", 300, 0),
  place("C1", 0, 2),
  place("C2", 200, 2),
  place("C3", 400, 2),
];
const path = (source: string, target: string): EdgePath => ({ source, target, links: [], d: "" });
const byKey = new Map(nodes.map((node) => [node.key, node]));
const layer = (...names: string[]): PlacedNode[] => names.flatMap((name) => byKey.get(name) ?? []);
const layout: GraphLayout = {
  width: 624,
  height: 268,
  nodes,
  byKey,
  layers: [layer("P1", "P2"), layer("R"), layer("C1", "C2", "C3")],
  paths: [
    path("R", "P1"),
    path("R", "P2"),
    path("C1", "R"),
    path("C2", "R"),
    path("C3", "R"),
    path("C3", "P2"),
    path("R", "gone"),
  ],
};

const step = (from: string, key: string): string | undefined => graphStep(layout, "R", from, key);

describe("graphStep", () => {
  it("[SR-111/AK5] moves along links up and down to the node nearest in x", () => {
    expect(step("R", "ArrowUp")).toBe("P1");
    expect(step("R", "ArrowDown")).toBe("C2");
    expect(step("C3", "ArrowUp")).toBe("P2");
    expect(step("C1", "ArrowUp")).toBe("R");
    expect(step("P1", "ArrowUp")).toBeUndefined();
    expect(step("C1", "ArrowDown")).toBeUndefined();
  });

  it("[SR-111/AK5] moves through a layer with Left and Right, from layer to layer with Page Up and Page Down, Home to the element", () => {
    expect(step("C2", "ArrowLeft")).toBe("C1");
    expect(step("C2", "ArrowRight")).toBe("C3");
    expect(step("C1", "ArrowLeft")).toBeUndefined();
    expect(step("C3", "ArrowRight")).toBeUndefined();
    expect(step("C3", "PageUp")).toBe("R");
    expect(step("R", "PageUp")).toBe("P1");
    expect(step("P2", "PageDown")).toBe("R");
    expect(step("R", "PageDown")).toBe("C2");
    expect(step("P1", "PageUp")).toBeUndefined();
    expect(step("C1", "PageDown")).toBeUndefined();
    expect(step("C3", "Home")).toBe("R");
  });

  it("[SR-111/AK5] reaches every node from the element", () => {
    const reached = new Set(["R"]);
    let before = 0;
    while (reached.size > before) {
      before = reached.size;
      for (const from of [...reached]) {
        for (const key of GRAPH_MOVES) {
          const to = step(from, key);
          if (to !== undefined) {
            reached.add(to);
          }
        }
      }
    }
    expect([...reached].sort()).toEqual(nodes.map((node) => node.key).sort());
  });

  it("moves nowhere for another key, from a node that is not placed, or in a layer the layout lacks", () => {
    expect(step("R", "Enter")).toBeUndefined();
    expect(step("gone", "ArrowUp")).toBeUndefined();
    const lost = { ...layout, layers: [] };
    expect(graphStep(lost, "R", "R", "ArrowRight")).toBeUndefined();
  });
});
