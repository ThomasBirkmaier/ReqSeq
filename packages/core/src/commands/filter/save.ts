// filter.save (SR-070 AK1): saves a filter with its name as a YAML file in the repository, in the
// filters folder of the workspace file (query/saved.ts), so everyone who opens the repository has it
// (AK2) and every access calls it by name with the same elements (AK3).
//
// - The input is checked as a selection checks it: `where` is compiled (`compileWhere`, errors name
//   `where...`), `view` resolved, `sort` checked against the metamodel. The file gets element
//   references as UUIDs and choices by key (query/canonical.ts; product owner's note on #82).
// - A new name creates `<name part>.yaml` (`newFilterFile`); the folder is created when missing.
// - An existing name, ignoring case (spec-frage #363 option 1A), replaces that filter in its own file:
//   only the top-level keys whose value changed are rewritten, every other byte stays (ADR-0007,
//   `editYamlDocument`); a key the input leaves out (`description`, `view`, `sort`) is removed from
//   the file. Nothing changed: nothing is written and `files` is empty. The file must be unchanged
//   since it was read (`file.changed-on-disk`). A name only a faulty file holds is `file.faulty`.
// - Filters are not elements (D-056); nothing is ever deleted or renamed, and no status is touched.
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { createFolder, editYamlDocument, renderYamlDocument, writeFileAtomic } from "../../files/index.js";
import type { YamlKeyEdit } from "../../files/index.js";
import type { FilterFile, FilterSortKey } from "../../generated/types.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, shortIdState, workspacePath } from "../../model/index.js";
import type { QueryContext } from "../../query/index.js";
import {
  canonicalCondition,
  canonicalView,
  compileWhere,
  faultyFilter,
  findSavedFilter,
  newFilterFile,
  readSavedFilters,
  sortElements,
} from "../../query/index.js";
import { resolveView } from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/** The keys of a filter file, in the order a new file has them. */
const KEYS = ["logreq-filter", "name", "description", "view", "where", "sort"] as const;

/** A sort as compared: `order` absent is `asc`. */
const sortOf = (sort: readonly FilterSortKey[] | undefined): unknown =>
  sort?.map((key) => ({ ...key, order: key.order ?? "asc" }));

/** The edits that turn the file's data into `data`, one per changed key. */
const editsOf = (current: FilterFile, data: FilterFile): readonly YamlKeyEdit[] =>
  KEYS.flatMap((key): YamlKeyEdit[] => {
    const same =
      key === "sort"
        ? isDeepStrictEqual(sortOf(current.sort), sortOf(data.sort))
        : isDeepStrictEqual(current[key], data[key]);
    if (same) {
      return [];
    }
    return data[key] === undefined ? [{ key }] : [{ key, value: data[key] }];
  });

export default defineCommand({
  name: "filter.save",
  run: async (ctx, input): Promise<CommandOutput<"filter.save">> => {
    const command = "filter.save";
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const store = await workspace.get(elementStoreState);
    const shortIds = await workspace.get(shortIdState);
    const base = { workspace, command, layout, metamodel, store, shortIds } as const;
    const view = input.view === undefined ? undefined : resolveView(base, input.view, command, "view", true);
    const context: QueryContext = { ...base, view };
    await compileWhere(context, input.where, "where");
    sortElements(context, [], input.sort ?? []);
    const data: FilterFile = {
      "logreq-filter": 1,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.view === undefined ? {} : { view: canonicalView(context, input.view, "view") }),
      where: canonicalCondition(context, input.where, "where"),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
    };
    const saved = await readSavedFilters(layout);
    const { repository } = saved;
    if (repository?.available !== true) {
      throw new CommandError(
        "file.folder-missing",
        `Not written: the filters folder is in repository ${saved.location.repository}, which is not available on this machine`,
        { repository: saved.location.repository },
      );
    }
    const found = findSavedFilter(saved, input.name);
    if (found.kind === "faulty") {
      throw faultyFilter(input.name, found.files, "saved again");
    }
    if (found.kind === "found") {
      const { filter } = found;
      const edits = editsOf(filter.data, data);
      if (edits.length === 0) {
        return { files: [], problems: [] };
      }
      const edited = editYamlDocument(filter.yaml, edits);
      await writeFileAtomic(repository.folder, filter.path, edited.bytes, filter.yaml.snapshot, {
        kind: "yaml",
      });
      return { files: [filter.file], problems: [] };
    }
    if (!saved.exists && saved.folder !== "") {
      await createFolder(repository.folder, saved.folder);
    }
    const file = path.posix.join(saved.folder, newFilterFile(input.name, saved.entries));
    await writeFileAtomic(repository.folder, file, renderYamlDocument(data), null, { kind: "yaml" });
    return { files: [workspacePath(layout, repository, file)], problems: [] };
  },
});
