// Oracle of the carry over a change of the element store (#215, plan PR 0): seeded random steps on
// a small workspace with three repositories (one nested in another), each applied the way the
// watcher applies it (the paths it would name, through its own filter) or the way ReqSeq's own
// writes apply it; after each step the store and everything built on it must equal a fresh build
// from the files. It runs against today's code first, so that every later step of #215 (a walk
// that is skipped, a store patched in place, carried maps that are not copied) must keep it green.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace, untilWatching } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { searchElements } from "../query/search-index.js";
import { searchIndex } from "../query/search-state.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { availableRepositories, workspaceLayoutState } from "../workspace/index.js";
import type { CurrentVersions } from "./current-versions.js";
import { currentVersions } from "./current-versions.js";
import type { ElementRecord } from "./elements.js";
import type { IncomingIndex } from "./incoming.js";
import type * as PatchLimits from "./patch-limits.js";
import { incomingFor } from "./incoming.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { Contribution, ElementStore, RepositoryChanges } from "./store.js";
import {
  applyStoreChange,
  elementStoreState,
  loadElements,
  updateElements,
  workspaceVersioning,
} from "./store.js";
import { counts, gitEntryFolder, mayHoldElements, watchWorkspace } from "./watch.js";
import { updateElement } from "./write.js";

/**
 * Whether the seed runs with small patch limits: the store is assembled anew from 2 touched files,
 * maps compact from 4 entries and give their plain entries from 2 lookups (`plainOf`).
 */
let small = false;

vi.mock("./patch-limits.js", async (importOriginal) => {
  const original = await importOriginal<typeof PatchLimits>();
  return {
    get PATCH_LIMIT(): number {
      return small ? 2 : original.PATCH_LIMIT;
    },
    compactAt: (size: number): number => (small ? 4 : original.compactAt(size)),
    plainAt: (size: number): number => (small ? 2 : original.plainAt(size)),
  };
});

/** Links need a privilege on Windows, and modes do not keep a file from being read there. */
const POSIX = process.platform !== "win32";

const MODEL = `reqseq-metamodel: 1
types:
  - { key: need, name: Need, prefix: N, meaning: need, properties: [title, spec-id], required: [title] }
  - { key: system-requirement, name: System Requirement, prefix: SR, meaning: requirement, properties: [title, spec-id], required: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }
relations:
  - { key: derives-from, name: Derives from, inverse-name: Derived by, meaning: derivation }
statuses:
  - { key: draft, name: Draft, initial: true }
`;

const WORKSPACE = `reqseq-workspace: 1
name: Oracle
repositories:
  - { name: system, url: "git@git.example.com:o/system.git", main: true }
  - { name: platform, url: "git@git.example.com:o/platform.git", path: ../platform }
  - { name: nested, url: "git@git.example.com:o/nested.git", path: inner/nested }
metamodel: { repository: system, path: metamodel }
`;

/** Folders of each repository below the workspace root. */
const ROOTS: Readonly<Record<string, string>> = {
  system: "system",
  platform: "platform",
  nested: "system/inner/nested",
};
const REPOSITORIES = Object.keys(ROOTS);
const FOLDERS = ["needs", "requirements", "deep/a", "deep/b"];
const WORDS = ["gust", "wind", "storm", "display", "sensor", "coast", "rain", "alarm"];
const STALE = "n1:0000000000000000";

/** A small seeded generator (mulberry32), so a failing seed can be run again. */
const random = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A file of the test's own model of the workspace: where it lies and the UUID it holds. */
interface Known {
  repository: string;
  file: string;
  id: string;
  /** Its mode was taken away (`chmod 000`); moves and renames keep it. */
  unreadable?: boolean;
}

/** What a step changed, as the watcher would name it per repository, or a write of ReqSeq itself. */
type Step =
  | { readonly kind: "watcher"; readonly label: string; readonly changes: Map<string, RepositoryChanges> }
  | { readonly kind: "write"; readonly label: string; readonly pick: number; readonly value: string }
  | {
      readonly kind: "retry";
      readonly label: string;
      /** The change another batch installs first, while this one runs. */
      readonly first: Map<string, RepositoryChanges>;
      readonly changes: Map<string, RepositoryChanges>;
    }
  | {
      readonly kind: "interleave";
      readonly label: string;
      readonly changes: Map<string, RepositoryChanges>;
      readonly pick: number;
      readonly value: string;
    };

class Oracle {
  readonly #next: () => number;
  readonly files: Known[] = [];
  /** Files below `outside/`, link targets that no repository holds. */
  #links = 0;
  #count = 0;

  readonly fixture: FixtureWorkspace;

  constructor(fixture: FixtureWorkspace, seed: number) {
    this.fixture = fixture;
    this.#next = random(seed);
  }

  int(n: number): number {
    return Math.floor(this.#next() * n);
  }

  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)] as T;
  }

  /** A UUID; now and then one that ends like another, so short IDs grow (SR-082). */
  uuid(): string {
    const hex = (n: number): string =>
      Array.from({ length: n }, () => "0123456789abcdef".charAt(this.int(16))).join("");
    const tail = this.files.length > 0 && this.int(4) === 0 ? this.pick(this.files).id.slice(-6) : hex(6);
    return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(6)}${tail}`;
  }

  words(n: number): string {
    return Array.from({ length: n }, () => this.pick(WORDS)).join(" ");
  }

  /** An element file: relations and inline references to known UUIDs, some in other repositories. */
  element(id: string, extra = ""): string {
    const type = this.int(2) === 0 ? "need" : "system-requirement";
    const targets =
      this.files.length === 0 ? [] : Array.from({ length: this.int(3) }, () => this.pick(this.files));
    const relations =
      targets.length === 0
        ? ""
        : `derives-from:\n${targets.map((t) => `  - { id: ${t.id}, version: "${STALE}", repository: ${t.repository} }`).join("\n")}\n`;
    const reference =
      this.files.length === 0 ? "" : ` See [it](reqseq:${this.pick(this.files).id}?version=${STALE}).`;
    const specId = this.int(3) === 0 ? `spec-id: REQ-${String(this.int(5))}\n` : "";
    return `---\nid: ${id}\ntype: ${type}\nstatus: draft\ntitle: ${this.words(2)}\n${specId}${relations}${extra}---\n\n${this.words(4)}.${reference}\n`;
  }

  abs(repository: string, file: string): string {
    return this.fixture.path(`${ROOTS[repository] ?? ""}/${file}`);
  }

  async write(repository: string, file: string, content: string): Promise<void> {
    await this.fixture.write(`${ROOTS[repository] ?? ""}/${file}`, content);
  }

  newFile(name = `E${String(++this.#count)}.md`): string {
    return `${this.pick(FOLDERS)}/${name}`;
  }

  /** Creates a few elements per repository and a file that is no element. */
  async seed(): Promise<void> {
    for (const repository of REPOSITORIES) {
      for (let i = 0; i < 5; i++) {
        const known = { repository, file: this.newFile(), id: this.uuid() };
        await this.write(repository, known.file, this.element(known.id));
        this.files.push(known);
      }
    }
    await this.write("system", "notes/readme.md", "# Notes\n\nNo element.\n");
  }

  /** Drops the files of `folder` from the test's model: the walk leaves them out from now on. */
  forget(repository: string, folder: string): void {
    const below = (k: Known): boolean => k.repository === repository && k.file.startsWith(`${folder}/`);
    this.files.splice(0, this.files.length, ...this.files.filter((k) => !below(k)));
  }

  /**
   * One random step: the files are changed, and the step says what the watcher would name. `named`
   * carries what an earlier draw named already (a mode given back) into the next draw.
   */
  async step(named = new Map<string, Set<string>>()): Promise<Step> {
    const name = (repository: string, ...paths: string[]): void => {
      named.set(repository, new Set([...(named.get(repository) ?? []), ...paths]));
    };
    const changesOf = (all: boolean): Map<string, RepositoryChanges> =>
      new Map([...named].map(([r, paths]) => [r, all ? { paths: [], all: true } : { paths: [...paths] }]));
    const target = this.pick(this.files);
    if (target.unreadable === true) {
      target.unreadable = false;
      // The mode given back is a change the watcher names too (an attribute event).
      await fs.chmod(this.abs(target.repository, target.file), 0o644);
      name(target.repository, target.file);
    }
    const op = this.pick(OPS);
    const result = await op(this, { target, name });
    if (result === undefined) {
      return this.step(named);
    }
    if (typeof result === "string") {
      return { kind: "watcher", label: result, changes: changesOf(false) };
    }
    if (result.kind === "all") {
      return { kind: "watcher", label: result.label, changes: changesOf(true) };
    }
    if (result.kind === "write") {
      // A mode given back above is still named, by a batch queued with the save.
      return named.size === 0 ? result : { ...result, kind: "interleave", changes: changesOf(false) };
    }
    return result.kind === "retry"
      ? { ...result, changes: changesOf(false) }
      : { ...result, label: `${result.label} with a write of ReqSeq`, changes: changesOf(false) };
  }

  /** Counts up, for names no file had before. */
  count(): number {
    return ++this.#count;
  }

  link(): number {
    return ++this.#links;
  }

  /** Whether the file at `place` (`repository/file`) has its mode taken away: ReqSeq cannot write it. */
  isUnreadable(place: string): boolean {
    return this.files.some((k) => k.unreadable === true && `${k.repository}/${k.file}` === place);
  }
}

/** What an operation gets: the file it changes and how to name the paths the watcher would see. */
interface OpContext {
  readonly target: Known;
  readonly name: (repository: string, ...paths: string[]) => void;
}

/**
 * An operation of a step: changes the files and gives the label of a watcher batch (the paths it
 * named), a batch where the OS names no path (`all`), a write of ReqSeq or a retry; undefined when it
 * does not apply here (then another is drawn).
 */
type Op = (
  oracle: Oracle,
  context: OpContext,
) => Promise<
  | string
  | { readonly kind: "all"; readonly label: string }
  | Extract<Step, { kind: "write" }>
  | { readonly kind: "retry"; readonly label: string; readonly first: Map<string, RepositoryChanges> }
  | { readonly kind: "interleave"; readonly label: string; readonly pick: number; readonly value: string }
  | undefined
>;

const isLink = async (absolute: string): Promise<boolean> =>
  (await fs.lstat(absolute).catch(() => undefined))?.isSymbolicLink() === true;

const OPS: readonly Op[] = [
  async (o, { target: t, name }) => {
    await o.write(t.repository, t.file, o.element(t.id));
    name(t.repository, t.file);
    return `edit ${t.repository}/${t.file}`;
  },
  async (o, { target: t, name }) => {
    // An atomic save: a temporary file renamed over the file (vim, JetBrains, ReqSeq).
    const temp = `${t.file}.tmp-${String(o.count())}`;
    await o.write(t.repository, temp, o.element(t.id));
    await fs.rename(o.abs(t.repository, temp), o.abs(t.repository, t.file));
    name(t.repository, temp, t.file);
    return `atomic save ${t.repository}/${t.file}`;
  },
  async (o, { name }) => {
    const added = { repository: o.pick(REPOSITORIES), file: o.newFile(), id: o.uuid() };
    await o.write(added.repository, added.file, o.element(added.id));
    o.files.push(added);
    name(added.repository, added.file);
    return `add ${added.repository}/${added.file}`;
  },
  async (o, { target: t, name }) => {
    if (o.files.length < 4) {
      return undefined;
    }
    await fs.rm(o.abs(t.repository, t.file), { force: true });
    o.files.splice(o.files.indexOf(t), 1);
    name(t.repository, t.file);
    return `delete ${t.repository}/${t.file}`;
  },
  async (o, { target: t, name }) => {
    // A move, to another folder or another repository.
    const { repository, file } = t;
    const to = o.pick(REPOSITORIES);
    const moved = o.newFile(path.posix.basename(file));
    const text = await fs.readFile(o.abs(repository, file), "utf8");
    await fs.rm(o.abs(repository, file), { force: true });
    await o.write(to, moved, text);
    name(repository, file);
    name(to, moved);
    t.repository = to;
    t.file = moved;
    return `move ${repository}/${file} to ${to}/${moved}`;
  },
  async (o, { target: t, name }) => {
    // A copy: two files with one UUID (SR-088).
    const copy = { repository: t.repository, file: o.newFile(), id: t.id };
    await fs.mkdir(path.dirname(o.abs(copy.repository, copy.file)), { recursive: true });
    await fs.copyFile(o.abs(t.repository, t.file), o.abs(copy.repository, copy.file));
    o.files.push(copy);
    name(copy.repository, copy.file);
    return `copy ${t.repository}/${t.file} to ${copy.file}`;
  },
  async (o, { target: t, name }) => {
    t.id = o.uuid();
    await o.write(t.repository, t.file, o.element(t.id));
    name(t.repository, t.file);
    return `new UUID in ${t.repository}/${t.file}`;
  },
  async (o, { target: t, name }) => {
    // Faulty YAML; a later edit of the file makes it an element again.
    await o.write(t.repository, t.file, "---\nid: [\n---\n");
    name(t.repository, t.file);
    return `faulty ${t.repository}/${t.file}`;
  },
  async (o, { target: t, name }) => {
    await o.write(t.repository, t.file, o.element(t.id, "note: !custom value\n"));
    name(t.repository, t.file);
    return `YAML warning in ${t.repository}/${t.file}`;
  },
  async (o, { target: t, name }) => {
    // A Markdown file the walk does not read (`.MD`), and one with a decomposed (NFD) name.
    const upper = o.newFile(`UPPER${String(o.count())}.MD`);
    const nfd = o.newFile(`U\u0308ber${String(o.count())}.md`);
    const known = { repository: t.repository, file: nfd, id: o.uuid() };
    await o.write(t.repository, upper, o.element(o.uuid()));
    await o.write(t.repository, nfd, o.element(known.id));
    o.files.push(known);
    name(t.repository, upper, nfd);
    return `.MD and NFD names in ${t.repository}`;
  },
  async (o, { target: t, name }) => {
    // A folder renamed or deleted.
    const folder = o.pick(FOLDERS);
    const from = o.abs(t.repository, folder);
    if (
      !(await fs.stat(from).then(
        () => true,
        () => false,
      ))
    ) {
      return undefined;
    }
    if (o.int(3) === 0) {
      await fs.rm(from, { recursive: true, force: true });
      o.forget(t.repository, folder);
      name(t.repository, folder);
      return `delete folder ${t.repository}/${folder}`;
    }
    const renamed = `${folder}-${String(o.count())}`;
    await fs.rename(from, o.abs(t.repository, renamed));
    for (const known of o.files.filter(
      (k) => k.repository === t.repository && k.file.startsWith(`${folder}/`),
    )) {
      known.file = `${renamed}/${known.file.slice(folder.length + 1)}`;
    }
    name(t.repository, folder, renamed);
    return `rename folder ${t.repository}/${folder}`;
  },
  async (o, { target: t, name }) => {
    if (!POSIX) {
      return undefined;
    }
    // A folder swapped for a link to a folder outside; the watcher names the link, and now and then
    // an edit through it as well (#215 reviews B1, N1).
    const folder = path.posix.dirname(t.file);
    const outside = o.fixture.path(`outside/${String(o.link())}`);
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.rename(o.abs(t.repository, folder), outside);
    await fs.symlink(outside, o.abs(t.repository, folder));
    o.forget(t.repository, folder);
    name(t.repository, folder);
    if (o.int(2) === 0) {
      await fs.writeFile(path.join(outside, path.posix.basename(t.file)), o.element(t.id));
      name(t.repository, t.file);
    }
    return `folder ${t.repository}/${folder} swapped for a link`;
  },
  async (o, { target: t, name }) => {
    if (!POSIX) {
      return undefined;
    }
    // A file swapped for a link, or a link replaced by a file again.
    const at = o.abs(t.repository, t.file);
    name(t.repository, t.file);
    if (await isLink(at)) {
      await fs.rm(at);
      await o.write(t.repository, t.file, o.element(t.id));
      return `link ${t.repository}/${t.file} replaced by a file`;
    }
    const outside = o.fixture.path(`outside/f${String(o.link())}.md`);
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, o.element(o.uuid()));
    await fs.rm(at, { force: true });
    await fs.symlink(outside, at);
    return `${t.repository}/${t.file} swapped for a link`;
  },
  async (o, { target: t, name }) => {
    // A `.git` entry in a subfolder (the watcher names its folder), now and then with an edit below.
    const folder = path.posix.dirname(t.file);
    await fs.mkdir(path.join(o.abs(t.repository, folder), ".git"), { recursive: true });
    o.forget(t.repository, folder);
    name(t.repository, `${folder}/.git`);
    if (o.int(2) === 0) {
      await o.write(t.repository, t.file, o.element(t.id));
      name(t.repository, t.file);
    }
    return `git init in ${t.repository}/${folder}`;
  },
  async (o, { name }) => {
    // A folder named like an element file (`F1.md/`) moved out of the repository and a file of that
    // name created in its place: the watcher names only the new file (#215 review B1).
    const inFolder = o.files.find((k) => path.posix.dirname(k.file).endsWith(".md"));
    if (inFolder === undefined) {
      const known = {
        repository: o.pick(REPOSITORIES),
        file: `deep/F${String(o.count())}.md/inner.md`,
        id: o.uuid(),
      };
      await o.write(known.repository, known.file, o.element(known.id));
      o.files.push(known);
      name(known.repository, known.file);
      return `add ${known.repository}/${known.file}`;
    }
    const folder = path.posix.dirname(inFolder.file);
    const outside = o.fixture.path(`outside/${String(o.link())}`);
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.rename(o.abs(inFolder.repository, folder), outside);
    o.forget(inFolder.repository, folder);
    const replacing = { repository: inFolder.repository, file: folder, id: o.uuid() };
    await o.write(replacing.repository, replacing.file, o.element(replacing.id));
    o.files.push(replacing);
    name(replacing.repository, replacing.file);
    return `folder ${replacing.repository}/${folder} replaced by a file`;
  },
  async (o, { target: t, name }) => {
    if (!POSIX) {
      return undefined;
    }
    // A file nobody may read; a later step gives the mode back.
    await o.write(t.repository, t.file, o.element(t.id));
    await fs.chmod(o.abs(t.repository, t.file), 0o000);
    t.unreadable = true;
    name(t.repository, t.file);
    return `unreadable ${t.repository}/${t.file}`;
  },
  async (o, { target: t, name }) => {
    // The OS names no path: every file of the repository is checked.
    await o.write(t.repository, t.file, o.element(t.id));
    name(t.repository, t.file);
    return { kind: "all", label: `all files of ${t.repository}` };
  },
  async (o, { name }) => {
    await o.write("system", "notes/readme.md", o.int(2) === 0 ? "# Notes\n" : o.element(o.uuid()));
    name("system", "notes/readme.md");
    return "notes/readme.md is an element or not";
  },
  async (o) => {
    // A save of ReqSeq itself (`recordWrites`), between watcher batches; the runner picks the element.
    await Promise.resolve();
    return { kind: "write", label: "element.update", pick: o.int(1_000), value: `REQ-${String(o.int(9))}` };
  },
  async (o, { target: t, name }) => {
    // Two edits; the store is replaced by the first while the second runs (`applyNow` retries).
    // The target is readable again (`step`), so the list is never empty.
    const other = o.pick(o.files.filter((k) => k.unreadable !== true));
    await o.write(t.repository, t.file, o.element(t.id));
    await o.write(other.repository, other.file, o.element(other.id));
    name(t.repository, t.file);
    name(other.repository, other.file);
    return {
      kind: "retry",
      label: `retry over ${t.repository}/${t.file}`,
      first: new Map([[t.repository, { paths: [t.file] }]]),
    };
  },
  async (o, { target: t, name }) => {
    // A watcher batch and a save of ReqSeq of another element, queued one behind the other.
    await o.write(t.repository, t.file, o.element(t.id));
    name(t.repository, t.file);
    return {
      kind: "interleave",
      label: `edit ${t.repository}/${t.file}`,
      pick: o.int(1_000),
      value: `REQ-${String(o.int(9))}`,
    };
  },
];

/** The paths of `changes` that the watcher's filter keeps, as the watcher builds a batch. */
const filtered = async (
  layout: WorkspaceLayout,
  changes: ReadonlyMap<string, RepositoryChanges>,
): Promise<Map<string, RepositoryChanges>> => {
  const out = new Map<string, RepositoryChanges>();
  for (const repository of availableRepositories(layout)) {
    const change = changes.get(repository.name);
    if (change?.all === true) {
      out.set(repository.name, change);
    } else if (change !== undefined) {
      const kept: string[] = [];
      for (const p of change.paths.map(gitEntryFolder)) {
        if (counts(p) && (await mayHoldElements(repository.folder, p))) {
          kept.push(p);
        }
      }
      if (kept.length > 0) {
        out.set(repository.name, { paths: kept });
      }
    }
  }
  return out;
};

const place = (e: Pick<ElementRecord, "repository" | "file">): string => `${e.repository}/${e.file}`;

/**
 * The store as plain data: every field, `byId` by sorted UUID (its key order is not defined). Without
 * `versions`, the versions as read are left out: a store read without them (a start from the model
 * cache, #439) gets them for the files it reads again, a fresh read for every file.
 */
const storeData = (store: ElementStore, versions = true): unknown => ({
  elements: store.elements.map((e) => [place(e), e.id]),
  byId: [...store.byId].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, list]) => [id, list.map(place)]),
  problems: store.problems,
  nonElements: store.nonElements,
  repositories: (store.repositories ?? []).map((r) => ({
    repository: r.repository,
    listing: r.listing,
    files: [...r.files].map(([file, c]) => [file, versions ? c : { ...c, version: undefined }]),
  })),
});

/** The states built on a store that a command holds while it runs. */
interface States {
  readonly shortIds: ShortIds;
  readonly index: IncomingIndex;
  readonly versions: CurrentVersions;
}

const statesOf = async (workspace: Workspace, store: ElementStore): Promise<States> => ({
  shortIds: await workspace.get(shortIdState),
  index: incomingFor(workspace, store, await workspace.get(metamodelState)),
  versions: await currentVersions(workspace),
});

/** The states of a store as plain data: short IDs, incoming index, current versions. */
const statesData = (store: ElementStore, { shortIds, index, versions }: States): unknown => {
  const byId = <T>(map: ReadonlyMap<string, readonly T[]>, of: (link: T) => unknown): unknown =>
    [...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([id, links]) => [id, links.map(of)]);
  return {
    shortIds: store.elements.map((e) => {
      const found = shortIds.find(shortIds.of(e));
      return [place(e), shortIds.of(e), found.kind === "found" ? place(found.element) : found.kind];
    }),
    relations: byId(index.relationsById, (l) => [place(l.source), l.key, l.index, l.repository]),
    references: byId(index.referencesById, (l) => [place(l.source), l.reference.line]),
    versions: store.elements.map((e) => {
      const entry = versions.byRecord.get(e);
      return [place(e), entry === undefined ? undefined : { ...entry, element: undefined }];
    }),
  };
};

/** The store and its states as plain data. */
const modelData = async (workspace: Workspace, store: ElementStore): Promise<unknown> => ({
  store: storeData(store),
  states: statesData(store, await statesOf(workspace, store)),
});

/** What commands give: findings, outdated hints, verification status and searches (ties, IDs, `within`). */
const commandsData = async (workspace: Workspace, queries: readonly string[]): Promise<unknown> => {
  const run = (name: string, input: Record<string, unknown> = {}): Promise<unknown> =>
    invoke(name, input, { workspace });
  const store = await workspace.get(elementStoreState);
  const index = await searchIndex(workspace);
  const within = store.elements.filter((_, i) => i % 2 === 0);
  return {
    check: await run("workspace.check"),
    hints: await run("hint.list"),
    status: await run("evidence.status"),
    search: queries.flatMap((query) =>
      [{}, { within }, { combineWith: "or" as const }].map((options) =>
        searchElements(index, query, options).hits.map((h) => [place(h.element), h.score, h.fields, h.terms]),
      ),
    ),
  };
};

/** Everything a fresh workspace on the same files gives. */
const freshOf = async (root: string, versioning: boolean, queries: readonly string[]): Promise<unknown> => {
  const fresh = new Workspace(root);
  try {
    const layout = await fresh.get(workspaceLayoutState);
    const loaded = await loadElements(
      layout,
      undefined,
      versioning ? { versioning: workspaceVersioning(fresh, layout) } : {},
    );
    const store = await fresh.get(elementStoreState);
    return {
      store: storeData(loaded, versioning),
      states: statesData(store, await statesOf(fresh, store)),
      commands: await commandsData(fresh, queries),
    };
  } finally {
    await fresh.close();
  }
};

/** Whether `file` is at or below one of `paths` (the files a watcher batch may have read again). */
const named = (file: string, paths: readonly string[]): boolean =>
  paths.some((p) => file === p || file.startsWith(`${p}/`));

const open = async (seed: number): Promise<{ oracle: Oracle; root: string; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    files: { "system/reqseq-workspace.yaml": WORKSPACE, "system/metamodel/model.yaml": MODEL },
  });
  onTestFinished(() => fixture.cleanup());
  const oracle = new Oracle(fixture, seed);
  await oracle.seed();
  const root = fixture.path("system");
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return { oracle, root, workspace };
};

/** Builds every state that a server or the app keeps, so that the carry hooks run. */
const warm = async (workspace: Workspace, queries: readonly string[]): Promise<void> => {
  await modelData(workspace, await workspace.get(elementStoreState));
  await commandsData(workspace, queries);
};

/**
 * An element the store holds once, so that its UUID names it, and that ReqSeq may write (`skip`
 * leaves out unreadable files and those a batch names), or undefined when there is none.
 */
const unique = (
  store: ElementStore,
  pick: number,
  skip: (place: string) => boolean,
): ElementRecord | undefined => {
  const once = store.elements.filter((e) => store.byId.get(e.id)?.length === 1 && !skip(place(e)));
  return once[pick % once.length];
};

/**
 * Every file a watcher batch did not name is the same object as before (`StoreUpdate`), also in the
 * repositories it named nothing in.
 */
const expectKept = (
  before: ElementStore,
  after: ElementStore,
  changes: ReadonlyMap<string, RepositoryChanges>,
  context: string,
): void => {
  for (const [i, contents] of (after.repositories ?? []).entries()) {
    const paths = changes.get(contents.repository);
    const old = before.repositories?.[i]?.files ?? new Map<string, Contribution>();
    const untouched = [...contents.files].filter(
      ([file]) => (paths === undefined || (paths.all !== true && !named(file, paths.paths))) && old.has(file),
    );
    for (const [file, now] of untouched) {
      expect(now, `${context}: ${contents.repository}/${file} kept`).toBe(old.get(file));
    }
  }
};

/** Saves an element through `element.update` (`recordWrites`), one `skip` does not leave out. */
const save = async (
  workspace: Workspace,
  store: ElementStore,
  step: { readonly pick: number; readonly value: string },
  skip: (place: string) => boolean,
): Promise<void> => {
  const element = unique(store, step.pick, skip);
  if (element !== undefined) {
    await updateElement(workspace, { ref: element.id, set: { "spec-id": step.value } });
  }
};

/**
 * Applies a step as the watcher or a write of ReqSeq does: a retry has another batch installed while
 * it runs, so `applyNow` runs it again on the newer store; an interleave queues a save behind the batch.
 */
const apply = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  before: ElementStore,
  step: Step,
  oracle: Oracle,
  context: string,
): Promise<void> => {
  const unwritable = (p: string): boolean => oracle.isUnreadable(p);
  if (step.kind === "write") {
    await save(workspace, before, step, unwritable);
    return;
  }
  const changes = await filtered(layout, step.changes);
  if (step.kind === "interleave") {
    const inBatch = (p: string): boolean =>
      unwritable(p) ||
      [...changes].some(([r, c]) => p.startsWith(`${r}/`) && named(p.slice(r.length + 1), c.paths));
    await Promise.all([
      applyStoreChange(workspace, (store) => updateElements(store, layout, changes)),
      save(workspace, before, step, inBatch),
    ]);
    return;
  }
  const first = step.kind === "retry" ? await filtered(layout, step.first) : undefined;
  let installed = first === undefined;
  await applyStoreChange(workspace, async (store) => {
    if (!installed && first !== undefined) {
      installed = true;
      const newer = (await updateElements(store, layout, first)) ?? store;
      await workspace.replace(elementStoreState, workspace.peek(elementStoreState), Promise.resolve(newer));
    }
    return updateElements(store, layout, changes);
  });
  if (step.kind === "watcher") {
    expectKept(before, await workspace.get(elementStoreState), changes, context);
  }
};

/**
 * The seeds of a run: four fixed ones, or a range `from-to` from `REQSEQ_ORACLE_SEEDS` for a longer
 * local run (each with versions as read, every odd one with small patch limits).
 */
const SEEDS = ((): readonly {
  readonly seed: number;
  readonly versioning: boolean;
  readonly small: boolean;
}[] => {
  const range = /^(\d+)-(\d+)$/u.exec(process.env["REQSEQ_ORACLE_SEEDS"] ?? "");
  if (range === null) {
    return [
      { seed: 215, versioning: true, small: false },
      { seed: 4711, versioning: true, small: false },
      { seed: 36, versioning: false, small: false },
      { seed: 831, versioning: true, small: true },
    ];
  }
  const from = Number(range[1]);
  return Array.from({ length: Number(range[2]) - from + 1 }, (_, i) => ({
    seed: from + i,
    versioning: true,
    small: (from + i) % 2 === 1,
  }));
})();

const QUERIES = ["gust wind", "storm", "REQ-1", "sensor coast alarm"];
const STEPS = 30;

describe("the carry over a change of the store equals a fresh build (#215 oracle)", () => {
  it.each(SEEDS)(
    "seed $seed, versions as read: $versioning, small patch limits: $small",
    async ({ seed, versioning, small: lowered }) => {
      small = lowered;
      onTestFinished(() => {
        small = false;
      });
      const { oracle, root, workspace } = await open(seed);
      const layout = await workspace.get(workspaceLayoutState);
      if (!versioning) {
        // A store read without versions (#439): every later read keeps that (`versioningFor`).
        const current = workspace.peek(elementStoreState);
        await workspace.replace(elementStoreState, current, loadElements(layout));
      }
      await warm(workspace, QUERIES);
      /** Stores and their states kept as by commands that still run, with what they held then. */
      const kept: { store: ElementStore; states: States; data: string }[] = [];
      for (let at = 0; at < STEPS; at++) {
        const before = await workspace.get(elementStoreState);
        const step = await oracle.step();
        const context = `seed ${String(seed)}, step ${String(at)}: ${step.label}`;
        await apply(workspace, layout, before, step, oracle, context);
        const store = await workspace.get(elementStoreState);
        const states = await statesOf(workspace, store);
        const carried = {
          store: storeData(store, versioning),
          states: statesData(store, states),
          commands: await commandsData(workspace, QUERIES),
        };
        expect(carried, context).toEqual(await freshOf(root, versioning, QUERIES));
        if (oracle.int(4) === 0) {
          kept.push({ store, states, data: JSON.stringify(carried.store) + JSON.stringify(carried.states) });
        }
      }
      // A store and the states a command still holds never change under it (the search index is
      // shared by design, ADR-0008).
      for (const { store, states, data } of kept) {
        const now = JSON.stringify(storeData(store, versioning)) + JSON.stringify(statesData(store, states));
        expect(now, `seed ${String(seed)}: a kept store and its states`).toBe(data);
      }
    },
    120_000,
  );

  it("through a real watcher, edits, adds, deletes and moves end as a fresh build", async () => {
    const { oracle, root, workspace } = await open(1);
    await warm(workspace, QUERIES);
    const watcher = watchWorkspace(workspace);
    await watcher.ready;
    await untilWatching({
      probe: (attempt) => oracle.write("system", "probe.md", `# Probe ${String(attempt)}\n`),
      seen: async () =>
        (await workspace.get(elementStoreState)).nonElements.some((f) => f.file === "probe.md"),
    });
    const [edited, deleted] = oracle.files;
    if (edited === undefined || deleted === undefined) {
      throw new Error("the seed made too few files");
    }
    await oracle.write(edited.repository, edited.file, oracle.element(edited.id));
    await oracle.write("platform", "needs/New.md", oracle.element(oracle.uuid()));
    await fs.rm(oracle.abs(deleted.repository, deleted.file));
    await fs.mkdir(oracle.abs(edited.repository, "moved"), { recursive: true });
    await fs.rename(
      oracle.abs(edited.repository, edited.file),
      oracle.abs(edited.repository, "moved/Moved.md"),
    );
    const expected = await freshOf(root, true, QUERIES);
    const seen = async (): Promise<boolean> => {
      await watcher.settled();
      const store = await workspace.get(elementStoreState);
      return JSON.stringify(storeData(store)) === JSON.stringify((expected as { store: unknown }).store);
    };
    const deadline = performance.now() + 15_000;
    while (!(await seen()) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const store = await workspace.get(elementStoreState);
    expect({
      ...((await modelData(workspace, store)) as object),
      commands: await commandsData(workspace, QUERIES),
    }).toEqual(expected);
  }, 60_000);
});
