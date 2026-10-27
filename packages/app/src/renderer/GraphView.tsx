// The graph buffer (SR-111, D-063): the element and what hangs on it, in layers on a white sheet. The
// nodes, levels, edges and marks are one `trace.graph` call (ADR-0002, SR-080); the app places them
// (`graph-layout.ts`) and draws them: HTML boxes over one SVG of soft curves, greys only, colour only for
// "outdated" and "no evidence" (D-062). The element stands in the middle of its graph, between its
// parents and its children, marked by its border; the view opens on it (AK1).
// The graph is one tab stop; the selection moves inside it (`graph-nav.ts`), Enter or a click opens a
// node as the current element (AK5), `+` and `-` show one level more or less.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TraceGraphOutput } from "@logreq/core";
import type { BufferAction, GraphBuffer } from "./buffers.js";
import { elementBufferOf } from "./buffers.js";
import type { Call } from "./call.js";
import {
  MARK_WORDS,
  deeper,
  edgeClasses,
  graphInput,
  nodeId,
  nodeKey,
  nodeLabel,
  shallower,
  spotlit,
} from "./graph.js";
import type { GraphLayout } from "./graph-layout.js";
import { NODE_HEIGHT, NODE_WIDTH, RANK_SEP, layoutGraph, viewStart } from "./graph-layout.js";
import { GRAPH_MOVES, graphStep } from "./graph-nav.js";
import type { BufferData } from "./modeline.js";

export interface GraphViewProps {
  readonly call: Call;
  readonly buffer: GraphBuffer;
  /** Counts up when the workspace changed: the graph is asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** The names of the types by their key, from the metamodel. */
  readonly typeNames: ReadonlyMap<string, string>;
}

/** The answer shown and where its nodes stand. */
interface Shown {
  readonly output: TraceGraphOutput;
  readonly layout: GraphLayout;
}

/** Marks for the timing record of SR-111 AK6 (the performance timeline of the window); nothing reads them in the app. */
export const GRAPH_MARKS = {
  request: "logreq.graph.request",
  answer: "logreq.graph.answer",
  layout: "logreq.graph.layout",
} as const;

const MARK_CLASS: Readonly<Record<keyof typeof MARK_WORDS, string>> = {
  outdated: "outdated",
  superseded: "superseded",
  "no-evidence": "gap",
};

export const GraphView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
  typeNames,
}: GraphViewProps): React.JSX.Element => {
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  // Count the loads: the answer of an older one (a later change, another depth) is dropped.
  const generation = useRef(0);
  // The output shown, as JSON: an answer equal to it (a workspace change elsewhere) is not laid out again.
  const shownOutput = useRef<string | undefined>(undefined);
  // The input the view last opened on: a new layout for the same input keeps the reader's scroll.
  const opened = useRef<string | undefined>(undefined);
  const input = graphInput(buffer);
  const asked = JSON.stringify(input);

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    for (const mark of Object.values(GRAPH_MARKS)) {
      performance.clearMarks(mark);
    }
    performance.mark(GRAPH_MARKS.request);
    void call("trace.graph", input).then((answer) => {
      if (mine !== generation.current) {
        return;
      }
      if (!answer.ok) {
        setError(answer.message);
        onEcho(answer.message);
        return;
      }
      performance.mark(GRAPH_MARKS.answer);
      const json = JSON.stringify(answer.output);
      if (json === shownOutput.current) {
        setError(undefined);
        return;
      }
      try {
        const layout = layoutGraph(answer.output);
        performance.mark(GRAPH_MARKS.layout);
        shownOutput.current = json;
        setError(undefined);
        setShown({ output: answer.output, layout });
      } catch (thrown: unknown) {
        // A layout that fails keeps what the sheet shows and says why (never a blank buffer).
        const message = `The graph could not be laid out: ${String(thrown)}`;
        setError(message);
        onEcho(message);
      }
    });
    return () => {
      generation.current += 1;
    };
  }, [call, asked, revision]);

  useEffect(() => {
    if (shown !== undefined) {
      onData(buffer.key, {
        kind: "graph",
        nodes: shown.output.nodes.length,
        truncated: shown.output.truncated,
        incomplete: shown.output.incomplete,
      });
    }
  }, [shown]);

  const rootKey = nodeKey(buffer.repository, buffer.id);
  const selected =
    buffer.selected !== undefined && shown?.layout.byKey.has(buffer.selected) === true
      ? buffer.selected
      : rootKey;

  // A new layout: the view opens on the selected node (the element when the graph opens) in its middle,
  // as far as the drawing reaches (AK1, `viewStart`); a new layout of the same graph (the workspace
  // changed) keeps the reader's scroll and only brings the selected node into view. The sheet has half a
  // view of room on every side, so every start `viewStart` gives can be scrolled to.
  useLayoutEffect(() => {
    const view = root.current;
    const node = view?.querySelector('[aria-selected="true"]');
    const canvas = view?.querySelector(".graph-canvas");
    if (view === null || node === null || node === undefined || canvas === null || canvas === undefined) {
      return;
    }
    if (opened.current === asked) {
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    opened.current = asked;
    const outer = view.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const drawing = canvas.getBoundingClientRect();
    const left = outer.left + view.clientLeft - view.scrollLeft;
    const top = outer.top + view.clientTop - view.scrollTop;
    view.scrollLeft = viewStart(
      box.left + box.width / 2 - left,
      drawing.left - left,
      drawing.width,
      view.clientWidth,
      RANK_SEP,
    );
    view.scrollTop = viewStart(
      box.top + box.height / 2 - top,
      drawing.top - top,
      drawing.height,
      view.clientHeight,
      RANK_SEP,
    );
  }, [shown]);

  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  const select = (node: string): void => {
    dispatch({ type: "select", key: buffer.key, node });
  };

  const open = (node: string): void => {
    const placed = shown?.layout.byKey.get(node);
    if (placed !== undefined) {
      // The node stays selected, so coming back finds it.
      select(node);
      dispatch({ type: "open", buffer: elementBufferOf(placed.node) });
    }
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // With Ctrl, Cmd or Alt held a key is another one (Ctrl+- is not "-"); Shift may give "+".
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (GRAPH_MOVES.includes(event.key)) {
      event.preventDefault();
      const to = shown === undefined ? undefined : graphStep(shown.layout, rootKey, selected, event.key);
      if (to !== undefined) {
        select(to);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(selected);
    } else if (event.key === "+" || event.key === "-") {
      event.preventDefault();
      const depth = event.key === "+" ? deeper(buffer.depth) : shallower(buffer.depth);
      dispatch({ type: "open", buffer: { ...buffer, depth } });
    }
  };

  const layout = shown?.layout;
  const order = layout?.nodes.map((placed) => placed.key) ?? [];
  const paths = [...(layout?.paths ?? [])].sort(
    (a, b) =>
      Number(a.source === selected || a.target === selected) -
      Number(b.source === selected || b.target === selected),
  );
  const lit = spotlit(paths, selected);
  return (
    <div
      ref={root}
      className="buffer graph"
      role="listbox"
      aria-label={`Graph: ${buffer.name}`}
      aria-activedescendant={layout === undefined ? undefined : `gnode-${String(order.indexOf(selected))}`}
      data-buffer=""
      data-laid-out={layout === undefined ? undefined : String(layout.nodes.length)}
      tabIndex={0}
      onKeyDown={keyDown}
    >
      {layout === undefined ? (
        error === undefined ? null : (
          <p className="quiet">{error}</p>
        )
      ) : (
        <div
          className="graph-sheet"
          style={{
            width: `calc(${String(layout.width)}px + 100vw)`,
            height: `calc(${String(layout.height)}px + 100vh)`,
          }}
        >
          <div className="graph-canvas" style={{ width: layout.width, height: layout.height }}>
            <svg className="graph-edges" width={layout.width} height={layout.height} aria-hidden="true">
              {paths.map((path) => (
                <path
                  key={`${path.source}>${path.target}`}
                  className={edgeClasses(
                    path.links,
                    lit && (path.source === selected || path.target === selected),
                  )}
                  d={path.d}
                  data-source={path.source}
                  data-target={path.target}
                />
              ))}
            </svg>
            {layout.nodes.map((placed, index) => {
              const typeName = typeNames.get(placed.node.type) ?? placed.node.type;
              const classes = [
                "graph-node",
                ...(placed.key === rootKey ? ["root"] : []),
                ...(placed.node.marks.includes("superseded") ? ["superseded"] : []),
              ];
              return (
                <div
                  key={placed.key}
                  id={`gnode-${String(index)}`}
                  className={classes.join(" ")}
                  role="option"
                  aria-selected={placed.key === selected}
                  aria-label={nodeLabel(placed.node, typeName)}
                  title={placed.node.title}
                  data-node={placed.key}
                  style={{ left: placed.x, top: placed.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                  onClick={() => {
                    open(placed.key);
                  }}
                >
                  <div className="graph-id">{`${nodeId(placed.node)} · ${typeName}`}</div>
                  <div className="graph-title">{placed.node.title}</div>
                  <div className="graph-marks">
                    {placed.node.marks.map((mark) => (
                      <span key={mark} className={MARK_CLASS[mark]}>
                        {MARK_WORDS[mark]}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
