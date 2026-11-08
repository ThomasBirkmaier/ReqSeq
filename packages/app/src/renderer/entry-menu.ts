// The context menu of an element where it appears as an entry (SR-197): a row of a list, a search hit, a node
// of the graph, an entry of a package page, the head of a row of the matrix or a connected element in a cell.
// Its entries act on the element of the entry, which the right-click selected first (SR-194 AK5): the actions
// below and the catalog commands, whose element argument offers it first (`catalog-commands.ts`). Display
// only: the buffers they show ask core, as the actions of the shown element do (ADR-0002).
import type { Action, ActionContext } from "./actions.js";
import type { Buffer, ElementBuffer } from "./buffers.js";
import { graphBuffer, neighbourhoodBuffer, showBuffer } from "./buffers.js";
import type { MenuEntry, MenuHit, MenuPlace } from "./context-menu.js";

/**
 * The entries of an element (SR-197 AK1), in this order at every place. The matrix's connected elements
 * take them too (`matrix-target`), with what SR-199 adds after them.
 */
export const ENTRY_MENU: readonly MenuEntry[] = [
  { id: "entry-show" },
  { id: "entry-graph" },
  { id: "entry-neighbourhood" },
  { id: "command:trace.affected" },
  { id: "command:relation.add" },
  { id: "command:element.setStatus" },
];

/** The places that are an element as an entry: their menu acts on the marked element. */
export const ENTRY_PLACES: ReadonlySet<MenuPlace> = new Set<MenuPlace>(["element-entry", "matrix-target"]);

/** The buffers that show an element of their own, which their own actions act on ("Show graph" of the element). */
const OWN_ELEMENT: ReadonlySet<Buffer["kind"]> = new Set<Buffer["kind"]>([
  "element",
  "neighbourhood",
  "graph",
]);

/**
 * The element of the entry in the command prompt (`ActionContext.entry`): where the shown buffer has no
 * element of its own (a list, a search, the overview, the matrix), its marked element (`markedElement`), so
 * the prompt offers the entries of the menu there. Undefined elsewhere: there the commands act on the shown
 * element.
 */
export const promptEntry = (
  shown: Buffer | undefined,
  marked: ElementBuffer | undefined,
): { readonly entry?: ElementBuffer } =>
  shown === undefined || marked === undefined || OWN_ELEMENT.has(shown.kind) ? {} : { entry: marked };

/**
 * The context the commands read while `menu` is open: on an entry, with its element as `entry`, the marked
 * one, which the right-click selected (SR-194 AK5); elsewhere `context` as it is.
 */
export const menuContext = (
  context: ActionContext,
  menu: { readonly hit: Pick<MenuHit, "place"> } | undefined,
): ActionContext =>
  menu === undefined || !ENTRY_PLACES.has(menu.hit.place) || context.marked === undefined
    ? context
    : { ...context, entry: context.marked };

const hasEntry = (context: ActionContext): boolean => context.entry !== undefined;

/** The actions on the element of the entry, under the names of those on the shown element (SR-197 AK1). */
export const ENTRY_ACTIONS: readonly Action[] = [
  {
    // AK2: as Enter opens the selected entry, in the area it is in (a right press makes that area active).
    id: "entry-show",
    title: "Show element",
    available: hasEntry,
    run: (context: ActionContext): void => {
      if (context.entry !== undefined) {
        context.dispatch({ type: "open", buffer: context.entry });
      }
    },
  },
  {
    id: "entry-graph",
    title: "Show graph",
    available: hasEntry,
    run: (context: ActionContext): void => {
      const entry = context.entry;
      if (entry !== undefined) {
        showBuffer(context, graphBuffer(entry.id, entry.repository, entry.name));
      }
    },
  },
  {
    id: "entry-neighbourhood",
    title: "Show neighbourhood",
    available: hasEntry,
    run: (context: ActionContext): void => {
      const entry = context.entry;
      if (entry !== undefined) {
        showBuffer(context, neighbourhoodBuffer(entry.id, entry.repository, entry.name));
      }
    },
  },
];
