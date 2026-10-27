// The keys of the graph buffer (SR-111 AK5, SR-073): which node a key selects, from the placed nodes and
// the drawn links. Pure; the view dispatches the result. Every node can be reached: Left and Right go
// through a layer, Page Up and Page Down from layer to layer.
import type { GraphLayout, PlacedNode } from "./graph-layout.js";

/** The keys that move the selection. */
export const GRAPH_MOVES = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home"];

/** The candidate nearest in x to `from`; on a tie the nearer layer, then the one listed first. */
const nearest = (from: PlacedNode, candidates: readonly PlacedNode[]): PlacedNode | undefined =>
  [...candidates].sort(
    (a, b) =>
      Math.abs(a.x - from.x) - Math.abs(b.x - from.x) ||
      Math.abs(a.layer - from.layer) - Math.abs(b.layer - from.layer),
  )[0];

/** The nodes joined to `key` by a drawn link, either way. */
const linked = (layout: GraphLayout, key: string): PlacedNode[] =>
  layout.paths.flatMap((path) => {
    const other = path.source === key ? path.target : path.target === key ? path.source : undefined;
    const node = other === undefined ? undefined : layout.byKey.get(other);
    return node === undefined ? [] : [node];
  });

/** Up and Down: along a link to a node in a layer above or below, the one nearest in x. */
const alongLink = (layout: GraphLayout, node: PlacedNode, up: boolean): string | undefined =>
  nearest(
    node,
    linked(layout, node.key).filter((other) => (up ? other.layer < node.layer : other.layer > node.layer)),
  )?.key;

/** Page Up and Page Down: the node nearest in x in the next layer above or below. */
const byLayer = (layout: GraphLayout, node: PlacedNode, up: boolean): string | undefined =>
  nearest(node, layout.layers[node.layer + (up ? -1 : 1)] ?? [])?.key;

/**
 * The node the key selects from the node `from` (`root` is the element of the graph):
 * - Up, Down: along a link to a node in a layer above or below, the one nearest in x;
 * - Left, Right: the node before or after in the same layer;
 * - Page Up, Page Down: the node nearest in x in the next layer above or below;
 * - Home: the element.
 * Undefined when the key moves nowhere (no such node, or not a key of the graph).
 */
export const graphStep = (
  layout: GraphLayout,
  root: string,
  from: string,
  key: string,
): string | undefined => {
  const node = layout.byKey.get(from);
  if (node === undefined) {
    return undefined;
  }
  const layer = layout.layers[node.layer] ?? [];
  const index = layer.indexOf(node);
  switch (key) {
    case "ArrowUp":
    case "ArrowDown":
      return alongLink(layout, node, key === "ArrowUp");
    case "ArrowLeft":
      return layer[index - 1]?.key;
    case "ArrowRight":
      return layer[index + 1]?.key;
    case "PageUp":
    case "PageDown":
      return byLayer(layout, node, key === "PageUp");
    case "Home":
      return root;
    default:
      return undefined;
  }
};
