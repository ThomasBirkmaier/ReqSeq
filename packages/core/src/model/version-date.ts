// The date of a version (D-013: shown instead of the hash; ADR-0005 "Version date"): the committer
// date of the newest commit that gave the element file, with the images its text embeds, that
// version while none of its parents had it. Read through the git reader (ADR-0006), never written
// (D-036).
//
// One walk per element file and HEAD reads the commits that changed the file or an image one of
// its texts embeds, and every merge (no history simplification, so the answer never depends on
// the other files of a call); a merge is evaluated where its sides do not all lead to the same
// evaluated commit (it may join the text of one side with an image of the other). Git is asked
// what the commits that changed the file's paths moved, and the walk follows each old path (#460):
// one `log` for all of them after each history read, never one `--follow` per file. Git is asked
// for the folders of these paths, which costs far less than one pathspec per file in a deep
// history; the paths of each walk are picked from its answer. A version is computed only where an answer
// needs it, newest commit first, until the newest commit that started the version asked for is
// certain; each text is read and parsed once. Walks, versions and answers are kept per workspace
// until HEAD of the repository moves or the metamodel or the layout is read again, so many
// relations to one target cost one walk. All files of one call share the git processes of their
// repository: one `log` (once more when an old text embeds an image the current one does not) and
// one `cat-file` for every object, whatever the number of commits or files. HEAD is read from the
// files of the Git folder (`headFiles`); `rev-parse` only where they cannot tell. A repository folder
// may lie below the top level of its Git work tree (ThomasBirkmaier/ReqSeq-archive#377); every path stays relative to the
// repository folder, the reader takes care of the prefix.
import { createHash } from "node:crypto";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { parseFileBytes } from "../files/index.js";
import type { GitUnknown, HeadFiles, HistoryCommit, ObjectInfo, ObjectReader } from "../git/reader.js";
import {
  commitBlobs,
  commitsBetween,
  fileHistory,
  firstParentChanges,
  fileMoves,
  headCommit,
  headFiles,
  historyRange,
  isGitPath,
  openObjectReader,
  workTreeOf,
} from "../git/reader.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { VersionFile, VersionForms } from "../version/version.js";
import { sameVersion } from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ImageLink, ImageSource } from "./images.js";
import { imageLinks, imageMemo, inNestedRepository } from "./images.js";
import { ignoredBy } from "./store.js";
import { isKnownVersion } from "./is-version.js";
import { elementVersions } from "./view.js";

/** One version whose date is asked for. */
export interface VersionDateRequest {
  /** Workspace name of the element's repository. */
  readonly repository: string;
  /** The element file, relative to its repository, with `/`. */
  readonly file: string;
  /** The element's UUID: a commit counts only where the file held this element. */
  readonly id: string;
  readonly version: string;
  /**
   * The element's text as it is now, when the caller has it: the images it embeds are then walked
   * from the start instead of after a first read of the history (one `git log` less).
   */
  readonly text?: string;
}

/** The commit that started a version (ADR-0005 "Version date"): its committer date and its object name. */
export interface VersionStart {
  /** Committer date in UTC, `YYYY-MM-DDTHH:MM:SSZ`. */
  readonly date: string;
  /** The full object name of the commit. */
  readonly commit: string;
}

/**
 * A version start with the values the element had in the newest commit that has that version: its
 * frontmatter there, such as the criterion keys of an older version (SR-028 AK5, D-072).
 */
interface Started extends VersionStart {
  readonly values: Readonly<Record<string, unknown>>;
}

/** What a walked file had at one commit: the version in both normal forms and the element's values. */
interface AtCommit {
  readonly forms: VersionForms;
  readonly values: Readonly<Record<string, unknown>>;
}

/** The workspace states a lookup works on. */
export interface VersionDateContext {
  readonly workspace: Workspace;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
}

/** One element file of a walk. */
interface Walked {
  readonly key: string;
  readonly file: string;
  readonly id: string;
  /**
   * The paths the file had, as Git stores them: `file` first, then each older path a commit moved
   * it from, as found. At a commit, the text is the first of them that holds the element.
   */
  readonly names: string[];
  /** NFC of the names and of every image path their texts read so far embed, relative to the repository. */
  readonly tracked: Set<string>;
}

/** A commit where a walked file is evaluated. */
interface Evaluated {
  readonly commit: HistoryCommit;
  /** For each parent, the evaluated commit whose version that parent has; null where it has none. */
  readonly parents: readonly (HistoryCommit | null)[];
}

/** One element file walked at one HEAD: where it is evaluated, and what is known so far. */
interface FileWalk {
  readonly walked: Walked;
  /**
   * Newest first (by committer date, then object name); replaced when the file's texts embed a new
   * image path.
   */
  evaluated: readonly Evaluated[];
  /**
   * The evaluated commit whose version HEAD has (the source of the commit git lists last, which no
   * other one names as a parent), by the parents, not by date: its object name, "" where no commit
   * has the file. Replaced with `evaluated`.
   */
  head: string;
  /**
   * The size of `walked.tracked` when the history `evaluated` comes from was read: where it grew
   * since, an image path a text added may have changed at a commit `evaluated` does not list yet.
   */
  evaluatedFor: number;
  /**
   * The version at each evaluated commit computed so far, in both normal forms; undefined where it
   * held no element or has none.
   */
  readonly versions: Map<string, AtCommit | undefined>;
  /** The answers so far, by version (see `Answer`). Emptied with `evaluated`. */
  readonly dates: Map<string, Answer>;
  /** Set when Git failed for a reason that does not pass: no more answers at this HEAD. */
  failed: boolean;
  /**
   * The evaluated commits whose version Git could not tell (`versionAt` gave `UNKNOWN`: a text or
   * image blob Git does not have, an image path it cannot take); `versions` holds undefined there.
   */
  readonly unknown: Set<string>;
  /**
   * The history reads and answer rounds that hold the walk: while one runs, `evaluated` may not fit
   * `walked` yet, so the walk is not carried to a new HEAD (`carryWalks`).
   */
  busy: number;
  /**
   * The newest history read of the walk, settled whatever it gave: a call that finds the walk's
   * tracked paths grown waits for it before it reads the history itself (`fitWalks`).
   */
  reading: Promise<void>;
}

/** The element at one text blob: its type, values and text, and the image links of that text. */
interface Held {
  readonly record: { readonly type: string; readonly data: Readonly<Record<string, unknown>> };
  readonly body: string;
  readonly links: readonly ImageLink[];
}

/** An object a commit has at a path: its ID and type (`blob` for a file or a link). */
type Entry = Pick<ObjectInfo, "id" | "type">;

/** What a repository's objects are: true at any HEAD, kept with its walks and carried to a new HEAD. */
interface Facts {
  /** Info by object name (`<commit>:<path>`); null where Git has no such object. */
  readonly infos: Map<string, Entry | null>;
  /** The element a walked file held at a blob of its text, by `<walk key>\n<path>\n<blob ID>`. */
  readonly held: Map<string, Held | undefined>;
  /** SHA-256 by blob ID; null for a blob Git did not have. */
  readonly hashes: Map<string, string | null>;
  /** Versions (both normal forms) by the element text and images they were computed from. */
  readonly versions: Map<string, VersionForms | undefined>;
  /** The commits whose moves were looked up. */
  readonly movesAsked: Set<string>;
  /** The keys of `held` (`heldKey`) whose text blob Git did not have (a partial clone). */
  readonly unreadable: Set<string>;
  /** The old paths of the files each of them moved, by NFC of the new path; where it moved any. */
  readonly moves: Map<string, Map<string, string[]>>;
}

/** The walks of one repository at one HEAD, by `walkKey`. */
interface RepositoryWalks {
  /** The stamp of `headFiles` before `head` was read; while it stays the same, so does HEAD. */
  readonly stamp: string | undefined;
  readonly head: string;
  readonly shallow: boolean;
  /** Undefined where Git cannot tell; `LATE` where git did not answer in time (the key is then removed). */
  readonly files: Map<string, Promise<FileWalk | typeof LATE | undefined>>;
  /** What each promise of `files` gave, once it did, so a call need not wait for it; removed with it. */
  readonly settled: Map<string, FileWalk | typeof LATE | undefined>;
  /** The walks of `files` as they are now, without waiting: what a new HEAD may carry. */
  readonly walked: Map<string, FileWalk>;
  /** True at any HEAD: kept when HEAD moves, so a new HEAD reads only the objects it adds. */
  readonly facts: Facts;
}

interface VersionDateCache {
  /** By repository folder; a new HEAD replaces the walks of the old one. */
  readonly repositories: Map<string, RepositoryWalks>;
  /** The HEAD move each repository folder is carrying its walks over, so concurrent calls share it. */
  readonly moving: Map<
    string,
    { readonly from: string; readonly to: string; readonly walks: Promise<RepositoryWalks> }
  >;
  /** Stops the git processes of running walks when the state goes (`close`, `reset`). */
  readonly stop: AbortController;
}

const versionDateState = defineWorkspaceState(
  "version-dates",
  (): VersionDateCache => ({ repositories: new Map(), moving: new Map(), stop: new AbortController() }),
  {
    // The version at a commit depends on the metamodel (content flags) and the `ignore` globs.
    dependsOn: [metamodelState, workspaceLayoutState],
    dispose: (cache) => {
      cache.stop.abort();
    },
  },
);

const walkKey = (file: string, id: string): string => `${file}\n${id}`;

/** A walk or an answer that git did not give in time: asked again by the next call. */
const LATE = "late";

/** Adds `value` to the list of `key`. */
const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
};

/** The path of an image link from the repository folder, as the text spells it. */
const imagePath = (link: ImageLink): string => link.names.join("/");

/**
 * The forms of `text` that Git may store for it: as written, NFC and NFD (of the whole path; a path
 * whose folders and file name Git stores in different forms is not found).
 */
const forms = (text: string): string[] => [...new Set([text, text.normalize("NFC"), text.normalize("NFD")])];

/**
 * What `log` is asked for to find the changes of `file`: its folder (ending in `/`, every file
 * below it), or the file itself at the top level.
 */
const pathspecOf = (file: string): string => file.slice(0, file.lastIndexOf("/") + 1) || file;

/** The object name of `file` at `commit`. */
const objectName = (commit: string, file: string): string => `${commit}:${file}`;

/** Thrown inside a walk when Git cannot tell. */
class Unknown extends Error {
  /** Whether asking again may help: git was stopped, timed out or is missing. */
  readonly transient: boolean;
  /** Whether git did not answer in time (or was stopped), rather than being missing. */
  readonly late: boolean;

  constructor(unknown: GitUnknown) {
    super(unknown.detail);
    this.late = unknown.reason === "timeout";
    this.transient = this.late || unknown.reason === "no-git";
  }
}

/** The element `id` in `bytes` of `file`, or undefined when the file did not hold it or did not parse. */
const heldElement = (
  file: string,
  id: string,
  bytes: Buffer,
  ignored: (relativePath: string) => boolean,
): Held | undefined => {
  const parsed = parseFileBytes(file, bytes);
  if (parsed.kind !== "parsed") {
    return undefined;
  }
  const data = parsed.content.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  const record = data as Readonly<Record<string, unknown>>;
  const type = record["type"];
  return record["id"] === id && typeof type === "string" && type !== ""
    ? {
        record: { type, data: record },
        body: parsed.content.body,
        links: imageLinks(file, parsed.content.body, ignored),
      }
    : undefined;
};

/** `commits` with every parent before its children (git's order is by date, which may be wrong). */
const parentsFirst = (commits: readonly HistoryCommit[]): HistoryCommit[] => {
  const listed = new Set(commits.map((c) => c.commit));
  const children = new Map<string, HistoryCommit[]>();
  const waiting = new Map<HistoryCommit, number>();
  for (const commit of commits) {
    const parents = commit.parents.filter((p) => listed.has(p));
    waiting.set(commit, parents.length);
    for (const parent of parents) {
      pushTo(children, parent, commit);
    }
  }
  const ready = commits.filter((c) => waiting.get(c) === 0);
  const order: HistoryCommit[] = [];
  for (let next = ready.pop(); next !== undefined; next = ready.pop()) {
    order.push(next);
    for (const child of children.get(next.commit) ?? []) {
      const left = Number(waiting.get(child)) - 1;
      waiting.set(child, left);
      if (left === 0) {
        ready.push(child);
      }
    }
  }
  return order;
};

/**
 * `list` newest first. Commits of one second are ordered by their ID, so the start found never
 * depends on the order git listed them in, which follows the other paths of a call (D-029).
 */
const newestFirst = (list: Evaluated[]): Evaluated[] => {
  const before = (a: HistoryCommit, b: HistoryCommit): boolean =>
    a.date === b.date ? a.commit < b.commit : a.date < b.date;
  return list.sort((a, b) => Number(before(a.commit, b.commit)) - Number(before(b.commit, a.commit)));
};

/**
 * The commits of `commits` (parents first, every merge listed) where the file is evaluated, newest
 * first, each with the evaluated commits whose versions its parents have. A commit is evaluated
 * where it is in `changing` (it changed a tracked path) or its parents do not all lead to the same
 * evaluated commit (a merge that may join the text of one side with an image of the other). Any
 * other commit has the tracked paths of the evaluated commit its parents lead to, so it is
 * skipped: a commit that changed only other paths, and a merge whose sides all lead to the same
 * evaluated commit. `head` is the evaluated commit HEAD's file comes from: the source of the tip of
 * `commits` (the one commit no other one names as a parent: every merge is listed, so the commits
 * left out between it and HEAD have one parent each), whatever the committer dates say.
 */

const evaluatedList = (
  commits: readonly HistoryCommit[],
  changing: ReadonlySet<HistoryCommit>,
): { readonly list: Evaluated[]; readonly head: string } => {
  const source = new Map<string, HistoryCommit | null>();
  const sourceOf = (commit: string): HistoryCommit | null => source.get(commit) ?? null;
  const list: Evaluated[] = [];
  for (const commit of commits) {
    const parents = commit.parents.map(sourceOf);
    const first = parents[0] ?? null;
    if (changing.has(commit) || parents.some((p) => p !== first)) {
      source.set(commit.commit, commit);
      list.push({ commit, parents });
    } else {
      source.set(commit.commit, first);
    }
  }
  const named = new Set(commits.flatMap((c) => c.parents));
  const tip = commits.find((c) => !named.has(c.commit));
  return {
    list: newestFirst(list),
    head: tip === undefined ? "" : (sourceOf(tip.commit)?.commit ?? ""),
  };
};

/**
 * Looks up the moves of `commits` not looked up yet (one `log`). Git that times out, was stopped or
 * is missing makes the walk unknown; any other failure (a partial clone without the blobs rename
 * detection compares) counts as no moves, so the file is not followed (ADR-0005 "Moves").
 */
const lookUpMoves = async (
  facts: Facts,
  folder: string,
  commits: readonly string[],
  signal: AbortSignal,
): Promise<void> => {
  const unasked = [...new Set(commits)].filter((c) => !facts.movesAsked.has(c));
  if (unasked.length === 0) {
    return;
  }
  const found = await fileMoves(folder, unasked, { signal });
  if (!found.known) {
    const unknown = new Unknown(found);
    if (unknown.transient) {
      throw unknown;
    }
  } else {
    for (const [commit, moves] of found.moves) {
      const byTarget = new Map<string, string[]>();
      for (const { from, to } of moves) {
        pushTo(byTarget, to.normalize("NFC"), from);
      }
      facts.moves.set(commit, byTarget);
    }
  }
  for (const commit of unasked) {
    facts.movesAsked.add(commit);
  }
};

/**
 * Adds to the names of `walk` the old path of each move of `commits` to one of them (the moves are
 * in `facts`); whether a name was added.
 */
const addOldNames = (walk: FileWalk, commits: readonly HistoryCommit[], facts: Facts): boolean => {
  const { names, tracked } = walk.walked;
  const known = new Set(names.map((n) => n.normalize("NFC")));
  const before = names.length;
  // Each commit's moves are found by the new path, so a commit that moved many files costs one
  // look-up per name, not one per move (N-036).
  for (const { commit } of commits) {
    const byTarget = facts.moves.get(commit);
    // A name added here may be the target of another move of the same commit.
    for (let i = 0; byTarget !== undefined && i < names.length; i++) {
      for (const from of byTarget.get(String(names[i]).normalize("NFC")) ?? []) {
        // A path git cannot take on a line is not followed.
        if (!known.has(from.normalize("NFC")) && isGitPath(from)) {
          names.push(from);
          known.add(from.normalize("NFC"));
          tracked.add(from.normalize("NFC"));
        }
      }
    }
  }
  return names.length > before;
};

/**
 * Reads the history of the files of `walks` (one `log` for all, every merge listed, so a walk gets
 * the same answer whatever other files share the call) and sets where each is evaluated: the
 * commits that changed its file or a tracked image path, and the merges whose sides do not all
 * lead to the same evaluated commit. Git is asked for the folders of the paths (`pathspecOf`): a
 * literal pathspec per file costs time per commit, folder entry and path, which grows to minutes
 * in a deep history with large folders; the folders cost about one pass. The changed paths of
 * each commit are matched to the tracked paths of each walk afterwards.
 *
 * Then the moves of every commit that changed a name of a file are looked up (one `log` for all);
 * a move to a name adds the old path, and the history of the walks that got one is read again,
 * until no name is added. So the names of a walk follow from the history alone, never from the
 * versions computed so far, and every call at the same HEAD gives the same answer (D-029).
 */
const readHistory = (
  repository: RepositoryWalks,
  folder: string,
  walks: readonly FileWalk[],
  signal: AbortSignal,
): Promise<void> => {
  const reading = readHistories(repository, folder, walks, signal);
  const settled = reading.then(
    () => undefined,
    () => undefined,
  );
  for (const walk of walks) {
    walk.reading = settled;
  }
  return reading;
};

/** `readHistory` without marking the walks. */
const readHistories = async (
  repository: RepositoryWalks,
  folder: string,
  walks: readonly FileWalk[],
  signal: AbortSignal,
): Promise<void> => {
  for (let open = walks; open.length > 0;) {
    // A path a call adds meanwhile is not read now (`evaluatedFor`).
    const sizes = open.map((w) => w.walked.tracked.size);
    const files = open.flatMap((w) => [...w.walked.tracked].flatMap(forms)).filter(isGitPath);
    const history = await fileHistory(folder, repository.head, [...new Set(files.map(pathspecOf))], {
      signal,
    });
    if (!history.known) {
      throw new Unknown(history);
    }
    const commits = parentsFirst(history.commits);
    const byPath = new Map<string, HistoryCommit[]>();
    for (const commit of commits) {
      for (const changed of commit.paths) {
        pushTo(byPath, changed.normalize("NFC"), commit);
      }
    }
    const changing = (paths: Iterable<string>): HistoryCommit[] => [
      ...new Set([...paths].flatMap((t) => byPath.get(t) ?? [])),
    ];
    const named = open.map((walk, i) => {
      const { list, head } = evaluatedList(commits, new Set(changing(walk.walked.tracked)));
      walk.evaluated = list;
      walk.head = head;
      walk.evaluatedFor = Number(sizes[i]);
      // The answers so far were found on the commits before; they are found again on these.
      walk.dates.clear();
      return { walk, commits: changing(walk.walked.names.map((n) => n.normalize("NFC"))) };
    });
    await lookUpMoves(
      repository.facts,
      folder,
      named.flatMap(({ commits: changed }) => changed.map((c) => c.commit)),
      signal,
    );
    open = named
      .filter(({ walk, commits: changed }) => addOldNames(walk, changed, repository.facts))
      .map(({ walk }) => walk);
  }
};

/**
 * What `walk` had at `commit` when that is `version`, compared in the form of `version` (ADR-0005
 * "Normal form 2"); undefined otherwise.
 */
const withVersion = (walk: FileWalk, commit: string, version: string): AtCommit | undefined => {
  const at = walk.versions.get(commit);
  return at !== undefined && sameVersion(version, at.forms) ? at : undefined;
};

/**
 * The answer for `version` from the versions computed so far: the start of the newest evaluated
 * commit that has it while none of its parents has, null when no commit has it; or, while that is
 * not certain, the commits whose versions it needs (newest first, about `chunk` of them). The version
 * HEAD's file has (`FileWalk.head`) is needed first, so every answer can say whether HEAD has it;
 * with `headFirst` (a sort, `sortAnswer`), alone, since no older one is needed where HEAD has another.
 */
const decide = (
  walk: FileWalk,
  version: string,
  chunk: number,
  headFirst: boolean,
): { readonly start: Started | null } | { readonly need: readonly string[] } => {
  const need: string[] = walk.head === "" || walk.versions.has(walk.head) ? [] : [walk.head];
  if (headFirst && need.length > 0) {
    return { need };
  }
  // The values of the newest commit with the version: every newer one is computed once a start counts.
  let newest: AtCommit | undefined;
  for (const { commit, parents } of walk.evaluated) {
    if (need.length >= chunk) {
      break;
    }
    if (!walk.versions.has(commit.commit)) {
      // HEAD's commit, while not computed, is in `need` already.
      if (commit.commit !== walk.head) {
        need.push(commit.commit);
      }
      continue;
    }
    const at = withVersion(walk, commit.commit, version);
    if (at === undefined) {
      continue;
    }
    newest ??= at;
    // A parent known to have the version is enough to tell this commit started none: the other
    // parents' versions are not needed for it (a merge from an older commit, SR-082 AK4).
    if (parents.some((p) => p !== null && withVersion(walk, p.commit, version) !== undefined)) {
      continue;
    }
    const unknown = parents.filter((p): p is HistoryCommit => p !== null && !walk.versions.has(p.commit));
    need.push(...unknown.map((p) => p.commit));
    // A start only counts when no newer commit is still open.
    if (need.length === 0) {
      return { start: { date: commit.date, commit: commit.commit, values: newest.values } };
    }
    // It is the start unless a newer open commit is: no older commit is needed for that (a merge or
    // an amend on top, whose own version is open, SR-082 AK4).
    if (unknown.length === 0) {
      break;
    }
  }
  return need.length === 0 ? { start: null } : { need };
};

/** One open question of a call; `headFirst` for a sort, which needs the start only where HEAD has the version. */
interface Query {
  readonly walk: FileWalk;
  readonly version: string;
  readonly headFirst: boolean;
}

/** What a call works with: its repository, its reader and what `inNestedRepository` said. */
interface Round {
  readonly context: VersionDateContext;
  readonly source: ImageSource;
  readonly walks: RepositoryWalks;
  readonly reader: ObjectReader;
  readonly signal: AbortSignal;
  readonly nested: Map<string, boolean>;
}

/**
 * From this many names at one commit, one tree listing of the commit (`commitBlobs`, #439) answers
 * them instead of the reader: a name costs `cat-file` about 0.08 ms, a listing of 50,000 files
 * about 30 ms (HEAD's commit after a merge or an amend, SR-082 AK4).
 */
const LISTED_FROM = 500;

/** Asks Git for the info of the names not known yet. */
const ask = async (round: Round, names: Iterable<string>): Promise<void> => {
  const { infos } = round.walks.facts;
  const unasked = [...new Set(names)].filter((n) => !infos.has(n));
  const byCommit = new Map<string, string[]>();
  for (const name of unasked) {
    pushTo(byCommit, name.slice(0, name.indexOf(":")), name);
  }
  const single: string[] = [];
  for (const [commit, listed] of byCommit) {
    if (listed.length < LISTED_FROM) {
      single.push(...listed);
      continue;
    }
    const paths = listed.map((name) => name.slice(commit.length + 1));
    const blobs = await commitBlobs(round.source.repository.folder, commit, paths, { signal: round.signal });
    if (!blobs.known && blobs.reason === "timeout") {
      throw new Unknown(blobs);
    }
    // What the listing has not (no entry, a folder, a submodule), and every name where Git refuses
    // the listing (a partial clone without trees), the reader answers as for few names.
    for (const [i, name] of listed.entries()) {
      const id = blobs.known ? blobs.ids.get(String(paths[i])) : undefined;
      if (id === undefined) {
        single.push(name);
      } else {
        infos.set(name, { id, type: "blob" });
      }
    }
  }
  const read = await round.reader.info(single);
  if (!read.known) {
    throw new Unknown(read);
  }
  for (const [i, name] of single.entries()) {
    infos.set(name, read.objects[i] ?? null);
  }
};

/**
 * The blob of the path with the forms `spellings` (as spelled first) at `commit`: as spelled, else
 * the only other form the tree has. A blob counts (a file or a symbolic link); anything else, or
 * no entry, is undefined.
 */
const blobAt = (facts: Facts, spellings: readonly string[], commit: string): Entry | undefined => {
  const [spelled = "", ...others] = spellings;
  const found = (form: string): Entry | null => facts.infos.get(objectName(commit, form)) ?? null;
  const alternatives = others.map(found).filter((info) => info !== null);
  const entry = found(spelled) ?? (alternatives.length === 1 ? alternatives[0] : undefined);
  return entry?.type === "blob" ? entry : undefined;
};

/** The key of what a walked file held at `name` in the blob `blob`. */
const heldKey = (walk: FileWalk, name: string, blob: Entry): string =>
  `${walk.walked.key}\n${name}\n${blob.id}`;

/** The text blobs of `walk` at `commit`: one for each of its names the commit has. */
const textsAt = (facts: Facts, walk: FileWalk, commit: string): { name: string; blob: Entry }[] =>
  walk.walked.names.flatMap((name) => {
    const blob = blobAt(facts, forms(name), commit);
    return blob === undefined ? [] : [{ name, blob }];
  });

/** The element `walk` held at `commit`: at the first of its names that holds it there, with that text blob. */
const heldAt = (
  facts: Facts,
  walk: FileWalk,
  commit: string,
): { name: string; blob: Entry; held: Held } | undefined => {
  for (const { name, blob } of textsAt(facts, walk, commit)) {
    const held = facts.held.get(heldKey(walk, name, blob));
    if (held !== undefined) {
      return { name, blob, held };
    }
  }
  return undefined;
};

/** Reads the objects `ids` and gives each one's bytes to its sink. */
const readAll = async (
  round: Round,
  ids: readonly string[],
  sinks: readonly ((chunk: Buffer) => void)[],
): Promise<readonly (ObjectInfo | null)[]> => {
  const read = await round.reader.read(ids, (_, i) => (chunk) => {
    sinks[i]?.(chunk);
  });
  if (!read.known) {
    throw new Unknown(read);
  }
  return read.objects;
};

/**
 * Tracks the image paths `held` embeds in `walk`. A new one leaves the walk's evaluated commits
 * not fitting its tracked paths until the history is read again (`fitWalks`).
 */
const trackImages = (walk: FileWalk, held: Held | undefined): void => {
  for (const link of held?.links.filter((l) => !l.missing) ?? []) {
    walk.walked.tracked.add(imagePath(link).normalize("NFC"));
  }
};

/** One text a round reads: a name of the file at a commit. */
interface TextAt {
  readonly walk: FileWalk;
  readonly commit: string;
  /** Index into the names of the walk. */
  readonly index: number;
}

/** The text blob of `text` and the key of what it held; undefined where the commit has none. */
const textOf = (
  facts: Facts,
  { walk, commit, index }: TextAt,
): { blob: Entry; key: string; name: string } | undefined => {
  const name = String(walk.walked.names[index]);
  const blob = blobAt(facts, forms(name), commit);
  return blob === undefined ? undefined : { blob, key: heldKey(walk, name, blob), name };
};

/**
 * Reads and parses the texts of the walked files at `at` that are not parsed yet (each blob once)
 * and tracks the image paths they embed. The names of a file are asked in turn, each only where no
 * name before it held the element, so a commit where the current path holds it costs one name (Git
 * finds a path in a large folder slowly).
 */
const readTexts = async (round: Round, at: readonly { walk: FileWalk; commit: string }[]): Promise<void> => {
  const { facts } = round.walks;
  for (let open: TextAt[] = at.map((a) => ({ ...a, index: 0 })); open.length > 0;) {
    await ask(
      round,
      open.flatMap((text) =>
        forms(String(text.walk.walked.names[text.index])).map((form) => objectName(text.commit, form)),
      ),
    );
    // Each blob is read once, and parsed once for each walk and name that has it.
    const unread = new Map<string, Map<string, { walk: FileWalk; name: string }>>();
    for (const text of open) {
      const found = textOf(facts, text);
      // A text parsed at an earlier HEAD (facts are kept) still tracks its images in this walk.
      if (found !== undefined && facts.held.has(found.key)) {
        trackImages(text.walk, facts.held.get(found.key));
      }
      if (found !== undefined && !facts.held.has(found.key)) {
        const holders = unread.get(found.blob.id) ?? new Map<string, { walk: FileWalk; name: string }>();
        unread.set(found.blob.id, holders.set(found.key, { walk: text.walk, name: found.name }));
      }
    }
    const texts = [...unread].map(([id, holders]) => ({ id, holders, chunks: [] as Buffer[] }));
    const objects = await readAll(
      round,
      texts.map((t) => t.id),
      texts.map((t) => (chunk) => t.chunks.push(chunk)),
    );
    for (const [index, { holders, chunks }] of texts.entries()) {
      const bytes = Buffer.concat(chunks);
      for (const [key, { walk, name }] of holders) {
        if (objects[index] === null) {
          facts.unreadable.add(key);
        }
        const held = heldElement(name, walk.walked.id, bytes, round.source.ignored);
        facts.held.set(key, held);
        trackImages(walk, held);
      }
    }
    open = open
      .filter((text) => {
        const found = textOf(facts, text);
        return (
          (found === undefined || facts.held.get(found.key) === undefined) &&
          text.index + 1 < text.walk.walked.names.length
        );
      })
      .map((text) => ({ ...text, index: text.index + 1 }));
  }
};

/** What an image is at a commit: its blob, missing, not counted (nested), or not readable. */
type ImageAt = Entry | "missing" | "nested" | "unknown";

/**
 * The images of the texts at `at` (ADR-0005 "Version date"), by `<path>\n<commit>`, with the
 * SHA-256 of every image blob in the facts (read as it streams). An image the working copy has
 * inside a nested repository now does not count, and one whose path Git cannot take is unknown.
 */
const readImages = async (
  round: Round,
  at: readonly { walk: FileWalk; commit: string }[],
): Promise<Map<string, ImageAt>> => {
  const { facts } = round.walks;
  const wanted = at.flatMap(({ walk, commit }) =>
    (heldAt(facts, walk, commit)?.held.links ?? [])
      .filter((l) => !l.missing)
      .map((link) => ({ link, commit })),
  );
  const memo = imageMemo();
  for (const { link } of wanted) {
    if (!round.nested.has(imagePath(link))) {
      round.nested.set(imagePath(link), await inNestedRepository(round.source, link.names, memo));
    }
  }
  const stateOf = ({ link, commit }: { link: ImageLink; commit: string }): ImageAt =>
    round.nested.get(imagePath(link)) === true
      ? "nested"
      : isGitPath(imagePath(link))
        ? (blobAt(facts, forms(imagePath(link)), commit) ?? "missing")
        : "unknown";
  await ask(
    round,
    wanted
      .filter((w) => round.nested.get(imagePath(w.link)) !== true && isGitPath(imagePath(w.link)))
      .flatMap(({ link, commit }) => forms(imagePath(link)).map((form) => objectName(commit, form))),
  );
  const images = new Map(wanted.map((w) => [`${imagePath(w.link)}\n${w.commit}`, stateOf(w)]));
  const unhashed = [
    ...new Set([...images.values()].filter((s) => typeof s === "object").map((s) => s.id)),
  ].filter((id) => !facts.hashes.has(id));
  const sums = unhashed.map(() => createHash("sha256"));
  const objects = await readAll(
    round,
    unhashed,
    sums.map((sum) => (chunk) => sum.update(chunk)),
  );
  // A blob that is gone meanwhile has no hash, so its versions have no date.
  for (const [i, id] of unhashed.entries()) {
    facts.hashes.set(id, objects[i] === null ? null : String(sums[i]?.digest("hex")));
  }
  return images;
};

/** A version Git could not tell (`versionAt`). */
const UNKNOWN = "unknown";

/**
 * The version of `walk` at `commit`: of the element its text held there, with the images as that
 * commit had them; undefined where it held no element or the version cannot be computed (`.inf`);
 * `UNKNOWN` where Git could not tell: a text blob it does not have and no other name holds the
 * element, or an image that is unknown.
 */
const versionAt = (
  round: Round,
  images: ReadonlyMap<string, ImageAt>,
  walk: FileWalk,
  commit: string,
): AtCommit | typeof UNKNOWN | undefined => {
  const { facts } = round.walks;
  const found = heldAt(facts, walk, commit);
  if (found === undefined) {
    return textsAt(facts, walk, commit).some(({ name, blob }) =>
      facts.unreadable.has(heldKey(walk, name, blob)),
    )
      ? UNKNOWN
      : undefined;
  }
  const { name, blob, held } = found;
  const files: VersionFile[] = [];
  for (const link of held.links) {
    const state = link.missing ? "missing" : images.get(`${imagePath(link)}\n${commit}`);
    if (state === "nested") {
      continue;
    }
    const hash = typeof state === "object" ? facts.hashes.get(state.id) : undefined;
    if (state !== "missing" && (hash === undefined || hash === null)) {
      return UNKNOWN;
    }
    files.push({ path: link.path, sha256: hash ?? null });
  }
  // Commits with the same text and images have the same version.
  const key = JSON.stringify([walk.walked.key, name, blob.id, files]);
  if (!facts.versions.has(key)) {
    try {
      facts.versions.set(key, elementVersions(held.record, held.body, round.context.metamodel, files));
    } catch {
      // A value the version cannot take (`.inf`); the element check reports it.
      facts.versions.set(key, undefined);
    }
  }
  const forms = facts.versions.get(key);
  return forms === undefined ? undefined : { forms, values: held.record.data };
};

/**
 * From this many walks open at one merge, one `log` of what the merge changed against its first
 * parent (`firstParentChanges`) answers them instead of reading their texts and images there: a
 * merge from an older commit, or an amend of a merge, is open for most files (SR-082 AK4). The git
 * process costs about what reading this many texts does.
 */
const MERGES_FROM = 100;

/** The evaluated commits of each list by object name, built once per list (lists are replaced, never changed). */
const evaluatedIndex = new WeakMap<readonly Evaluated[], ReadonlyMap<string, Evaluated>>();

/** The entry of `commit` in the evaluated commits of `walk`. */
const evaluatedAt = (walk: FileWalk, commit: string): Evaluated | undefined => {
  let index = evaluatedIndex.get(walk.evaluated);
  if (index === undefined) {
    index = new Map(walk.evaluated.map((e) => [e.commit.commit, e]));
    evaluatedIndex.set(walk.evaluated, index);
  }
  return index.get(commit);
};

/**
 * The source of `walk` on the first parent's side of the merge `commit` where its version can be
 * taken (see `firstParentVersions`), null where that side has no file, with the number of parents
 * the history gave the merge; undefined where it cannot be taken.
 */
const firstParentSource = (
  walk: FileWalk,
  commit: string,
): { readonly source: HistoryCommit | null; readonly parents: number } | undefined => {
  const entry = evaluatedAt(walk, commit);
  if (entry === undefined || entry.parents.length < 2 || walk.evaluatedFor !== walk.walked.tracked.size) {
    return undefined;
  }
  const source = entry.parents[0] ?? null;
  return source !== null && (!walk.versions.has(source.commit) || walk.unknown.has(source.commit))
    ? undefined
    : { source, parents: entry.parents.length };
};

/**
 * Sets the version of each walk of `at` at a merge that changed none of the walk's tracked paths
 * against its first parent: the version of the walk's source on that side, or none where that side
 * has no file. The merge has the same text and images there, so nothing is read. Only where the
 * walk's evaluated commits fit its tracked paths (`evaluatedFor`; else an image path a text added
 * may have changed between that source and the first parent) and the source's version is computed
 * and known, and only at a merge `MERGES_FROM` of them are open at. A copied version keeps what
 * `inNestedRepository` said where it was computed. Returns the rest of `at`, which is read. Git
 * that did not answer in time makes the call late; one that refuses (before 2.31) or fails leaves
 * every merge to be read.
 */
const firstParentVersions = async (
  round: Round,
  at: readonly { walk: FileWalk; commit: string }[],
): Promise<readonly { walk: FileWalk; commit: string }[]> => {
  const open = new Map<
    string,
    { item: { walk: FileWalk; commit: string }; source: HistoryCommit | null; parents: number }[]
  >();
  for (const item of at) {
    const found = firstParentSource(item.walk, item.commit);
    if (found !== undefined) {
      pushTo(open, item.commit, { item, ...found });
    }
  }
  const merges = [...open].filter(([, items]) => items.length >= MERGES_FROM);
  if (merges.length === 0) {
    return at;
  }
  const listed = await firstParentChanges(
    round.source.repository.folder,
    merges.map(([merge]) => merge),
    { signal: round.signal },
  );
  if (!listed.known) {
    if (listed.reason === "timeout") {
      throw new Unknown(listed);
    }
    return at;
  }
  const done = new Set<{ walk: FileWalk; commit: string }>();
  for (const [merge, items] of merges) {
    const changed = listed.changes.get(merge);
    // A merge git did not print is read.
    if (changed === undefined) {
      continue;
    }
    const paths = new Set(changed.paths.map((p) => p.normalize("NFC")));
    for (const { item, source, parents } of items) {
      const { tracked } = item.walk.walked;
      // Where the history dropped a parent (`--parents` rewrites them), its first may be another one.
      if (parents === changed.parents.length && ![...tracked].some((p) => paths.has(p))) {
        item.walk.versions.set(merge, source === null ? undefined : item.walk.versions.get(source.commit));
        done.add(item);
      }
    }
  }
  return at.filter((item) => !done.has(item));
};

/** Whether the evaluated commits of `walk` were read for all its tracked paths (`evaluatedFor`). */
const fits = (walk: FileWalk): boolean => walk.evaluatedFor === walk.walked.tracked.size;

/**
 * Makes the evaluated commits of the walks of `queries` fit their tracked paths: where a text
 * embeds a new image path, a commit that changed only that image is not listed yet, so nothing is
 * decided on the walk before its history is read again (#2408). A read another call runs for the
 * walk is waited for, so the walk is read once; where its tracked paths grew again meanwhile, or that
 * read failed, the history is read here, unless another call started a newer read meanwhile, which
 * is waited for in turn.
 */
const fitWalks = async (round: Round, queries: readonly Query[]): Promise<void> => {
  for (let open = unfit(queries); open.length > 0; open = unfit(queries)) {
    const waited = open.map((walk) => walk.reading);
    await Promise.all(waited);
    const left = open.filter((walk, i) => !fits(walk) && walk.reading === waited[i]);
    if (left.length > 0) {
      await readHistory(round.walks, round.source.repository.folder, left, round.signal);
    }
  }
};

/** The walks of `queries` whose evaluated commits do not fit their tracked paths. */
const unfit = (queries: readonly Query[]): FileWalk[] => [
  ...new Set(queries.map((q) => q.walk).filter((walk) => !fits(walk))),
];

/**
 * Answers `queries` round by round: each round first reads the history again for files whose texts
 * embed a new image path (`fitWalks`), then computes the versions the open ones need (one
 * `cat-file` exchange for the texts, one for the images), twice as many as the round before.
 */
const answer = async (round: Round, queries: readonly Query[]): Promise<void> => {
  for (let chunk = 2; ; chunk *= 2) {
    await fitWalks(round, queries);
    const needs = new Map<FileWalk, Set<string>>();
    for (const { walk, version, headFirst } of queries.filter(isOpen)) {
      const decision = decide(walk, version, chunk, headFirst);
      if ("start" in decision) {
        walk.dates.set(version, answered(walk, version, decision.start));
      } else {
        needs.set(walk, new Set([...(needs.get(walk) ?? []), ...decision.need]));
      }
    }
    if (needs.size === 0) {
      return;
    }
    const at = await firstParentVersions(
      round,
      [...needs].flatMap(([walk, commits]) => [...commits].map((commit) => ({ walk, commit }))),
    );
    await readTexts(round, at);
    const images = await readImages(round, at);
    for (const { walk, commit } of at) {
      const at = versionAt(round, images, walk, commit);
      if (at === UNKNOWN) {
        walk.unknown.add(commit);
      }
      walk.versions.set(commit, at === UNKNOWN ? undefined : at);
    }
  }
};

/**
 * The walks of `folder` at its HEAD, or undefined when Git cannot tell (not a repository, no
 * commit, git missing) or the repository is a shallow clone; `LATE` when `rev-parse` did not answer
 * in time. HEAD is what `headFiles` names, and what `rev-parse` says where they cannot tell; the
 * walks stay while the stamp of `headFiles` does.
 */
const currentWalks = async (
  cache: VersionDateCache,
  folder: string,
): Promise<RepositoryWalks | typeof LATE | undefined> => {
  const files = await headFiles(folder);
  const known = cache.repositories.get(folder);
  const current =
    known !== undefined && files !== undefined && known.stamp === files.stamp
      ? known
      : await headWalks(cache, folder, files, known);
  return current === undefined || current === LATE || !current.shallow ? current : undefined;
};

/**
 * The walks at HEAD as `files` name it, or as `rev-parse` reads it; those of `known` stay at the
 * same commit.
 */
const headWalks = async (
  cache: VersionDateCache,
  folder: string,
  files: HeadFiles | undefined,
  known: RepositoryWalks | undefined,
): Promise<RepositoryWalks | typeof LATE | undefined> => {
  const head =
    files?.commit === undefined
      ? await headCommit(folder, { signal: cache.stop.signal })
      : ({ known: true, commit: files.commit, shallow: files.shallow } as const);
  if (!head.known) {
    return head.reason === "timeout" ? LATE : undefined;
  }
  if (known?.head === head.commit) {
    const current = { ...known, stamp: files?.stamp, shallow: head.shallow };
    cache.repositories.set(folder, current);
    return current;
  }
  const current: RepositoryWalks = {
    stamp: files?.stamp,
    head: head.commit,
    shallow: head.shallow,
    files: new Map(),
    settled: new Map(),
    walked: new Map(),
    // What objects are is true at any HEAD: a new HEAD reads only what it adds (SR-082 AK4).
    facts: known?.facts ?? noFacts(),
  };
  if (known === undefined || known.shallow || head.shallow) {
    cache.repositories.set(folder, current);
    return current;
  }
  return movedWalks(cache, folder, known, current);
};

/** Nothing known yet of a repository's objects. */
const noFacts = (): Facts => ({
  infos: new Map(),
  held: new Map(),
  hashes: new Map(),
  versions: new Map(),
  movesAsked: new Set(),
  unreadable: new Set(),
  moves: new Map(),
});

/** `current` once the walks of `known` are carried to it; one carry per folder and move. */
const movedWalks = async (
  cache: VersionDateCache,
  folder: string,
  known: RepositoryWalks,
  current: RepositoryWalks,
): Promise<RepositoryWalks> => {
  // One move per folder at a time: calls that see the same move wait for the same walks.
  const pending = cache.moving.get(folder);
  if (pending?.from === known.head && pending.to === current.head) {
    return pending.walks;
  }
  const walks = carryWalks(folder, known, current, cache.stop.signal)
    .then(() => {
      // A later move of the folder, taking the place meanwhile, keeps its own walks.
      if (cache.moving.get(folder)?.walks === walks) {
        cache.repositories.set(folder, current);
      }
      return current;
    })
    .finally(() => {
      // A later move of the folder may have taken the place meanwhile.
      if (cache.moving.get(folder)?.walks === walks) {
        cache.moving.delete(folder);
      }
    });
  cache.moving.set(folder, { from: known.head, to: current.head, walks });
  return walks;
};

/** A copy of `walk` that shares nothing it can change (a call at the old HEAD may still run). */
const copyWalk = (walk: FileWalk): FileWalk => ({
  walked: { ...walk.walked, names: [...walk.walked.names], tracked: new Set(walk.walked.tracked) },
  evaluated: walk.evaluated,
  head: walk.head,
  evaluatedFor: walk.evaluatedFor,
  versions: new Map(walk.versions),
  dates: new Map(walk.dates),
  failed: false,
  unknown: new Set(walk.unknown),
  busy: 0,
  reading: Promise.resolve(),
});

/** Where a HEAD move leaves the old history: what `carryWalk` needs of it. */
interface Move {
  readonly to: string;
  /** The commits of `to ^<old HEAD>`, parents first, with their real parents and their paths in NFC. */
  readonly range: readonly HistoryCommit[];
  /** The parents of the range outside it (all reachable from the old HEAD), or `to` for an empty range. */
  readonly boundary: readonly string[];
  /** For each boundary commit, the commits the old HEAD reaches and it does not (none for the old HEAD). */
  readonly between: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The source of each boundary commit of `move` for `walk` (see `carryWalk`). */
const boundarySources = (walk: FileWalk, move: Move): Map<string, HistoryCommit | null> => {
  const sources = new Map<string, HistoryCommit | null>();
  for (const x of move.boundary) {
    const not = move.between.get(x);
    if (not === undefined) {
      // The old HEAD reaches every evaluated commit: its source is HEAD's.
      sources.set(x, walk.evaluated.find((e) => e.commit.commit === walk.head)?.commit ?? null);
      continue;
    }
    const reached = walk.evaluated.filter((e) => !not.has(e.commit.commit));
    const named = new Set(reached.flatMap((e) => e.parents.flatMap((p) => (p === null ? [] : [p.commit]))));
    sources.set(x, reached.find((e) => !named.has(e.commit.commit))?.commit ?? null);
  }
  return sources;
};

/** The commits of the range where `walk` is evaluated, as `evaluatedList` finds them, with `sources` filled in. */
const rangeEvaluated = (
  walk: FileWalk,
  move: Move,
  sources: Map<string, HistoryCommit | null>,
): Evaluated[] => {
  const tracked = walk.walked.tracked;
  const added: Evaluated[] = [];
  for (const commit of move.range) {
    const parents = commit.parents.map((p) => sources.get(p) ?? null);
    const first = parents[0] ?? null;
    if (commit.paths.some((p) => tracked.has(p)) || parents.some((p) => p !== first)) {
      sources.set(commit.commit, commit);
      added.push({ commit, parents });
    } else {
      sources.set(commit.commit, first);
    }
  }
  return added;
};

/**
 * `walk` (a copy, `copyWalk`) at the HEAD `move.to`, from what it found at the old HEAD; undefined
 * where it has an old name and HEAD no longer reaches some of its evaluated commits (the move that
 * gave the name may be one of them). Of the commits `from` reaches, an evaluated one is reachable from a boundary commit
 * X exactly when it is not in `between` of X; one no boundary commit reaches is not reachable from
 * `to`, and leaves the list. Whether a commit is evaluated depends only on its ancestors, so the
 * others stay as they are. The source of X (the evaluated commit whose version X has) is the one
 * evaluated commit X reaches that no other one it reaches has as a parent source: every evaluated
 * commit a commit reaches is reached through its source (a merge whose sides lead to different
 * ones is evaluated itself), so there is exactly one, or none where X has no version. Then the range is evaluated as
 * `evaluatedList` does, from the sources of its parents.
 */
const carryWalk = (walk: FileWalk, move: Move): FileWalk | undefined => {
  const none: ReadonlySet<string> = new Set();
  const outside = (commit: string): boolean =>
    move.boundary.every((x) => (move.between.get(x) ?? none).has(commit));
  const sources = boundarySources(walk, move);
  const added = rangeEvaluated(walk, move, sources);
  const kept = walk.evaluated.filter((e) => !outside(e.commit.commit));
  const head = sources.get(move.to)?.commit ?? "";
  if (walk.walked.names.length > 1 && kept.length < walk.evaluated.length) {
    // An old name may come from a move HEAD no longer reaches: the history tells again.
    return undefined;
  }
  if (added.length > 0 || kept.length < walk.evaluated.length || head !== walk.head) {
    walk.evaluated = newestFirst([...added, ...kept]);
    walk.head = head;
    // The answers were found on the commits before; they are found again on these. Where no
    // commit came or went, HEAD's source stays too, and so do they.
    walk.dates.clear();
    for (const commit of walk.unknown) {
      if (outside(commit)) {
        walk.unknown.delete(commit);
      }
    }
  }
  return walk;
};

/**
 * Carries the settled walks of `known` to `current` after HEAD moved (SR-082 AK4), with one range
 * `log` for their folders and one list per boundary commit other than the old HEAD. A walk still
 * read or answered, one Git refused, one whose names a move in the range adds to or that has an
 * old name and lost evaluated commits, and every walk where the range or a list has more than
 * `RANGE_LIMIT` commits or Git cannot tell now (it refuses, did not answer in time or is missing)
 * is walked again.
 */
const carryWalks = async (
  folder: string,
  known: RepositoryWalks,
  current: RepositoryWalks,
  signal: AbortSignal,
): Promise<void> => {
  // A copy now, before any await: the old walks may change meanwhile.
  const settled = [...known.walked.values()]
    .filter((w) => w.busy === 0 && !w.failed && known.files.has(w.walked.key))
    .map(copyWalk);
  const paths = [
    ...new Set(
      settled
        .flatMap((w) => [...w.walked.tracked].flatMap(forms))
        .filter(isGitPath)
        .map(pathspecOf),
    ),
  ];
  const range =
    paths.length === 0 ? undefined : await historyRange(folder, known.head, current.head, paths, { signal });
  if (range === undefined || !range.known || range.more) {
    return;
  }
  // In NFC once, as the tracked paths are, not once per walk.
  const commits = parentsFirst(range.commits).map((c) => ({
    ...c,
    paths: c.paths.map((p) => p.normalize("NFC")),
  }));
  const changing = commits.filter((c) => c.paths.length > 0);
  const listed = new Set(commits.map((c) => c.commit));
  const boundary =
    commits.length === 0
      ? [current.head]
      : [...new Set(commits.flatMap((c) => c.parents.filter((p) => !listed.has(p))))];
  const between = new Map<string, ReadonlySet<string>>();
  for (const x of boundary.filter((b) => b !== known.head)) {
    const list = await commitsBetween(folder, known.head, x, { signal });
    if (!list.known || list.more) {
      return;
    }
    between.set(x, new Set(list.commits));
  }
  const move: Move = { to: current.head, range: commits, boundary, between };
  const carried = settled.flatMap((walk) => {
    const copy = carryWalk(walk, move);
    return copy === undefined ? [] : [copy];
  });
  // A move in the range to a name of a file adds the old path: that walk reads its history again.
  const renamed = (walk: FileWalk): HistoryCommit[] => {
    const names = new Set(walk.walked.names.map((n) => n.normalize("NFC")));
    return changing.filter((c) => c.paths.some((p) => names.has(p)));
  };
  // Git that cannot tell now (late, or missing): nothing is carried; anything else is a programming error.
  try {
    await lookUpMoves(
      current.facts,
      folder,
      carried.flatMap((w) => renamed(w).map((c) => c.commit)),
      signal,
    );
  } catch (error) {
    if (error instanceof Unknown) {
      return;
    }
    throw error;
  }
  for (const walk of carried) {
    if (!addOldNames(walk, renamed(walk), current.facts)) {
      putSettled(current, walk.walked.key, walk);
      current.walked.set(walk.walked.key, walk);
    }
  }
  return undefined;
};

/** The requests of each repository, by workspace name. */
const byRepository = <T extends { readonly repository: string }>(
  requests: readonly T[],
): Map<string, T[]> => {
  const grouped = new Map<string, T[]>();
  for (const request of requests) {
    pushTo(grouped, request.repository, request);
  }
  return grouped;
};

/**
 * The repository `name` of the workspace with its walks at HEAD; undefined where Git cannot tell,
 * `LATE` where it did not answer in time.
 */
const repositoryWalks = async (
  context: VersionDateContext,
  cache: VersionDateCache,
  name: string,
): Promise<{ readonly source: ImageSource; readonly walks: RepositoryWalks } | typeof LATE | undefined> => {
  const repository = context.layout.repositories.find((r) => r.name === name);
  // Without a `.git` entry in the folder or above it, the folder is in no repository and no git starts.
  if (
    repository === undefined ||
    !repository.available ||
    (await workTreeOf(repository.folder)) === undefined
  ) {
    return undefined;
  }
  const walks = await currentWalks(cache, repository.folder);
  return walks === undefined || walks === LATE
    ? walks
    : { source: { repository, ignored: ignoredBy(context.layout) }, walks };
};

/**
 * Why the versions of a repository can have no date, as a message names it once (#252): `no-git` when
 * Git cannot read it (not on this machine, no `.git` entry, no commit, or git missing or refusing where
 * HEAD must be asked of git), `shallow` for a shallow clone (it never gives dates), else `unknown` (the
 * content is not committed, or a git call failed or timed out: the dates do not tell which). Only asked
 * for a repository that has a version without date.
 */
export type UndatedCause = "no-git" | "shallow" | "unknown";

export const undatedCause = async (
  context: Pick<VersionDateContext, "layout">,
  name: string,
): Promise<UndatedCause> => {
  const repository = context.layout.repositories.find((r) => r.name === name);
  if (
    repository === undefined ||
    !repository.available ||
    (await workTreeOf(repository.folder)) === undefined
  ) {
    return "no-git";
  }
  const files = await headFiles(repository.folder);
  const head =
    files?.commit === undefined
      ? await headCommit(repository.folder)
      : ({ known: true, shallow: files.shallow } as const);
  if (!head.known) {
    // A git call that timed out or was stopped tells nothing about the repository.
    return head.reason === "timeout" ? "unknown" : "no-git";
  }
  return head.shallow ? "shallow" : "unknown";
};

/**
 * The newest commit reachable from HEAD of the metamodel's repository that changed a file in the
 * metamodel folder, as `fileHistory` lists it (#252, P-2-09): a version at an older commit is
 * computed with today's metamodel, so a change of it can leave a stored version without date and
 * make the current one look older than it is. `null` when Git cannot tell (as `undatedCause`), the
 * folder is the repository itself, or no commit changed it.
 */
export const metamodelChange = async (
  context: Pick<VersionDateContext, "layout">,
): Promise<VersionStart | null> => {
  const { metamodel } = context.layout;
  const repository = context.layout.repositories.find((r) => r.name === metamodel.repository);
  const folder = path.posix.normalize(metamodel.path.replaceAll("\\", "/")).replace(/\/+$/, "");
  if (
    repository === undefined ||
    !repository.available ||
    folder === "." ||
    !isGitPath(folder) ||
    (await workTreeOf(repository.folder)) === undefined
  ) {
    return null;
  }
  const files = await headFiles(repository.folder);
  const head =
    files?.commit === undefined
      ? await headCommit(repository.folder)
      : ({ known: true, commit: files.commit, shallow: files.shallow } as const);
  if (!head.known || head.shallow) {
    return null;
  }
  const history = await fileHistory(repository.folder, head.commit, [`${folder}/`]);
  const change = history.known ? history.commits.find((c) => c.paths.length > 0) : undefined;
  return change === undefined ? null : { date: change.date, commit: change.commit };
};

/** Keeps `found` as the walk of `key`, and what it gives once it does (`RepositoryWalks.settled`). */
const putFile = (
  walks: RepositoryWalks,
  key: string,
  found: Promise<FileWalk | typeof LATE | undefined>,
): void => {
  walks.files.set(key, found);
  walks.settled.delete(key);
  found.then(
    (value) => {
      if (walks.files.get(key) === found) {
        walks.settled.set(key, value);
      }
    },
    // A programming error reaches the call that awaits the walk.
    () => undefined,
  );
};

/** Keeps `value` as the walk of `key`, given now. */
const putSettled = (walks: RepositoryWalks, key: string, value: FileWalk | undefined): void => {
  walks.files.set(key, Promise.resolve(value));
  walks.settled.set(key, value);
};

/** Forgets the walk of `key`: the next call starts it again. */
const dropFile = (walks: RepositoryWalks, key: string): void => {
  walks.files.delete(key);
  walks.settled.delete(key);
};

/** What a walk is started for: a request without the version, which only the answers need. */
export type VersionDateWalk = Omit<VersionDateRequest, "version">;

/**
 * Starts a walk for each file of `requests` not walked at this HEAD: one `log` for all of them.
 * The images the current text embeds are tracked from the start, so the history is read once.
 */
const startWalks = (
  { source, walks }: { readonly source: ImageSource; readonly walks: RepositoryWalks },
  signal: AbortSignal,
  requests: readonly VersionDateWalk[],
  keys: readonly string[] = requests.map((r) => walkKey(r.file, r.id)),
): void => {
  const fresh = new Map<string, FileWalk>();
  for (const [i, { file, id, text }] of requests.entries()) {
    const key = String(keys[i]);
    if (walks.files.has(key) || fresh.has(key)) {
      continue;
    }
    if (!isGitPath(file)) {
      // A path git cannot take on a line (a line break, a leading space) has no date.
      putSettled(walks, key, undefined);
      continue;
    }
    const seeds = imageLinks(file, text ?? "", source.ignored)
      .filter((l) => !l.missing)
      .map((l) => imagePath(l).normalize("NFC"));
    fresh.set(key, {
      walked: { key, file, id, names: [file], tracked: new Set([file.normalize("NFC"), ...seeds]) },
      evaluated: [],
      head: "",
      evaluatedFor: 0,
      versions: new Map(),
      dates: new Map(),
      failed: false,
      unknown: new Set(),
      busy: 1,
      reading: Promise.resolve(),
    });
  }
  if (fresh.size === 0) {
    return;
  }
  const running = readHistory(walks, source.repository.folder, [...fresh.values()], signal).then(
    () => {
      for (const walk of fresh.values()) {
        walk.busy -= 1;
      }
      return undefined;
    },
    (error: unknown) => {
      // What Git could not tell for a reason that may pass (a timeout, no git) is asked again next time.
      if (!(error instanceof Unknown) || error.transient) {
        for (const key of fresh.keys()) {
          dropFile(walks, key);
        }
      }
      if (error instanceof Unknown) {
        return error;
      }
      throw error;
    },
  );
  for (const [key, walk] of fresh) {
    const found = running.then((unknown) => (unknown === undefined ? walk : unknown.late ? LATE : undefined));
    // A programming error reaches the call that awaits the walk; it never goes unhandled meanwhile.
    found.catch(() => undefined);
    putFile(walks, key, found);
    walks.walked.set(key, walk);
  }
};

/**
 * Starts the walks that the dates of `requests` need and resolves once git runs, without waiting
 * for it: git reads the history while the caller computes the versions it then asks
 * `versionDates` for, which finds these walks. Never rejects.
 */
export const prepareVersionDates = async (
  context: VersionDateContext,
  requests: readonly VersionDateWalk[],
): Promise<void> => {
  const cache = context.workspace.get(versionDateState);
  for (const [name, list] of byRepository(requests)) {
    const found = await repositoryWalks(context, cache, name);
    if (found !== undefined && found !== LATE) {
      startWalks(found, cache.stop.signal, list);
    }
  }
};

/** What a lookup found for one request. */
type Found =
  /** The start of the version; `atHead` when the newest commit that changed the file has that version. */
  | { readonly start: Started; readonly atHead: boolean }
  /** Git answered: no commit has the version. */
  | "none"
  /** For a sort only (`sortAnswer`): HEAD's file has another version, or no commit has the file. */
  | "newer"
  /** Git cannot tell (see `versionStarts`). */
  | "undated"
  /** Git did not answer in time; the next call asks again. */
  | typeof LATE;

/** An answer a walk keeps for a version (`FileWalk.dates`): what `answered` found. */
type Answer = Exclude<Found, "newer" | typeof LATE>;

/**
 * The answer for `version` once its start is certain (`decide`): where Git could not tell a version,
 * no commit having it says nothing (SR-075: no time), and neither does a start where HEAD's
 * version is not known. Fixed once set: HEAD's version is computed before any answer counts, and a
 * null start means every evaluated commit was computed.
 */
const answered = (walk: FileWalk, version: string, start: Started | null): Answer => {
  if (start === null) {
    return walk.unknown.size > 0 ? "undated" : "none";
  }
  if (walk.unknown.has(walk.head)) {
    return "undated";
  }
  return { start, atHead: withVersion(walk, walk.head, version) !== undefined };
};

/**
 * What HEAD alone tells a sort of `version` (SR-075: content that differs from the last commit
 * counts as newer than every committed one): `newer` where HEAD's file has another version or no
 * commit has the file, whatever older commits Git could not tell; `undated` where Git could not tell
 * HEAD's version; undefined while it is not computed, where HEAD has the version, or where the
 * walk's evaluated commits do not fit its tracked paths (`evaluatedFor`).
 */
const byHead = (walk: FileWalk, version: string): "newer" | "undated" | undefined => {
  // A walk whose tracked paths grew without a new history read (a round cut short) tells nothing.
  if (walk.evaluatedFor !== walk.walked.tracked.size) {
    return undefined;
  }
  if (walk.head === "") {
    return "newer";
  }
  if (!walk.versions.has(walk.head)) {
    return undefined;
  }
  if (walk.unknown.has(walk.head)) {
    return "undated";
  }
  return withVersion(walk, walk.head, version) === undefined ? "newer" : undefined;
};

/**
 * What a sort reads of `walk` for `version`: the kept answer where HEAD has the version, else what
 * HEAD tells (`byHead`), the same whichever call came first; undefined while that is open. The
 * start of a version HEAD does not have is not needed, and nothing of this is kept, so
 * `versionStarts` still finds it.
 */
const sortAnswer = (walk: FileWalk, version: string): Found | undefined => {
  const kept = keptAnswer(walk, version);
  return kept === undefined ? byHead(walk, version) : sortKept(walk, kept);
};

/** What a sort reads of the answer `kept` of `walk` (see `sortAnswer`). */
const sortKept = (walk: FileWalk, kept: Answer): Found => {
  if (typeof kept === "object") {
    return kept.atHead ? kept : "newer";
  }
  return kept === "undated" && walk.unknown.has(walk.head) ? "undated" : "newer";
};

/**
 * The answer `walk` keeps for `version`; undefined where its evaluated commits do not fit its
 * tracked paths: a commit that changed a new image path may be missing (`fitWalks`).
 */
const keptAnswer = (walk: FileWalk, version: string): Answer | undefined =>
  fits(walk) ? walk.dates.get(version) : undefined;

/** Whether `query` still needs an answer round. */
const isOpen = ({ walk, version, headFirst }: Query): boolean =>
  (headFirst ? sortAnswer(walk, version) : keptAnswer(walk, version)) === undefined;

/** The walk of each of `keys`, without waiting where it is settled (`RepositoryWalks.settled`). */
const walksOf = async (
  walks: RepositoryWalks,
  keys: readonly string[],
): Promise<(FileWalk | typeof LATE | undefined)[]> => {
  const waits: Promise<void>[] = [];
  const found = keys.map((key, i) => {
    if (walks.settled.has(key)) {
      return walks.settled.get(key);
    }
    waits.push(
      Promise.resolve(walks.files.get(key)).then((walk) => {
        found[i] = walk;
      }),
    );
    return undefined;
  });
  await Promise.all(waits);
  return found;
};

/**
 * What `walk` answers for `version` without an answer round (with `headFirst`, for a sort:
 * `sortAnswer`), or undefined while it needs one.
 */
const answerNow = (
  walk: FileWalk | typeof LATE | undefined,
  version: string,
  headFirst: boolean,
): Found | undefined => {
  if (walk === LATE) {
    return LATE;
  }
  if (walk === undefined || walk.failed) {
    return "undated";
  }
  // Only a version of a known form is answered and kept.
  const kept = keptAnswer(walk, version);
  if (kept !== undefined) {
    return headFirst ? sortKept(walk, kept) : kept;
  }
  if (!isKnownVersion(version)) {
    return "undated";
  }
  return headFirst ? byHead(walk, version) : undefined;
};

/** What was found for each of `requests` in the repository `name`, in their order. */
const repositoryDates = async (
  context: VersionDateContext,
  cache: VersionDateCache,
  name: string,
  requests: readonly VersionDateRequest[],
  headFirst: boolean,
): Promise<Found[]> => {
  const found = await repositoryWalks(context, cache, name);
  if (found === undefined || found === LATE) {
    const all: Found = found ?? "undated";
    return requests.map(() => all);
  }
  const { source, walks } = found;
  const signal = cache.stop.signal;
  const round: Round = {
    context,
    source,
    walks,
    reader: openObjectReader(source.repository.folder, { signal }),
    signal,
    nested: new Map(),
  };
  try {
    const keys = requests.map((r) => walkKey(r.file, r.id));
    startWalks(found, signal, requests, keys);
    const files = await walksOf(walks, keys);
    // What is certain already is answered whatever happens to the rounds of the others.
    const answers = requests.map((r, i) => answerNow(files[i], r.version, headFirst));
    const queries: (Query & { readonly index: number })[] = [];
    for (const [index, { version }] of requests.entries()) {
      const walk = files[index];
      if (answers[index] === undefined && typeof walk === "object") {
        queries.push({ walk, version, headFirst, index });
      }
    }
    // Set by the round (a callback, so a variable would read as never set here).
    const cut = { late: false };
    const held = new Set(queries.map((q) => q.walk));
    for (const walk of held) {
      walk.busy += 1;
    }
    await answer(round, queries)
      .catch((error: unknown) => {
        // Git could not tell, or a folder of the working copy could not be listed (`file.faulty`).
        if (error instanceof Unknown && !error.transient) {
          for (const { walk } of queries) {
            walk.failed = true;
          }
        } else if (error instanceof Unknown || error instanceof CommandError) {
          // What may pass is asked again by the next call, from a new walk: this one may hold a
          // tracked path whose history was not read (ADR-0005 "No date").
          cut.late = error instanceof Unknown && error.late;
          for (const { walk } of queries) {
            dropFile(walks, walk.walked.key);
          }
        } else {
          // A programming error: the walks it held may be half updated, so none is kept.
          for (const { walk } of queries) {
            dropFile(walks, walk.walked.key);
          }
          throw error;
        }
      })
      // Only once the walks are marked or dropped: a carry may copy a walk no round holds.
      .finally(() => {
        for (const walk of held) {
          walk.busy -= 1;
        }
      });
    for (const { walk, version, index } of queries) {
      // A walk whose answer was cut short has no date for the version.
      const kept = walk.failed
        ? "undated"
        : headFirst
          ? sortAnswer(walk, version)
          : keptAnswer(walk, version);
      answers[index] = kept ?? (cut.late ? LATE : "undated");
    }
    // Every request is answered now: before the round, or just above.
    return answers as Found[];
  } finally {
    round.reader.close();
  }
};

/** What was found for each request, in the order of `requests`. */
const foundFor = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
  headFirst = false,
): Promise<Found[]> => {
  const cache = context.workspace.get(versionDateState);
  const found: Found[] = [];
  const byName = new Map<string, { readonly asked: VersionDateRequest[]; readonly at: number[] }>();
  for (const [index, request] of requests.entries()) {
    const group = byName.get(request.repository) ?? { asked: [], at: [] };
    byName.set(request.repository, group);
    group.asked.push(request);
    group.at.push(index);
  }
  await Promise.all(
    [...byName].map(async ([name, { asked, at }]) => {
      for (const [i, answer] of (await repositoryDates(context, cache, name, asked, headFirst)).entries()) {
        found[Number(at[i])] = answer;
      }
    }),
  );
  return found;
};

/** `versionStarts` with the values at each start. */
const startsWithValues = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
): Promise<(Started | null)[]> =>
  (await foundFor(context, requests)).map((found) => (typeof found === "object" ? found.start : null));

/**
 * The start of each requested version (ADR-0005 "Version date"), in the order of `requests`: the
 * committer date in UTC (`YYYY-MM-DDTHH:MM:SSZ`) and the object name of the newest commit (of one
 * second, the one with the greatest object name) that started that version of
 * the element (the file held the element with that version there, its images as that commit had
 * them, and no parent of the commit had that version). `null` when no commit has that version
 * (uncommitted content, or a version Git never saw), when it is not of a normal form this tool
 * computes (n1, n2), or when Git
 * cannot tell: the repository is not on this machine or not a repository, git is missing or
 * refuses it, it has no commit, it is a shallow clone, or a git call failed or timed out (ADR-0006).
 * The answer waits for the walks; the same request gives the same answer at the same HEAD (D-029).
 */
export const versionStarts = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
): Promise<(VersionStart | null)[]> =>
  (await startsWithValues(context, requests)).map((start) =>
    start === null ? null : { date: start.date, commit: start.commit },
  );

/**
 * The values of the element in the newest commit that has each requested version, in the order of
 * `requests`: the frontmatter of the text that commit held, such as the acceptance criteria and
 * their keys of an older version (SR-028 AK5, D-072: a key added later in the same version counts);
 * `null` where `versionStarts` gives `null`.
 */
export const versionValues = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
): Promise<(Readonly<Record<string, unknown>> | null)[]> =>
  (await startsWithValues(context, requests)).map((start) => start?.values ?? null);

/**
 * The date of each requested version (`versionStarts`) and its values (`versionValues`) from one
 * lookup, in the order of `requests`; `null` where `versionStarts` gives `null`. For
 * `baseline.get`, which shows the date and counts the acceptance criteria of a baseline's version
 * (SR-031, SR-094).
 */
export const versionDatesAndValues = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
): Promise<({ readonly date: string; readonly values: Readonly<Record<string, unknown>> } | null)[]> =>
  (await startsWithValues(context, requests)).map((start) =>
    start === null ? null : { date: start.date, values: start.values },
  );

/** The date of each requested version: the date of its start (`versionStarts`), or `null`. */
export const versionDates = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
): Promise<(string | null)[]> => (await versionStarts(context, requests)).map((start) => start?.date ?? null);

/**
 * The time of each requested version as a sort by the version date reads it (SR-075), in the
 * order of `requests`: `dated` with the date of its start (`versionStarts`) when the newest commit
 * that changed the file has that version; `uncommitted` when that commit's version is known and
 * another (the content differs from the last commit, also when an older commit had it, and whatever
 * older commits Git could not tell) or no commit has the file; `late` when git did not answer in time
 * (asked again by the next call); `undated` for every other version without date (no Git, a shallow
 * clone, a version of no normal form, a failed git call, a version of HEAD's file Git could not
 * tell). Decided from HEAD first, whichever call came before (D-029).
 */
export type VersionTime =
  { readonly kind: "dated"; readonly date: string } | { readonly kind: "uncommitted" | "undated" | "late" };

export const versionTimes = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
): Promise<VersionTime[]> =>
  (await foundFor(context, requests, true)).map((found): VersionTime => {
    // A sort gets a start only where HEAD has the version (`sortAnswer`).
    if (typeof found === "object") {
      return { kind: "dated", date: found.start.date };
    }
    return { kind: found === "none" || found === "newer" ? "uncommitted" : found };
  });
