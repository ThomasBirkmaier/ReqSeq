// The wider trace of an element: its graph over several levels (`#/graph/<ref>`, `trace.graph`), and what a
// change of it can affect (`#/impact/<ref>`, `trace.affected`). The graph stands in layers by the level
// ReqSeq gives each node: what the element points to above it, what points to it below. Within a layer the
// nodes are ordered so that links cross little (`layout`); the layout is drawing only, every node, level and
// link is ReqSeq's.
import "../css/trace.css";
import type { TraceAffectedOutput, TraceGraphOutput } from "@reqseq/core";
import { boundNote } from "@reqseq/core/displays";
import { call } from "../api.js";
import type { Child } from "../dom.js";
import { h, s } from "../dom.js";
import { addElementTab, elementPage, tabHref } from "../element-tabs.js";
import { dateText } from "./evidence.js";
import { errorBox } from "../layout.js";
import { statusPill, verificationMark } from "../marks.js";
import { isInvalid, propDef, relKind, sentence, statusName, typeName } from "../meaning.js";
import type { Route } from "../router.js";
import { addRoute, fromOf, hashOf, isCurrent } from "../router.js";
import { el, refOf, shownId, store, viewSelection } from "../store.js";

const GRAPH = "graph";
const IMPACT = "impact";

type Node = TraceGraphOutput["nodes"][number];
type Edge = TraceGraphOutput["edges"][number];
/** What the head of a page names of its element. */
interface Head {
  readonly identifier?: string;
  readonly type?: string;
  readonly status?: string;
  readonly title?: string;
  readonly shortId: string;
}

/** The most nodes a graph reads; `truncated` says when there are more. */
const GRAPH_LIMIT = 300;
/** The size of a node and the space around it, in CSS pixels; `trace.css` gives `.gnode` the same size. */
export const NODE_W = 232;
export const NODE_H = 92;
const GAP_X = 20;
const GAP_Y = 64;
/** At most this many nodes stand side by side; a larger level wraps into several rows. */
const ROW = 4;

export interface Placed {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** The row of the drawing, counted from the top. */
  readonly row: number;
}

/**
 * Places the nodes: one layer per level (most negative on top), each layer ordered by the mean position of its
 * neighbours in the layers above and below (a few sweeps down and up), then cut into rows of at most `ROW`.
 */
export function layout(
  nodes: readonly Pick<Node, "id" | "level">[],
  edges: readonly Pick<Edge, "source" | "target">[],
): { readonly placed: ReadonlyMap<string, Placed>; readonly width: number; readonly height: number } {
  const levels = [...new Set(nodes.map((n) => n.level))].sort((a, b) => a - b);
  const levelOf = new Map(nodes.map((n) => [n.id, n.level]));
  const layers = levels.map((level) => nodes.filter((n) => n.level === level).map((n) => n.id));
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    const a = levelOf.get(edge.source);
    const b = levelOf.get(edge.target);
    if (a === undefined || b === undefined || a === b || edge.source === edge.target) {
      continue;
    }
    neighbours.set(edge.source, [...(neighbours.get(edge.source) ?? []), edge.target]);
    neighbours.set(edge.target, [...(neighbours.get(edge.target) ?? []), edge.source]);
  }
  const position = new Map<string, number>();
  const index = (): void => {
    for (const layer of layers) {
      layer.forEach((id, at) => position.set(id, layer.length <= 1 ? 0.5 : at / (layer.length - 1)));
    }
  };
  index();
  const sweep = (order: readonly number[], toward: number): void => {
    for (const at of order) {
      const layer = layers[at];
      const level = levels[at + toward];
      if (layer === undefined || level === undefined) {
        continue;
      }
      const mean = (id: string): number => {
        const near = (neighbours.get(id) ?? []).filter((n) => levelOf.get(n) === level);
        return near.length === 0
          ? (position.get(id) ?? 0)
          : near.reduce((sum, n) => sum + (position.get(n) ?? 0), 0) / near.length;
      };
      const keyed = layer.map((id, i) => ({ id, key: mean(id), i }));
      keyed.sort((a, b) => a.key - b.key || a.i - b.i);
      layers[at] = keyed.map((k) => k.id);
      index();
    }
  };
  const down = levels.map((_, at) => at).slice(1);
  const up = levels
    .map((_, at) => at)
    .reverse()
    .slice(1);
  for (let round = 0; round < 3; round += 1) {
    sweep(down, -1);
    sweep(up, 1);
  }
  const rows = layers.flatMap((layer) => {
    const cut: string[][] = [];
    for (let at = 0; at < layer.length; at += ROW) {
      cut.push(layer.slice(at, at + ROW));
    }
    return cut;
  });
  const widest = Math.max(1, ...rows.map((row) => row.length));
  const width = widest * NODE_W + (widest - 1) * GAP_X;
  const placed = new Map<string, Placed>();
  rows.forEach((row, r) => {
    const rowWidth = row.length * NODE_W + (row.length - 1) * GAP_X;
    const left = (width - rowWidth) / 2;
    row.forEach((id, at) => {
      placed.set(id, { id, x: left + at * (NODE_W + GAP_X), y: r * (NODE_H + GAP_Y), row: r });
    });
  });
  return { placed, width, height: rows.length * NODE_H + Math.max(0, rows.length - 1) * GAP_Y };
}

const px = (value: number): string => String(Math.round(value * 10) / 10);

/** The path of a link from its source to its target: a soft curve between the nearer edges of the two nodes. */
export function linkPath(from: Placed, to: Placed): string {
  const fx = from.x + NODE_W / 2;
  const tx = to.x + NODE_W / 2;
  if (from.row === to.row) {
    // Side by side: an arc over the top of both.
    const y = from.y;
    const lift = Math.min(GAP_Y - 12, 24 + Math.abs(fx - tx) / 12);
    return `M${px(fx)} ${px(y)} C${px(fx)} ${px(y - lift)} ${px(tx)} ${px(y - lift)} ${px(tx)} ${px(y)}`;
  }
  const down = from.row < to.row;
  const fy = down ? from.y + NODE_H : from.y;
  const ty = down ? to.y : to.y + NODE_H;
  const mid = (fy + ty) / 2;
  return `M${px(fx)} ${px(fy)} C${px(fx)} ${px(mid)} ${px(tx)} ${px(mid)} ${px(tx)} ${px(ty)}`;
}

interface GraphOptions {
  readonly depth: string;
  readonly chain: boolean;
  readonly evidence: boolean;
}

const DEPTHS = ["1", "2", "3", "4", "all"] as const;

const optionsOf = (route: Route): GraphOptions => {
  const depth = route.params.get("depth") ?? "2";
  return {
    depth: (DEPTHS as readonly string[]).includes(depth) ? depth : "2",
    chain: route.params.get("chain") === "1",
    evidence: route.params.get("evidence") === "1",
  };
};

const paramsOf = (o: GraphOptions): Record<string, string> => ({
  depth: o.depth,
  ...(o.chain ? { chain: "1" } : {}),
  ...(o.evidence ? { evidence: "1" } : {}),
});

const levelWords = (level: number): string =>
  level === 0
    ? "The element"
    : level < 0
      ? `${level === -1 ? "One level" : `${String(-level)} levels`} up: what it points to`
      : `${level === 1 ? "One level" : `${String(level)} levels`} down: what points to it`;

/** The words of a node's evidence below it (`withEvidence`). */
const evidenceWords = (summary: NonNullable<TraceGraphOutput["evidence"]>[number]): string => {
  const r = summary.results;
  const parts = [
    r.passed === undefined ? null : `${String(r.passed)} passed`,
    r.failed === undefined ? null : `${String(r.failed)} failed`,
    r.inconclusive === undefined ? null : `${String(r.inconclusive)} inconclusive`,
    r.skipped === undefined ? null : `${String(r.skipped)} skipped`,
  ].filter((p): p is string => p !== null);
  const what = [
    summary.testCases === 0
      ? null
      : `${String(summary.testCases)} test ${summary.testCases === 1 ? "case" : "cases"}`,
    summary.records === 0
      ? null
      : `${String(summary.records)} ${summary.records === 1 ? "record" : "records"}`,
  ].filter((p): p is string => p !== null);
  return `${what.join(", ")}${parts.length === 0 ? "" : `: ${parts.join(", ")}`}`;
};

/** The first line of a node: ID and type, and its status where it is retired, its verification or degree. */
const nodeKick = (node: Node): HTMLElement => {
  const entry = node.verification?.[0];
  return h(
    "span",
    { class: "nk" },
    `${shownId(node)} ${typeName(store.mm, node.type)}`.trim(),
    node.marks.includes("superseded")
      ? h("span", { class: "tt-obs" }, statusName(store.mm, node.status))
      : null,
    entry === undefined
      ? null
      : verificationMark(
          entry.status,
          node.criteria === undefined
            ? undefined
            : `${String(node.criteria.verified)}/${String(node.criteria.total)}`,
        ),
    node.degree?.share === undefined
      ? null
      : h("span", { class: "deg" }, `${String(Math.round(node.degree.share * 100))} % verified`),
  );
};

/** A node of the graph: a link that centres the graph on it, or for the element itself to its page. */
function nodeBox(
  node: Node,
  at: Placed,
  root: boolean,
  route: Route,
  options: GraphOptions,
  summary: string | undefined,
): HTMLElement {
  const from = route.params.get("from");
  const href = root
    ? tabHref("e", node, from)
    : tabHref(GRAPH, node, fromOf(...route.parts), paramsOf(options));
  const marks = node.marks;
  const box = h(
    "a",
    {
      class: `gnode${root ? " root" : ""}${marks.includes("outdated") ? " warn" : ""}${marks.includes("superseded") ? " obs" : ""}`,
      href,
      "data-id": node.id,
      title: root ? "Open the element" : "Centre the graph on this element",
    },
    nodeKick(node),
    h("span", { class: "nt" }, node.title === "" ? node.shortId : node.title),
    summary === undefined ? null : h("span", { class: "ne" }, summary),
    marks.includes("outdated") ? h("span", { class: "why" }, "has outdated links") : null,
  );
  box.style.setProperty("left", `${px(at.x)}px`);
  box.style.setProperty("top", `${px(at.y)}px`);
  return box;
}

/** The graph: nodes in layers and the links between them. */
function graphView(graph: TraceGraphOutput, route: Route, options: GraphOptions): HTMLElement {
  const { placed, width, height } = layout(graph.nodes, graph.edges);
  const summaries = new Map((graph.evidence ?? []).map((x) => [x.id, evidenceWords(x)]));
  const svg = s(
    "svg",
    { class: "glinks", width: px(width), height: px(height), "aria-hidden": "true" },
    graph.edges
      .flatMap((edge) => {
        const from = placed.get(edge.source);
        const to = placed.get(edge.target);
        return from === undefined || to === undefined || edge.source === edge.target
          ? []
          : [{ edge, from, to }];
      })
      // Outdated links last, so a broken link is never hidden under a grey one.
      .sort((a, b) => Number(a.edge.outdated) - Number(b.edge.outdated))
      .map(({ edge, from, to }) =>
        s("path", {
          class: [
            edge.link === "reference" ? "ref" : edge.meaning === "derivation" ? "der" : "rel",
            edge.outdated ? "warn" : "",
          ]
            .join(" ")
            .trim(),
          d: linkPath(from, to),
        }),
      ),
  );
  const levels = [...new Set(graph.nodes.map((x) => x.level))].sort((a, b) => a - b);
  const canvas = h(
    "div",
    { class: "gcanvas" },
    svg,
    levels.map((level) =>
      h(
        "div",
        { role: "group", "aria-label": levelWords(level), class: "glevel" },
        graph.nodes
          .filter((x) => x.level === level)
          .map((x) => {
            const at = placed.get(x.id);
            return at === undefined
              ? null
              : nodeBox(x, at, x.id === graph.root, route, options, summaries.get(x.id));
          }),
      ),
    ),
  );
  canvas.style.setProperty("width", `${px(width)}px`);
  canvas.style.setProperty("height", `${px(height)}px`);
  return h("div", { class: "gscroll", tabindex: 0, "aria-label": "Trace graph" }, canvas);
}

/** The controls of the graph: how far it goes, which links it follows, whether it shows evidence. */
function graphControls(
  route: Route,
  options: GraphOptions,
  e: Pick<Node, "identifier" | "shortId">,
): HTMLElement {
  const go = (next: GraphOptions): void => {
    location.hash = tabHref(GRAPH, e, route.params.get("from"), paramsOf(next));
  };
  const depth = h(
    "select",
    { name: "depth" },
    DEPTHS.map((d) =>
      h(
        "option",
        { value: d, selected: d === options.depth },
        d === "all" ? "All levels" : d === "1" ? "1 level" : `${d} levels`,
      ),
    ),
  );
  depth.addEventListener("change", () => {
    go({ ...options, depth: depth.value });
  });
  const check = (label: string, on: boolean, change: (value: boolean) => void): HTMLElement => {
    const box = h("input", { type: "checkbox", checked: on });
    box.addEventListener("change", () => {
      change(box.checked);
    });
    return h("label", { class: "check" }, box, label);
  };
  return h(
    "div",
    { class: "gctl" },
    h("label", { class: "fld inline" }, h("span", { class: "fl" }, "Depth"), depth),
    check("Derivations only", options.chain, (chain) => {
      go({ ...options, chain });
    }),
    check("Show evidence", options.evidence, (evidence) => {
      go({ ...options, evidence });
    }),
  );
}

const legend = (): HTMLElement =>
  h(
    "p",
    { class: "glegend" },
    h("span", { class: "lk der" }, "derivation"),
    h("span", { class: "lk rel" }, "other relation"),
    h("span", { class: "lk ref" }, "inline reference"),
    h("span", { class: "lk warn" }, "changed since linked"),
  );

const subHead = (e: Head, title: string): HTMLElement =>
  h(
    "div",
    { class: "sub-head" },
    h(
      "div",
      { class: "kick" },
      shownId(e) === "" ? null : h("b", null, shownId(e)),
      h("span", null, typeName(store.mm, e.type)),
      statusPill(e.status),
    ),
    h("h1", null, `${title}: `, e.title === undefined || e.title === "" ? e.shortId : e.title),
  );

/** Draws `body` for the element of the route, or the error of its command. */
async function page<T>(
  root: HTMLElement,
  route: Route,
  current: string,
  read: (ref: string) => Promise<T>,
  draw: (answer: T) => {
    readonly element: Head;
    readonly body: Child;
    readonly title: string;
  },
): Promise<void> {
  const ref = route.parts[1] ?? "";
  let answer: T;
  try {
    answer = await read(ref);
  } catch (error) {
    if (isCurrent(route)) {
      root.replaceChildren(
        elementPage(el(ref), current, route, h("h1", { class: "sr" }, current), errorBox(error)),
      );
    }
    return;
  }
  if (!isCurrent(route)) {
    return;
  }
  const { element, body, title } = draw(answer);
  root.replaceChildren(elementPage(element, current, route, body));
  document.title = `${title} · ${shownId(element) === "" ? "" : `${shownId(element)} `}${element.title ?? element.shortId} · ReqSeq`;
}

async function renderGraph(root: HTMLElement, route: Route): Promise<void> {
  const options = optionsOf(route);
  await page(
    root,
    route,
    GRAPH,
    (ref) =>
      call("trace.graph", {
        ref,
        ...(options.depth === "all" ? { allLevels: true } : { maxDepth: Number(options.depth) }),
        ...(options.chain ? { meanings: ["derivation"] } : {}),
        ...(options.evidence ? { withEvidence: true } : {}),
        limit: GRAPH_LIMIT,
        ...viewSelection(),
      }),
    (graph) => {
      const first = graph.nodes[0];
      const element: Head = first ?? { shortId: route.parts[1] ?? "" };
      return {
        element,
        title: "Trace graph",
        body: [
          subHead(element, "Trace graph"),
          graphControls(route, options, element),
          graph.truncated ? h("p", { class: "note" }, boundNote(graph.nodes.length)) : null,
          graph.nodes.length <= 1
            ? h("div", { class: "empty" }, h("strong", null, "Nothing is linked to it yet."))
            : [graphView(graph, route, options), legend()],
          graph.problems.map((p) => h("p", { class: "note" }, p.message)),
        ],
      };
    },
  );
}

const PAGE_AFFECTED = 200;

/** How an affected element points at the one before it on its path. */
const viaWords = (via: TraceAffectedOutput["affected"][number]["via"]): string => {
  if (via.kind === "reference") {
    return "inline reference";
  }
  const key = via.key ?? "";
  return sentence(relKind(store.mm, key)?.name ?? propDef(store.mm, key)?.name ?? key);
};

const nameOfId = (id: string): string => {
  const e = el(id);
  return e === undefined ? id : (e.identifier ?? e.title ?? e.shortId);
};

async function renderImpact(root: HTMLElement, route: Route): Promise<void> {
  const offset = Math.max(0, Number(route.params.get("offset") ?? "0") || 0);
  const ref = route.parts[1] ?? "";
  const target = el(ref);
  await page(
    root,
    route,
    IMPACT,
    (r) => call("trace.affected", { ref: r, limit: PAGE_AFFECTED, offset }),
    (answer) => {
      const element: Head = target ?? { shortId: ref };
      const from = fromOf(...route.parts);
      const by = new Map<number, TraceAffectedOutput["affected"]>();
      for (const a of answer.affected) {
        by.set(a.distance, [...(by.get(a.distance) ?? []), a]);
      }
      const pager = (at: number, text: string): HTMLElement =>
        h(
          "a",
          {
            class: "btn sm",
            href: tabHref(IMPACT, element, route.params.get("from"), at === 0 ? {} : { offset: String(at) }),
          },
          text,
        );
      return {
        element,
        title: "Impact",
        body: [
          subHead(element, "Impact of a change"),
          h(
            "p",
            { class: "lead" },
            answer.total === 0
              ? "Nothing points at it, so a change of it affects no other element."
              : `${String(answer.total)} ${answer.total === 1 ? "element points" : "elements point"} at it, directly or through others. A change of it can affect ${answer.total === 1 ? "it" : "them"}.`,
          ),
          [...by].map(([distance, rows]) =>
            h(
              "section",
              { class: "dist" },
              h(
                "h2",
                { class: "group" },
                distance === 1 ? "Directly" : `${String(distance)} steps away`,
                h("b", null, rows.length),
              ),
              h(
                "div",
                { role: "list" },
                rows.map((a) =>
                  h(
                    "div",
                    { role: "listitem" },
                    h(
                      "a",
                      {
                        class: `it${isInvalid(store.mm, el(a.id)?.status) ? " obs" : ""}`,
                        href: `${hashOf("e", el(a.id) === undefined ? a.shortId : refOf(a))}?from=${encodeURIComponent(from)}`,
                        "data-id": a.id,
                      },
                      h("span", { class: "id" }, shownId(a)),
                      h("span", { class: "t" }, a.title === "" ? a.shortId : a.title),
                      h("span", null),
                      h(
                        "span",
                        { class: "m" },
                        `${typeName(store.mm, a.type)} · ${viaWords(a.via)}${
                          a.path.length > 2
                            ? ` · via ${a.path
                                .slice(1, -1)
                                .map((p) => nameOfId(p.id))
                                .join(", ")}`
                            : ""
                        }`,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          answer.total > PAGE_AFFECTED
            ? h(
                "div",
                { class: "pager" },
                offset > 0 ? pager(Math.max(0, offset - PAGE_AFFECTED), "Previous") : null,
                h(
                  "span",
                  null,
                  `${String(offset + 1)}–${String(Math.min(answer.total, offset + PAGE_AFFECTED))} of ${String(answer.total)}`,
                ),
                offset + PAGE_AFFECTED < answer.total ? pager(offset + PAGE_AFFECTED, "Next") : null,
              )
            : null,
          answer.records.length === 0
            ? null
            : h(
                "section",
                { class: "olderrec" },
                h(
                  "h2",
                  { class: "group" },
                  "Evidence of older versions",
                  h("b", null, answer.records.length),
                ),
                h(
                  "p",
                  { class: "note" },
                  "These records were made for an earlier version of the element. Check them again against the current one.",
                ),
                h(
                  "ul",
                  null,
                  answer.records.map((r) =>
                    h(
                      "li",
                      null,
                      `${dateText(r.date)} · ${r.result} · ${r.testCase ?? r.method ?? r.kind} · version ${r.version}`,
                    ),
                  ),
                ),
              ),
          answer.incomplete
            ? h(
                "p",
                { class: "note" },
                "A repository of the workspace is not on this machine; elements there may point at it too.",
              )
            : null,
        ],
      };
    },
  );
}

addRoute(GRAPH, renderGraph);
addRoute(IMPACT, renderImpact);
addElementTab({ route: GRAPH, name: "Trace graph", order: 20 });
addElementTab({ route: IMPACT, name: "Impact", order: 30 });
