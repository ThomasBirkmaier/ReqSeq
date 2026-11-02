// A requirement whose wording lives only in its statement (#667). The property with the meaning
// `statement` holds the supplier's statement on an imported requirement (D-059, SR-058), not the
// requirement: in the standard model it does not count to the version (D-057). A requirement with
// a blank text and a value there most likely has its requirement in the wrong place, so a change of
// it gives no new version and outdates no evidence or relation. One hint, severity `warning`
// (D-012: the element is shown and kept, nothing is blocked), on the line of the value:
// `element.statement-without-text`. Only for an element of a type with the meaning `requirement`,
// and only while the statement property does not count (`content` not true): a metamodel that makes
// it count has no such gap. The text comes from `ElementRecord.blankText`, so no file is read to
// find them. Nothing while the metamodel is not valid (#208, #220 option 1).
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState, propertyWithMeaning } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { isEmptyValue } from "./required.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

/** The hint of `element`, if it is a requirement with a blank text and a statement that does not count. */
export const statementFindings = (
  element: ElementRecord,
  metamodel: Metamodel,
): readonly LocatableFinding[] => {
  if (element.blankText !== true) {
    return [];
  }
  const property = propertyWithMeaning(metamodel, "statement");
  const type = findType(metamodel, element.type);
  if (
    property === undefined ||
    property.content === true ||
    type?.meaning !== "requirement" ||
    isEmptyValue(element.data[property.key])
  ) {
    return [];
  }
  const label = `${property.name} (${property.key})`;
  return [
    {
      element,
      path: [property.key],
      problem: {
        code: "element.statement-without-text",
        severity: "warning",
        message: `This ${type.name} has no text, but a value in ${label}, which does not count to the version: a change there gives no new version and outdates no evidence or relation; put the requirement into the text`,
        repository: element.repository,
        file: element.file,
        elementId: element.id,
      },
    },
  ];
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allStatementFindings = (
  store: ElementStore,
  metamodel: Metamodel,
): readonly LocatableFinding[] => {
  const out: LocatableFinding[] = [];
  for (const element of store.elements) {
    for (const finding of statementFindings(element, metamodel)) {
      out.push(finding);
    }
  }
  return out;
};

/**
 * Every requirement with a statement but no text, as a problem with repository, file, line of the
 * statement and element ID, for `workspace.check` and `hint.list`. Kept until the element store or
 * the metamodel is reset; carried over a save or a watcher batch for the changed files (#184).
 */
export const statementProblemsState = defineWorkspaceState(
  "statement-without-text",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, allStatementFindings(store, metamodel));
  },
  {
    dependsOn: [elementStoreState, metamodelState],
    carry: carryStoreUpdate((value, update, workspace) => {
      const metamodel = workspace.get(metamodelState);
      return carryProblems(workspace, value, update, {
        findingsOf: metamodel.then((m) => (element) => statementFindings(element, m)),
        skip: metamodel.then((m) => !m.valid),
      });
    }),
  },
);
