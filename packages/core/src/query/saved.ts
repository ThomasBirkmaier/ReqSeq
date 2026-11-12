// Saved filters (SR-070 "Filter mit Namen als Datei im Repository", D-056, `filter.schema.json`): the
// `filters` kind of saved-files.ts, which reads and writes them (where they lie, how names compare,
// faulty and duplicate files, new file names). A name only a faulty file holds is refused by
// `filter.save` and `selection.filter` (`file.faulty`) rather than guessed.
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { FilterFile, FilterSortKeyWithDefaults } from "../generated/types.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { SavedFile, SavedFolder, SavedKind } from "./saved-files.js";
import {
  SAVED_FILE_EXTENSION,
  faultySaved,
  findSaved,
  inSavedFile,
  inSavedFileAsync,
  newSavedFile,
  readSavedFolder,
  savedSlug,
} from "./saved-files.js";

/** Saved filter files end in `.yaml` (D-056). */
export const FILTER_FILE_EXTENSION = SAVED_FILE_EXTENSION;

/** The saved filters as saved-files.ts reads and writes them. */
export const FILTERS: SavedKind = {
  setting: "filters",
  schema: "filter.schema.json",
  label: "saved filter",
  word: "filter",
  invalid: "filter.invalid",
  duplicate: "filter.duplicate-name",
};

/** A valid saved filter file. */
export type SavedFilter = SavedFile<FilterFile>;

/** The filters folder of a workspace and what it holds; `filters` are its valid filters. */
export type SavedFilters = SavedFolder<FilterFile> & { readonly filters: readonly SavedFilter[] };

/** Reads the filters folder (saved-files.ts). */
export const readSavedFilters = async (layout: WorkspaceLayout): Promise<SavedFilters> => {
  const folder = await readSavedFolder<FilterFile>(layout, FILTERS);
  return { ...folder, filters: folder.saved };
};

export type FoundFilter =
  | { readonly kind: "found"; readonly filter: SavedFilter }
  | { readonly kind: "faulty"; readonly files: readonly string[] }
  | { readonly kind: "none" };

/** The saved filter of `name` (ignoring case): the valid one, else the faulty files that hold it. */
export const findSavedFilter = (saved: SavedFilters, name: string): FoundFilter => {
  const found = findSaved(saved, name);
  return found.kind === "found" ? { kind: "found", filter: found.saved } : found;
};

/** `file.faulty` for a name only faulty files hold. */
export const faultyFilter = (name: string, files: readonly string[], action: string): CommandError =>
  faultySaved(FILTERS, name, files, action);

/** The saved filter `name` for `selection.filter`; `input.invalid` or `file.faulty` when there is none. */
export const savedFilterFor = async (
  layout: WorkspaceLayout,
  name: string,
  command: CommandName,
): Promise<SavedFilter> => {
  const saved = await readSavedFilters(layout);
  const found = findSavedFilter(saved, name);
  if (found.kind === "found") {
    return found.filter;
  }
  if (found.kind === "faulty") {
    throw faultyFilter(name, found.files, "used");
  }
  const where = saved.incomplete
    ? `; its folder is in repository ${String(saved.repository?.name)}, which is not on this machine`
    : "; filter.list lists the saved filters";
  throw new CommandError(
    "input.invalid",
    `selection.filter: no saved filter is named ${JSON.stringify(name)}${where}`,
    {
      command,
      fields: ["selection.filter"],
    },
  );
};

/** Runs `fn` with the name and file of the saved filter in every `CommandError` it throws (`inSavedFile`). */
export const inSavedFilter = <T>(filter: SavedFilter, fn: () => T): T => inSavedFile(FILTERS, filter, fn);

/** `inSavedFilter` for an asynchronous `fn`. */
export const inSavedFilterAsync = async <T>(filter: SavedFilter, fn: () => Promise<T>): Promise<T> =>
  inSavedFileAsync(FILTERS, filter, fn);

/** The sort of a saved filter with the default order, as `element.list` takes it. */
export const savedSort = (filter: SavedFilter): readonly FilterSortKeyWithDefaults[] =>
  (filter.data.sort ?? []).map((key) => ({ ...key, order: key.order ?? "asc" }));

/** The file name part of a filter name (saved-files.ts). */
export const filterSlug = (name: string): string => savedSlug(FILTERS, name);

/** The file name of a new filter in a folder with `entries` (folded names). */
export const newFilterFile = (name: string, entries: ReadonlySet<string>): string =>
  newSavedFile(FILTERS, name, entries);
