// `workspace.markOpened` (SR-250) records the workspace of the call in the list of recent workspaces
// (SR-131, `workspace/recent.ts`), and refuses when the list would lie inside a repository of that
// workspace (`XDG_CACHE_HOME` or `LOCALAPPDATA` pointed into a checkout): ReqSeq never writes into a
// working tree (ADR-0008, D-036), the same rule as for the cache folder of a copy (`usableCacheFolder`).
import { CommandError } from "../catalog.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { MarkRefusal, RecentWorkspace, RememberOptions } from "../workspace/recent.js";
import { markWorkspace, recentWorkspacesFolder } from "../workspace/recent.js";
import { insideRepository } from "./model-cache.js";

/**
 * The error of each refusal of `markWorkspace`, with its Node error as `cause` (kept inside the process);
 * the message names no absolute path (ADR-0009).
 */
const REFUSALS: Readonly<Record<MarkRefusal, (cause: unknown) => CommandError>> = {
  "root-not-held": (cause) =>
    new CommandError(
      "file.read-only",
      "Not marked: the list of recent workspaces cannot hold the root of this workspace: it is not absolute, or longer than 4096 characters with links resolved",
      { reason: "root-not-held" },
      { cause },
    ),
  locked: (cause) =>
    new CommandError(
      "file.changed-on-disk",
      "Not marked: another process is writing the list of recent workspaces; run the command again",
      { reason: "locked" },
      { cause },
    ),
  unreadable: (cause) =>
    new CommandError(
      "file.faulty",
      "Not marked: the list of recent workspaces cannot be read, or it is no list of ReqSeq; move the file recent-workspaces.json in the folder reqseq of the OS cache folder away",
      { reason: "unreadable" },
      { cause },
    ),
  unwritable: (cause) =>
    new CommandError(
      "file.read-only",
      "Not marked: the list of recent workspaces cannot be written; check the permissions of the folder reqseq in the OS cache folder",
      { reason: "unwritable" },
      { cause },
    ),
};

/**
 * Puts the root of `workspace` first in the list of recent workspaces, strictly (`markWorkspace`,
 * SR-250): resolves the new entry, or rejects with a `CommandError` and leaves the list as it was, also
 * when the folder of the list lies inside a repository of the workspace (`file.read-only`, D-036).
 */
export async function markOpenedWorkspace(
  workspace: Workspace,
  options: RememberOptions = {},
): Promise<RecentWorkspace> {
  const layout = await workspace.get(workspaceLayoutState);
  if (insideRepository(recentWorkspacesFolder(options.environment), layout)) {
    throw new CommandError(
      "file.read-only",
      "Not marked: the list of recent workspaces would lie inside a repository of this workspace, and ReqSeq never writes into a working tree; point XDG_CACHE_HOME or LOCALAPPDATA elsewhere",
      { reason: "inside-repository" },
    );
  }
  const outcome = await markWorkspace(workspace.root, options);
  if ("marked" in outcome) {
    return outcome.marked;
  }
  throw REFUSALS[outcome.refused](outcome.cause);
}
