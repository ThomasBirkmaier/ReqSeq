// The neighbourhood on an element's page (SR-232 AK5, AK6), as the app's neighbourhood buffer shows it (SR-107), from
// the walks of `trace.neighbourhood` (`traceNeighbourhood`) with its marks of an edge (`edgeMarks`: repeated, SR-107
// AK3; outdated, SR-107 AK4).
//
// - Parents: the up walk over the derivations, the topmost first; each level one step less indented, the direct
//   parents last, each element once (its shortest depth). A parent that a derivation of the walk points at with an
//   older version is marked outdated.
// - Children: the down walk over the derivations as a tree in walk order. A child reached again (a child of several
//   parents, a cycle) stands under each parent; every place but the one the walk reached first, the nearest to the
//   element, is marked repeated and has no rows below it. A child whose derivation stores an older version is marked
//   outdated.
// - Incoming: every other relation, relation property and inline reference that points at the element (the incoming
//   walk follows no derivation: those are the children), one group per key and one for the inline references, the
//   groups in the order they first appear (as in the app). A group is named as `trace.matrix` names an incoming
//   column: a relation kind's inverse name, else its name, and a property by its name; two keys with the same name
//   stay two groups. Outdated ones are marked.
// - Each row: short ID with the identifier, title and status ("–" without one), as a link to the element's page. An
//   element with an invalid status (D-044) is a row without a link, also where the earlier export left a short page
//   (SR-231 AK8), and the walks go on through it (AK6); an element without a page (several files share its UUID)
//   is a row without a link as well.
// - Without parents or children the section says so; without incoming links it has no such group.
// - A repository of the workspace file that is not on this machine (SR-232 AK8, SR-006 AK2): a line naming the missing
//   repositories in the order of the workspace file says that children from their elements may be missing, after the
//   children and their bound note (in place of "No children" without one), and a last line of the section says the
//   same of incoming relations and references, also without an incoming group. A derivation of the element or of a
//   shown parent whose target lies in such a repository (`targetState` `inaccessible`) is a parent row without a link,
//   as an outgoing relation names it (`UNKNOWN-<tail>, repository <name>, not accessible`, SR-006 AK1), with no
//   outdated mark and no parents of its own; each target once, one level above the nearest shown element that points
//   at it (the walk's order is by depth, so the first one found). A missing or ambiguous target, or one in a
//   repository the workspace file does not name, stays out of the section (the relations section shows it). These
//   rows and lines are not counted in the bound and have none.
// - Bound: parents and children show the nearest `NEIGHBOURHOOD_LIMIT` elements each (breadth first, the walk's
//   order), and say so only when the walk reached more (SR-232 AK5): each element counted once on its nearest level,
//   also one with an invalid status, so every nearer level stands whole. The children's tree is drawn from the shown
//   elements only: a link to one that is not shown is left out, a repetition of a shown one stays. A chain of 50,000
//   elements can reach tens of thousands of elements (N-036), and every element of it has a page: without the bound
//   the pages of the performance suite's workspace come to about 29 GB. Each walk stops one element past the bound
//   (`maxNodes`), so a page costs its bound, not its chain.
//   The incoming links are one step and have no bound.
// - Cost: per page two bounded walks over the derivations and one step over the other links; the current versions
//   and the names of the incoming groups are read once for the export (`neighbourhoodSource`).
import type { ElementRecord, IncomingLink } from "../model/index.js";
import {
  UNKNOWN_TYPE_PREFIX,
  hasId,
  invalidStatuses,
  relationItems,
  relationKeysOf,
  targetState,
  titleKeyOrEmpty,
} from "../model/index.js";
import type { NeighbourhoodContext, NeighbourhoodWalk, TraceContext, VersionLookup } from "../trace/index.js";
import { edgeMarks, neighbourhoodContext, traceNeighbourhood } from "../trace/index.js";
import type { WalkEdge } from "../trace/walk.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { escapeHtml } from "./markdown.js";

type Edge = WalkEdge<IncomingLink>;

/** The most parents and the most children a page shows (see the file comment). */
export const NEIGHBOURHOOD_LIMIT = 100;

/** The group key of inline references; no relation key is empty. */
const REFERENCES = "";

/** What the section reads besides the page (see the file comment). */
export interface NeighbourhoodSource {
  /** The walks over the derivations only. */
  readonly derivations: NeighbourhoodContext;
  /** The incoming walk: every relation key that is no derivation, and the inline references. */
  readonly incoming: NeighbourhoodContext;
  /** The name of each group of incoming links by its key, in the order of the metamodel. */
  readonly groupNames: ReadonlyMap<string, string>;
  readonly versionOf: VersionLookup;
  /** The keys of the statuses marked invalid. */
  readonly invalid: ReadonlySet<string>;
  readonly titleKey: string;
}

/** The source of the section for a workspace's trace context and the current versions of its elements. */
export const neighbourhoodSource = (trace: TraceContext, versionOf: VersionLookup): NeighbourhoodSource => {
  const { metamodel } = trace;
  const keys = relationKeysOf(metamodel);
  // A key that is both a property and a relation kind counts as the property (`relationKeysOf`).
  const groupNames = new Map<string, string>([
    ...metamodel.relations
      .filter((kind) => kind.meaning !== "derivation")
      .map((kind) => [kind.key, kind["inverse-name"] ?? kind.name] as const),
    ...metamodel.properties.filter((p) => keys.has(p.key)).map((p) => [p.key, p.name] as const),
  ]);
  return {
    derivations: neighbourhoodContext(trace, { meanings: ["derivation"] }),
    incoming: neighbourhoodContext(trace, { kinds: [...groupNames.keys()], meanings: ["reference"] }),
    groupNames: new Map([...groupNames, [REFERENCES, "inline reference"]]),
    versionOf,
    invalid: new Set(invalidStatuses(metamodel).keys()),
    titleKey: titleKeyOrEmpty(metamodel),
  };
};

/** The ID a row shows: the short ID, with the identifier when the element has one. */
const shownId = (context: ElementPageContext, element: ElementRecord): string => {
  const identifier = context.shortIds.identifierOf(element);
  const shortId = context.shortIds.of(element);
  return identifier === undefined ? shortId : `${shortId} (${identifier})`;
};

/** The hover text of an outdated `edge` to `target`: which end points to an older version, by which key. */
const outdatedNote = (context: ElementPageContext, edge: Edge, target: ElementRecord): string =>
  `${shownId(context, edge.link.source)} points to an older version of ${shownId(context, target)} (${edge.link.kind === "relation" ? edge.link.key : "inline reference"})`;

const outdatedMark = (notes: readonly string[]): string =>
  notes.length === 0
    ? ""
    : ` <span class="rq-outdated" title="${escapeHtml(notes.join("; "))}">link outdated</span>`;

/** Whether one edge of `walked` is a repetition, and its outdated mark. */
const edgeMark = (
  context: ElementPageContext,
  walked: NeighbourhoodWalk,
  edge: Edge,
): { repeated: boolean; mark: string } => {
  const marks = edgeMarks(walked, edge, context.neighbourhood.versionOf);
  return {
    repeated: marks.repeated,
    mark: outdatedMark(marks.outdated ? [outdatedNote(context, edge, marks.target)] : []),
  };
};

/**
 * One row (see the file comment); `marks` stand after the title. The cells are the row's three `span`s, styled by
 * place, so that a page of many rows stays small.
 */
const row = (context: ElementPageContext, element: ElementRecord, level: number, marks: string): string => {
  const title = element.data[context.neighbourhood.titleKey];
  const status = element.data["status"];
  const cells = `<span>${escapeHtml(shownId(context, element))}</span><span>${escapeHtml(typeof title === "string" ? title : "")}${marks}</span><span>${escapeHtml(typeof status === "string" ? status : "–")}</span>`;
  const invalid = typeof status === "string" && context.neighbourhood.invalid.has(status);
  const href = invalid ? undefined : context.links.href(element.id);
  return item(
    level,
    href === undefined ? `<span>${cells}</span>` : `<a href="${escapeHtml(href)}">${cells}</a>`,
  );
};

/** A list item of `content`, indented by `level`. */
const item = (level: number, content: string): string =>
  `<li${level === 0 ? "" : ` style="--rq-level:${String(level)}"`}>${content}</li>`;

/** A parent in a repository that is not on this machine, and the depth it stands at (see the file comment). */
interface InaccessibleParent {
  readonly id: string;
  readonly repository: string;
  readonly depth: number;
}

/**
 * The inaccessible targets of the derivations of `nodes` (the element and its shown parents, in walk order), each once
 * at one depth past the first node that points at it (see the file comment).
 */
const inaccessibleParents = (
  context: ElementPageContext,
  nodes: readonly { readonly element: ElementRecord; readonly depth: number }[],
): InaccessibleParent[] => {
  const { layout, store, keys } = context.neighbourhood.derivations;
  const found = new Map<string, InaccessibleParent>();
  for (const { element, depth } of nodes) {
    const targets = [...keys].flatMap(([key, relation]) =>
      relationItems(key, relation, element.data[key]).flatMap(([, target]) =>
        hasId(target) ? [target] : [],
      ),
    );
    for (const target of targets) {
      const state = targetState(layout, store, element.repository, target);
      if (state.kind === "inaccessible" && !found.has(`${state.repository}\n${target.id}`)) {
        found.set(`${state.repository}\n${target.id}`, {
          id: target.id,
          repository: state.repository,
          depth: depth + 1,
        });
      }
    }
  }
  return [...found.values()];
};

/** The row of an inaccessible parent: as an outgoing relation names it, without a link and without a status. */
const inaccessibleRow = (context: ElementPageContext, parent: InaccessibleParent, level: number): string =>
  item(
    level,
    `<span><span>${escapeHtml(`${UNKNOWN_TYPE_PREFIX}-${context.shortIds.tail(parent.id)}`)}</span><span>${escapeHtml(`repository ${parent.repository}, not accessible`)}</span><span></span></span>`,
  );

/** The line on the repositories not on this machine, where `what` may be missing (see the file comment); none without. */
const missingLine = (context: ElementPageContext, what: string): string => {
  const missing = context.layout.repositories.filter((r) => !r.available).map((r) => r.name);
  if (missing.length === 0) {
    return "";
  }
  return `<p class="rq-nb-none">${escapeHtml(`Repositories not on this machine: ${missing.join(", ")}. ${what} from their elements are not accessible and may be missing here.`)}</p>`;
};

/** Rows of one part, and whether the bound left some out. */
interface Part {
  readonly rows: readonly string[];
  readonly more: boolean;
}

/** A group with its rows, or the line `none` without one (nothing when `none` is empty). */
const group = (heading: string, { rows, more }: Part, none: string): string =>
  `<h3>${escapeHtml(heading)}</h3>` +
  (rows.length > 0
    ? `<ul class="rq-nb">${rows.join("")}</ul>`
    : none === ""
      ? ""
      : `<p class="rq-nb-none">${none}</p>`) +
  (more ? `<p class="rq-nb-none">Only the nearest ${String(NEIGHBOURHOOD_LIMIT)} are shown.</p>` : "");

/** The elements of `walked` a page shows (the nearest, see the file comment), and whether the walk reached more. */
const shownOf = (walked: NeighbourhoodWalk) => {
  // The walk stops one element past the bound: `more` holds only when it reached that one.
  const nodes = walked.result.nodes.slice(1, NEIGHBOURHOOD_LIMIT + 1);
  return { nodes, more: walked.result.nodes.length > NEIGHBOURHOOD_LIMIT + 1 };
};

/** The parents, the topmost level first (see the file comment). */
const parentRows = (context: ElementPageContext, up: NeighbourhoodWalk): Part => {
  const { nodes, more } = shownOf(up);
  const notes = new Map<ElementRecord, string[]>();
  for (const edge of up.result.edges) {
    const marks = edgeMarks(up, edge, context.neighbourhood.versionOf);
    if (marks.outdated) {
      const list = notes.get(marks.target) ?? [];
      list.push(outdatedNote(context, edge, marks.target));
      notes.set(marks.target, list);
    }
  }
  const placed = [
    ...nodes.map((node) => ({
      depth: node.depth,
      html: (level: number) => row(context, node.element, level, outdatedMark(notes.get(node.element) ?? [])),
    })),
    ...inaccessibleParents(context, up.result.nodes.slice(0, NEIGHBOURHOOD_LIMIT + 1)).map((parent) => ({
      depth: parent.depth,
      html: (level: number) => inaccessibleRow(context, parent, level),
    })),
  ];
  const top = Math.max(0, ...placed.map((entry) => entry.depth));
  // A stable sort: within a level, the order of the walk, then the inaccessible parents.
  const rows = placed.sort((a, b) => b.depth - a.depth).map((entry) => entry.html(top - entry.depth));
  return { rows, more };
};

/** The children of `root` as a tree of the shown elements, depth first in walk order (see the file comment). */
const childRows = (context: ElementPageContext, root: ElementRecord, down: NeighbourhoodWalk): Part => {
  const { nodes, more } = shownOf(down);
  const shown = new Set(nodes.map((node) => node.element));
  const below = new Map<ElementRecord, Edge[]>();
  for (const edge of down.result.edges) {
    if (shown.has(edge.to)) {
      const list = below.get(edge.from) ?? [];
      list.push(edge);
      below.set(edge.from, list);
    }
  }
  const rows: string[] = [];
  // A stack instead of recursion: a chain can be thousands of levels deep. Only an edge the walk took leads further,
  // and each element is reached by one such edge, so every element is expanded once.
  const stack: { readonly edge: Edge; readonly level: number }[] = [];
  const push = (element: ElementRecord, level: number): void => {
    for (const edge of [...(below.get(element) ?? [])].reverse()) {
      stack.push({ edge, level });
    }
  };
  push(root, 0);
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { edge, level } = next;
    const { repeated, mark } = edgeMark(context, down, edge);
    rows.push(
      row(context, edge.to, level, (repeated ? ' <span class="rq-repeated">repeated</span>' : "") + mark),
    );
    if (!repeated) {
      push(edge.to, level + 1);
    }
  }
  return { rows, more };
};

/** The group key of an incoming link. */
const groupKey = (edge: Edge): string => (edge.link.kind === "relation" ? edge.link.key : REFERENCES);

/** The incoming links by key, in the order they first appear (see the file comment). */
const incomingGroups = (context: ElementPageContext, incoming: NeighbourhoodWalk): string[] => {
  const { edges } = incoming.result;
  // One group per name of the source: the walk follows exactly those keys, so every edge finds its group.
  const groups = [...context.neighbourhood.groupNames].map(([key, name]) => ({
    key,
    name,
    rows: [] as string[],
  }));
  const byKey = new Map(groups.map((found) => [found.key, found.rows]));
  for (const edge of edges) {
    byKey.get(groupKey(edge))?.push(row(context, edge.to, 0, edgeMark(context, incoming, edge).mark));
  }
  const first = (key: string): number => edges.findIndex((edge) => groupKey(edge) === key);
  return groups
    .filter((found) => found.rows.length > 0)
    .sort((a, b) => first(a.key) - first(b.key))
    .map((found) => group(`← ${found.name}`, { rows: found.rows, more: false }, ""));
};

/** The section of the neighbourhood (see the file comment). */
export const neighbourhoodSection = (context: ElementPageContext, page: ElementPage): string => {
  const { derivations, incoming } = context.neighbourhood;
  // `both` gives the up walk, then the down walk; `down` the down walk alone.
  const [up, down] = traceNeighbourhood(derivations, page.record, {
    direction: "both",
    maxNodes: NEIGHBOURHOOD_LIMIT + 1,
  }).walks as [NeighbourhoodWalk, NeighbourhoodWalk];
  const [links] = traceNeighbourhood(incoming, page.record, { direction: "down", maxDepth: 1 }).walks as [
    NeighbourhoodWalk,
  ];
  const children = missingLine(context, "Children");
  return [
    '<section class="rq-neighbourhood"><h2 id="neighbourhood">Neighbourhood</h2>',
    group("Parents", parentRows(context, up), "No parents"),
    group("Children", childRows(context, page.record, down), children === "" ? "No children" : ""),
    children,
    ...incomingGroups(context, links),
    missingLine(context, "Incoming relations and references"),
    "</section>",
  ].join("");
};

/** The styles of the section: one grid per row (its link or its span), the title indented by its level. */
export const NEIGHBOURHOOD_CSS = [
  ".sl-markdown-content ul.rq-nb { list-style: none; padding: 0; margin-top: 0.25rem; }",
  ".sl-markdown-content ul.rq-nb li { margin: 0; }",
  ".rq-nb li > * { display: grid; grid-template-columns: 11rem minmax(0, 1fr) auto; gap: 0 1rem; align-items: baseline; padding: 0.15rem 0.5rem; border-radius: 0.25rem; text-decoration: none; color: var(--sl-color-white); }",
  ".rq-nb li > a:hover { background: var(--sl-color-gray-6); }",
  ".rq-nb li > * > span:first-child, .rq-nb li > * > span:last-child, .rq-repeated, .rq-nb-none { color: var(--sl-color-gray-3); font-size: var(--sl-text-xs); }",
  ".rq-nb li > * > span:first-child, .rq-nb li > * > span:last-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  ".rq-nb li > * > span:nth-child(2) { padding-left: calc(var(--rq-level, 0) * 1.25rem); }",
  ".rq-outdated { color: var(--sl-color-orange-high); font-size: var(--sl-text-xs); }",
  "@media (max-width: 50em) { .rq-nb li > * { grid-template-columns: minmax(0, 1fr) auto; } .rq-nb li > * > span:first-child { grid-column: 1 / -1; } }",
];
