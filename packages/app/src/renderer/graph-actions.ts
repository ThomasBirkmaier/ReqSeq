// The actions on the neighbourhood, the graph and the metamodel of the shown buffer; `ACTIONS` (`actions.ts`) lists them.
import type { GraphBuffer, MetamodelBuffer } from "./buffers.js";
import { elementBuffer, graphBuffer, metamodelBuffer, neighbourhoodBuffer, showBuffer } from "./buffers.js";
import { MATRIX_SHORTCUT } from "./list-actions.js";
import type { Shortcut } from "./keys.js";
import type { GraphChoice, GraphFilterChoice } from "./graph-choices.js";
import {
  DEPTH_KEYS,
  EVERYTHING,
  alsoChoices,
  depthChoices,
  hasFilter,
  onlyChoices,
} from "./graph-choices.js";
import { mermaidInput } from "./graph.js";
import type { CommandIn, ActionContext, Action } from "./action-types.js";
import { isElement, isNeighbourhood, isGraph, hasWorkspace, metamodelIn } from "./action-conditions.js";

/** What the actions that set what the shown graph follows run (SR-210 AK5). */
const GRAPH_RUNS: readonly CommandIn[] = [{ where: "in the graph", command: "trace.graph" }];

/** Ctrl/Cmd+J shows the neighbourhood of the shown element (SR-107), and on the neighbourhood the element again. */
const NEIGHBOURHOOD_SHORTCUT: Shortcut = { mod: true, shift: false, key: "j" };

/**
 * Ctrl/Cmd+Shift+G shows the graph of the shown element (SR-111), and on the graph the element again.
 * Not Ctrl/Cmd+G: Ctrl+G is the Emacs keyboard-quit (SR-121) and stays free.
 */
export const GRAPH_SHORTCUT: Shortcut = { mod: true, shift: true, key: "g" };

/**
 * Ctrl/Cmd+T also shows the metamodel as text, and the text as a graph again (SR-130 AK4): the key that
 * switches the representation of the shown buffer. Never available together with the matrix actions.
 */
const METAMODEL_SHORTCUT: Shortcut = MATRIX_SHORTCUT;

/** Shows the metamodel in `to` when it is shown in `from`; the marked entry stays. */
const switchMetamodel =
  (from: MetamodelBuffer["mode"], to: MetamodelBuffer["mode"]) =>
  (context: ActionContext): void => {
    const shown = metamodelIn(context, from);
    if (shown !== undefined) {
      context.dispatch({ type: "open", buffer: { ...shown, mode: to } });
    }
  };

/**
 * An action on the shown graph that asks with `label` for one of the entries `choices` gives: taking one
 * shows its graph buffer, the same buffer with another depth or filter, so the graph asks `trace.graph`
 * again and keeps the selected node while it is still there. `nothing` is said when there is no entry (only
 * "Also show" can have none: the depths are always there, and "Show only" always has "Everything").
 */
const graphPrompt =
  (
    label: string,
    choices: (graph: GraphBuffer, filters: readonly GraphFilterChoice[]) => readonly GraphChoice[],
    nothing?: string,
  ) =>
  (context: ActionContext): void => {
    const graph = context.buffers[0];
    if (graph?.kind !== "graph") {
      return;
    }
    const items = choices(graph, context.graphChoices ?? [EVERYTHING]);
    if (items.length === 0 && nothing !== undefined) {
      context.echo(nothing);
      return;
    }
    context.ask({
      label,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        ...(item.hint === undefined ? {} : { hint: item.hint }),
        run: () => {
          context.dispatch({ type: "open", buffer: item.buffer });
        },
      })),
    });
  };

export const GRAPH_ACTIONS: readonly Action[] = [
  {
    id: "neighbourhood",
    title: "Show neighbourhood",
    shortcut: NEIGHBOURHOOD_SHORTCUT,
    available: isElement,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "element") {
        showBuffer(context, neighbourhoodBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    id: "neighbourhood-back",
    title: "Show element",
    description: "Show the element of the shown neighbourhood again.",
    // The title of `element.get`, which "Go to element or buffer" covers; this one covers no command.
    covers: [],
    shortcut: NEIGHBOURHOOD_SHORTCUT,
    available: isNeighbourhood,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "neighbourhood") {
        showBuffer(context, elementBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    // The title of `trace.graph` in the catalog; it covers that command, so the command prompt lists it
    // once and its output opens the graph buffer, never a result buffer (ADR-0002).
    id: "graph",
    title: "Show graph",
    shortcut: GRAPH_SHORTCUT,
    covers: ["trace.graph"],
    available: (context: ActionContext): boolean => isElement(context) || isNeighbourhood(context),
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "element" || current?.kind === "neighbourhood") {
        showBuffer(context, graphBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    id: "graph-back",
    title: "Show element",
    description: "Show the element of the shown graph again.",
    // The title of `element.get`, which "Go to element or buffer" covers; this one covers no command.
    covers: [],
    shortcut: GRAPH_SHORTCUT,
    available: isGraph,
    run: (context: ActionContext): void => {
      const current = context.buffers[0];
      if (current?.kind === "graph") {
        showBuffer(context, elementBuffer(current.id, current.repository, current.name));
      }
    },
  },
  {
    // SR-111 AK2: the same as `+` and `-` on the graph, which the hint names.
    id: "graph-depth",
    title: "Graph depth",
    description: "Set how many levels the shown graph follows.",
    runs: GRAPH_RUNS,
    hint: DEPTH_KEYS,
    available: isGraph,
    run: graphPrompt("Graph depth", (graph) => depthChoices(graph)),
  },
  {
    // SR-111 AK3: one kind, a meaning or everything in place of the filter.
    id: "graph-only",
    title: "Show only relation kind",
    description: "Let the shown graph follow only one relation kind.",
    runs: GRAPH_RUNS,
    available: isGraph,
    run: graphPrompt("Show only", onlyChoices),
  },
  {
    // SR-111 AK3: one more kind or meaning while the graph follows some kinds only, or the evidence
    // while it is not shown.
    id: "graph-also",
    title: "Also show relation kind",
    description: "Let the shown graph follow one more relation kind.",
    runs: GRAPH_RUNS,
    available: (context: ActionContext): boolean => {
      const shown = context.buffers[0];
      return (
        shown?.kind === "graph" &&
        (hasFilter(shown) || alsoChoices(shown, context.graphChoices ?? [EVERYTHING]).length > 0)
      );
    },
    run: graphPrompt("Also show", alsoChoices, "Every relation kind is shown already."),
  },
  {
    // SR-130 AK1: the title of `metamodel.get` in the catalog; it covers that command, so the command
    // prompt lists it once (initials "sm") and its output opens the metamodel buffer as a graph, never a
    // result buffer. No key of its own (keys are scarce, Ctrl/Cmd+K is the prefix key, ThomasBirkmaier/ReqSeq-archive#472). Not
    // offered on the metamodel itself (SR-133): there the toggle switches between graph and text, so on
    // the text "sm" finds "Show metamodel as graph" only with more letters (review N2). An open metamodel
    // buffer is shown as a graph and keeps its marked entry.
    id: "metamodel",
    title: "Show metamodel",
    covers: ["metamodel.get"],
    available: (context: ActionContext): boolean =>
      hasWorkspace(context) && context.buffers[0]?.kind !== "metamodel",
    run: (context: ActionContext): void => {
      const open = context.buffers.find((buffer) => buffer.kind === "metamodel");
      context.dispatch({
        type: "open",
        buffer: open === undefined ? metamodelBuffer() : { ...open, mode: "graph" },
      });
    },
  },
  {
    // SR-151 AK5: only on the graph of an element or of the metamodel, with the graph's own depth, kinds and
    // view; the text is core's (`trace.mermaid`, `metamodel.mermaid`), and the modeline confirms the copy
    // (SR-128 AK2). It covers both commands, so the command prompt offers no other entry for them.
    id: "copy-mermaid",
    title: "Copy graph as Mermaid",
    description: "Copy the shown graph of an element or of the metamodel as a Mermaid flowchart.",
    runs: [
      { where: "in the graph of an element", command: "trace.mermaid" },
      { where: "in the graph of the metamodel", command: "metamodel.mermaid" },
    ],
    covers: ["trace.mermaid", "metamodel.mermaid"],
    available: (context: ActionContext): boolean =>
      isGraph(context) || metamodelIn(context, "graph") !== undefined,
    run: (context: ActionContext): void => {
      const shown = context.buffers[0];
      const call = context.shownCall ?? context.call;
      void (
        shown?.kind === "graph" ? call("trace.mermaid", mermaidInput(shown)) : call("metamodel.mermaid", {})
      ).then((answer) => {
        if (answer.ok) {
          context.copy?.("graph as Mermaid", answer.output.mermaid);
        } else {
          context.echo(answer.message);
        }
      });
    },
  },
  {
    // SR-130 AK4: Ctrl/Cmd+T switches the shown metamodel between graph and text; the selected type stays.
    id: "metamodel-text",
    title: "Show metamodel as text",
    description: "Show the metamodel as text in place of the graph.",
    shortcut: METAMODEL_SHORTCUT,
    available: (context: ActionContext): boolean => metamodelIn(context, "graph") !== undefined,
    run: switchMetamodel("graph", "text"),
  },
  {
    id: "metamodel-graph",
    title: "Show metamodel as graph",
    description: "Show the metamodel as a graph in place of the text.",
    shortcut: METAMODEL_SHORTCUT,
    available: (context: ActionContext): boolean => metamodelIn(context, "text") !== undefined,
    run: switchMetamodel("text", "graph"),
  },
];
