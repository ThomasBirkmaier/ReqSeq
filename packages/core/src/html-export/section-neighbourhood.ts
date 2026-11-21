// The neighbourhood on an element's page (SR-232 AK5, AK6), as the app's neighbourhood buffer shows it (SR-107): the
// display model `neighbourhoodDisplay` (ADR-0019) of the answers `trace.neighbourhood` gives for the walks below
// (`traceNeighbourhood` and `neighbourhoodOutput`, unpaged), with its marks of an edge (repeated, SR-107 AK3; outdated,
// SR-107 AK4). The rows, groups, order and words are the model's; this module adds what only the export has (the
// lines and parents of SR-232 AK8) and the HTML.
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
//   groups in the order they first appear. A group is named by `relationGroupLabel`, as `trace.matrix` names an
//   incoming column: a relation kind's inverse name, else its name, and a property by its name; two keys with the
//   same name stay two groups. Outdated ones are marked.
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
// - Cost: per page two bounded walks over the derivations and one step over the other links, and their answers; the
//   current versions are read once for the export (`neighbourhoodSource`).
import type { ElementRef, NeighbourhoodAnswer, NeighbourhoodDisplay } from "../displays/index.js";
import { boundNote, emptyValueLabel, neighbourhoodDisplay, shownId } from "../displays/index.js";
import type { ElementRecord } from "../model/index.js";
import { UNKNOWN_TYPE_PREFIX, hasId, relationItems, relationKeysOf, targetState } from "../model/index.js";
import type {
  NeighbourhoodContext,
  NeighbourhoodOutputContext,
  NeighbourhoodWalk,
  TraceContext,
  VersionLookup,
  VersionsOf,
} from "../trace/index.js";
import { neighbourhoodContext, neighbourhoodOutput, traceNeighbourhood } from "../trace/index.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { escapeHtml } from "./markdown.js";

/** The most parents and the most children a page shows (see the file comment). */
export const NEIGHBOURHOOD_LIMIT = 100;

/** What the section reads besides the page (see the file comment). */
export interface NeighbourhoodSource {
  /** The walks over the derivations only. */
  readonly derivations: NeighbourhoodContext;
  /** The incoming walk: every relation key that is no derivation, and the inline references. */
  readonly incoming: NeighbourhoodContext;
  readonly versionOf: VersionLookup;
}

/** The source of the section for a workspace's trace context and the current versions of its elements. */
export const neighbourhoodSource = (trace: TraceContext, versionOf: VersionLookup): NeighbourhoodSource => {
  const { metamodel } = trace;
  const keys = relationKeysOf(metamodel);
  // A key that is both a property and a relation kind counts once.
  const kinds = new Set([
    ...metamodel.relations.filter((kind) => kind.meaning !== "derivation").map((kind) => kind.key),
    ...metamodel.properties.filter((p) => keys.has(p.key)).map((p) => p.key),
  ]);
  return {
    derivations: neighbourhoodContext(trace, { meanings: ["derivation"] }),
    incoming: neighbourhoodContext(trace, { kinds: [...kinds], meanings: ["reference"] }),
    versionOf,
  };
};

/** What the HTML of the section reads of the page context. */
type HtmlContext = Pick<ElementPageContext, "links" | "layout" | "shortIds">;

const outdatedMark = (note: string | undefined): string =>
  note === undefined ? "" : ` <span class="rq-outdated" title="${escapeHtml(note)}">link outdated</span>`;

/**
 * One row (see the file comment); `marks` stand after the title. The cells are the row's three `span`s, styled by
 * place, so that a page of many rows stays small.
 */
const row = (context: HtmlContext, ref: ElementRef, level: number, marks: string): string => {
  const cells = `<span>${escapeHtml(shownId(ref.shortId, ref.identifier))}</span><span>${escapeHtml(ref.title)}${marks}</span><span>${escapeHtml(emptyValueLabel(ref.status))}</span>`;
  const href = ref.invalid ? undefined : context.links.href(ref.id);
  return item(
    level,
    href === undefined ? `<span>${cells}</span>` : `<a href="${escapeHtml(href)}">${cells}</a>`,
  );
};
/** A list item of `content`, indented by `level`. */
const item = (level: number, content: string): string =>
  `<li${level === 0 ? "" : ` style="--rq-level:${String(level)}"`}>${content}</li>`;

/** A parent in a repository that is not on this machine, and the depth it stands at (see the file comment). */
export interface InaccessibleParent {
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
const inaccessibleRow = (context: HtmlContext, parent: InaccessibleParent, level: number): string =>
  item(
    level,
    `<span><span>${escapeHtml(`${UNKNOWN_TYPE_PREFIX}-${context.shortIds.tail(parent.id)}`)}</span><span>${escapeHtml(`repository ${parent.repository}, not accessible`)}</span><span></span></span>`,
  );

/** The line on the repositories not on this machine, where `what` may be missing (see the file comment); none without. */
const missingLine = (context: HtmlContext, what: string): string => {
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
  (more ? `<p class="rq-nb-none">${escapeHtml(boundNote(NEIGHBOURHOOD_LIMIT))}</p>` : "");

/** The parents, the topmost level first, with the inaccessible ones at their depth (see the file comment). */
const parentRows = (
  context: HtmlContext,
  parents: NeighbourhoodDisplay["parents"],
  inaccessible: readonly InaccessibleParent[],
): Part => {
  const levels = new Map<number, ((level: number) => string)[]>();
  const place = (depth: number, html: (level: number) => string): void => {
    const list = levels.get(depth) ?? [];
    list.push(html);
    levels.set(depth, list);
  };
  for (const parent of parents.rows.flat()) {
    place(parent.depth, (level) => row(context, parent.ref, level, outdatedMark(parent.outdated)));
  }
  for (const parent of inaccessible) {
    place(parent.depth, (level) => inaccessibleRow(context, parent, level));
  }
  const top = Math.max(0, ...levels.keys());
  // Within a level, the order of the walk, then the inaccessible parents.
  const rows = [...levels]
    .sort(([a], [b]) => b - a)
    .flatMap(([depth, html]) => html.map((of) => of(top - depth)));
  return { rows, more: parents.more };
};

/** The children as the model's tree, every row open (see the file comment). */
const childRows = (context: HtmlContext, children: NeighbourhoodDisplay["children"]): Part => ({
  rows: children.rows.map((child) =>
    row(
      context,
      child.ref,
      child.level - 1,
      (child.repeated ? ' <span class="rq-repeated">repeated</span>' : "") + outdatedMark(child.outdated),
    ),
  ),
  more: children.more,
});

/** The answers of the walks of a page, as `trace.neighbourhood` gives them, unpaged (see the file comment). */
export interface NeighbourhoodAnswers {
  /** The up walk, then the down walk, over the derivations, each bounded one element past `NEIGHBOURHOOD_LIMIT`. */
  readonly derived: NeighbourhoodAnswer;
  /** One step down over every other key and the inline references. */
  readonly pointing: NeighbourhoodAnswer;
  /** The up walk itself, for the parents in a repository that is not on this machine. */
  readonly up: NeighbourhoodWalk;
}

/** The answers of the walks from `record` (see the file comment). */
export const neighbourhoodAnswers = async (
  source: Pick<NeighbourhoodSource, "derivations" | "incoming">,
  context: NeighbourhoodOutputContext,
  record: ElementRecord,
  versionsOf: VersionsOf,
): Promise<NeighbourhoodAnswers> => {
  // `both` gives the up walk, then the down walk.
  const walks = traceNeighbourhood(source.derivations, record, {
    direction: "both",
    maxNodes: NEIGHBOURHOOD_LIMIT + 1,
  });
  const links = traceNeighbourhood(source.incoming, record, { direction: "down", maxDepth: 1 });
  const every = { offset: 0, limit: Number.MAX_SAFE_INTEGER };
  const [derived, pointing] = await Promise.all([
    neighbourhoodOutput(walks, context, every, versionsOf),
    neighbourhoodOutput(links, context, every, versionsOf),
  ]);
  const [up] = walks.walks as [NeighbourhoodWalk];
  return { derived, pointing, up };
};

/** The section of the neighbourhood (see the file comment). */
export const neighbourhoodSection = async (
  context: ElementPageContext,
  page: ElementPage,
): Promise<string> => {
  const { versionOf } = context.neighbourhood;
  const { derived, pointing, up } = await neighbourhoodAnswers(
    context.neighbourhood,
    { metamodel: context.metamodel, shortIds: context.shortIds },
    page.record,
    () => Promise.resolve(versionOf),
  );
  const display = neighbourhoodDisplay(
    { parents: derived, children: derived, incoming: pointing, metamodel: context.metamodel },
    {
      bound: {
        parents: NEIGHBOURHOOD_LIMIT,
        children: NEIGHBOURHOOD_LIMIT,
        incoming: Number.POSITIVE_INFINITY,
      },
      open: "all",
    },
  );
  return neighbourhoodHtml(
    context,
    display,
    inaccessibleParents(context, up.result.nodes.slice(0, NEIGHBOURHOOD_LIMIT + 1)),
  );
};

/** The HTML of the section for the display model and the parents in repositories not on this machine. */
export const neighbourhoodHtml = (
  context: HtmlContext,
  display: NeighbourhoodDisplay,
  inaccessible: readonly InaccessibleParent[],
): string => {
  const children = missingLine(context, "Children");
  return [
    '<section class="rq-neighbourhood"><h2 id="neighbourhood">Neighbourhood</h2>',
    group("Parents", parentRows(context, display.parents, inaccessible), "No parents"),
    group("Children", childRows(context, display.children), children === "" ? "No children" : ""),
    children,
    ...display.incoming.rows.map((found) =>
      group(
        found.label,
        {
          rows: found.entries.map((entry) => row(context, entry.ref, 0, outdatedMark(entry.outdated))),
          more: false,
        },
        "",
      ),
    ),
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
