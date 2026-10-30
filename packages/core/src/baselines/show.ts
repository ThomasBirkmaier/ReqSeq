// Showing a baseline (SR-051 AK1–AK3, `baseline.get`): each entry of the file with its version
// then, that version's date and what became of it, plus what the stored selection selects now and
// the file does not list. The command resolves the stored selection (layer rule: `query` lies above
// this block) and passes the elements it selects now.
//
// - The copy of an entry: the one its `repository` names, else the copy in the repository of the
//   file, else the only copy (ADR-0018 "elements"); none, or several elsewhere: `missing`. The answer is `incomplete` while a repository is not on
//   this machine (SR-006): its entries are `missing` and its elements are not seen.
// - State, first that holds (AK2, AK3):
//   `missing`; `superseded` when its status is invalid now (D-044), also when it changed;
//   `removed` when the file stores a selection that no longer selects it, also when it changed;
//   `changed` when its current version differs; else `unchanged`. `current` is the current version
//   whenever it differs. Without stored selection there is no `removed` and no `added`
//   (`selectionKnown: false`).
// - `added`: the elements selected now that the file does not list, in store order, after the
//   entries in file order; they have no `version`.
// - Cost (N-036): the states of all entries from one current-versions lookup and one index of the
//   store by UUID; version dates (ADR-0005, `versionDates`) for the page only. The content of an
//   old version is never read: Git shows it (D-033, `baseline.compare`).
import type { CommandOutput } from "../catalog.js";
import type { Problem } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import {
  currentVersionsOf,
  elementStoreState,
  invalidStatuses,
  namesOfRecords,
  shortIdState,
} from "../model/index.js";
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
  /** The elements the stored selection selects now; undefined without stored selection. */
  readonly selected: readonly ElementRecord[] | undefined;
  /** The UUID of the variant of the stored selection's view; undefined for the core or no view. */
  readonly view: string | undefined;
  /** A repository is not on this machine, or the selection says so (SR-006). */
  readonly incomplete: boolean;
  readonly problems: readonly Problem[];
  readonly limit: number;
  readonly offset: number;
}

/** The copy an entry of `baseline` names (see the file comment), or undefined. */
export const copyOf = (
  byId: ReadonlyMap<string, readonly ElementRecord[]>,
  baseline: Baseline,
  entry: Baseline["data"]["elements"][number],
): ElementRecord | undefined => {
  const copies = byId.get(entry.id) ?? [];
  const home = copies.find((r) => r.repository === (entry.repository ?? baseline.repository));
  return home !== undefined || entry.repository !== undefined || copies.length !== 1 ? home : copies[0];
};

/** `current` of a row: the current version when it differs from the one in the baseline. */
const currentField = (current: string | undefined, version?: string): { readonly current?: string } =>
  current === undefined || current === version ? {} : { current };

/** The baseline with its entries and what became of them (see the file comment). */
export const showBaseline = async (workspace: Workspace, request: ShowRequest): Promise<Output> => {
  const { baseline, metamodel } = request;
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const entries = baseline.data.elements;
  const copies = entries.map((entry) => copyOf(store.byId, baseline, entry));
  const listed = new Set(copies);
  const selected = request.selected;
  const now = selected === undefined ? undefined : new Set(selected);
  const added = selected?.filter((r) => !listed.has(r)) ?? [];
  const versions = await currentVersionsOf(workspace, [
    ...copies.filter((c): c is ElementRecord => c !== undefined),
    ...added,
  ]);
  const currentOf = (record: ElementRecord): string | undefined => {
    const entry = versions.get(record);
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
  // An added element has no version in the baseline; a missing one no date.
  const elements = page.map(({ row }) =>
    row.version === undefined
      ? row
      : { ...row, versionDate: dateOf.get(`${row.id}\n${String(row.repository)}`) ?? null },
  );
  const named = page.flatMap(({ record }) => (record === undefined ? [] : [record]));
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
    ]),
    ...(request.problems.length === 0 ? {} : { problems: request.problems }),
    ...(request.incomplete ? { incomplete: true } : {}),
  };
};
