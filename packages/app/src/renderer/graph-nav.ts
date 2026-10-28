// The keys of the graph buffer (SR-111 AK5, SR-073): which node a key selects, from the placed nodes and
// the drawn links. Pure; the view dispatches the result. Every node can be reached: Left and Right go
// through a layer, Page Up and Page Down from layer to layer. The metamodel graph (SR-130 AK4) moves the
// same way: both layouts are a `NavLayout`.

/** A placed node as the keys see it: its key, the x of its left edge and its layer from the top. */
export interface NavNode {
  readonly key: string;
  readonly x: number;
  readonly layer: number;
}

/** The nodes by key, the layers from the top (each from left to right) and the drawn links. */
export interface NavLayout {
  readonly byKey: ReadonlyMap<string, NavNode>;
  readonly layers: readonly (readonly NavNode[])[];
  readonly paths: readonly { readonly source: string; readonly target: string }[];
}

/** The keys that move the selection. */
export const GRAPH_MOVES = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home"];

/** The candidate nearest in x to `from`; on a tie the nearer layer, then the one listed first. */
const nearest = (from: NavNode, candidates: readonly NavNode[]): NavNode | undefined =>
  [...candidates].sort(
    (a, b) =>
      Math.abs(a.x - from.x) - Math.abs(b.x - from.x) ||
      Math.abs(a.layer - from.layer) - Math.abs(b.layer - from.layer),
  )[0];

/** The nodes joined to `key` by a drawn link, either way. */
const linked = (layout: NavLayout, key: string): NavNode[] =>
  layout.paths.flatMap((path) => {
    const other = path.source === key ? path.target : path.target === key ? path.source : undefined;
    const node = other === undefined ? undefined : layout.byKey.get(other);
    return node === undefined ? [] : [node];
  });

/** Up and Down: along a link to a node in a layer above or below, the one nearest in x. */
const alongLink = (layout: NavLayout, node: NavNode, up: boolean): string | undefined =>
  nearest(
    node,
    linked(layout, node.key).filter((other) => (up ? other.layer < node.layer : other.layer > node.layer)),
  )?.key;

/** Page Up and Page Down: the node nearest in x in the next layer above or below. */
const byLayer = (layout: NavLayout, node: NavNode, up: boolean): string | undefined =>
  nearest(node, layout.layers[node.layer + (up ? -1 : 1)] ?? [])?.key;

/**
 * The node the key selects from the node `from` (`root` is the element of the graph, or the first type
 * of the metamodel):
 * - Up, Down: along a link to a node in a layer above or below, the one nearest in x;
 * - Left, Right: the node before or after in the same layer;
 * - Page Up, Page Down: the node nearest in x in the next layer above or below;
 * - Home: the element (the first type).
 * Undefined when the key moves nowhere (no such node, or not a key of the graph).
 */
export const graphStep = (layout: NavLayout, root: string, from: string, key: string): string | undefined => {
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
