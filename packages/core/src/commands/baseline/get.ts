// baseline.get (SR-051 AK1–AK3, SR-094): a baseline with its entries and what became of them since
// (baselines/show.ts), with their evidence on request. This file resolves the stored selection of the file as it selects now
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
// - `withEvidence` (SR-094): the verification status of each entry whose type has the meaning
//   requirement at its version in the baseline, by `recordStatusOf` of the evidence block (ADR-0012
//   "Status rules") over its own records only (AK5: no indirect verification) that count for the
//   baseline (`countsFor`, AK2) and hold in the view of the stored selection (AK4: its variant, else
//   the core). None of the baseline version but others: `outdated`; none: `open` (AK3). When the
//   stored selection cannot be resolved, its `view` alone is resolved for this; a view that is gone
//   leaves the verification out, with a warning. While the metamodel is not valid there are no
//   records (`statusSource`): every requirement is `open`. Page only; one index of all records,
//   built once per state of the records (N-036).
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { Baseline, ShowRequest } from "../../baselines/index.js";
import { copyOf, countsFor, namedBaseline, showBaseline } from "../../baselines/index.js";
import type {
  BaselineStoredRef,
  BaselineStoredSelection,
  ElementSelection,
  Problem,
} from "../../generated/types.js";
import { evidenceIndexState, recordStatusOf, statusSource } from "../../evidence/index.js";
import type { Metamodel } from "../../metamodel/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { ElementRecord } from "../../model/index.js";
import { elementStoreState, isUuid, resolveRef, shortIdState } from "../../model/index.js";
import type { Selected } from "../../query/index.js";
import { resolveSelection } from "../../query/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import type { View } from "../../variants/index.js";
import { resolveView } from "../../variants/index.js";
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

const CORE: View = { kind: "core" };

type Verification = NonNullable<CommandOutput<typeof command>["elements"][number]["verification"]>;

/** The verification of an entry at its baseline version in `view` (see the file comment). */
const verificationIn = async (
  workspace: Workspace,
  metamodel: Metamodel,
  baseline: Baseline,
  view: View,
): Promise<(record: ElementRecord, version: string) => Verification | undefined> => {
  const source = statusSource(
    metamodel,
    metamodel.valid ? await workspace.get(evidenceIndexState) : undefined,
  );
  const counts = countsFor(baseline.data.date);
  const viewId = view.kind === "core" ? "core" : view.variant.id;
  return (record, version) => {
    if (!source.requirements.has(record.type)) {
      return undefined;
    }
    const records = source.recordsOf(record.id).filter((r) => counts(r.date));
    const status = recordStatusOf(records, "verification", version, view);
    return { view: viewId, status: status === "passed" ? "verified" : status };
  };
};

/**
 * The view of the evidence when the stored selection could not be resolved: its `view` alone, the
 * core without; undefined with a warning when that cannot be resolved either.
 */
const storedView = async (
  workspace: Workspace,
  metamodel: Metamodel,
  baseline: Baseline,
  problems: Problem[],
): Promise<View | undefined> => {
  const stored = baseline.data.selection?.view;
  if (stored === undefined) {
    return CORE;
  }
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  try {
    return resolveView({ metamodel, store, shortIds }, refOf(stored), command, "selection.view", true);
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    problems.push({
      code: "baseline.invalid",
      severity: "warning",
      repository: baseline.repository,
      file: baseline.file,
      message: `The view of ${baseline.file} cannot be resolved now (${error.message}); the evidence is left out`,
    });
    return undefined;
  }
};

/**
 * `ShowRequest.verification` for `withEvidence`: in the first of `views`, those of the resolved stored
 * selection (none: the core), or, when it was not resolved (undefined), in its `view` alone
 * (`storedView`).
 */
const evidenceOf = async (
  workspace: Workspace,
  metamodel: Metamodel,
  baseline: Baseline,
  views: readonly View[] | undefined,
  problems: Problem[],
): Promise<Pick<ShowRequest, "verification">> => {
  const shown =
    views === undefined ? await storedView(workspace, metamodel, baseline, problems) : (views[0] ?? CORE);
  return shown === undefined
    ? {}
    : { verification: await verificationIn(workspace, metamodel, baseline, shown) };
};

export default defineCommand({
  name: command,
  run: async ({ workspace }, input): Promise<CommandOutput<typeof command>> => {
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
      ...(input.withEvidence
        ? await evidenceOf(workspace, metamodel, baseline, selected?.views, problems)
        : {}),
    });
  },
});
