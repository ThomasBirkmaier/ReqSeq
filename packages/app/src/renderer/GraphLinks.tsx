// The relation kind of a link in the graph of an element (SR-154): which link the mouse is on or the keys
// selected, the wide lines that let the mouse find a curve, and the text at the link. A link says its
// kinds only on demand: the mouse on a curve, or the key `l` (`LINK_NEXT`), which selects the links of the
// selected node in turn, in the order of the layout (Escape, `LINK_BACK`, goes back to the node), shows a
// text at the curve with one line per link, "SR-111 Derives from N-071" (`edgeLines`). A selected link's
// text is the listbox's active option, so a screen reader reads it as its name; the hovered one is only
// seen. Otherwise no curve carries a word, and there is no legend (D-062).
import { useState } from "react";
import { edgeLines, nodeId } from "./graph.js";
import type { EdgePath, GraphLayout, Point } from "./graph-layout.js";

/** The link selected with the keys: the `index`-th link of `node` in the layout `of`. */
interface ChosenLink {
  readonly of: GraphLayout;
  readonly node: string;
  readonly index: number;
}

/** The curve under the mouse and where its text stands. */
interface Hovered {
  readonly path: EdgePath;
  readonly at: Point;
}

/** The links of the graph's selected node as the keys and the mouse choose them. */
export interface GraphLinks {
  /** The link selected with the keys; undefined in another layout or on another node. */
  readonly chosen: EdgePath | undefined;
  /** The curve under the mouse, in this layout. */
  readonly hovered: Hovered | undefined;
  /** The next link of the selected node, in turn; the first when none is selected. */
  readonly next: () => void;
  /** Back to the node; false when no link was selected. */
  readonly back: () => boolean;
  readonly hover: (hovered: Hovered | undefined) => void;
}

/** A curve's key: its source and target. */
export const pathKey = (path: EdgePath): string => `${path.source}>${path.target}`;

/** The links of `selected` in `layout`, and which one the keys or the mouse chose. */
export const useGraphLinks = (layout: GraphLayout | undefined, selected: string): GraphLinks => {
  const [chosenLink, setChosenLink] = useState<ChosenLink | undefined>(undefined);
  const [hoveredLink, setHovered] = useState<Hovered | undefined>(undefined);
  const links = layout?.paths.filter((path) => path.source === selected || path.target === selected) ?? [];
  const chosen =
    chosenLink !== undefined && chosenLink.of === layout && chosenLink.node === selected
      ? links[chosenLink.index]
      : undefined;
  const hovered =
    hoveredLink !== undefined && layout?.paths.includes(hoveredLink.path) === true ? hoveredLink : undefined;
  return {
    chosen,
    hovered,
    next: () => {
      if (layout !== undefined && links.length > 0) {
        const index = chosen === undefined ? 0 : (links.indexOf(chosen) + 1) % links.length;
        setChosenLink({ of: layout, node: selected, index });
      }
    },
    back: () => {
      setChosenLink(undefined);
      return chosen !== undefined;
    },
    hover: setHovered,
  };
};

/** A wide line without colour over each curve, so the mouse finds a thin one. */
export const LinkHits = ({
  paths,
  hover,
}: {
  readonly paths: readonly EdgePath[];
  readonly hover: GraphLinks["hover"];
}): React.JSX.Element[] => {
  // The point of the canvas under the mouse: the SVG covers the canvas.
  const at = (path: EdgePath) => (event: React.MouseEvent<SVGPathElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    hover({ path, at: { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) } });
  };
  return paths.map((path) => (
    <path
      key={`hit:${pathKey(path)}`}
      className="graph-edge-hit"
      d={path.d}
      data-hit={pathKey(path)}
      onMouseEnter={at(path)}
      onMouseMove={at(path)}
      onMouseLeave={() => {
        hover(undefined);
      }}
    />
  ));
};

/** The id of the selected link's text: the listbox's active option while a link is selected. */
export const linkOptionId = (scope: string): string => `${scope}gedge`;

/** The listbox's active option: the selected link's text while a link is selected, else the node's box. */
export const activeOption = (chosen: EdgePath | undefined, scope: string, node: string): string =>
  chosen === undefined ? node : linkOptionId(scope);

/**
 * The texts at the selected link (an option, at the middle of its points) and at the curve under the
 * mouse (aria-hidden, above the mouse), one line per link.
 */
export const LinkTips = ({
  layout,
  links,
  kindNames,
  scope,
}: {
  readonly layout: GraphLayout;
  readonly links: GraphLinks;
  readonly kindNames: ReadonlyMap<string, string>;
  readonly scope: string;
}): React.JSX.Element => {
  const nameOf = (key: string): string => {
    const node = layout.byKey.get(key)?.node;
    return node === undefined ? key : nodeId(node);
  };
  const tip = (path: EdgePath, at: Point, option: boolean): React.JSX.Element => {
    const lines = edgeLines(path.links, nameOf, kindNames);
    return (
      <div
        key={option ? "chosen" : "hovered"}
        className="graph-edge-tip"
        {...(option
          ? { id: linkOptionId(scope), role: "option", "aria-selected": true, "aria-label": lines.join("; ") }
          : { "aria-hidden": true })}
        data-edge={pathKey(path)}
        style={{ left: at.x, top: at.y }}
      >
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    );
  };
  const { chosen, hovered } = links;
  return (
    <>
      {chosen === undefined ? null : tip(chosen, chosen.mid, true)}
      {hovered === undefined || hovered.path === chosen ? null : tip(hovered.path, hovered.at, false)}
    </>
  );
};
