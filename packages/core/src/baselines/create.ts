// Creating a baseline file (SR-050, ADR-0018) for `baseline.create`, which resolves the selection and
// its stored form (commands/baseline/create.ts). Nothing is asked for: no reason, no approval (D-006).
//
// - Refused, in this order, and nothing is written: a valid baseline has the name, ignoring case and
//   Unicode normal form (`baseline.exists` with its file, AK6); the folder's repository is not here
//   (`file.folder-missing`); a selected element has no version (`file.faulty`); a repository
//   involved has no commit, with the reason in words (`NO_COMMIT_TEXT`), or Git cannot tell its
//   changes (`git.unavailable`, AK7); a file of the selection differs from HEAD or was never
//   committed (`baseline.uncommitted-changes`, AK2).
// - Involved (AK4): the repositories of the selected elements, the main repository and the
//   metamodel's, each once, in the order of the workspace file, with the HEAD commit.
// - Uncommitted (AK2), per repository with `uncommittedFiles`: the files of the selected elements,
//   the files they embed, the YAML files of the metamodel folder and the workspace file; no evidence
//   record, no other element. The message and `details.elements` name the elements whose file or
//   embedded file changed, `details.files` the other files.
// - The text and the file name are text.ts (`elements: []` for an empty selection, AK5); a file name
//   the folder has in any case or normal form gets `-2`, `-3`, … The file is created, never
//   replaced (`writeFileAtomic` with no snapshot), and never committed (D-036).
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { CommandOutput } from "../catalog.js";
import { createFolder, listFolderFiles, writeFileAtomic } from "../files/index.js";
import type { BaselineFile, BaselineStoredSelection } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import {
  clashKey,
  currentVersionsOf,
  elementStoreState,
  NO_COMMIT_TEXT,
  relativeIn,
  repositoryCommit,
  shortIdState,
  uncommittedFiles,
  workspacePath,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE, locate, workspaceLayoutState } from "../workspace/index.js";
import { BASELINE_FILE_EXTENSION, foldName, workspaceBaselines } from "./read.js";
import { baselineStem, baselineText } from "./text.js";

/** What `createBaseline` writes. */
export interface BaselineRequest {
  readonly name: string;
  /** The selection as the file stores it (canonical). */
  readonly selection: BaselineStoredSelection;
  /** The selected elements, in store order. */
  readonly elements: readonly ElementRecord[];
  /** The selection may miss elements of a repository that is not here (SR-006). */
  readonly incomplete: boolean;
  /** Where the metamodel lies: its repository, its folder as the workspace file names it, its files (relative, `/`). */
  readonly metamodel: {
    readonly repository: string;
    readonly path: string;
    readonly files: readonly string[];
  };
}

/** A file relative to its repository as `relativeIn` gives it: `/`, NFC, `""` for the folder itself. */
const relativeTo = (repository: RepositoryLocation, absolute: string): string =>
  path.relative(repository.folder, absolute).split(path.sep).join("/").normalize("NFC");

/** Writes `text` as a new file in `folder` (relative to `repository`), with the first free name; returns the file. */
const writeNew = async (
  repository: RepositoryLocation,
  folder: string,
  name: string,
  text: string,
): Promise<string> => {
  const listing = await listFolderFiles(path.join(repository.folder, folder));
  if (listing.kind === "missing") {
    await createFolder(repository.folder, folder);
  }
  const taken = new Set(listing.kind === "names" ? listing.entries.map(clashKey) : []);
  const stem = baselineStem(name);
  for (let n = 1; ; n++) {
    const file = path.posix.join(
      folder,
      `${stem}${n === 1 ? "" : `-${String(n)}`}${BASELINE_FILE_EXTENSION}`,
    );
    if (!taken.has(clashKey(path.posix.basename(file)))) {
      try {
        await writeFileAtomic(repository.folder, file, text, null, { kind: "yaml" });
        return file;
      } catch (error) {
        // A file that appeared since the folder was listed: take the next name.
        if (!(error instanceof CommandError && error.code === "file.changed-on-disk")) {
          throw error;
        }
      }
    }
  }
};

const gitUnavailable = (repository: string, why: string): CommandError =>
  new CommandError("git.unavailable", `Not created: repository ${repository} ${why}`, { repository });

/**
 * The repositories involved (AK4), each with its HEAD commit (AK7). Each is on this machine: the
 * selected elements are, the main repository is, and without the metamodel's the workspace is read-only.
 */
const commitsOf = async (
  layout: WorkspaceLayout,
  elements: readonly ElementRecord[],
): Promise<{ readonly repository: RepositoryLocation; readonly commit: string }[]> => {
  const names = new Set([layout.main, layout.metamodel.repository, ...elements.map((e) => e.repository)]);
  const involved = layout.repositories.filter((r) => names.has(r.name));
  return Promise.all(
    involved.map(async (repository) => {
      const head = await repositoryCommit(repository);
      if (head.commit === undefined) {
        throw gitUnavailable(
          repository.name,
          `has no commit (${NO_COMMIT_TEXT[head.unknown]}); put it under Git and commit, or check the folder`,
        );
      }
      return { repository, commit: head.commit };
    }),
  );
};

/** One file of a repository, as `details.files` names it. */
interface ChangedFile {
  readonly repository: string;
  readonly file: string;
}

/** What `changesIn` checks: the selected elements, the files they embed and the metamodel. */
interface Checked {
  readonly elements: readonly ElementRecord[];
  /** By repository: each embedded file (relative, NFC) with the elements that embed it. */
  readonly embeds: ReadonlyMap<string, ReadonlyMap<string, readonly ElementRecord[]>>;
  readonly metamodel: BaselineRequest["metamodel"];
}

/** The files of the selection in `repository` that differ from `commit` (AK2, see the file comment). */
const changesIn = async (
  repository: RepositoryLocation,
  commit: string,
  checked: Checked,
): Promise<{ readonly elements: ElementRecord[]; readonly files: ChangedFile[] }> => {
  const own = checked.elements.filter((e) => e.repository === repository.name);
  const embeds = checked.embeds.get(repository.name) ?? new Map<string, readonly ElementRecord[]>();
  // The metamodel folder relative to this repository as data.export takes it (`relativeIn`), or undefined.
  const folder = relativeIn(repository, checked.metamodel);
  const files = [
    ...(repository.main ? [WORKSPACE_FILE] : []),
    ...(folder === undefined ? [] : checked.metamodel.files),
    ...own.map((e) => e.file),
    ...embeds.keys(),
  ].map((file) => file.normalize("NFC"));
  const known = new Set(files);
  const counts = (file: string): boolean =>
    known.has(file.normalize("NFC")) ||
    (folder !== undefined &&
      /\.ya?ml$/i.test(file) &&
      path.posix.join(folder, path.posix.basename(file)) === file.normalize("NFC"));
  const found = await uncommittedFiles(repository.folder, commit, files, counts);
  if (!found.known) {
    throw gitUnavailable(repository.name, `cannot be read by Git (${found.reason})`);
  }
  const changed = new Set(found.files.map((file) => file.normalize("NFC")));
  const named = new Set(own.filter((e) => changed.has(e.file.normalize("NFC"))));
  for (const [file, by] of embeds) {
    if (changed.has(file)) {
      by.forEach((e) => named.add(e));
    }
  }
  const elementFiles = new Set(own.map((e) => e.file.normalize("NFC")));
  return {
    elements: own.filter((e) => named.has(e)),
    files: [...changed]
      .filter((file) => !elementFiles.has(file))
      .map((file) => ({ repository: repository.name, file })),
  };
};

/** `{ id, repository, file }` of each element, as the error details name them. */
const named = (elements: readonly ElementRecord[]): { id: string; repository: string; file: string }[] =>
  elements.map(({ id, repository, file }) => ({ id, repository, file }));

/** The entries of the selected elements and the files they embed (see `Checked`); `file.faulty` for one without version. */
const entriesOf = async (
  workspace: Workspace,
  elements: readonly ElementRecord[],
  home: string,
): Promise<{ readonly entries: BaselineFile["elements"][number][]; readonly embeds: Checked["embeds"] }> => {
  const store = await workspace.get(elementStoreState);
  const versions = await currentVersionsOf(workspace, elements);
  const entries: BaselineFile["elements"][number][] = [];
  const faulty: ElementRecord[] = [];
  const embeds = new Map<string, Map<string, ElementRecord[]>>();
  for (const [record, entry] of versions) {
    if (entry.kind !== "version") {
      faulty.push(record);
      continue;
    }
    // The repository is written outside the file's repository and for a UUID with copies in several (SR-088).
    const elsewhere =
      record.repository !== home ||
      store.byId.get(record.id)?.some((c) => c.repository !== record.repository) === true;
    entries.push({
      id: record.id,
      version: entry.version,
      ...(elsewhere ? { repository: record.repository } : {}),
    });
    const byFile = embeds.get(record.repository) ?? new Map<string, ElementRecord[]>();
    for (const image of entry.images.filter((i) => i.found !== "nested")) {
      const file = image.names.join("/").normalize("NFC");
      byFile.set(file, [...(byFile.get(file) ?? []), record]);
    }
    embeds.set(record.repository, byFile);
  }
  if (faulty.length > 0) {
    throw new CommandError(
      "file.faulty",
      `Not created: ${faulty.map((e) => e.file).join(", ")} give no version; workspace check names the problem`,
      { elements: named(faulty) },
    );
  }
  const key = (e: { readonly id: string; readonly repository?: string }): string =>
    `${e.id}\n${e.repository ?? ""}`;
  return { entries: entries.sort((x, y) => (key(x) < key(y) ? -1 : 1)), embeds };
};

/** Refuses with `baseline.uncommitted-changes` when a file of the selection differs from its commit (AK2). */
const refuseChanges = async (
  workspace: Workspace,
  commits: readonly { readonly repository: RepositoryLocation; readonly commit: string }[],
  checked: Checked,
): Promise<void> => {
  const changes = await Promise.all(commits.map(async (c) => changesIn(c.repository, c.commit, checked)));
  const elements = changes.flatMap((c) => c.elements);
  const files = changes.flatMap((c) => c.files);
  if (elements.length > 0 || files.length > 0) {
    const shortIds = await workspace.get(shortIdState);
    const shown = [...elements.map((e) => `${shortIds.of(e)} (${e.file})`), ...files.map((f) => f.file)];
    throw new CommandError(
      "baseline.uncommitted-changes",
      `Not created: not committed: ${shown.join(", ")}; commit them with Git or undo the changes, then create the baseline again`,
      { elements: named(elements), files },
    );
  }
};

/** Creates the baseline `request` in `workspace` (see the file comment). */
export const createBaseline = async (
  workspace: Workspace,
  request: BaselineRequest,
): Promise<CommandOutput<"baseline.create">> => {
  const layout = await workspace.get(workspaceLayoutState);
  const baselines = await workspaceBaselines(workspace);
  const existing = baselines.baselines.find((b) => foldName(b.name) === foldName(request.name));
  if (existing !== undefined) {
    throw new CommandError(
      "baseline.exists",
      `Not created: the baseline ${JSON.stringify(existing.name)} exists (${existing.file}); ReqSeq never replaces a baseline, so choose another name`,
      { file: existing.file, repository: existing.repository },
    );
  }
  const { repository, folder } = locate(layout, baselines.location);
  if (repository === undefined || folder === undefined) {
    throw new CommandError(
      "file.folder-missing",
      `Not created: the baselines folder is in repository ${baselines.location.repository}, which is not on this machine`,
      { repository: baselines.location.repository },
    );
  }
  const { entries, embeds } = await entriesOf(workspace, request.elements, repository.name);
  const commits = await commitsOf(layout, request.elements);
  await refuseChanges(workspace, commits, {
    elements: request.elements,
    embeds,
    metamodel: request.metamodel,
  });
  const date = `${new Date().toISOString().slice(0, 19)}Z`;
  const text = baselineText({
    "reqseq-baseline": 1,
    name: request.name,
    date,
    selection: request.selection,
    repositories: commits.map((c) => ({ name: c.repository.name, commit: c.commit })),
    elements: entries,
  });
  const file = await writeNew(repository, relativeTo(repository, folder), request.name, text);
  const shownFile = workspacePath(layout, repository, file);
  return {
    files: [shownFile],
    baseline: {
      name: request.name,
      file: shownFile,
      repository: repository.name,
      date,
      elements: entries.length,
    },
    ...(request.incomplete
      ? {
          problems: layout.problems.filter((p) => p.code === "workspace.repository-missing"),
          incomplete: true,
        }
      : {}),
  };
};
