// The metamodel buffer (SR-130): the types of the open workspace as boxes, joined by soft curves for the
// inheritance, the relation kinds and the relation properties, on the white sheet. Everything shown is
// one `metamodel.get` call (ADR-0002, SR-080 AK4); `metamodel-graph.ts` says which box and curve stand
// for which field, `metamodel-layout.ts` places them. HTML boxes and labels over one SVG of curves,
// greys only (D-062): no value here means "outdated" or "gap". A box shows the name, the prefix, "abstract"
// for an abstract type and every property, the inherited ones muted (AK2).
// The graph is one tab stop; the arrows move the selection between the boxes (`graph-nav.ts`, AK4).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MetamodelGetOutput } from "@logreq/core";
import type { BufferAction, MetamodelBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { spotlit } from "./graph.js";
import { viewStart } from "./graph-layout.js";
import { GRAPH_MOVES, graphStep } from "./graph-nav.js";
import type { MetamodelLink, MetamodelNode } from "./metamodel-graph.js";
import { linkLabel, metamodelGraph } from "./metamodel-graph.js";
import type { Measure, MetamodelLayout, PlacedType, TextFont } from "./metamodel-layout.js";
import { RANK_SEP, layoutMetamodel } from "./metamodel-layout.js";
import type { BufferData } from "./modeline.js";

export interface MetamodelViewProps {
  readonly call: Call;
  readonly buffer: MetamodelBuffer;
  /** Counts up when the workspace changed: the metamodel is asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
}

/** The answer shown and where its boxes stand. */
interface Shown {
  readonly output: MetamodelGetOutput;
  readonly layout: MetamodelLayout;
}

/** The accessible name of a box, and its tooltip: name, prefix, "abstract", the properties. */
const boxLabel = (node: MetamodelNode): string =>
  node.any
    ? node.name
    : [
        `${node.name} · ${node.prefix}${node.abstract ? " · abstract" : ""}`,
        ...node.properties.map((property) => property.name),
      ].join("\n");

/** The data attribute of a label line: the kind or property it names, or the inheritance. */
const lineData = (link: MetamodelLink): Readonly<Record<string, string>> =>
  link.link === "extends"
    ? { "data-extends": "" }
    : link.link === "relation"
      ? { "data-kind": link.kind }
      : { "data-property": link.property };

/** A label line's key among the lines of its edge: one per kind or property, one inheritance. */
const lineKey = (link: MetamodelLink): string =>
  link.link === "extends"
    ? "extends"
    : link.link === "relation"
      ? `kind:${link.kind}`
      : `property:${link.property}`;

/** The sides of a curve as a key and as data attributes. */
type Ends = Pick<MetamodelLayout["paths"][number], "source" | "target">;
const pairKey = (path: Ends): string => `${path.source}>${path.target}`;

/** The arrowheads: one per look of a curve, so each takes its curve's colour. */
const ARROWS = ["", "extends", "selected"] as const;
const arrowId = (variant: (typeof ARROWS)[number]): string =>
  `mm-arrow${variant === "" ? "" : `-${variant}`}`;

/** The CSS font of each line of the sheet (`styles.css`), in the family of `element`. */
const FONTS: Readonly<Record<TextFont, string>> = {
  name: "600 14px",
  small: "400 12px",
  property: "400 13px",
  label: "400 12px",
};

/**
 * Measures a line in the font the sheet draws it with (a canvas of the window's text engine), so a box is
 * as wide as its widest line on every system; the layout's estimate where no canvas can measure.
 */
const measureIn = (element: HTMLElement | null): Measure | undefined => {
  const context = element === null ? null : document.createElement("canvas").getContext("2d");
  if (element === null || context === null) {
    return undefined;
  }
  const family = getComputedStyle(element).fontFamily;
  return (text, font) => {
    context.font = `${FONTS[font]} ${family}`;
    return context.measureText(text).width;
  };
};

/**
 * Asks `metamodel.get` on mount and on every revision; the newest answer wins, an answer equal to the
 * shown one is not laid out again, and a failed call or layout keeps what the sheet shows and says why.
 */
const useMetamodel = (
  call: Call,
  revision: number,
  onEcho: (message: string) => void,
  root: React.RefObject<HTMLDivElement | null>,
): { readonly shown: Shown | undefined; readonly error: string | undefined } => {
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Count the loads: the answer of an older one is dropped.
  const generation = useRef(0);
  // The output shown, as JSON: an answer equal to it (a change elsewhere) is not laid out again.
  const shownOutput = useRef<string | undefined>(undefined);
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    void call("metamodel.get", {}).then((answer) => {
      if (mine !== generation.current) {
        return;
      }
      if (!answer.ok) {
        setError(answer.message);
        onEcho(answer.message);
        return;
      }
      const json = JSON.stringify(answer.output);
      if (json === shownOutput.current) {
        setError(undefined);
        return;
      }
      try {
        const layout = layoutMetamodel(metamodelGraph(answer.output), measureIn(root.current));
        shownOutput.current = json;
        setError(undefined);
        setShown({ output: answer.output, layout });
      } catch (thrown: unknown) {
        // A layout that fails keeps what the sheet shows and says why (never a blank buffer).
        const message = `The metamodel could not be laid out: ${String(thrown)}`;
        setError(message);
        onEcho(message);
      }
    });
    return () => {
      generation.current += 1;
    };
  }, [call, revision]);
  return { shown, error };
};

/**
 * Scrolls the view so that the selected box `box` stands centred across and its top a margin into the
 * view, as far as the drawing (`canvas`) reaches (`viewStart`). The sheet has half a view of room on
 * every side, so every start can be scrolled to.
 */
const openOn = (view: HTMLElement, box: Element, canvas: Element): void => {
  const outer = view.getBoundingClientRect();
  const placed = box.getBoundingClientRect();
  const drawing = canvas.getBoundingClientRect();
  const left = outer.left + view.clientLeft - view.scrollLeft;
  const top = outer.top + view.clientTop - view.scrollTop;
  view.scrollLeft = viewStart(
    placed.left + placed.width / 2 - left,
    drawing.left - left,
    drawing.width,
    view.clientWidth,
    RANK_SEP,
  );
  view.scrollTop = viewStart(
    placed.top - top + view.clientHeight / 2 - RANK_SEP,
    drawing.top - top,
    drawing.height,
    view.clientHeight,
    RANK_SEP,
  );
};

/** One box: the name, "abstract" and the prefix, then one line per property, the inherited ones muted. */
const TypeBox = ({
  placed,
  index,
  selected,
  onSelect,
}: {
  readonly placed: PlacedType;
  readonly index: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element => {
  const { node } = placed;
  return (
    <div
      id={`mm-type-${String(index)}`}
      className={node.any ? "mm-type any" : "mm-type"}
      role="option"
      aria-selected={selected}
      aria-label={boxLabel(node).replaceAll("\n", ", ")}
      title={boxLabel(node)}
      {...(node.any ? { "data-any": "" } : { "data-type": node.type })}
      style={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
      onClick={onSelect}
    >
      <div className="mm-head">
        <span className="mm-name">{node.name}</span>
        {!node.any && node.abstract ? <span className="mm-abstract">abstract</span> : null}
        {node.any ? null : <span className="mm-prefix">{node.prefix}</span>}
      </div>
      {node.properties.map((property) => (
        <div
          key={property.key}
          className={property.inherited ? "mm-property inherited" : "mm-property"}
          data-property={property.key}
        >
          {property.name}
        </div>
      ))}
    </div>
  );
};

/** The curves, their labels and the boxes of a layout; the curves of the selected box drawn last. */
const Drawing = ({
  layout,
  selected,
  onSelect,
}: {
  readonly layout: MetamodelLayout;
  readonly selected: string;
  readonly onSelect: (key: string) => void;
}): React.JSX.Element => {
  const touches = (path: Ends): boolean => path.source === selected || path.target === selected;
  const paths = [...layout.paths].sort((a, b) => Number(touches(a)) - Number(touches(b)));
  const lit = spotlit(paths, selected);
  return (
    <div
      className="mm-sheet"
      style={{
        width: `calc(${String(layout.width)}px + 100vw)`,
        height: `calc(${String(layout.height)}px + 100vh)`,
      }}
    >
      <div className="mm-canvas" style={{ width: layout.width, height: layout.height }}>
        <svg className="mm-edges" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            {ARROWS.map((variant) => (
              <marker
                key={variant}
                id={arrowId(variant)}
                className={`mm-arrow ${variant}`}
                viewBox="0 0 8 8"
                refX={8}
                refY={4}
                markerWidth={8}
                markerHeight={8}
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path d="M0,0L8,4L0,8z" />
              </marker>
            ))}
          </defs>
          {paths.map((path) => {
            const inheritance = path.links.some((link) => link.link === "extends");
            const variant = lit && touches(path) ? "selected" : inheritance ? "extends" : "";
            return (
              <path
                key={pairKey(path)}
                className={variant === "" ? "mm-edge" : `mm-edge ${variant}`}
                d={path.d}
                markerEnd={`url(#${arrowId(variant)})`}
                data-source={path.source}
                data-target={path.target}
              />
            );
          })}
        </svg>
        {paths.map((path) => (
          <div
            key={pairKey(path)}
            className="mm-label"
            data-source={path.source}
            data-target={path.target}
            style={{
              left: path.label.x,
              top: path.label.y,
              width: path.label.width,
              height: path.label.height,
            }}
          >
            {path.links.map((link) => (
              <div
                key={lineKey(link)}
                className={link.link === "extends" ? "mm-line extends" : "mm-line"}
                {...lineData(link)}
              >
                {linkLabel(link)}
              </div>
            ))}
          </div>
        ))}
        {layout.nodes.map((placed, index) => (
          <TypeBox
            key={placed.key}
            placed={placed}
            index={index}
            selected={placed.key === selected}
            onSelect={() => {
              onSelect(placed.key);
            }}
          />
        ))}
      </div>
    </div>
  );
};

export const MetamodelView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
}: MetamodelViewProps): React.JSX.Element => {
  const root = useRef<HTMLDivElement>(null);
  const { shown, error } = useMetamodel(call, revision, onEcho, root);
  // Whether the view has opened on a layout: a later one keeps the reader's scroll.
  const opened = useRef(false);

  useEffect(() => {
    if (shown !== undefined) {
      onData(buffer.key, { kind: "metamodel", types: shown.output.types.length });
    }
  }, [shown]);

  const layout = shown?.output.types.length === 0 ? undefined : shown?.layout;
  const first = layout?.nodes[0]?.key ?? "";
  const selected =
    buffer.selected !== undefined && layout?.byKey.has(buffer.selected) === true ? buffer.selected : first;

  // The view opens on the selected box (the first type); a new layout later keeps the reader's scroll
  // and only brings the selected box into view.
  useLayoutEffect(() => {
    const view = root.current;
    const box = view?.querySelector('[aria-selected="true"]');
    const canvas = view?.querySelector(".mm-canvas");
    if (view === null || box === null || box === undefined || canvas === null || canvas === undefined) {
      return;
    }
    if (opened.current) {
      box.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    opened.current = true;
    openOn(view, box, canvas);
  }, [shown]);

  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  const select = (key: string): void => {
    dispatch({ type: "select", key: buffer.key, node: key });
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // With Ctrl, Cmd or Alt held a key is another one, left to the window.
    if (event.ctrlKey || event.metaKey || event.altKey || !GRAPH_MOVES.includes(event.key)) {
      return;
    }
    event.preventDefault();
    const to = layout === undefined ? undefined : graphStep(layout, first, selected, event.key);
    if (to !== undefined) {
      select(to);
    }
  };

  const index = layout?.nodes.findIndex((placed) => placed.key === selected);
  return (
    <div
      ref={root}
      className="buffer metamodel"
      role="listbox"
      aria-label="Metamodel"
      aria-activedescendant={index === undefined ? undefined : `mm-type-${String(index)}`}
      data-buffer=""
      data-laid-out={shown === undefined ? undefined : String(shown.layout.nodes.length)}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      {layout === undefined ? (
        <p className="quiet">{shown === undefined ? error : "The metamodel defines no types."}</p>
      ) : (
        <Drawing layout={layout} selected={selected} onSelect={select} />
      )}
    </div>
  );
};
