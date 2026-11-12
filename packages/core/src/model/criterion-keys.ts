// The criterion keys of the acceptance criteria (SR-204 AK10, D-072): when the workspace is
// checked, a requirement with an acceptance criterion without criterion key gets a warning, once
// per element with the count, on the line of the key (`element.criterion-key-missing`); two
// acceptance criteria with the same criterion key give an error on the later one
// (`element.criterion-key-duplicate`). A key written by hand in another form than SR-204 AK5 names
// is `element.criterion-key-invalid`, at the severity of `element.wrong-value-kind` (D-012: a value
// in a file is kept and shown as a hint; spec question carried in the PR of #1416). An item that is
// no text is SR-085's and counts for none of them. Only an element whose type has the property
// counts (another one is SR-016's), and, as for the item limits (SR-171), an element of an unknown
// type or with a status the metamodel marks invalid gets none. The findings depend on the element's
// own data only, so no file is read to find them.
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { acceptanceCriteriaKeyOf } from "./acceptance-criteria.js";
import { carryProblems } from "./carry.js";
import { isCriterionKey, isKeyedCriterion } from "./criterion-items.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

const criteria = (count: number): string =>
  `${String(count)} acceptance ${count === 1 ? "criterion" : "criteria"}`;

/** The findings of one element: the missing keys, then each invalid or double key in item order. */
export const criterionKeyFindings = (
  element: ElementRecord,
  metamodel: Metamodel,
): readonly LocatableFinding[] => {
  const key = acceptanceCriteriaKeyOf(metamodel);
  const value = key === undefined ? undefined : element.data[key];
  if (key === undefined || !Array.isArray(value) || value.length === 0) {
    return [];
  }
  const type = findType(metamodel, element.type);
  if (
    type?.properties.includes(key) !== true ||
    metamodel.statuses.some((s) => s.key === element.data["status"] && s.invalid === true)
  ) {
    return [];
  }
  const base = {
    repository: element.repository,
    file: element.file,
    elementId: element.id,
    key,
  };
  const items = value as unknown[];
  const missing = items.filter((item) => typeof item === "string").length;
  const found: LocatableFinding[] = [];
  if (missing > 0) {
    found.push({
      element,
      path: [key],
      at: "key",
      problem: {
        code: "element.criterion-key-missing",
        severity: "warning",
        message: `This ${type.name} has ${criteria(missing)} without criterion key`,
        ...base,
        count: missing,
      },
    });
  }
  const seen = new Map<string, number>();
  items.forEach((item, index) => {
    if (!isKeyedCriterion(item)) {
      return;
    }
    const position = String(index + 1);
    if (!isCriterionKey(item.key)) {
      found.push({
        element,
        path: [key, index, "key"],
        problem: {
          code: "element.criterion-key-invalid",
          severity: "warning",
          message: `Acceptance criterion ${position} has the criterion key ${JSON.stringify(item.key)}; a criterion key is a lower-case letter a to z, then 3 to 15 lower-case letters a to z or digits`,
          ...base,
          // Number and text only: the key is not one (SR-205 AK2).
          criteria: [{ criterion: index + 1, text: item.text }],
        },
      });
      return;
    }
    const first = seen.get(item.key);
    if (first === undefined) {
      seen.set(item.key, index);
      return;
    }
    found.push({
      element,
      path: [key, index, "key"],
      problem: {
        code: "element.criterion-key-duplicate",
        severity: "error",
        message: `Acceptance criteria ${String(first + 1)} and ${position} have the same criterion key ${item.key}; each needs its own`,
        ...base,
        // Both, with number, key and text (SR-205 AK2).
        criteria: [first, index].map((at) => ({
          criterion: at + 1,
          key: item.key,
          text: (items[at] as { readonly text: string }).text,
        })),
      },
    });
  });
  return found;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allCriterionKeyFindings = (
  store: ElementStore,
  metamodel: Metamodel,
): readonly LocatableFinding[] => {
  const out: LocatableFinding[] = [];
  for (const element of store.elements) {
    for (const finding of criterionKeyFindings(element, metamodel)) {
      out.push(finding);
    }
  }
  return out;
};

/**
 * Every finding about criterion keys, with repository, file and line (SR-204 AK10), for
 * `workspace.check` (SR-019) and `hint.list`. Kept until the element store or the metamodel is
 * reset; carried over a save or a watcher batch for the changed files (ThomasBirkmaier/ReqSeq-archive#184).
 * Nothing without a property with the meaning `acceptance-criteria` or against a metamodel that is
 * not valid (ThomasBirkmaier/ReqSeq-archive#208).
 */
export const criterionKeyProblemsState = defineWorkspaceState(
  "criterion-keys",
  async (workspace): Promise<readonly Problem[]> => {
    const metamodel = await workspace.get(metamodelState);
    if (!metamodel.valid || acceptanceCriteriaKeyOf(metamodel) === undefined) {
      return [];
    }
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, allCriterionKeyFindings(store, metamodel));
  },
  {
    dependsOn: [elementStoreState, metamodelState],
    carry: carryStoreUpdate((value, update, workspace) => {
      const metamodel = workspace.get(metamodelState);
      return carryProblems(workspace, value, update, {
        findingsOf: metamodel.then((m) => (element) => criterionKeyFindings(element, m)),
        skip: metamodel.then((m) => !m.valid || acceptanceCriteriaKeyOf(m) === undefined),
      });
    }),
  },
);
