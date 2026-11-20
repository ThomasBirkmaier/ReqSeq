// The metamodel buffer (SR-130): the types of the open workspace as boxes, joined by soft curves for the
// inheritance, the relation kinds and the relation properties, on the white sheet. Everything shown is
// one `metamodel.get` call (ADR-0002, SR-080 AK4); `@reqseq/core/metamodel-graph` says which box and curve stand
// for which field, `metamodel-layout.ts` places them. HTML boxes and labels over one SVG of curves,
// greys only (D-062): no value here means "outdated" or "gap". A box shows the name, the prefix, "abstract"
// for an abstract type, every property, the inherited ones muted, and every status, the initial one in bold
// and an invalid one struck through (AK2).
// A right-click on a definition opens the menu of its place with the definition given (SR-199 AK2, AK5 to
// AK7, `metamodel-menu.ts`): the head of a type, a property row, a status, the label line of a relation kind
// or property; the sheet, "Any type" and the inheritance have the sheet's menu. The last change made in the
// app is marked (`changed`, SR-130 AK7, `metamodel-changes.ts`).
// The graph is one tab stop; the arrows move the mark between the boxes (`graph-nav.ts`, AK4).
// Ctrl/Cmd+T shows the same answer as text (`MetamodelTextView.tsx`, AK4, AK5); the selected type stays,
// and the graph opens on it again.
import { bufferMark, useHidden, useHiddenUpdate } from "./area-slot.js";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MetamodelGetOutput } from "@reqseq/core";
import { useIdScope } from "./area-scope.js";
import type { BufferAction, MetamodelBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { spotlit } from "./graph.js";
import { viewStart } from "./graph-layout.js";
import { GRAPH_MOVES, graphStep } from "./graph-nav.js";
import type { BoxStatus, MetamodelLink, MetamodelNode } from "@reqseq/core/metamodel-graph";
import { linkLabel, metamodelGraph, typeKey } from "@reqseq/core/metamodel-graph";
import type { ChangeMarks, MetamodelChange } from "./metamodel-changes.js";
import { NO_CHANGE, NO_MARKS, marksOf } from "./metamodel-changes.js";
import type { Measure, MetamodelLayout, PlacedType, TextFont } from "./metamodel-layout.js";
import { RANK_SEP, layoutMetamodel } from "./metamodel-layout.js";
import type { BufferData } from "./modeline.js";
import { MetamodelTextView } from "./MetamodelTextView.js";

export interface MetamodelViewProps {
  readonly call: Call;
  readonly buffer: MetamodelBuffer;
  /** Counts up when the workspace changed: the metamodel is asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** A view that cannot draw its buffer says so: a switch in motion to it starts (SR-212, `buffer-slide.ts`). */
  readonly onDrawn?: (key: string) => void;
  /** The window is split (SR-115 AK3). */
  readonly split?: boolean;
  /** The last change of the metamodel made in the app, marked where it appears (SR-130 AK7). */
  readonly changed?: MetamodelChange;
}

/** The answer shown and where its boxes stand. */
export interface Shown {
  readonly output: MetamodelGetOutput;
  readonly layout: MetamodelLayout;
}

/** A status as the tooltip says it: its name, and whether it is the initial or an invalid one. */
const statusText = (status: BoxStatus): string =>
  `${status.name}${status.initial ? " (initial status)" : ""}${status.invalid ? " (invalid)" : ""}`;

/** The accessible name of a box, and its tooltip: name, prefix, "abstract", the properties, the statuses. */
const boxLabel = (node: MetamodelNode): string =>
  node.any
    ? node.name
    : [
        `${node.name} · ${node.prefix}${node.abstract ? " · abstract" : ""}`,
        ...node.properties.map((property) => property.name),
        ...(node.statuses.length === 0 ? [] : [`Statuses: ${node.statuses.map(statusText).join(", ")}`]),
      ].join("\n");

/** The class of a place, with " changed" when it shows the last change (SR-130 AK7). */
const marked = (name: string, changed: boolean): string => (changed ? `${name} changed` : name);

/** The attributes that give a definition to the menu of its place (`metamodel-menu.ts`). */
const given = (what: string, key: string, name: string): Readonly<Record<string, string>> => ({
  [`data-given-${what}`]: key,
  [`data-given-${what}-name`]: name,
});

/** The data attribute of a label line: the kind or property it names, or the inheritance. */
const lineData = (link: MetamodelLink): Readonly<Record<string, string>> =>
  link.link === "extends"
    ? { "data-extends": "" }
    : link.link === "relation"
      ? { "data-kind": link.kind }
      : { "data-property": link.property };

/**
 * The place of a label line and what it gives (SR-199 AK2, AK6, AK7): the inheritance the sheet's menu, a
 * relation kind its own, a relation property its own with the type that has it, the source of its curve.
 */
const linePlace = (
  link: MetamodelLink,
  source: MetamodelNode | undefined,
): Readonly<Record<string, string>> => {
  if (link.link === "extends") {
    return { "data-menu": "metamodel-graph" };
  }
  if (link.link === "relation") {
    return { "data-menu": "metamodel-kind", ...given("kind", link.kind, link.name) };
  }
  return {
    "data-menu": "metamodel-property",
    ...given("property", link.property, link.name),
    ...(source === undefined || source.any ? {} : given("type", source.type, source.name)),
  };
};

/** Whether a label line shows the last change: its kind, or its property from the type of its curve. */
const lineChanged = (link: MetamodelLink, source: MetamodelNode | undefined, marks: ChangeMarks): boolean =>
  link.link === "relation"
    ? marks.kind(link.kind)
    : link.link === "property" &&
      source !== undefined &&
      !source.any &&
      marks.property(source.type, link.property);

/** A label line's key among the lines of its edge: one per kind or property, one inheritance. */
const lineKey = (link: MetamodelLink): string =>
  link.link === "extends"
    ? "extends"
    : link.link === "relation"
      ? `kind:${link.kind}`
      : `property:${link.property}`;

/**
 * The layouts made, by the output of `metamodel.get` they were made for: a view drawn hidden from its record
 * gets the output object its shown view got (`area-record.ts`), so it does not lay it out again (SR-212 AK5).
 */
const laidOut = new WeakMap<object, MetamodelLayout>();

const laidOutOnce = (output: object, make: () => MetamodelLayout): MetamodelLayout => {
  const kept = laidOut.get(output);
  if (kept !== undefined) {
    return kept;
  }
  const made = make();
  laidOut.set(output, made);
  return made;
};

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
  status: "400 11px",
  initial: "600 11px",
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
 * shown one is not laid out again, and a failed call or layout keeps what the sheet shows and says why
 * (`failed`).
 */
const useMetamodel = (
  call: Call,
  revision: number,
  failed: (message: string) => void,
  root: React.RefObject<HTMLDivElement | null>,
): { readonly shown: Shown | undefined; readonly error: string | undefined } => {
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  // Count the loads: the answer of an older one is dropped.
  const generation = useRef(0);
  // The output shown, as JSON: an answer equal to it (a change elsewhere) is not laid out again.
  const shownOutput = useRef<string | undefined>(undefined);
  // A hidden sheet draws as a transition, so a key in the shown buffer comes first (SR-082 AK3).
  const later = useHiddenUpdate();
  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    void call("metamodel.get", {}).then((answer) => {
      if (mine !== generation.current) {
        return;
      }
      if (!answer.ok) {
        setError(answer.message);
        failed(answer.message);
        return;
      }
      const json = JSON.stringify(answer.output);
      if (json === shownOutput.current) {
        setError(undefined);
        return;
      }
      try {
        const layout = laidOutOnce(answer.output, () =>
          layoutMetamodel(metamodelGraph(answer.output), measureIn(root.current)),
        );
        shownOutput.current = json;
        later(() => {
          setError(undefined);
          setShown({ output: answer.output, layout });
        });
      } catch (thrown: unknown) {
        // A layout that fails keeps what the sheet shows and says why (never a blank buffer).
        const message = `The metamodel could not be laid out: ${String(thrown)}`;
        setError(message);
        failed(message);
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

/**
 * One box: the name, "abstract" and the prefix, then one line per property, the inherited ones muted, then
 * the statuses in the rows the layout counted. Each definition is a place of the context menu (SR-199).
 */
const TypeBox = ({
  placed,
  index,
  selected,
  onSelect,
  typeName,
  marks,
}: {
  readonly placed: PlacedType;
  readonly index: number;
  readonly selected: boolean;
  readonly onSelect: () => void;
  /** The name of a type by its key, for the type that has a property itself. */
  readonly typeName: (type: string) => string;
  readonly marks: ChangeMarks;
}): React.JSX.Element => {
  const scope = useIdScope();
  const { node } = placed;
  return (
    <div
      id={`${scope}mm-type-${String(index)}`}
      className={node.any ? "mm-type any" : "mm-type"}
      role="option"
      aria-selected={selected}
      aria-label={boxLabel(node).replaceAll("\n", ", ")}
      title={boxLabel(node)}
      {...(node.any ? { "data-any": "" } : { "data-type": node.type })}
      // "Any type" has the sheet's menu (SR-199 AK2); a type box outside its definitions the buffer's (SR-194 AK6).
      data-menu={node.any ? "metamodel-graph" : "buffer"}
      style={{ left: placed.x, top: placed.y, width: placed.width, height: placed.height }}
      onClick={onSelect}
      // A right-click selects the type before the context menu opens (SR-194 AK5).
      onContextMenu={onSelect}
    >
      <div
        className={marked("mm-head", !node.any && marks.type(node.type))}
        // The name and the prefix of a type: its menu, the type given (SR-199 AK5).
        {...(node.any ? {} : { "data-menu": "metamodel-type", ...given("type", node.type, node.name) })}
      >
        <span className="mm-name">{node.name}</span>
        {!node.any && node.abstract ? <span className="mm-abstract">abstract</span> : null}
        {node.any ? null : <span className="mm-prefix">{node.prefix}</span>}
      </div>
      {node.any
        ? null
        : node.properties.map((property) => (
            <div
              key={property.key}
              className={marked(
                property.inherited ? "mm-property inherited" : "mm-property",
                marks.property(node.type, property.key),
              )}
              data-property={property.key}
              // The property and the type that has it itself (SR-199 AK6).
              data-menu="metamodel-property"
              {...given("property", property.key, property.name)}
              {...given("type", property.owner, typeName(property.owner))}
            >
              {property.name}
            </div>
          ))}
      {node.any || placed.statusRows.length === 0 ? null : (
        <div className="mm-statuses">
          {placed.statusRows.map((row) => (
            <div key={row[0]?.key} className="mm-status-row">
              {row.map((status) => (
                <span
                  key={status.key}
                  className={marked(
                    `mm-status${status.initial ? " initial" : ""}${status.invalid ? " invalid" : ""}`,
                    marks.status(node.type, status.key),
                  )}
                  title={statusText(status)}
                  data-status={status.key}
                  {...(status.initial ? { "data-initial": "" } : {})}
                  {...(status.invalid ? { "data-invalid": "" } : {})}
                  // The status and the type (SR-199 AK6).
                  data-menu="metamodel-status"
                  {...given("status", status.key, status.name)}
                  {...given("type", node.type, node.name)}
                >
                  {status.name}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** The curves, their labels and the boxes of a layout; the curves of the selected box drawn last. */
const Drawing = ({
  layout,
  selected,
  onSelect,
  marks,
}: {
  readonly layout: MetamodelLayout;
  readonly selected: string;
  readonly onSelect: (key: string) => void;
  readonly marks: ChangeMarks;
}): React.JSX.Element => {
  const nodeOf = (key: string): MetamodelNode | undefined => layout.byKey.get(key)?.node;
  const typeName = (type: string): string => nodeOf(typeKey(type))?.name ?? type;
  const scope = useIdScope();
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
                id={`${scope}${arrowId(variant)}`}
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
                markerEnd={`url(#${scope}${arrowId(variant)})`}
                data-source={path.source}
                data-target={path.target}
                // An inheritance curve has the sheet's menu (SR-199 AK2), another curve the buffer's (SR-194 AK6).
                data-menu={inheritance ? "metamodel-graph" : "buffer"}
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
            // An edge and its label are no part of the sheet: the buffer's menu (SR-194 AK6).
            data-menu="buffer"
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
                className={marked(
                  link.link === "extends" ? "mm-line extends" : "mm-line",
                  lineChanged(link, nodeOf(path.source), marks),
                )}
                {...lineData(link)}
                {...linePlace(link, nodeOf(path.source))}
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
            typeName={typeName}
            marks={marks}
          />
        ))}
      </div>
    </div>
  );
};

/** What the graph and the text of the metamodel are given. */
export interface SheetProps {
  readonly shown: Shown | undefined;
  readonly error: string | undefined;
  readonly buffer: MetamodelBuffer;
  readonly dispatch: (action: BufferAction) => void;
  /** The view's element, where the sheet's fonts are measured. */
  readonly root: React.RefObject<HTMLDivElement | null>;
  /** The window is split (SR-115 AK3): the graph opens on its selected box again at the new width. */
  readonly split: boolean;
  /** Where the last change of the metamodel made in the app shows (SR-130 AK7). */
  readonly marks: ChangeMarks;
}

/** The graph of the metamodel: boxes and curves, the arrows between the boxes. */
const GraphSheet = ({
  shown,
  error,
  buffer,
  dispatch,
  root,
  split,
  marks,
}: SheetProps): React.JSX.Element => {
  const scope = useIdScope();
  // Found by `[data-buffer]` only while shown, never drawn hidden in advance (SR-212 AK5).
  const bufferAttribute = bufferMark(useHidden());
  // Whether the view has opened on a layout, and whether the window was split then: a later layout keeps
  // the reader's scroll, a split or unsplit opens on the selected box again (SR-115 AK3).
  const opened = useRef(false);
  const openedSplit = useRef(split);

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
    if (opened.current && openedSplit.current === split) {
      box.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    opened.current = true;
    openedSplit.current = split;
    openOn(view, box, canvas);
  }, [shown, split]);

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
      // The sheet of the graph outside its types and labels (SR-199 AK2).
      data-menu="metamodel-graph"
      aria-activedescendant={index === undefined ? undefined : `${scope}mm-type-${String(index)}`}
      {...bufferAttribute}
      data-laid-out={shown === undefined ? undefined : String(shown.layout.nodes.length)}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      {layout === undefined ? (
        <p className="quiet">{shown === undefined ? error : "The metamodel defines no types."}</p>
      ) : (
        <Drawing layout={layout} selected={selected} onSelect={select} marks={marks} />
      )}
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
  onDrawn,
  split = false,
  changed = NO_CHANGE,
}: MetamodelViewProps): React.JSX.Element => {
  const root = useRef<HTMLDivElement>(null);
  const failed = (message: string): void => {
    onEcho(message);
    onDrawn?.(buffer.key);
  };
  const { shown, error } = useMetamodel(call, revision, failed, root);

  useEffect(() => {
    if (shown !== undefined) {
      onData(buffer.key, { kind: "metamodel", types: shown.output.types.length });
    }
  }, [shown]);

  const output = shown?.output;
  const marks = useMemo(
    () => (output === undefined ? NO_MARKS : marksOf(changed, output)),
    [changed, output],
  );
  const sheet = { shown, error, buffer, dispatch, root, split, marks };
  return buffer.mode === "text" ? <MetamodelTextView {...sheet} /> : <GraphSheet {...sheet} />;
};
