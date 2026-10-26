// Statuses outside the element's type (#306, decision of 2026-10-26 on option 1). A type may restrict
// the metamodel's statuses (`statuses`, inherited like properties); the effective type lists the
// statuses its elements may have, empty for a type without status (a glossary term). Two hints,
// severity `warning` like an unknown property, a value of the wrong kind or a required property
// without a value (D-012: the element is shown and kept, nothing is blocked, no status changes):
// - `element.status-not-allowed`: the element has a status its type does not have: one the
//   metamodel does not know, one of other types only, or any status on a type without status. On
//   the line of the value.
// - `element.missing-status`: the type has statuses and the element has none (absent, `null`, blank;
//   `isEmptyValue`). On the line of the key when the file has it.
// Only `element.setStatus` and `element.supersede` change a status (D-030), so no file is written.
// An element of an unknown type gets neither: it has `element.unknown-type` (SR-016). Nothing while
// the metamodel is not valid (#208, #220 option 1), as for the other findings against it.
import type { Problem } from "../catalog.js";
import type { EffectiveType, Metamodel } from "../metamodel/index.js";
import { findType, listNamed, metamodelState, typeStatuses } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { isEmptyValue } from "./required.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

/** A status hint (path `["status"]`), before its line is known (`locateFindings` adds it). */
export type StatusFinding = LocatableFinding & { readonly path: readonly ["status"] };

const UNCHANGED = "LogReq changes no file";

/** `Decision (decision)`. */
const typeLabel = (type: EffectiveType): string => `${type.name} (${type.key})`;

/** A status value as a message shows it: a text as it is, anything else as JSON. */
const shown = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** Why `value`, a non-empty status, is not one of the type's statuses; undefined when it is. */
const notAllowedMessage = (metamodel: Metamodel, type: EffectiveType, value: unknown): string | undefined => {
  if (typeof value === "string" && type.statuses.includes(value)) {
    return undefined;
  }
  if (type.statuses.length === 0) {
    return `Type ${typeLabel(type)} has no status, but the element has status ${shown(value)}; ${UNCHANGED}`;
  }
  const list = listNamed(typeStatuses(metamodel, type));
  const known = metamodel.statuses.find((s) => s.key === value);
  return known === undefined
    ? `Status ${shown(value)} is not in the metamodel; the statuses of type ${typeLabel(type)} are ${list}; ${UNCHANGED}`
    : `Status ${known.name} (${known.key}) is not a status of type ${typeLabel(type)}, whose statuses are ${list}; ${UNCHANGED}`;
};

const collect = (element: ElementRecord, metamodel: Metamodel, out: StatusFinding[]): void => {
  const type = findType(metamodel, element.type);
  if (type === undefined) {
    return;
  }
  const value = element.data["status"];
  const at = { repository: element.repository, file: element.file, elementId: element.id } as const;
  if (isEmptyValue(value)) {
    if (type.statuses.length > 0) {
      out.push({
        element,
        path: ["status"],
        at: "key",
        problem: {
          code: "element.missing-status",
          severity: "warning",
          message: `Type ${typeLabel(type)} has statuses, but the element has none; they are ${listNamed(typeStatuses(metamodel, type))}; ${UNCHANGED}`,
          ...at,
        },
      });
    }
    return;
  }
  const message = notAllowedMessage(metamodel, type, value);
  if (message !== undefined) {
    out.push({
      element,
      path: ["status"],
      problem: { code: "element.status-not-allowed", severity: "warning", message, ...at },
    });
  }
};

/** The status hint of one element, if any. For a command about one element: `elementView`. */
export const statusFindings = (element: ElementRecord, metamodel: Metamodel): readonly StatusFinding[] => {
  const out: StatusFinding[] = [];
  collect(element, metamodel, out);
  return out;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allStatusFindings = (store: ElementStore, metamodel: Metamodel): readonly StatusFinding[] => {
  const out: StatusFinding[] = [];
  for (const element of store.elements) {
    collect(element, metamodel, out);
  }
  return out;
};

/**
 * Every status hint of the workspace, as a problem with repository, file, line when there is one,
 * and element ID, for `workspace.check` (SR-019) and `hint.list`. Kept until the element store or
 * the metamodel is reset, so a changed metamodel gives its hints on the next read without any file
 * written.
 */
export const statusProblemsState = defineWorkspaceState(
  "status-not-allowed",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, allStatusFindings(store, metamodel));
  },
  {
    dependsOn: [elementStoreState, metamodelState],
    // A save or a watcher batch finds and locates the changed files only (#184).
    carry: carryStoreUpdate((value, update, workspace) => {
      const metamodel = workspace.get(metamodelState);
      return carryProblems(workspace, value, update, {
        findingsOf: metamodel.then((m) => (element) => statusFindings(element, m)),
        // Nothing against a metamodel that is not valid, as a full build (#208, #220).
        skip: metamodel.then((m) => !m.valid),
      });
    }),
  },
);
