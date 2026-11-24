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
// - Only the entries invalid now are asked. A file whose bytes on disk are the ones its record was read from
//   (`snapshot`) and the blob the commit holds at its path (a tree listing and Git's blob ID, `gitBlobId`, as
//   `uncommittedFiles` compares) had the status it has now, invalid, and is not parsed; the others are read and parsed
//   with `filesAtCommit`, which lists the commit again (N-036: parsing costs about 0.4 ms per file,
//   `test/perf/baseline-superseded.test.ts`). "No file held it" is taken only while that listing works: with
//   `listFrom: 1` a blob git does not have is `unread`; where Git refuses the listing (a partial clone without trees)
//   an element not found counts as not readable too.
// - The status at a commit does not change, so each workspace keeps the answers read (a status, or no file held); a
//   missing commit, a Git failure or a file not here is asked again on the next call, so a fetch is seen. An
//   uncommitted status change at baseline time is not seen: the commit holds what was committed.
import type { Problem } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../files/index.js";
import { DEFAULT_STATE_READER, filesAtCommit, gitBlobId } from "../model/index.js";
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
 * Of `records` (in the repository of `folder`), those whose file on disk has the bytes of its record and of the blob
 * `commit` holds at its path; `listed` says whether Git listed the commit (see the file comment).
 */
const sameAsAt = async (
  folder: string,
  commit: string,
  records: readonly ElementRecord[],
): Promise<{ readonly same: ReadonlySet<ElementRecord>; readonly listed: boolean }> => {
  const same = new Set<ElementRecord>();
  const listing = await DEFAULT_STATE_READER.blobs(
    folder,
    commit,
    records.map((r) => r.file),
  );
  if (!listing.known) {
    return { same, listed: false };
  }
  for (let start = 0; start < records.length; start += HASH_CONCURRENCY) {
    await Promise.all(
      records.slice(start, start + HASH_CONCURRENCY).map(async (record) => {
        const then = listing.ids.get(record.file);
        // A file that cannot be read now is parsed at the commit instead.
        const bytes =
          then === undefined
            ? undefined
            : await fs.readFile(path.join(folder, ...record.file.split("/"))).catch(() => undefined);
        if (
          bytes !== undefined &&
          sha256(bytes) === record.snapshot.sha256 &&
          (await gitBlobId(bytes, bytes.length, String(then).length)) === then
        ) {
          same.add(record);
        }
      }),
    );
  }
  return { same, listed: true };
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

/** What `ofRepository` works with: the baseline, its invalid statuses, the answers kept, and where results go. */
interface Round {
  readonly baseline: Baseline;
  readonly invalid: ReadonlyMap<string, unknown>;
  readonly known: Map<string, StatusThen>;
  readonly since: Set<ElementRecord>;
  readonly problems: Problem[];
}

/** The entries `own` of repository `name` in `folder` at `commit`, the baseline's commit for it (see the file comment). */
const ofRepository = async (
  round: Round,
  { name, folder }: { readonly name: string; readonly folder: string },
  commit: string,
  own: readonly ElementRecord[],
): Promise<void> => {
  const { baseline, invalid, known, since, problems } = round;
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
  if (unknown.length === 0) {
    return;
  }
  const { same, listed } = await sameAsAt(folder, commit, unknown);
  same.forEach((record) => {
    answer(record, String(record.data["status"]));
  });
  const asked = unknown.filter((record) => !same.has(record));
  if (asked.length === 0) {
    return;
  }
  const found = await filesAtCommit(
    folder,
    commit,
    asked.map((r) => ({ file: r.file, id: r.id })),
    { listFrom: 1 },
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
    return;
  }
  // Not readable: a blob git does not have, or no file found while Git refused the listing.
  const notHere = new Set(found.unread);
  for (const [index, record] of asked.entries()) {
    const file = found.files[index];
    if (notHere.has(index) || (file === undefined && !listed)) {
      notHere.add(index);
      since.add(record);
    } else {
      answer(record, file === undefined ? null : String(file.data["status"]));
    }
  }
  if (notHere.size > 0) {
    problems.push(
      unread(
        baseline,
        "git.unavailable",
        name,
        notHere.size,
        `Git does not have the files of commit ${short} of ${name} here (a partial clone, or Git refuses to list the commit)`,
      ),
    );
  }
};

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
  const round: Round = { baseline, invalid, known, since, problems };
  for (const repository of layout.repositories) {
    const own = records.filter((r) => r.repository === repository.name);
    if (own.length === 0) {
      continue;
    }
    const commit = baseline.data.repositories.find((r) => r.name === repository.name)?.commit;
    if (commit === undefined) {
      own.forEach((r) => since.add(r));
      problems.push(
        unread(
          baseline,
          "git.revision-missing",
          repository.name,
          own.length,
          `it names no commit for repository ${repository.name}`,
        ),
      );
    } else {
      await ofRepository(round, repository, commit, own);
    }
  }
  return since;
};
