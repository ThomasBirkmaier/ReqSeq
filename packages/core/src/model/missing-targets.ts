// Relations to missing targets (SR-089, N-065, D-041, D-058). A relation names its target by UUID
// and, across repositories, by the workspace name of the target's repository. When that repository
// is on this machine and has no element with the UUID (the target file was removed or the UUID is
// wrong), the relation is a finding with source and target ID; LogReq changes no file. Severity
// `error`: SR-089 asks for a "Befund", not a "Hinweis", and SR-019 AK2 ends the check with exit
// code 1 for it (ADR-0009). Where the target is comes from `targetState`, which the element view
// also uses (SR-080):
// - `missing`: reported here.
// - `inaccessible` (the repository is in the workspace file but not here): not a finding, SR-006
//   shows it as not accessible (SR-089 AK2).
// - `unknown-repository` (the workspace file lists no such repository): not a finding either; it is
//   no "lokal vorhandenes Repository" and counts like an inaccessible one (spec question #193).
// - `ambiguous`: SR-088 reports the files that share the UUID.
// Checked are the items of relation kinds and the values of relation-valued properties
// (`relationItems`: a property wins over a relation kind), whatever the source's type. An item
// counts as a target when it is a mapping with a UUID as `id`, as in the element view; a missing
// or wrong `version` or other keys do not matter here (ADR-0004 keeps such entries). Values of
// another shape (no mapping, no UUID, one mapping where a list belongs or the reverse) are left to
// the value-kind check (SR-085). Inline references in the text are no relations here: D-013 tells
// "Beziehung" and "Verweis" apart, and SR-066 AK3 makes a reference count "wie eine Beziehung" only
// for being outdated (ADR-0004); they also name no repository, so a missing target could not be
// told from one in a repository that is not here (spec question #177 (c)).
// A target whose file cannot be read (faulty YAML, conflict markers, SR-008) is not in the store,
// so it counts as missing too; when a file with a problem in that repository carries the target's
// UUID digits in its name (D-056), the message says the target may be in that file.
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import { FILE_NAME_DIGITS } from "./file-name.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { hasId, relationItems, relationKey } from "./relation-keys.js";
import { targetState } from "./relations.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import type { ValuePath } from "./values.js";

/** What the check needs: where targets are (layout and store), messages show short IDs (SR-084). */
export interface MissingTargetContext {
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/**
 * A relation whose target is missing, before its line is known (`locateFindings` adds the line of
 * the item). `element` is the source; the problem has code `relation.missing-target`, severity
 * `error`, repository, file, element ID (the source) and target ID.
 */
export type MissingTargetFinding = LocatableFinding & {
  readonly path: ValuePath;
  /**
   * The target as written in the source file: a mapping with a UUID as `id`. Its other keys are
   * not checked here (ADR-0004 keeps such entries; their shape is SR-085's).
   */
  readonly target: Readonly<Record<string, unknown>> & { readonly id: string };
};

/** The last 12 hex digits of a UUID, as element file names carry them (D-056). */
const fileDigits = (id: string): string => id.replaceAll("-", "").slice(-FILE_NAME_DIGITS).toLowerCase();

const FILE_DIGITS = new RegExp(`-([0-9a-fA-F]{${String(FILE_NAME_DIGITS)}})\\.md$`, "i");

/** One index per store: the files with a problem (not read as elements), by repository and file-name digits. */
const unreadable = new WeakMap<ElementStore, ReadonlyMap<string, string>>();

/** The file of `repository` whose name carries the digits of `id` and that has a problem (SR-008), if any. */
const unreadableFile = (store: ElementStore, repository: string, id: string): string | undefined => {
  let index = unreadable.get(store);
  if (index === undefined) {
    const built = new Map<string, string>();
    // A file with only a warning (e.g. `file.yaml-warning`) is still read as an element: never name it.
    const read = new Set(store.elements.map((e) => `${e.repository}\n${e.file}`));
    for (const { repository: where, file } of store.problems) {
      const match = FILE_DIGITS.exec(file ?? "");
      if (where === undefined || match === null || read.has(`${where}\n${match.input}`)) {
        continue;
      }
      built.set(`${where}\n${String(match[1]).toLowerCase()}`, match.input);
    }
    unreadable.set(store, built);
    index = built;
  }
  return index.get(`${repository}\n${fileDigits(id)}`);
};

const collect = (
  element: ElementRecord,
  context: MissingTargetContext,
  out: MissingTargetFinding[],
): void => {
  const { layout, store, metamodel, shortIds } = context;
  let source: string | undefined;
  for (const [key, value] of Object.entries(element.data)) {
    const relation = relationKey(metamodel, key);
    if (relation === undefined) {
      continue;
    }
    for (const [path, item] of relationItems(key, relation, value)) {
      if (!hasId(item)) {
        continue;
      }
      const state = targetState(layout, store, element.repository, item);
      // The UUID check only for the few missing targets, not for every relation (N-036).
      if (state.kind !== "missing" || !isUuid(item.id)) {
        continue;
      }
      const file = unreadableFile(store, state.repository, item.id);
      const note = file === undefined ? "" : `; its file may be ${file}, which LogReq cannot read`;
      source ??= `${findType(metamodel, element.type)?.name ?? element.type} ${shortIds.of(element)}`;
      out.push({
        element,
        path,
        target: item,
        problem: {
          code: "relation.missing-target",
          severity: "error",
          message: `${relation.label} of ${source} points to ${item.id}, which is not in repository ${state.repository}${note}`,
          repository: element.repository,
          file: element.file,
          elementId: element.id,
          targetId: item.id,
        },
      });
    }
  }
};

/**
 * The relations of one element whose target is missing (SR-089 AK1), in the order of the keys in
 * the file, then of the list items. For a command about one element (`element.get`, with
 * `locateFindings` for the lines of just this element) and a command that has just written it.
 */
export const missingTargetFindings = (
  element: ElementRecord,
  context: MissingTargetContext,
): readonly MissingTargetFinding[] => {
  const out: MissingTargetFinding[] = [];
  collect(element, context, out);
  return out;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allMissingTargetFindings = (context: MissingTargetContext): readonly MissingTargetFinding[] => {
  const out: MissingTargetFinding[] = [];
  for (const element of context.store.elements) {
    collect(element, context, out);
  }
  return out;
};

/**
 * Every relation of the workspace whose target is missing, as a problem with repository, file,
 * line, element ID (the source) and target ID (SR-089 AK1), for `workspace.check` (SR-019). Reads
 * every file with findings again for the lines (`locateFindings`). Kept until the element store or
 * the metamodel is reset.
 */
export const missingTargetProblemsState = defineWorkspaceState(
  "missing-targets",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const shortIds = await workspace.get(shortIdState);
    return locateFindings(layout, allMissingTargetFindings({ layout, store, metamodel, shortIds }));
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
