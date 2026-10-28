// The typed part of dagre (ADR-0015) that the graph layouts use (`graph-layout.ts`, SR-111, and
// `metamodel-layout.ts`, SR-130). The types of dagre 3.1.1 do not resolve under NodeNext (graphlib's
// declarations import `./lib/graph` without an extension), so they are written here.
import { Graph, layout } from "@dagrejs/dagre";

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * What a layout edge asks for: `minlen` layers at least between its ends, `weight` how strongly it pulls
 * them together; `width` and `height` reserve room for its label, which dagre places at the middle of
 * the edge (`labelpos` "c").
 */
export interface LayoutEdge {
  readonly minlen: number;
  readonly weight: number;
  readonly width?: number;
  readonly height?: number;
  readonly labelpos?: "c";
}

/**
 * The part of dagre's graph the layouts use. `Placed` is what dagre adds to an edge beyond its points:
 * the centre of its label, for a graph whose edges all reserve room for one.
 */
export interface LayoutGraph<Placed extends object = object> {
  setGraph(label: Readonly<Record<string, string | number>>): void;
  setNode(key: string, label: { readonly width: number; readonly height: number }): void;
  setEdge(v: string, w: string, label: LayoutEdge): void;
  graph(): { readonly width: number; readonly height: number };
  /** A node's centre and the size it was set with. */
  node(key: string): Point & { readonly width: number; readonly height: number };
  edge(v: string, w: string): Placed & { readonly points: readonly Point[] };
}

/** A new, empty dagre graph. */
export const layoutGraphOf = <Placed extends object = object>(): LayoutGraph<Placed> =>
  new (Graph as unknown as new () => LayoutGraph<Placed>)();

/** dagre's layout: places the nodes and the edges of `graph` in it. */
export const runLayout = layout as unknown as (graph: LayoutGraph) => void;
