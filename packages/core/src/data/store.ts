// The data of a state as a file (SR-062, D-008, D-025): `data.store` writes what `data.export` gives
// for the same selection to `<commit>.json` in a folder the caller names, for a pipeline that keeps
// one file per state and evaluates them with other tools (Grafana, DuckDB).
//
// - The commit is HEAD of the main repository, as the header of the file gives it, so the name and
//   the content never disagree (K1). Without one (no Git, no repository, no commit yet, Git refuses
//   or does not answer) nothing is written and no folder is created: `git.unavailable` as an error
//   problem (exit code 1, ADR-0009). The commit is checked first, so a pipeline without Git fails
//   before the export is built.
// - `<commit>-dirty.json` unless every available repository has a known commit and is known clean
//   (K2, `repositoryState`): uncommitted changes to the files the data is made of, in any repository.
//   A repository whose commit or `dirty` Git cannot tell gives a `git.unavailable` warning.
// - Where the file may go (K4, ADR-0002 rule 5), every check before any folder is created:
//   - inside an available repository of the workspace (by the real path; the deepest wins) the
//     safety rules of `refuseUnlisted` with `ignored: false`: no `.git` or `node_modules`, no link,
//     no nested repository, portable names, the spelling on disk; an ignored folder is fine, since a
//     data file is never walked. A missing folder is created. A link inside a repository whose real
//     path is in a repository is refused; one that leads out of every repository is judged as outside;
//   - outside every repository the folder must exist (`file.folder-missing`) and must not lie in a
//     `.git` folder (`refuseGit`);
//   - an existing file of the name is replaced only when it is a ReqSeq data file (`"reqseq-data": 2`;
//     above 64 MiB the frame of a data file, `jsonDataKind` of the files block, #277), under its
//     snapshot and the `json` guard, which checks the same way; anything else is `input.invalid` and
//     stays as it is.
// - The content is compact JSON with a line break, UTF-8 without BOM, `reqseq-data` first (K5). It is
//   written in chunks (`jsonChunks`), never as one string, which V8 cannot hold at N-036 (#277).
// - `files` is relative to the workspace root when the file lies in a repository, else absolute.
// - No status is read for writing or written (D-030), Git is only read (D-036), nothing is deleted
//   (D-045); the replaced file is a data file, never an element.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { FileSnapshot } from "../files/index.js";
import {
  createFolder,
  JSON_FULL_PARSE_BYTES,
  jsonChunks,
  jsonDataKind,
  readFileSnapshot,
  writeFileAtomic,
} from "../files/index.js";
import type { DataStoreOutput, ElementSelection } from "../generated/types.js";
import { refuseUnlisted, repositoryCommit } from "../model/index.js";
import type { Selected } from "../query/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { refuseGit, shownPath, workspaceLayoutState } from "../workspace/index.js";
import type { ExportOptions, ExportWithProblems } from "./export.js";
import { NO_COMMIT_TEXT, exportDataWithProblems } from "./export.js";

/** The name of the data file of `commit`: `<commit>.json`, `<commit>-dirty.json` when not clean. */
export const dataFileName = (commit: string, clean: boolean): string =>
  `${commit}${clean ? "" : "-dirty"}.json`;

/**
 * Whether `bytes` are a ReqSeq data file: UTF-8 JSON of an object with `"reqseq-data": 2`; above
 * `fullParseUpTo` bytes (default 64 MiB) the frame of a data file (`jsonDataKind` of the files block).
 */
export const isDataFile = (bytes: Uint8Array, fullParseUpTo: number = JSON_FULL_PARSE_BYTES): boolean =>
  jsonDataKind(bytes, fullParseUpTo) === "data";

/** The text of the file: compact JSON and a line break, in chunks. */
function* chunksWithNewline(data: unknown): Generator<string, void, undefined> {
  yield* jsonChunks(data, { indent: 0 });
  yield "\n";
}

/** How `storeData` reads what it does not get from the workspace (tests). */
export interface StoreOptions extends ExportOptions {
  /** Builds the data; default `exportDataWithProblems`. */
  readonly exportData?: typeof exportDataWithProblems;
  /** Up to this size an existing file is parsed whole (`isDataFile`); default 64 MiB. */
  readonly fullParseUpTo?: number;
}

/** Where the file goes (see the file comment). */
type Place =
  | {
      readonly kind: "inside";
      readonly repository: RepositoryLocation;
      /** The folder relative to the repository, `/`, `""` for its root. */
      readonly folder: string;
      /** Whether the folder must be created. */
      readonly missing: boolean;
    }
  | { readonly kind: "outside"; readonly folder: string };

const isInside = (folder: string, file: string): boolean => {
  const relative = path.relative(folder, file);
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..";
};

/** The available repository of `layout` whose folder holds the real path `real`; the deepest wins. */
const repositoryOf = (layout: WorkspaceLayout, real: string): RepositoryLocation | undefined =>
  layout.repositories
    .filter((r) => r.available && isInside(r.folder, real))
    .sort((a, b) => b.folder.length - a.folder.length)[0];

/** `absolute` relative to `folder` with `/` (`""` for the folder itself). */
const relativeTo = (folder: string, absolute: string): string =>
  path.relative(folder, absolute).split(path.sep).join("/");

/** `folder/name`, or `name` in the root (`""`). */
const joined = (folder: string, name: string): string => (folder === "" ? name : `${folder}/${name}`);

/** The code of a Node file system error. */
const codeOf = (error: unknown): string => String((error as NodeJS.ErrnoException).code);

/** `file.unreadable` (error) for the folder as given. */
const unreadable = (folder: string, code: string): Problem => ({
  code: "file.unreadable",
  severity: "error",
  file: folder,
  message: `Not stored: the folder ${folder} or a folder above it cannot be looked at (${code})`,
});

/**
 * Where `target` (absolute) lies, judged for every name in `names` (see the file comment), or the
 * problem that stops the call. Follows the path name by name, so that a link inside a repository is
 * judged where it is.
 */
const placeOf = async (
  layout: WorkspaceLayout,
  target: string,
  shown: string,
  names: readonly string[],
): Promise<Place | Problem> => {
  const { root } = path.parse(target);
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  let real = root;
  let found = 0;
  for (const part of parts) {
    const next = path.join(real, part);
    let resolved: string;
    try {
      resolved = await fs.realpath(next);
    } catch (error) {
      const code = codeOf(error);
      if (code === "ENOENT" || code === "ENOTDIR") {
        break;
      }
      return unreadable(shown, code);
    }
    const holder = repositoryOf(layout, real);
    if (resolved !== next && holder !== undefined && repositoryOf(layout, resolved) !== undefined) {
      // A link (or another spelling) inside a repository that leads into one: the safety rules judge it.
      for (const name of names) {
        await refuseUnlisted(layout, holder, joined(relativeTo(holder.folder, next), name), {
          ignored: false,
        });
      }
    }
    real = resolved;
    found += 1;
  }
  const rest = parts.slice(found);
  const repository = repositoryOf(layout, real);
  if (repository !== undefined) {
    const folder = [relativeTo(repository.folder, real), ...rest].filter(Boolean).join("/");
    let judged = folder;
    for (const name of names) {
      judged = path.posix.dirname(
        await refuseUnlisted(layout, repository, joined(folder, name), { ignored: false }),
      );
    }
    return { kind: "inside", repository, folder: judged === "." ? "" : judged, missing: rest.length > 0 };
  }
  const folder = rest.length === 0 && (await fs.stat(real)).isDirectory();
  if (!folder) {
    throw new CommandError(
      "file.folder-missing",
      `Not stored: the folder ${shown} does not exist; outside the repositories of the workspace ReqSeq creates no folders`,
      { folder: shown },
    );
  }
  refuseGit(real, path.join(target, String(names[0])));
  return { kind: "outside", folder: real };
};

/** The output without a commit of the main repository (K3): nothing written. */
const noCommit = (name: string, why: string): DataStoreOutput => ({
  files: [],
  problems: [
    {
      code: "git.unavailable",
      severity: "error",
      repository: name,
      message: `Not stored: the commit of the main repository ${name} is unknown (${why}); the file is named after it`,
    },
  ],
});

/** The snapshot an existing data file is replaced under, or null to create the file. */
const existingSnapshot = async (
  folder: string,
  name: string,
  fullParseUpTo: number,
): Promise<FileSnapshot | null> => {
  const read = await readFileSnapshot(folder, name);
  if (read.kind === "problem") {
    if (read.missing) {
      return null;
    }
    throw new CommandError("file.faulty", `Not stored: ${name} cannot be replaced: ${read.problem.message}`, {
      file: name,
    });
  }
  if (!isDataFile(read.bytes, fullParseUpTo)) {
    throw new CommandError(
      "input.invalid",
      `Not stored: ${name} is not a ReqSeq data file; ReqSeq replaces only its own data files`,
      { file: name, reason: "not-a-data-file" },
    );
  }
  return read.snapshot;
};

/** `data.store` (SR-062): the data of `selected` for `input.selection` into `input.folder` (see the file comment). */
export const storeData = async (
  workspace: Workspace,
  selected: Selected,
  input: { readonly folder: string; readonly selection?: ElementSelection },
  options: StoreOptions = {},
): Promise<DataStoreOutput> => {
  const layout = await workspace.get(workspaceLayoutState);
  // The repository that holds the workspace file is always there: its folder is the workspace root.
  const main = { name: layout.main, folder: layout.root };
  const head = await repositoryCommit(main);
  if (head.commit === undefined) {
    return noCommit(main.name, NO_COMMIT_TEXT[head.unknown]);
  }
  const target = path.resolve(workspace.root, input.folder);
  const place = await placeOf(layout, target, input.folder, [
    dataFileName(head.commit, true),
    dataFileName(head.commit, false),
  ]);
  if (!("kind" in place)) {
    return { files: [], problems: [place] };
  }
  const built: ExportWithProblems = await (options.exportData ?? exportDataWithProblems)(
    workspace,
    selected,
    input.selection,
    options,
  );
  const commit = built.data.repositories.find((r) => r.name === main.name)?.commit;
  if (commit === undefined) {
    return noCommit(main.name, "it was no longer known after the export");
  }
  const name = dataFileName(commit, built.clean);
  let folder: string;
  if (place.kind === "inside") {
    if (place.missing) {
      await createFolder(place.repository.folder, place.folder);
    }
    // Again on the final name: a link or a `.git` entry may have been put there meanwhile.
    const file = await refuseUnlisted(layout, place.repository, joined(place.folder, name), {
      ignored: false,
    });
    folder = path.join(place.repository.folder, ...path.posix.dirname(file).split("/"));
  } else {
    folder = place.folder;
  }
  const fullParseUpTo = options.fullParseUpTo ?? JSON_FULL_PARSE_BYTES;
  const snapshot = await existingSnapshot(folder, name, fullParseUpTo);
  // A function, so a second pass (no hard links) gets new chunks; never an array of all of them.
  await writeFileAtomic(folder, name, () => chunksWithNewline(built.data), snapshot, {
    kind: "json",
    fullParseUpTo,
  });
  const mainFolder = await fs.realpath(layout.root);
  return {
    files: [
      shownPath(layout, mainFolder, folder, path.join(place.kind === "inside" ? folder : target, name)),
    ],
    problems: [...built.problems],
  };
};
