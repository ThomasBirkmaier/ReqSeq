// Which entries of a baseline whose status is invalid now were superseded since it (SR-051 AK2, #2514): the status
// is not part of the version (ADR-0005), so it is read from the entry's file at the commit the baseline names for the
// repository of its copy (`filesAtCommit`, one pass per repository; Git is only read, D-036).
//
// - Superseded since: the file then holds a status that is not invalid (also none; the current metamodel's invalid
//   statuses, D-044), or no file held the element then. Already invalid then: not superseded since; `show.ts`
//   gives it the next state that holds (removed, changed, unchanged).
// - The status then cannot be read: the baseline names no commit for the repository or the repository does not have
//   it (`git.revision-missing`), or Git cannot tell, also for a file git does not have here (a partial clone,
//   `git.unavailable`). Then the entry counts as superseded, the rule before #2514, with one warning per repository
//   and reason naming how many entries it holds for.
// - Only the entries invalid now are asked. A file whose bytes now are the blob the commit holds at its path (one tree
//   listing, `DEFAULT_STATE_READER` as `uncommittedFiles` compares) had the status it has now, invalid, and is not
//   parsed; only the others are read and parsed with `filesAtCommit` (N-036: parsing costs about 0.4 ms per file,
//   `test/perf/baseline-superseded.test.ts`). The status at a commit does not change, so each workspace keeps the
//   answers read (a status, or no file held); a missing commit or a Git failure is asked again on the next call, so a
//   fetch is seen. An uncommitted status change at baseline time is not seen: the commit holds what was committed.
import type { Problem } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import path from "node:path";
import { DEFAULT_STATE_READER, filesAtCommit } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { Baseline } from "./read.js";

/** The status of an element file at a commit, or null when no file held the element then. */
type StatusThen = string | null;

/** Per workspace: the status then by repository folder, commit, file and UUID (see the file comment). */
const answers = new WeakMap<Workspace, Map<string, StatusThen>>();

const keyOf = (folder: string, commit: string, record: ElementRecord): string =>
  `${folder}\n${commit}\n${record.file}\n${record.id}`;

/** Work-tree files hashed at the same time; bounded so thousands of entries do not exhaust file handles. */
const HASH_CONCURRENCY = 64;

/**
 * Of `records` (in the repository of `folder`), those whose file now has the bytes of the blob `commit` holds at its
 * path; none when Git cannot list the commit (`filesAtCommit` then says why).
 */
const sameAsAt = async (
  folder: string,
  commit: string,
  records: readonly ElementRecord[],
): Promise<Set<ElementRecord>> => {
  const same = new Set<ElementRecord>();
  const listing = await DEFAULT_STATE_READER.blobs(
    folder,
    commit,
    records.map((r) => r.file),
  );
  if (!listing.known) {
    return same;
  }
  for (let start = 0; start < records.length; start += HASH_CONCURRENCY) {
    await Promise.all(
      records.slice(start, start + HASH_CONCURRENCY).map(async (record) => {
        const then = listing.ids.get(record.file);
        if (
          then !== undefined &&
          (await DEFAULT_STATE_READER.blobId(path.join(folder, ...record.file.split("/")), then.length)) ===
            then
        ) {
          same.add(record);
        }
      }),
    );
  }
  return same;
};

/** A warning of `baseline` that the status then of `count` entries of `repository` cannot be read. */
const unread = (
  baseline: Baseline,
  code: "git.revision-missing" | "git.unavailable",
  repository: string,
  count: number,
  why: string,
): Problem => ({
  code,
  severity: "warning",
  repository: baseline.repository,
  file: baseline.file,
  message: `${baseline.file}: ${why}, so the status of ${String(count)} ${count === 1 ? "element" : "elements"} of ${repository} at the baseline cannot be read; ${count === 1 ? "it counts" : "they count"} as superseded since the baseline`,
});

/**
 * Of `records` (copies of entries of `baseline` whose status is invalid now), those superseded since the baseline
 * (see the file comment). The warnings go into `problems`.
 */
export const supersededSince = async (
  workspace: Workspace,
  layout: Pick<WorkspaceLayout, "repositories">,
  baseline: Baseline,
  invalid: ReadonlyMap<string, unknown>,
  records: readonly ElementRecord[],
  problems: Problem[],
): Promise<ReadonlySet<ElementRecord>> => {
  const since = new Set<ElementRecord>();
  let known = answers.get(workspace);
  if (known === undefined) {
    known = new Map();
    answers.set(workspace, known);
  }
  for (const { name, folder } of layout.repositories) {
    const own = records.filter((r) => r.repository === name);
    if (own.length === 0) {
      continue;
    }
    const commit = baseline.data.repositories.find((r) => r.name === name)?.commit;
    if (commit === undefined) {
      own.forEach((r) => since.add(r));
      problems.push(
        unread(
          baseline,
          "git.revision-missing",
          name,
          own.length,
          `it names no commit for repository ${name}`,
        ),
      );
      continue;
    }
    const answer = (record: ElementRecord, status: StatusThen): void => {
      known.set(keyOf(folder, commit, record), status);
      if (status === null || !invalid.has(status)) {
        since.add(record);
      }
    };
    const unknown = own.filter((record) => {
      const status = known.get(keyOf(folder, commit, record));
      if (status !== undefined) {
        answer(record, status);
      }
      return status === undefined;
    });
    const same = unknown.length === 0 ? new Set<ElementRecord>() : await sameAsAt(folder, commit, unknown);
    same.forEach((record) => {
      answer(record, String(record.data["status"]));
    });
    const asked = unknown.filter((record) => !same.has(record));
    if (asked.length === 0) {
      continue;
    }
    const found = await filesAtCommit(
      folder,
      commit,
      asked.map((r) => ({ file: r.file, id: r.id })),
    );
    const short = commit.slice(0, 7);
    if (!found.known || found.kind === "no-commit") {
      asked.forEach((r) => since.add(r));
      problems.push(
        found.known
          ? unread(
              baseline,
              "git.revision-missing",
              name,
              asked.length,
              `repository ${name} has no commit ${short}`,
            )
          : unread(
              baseline,
              "git.unavailable",
              name,
              asked.length,
              `Git cannot read commit ${short} of ${name} (${found.detail})`,
            ),
      );
      continue;
    }
    const notHere = new Set(found.unread);
    for (const [index, record] of asked.entries()) {
      if (notHere.has(index)) {
        since.add(record);
        continue;
      }
      const file = found.files[index];
      answer(record, file === undefined ? null : String(file.data["status"]));
    }
    if (notHere.size > 0) {
      problems.push(
        unread(
          baseline,
          "git.unavailable",
          name,
          notHere.size,
          `Git does not have the files of commit ${short} of ${name} here (a partial clone)`,
        ),
      );
    }
  }
  return since;
};
