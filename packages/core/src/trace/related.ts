// Related elements of a selection (SR-023, N-008): "Das Tool muss zu einer Auswahl von Parents alle
// davon abgeleiteten Requirements auflisten und umgekehrt." One breadth-first walk of the derivation
// graph (#258) from all elements of the selection at once: down along `childrenOf` for the children
// (AK1), up along `parentsOf` for the parents (AK3).
//
// - Listed is every element reached through a step, each once (AK2), however many elements of the
//   selection or ways lead to it: every element reached besides the selection, and an element of the
//   selection that another one leads to. An element of the selection that lies in a cycle is reached
//   from itself and listed too: it derives from itself indirectly; the check reports the cycle
//   (SR-090).
// - `maxDepth` n lists the elements at most n steps from the selection (AK1 "wahlweise nur bis zu
//   einer angegebenen Tiefe"); 0 lists none. Only elements above `maxDepth` are expanded, so a step
//   into an element of the selection is within the depth too.
// - Order: by the distance from the selection, then in the order the walk reaches them (breadth
//   first, the selection in the given order); an element of the selection comes at the distance of
//   its first step in, before the others of that distance.
// - `includes` (a view, `appliesIn`, SR-040): a step to an element outside it is not taken, so what
//   lies only below or above such an element is not listed either, as in the chain (SR-022). The
//   selection itself is walked from as given.
// - `incomplete` as in `walk` (SR-006 AK2): up when a parent lies in a repository that is not on
//   this machine, down whenever the workspace file lists such a repository (spec question #262).
//   Targets that are missing (SR-089) or ambiguous (SR-088) are findings of the check, not listed.
// - Its own walk, not `walk`: a list needs no edges, `via`, nodes or cycles, and building them for
//   the 42,000 children of a need at N-036 takes most of the 500 ms of a result (SR-082 AK4). The
//   steps are those of `childrenOf` and `parentsOf`, as in the chain. Linear in the elements and
//   steps it reaches.
import type { ElementRecord } from "../model/index.js";
import type { DerivationGraph } from "./graph.js";
import { childrenOf, parentsOf } from "./graph.js";

export interface RelatedOptions {
  /** `children`: the elements derived from the selection (AK1); `parents`: those it derives from (AK3). */
  readonly direction: "children" | "parents";
  /** The deepest distance from the selection to list (a whole number); undefined lists all. */
  readonly maxDepth?: number;
  /** The elements of the view; a step to any other element is not taken. Default: every element. */
  readonly includes?: (element: ElementRecord) => boolean;
}

export interface RelatedElements {
  /** Each related element once, by distance from the selection, then in walk order. */
  readonly elements: readonly ElementRecord[];
  /** Some part of the graph the walk needed cannot be read here (SR-006 AK2). */
  readonly incomplete: boolean;
}

/** An element of the selection that a step leads to, with the distance of its first step in. */
interface SteppedInto {
  readonly element: ElementRecord;
  readonly distance: number;
}

/** What the walk reached. */
interface Reached {
  /** Each reached element at its shortest distance from the selection (0 for it), breadth first. */
  readonly depthOf: ReadonlyMap<ElementRecord, number>;
  /** The elements of the selection a step leads to, by the distance of their first step in. */
  readonly steppedInto: readonly SteppedInto[];
  readonly incomplete: boolean;
}

/** The breadth-first walk from `starts` (see the file comment). */
const reach = (
  graph: DerivationGraph,
  starts: ReadonlySet<ElementRecord>,
  options: RelatedOptions,
): Reached => {
  const { direction, maxDepth, includes } = options;
  const next = direction === "children" ? childrenOf : parentsOf;
  const depthOf = new Map<ElementRecord, number>([...starts].map((element) => [element, 0]));
  const steppedInto: SteppedInto[] = [];
  const entered = new Set<ElementRecord>();
  let incomplete = false;
  // A Map iterates the entries added while it is read: breadth first, level by level, so the first
  // step into an element of the selection comes from the nearest element.
  for (const [element, depth] of depthOf) {
    if (maxDepth !== undefined && depth >= maxDepth) {
      continue;
    }
    const expansion = next(graph, element);
    incomplete ||= expansion.incomplete;
    for (const { to } of expansion.steps) {
      if (includes !== undefined && !includes(to)) {
        continue;
      }
      if (!depthOf.has(to)) {
        depthOf.set(to, depth + 1);
      } else if (starts.has(to) && !entered.has(to)) {
        entered.add(to);
        steppedInto.push({ element: to, distance: depth + 1 });
      }
    }
  }
  return { depthOf, steppedInto, incomplete };
};

/** The elements related to `selection` in `graph` (see the file comment). */
export const relatedElements = (
  graph: DerivationGraph,
  selection: readonly ElementRecord[],
  options: RelatedOptions,
): RelatedElements => {
  const starts = new Set(selection);
  const { depthOf, steppedInto, incomplete } = reach(graph, starts, options);
  // The elements reached besides the selection come by distance already; those of the selection
  // merge in before the others of their distance.
  const elements: ElementRecord[] = [];
  let entering = 0;
  for (const [element, depth] of depthOf) {
    if (starts.has(element)) {
      continue;
    }
    for (let s = steppedInto[entering]; s !== undefined && s.distance <= depth; s = steppedInto[entering]) {
      elements.push(s.element);
      entering += 1;
    }
    elements.push(element);
  }
  for (const s of steppedInto.slice(entering)) {
    elements.push(s.element);
  }
  return { elements, incomplete };
};
