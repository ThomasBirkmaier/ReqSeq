// Showing a baseline (SR-051 AK1–AK3, `baseline.get`): each entry of the file with its version
// then, that version's date and what became of it, plus what the stored selection selects now and
// the file does not list. The command resolves the stored selection (layer rule: `query` lies above
// this block) and passes the elements it selects now.
//
// - The copy of an entry: the one its `repository` names, else the copy in the repository of the
//   file, else the only copy (ADR-0018 "elements"); none: `missing`; several elsewhere: `missing` with
//   a `baseline.invalid` warning; a second entry of the same copy: no row, a warning. The answer is `incomplete` while a repository is not on
//   this machine (SR-006): its entries are `missing` and its elements are not seen.
// - State, first that holds (AK2, AK3):
//   `missing`; `superseded` when its status is invalid now (D-044), also when it changed;
//   `removed` when the file stores a selection that no longer selects it, also when it changed;
//   `changed` when its current version differs or cannot be computed (a `file.faulty` warning says
//   so); else `unchanged`. `current` is the current version
//   whenever it differs. Without stored selection there is no `removed` and no `added`
//   (`selectionKnown: false`).
// - `added`: the elements selected now that the file does not list, in store order, after the
//   entries in file order; they have no `version`.
// - Cost (N-036): the states of all entries from one current-versions lookup and one index of the
//   store by UUID; version dates (ADR-0005, `versionDates`) for the page only. The content of an
//   old version is never read: Git shows it (D-033, `baseline.compare`).
// - With `withEvidence` the command passes how to compute the evidence of an entry (SR-094,
//   `commands/baseline/get.ts`: the evidence block lies above this one): its verification rows per
//   view and its validation status, asked for the page only. `names` names the variants of the rows.
import type { CommandOutput } from "../catalog.js";
import type { Problem } from "../generated/types.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { currentVersionsOf, invalidStatuses, namesOfRecords, shortIdState } from "../model/index.js";
import { versionDates } from "../model/version-date.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Baseline } from "./read.js";

type Output = CommandOutput<"baseline.get">;
type Row = Output["elements"][number];
type State = Row["state"];

/** What the command resolved for `showBaseline`. */
export interface ShowRequest {
  readonly baseline: Baseline;
  readonly metamodel: Parameters<typeof invalidStatuses>[0];
  /** The store the selection was resolved in. */
  readonly store: ElementStore;
  /** The elements the stored selection selects now; undefined without stored selection. */
  readonly selected: readonly ElementRecord[] | undefined;
  /** The UUID of the variant of the stored selection's view; undefined for the core or no view. */
  readonly view: string | undefined;
  /** A repository is not on this machine, or the selection says so (SR-006). */
  readonly incomplete: boolean;
  readonly problems: readonly Problem[];
  readonly limit: number;
  readonly offset: number;
  /**
   * With `withEvidence` (SR-094): the evidence of an entry of the file at its version in the
   * baseline (`baselineEvidence` of the evidence block). Asked for the page only.
   */
  readonly evidence?: (
    record: ElementRecord,
    version: string,
  ) => Pick<Row, "verification" | "validation" | "validationLater">;
}

/**
 * The copy an entry of `baseline` (or a stored `ids` item) names (see the file comment): undefined
 * for none, `ambiguous` for an entry without `repository` whose UUID has several copies elsewhere.
 */
export const copyOf = (
  byId: ReadonlyMap<string, readonly ElementRecord[]>,
  baseline: Pick<Baseline, "repository">,
  entry: { readonly id: string; readonly repository?: string },
): ElementRecord | "ambiguous" | undefined => {
  const copies = byId.get(entry.id) ?? [];
  const home = copies.find((r) => r.repository === (entry.repository ?? baseline.repository));
  if (home !== undefined || entry.repository !== undefined) {
    return home;
  }
  return copies.length < 2 ? copies[0] : "ambiguous";
};

/** A `baseline.invalid` warning of the file of `baseline`. */
const warningIn = (baseline: Baseline, message: string): Problem => ({
  code: "baseline.invalid",
  severity: "warning",
  repository: baseline.repository,
  file: baseline.file,
  message: `${baseline.file}: ${message}`,
});

/** `current` of a row: the current version when it differs from the one in the baseline. */
const currentField = (current: string | undefined, version?: string): { readonly current?: string } =>
  current === undefined || current === version ? {} : { current };

/** The entries of `baseline` with their copies, one per copy; the warnings go into `problems`. */
const entriesOf = (
  store: ElementStore,
  baseline: Baseline,
  problems: Problem[],
): {
  readonly entries: Baseline["data"]["elements"][number][];
  readonly copies: (ElementRecord | undefined)[];
  readonly listed: ReadonlySet<ElementRecord>;
} => {
  const listed = new Set<ElementRecord>();
  const entries: Baseline["data"]["elements"][number][] = [];
  const copies: (ElementRecord | undefined)[] = [];
  for (const entry of baseline.data.elements) {
    const copy = copyOf(store.byId, baseline, entry);
    if (copy === "ambiguous") {
      problems.push(
        warningIn(
          baseline,
          `${entry.id} names no repository and has copies in several; it is shown as missing, add its repository`,
        ),
      );
    } else if (copy !== undefined && listed.has(copy)) {
      problems.push(
        warningIn(
          baseline,
          `${entry.id} is listed twice for the copy in ${copy.repository}; the first entry is shown`,
        ),
      );
      continue;
    }
    entries.push(entry);
    copies.push(copy === "ambiguous" ? undefined : copy);
    if (copy !== undefined && copy !== "ambiguous") {
      listed.add(copy);
    }
  }
  return { entries, copies, listed };
};

/** The baseline with its entries and what became of them (see the file comment). */
export const showBaseline = async (workspace: Workspace, request: ShowRequest): Promise<Output> => {
  const { baseline, metamodel, store } = request;
  const layout = await workspace.get(workspaceLayoutState);
  const shortIds = await workspace.get(shortIdState);
  const problems = [...request.problems];
  const { entries, copies, listed } = entriesOf(store, baseline, problems);
  const selected = request.selected;
  const now = selected === undefined ? undefined : new Set(selected);
  const added = selected?.filter((r) => !listed.has(r)) ?? [];
  const versions = await currentVersionsOf(workspace, [
    ...copies.filter((c): c is ElementRecord => c !== undefined),
    ...added,
  ]);
  const currentOf = (record: ElementRecord): string | undefined => {
    const entry = versions.get(record);
    if (entry?.kind === "unknown") {
      problems.push({
        code: "file.faulty",
        severity: "warning",
        repository: record.repository,
        file: record.file,
        message: `${shortIds.of(record)} has no current version (${entry.message}); it cannot be compared with the baseline, so it counts as changed unless superseded or removed`,
      });
    }
    return entry?.kind === "version" ? entry.version : undefined;
  };
  const invalid = invalidStatuses(metamodel);
  const rows: { row: Row; record: ElementRecord | undefined }[] = entries.map((entry, index) => {
    const record = copies[index];
    if (record === undefined) {
      const missing = { id: entry.id, state: "missing" as const, version: entry.version };
      return {
        row: entry.repository === undefined ? missing : { ...missing, repository: entry.repository },
        record,
      };
    }
    const current = currentOf(record);
    const state: State = invalid.has(String(record.data["status"]))
      ? "superseded"
      : now !== undefined && !now.has(record)
        ? "removed"
        : current === entry.version
          ? "unchanged"
          : "changed";
    const row: Row = {
      id: entry.id,
      repository: record.repository,
      state,
      version: entry.version,
      ...currentField(current, entry.version),
    };
    return { row, record };
  });
  for (const record of added) {
    const row: Row = {
      id: record.id,
      repository: record.repository,
      state: "added",
      ...currentField(currentOf(record)),
    };
    rows.push({ row, record });
  }
  const counts = { unchanged: 0, changed: 0, superseded: 0, removed: 0, added: 0, missing: 0 };
  for (const { row } of rows) {
    counts[row.state] += 1;
  }
  const page = rows.slice(request.offset, request.offset + request.limit);
  const asked = page.flatMap(({ row, record }) =>
    record === undefined || row.version === undefined
      ? []
      : [{ repository: record.repository, file: record.file, id: row.id, version: row.version }],
  );
  const dates = await versionDates({ workspace, layout, metamodel }, asked);
  const dateOf = new Map(
    asked.map((request, index) => [`${request.id}\n${request.repository}`, dates[index]]),
  );
  // An added element has no version in the baseline; a missing one no date and no evidence.
  const evidenceOf = request.evidence;
  const elements = page.map(({ row, record }): Row => {
    if (row.version === undefined) {
      return row;
    }
    return {
      ...row,
      versionDate: dateOf.get(`${row.id}\n${String(row.repository)}`) ?? null,
      ...(record === undefined ? {} : evidenceOf?.(record, row.version)),
    };
  });
  const named = page.flatMap(({ record }) => (record === undefined ? [] : [record]));
  // The variants the verification rows name by UUID (#588), resolved in this store.
  const variants = new Set<string>();
  for (const { verification } of elements) {
    for (const { view } of verification ?? []) {
      if (view !== "core") {
        variants.add(view);
      }
    }
  }
  return {
    name: baseline.name,
    file: baseline.shown,
    repository: baseline.repository,
    date: baseline.data.date,
    ...(request.view === undefined ? {} : { view: request.view }),
    selectionKnown: selected !== undefined,
    repositories: baseline.data.repositories.map((r) => ({ name: r.name, commit: r.commit })),
    elements,
    counts,
    total: rows.length,
    names: namesOfRecords({ metamodel, store, shortIds }, [
      ...named,
      // The view was resolved in this store.
      ...(request.view === undefined ? [] : (store.byId.get(request.view) as ElementRecord[])),
      // The rows name variants of the workspace's store, which the selection was resolved in; the
      // rows are read after the store, so a variant added in between is left unnamed.
      ...[...variants]
        .filter((id) => store.byId.has(id))
        .flatMap((id) => store.byId.get(id) as ElementRecord[]),
    ]),
    ...(problems.length === 0 ? {} : { problems }),
    ...(request.incomplete ? { incomplete: true } : {}),
  };
};
