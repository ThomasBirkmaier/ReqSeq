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
// may lie below the top level of its Git work tree (#377); every path stays relative to the
// repository folder, the reader takes care of the prefix.
import { createHash } from "node:crypto";
import { CommandError } from "../catalog.js";
import { parseFileBytes } from "../files/index.js";
import type { GitUnknown, HeadFiles, HistoryCommit, ObjectInfo, ObjectReader } from "../git/reader.js";
import {
  fileHistory,
  fileMoves,
  headCommit,
  headFiles,
  isGitPath,
  openObjectReader,
  workTreeOf,
} from "../git/reader.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { VersionFile } from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ImageLink, ImageSource } from "./images.js";
import { imageLinks, imageMemo, inNestedRepository } from "./images.js";
import { ignoredBy } from "./store.js";
import { elementVersion } from "./view.js";

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
  /** Newest first (by committer date); replaced when the file's texts embed a new image path. */
  evaluated: readonly Evaluated[];
  /** The version at each evaluated commit computed so far; undefined where it held no element or has none. */
  readonly versions: Map<string, string | undefined>;
  /** The answers so far, by version; null where no commit started it. */
  readonly dates: Map<string, string | null>;
  /** Set when Git failed for a reason that does not pass: no more answers at this HEAD. */
  failed: boolean;
}

/** The element at one text blob: its type, values and text, and the image links of that text. */
interface Held {
  readonly record: { readonly type: string; readonly data: Readonly<Record<string, unknown>> };
  readonly body: string;
  readonly links: readonly ImageLink[];
}

/** What a repository's objects are: true at any HEAD, kept with its walks. */
interface Facts {
  /** Info by object name (`<commit>:<path>`); null where Git has no such object. */
  readonly infos: Map<string, ObjectInfo | null>;
  /** The element a walked file held at a blob of its text, by `<walk key>\n<path>\n<blob ID>`. */
  readonly held: Map<string, Held | undefined>;
  /** SHA-256 by blob ID; null for a blob Git did not have. */
  readonly hashes: Map<string, string | null>;
  /** Versions by the element text and images they were computed from. */
  readonly versions: Map<string, string | undefined>;
  /** The commits whose moves were looked up. */
  readonly movesAsked: Set<string>;
  /** The old paths of the files each of them moved, by NFC of the new path; where it moved any. */
  readonly moves: Map<string, Map<string, string[]>>;
}

/** The walks of one repository at one HEAD, by `walkKey`. */
interface RepositoryWalks {
  /** The stamp of `headFiles` before `head` was read; while it stays the same, so does HEAD. */
  readonly stamp: string | undefined;
  readonly head: string;
  readonly shallow: boolean;
  /** Undefined where Git cannot tell. */
  readonly files: Map<string, Promise<FileWalk | undefined>>;
  readonly facts: Facts;
}

interface VersionDateCache {
  /** By repository folder; a new HEAD replaces the walks of the old one. */
  readonly repositories: Map<string, RepositoryWalks>;
  /** Stops the git processes of running walks when the state goes (`close`, `reset`). */
  readonly stop: AbortController;
}

const versionDateState = defineWorkspaceState(
  "version-dates",
  (): VersionDateCache => ({ repositories: new Map(), stop: new AbortController() }),
  {
    // The version at a commit depends on the metamodel (content flags) and the `ignore` globs.
    dependsOn: [metamodelState, workspaceLayoutState],
    dispose: (cache) => {
      cache.stop.abort();
    },
  },
);

const walkKey = (file: string, id: string): string => `${file}\n${id}`;

/** Only normal form 1 can be recomputed (ADR-0005). */
const N1 = /^n1:[0-9a-f]{16}$/;

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

  constructor(unknown: GitUnknown) {
    super(unknown.detail);
    this.transient = unknown.reason === "timeout" || unknown.reason === "no-git";
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
 * The commits of `commits` (parents first, every merge listed) where the file is evaluated, newest
 * first, each with the evaluated commits whose versions its parents have. A commit is evaluated
 * where it is in `changing` (it changed a tracked path) or its parents do not all lead to the same
 * evaluated commit (a merge that may join the text of one side with an image of the other). Any
 * other commit has the tracked paths of the evaluated commit its parents lead to, so it is
 * skipped: a commit that changed only other paths, and a merge whose sides all lead to the same
 * evaluated commit.
 */
const evaluatedList = (
  commits: readonly HistoryCommit[],
  changing: ReadonlySet<HistoryCommit>,
): Evaluated[] => {
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
  return list.sort((a, b) => Number(a.commit.date < b.commit.date) - Number(a.commit.date > b.commit.date));
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
const readHistory = async (
  repository: RepositoryWalks,
  folder: string,
  walks: readonly FileWalk[],
  signal: AbortSignal,
): Promise<void> => {
  for (let open = walks; open.length > 0;) {
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
    const named = open.map((walk) => {
      walk.evaluated = evaluatedList(commits, new Set(changing(walk.walked.tracked)));
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
 * The answer for `version` from the versions computed so far: the date of the newest evaluated
 * commit that has it while none of its parents has, null when no commit has it; or, while that is
 * not certain, the commits whose versions it needs (newest first, about `chunk` of them).
 */
const decide = (
  walk: FileWalk,
  version: string,
  chunk: number,
): { readonly date: string | null } | { readonly need: readonly string[] } => {
  const need: string[] = [];
  for (const { commit, parents } of walk.evaluated) {
    if (need.length >= chunk) {
      break;
    }
    if (!walk.versions.has(commit.commit)) {
      need.push(commit.commit);
      continue;
    }
    if (walk.versions.get(commit.commit) !== version) {
      continue;
    }
    const unknown = parents.filter((p): p is HistoryCommit => p !== null && !walk.versions.has(p.commit));
    need.push(...unknown.map((p) => p.commit));
    // A start only counts when no newer commit is still open.
    if (need.length === 0 && !parents.some((p) => p !== null && walk.versions.get(p.commit) === version)) {
      return { date: commit.date };
    }
  }
  return need.length === 0 ? { date: null } : { need };
};

/** One open question of a call. */
interface Query {
  readonly walk: FileWalk;
  readonly version: string;
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

/** Asks the reader for the info of the names not known yet. */
const ask = async (round: Round, names: Iterable<string>): Promise<void> => {
  const { infos } = round.walks.facts;
  const unasked = [...new Set(names)].filter((n) => !infos.has(n));
  const read = await round.reader.info(unasked);
  if (!read.known) {
    throw new Unknown(read);
  }
  for (const [i, name] of unasked.entries()) {
    infos.set(name, read.objects[i] ?? null);
  }
};

/**
 * The blob of the path with the forms `spellings` (as spelled first) at `commit`: as spelled, else
 * the only other form the tree has. A blob counts (a file or a symbolic link); anything else, or
 * no entry, is undefined.
 */
const blobAt = (facts: Facts, spellings: readonly string[], commit: string): ObjectInfo | undefined => {
  const [spelled = "", ...others] = spellings;
  const found = (form: string): ObjectInfo | null => facts.infos.get(objectName(commit, form)) ?? null;
  const alternatives = others.map(found).filter((info) => info !== null);
  const entry = found(spelled) ?? (alternatives.length === 1 ? alternatives[0] : undefined);
  return entry?.type === "blob" ? entry : undefined;
};

/** The key of what a walked file held at `name` in the blob `blob`. */
const heldKey = (walk: FileWalk, name: string, blob: ObjectInfo): string =>
  `${walk.walked.key}\n${name}\n${blob.id}`;

/** The text blobs of `walk` at `commit`: one for each of its names the commit has. */
const textsAt = (facts: Facts, walk: FileWalk, commit: string): { name: string; blob: ObjectInfo }[] =>
  walk.walked.names.flatMap((name) => {
    const blob = blobAt(facts, forms(name), commit);
    return blob === undefined ? [] : [{ name, blob }];
  });

/** The element `walk` held at `commit`: at the first of its names that holds it there, with that text blob. */
const heldAt = (
  facts: Facts,
  walk: FileWalk,
  commit: string,
): { name: string; blob: ObjectInfo; held: Held } | undefined => {
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

/** Tracks the image paths `held` embeds in `walk`; whether one was new. */
const trackImages = (walk: FileWalk, held: Held | undefined): boolean => {
  const before = walk.walked.tracked.size;
  for (const link of held?.links.filter((l) => !l.missing) ?? []) {
    walk.walked.tracked.add(imagePath(link).normalize("NFC"));
  }
  return walk.walked.tracked.size > before;
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
): { blob: ObjectInfo; key: string; name: string } | undefined => {
  const name = String(walk.walked.names[index]);
  const blob = blobAt(facts, forms(name), commit);
  return blob === undefined ? undefined : { blob, key: heldKey(walk, name, blob), name };
};

/**
 * Reads and parses the texts of the walked files at `at` that are not parsed yet (each blob once)
 * and tracks the image paths they embed; returns the walks whose tracked paths grew. The names of a
 * file are asked in turn, each only where no name before it held the element, so a commit where
 * the current path holds it costs one name (Git finds a path in a large folder slowly).
 */
const readTexts = async (
  round: Round,
  at: readonly { walk: FileWalk; commit: string }[],
): Promise<FileWalk[]> => {
  const { facts } = round.walks;
  const grown = new Set<FileWalk>();
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
      if (found !== undefined && !facts.held.has(found.key)) {
        const holders = unread.get(found.blob.id) ?? new Map<string, { walk: FileWalk; name: string }>();
        unread.set(found.blob.id, holders.set(found.key, { walk: text.walk, name: found.name }));
      }
    }
    const texts = [...unread].map(([id, holders]) => ({ id, holders, chunks: [] as Buffer[] }));
    await readAll(
      round,
      texts.map((t) => t.id),
      texts.map((t) => (chunk) => t.chunks.push(chunk)),
    );
    for (const { holders, chunks } of texts) {
      const bytes = Buffer.concat(chunks);
      for (const [key, { walk, name }] of holders) {
        const held = heldElement(name, walk.walked.id, bytes, round.source.ignored);
        facts.held.set(key, held);
        if (trackImages(walk, held)) {
          grown.add(walk);
        }
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
  return [...grown];
};

/** What an image is at a commit: its blob, missing, not counted (nested), or not readable. */
type ImageAt = ObjectInfo | "missing" | "nested" | "unknown";

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

/**
 * The version of `walk` at `commit`: of the element its text held there, with the images as that
 * commit had them; undefined where it held no element, an image is unknown or the version cannot
 * be computed.
 */
const versionAt = (
  round: Round,
  images: ReadonlyMap<string, ImageAt>,
  walk: FileWalk,
  commit: string,
): string | undefined => {
  const { facts } = round.walks;
  const found = heldAt(facts, walk, commit);
  if (found === undefined) {
    return undefined;
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
      return undefined;
    }
    files.push({ path: link.path, sha256: hash ?? null });
  }
  // Commits with the same text and images have the same version.
  const key = JSON.stringify([walk.walked.key, name, blob.id, files]);
  if (!facts.versions.has(key)) {
    try {
      facts.versions.set(key, elementVersion(held.record, held.body, round.context.metamodel, files));
    } catch {
      // A value the version cannot take (`.inf`); the element check reports it.
      facts.versions.set(key, undefined);
    }
  }
  return facts.versions.get(key);
};

/**
 * Answers `queries` round by round: each round computes the versions the open ones need (one
 * `cat-file` exchange for the texts, one for the images), twice as many as the round before, and
 * reads the history again for files whose texts embed a new image path.
 */
const answer = async (round: Round, queries: readonly Query[]): Promise<void> => {
  for (let chunk = 2; ; chunk *= 2) {
    const needs = new Map<FileWalk, Set<string>>();
    for (const { walk, version } of queries.filter((q) => !q.walk.dates.has(q.version))) {
      const decision = decide(walk, version, chunk);
      if ("date" in decision) {
        walk.dates.set(version, decision.date);
      } else {
        needs.set(walk, new Set([...(needs.get(walk) ?? []), ...decision.need]));
      }
    }
    if (needs.size === 0) {
      return;
    }
    const at = [...needs].flatMap(([walk, commits]) => [...commits].map((commit) => ({ walk, commit })));
    const grown = await readTexts(round, at);
    const images = await readImages(round, at);
    for (const { walk, commit } of at) {
      walk.versions.set(commit, versionAt(round, images, walk, commit));
    }
    if (grown.length > 0) {
      await readHistory(round.walks, round.source.repository.folder, grown, round.signal);
    }
  }
};

/**
 * The walks of `folder` at its HEAD, or undefined when Git cannot tell (not a repository, no
 * commit, git missing) or the repository is a shallow clone. HEAD is what `headFiles` names, and
 * what `rev-parse` says where they cannot tell; the walks stay while the stamp of `headFiles` does.
 */
const currentWalks = async (
  cache: VersionDateCache,
  folder: string,
): Promise<RepositoryWalks | undefined> => {
  const files = await headFiles(folder);
  const known = cache.repositories.get(folder);
  const current =
    known !== undefined && files !== undefined && known.stamp === files.stamp
      ? known
      : await headWalks(cache, folder, files, known);
  return current === undefined || current.shallow ? undefined : current;
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
): Promise<RepositoryWalks | undefined> => {
  const head =
    files?.commit === undefined
      ? await headCommit(folder, { signal: cache.stop.signal })
      : { known: true, commit: files.commit, shallow: files.shallow };
  if (!head.known) {
    return undefined;
  }
  const current: RepositoryWalks =
    known?.head === head.commit
      ? { ...known, stamp: files?.stamp, shallow: head.shallow }
      : {
          stamp: files?.stamp,
          head: head.commit,
          shallow: head.shallow,
          files: new Map(),
          facts: {
            infos: new Map(),
            held: new Map(),
            hashes: new Map(),
            versions: new Map(),
            movesAsked: new Set(),
            moves: new Map(),
          },
        };
  cache.repositories.set(folder, current);
  return current;
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

/** The repository `name` of the workspace with its walks at HEAD; undefined where Git cannot tell. */
const repositoryWalks = async (
  context: VersionDateContext,
  cache: VersionDateCache,
  name: string,
): Promise<{ readonly source: ImageSource; readonly walks: RepositoryWalks } | undefined> => {
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
  return walks === undefined
    ? undefined
    : { source: { repository, ignored: ignoredBy(context.layout) }, walks };
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
): void => {
  const fresh = new Map<string, FileWalk>();
  for (const { file, id, text } of requests) {
    const key = walkKey(file, id);
    if (walks.files.has(key) || fresh.has(key)) {
      continue;
    }
    if (!isGitPath(file)) {
      // A path git cannot take on a line (a line break, a leading space) has no date.
      walks.files.set(key, Promise.resolve(undefined));
      continue;
    }
    const seeds = imageLinks(file, text ?? "", source.ignored)
      .filter((l) => !l.missing)
      .map((l) => imagePath(l).normalize("NFC"));
    fresh.set(key, {
      walked: { key, file, id, names: [file], tracked: new Set([file.normalize("NFC"), ...seeds]) },
      evaluated: [],
      versions: new Map(),
      dates: new Map(),
      failed: false,
    });
  }
  if (fresh.size === 0) {
    return;
  }
  const running = readHistory(walks, source.repository.folder, [...fresh.values()], signal).then(
    () => true,
    (error: unknown) => {
      // What Git could not tell for a reason that may pass (a timeout, no git) is asked again next time.
      if (!(error instanceof Unknown) || error.transient) {
        for (const key of fresh.keys()) {
          walks.files.delete(key);
        }
      }
      if (error instanceof Unknown) {
        return false;
      }
      throw error;
    },
  );
  for (const [key, walk] of fresh) {
    const found = running.then((known) => (known ? walk : undefined));
    // A programming error reaches the call that awaits the walk; it never goes unhandled meanwhile.
    found.catch(() => undefined);
    walks.files.set(key, found);
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
    if (found !== undefined) {
      startWalks(found, cache.stop.signal, list);
    }
  }
};

/** The dates of `requests` in the repository `name`, by request; none where Git cannot tell. */
const repositoryDates = async (
  context: VersionDateContext,
  cache: VersionDateCache,
  name: string,
  requests: readonly VersionDateRequest[],
): Promise<Map<VersionDateRequest, string | null>> => {
  const found = await repositoryWalks(context, cache, name);
  if (found === undefined) {
    return new Map();
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
    startWalks(found, signal, requests);
    const files = await Promise.all(requests.map(async (r) => walks.files.get(walkKey(r.file, r.id))));
    const queries = requests.flatMap((r, i): Query[] => {
      const walk = files[i];
      return walk === undefined || walk.failed || !N1.test(r.version) || walk.dates.has(r.version)
        ? []
        : [{ walk, version: r.version }];
    });
    await answer(round, queries).catch((error: unknown) => {
      // Git could not tell, or a folder of the working copy could not be listed (`file.faulty`).
      if (error instanceof Unknown && !error.transient) {
        for (const { walk } of queries) {
          walk.failed = true;
        }
      } else if (error instanceof Unknown || error instanceof CommandError) {
        // What may pass is asked again by the next call, from a new walk: this one may hold a
        // tracked path whose history was not read (ADR-0005 "No date").
        for (const { walk } of queries) {
          walks.files.delete(walk.walked.key);
        }
      } else {
        throw error;
      }
    });
    return new Map(requests.map((r, i) => [r, files[i]?.dates.get(r.version) ?? null]));
  } finally {
    round.reader.close();
  }
};

/**
 * The date of each requested version (ADR-0005 "Version date"), in the order of `requests`: the
 * committer date in UTC (`YYYY-MM-DDTHH:MM:SSZ`) of the newest commit that started that version of
 * the element (the file held the element with that version there, its images as that commit had
 * them, and no parent of the commit had that version). `null` when no commit has that version
 * (uncommitted content, or a version Git never saw), when it is not of normal form 1, or when Git
 * cannot tell: the repository is not on this machine or not a repository, git is missing or
 * refuses it, it has no commit, it is a shallow clone, or a git call failed or timed out (ADR-0006).
 * The answer waits for the walks; the same request gives the same answer at the same HEAD (D-029).
 */
export const versionDates = async (
  context: VersionDateContext,
  requests: readonly VersionDateRequest[],
): Promise<(string | null)[]> => {
  const cache = context.workspace.get(versionDateState);
  const dates = new Map(
    await Promise.all(
      [...byRepository(requests)].map(
        async ([name, list]) => [name, await repositoryDates(context, cache, name, list)] as const,
      ),
    ),
  );
  return requests.map((r) => dates.get(r.repository)?.get(r) ?? null);
};
