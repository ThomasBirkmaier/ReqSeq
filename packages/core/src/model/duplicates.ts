// Duplicate IDs (SR-088, D-017). When element files share a UUID (a copied file), every one of them
// is reported, each naming the others, and a relation to that UUID is ambiguous. The tool decides
// nothing about which file is the copy and never changes either file; a person gives one a new UUID.
import type { Problem } from "../catalog.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

const where = (element: ElementRecord): string => `${element.file} (${element.repository})`;

const message = (others: readonly ElementRecord[]): string => {
  const subject = others.length === 1 ? "Another element file has" : "Other element files have";
  return `${subject} the same UUID: ${others.map(where).join(", ")}; relations to this UUID are ambiguous, and LogReq changes none of the files`;
};

/** The finding of one element when another file of `store` has its UUID (`duplicateIdFindings`). */
const duplicateIdFinding = (store: ElementStore, element: ElementRecord): LocatableFinding[] => {
  const match = resolveId(store.byId, element.id);
  return match.kind !== "ambiguous"
    ? []
    : [
        {
          element,
          path: ["id"],
          problem: {
            code: "element.duplicate-id",
            severity: "error",
            message: message(match.elements.filter((e) => e !== element)),
            repository: element.repository,
            file: element.file,
            elementId: element.id,
          },
        },
      ];
};

/**
 * One finding per element file whose UUID another file also has, in store order, at the `id` key:
 * `element.duplicate-id`, severity `error` (a shared UUID breaks the identity of D-017, so the check
 * fails, SR-088 AK3), with repository, file, the shared UUID as element ID and the other files in
 * the message. One pass over the store, no file read (N-036).
 */
export const duplicateIdFindings = (store: ElementStore): readonly LocatableFinding[] =>
  store.elements.flatMap((element) => duplicateIdFinding(store, element));

/**
 * The elements a UUID names, for example the target of a relation: one, none (a missing repository
 * or a wrong ID), or several files that share it. A relation to an ambiguous UUID is shown as
 * ambiguous (SR-088 AK2); the elements keep the order of the element store.
 */
export const resolveId = (byId: ReadonlyMap<string, readonly ElementRecord[]>, id: string): ElementMatch => {
  const elements = byId.get(id) ?? [];
  const [first] = elements;
  if (first === undefined) {
    return { kind: "unknown" };
  }
  return elements.length === 1 ? { kind: "found", element: first } : { kind: "ambiguous", elements };
};

/**
 * Every element file with a shared UUID as a problem with repository, file, line of `id` and the
 * UUID (SR-088 AK1), for `workspace.check` (SR-019). Reads only the files with findings again for
 * the lines. Kept until the element store is reset; carried over a change of the store (#184).
 */
export const duplicateIdProblemsState = defineWorkspaceState(
  "duplicate-ids",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    return locateFindings(layout, duplicateIdFindings(store));
  },
  {
    dependsOn: [elementStoreState],
    // A save or a watcher batch looks again only at the files of the UUIDs it changed (#184).
    carry: carryStoreUpdate((value, update, workspace) =>
      carryProblems(workspace, value, update, {
        findingsOf: Promise.resolve((element) => duplicateIdFinding(update.to, element)),
        again: Promise.resolve([...update.ids].flatMap((id) => update.to.byId.get(id) ?? [])),
      }),
    ),
  },
);
