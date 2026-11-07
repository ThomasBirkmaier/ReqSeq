// The graph buffer (SR-111, D-063): the element and what hangs on it, in layers on a white sheet. The
// nodes, levels, edges and marks are one `trace.graph` call (ADR-0002, SR-080); the app places them
// (`graph-layout.ts`) and draws them: HTML boxes over one SVG of soft curves, greys only, colour only for
// "outdated" and "no evidence" (D-062). The element stands in the middle of its graph, between its
// parents and its children, marked by its border; the view opens on it (AK1).
// The graph is one tab stop; the selection moves inside it (`graph-nav.ts`), Enter or a click opens a
// node as the current element (AK5), `+` and `-` show one level more or less. With evidence (AK3), a
// muted box below a node sums up its evidence; it is no option, so the keys and Enter skip it, and the
// node's accessible name says the summary.
// A link names its relation kind only on demand (SR-154, `GraphLinks.tsx`).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TraceGraphOutput } from "@reqseq/core";
import { useIdScope } from "./area-scope.js";
import type { BufferAction, GraphBuffer } from "./buffers.js";
import { elementBufferOf } from "./buffers.js";
import type { Call } from "./call.js";
import {
  MARK_WORDS,
  deeper,
  edgeClasses,
  evidenceText,
  graphInput,
  nodeId,
  nodeKey,
  nodeLabel,
  shallower,
  spotlit,
} from "./graph.js";
import { LinkHits, LinkTips, activeOption, pathKey, useGraphLinks } from "./GraphLinks.js";
import type { GraphLayout } from "./graph-layout.js";
import {
  EVIDENCE_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  RANK_SEP,
  layoutGraph,
  viewStart,
} from "./graph-layout.js";
import { DEPTH_LESS, DEPTH_MORE, GRAPH_MOVES, LINK_BACK, graphStep, isLinkNext } from "./graph-nav.js";
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
  /** The names of the relation kinds and relation properties by their key, from the metamodel (SR-154). */
  readonly kindNames: ReadonlyMap<string, string>;
  /** The window is split (SR-115 AK3): the view is half as wide, and opens on its node again. */
  readonly split?: boolean;
}

/** The answer shown and where its nodes stand. */
interface Shown {
  readonly output: TraceGraphOutput;
  readonly layout: GraphLayout;
}

/** Marks for the timing record of SR-111 AK6 (the performance timeline of the window); nothing reads them in the app. */
export const GRAPH_MARKS = {
  request: "reqseq.graph.request",
  answer: "reqseq.graph.answer",
  layout: "reqseq.graph.layout",
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
  kindNames,
  split = false,
}: GraphViewProps): React.JSX.Element => {
  const scope = useIdScope();
  const [shown, setShown] = useState<Shown | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  // Count the loads: the answer of an older one (a later change, another depth) is dropped.
  const generation = useRef(0);
  // The output shown, as JSON: an answer equal to it (a workspace change elsewhere) is not laid out again.
  const shownOutput = useRef<string | undefined>(undefined);
  // The input the view last opened on: a new layout for the same input keeps the reader's scroll.
  const opened = useRef<string | undefined>(undefined);
  // Whether the window was split when the view opened: a split or unsplit changes its width (SR-115 AK3).
  const openedSplit = useRef(split);
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

  const rootKey = nodeKey(buffer.repository, buffer.id);
  const selected =
    buffer.selected !== undefined && shown?.layout.byKey.has(buffer.selected) === true
      ? buffer.selected
      : rootKey;

  // The link the keys or the mouse chose (SR-154).
  const layout = shown?.layout;
  const links = useGraphLinks(layout, selected);
  const { chosen } = links;

  useEffect(() => {
    if (shown !== undefined) {
      const marked = shown.layout.byKey.get(selected)?.node;
      onData(buffer.key, {
        kind: "graph",
        nodes: shown.output.nodes.length,
        truncated: shown.output.truncated,
        incomplete: shown.output.incomplete,
        ...(marked === undefined ? {} : { marked: elementBufferOf(marked) }),
      });
    }
  }, [shown, selected]);

  // A new layout: the view opens on the selected node (the element when the graph opens) in its middle,
  // as far as the drawing reaches (AK1, `viewStart`); a new layout of the same graph (the workspace
  // changed) keeps the reader's scroll and only brings the selected node into view. The sheet has half a
  // view of room on every side, so every start `viewStart` gives can be scrolled to. A split or unsplit of
  // the window changes the width of the view: it opens on the selected node again (SR-115 AK3).
  useLayoutEffect(() => {
    const view = root.current;
    // The selected node's box, also while one of its links is chosen (its text is then the selected option).
    const node = view?.querySelector('.graph-node[aria-selected="true"], .graph-node.link-chosen');
    const canvas = view?.querySelector(".graph-canvas");
    if (view === null || node === null || node === undefined || canvas === null || canvas === undefined) {
      return;
    }
    if (opened.current === asked && openedSplit.current === split) {
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    opened.current = asked;
    openedSplit.current = split;
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
  }, [shown, split]);

  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected, chosen]);

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

  // The keys of the links (SR-154 AK3 to AK5): whether the key was one of them. Without a selected link
  // Escape is the window's.
  const linkKey = (event: React.KeyboardEvent): boolean => {
    if (isLinkNext(event.key)) {
      event.preventDefault();
      links.next();
      return true;
    }
    if (event.key === LINK_BACK && links.back()) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    return false;
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    // With Ctrl, Cmd or Alt held a key is another one (Ctrl+- is not "-"); Shift may give "+".
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (linkKey(event)) {
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
    } else if (event.key === DEPTH_MORE || event.key === DEPTH_LESS) {
      event.preventDefault();
      const depth = event.key === DEPTH_MORE ? deeper(buffer.depth) : shallower(buffer.depth);
      dispatch({ type: "open", buffer: { ...buffer, depth } });
    }
  };

  const order = layout?.nodes.map((placed) => placed.key) ?? [];
  const paths = [...(layout?.paths ?? [])].sort(
    (a, b) =>
      Number(a.source === selected || a.target === selected) -
      Number(b.source === selected || b.target === selected),
  );
  const lit = spotlit(paths, selected);
  const evidenceOf = new Map(layout?.evidence.map((box) => [box.node, box.evidence]));
  const nodeOption = `${scope}gnode-${String(order.indexOf(selected))}`;
  return (
    <div
      ref={root}
      className="buffer graph"
      role="listbox"
      aria-label={`Graph: ${buffer.name}`}
      aria-activedescendant={layout === undefined ? undefined : activeOption(chosen, scope, nodeOption)}
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
                  key={pathKey(path)}
                  className={[
                    edgeClasses(path.links, lit && (path.source === selected || path.target === selected)),
                    ...(path === chosen ? ["chosen"] : []),
                    ...(path === links.hovered?.path ? ["hovered"] : []),
                  ].join(" ")}
                  d={path.d}
                  data-source={path.source}
                  data-target={path.target}
                />
              ))}
              <LinkHits paths={paths} hover={links.hover} />
              {layout.evidence.map((box) => (
                <path key={box.key} className="graph-evidence-line" d={box.d} data-evidence={box.node} />
              ))}
            </svg>
            {layout.evidence.map((box) => {
              const text = evidenceText(box.evidence);
              return (
                // No option and no selection: the node's accessible name says it (AK5).
                <div
                  key={box.key}
                  className="graph-evidence"
                  aria-hidden="true"
                  title={text}
                  data-evidence={box.node}
                  style={{ left: box.x, top: box.y, width: NODE_WIDTH, height: EVIDENCE_HEIGHT }}
                >
                  {text}
                </div>
              );
            })}
            {layout.nodes.map((placed, index) => {
              const typeName = typeNames.get(placed.node.type) ?? placed.node.type;
              const classes = [
                "graph-node",
                ...(placed.key === rootKey ? ["root"] : []),
                ...(placed.key === selected && chosen !== undefined ? ["link-chosen"] : []),
                ...(placed.node.marks.includes("superseded") ? ["superseded"] : []),
              ];
              return (
                <div
                  key={placed.key}
                  id={`${scope}gnode-${String(index)}`}
                  className={classes.join(" ")}
                  role="option"
                  aria-selected={placed.key === selected && chosen === undefined}
                  aria-label={nodeLabel(placed.node, typeName, evidenceOf.get(placed.key))}
                  title={`${nodeId(placed.node)} · ${typeName}\n${placed.node.title}`}
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
            <LinkTips layout={layout} links={links} kindNames={kindNames} scope={scope} />
          </div>
        </div>
      )}
    </div>
  );
};
