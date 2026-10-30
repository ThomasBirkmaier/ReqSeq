// baseline.get (SR-051 AK1–AK3): a baseline with its entries and what became of them since
// (baselines/show.ts). This file resolves the stored selection of the file as it selects now
// (query/selection.ts, ADR-0018 "selection"), which the baselines block cannot import:
//
// - `ids` items by the copy rule of the entries (`copyOf`): a UUID is the copy in the repository
//   of the file, else its only copy; `{ id, repository }` that copy; a short ID or identifier as
//   every command resolves it. `package` and
//   `view` by their UUID or the text written, `filter` by name as it is now, `where` as written.
// - Without stored selection nothing is added or removed (`selectionKnown: false`, AK2, AK3).
// - A stored selection that cannot be resolved now (an element of it in a repository that is not
//   here, a saved filter that is gone) is a `baseline.invalid` warning with the reason, and the
//   answer is given as without stored selection.
// - `withEvidence` is refused until SR-094 gives the evidence of a baseline.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { Baseline } from "../../baselines/index.js";
import { copyOf, namedBaseline, showBaseline } from "../../baselines/index.js";
import type {
  BaselineStoredRef,
  BaselineStoredSelection,
  ElementSelection,
  Problem,
} from "../../generated/types.js";
import { metamodelState } from "../../metamodel/index.js";
import type { ElementRecord } from "../../model/index.js";
import { elementStoreState, isUuid, resolveRef } from "../../model/index.js";
import type { Selected } from "../../query/index.js";
import { resolveSelection } from "../../query/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import { workspaceLayoutState } from "../../workspace/index.js";

const command = "baseline.get";

/** A stored `package` or `view` as a reference of a selection. */
const refOf = (stored: BaselineStoredRef): string => (typeof stored === "string" ? stored : stored.id);

/** What the stored selection of `baseline` selects now (see the file comment). */
const selectedNow = async (
  workspace: Workspace,
  baseline: Baseline,
  stored: BaselineStoredSelection,
): Promise<Pick<Selected, "elements" | "views" | "incomplete" | "store">> => {
  const { ids, package: inPackage, view, ...rest } = stored;
  const selection: ElementSelection = {
    ...rest,
    ...(inPackage === undefined ? {} : { package: refOf(inPackage) }),
    ...(view === undefined ? {} : { view: refOf(view) }),
  };
  const selected = await resolveSelection(workspace, selection, command);
  if (ids === undefined) {
    return selected;
  }
  const { store, shortIds } = selected;
  const named = new Set(
    ids.map((item): ElementRecord => {
      // The copy rule of the entries (`copyOf`); resolveRef names what it does not find.
      const entry = typeof item === "string" ? { id: item.toLowerCase() } : item;
      const copy = isUuid(entry.id) ? copyOf(store.byId, baseline, entry) : undefined;
      return typeof copy === "object"
        ? copy
        : resolveRef(
            store,
            shortIds,
            entry.id,
            typeof item === "string" ? {} : { repository: item.repository },
          );
    }),
  );
  return { ...selected, elements: selected.elements.filter((e) => named.has(e)) };
};

export default defineCommand({
  name: command,
  run: async ({ workspace }, input): Promise<CommandOutput<typeof command>> => {
    if (input.withEvidence) {
      throw new CommandError(
        "input.invalid",
        "withEvidence: the evidence of a baseline comes with SR-094; leave it out",
        {
          command,
          fields: ["withEvidence"],
        },
      );
    }
    const baseline = await namedBaseline(workspace, input.baseline, command);
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const problems: Problem[] = [];
    let selected: Pick<Selected, "elements" | "views" | "incomplete" | "store"> | undefined;
    if (baseline.data.selection !== undefined) {
      try {
        selected = await selectedNow(workspace, baseline, baseline.data.selection);
      } catch (error) {
        if (!(error instanceof CommandError)) {
          throw error;
        }
        problems.push({
          code: "baseline.invalid",
          severity: "warning",
          repository: baseline.repository,
          file: baseline.file,
          message: `The stored selection of ${baseline.file} cannot be resolved now (${error.message}); nothing is marked added or removed`,
        });
      }
    }
    const [view] = selected?.views ?? [];
    return showBaseline(workspace, {
      baseline,
      metamodel,
      store: selected?.store ?? (await workspace.get(elementStoreState)),
      selected: selected?.elements,
      view: view?.kind === "variant" ? view.variant.id : undefined,
      incomplete: layout.repositories.some((r) => !r.available) || selected?.incomplete === true,
      problems,
      limit: input.limit,
      offset: input.offset,
    });
  },
});
