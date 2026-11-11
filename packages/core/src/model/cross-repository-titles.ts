// Titles stored across a repository boundary (SR-005 AK4, D-058). Across repositories a relation
// stores only the target's UUID, version and the workspace name of its repository (SR-005 AK1,
// `currentTarget`), and the tool never touches such an entry again (`relation-titles.ts`). A
// `title` written there by hand (for example after fixing a moved element) would carry the title
// of the target into the source's repository, so the check warns about it, with file and line.
//
// - Checked: the items of relation kinds and the values of relation-valued properties
//   (`relationItems`, as SR-089 checks them), whatever the source's type, and whatever its status:
//   also a source with an invalid status (SR-072, D-044) is reported (SR-005 AK4).
// - An item crosses the boundary when it is a mapping with a text `id` (`hasId`) and names a
//   `repository` (text) other than the source's own. Where the target is (here, not here, unknown)
//   does not matter: the title is in the source's file either way. An item without `repository`,
//   or with the source's own, lies in the same repository and stores the title (SR-010).
// - Problem: code `relation.cross-repository-title`, severity `warning`, repository, file, line of
//   the item, `elementId` (the source), `targetId`, `targetRepository` (as the item names it) and
//   `key`. ReqSeq changes no file.
// - Cost (N-036): one pass over the relation items of the store; only the files with a finding are
//   read again for their lines (`findingLocator`).
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { hasId, relationItems, relationKey } from "./relation-keys.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";
import { elementLabel } from "./superseded.js";

/** What the check needs: relation keys from the metamodel, short IDs for messages (SR-084). */
export interface CrossRepositoryTitleContext {
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/**
 * The relation items of `element` into another repository that store a `title`, in the order of
 * the keys in the file, then of the items, before their lines are known: for the whole workspace
 * and for `elementView` (SR-026 AK3).
 */
export const crossRepositoryTitleFindings = (
  element: ElementRecord,
  context: CrossRepositoryTitleContext,
): readonly LocatableFinding[] => {
  const { metamodel } = context;
  const out: LocatableFinding[] = [];
  for (const [key, value] of Object.entries(element.data)) {
    const relation = relationKey(metamodel, key);
    if (relation === undefined) {
      continue;
    }
    for (const [path, item] of relationItems(key, relation, value)) {
      if (!hasId(item)) {
        continue;
      }
      const repository = item["repository"];
      if (
        typeof repository !== "string" ||
        repository === element.repository ||
        !Object.hasOwn(item, "title")
      ) {
        continue;
      }
      out.push({
        element,
        path,
        problem: {
          code: "relation.cross-repository-title",
          severity: "warning",
          message: `${relation.label} of ${elementLabel(context, element)} stores a title for ${item.id} in repository ${repository}; across repositories only UUID, version and repository are stored`,
          repository: element.repository,
          file: element.file,
          elementId: element.id,
          targetId: item.id,
          targetRepository: repository,
          key,
        },
      });
    }
  }
  return out;
};

/**
 * Every relation of the workspace into another repository that stores a title (SR-005 AK4), as a
 * warning with repository, file, line, source and target, for `workspace.check` (SR-019) and
 * `hint.list`, in store order. Kept until the element store, the metamodel or the short IDs are reset.
 */
export const crossRepositoryTitleProblemsState = defineWorkspaceState(
  "cross-repository-titles",
  async (workspace): Promise<readonly Problem[]> => {
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (ThomasBirkmaier/ReqSeq-archive#208).
    if (!metamodel.valid) {
      return [];
    }
    const store = await workspace.get(elementStoreState);
    const context = { metamodel, shortIds: await workspace.get(shortIdState) };
    const findings = store.elements.flatMap((element) => crossRepositoryTitleFindings(element, context));
    return locateFindings(await workspace.get(workspaceLayoutState), findings);
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
