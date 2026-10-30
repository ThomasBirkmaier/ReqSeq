// Creating a baseline file (SR-050, ADR-0018) for `baseline.create`, which resolves the selection and
// its stored form (commands/baseline/create.ts). Nothing is asked for: no reason, no approval (D-006).
//
// - Refused, in this order, and nothing is written: a valid baseline has the name, ignoring case and
//   Unicode normal form (`baseline.exists` with its file, AK6); the folder's repository is not here
//   (`file.folder-missing`); a selected element has no version (`file.faulty`); then the Git state
//   (state.ts): a repository involved without commit (`git.unavailable`, AK4, AK7), a file of the
//   selection not committed (`baseline.uncommitted-changes`, AK2).
// - The text and the file name are text.ts (`elements: []` for an empty selection, AK5), the write
//   write.ts: a new file under a free name, never replacing one, never committed (D-036).
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { CommandOutput } from "../catalog.js";
import type { BaselineFile, BaselineStoredSelection } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import { currentVersionsOf, elementStoreState, workspacePath } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { locate, workspaceLayoutState } from "../workspace/index.js";
import { foldName, workspaceBaselines } from "./read.js";
import { baselineText } from "./text.js";
import type { Checked } from "./state.js";
import { elementNames, involvedCommits, refuseUncommitted } from "./state.js";
import { writeNewBaseline } from "./write.js";

/** What `createBaseline` writes. */
export interface BaselineRequest {
  readonly name: string;
  /** The selection as the file stores it (canonical). */
  readonly selection: BaselineStoredSelection;
  /** The selected elements, in store order. */
  readonly elements: readonly ElementRecord[];
  /** The selection may miss elements of a repository that is not here (SR-006). */
  readonly incomplete: boolean;
  readonly metamodel: Checked["metamodel"];
}

/** A file relative to its repository as `relativeIn` gives it: `/`, NFC, `""` for the folder itself. */
const relativeTo = (repository: RepositoryLocation, absolute: string): string =>
  path.relative(repository.folder, absolute).split(path.sep).join("/").normalize("NFC");

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
      { elements: elementNames(faulty) },
    );
  }
  const key = (e: { readonly id: string; readonly repository?: string }): string =>
    `${e.id}\n${e.repository ?? ""}`;
  return { entries: entries.sort((x, y) => (key(x) < key(y) ? -1 : 1)), embeds };
};

/** Creates the baseline `request` in `workspace` (see the file comment). */
export const createBaseline = async (
  workspace: Workspace,
  request: BaselineRequest,
): Promise<CommandOutput<"baseline.create">> => {
  const layout = await workspace.get(workspaceLayoutState);
  const baselines = await workspaceBaselines(workspace);
  // A folder that cannot be listed hides the names taken there (SR-050 AK6).
  const unreadable = baselines.problems.find((p) => p.code === "file.unreadable");
  if (unreadable !== undefined) {
    throw new CommandError(
      "file.faulty",
      `Not created: ${unreadable.message}, so the names of its baselines are not known`,
      { repository: unreadable.repository, file: unreadable.file },
    );
  }
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
  const commits = await involvedCommits(layout, request.elements);
  await refuseUncommitted(workspace, commits, {
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
  const file = await writeNewBaseline(repository, relativeTo(repository, folder), request.name, text);
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
