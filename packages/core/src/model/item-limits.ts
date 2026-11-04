// The most entries of a list property (SR-171, D-012): a property with `many: true` that holds no
// relations may set `max-items` in the metamodel (`maxItemsOf`). An element with more entries is a
// hint (`warning`: it blocks nothing and changes no status) with element, property, count and
// limit, on the line of the key; the file is kept unchanged. The entries are counted as written,
// so a duplicate counts twice; a value that is no list is SR-085's. Only a property the element's
// type has counts (another one is SR-016's), and, as for the relation limits (SR-152, spec question
// #808), an element of an unknown type or with a status the metamodel marks invalid gets none. The
// hint depends on the element's own data only, so no file is read to find it.
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, maxItemsOf, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

const entries = (count: number): string => `${String(count)} ${count === 1 ? "entry" : "entries"}`;

/** The hints of one element, in the order of its type's properties. */
export const itemLimitFindings = (
  element: ElementRecord,
  metamodel: Metamodel,
): readonly LocatableFinding[] => {
  const limits = maxItemsOf(metamodel);
  const type = limits.size === 0 ? undefined : findType(metamodel, element.type);
  if (
    type === undefined ||
    metamodel.statuses.some((s) => s.key === element.data["status"] && s.invalid === true)
  ) {
    return [];
  }
  const found: LocatableFinding[] = [];
  for (const key of type.properties) {
    const limit = limits.get(key);
    const value = element.data[key];
    if (limit === undefined || !Array.isArray(value) || value.length <= limit.max) {
      continue;
    }
    found.push({
      element,
      path: [key],
      at: "key",
      problem: {
        code: "element.too-many-items",
        severity: "warning",
        message: `This ${type.name} has ${entries(value.length)} in ${limit.label}; at most ${String(limit.max)}`,
        repository: element.repository,
        file: element.file,
        elementId: element.id,
        key,
        count: value.length,
        limit: limit.max,
      },
    });
  }
  return found;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allItemLimitFindings = (
  store: ElementStore,
  metamodel: Metamodel,
): readonly LocatableFinding[] => {
  const out: LocatableFinding[] = [];
  for (const element of store.elements) {
    for (const finding of itemLimitFindings(element, metamodel)) {
      out.push(finding);
    }
  }
  return out;
};

/**
 * Every element with more entries than a `max-items` allows, with repository, file and line of the
 * key (SR-171 AK1), for `workspace.check` (SR-019) and `hint.list`. Kept until the element store or
 * the metamodel is reset; carried over a save or a watcher batch for the changed files (#184).
 * Nothing without a `max-items` or against a metamodel that is not valid (#208).
 */
export const itemLimitProblemsState = defineWorkspaceState(
  "item-limits",
  async (workspace): Promise<readonly Problem[]> => {
    const metamodel = await workspace.get(metamodelState);
    if (maxItemsOf(metamodel).size === 0) {
      return [];
    }
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, allItemLimitFindings(store, metamodel));
  },
  {
    dependsOn: [elementStoreState, metamodelState],
    carry: carryStoreUpdate((value, update, workspace) => {
      const metamodel = workspace.get(metamodelState);
      return carryProblems(workspace, value, update, {
        findingsOf: metamodel.then((m) => (element) => itemLimitFindings(element, m)),
        skip: metamodel.then((m) => maxItemsOf(m).size === 0),
      });
    }),
  },
);
