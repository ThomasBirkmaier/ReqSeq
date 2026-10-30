// The newest baseline of a group of baselines (SR-103 AK4, ADR-0018 "Which baseline", "Reading"),
// for the hints of a variant since its newest baseline. Read-only.
//
// - Candidates: the `*.yaml` files of the baselines folder, as `readBaselines` lists them (no
//   `.yml`), each by its header (`baselineHeader`, the lines before `repositories:`) read from the
//   first `HEADER_BYTES` of the file. A file whose header is longer, or not in the layout ReqSeq
//   writes, is read in full (`readKeptFile`); a faulty one (also the workspace file in a folder at
//   the root) is no candidate.
// - `groupOf` names the group of a candidate (SR-103: the variant its selection names), or none.
// - The newest of a group: the latest `date` instant (date and time, spec question #403), at the same
//   instant the last in file order. Only that file is read in full; when it is no valid baseline, the
//   next newest is taken.
// - Cost (N-036): per file one `lstat` and at most `HEADER_BYTES` read, plus one full read per group.
//   Headers are kept by `changeStamp` (`baselineHeadersState`) and full reads in `baselineFilesState`,
//   so a running server reads a file again only when it changed.
import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { listFolderFiles } from "../files/index.js";
import { changeStamp, workspacePath } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { locate, settingLocation, workspaceLayoutState } from "../workspace/index.js";
import type { Baseline } from "./read.js";
import { BASELINE_FILE_EXTENSION, baselineFilesState, readKeptFile } from "./read.js";
import type { BaselineHeader } from "./scan.js";
import { baselineHeader } from "./scan.js";

/** Bytes read for a header; a header with `view` alone is a few hundred. */
export const HEADER_BYTES = 64 * 1024;

/** One baseline file by its header. */
export interface BaselineCandidate {
  /** Workspace name of the repository of the file. */
  readonly repository: string;
  /** The file relative to its repository, `/` as separator. */
  readonly file: string;
  readonly header: BaselineHeader;
}

/** A header as read, with the stamp of its file. */
interface KeptHeader {
  readonly stamp: string;
  readonly header: BaselineHeader | undefined;
}

/** The headers read in this workspace, by repository and file. Reset with the layout. */
export const baselineHeadersState = defineWorkspaceState(
  "baseline-headers",
  (): Map<string, KeptHeader> => new Map(),
  { dependsOn: [workspaceLayoutState] },
);

/** The first `HEADER_BYTES` of `absolute` as text, or undefined when it cannot be read. */
const prefixOf = async (absolute: string): Promise<string | undefined> => {
  const handle = await fs.open(absolute, "r").catch(() => undefined);
  if (handle === undefined) {
    return undefined;
  }
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return new TextDecoder().decode(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
};

/** What reading one file needs. */
interface Place {
  readonly workspace: Workspace;
  readonly repository: RepositoryLocation;
  readonly absolute: string;
  readonly file: string;
  readonly shown: string;
}

/** The valid baseline of the file of `place`, read in full, or undefined. */
const fullRead = async (place: Place): Promise<Baseline | undefined> => {
  const { workspace, repository, absolute, file, shown } = place;
  const kept = workspace.get(baselineFilesState);
  const read = await readKeptFile(repository, absolute, file, shown, kept, new Set());
  return read?.kind === "valid" ? read.baseline : undefined;
};

/** The header of the file of `place` (see the file comment), kept by its stamp in `kept`. */
const headerOf = async (place: Place, kept: Map<string, KeptHeader>): Promise<BaselineHeader | undefined> => {
  const readAt = Date.now();
  const stat: BigIntStats | undefined = await fs
    .lstat(place.absolute, { bigint: true })
    .catch(() => undefined);
  const stamp = stat === undefined ? undefined : changeStamp(stat, readAt);
  const key = `${place.repository.name}\n${place.file}`;
  const before = kept.get(key);
  if (stamp !== undefined && before?.stamp === stamp) {
    return before.header;
  }
  const prefix = await prefixOf(place.absolute);
  const header = (prefix === undefined ? undefined : baselineHeader(prefix)) ?? (await fullRead(place))?.data;
  if (stamp !== undefined) {
    kept.set(key, { stamp, header });
  }
  return header;
};

/** The newest baseline of each group `groupOf` names, by group (see the file comment). */
export const newestBaselines = async (
  workspace: Workspace,
  groupOf: (candidate: BaselineCandidate) => string | undefined,
): Promise<ReadonlyMap<string, Baseline>> => {
  const layout = await workspace.get(workspaceLayoutState);
  const { repository, folder: absolute } = locate(layout, settingLocation(layout, "baselines"));
  const newest = new Map<string, Baseline>();
  // A folder in a repository that is not here, one that is missing or cannot be read: no baseline.
  if (repository === undefined || absolute === undefined) {
    return newest;
  }
  const listing = await listFolderFiles(absolute);
  if (listing.kind !== "names") {
    return newest;
  }
  const folder = path.relative(repository.folder, absolute).split(path.sep).join("/");
  const kept = workspace.get(baselineHeadersState);
  const groups = new Map<string, { place: Place; at: number }[]>();
  for (const name of listing.names) {
    // The workspace file in a baselines folder at the root has no baseline header and is no candidate.
    if (!name.endsWith(BASELINE_FILE_EXTENSION)) {
      continue;
    }
    const file = path.posix.join(folder, name);
    const shown = workspacePath(layout, repository, file);
    const place: Place = { workspace, repository, absolute: path.join(absolute, name), file, shown };
    const header = await headerOf(place, kept);
    const group = header === undefined ? undefined : groupOf({ repository: repository.name, file, header });
    if (header !== undefined && group !== undefined) {
      const list = groups.get(group) ?? [];
      list.push({ place, at: Date.parse(header.date) });
      groups.set(group, list);
    }
  }
  for (const [group, candidates] of groups) {
    // Latest instant first; at the same instant the later file first (`listing.names` is sorted).
    const order = candidates.map((c, i) => ({ ...c, i })).sort((a, b) => b.at - a.at || b.i - a.i);
    for (const { place } of order) {
      const baseline = await fullRead(place);
      if (baseline !== undefined) {
        newest.set(group, baseline);
        break;
      }
    }
  }
  return newest;
};
