// The neighbourhood on an element's page (SR-232 AK5, AK6), as the app's neighbourhood buffer shows it (SR-107), from
// the walks of `trace.neighbourhood` (`traceNeighbourhood`) with its marks of an edge (`edgeMarks`: repeated, SR-107
// AK3; outdated, SR-107 AK4).
//
// - Parents: the up walk over the derivations, every level, the topmost first; each level one step less indented,
//   the direct parents last, each element once (its shortest depth). A parent that a derivation of the walk points at
//   with an older version is marked outdated.
// - Children: the down walk over the derivations, every level, as a tree in walk order. A child reached again (a child
//   of several parents, a cycle) stands under each parent; every place but the one the walk reached first, the nearest
//   to the element, is marked repeated and has no rows below it. A child whose derivation stores an older version is
//   marked outdated.
// - Incoming: every other relation, relation property and inline reference that points at the element, one group per
//   relation kind or property and one for the inline references, the groups in the order they first appear (as in the
//   app); a group is named as `trace.matrix` names an incoming column: the kind's inverse name, else its name, and a
//   property by its name. Outdated ones are marked.
// - Each row: short ID with the identifier, title and status ("–" without one), as a link to the element's page. An
//   element with an invalid status (D-044) is a row without a link, also where the earlier export left a short page
//   (SR-231 AK8), and the walks go on through it (AK6); an element without a page (several files share its UUID)
//   is a row without a link as well.
// - Without parents or children the section says so; without incoming links it has no such group.
// - Cost: per page the walks of its chain over the derivations and one step over every link; the current versions
//   are read once for the export (`NeighbourhoodSource.versionOf`).
import type { Metamodel } from "../metamodel/index.js";
import { keyDefinition } from "../metamodel/index.js";
import type { ElementRecord, IncomingLink } from "../model/index.js";
import { invalidStatuses, titleKeyOrEmpty } from "../model/index.js";
import type { NeighbourhoodContext, NeighbourhoodWalk, TraceContext, VersionLookup } from "../trace/index.js";
import { edgeMarks, neighbourhoodContext, traceNeighbourhood } from "../trace/index.js";
import type { WalkEdge } from "../trace/walk.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { escapeHtml } from "./markdown.js";

type Edge = WalkEdge<IncomingLink>;

/** What the section reads besides the page (see the file comment). */
export interface NeighbourhoodSource {
  /** The walks over the derivations only. */
  readonly derivations: NeighbourhoodContext;
  /** The walks over every relation, relation property and inline reference. */
  readonly every: NeighbourhoodContext;
  readonly versionOf: VersionLookup;
  /** The keys of the statuses marked invalid. */
  readonly invalid: ReadonlySet<string>;
}

/** The source of the section for a workspace's trace context and the current versions of its elements. */
export const neighbourhoodSource = (trace: TraceContext, versionOf: VersionLookup): NeighbourhoodSource => ({
  derivations: neighbourhoodContext(trace, { meanings: ["derivation"] }),
  every: neighbourhoodContext(trace, {}),
  versionOf,
  invalid: new Set(invalidStatuses(trace.metamodel).keys()),
});

/** The ID a row shows: the short ID, with the identifier when the element has one. */
const shownId = (context: ElementPageContext, element: ElementRecord): string => {
  const identifier = context.shortIds.identifierOf(element);
  const shortId = context.shortIds.of(element);
  return identifier === undefined ? shortId : `${shortId} (${identifier})`;
};

/** The name of a link's kind: a relation kind's key, or "inline reference". */
const linkName = (link: IncomingLink): string => (link.kind === "relation" ? link.key : "inline reference");

/** The marks of `edge` in `walked`, with the hover text of its outdated mark: which end points to an older version. */
const marksOf = (context: ElementPageContext, walked: NeighbourhoodWalk, edge: Edge) => {
  const marks = edgeMarks(walked, edge, context.neighbourhood.versionOf);
  const note = `${shownId(context, edge.link.source)} points to an older version of ${shownId(context, marks.target)} (${linkName(edge.link)})`;
  return { ...marks, note };
};

const outdatedMark = (notes: readonly string[]): string =>
  notes.length === 0
    ? ""
    : ` <span class="rq-outdated" title="${escapeHtml(notes.join("; "))}">link outdated</span>`;

/** One row (see the file comment); `marks` stand after the title. */
const row = (context: ElementPageContext, element: ElementRecord, level: number, marks: string): string => {
  const title = element.data[titleKeyOrEmpty(context.metamodel)];
  const status = element.data["status"];
  const cells = [
    `<span class="rq-nb-id">${escapeHtml(shownId(context, element))}</span>`,
    `<span class="rq-nb-title">${escapeHtml(typeof title === "string" ? title : "")}${marks}</span>`,
    `<span class="rq-nb-status">${escapeHtml(typeof status === "string" ? status : "–")}</span>`,
  ].join("");
  const invalid = typeof status === "string" && context.neighbourhood.invalid.has(status);
  const href = invalid ? undefined : context.links.href(element.id);
  const content =
    href === undefined
      ? `<span class="rq-nb-row">${cells}</span>`
      : `<a class="rq-nb-row" href="${escapeHtml(href)}">${cells}</a>`;
  return `<li style="--rq-level:${String(level)}">${content}</li>`;
};

const group = (heading: string, rows: readonly string[], none: string): string =>
  `<h3>${escapeHtml(heading)}</h3>` +
  (rows.length === 0 ? `<p class="rq-nb-none">${none}</p>` : `<ul class="rq-nb">${rows.join("")}</ul>`);

/** The parents, the topmost level first (see the file comment). */
const parentRows = (context: ElementPageContext, up: NeighbourhoodWalk): string[] => {
  const notes = new Map<ElementRecord, string[]>();
  for (const edge of up.result.edges) {
    const marks = marksOf(context, up, edge);
    if (marks.outdated) {
      notes.set(marks.target, [...(notes.get(marks.target) ?? []), marks.note]);
    }
  }
  const parents = up.result.nodes.slice(1);
  const top = Math.max(0, ...parents.map((node) => node.depth));
  // A stable sort: within a level, the order of the walk.
  return [...parents]
    .sort((a, b) => b.depth - a.depth)
    .map((node) => row(context, node.element, top - node.depth, outdatedMark(notes.get(node.element) ?? [])));
};

/** The children of `root` as a tree, depth first in walk order (see the file comment). */
const childRows = (context: ElementPageContext, root: ElementRecord, down: NeighbourhoodWalk): string[] => {
  const below = new Map<ElementRecord, Edge[]>();
  for (const edge of down.result.edges) {
    below.set(edge.from, [...(below.get(edge.from) ?? []), edge]);
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
    const marks = marksOf(context, down, edge);
    const repeated = marks.repeated ? ' <span class="rq-repeated">repeated</span>' : "";
    rows.push(row(context, edge.to, level, repeated + outdatedMark(marks.outdated ? [marks.note] : [])));
    if (!marks.repeated) {
      push(edge.to, level + 1);
    }
  }
  return rows;
};

/** The name of the group of an incoming `link`, or undefined for a derivation (see the file comment). */
const groupName = (metamodel: Metamodel, link: IncomingLink): string | undefined => {
  if (link.kind === "reference") {
    return "inline reference";
  }
  // A followed key is a relation kind or a property of kind relation (`relationKeysOf`).
  const found = keyDefinition(metamodel, link.key);
  if (found?.kind !== "relation") {
    return String(found?.definition.name);
  }
  const kind = found.definition;
  return kind.meaning === "derivation" ? undefined : (kind["inverse-name"] ?? kind.name);
};

/** The incoming links by kind, derivations left out (they are the children). */
const incomingGroups = (context: ElementPageContext, incoming: NeighbourhoodWalk): string[] => {
  const groups = new Map<string, string[]>();
  for (const edge of incoming.result.edges) {
    const name = groupName(context.metamodel, edge.link);
    if (name !== undefined) {
      const marks = marksOf(context, incoming, edge);
      groups.set(name, [
        ...(groups.get(name) ?? []),
        row(context, edge.to, 0, outdatedMark(marks.outdated ? [marks.note] : [])),
      ]);
    }
  }
  return [...groups].map(([name, rows]) => group(`← ${name}`, rows, ""));
};

/** The section of the neighbourhood (see the file comment). */
export const neighbourhoodSection = (context: ElementPageContext, page: ElementPage): string => {
  const { derivations, every } = context.neighbourhood;
  // `both` gives the up walk, then the down walk; `down` the down walk alone.
  const [up, down] = traceNeighbourhood(derivations, page.record, { direction: "both" }).walks as [
    NeighbourhoodWalk,
    NeighbourhoodWalk,
  ];
  const [incoming] = traceNeighbourhood(every, page.record, { direction: "down", maxDepth: 1 }).walks as [
    NeighbourhoodWalk,
  ];
  return [
    '<section class="rq-neighbourhood"><h2 id="neighbourhood">Neighbourhood</h2>',
    group("Parents", parentRows(context, up), "No parents"),
    group("Children", childRows(context, page.record, down), "No children"),
    ...incomingGroups(context, incoming),
    "</section>",
  ].join("");
};

/** The styles of the section: one grid per row, the title indented by its level. */
export const NEIGHBOURHOOD_CSS = [
  ".sl-markdown-content ul.rq-nb { list-style: none; padding: 0; margin-top: 0.25rem; }",
  ".sl-markdown-content ul.rq-nb li { margin: 0; }",
  ".rq-nb-row { display: grid; grid-template-columns: 11rem minmax(0, 1fr) auto; gap: 0 1rem; align-items: baseline; padding: 0.15rem 0.5rem; border-radius: 0.25rem; text-decoration: none; color: var(--sl-color-white); }",
  "a.rq-nb-row:hover { background: var(--sl-color-gray-6); }",
  ".rq-nb-id, .rq-nb-status, .rq-repeated, .rq-nb-none { color: var(--sl-color-gray-3); font-size: var(--sl-text-xs); }",
  ".rq-nb-id, .rq-nb-status { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
  ".rq-nb-title { padding-left: calc(var(--rq-level, 0) * 1.25rem); }",
  ".rq-outdated { color: var(--sl-color-orange-high); font-size: var(--sl-text-xs); }",
  "@media (max-width: 50em) { .rq-nb-row { grid-template-columns: minmax(0, 1fr) auto; } .rq-nb-id { grid-column: 1 / -1; } }",
];
