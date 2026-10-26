// Saved filters (SR-070 "Filter mit Namen als Datei im Repository", D-056, `filter.schema.json`).
//
// - Where: the `filters` location of the workspace file, by default the folder `filters` in the main
//   repository (`settingLocation`). A saved filter is a `*.yaml` file directly in that folder that
//   matches `filter.schema.json`, as the metamodel folder is read; a `.yml` file is reported and not
//   read. Filters are not elements (D-056: "Alle anderen Dateien des Tools sind YAML"), so D-045 does
//   not apply to them; LogReq never deletes, moves or renames a filter file.
// - Read on every call, never kept: a handful of small files, and a filter another person committed
//   is there as soon as the working copy has it (AK2), also for a running server or the app.
// - Names compare ignoring case and Unicode normal form (`fold`, spec-frage #363 option 2A), as
//   element references, statuses and choices do. The first file in file order (code units) that
//   holds a name is that filter; a later valid file with the same name is `filter.duplicate-name`
//   (warning) and not listed. A file that is no valid filter is a problem and not listed; when its
//   name can still be read, that name is held by a faulty file, which `filter.save` and
//   `selection.filter` refuse (`file.faulty`) rather than guess.
// - New files (`newFilterFile`): the letters and digits of the name in lower case, without accents,
//   `-` between, at most 64 characters, then `-2`, `-3` ... while the folder has an entry of that
//   name ignoring case. Names of Windows devices (`con`, `nul`, `com1` ...) get `-filter`.
import fs from "node:fs/promises";
import path from "node:path";
import { isNode } from "yaml";
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { YamlFile } from "../files/index.js";
import { readYamlFile } from "../files/index.js";
import type {
  FilterFile,
  FilterSortKeyWithDefaults,
  Problem,
  WorkspaceLocation,
} from "../generated/types.js";
import { contractsBundle, fileSchemaValidator } from "../runtime/contracts.js";
import { workspacePath } from "../model/index.js";
import { inputViolations } from "../runtime/input-errors.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE, locate, settingLocation } from "../workspace/index.js";
import { fold } from "./context.js";

/** Saved filter files end in `.yaml` (D-056). */
export const FILTER_FILE_EXTENSION = ".yaml";

/** A valid saved filter file. */
export interface SavedFilter {
  readonly name: string;
  /** The file relative to the workspace root (the main repository's folder), `/` as separator. */
  readonly file: string;
  readonly repository: RepositoryLocation;
  /** The file relative to its repository, `/` as separator. */
  readonly path: string;
  readonly data: FilterFile;
  /** As read, for editing it in place (`editYamlDocument`, ADR-0007). */
  readonly yaml: YamlFile;
}

/** The filters folder of a workspace and what it holds. */
export interface SavedFilters {
  /** The `filters` location of the workspace file, or its default. */
  readonly location: WorkspaceLocation;
  /** The repository of the folder; undefined when the workspace file names one it does not list. */
  readonly repository: RepositoryLocation | undefined;
  /** The folder relative to its repository, `/` as separator, `""` for its root. */
  readonly folder: string;
  /** Whether the folder exists; false also while its repository is not on this machine. */
  readonly exists: boolean;
  /** The valid filters, one per name, in file order. */
  readonly filters: readonly SavedFilter[];
  /** Faulty and duplicate files, in file order. */
  readonly problems: readonly Problem[];
  /** The names (folded) of faulty files that could still be read, with their files (relative to the repository). */
  readonly faultyNames: ReadonlyMap<string, readonly string[]>;
  /** Every entry name of the folder, folded, for choosing a new file name. */
  readonly entries: ReadonlySet<string>;
  /** The repository of the folder is not on this machine: its filters may exist (SR-006 AK2). */
  readonly incomplete: boolean;
}

const filterProblem = (
  code: Problem["code"],
  severity: Problem["severity"],
  repository: string,
  file: string,
  message: string,
  line?: number,
): Problem => ({
  code,
  severity,
  message,
  repository,
  file,
  ...(line === undefined ? {} : { line }),
});

/** The line of the value a schema violation points at, or of the closest one above it. */
const violationLine = (yaml: YamlFile, pointer: string): number | undefined => {
  const segments =
    pointer === ""
      ? []
      : pointer
          .slice(1)
          .split("/")
          .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
  for (let n = segments.length; n >= 0; n--) {
    const node: unknown = yaml.document.getIn(segments.slice(0, n), true);
    if (isNode(node) && node.range) {
      return yaml.lines.linePos(node.range[0]).line;
    }
  }
  return undefined;
};

type Listing =
  | { readonly kind: "names"; readonly names: readonly string[]; readonly entries: ReadonlySet<string> }
  | { readonly kind: "missing" }
  | { readonly kind: "error"; readonly reason: string };

/** The files of the folder that are not hidden, sorted (code units), and every entry name folded. */
const listFolder = async (folder: string): Promise<Listing> => {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const names = entries.filter((e) => !e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
    return { kind: "names", names: [...names].sort(), entries: new Set(entries.map((e) => fold(e.name))) };
  } catch (error) {
    // Errors of `readdir` carry a code.
    const { code } = error as NodeJS.ErrnoException;
    return code === "ENOENT" ? { kind: "missing" } : { kind: "error", reason: String(code) };
  }
};

type CheckedFilter =
  | {
      readonly kind: "valid";
      readonly yaml: YamlFile;
      readonly data: FilterFile;
      readonly problems: readonly Problem[];
    }
  | { readonly kind: "faulty"; readonly name: string | undefined; readonly problems: readonly Problem[] };

/** Reads one filter file and checks it against `filter.schema.json`. */
const checkFilterFile = async (repository: RepositoryLocation, file: string): Promise<CheckedFilter> => {
  const read = await readYamlFile(repository.folder, file);
  if (read.kind === "problem") {
    return { kind: "faulty", name: undefined, problems: [{ ...read.problem, repository: repository.name }] };
  }
  const yaml = read.file;
  const problems: Problem[] = yaml.warnings.map((w) => ({ ...w, repository: repository.name }));
  const validate = fileSchemaValidator("filter.schema.json");
  if (validate(yaml.data)) {
    return { kind: "valid", yaml, data: yaml.data as FilterFile, problems };
  }
  // Readable as input errors are (#309): one message for the branches of a condition.
  const violations = inputViolations(validate.errors, { input: yaml.data, schemas: contractsBundle.schemas });
  for (const violation of violations) {
    const message =
      violation.field === "" ? violation.message.replace(/^The input /, "the file ") : violation.message;
    problems.push(
      filterProblem(
        "filter.invalid",
        "error",
        repository.name,
        file,
        `Invalid saved filter ${file}: ${message}`,
        violationLine(yaml, violation.path),
      ),
    );
  }
  const name = (yaml.data as { readonly name?: unknown } | null)?.name;
  return { kind: "faulty", name: typeof name === "string" ? name : undefined, problems };
};

/** Reads the filters folder (see the file comment). */
export const readSavedFilters = async (layout: WorkspaceLayout): Promise<SavedFilters> => {
  const location = settingLocation(layout, "filters");
  const located = locate(layout, location);
  const { repository } = located;
  const none = {
    location,
    filters: [],
    problems: [],
    faultyNames: new Map<string, readonly string[]>(),
    entries: new Set<string>(),
  };
  if (repository === undefined || located.folder === undefined) {
    return { ...none, repository, folder: "", exists: false, incomplete: repository !== undefined };
  }
  const folder = path.relative(repository.folder, located.folder).split(path.sep).join("/");
  const at = (name: string): string => path.posix.join(folder, name);
  const shown = folder === "" ? "." : folder;
  const listing = await listFolder(located.folder);
  if (listing.kind !== "names") {
    const problems =
      listing.kind === "missing"
        ? []
        : [
            filterProblem(
              "file.unreadable",
              "error",
              repository.name,
              shown,
              `Cannot read the filters folder ${shown}: ${listing.reason}`,
            ),
          ];
    // An unreadable folder counts as missing: creating it then names what is in the way.
    return { ...none, problems, repository, folder, exists: false, incomplete: false };
  }
  const names = listing.names.filter(
    (name) => !(repository.main && folder === "" && name === WORKSPACE_FILE),
  );
  const problems: Problem[] = [];
  const filters: SavedFilter[] = [];
  const firstOf = new Map<string, SavedFilter>();
  const faultyNames = new Map<string, string[]>();
  for (const name of names) {
    const file = at(name);
    if (name.endsWith(".yml")) {
      problems.push(
        filterProblem(
          "filter.invalid",
          "warning",
          repository.name,
          file,
          `${file} is not read: saved filter files end in ${FILTER_FILE_EXTENSION}`,
        ),
      );
      continue;
    }
    if (!name.endsWith(FILTER_FILE_EXTENSION)) {
      continue;
    }
    const checked = await checkFilterFile(repository, file);
    problems.push(...checked.problems);
    if (checked.kind === "faulty") {
      if (checked.name !== undefined) {
        const faulty = fold(checked.name);
        faultyNames.set(faulty, [...(faultyNames.get(faulty) ?? []), file]);
      }
      continue;
    }
    const { yaml, data } = checked;
    const key = fold(data.name);
    const first = firstOf.get(key);
    if (first !== undefined) {
      problems.push(
        filterProblem(
          "filter.duplicate-name",
          "warning",
          repository.name,
          file,
          `Saved filter ${file} has the name ${JSON.stringify(data.name)} of ${first.path}, which is used; rename one`,
          violationLine(yaml, "/name"),
        ),
      );
      continue;
    }
    const filter: SavedFilter = {
      name: data.name,
      file: workspacePath(layout, repository, file),
      repository,
      path: file,
      data,
      yaml,
    };
    firstOf.set(key, filter);
    filters.push(filter);
  }
  return {
    location,
    repository,
    folder,
    exists: true,
    filters,
    problems,
    faultyNames,
    entries: listing.entries,
    incomplete: false,
  };
};

export type FoundFilter =
  | { readonly kind: "found"; readonly filter: SavedFilter }
  | { readonly kind: "faulty"; readonly files: readonly string[] }
  | { readonly kind: "none" };

/** The saved filter of `name` (ignoring case): the valid one, else the faulty files that hold it. */
export const findSavedFilter = (saved: SavedFilters, name: string): FoundFilter => {
  const key = fold(name);
  const filter = saved.filters.find((f) => fold(f.name) === key);
  if (filter !== undefined) {
    return { kind: "found", filter };
  }
  const files = saved.faultyNames.get(key);
  return files === undefined ? { kind: "none" } : { kind: "faulty", files };
};

/** `file.faulty` for a name only faulty files hold. */
export const faultyFilter = (name: string, files: readonly string[], action: string): CommandError =>
  new CommandError(
    "file.faulty",
    `The saved filter ${JSON.stringify(name)} is in a faulty file (${files.join(", ")}); fix it by hand before it can be ${action}`,
    { files: [...files] },
  );

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

/**
 * Runs `fn` and gives every `CommandError` it throws the name and file of the saved filter in its
 * message, so a problem of a hand-written filter file says where it is. The code stays.
 */
export const inSavedFilter = <T>(filter: SavedFilter, fn: () => T): T => {
  try {
    return fn();
  } catch (error) {
    throw error instanceof CommandError
      ? new CommandError(
          error.code,
          `Saved filter ${JSON.stringify(filter.name)} (${filter.file}): ${error.message}`,
          error.details,
        )
      : error;
  }
};

/** `inSavedFilter` for an asynchronous `fn`. */
export const inSavedFilterAsync = async <T>(filter: SavedFilter, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    return inSavedFilter(filter, () => {
      throw error;
    });
  }
};

/** The sort of a saved filter with the default order, as `element.list` takes it. */
export const savedSort = (filter: SavedFilter): readonly FilterSortKeyWithDefaults[] =>
  (filter.data.sort ?? []).map((key) => ({ ...key, order: key.order ?? "asc" }));

/** Longest name part of a new filter file, in characters. */
const SLUG_LENGTH = 64;
/** Names Windows gives to devices, in any case and with any extension. */
const WINDOWS_DEVICES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** The file name part of a filter name (see the file comment). */
export const filterSlug = (name: string): string => {
  const letters = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // By code points, so no character is cut in half.
  const cut = Array.from(letters).slice(0, SLUG_LENGTH).join("").replace(/-+$/, "");
  const slug = cut === "" ? "filter" : cut;
  return WINDOWS_DEVICES.test(slug) ? `${slug}-filter` : slug;
};

/** The file name of a new filter in a folder with `entries` (folded names). */
export const newFilterFile = (name: string, entries: ReadonlySet<string>): string => {
  const slug = filterSlug(name);
  for (let n = 1; ; n++) {
    const file = `${n === 1 ? slug : `${slug}-${String(n)}`}${FILTER_FILE_EXTENSION}`;
    if (!entries.has(fold(file))) {
      return file;
    }
  }
};
