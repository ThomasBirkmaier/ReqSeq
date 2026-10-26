import { EventEmitter } from "node:events";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace, untilWatching } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { searchElements } from "../query/search-index.js";
import { searchIndex } from "../query/search-state.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace, defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { resolveId } from "./duplicates.js";
import type { ElementRecord } from "./elements.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import type { WatchFunction, WatcherOptions, WorkspaceChange, WorkspaceWatcher } from "./watch.js";
import { startWatcher, watchWorkspace, watcherProblems } from "./watch.js";

const NEED = "224dedea-c0ac-4ec8-a228-8beffcbd8c26";
const NEED_FILE = "needs/N-8beffcbd8c26.md";
const REQUIREMENT = "5cb1e198-1130-4a13-9d25-88cc6ebc472a";
const REQUIREMENT_FILE = "requirements/SR-88cc6ebc472a.md";
const OTHER = "6b1f1b9e-2a39-4c4c-9a4e-0c1d2e3f4a5b";

/** Bounds of SR-007: a saved file shows within 2 s (AK1), a pull of 1,000 files within 10 s (AK2). */
const SAVE_LIMIT_MS = 2000;
const PULL_LIMIT_MS = 10_000;

const requirement = (id: string, title: string, status = "draft", target = NEED): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: ${status}\ntitle: ${title}\nderives-from:\n  - { id: ${target}, version: "n1:56c3cc9cb6dcd50b" }\n---\n\nText of ${title}.\n`;

const need = (id: string, title: string): string =>
  `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: ${title}\n---\n\nNeed.\n`;

/** A UUID version 4 that differs in its last 12 hex digits (and so in its short ID). */
const uuid = (n: number): string => `0f1e2d3c-4b5a-4968-8776-${n.toString(16).padStart(12, "0")}`;

/**
 * Copies the SR-007 fixture and opens it. The workspace (and its watcher) is closed before the
 * folder is removed: Windows cannot remove a watched folder.
 */
const opened = async (
  options: Omit<FixtureOptions, "fixture"> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-007/external-changes", ...options });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { fixture, workspace };
};

/**
 * Polls `condition` until it holds and returns the milliseconds that took; fails after `limitMs`.
 * No fixed sleep: how soon events arrive differs between operating systems.
 */
const within = async (limitMs: number, condition: () => Promise<boolean>): Promise<number> => {
  const start = performance.now();
  for (;;) {
    if (await condition()) {
      return performance.now() - start;
    }
    if (performance.now() - start > limitMs) {
      throw new Error(`condition not met within ${String(limitMs)} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** `Übersicht` in both Unicode normal forms: one precomposed `Ü`, or `U` and a combining diaeresis. */
const NFC = `${String.fromCodePoint(0xdc)}bersicht`;
const NFD = `U${String.fromCodePoint(0x308)}bersicht`;
/** Each normal form with the other one. */
const FORMS = [
  [NFC, NFD],
  [NFD, NFC],
] as const;

/** A folder name typed in the workspace file and the same name in another normal form or letter case. */
const SPELLINGS = [...FORMS, ["Modell", "modell"], ["modell", "Modell"]] as const;

/** Whether two paths name one existing folder (same device and inode, or file index on Windows). */
const sameFolder = async (a: string, b: string): Promise<boolean> => {
  try {
    const [one, two] = await Promise.all([fs.stat(a, { bigint: true }), fs.stat(b, { bigint: true })]);
    return one.dev === two.dev && one.ino === two.ino;
  } catch {
    return false;
  }
};

const records = (store: ElementStore, id: string): readonly ElementRecord[] => store.byId.get(id) ?? [];

const title = async (workspace: Workspace, id: string): Promise<unknown> =>
  records(await workspace.get(elementStoreState), id)[0]?.data["title"];

/**
 * Starts the real watcher on a workspace whose store was read, and waits until it reports changes:
 * a probe file without frontmatter (a Markdown file that is not an element) is written until the
 * store lists it. macOS starts FSEvents asynchronously, so the first change after `ready` can be lost.
 */
const watching = async (fixture: FixtureWorkspace, workspace: Workspace): Promise<void> => {
  await workspace.get(elementStoreState);
  await watchWorkspace(workspace).ready;
  await untilWatching({
    probe: (attempt) => fixture.write("probe.md", `# Probe ${String(attempt)}\n`),
    seen: async () => (await workspace.get(elementStoreState)).nonElements.some((f) => f.file === "probe.md"),
  });
};

/** Saves a file as vim, JetBrains IDEs and `writeFileAtomic` do: a new file renamed over the old one. */
const saveAtomically = async (fixture: FixtureWorkspace, file: string, content: string): Promise<void> => {
  await fixture.write(`${file}.swp`, content);
  await fs.rename(fixture.path(`${file}.swp`), fixture.path(file));
};

/** Waits until the element has `expected` as title and returns the milliseconds that took. */
const titleShown = (
  workspace: Workspace,
  id: string,
  expected: string,
  limitMs = SAVE_LIMIT_MS,
): Promise<number> => within(limitMs, async () => (await title(workspace, id)) === expected);

describe("watching a workspace with the file system (SR-007)", () => {
  it("[SR-007/AK1] shows an element file saved by another editor within 2 seconds", async () => {
    const { fixture, workspace } = await opened();
    expect(await title(workspace, REQUIREMENT)).toBe("Show wind speed");
    await watching(fixture, workspace);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Show wind speed and gusts"));
    const elapsed = await titleShown(workspace, REQUIREMENT, "Show wind speed and gusts");
    expect(elapsed).toBeLessThanOrEqual(SAVE_LIMIT_MS);
  });

  it("[SR-007/AK1] shows two saves in a row within 2 seconds each when the first one renamed a new file over the old one", async () => {
    const { fixture, workspace } = await opened();
    await watching(fixture, workspace);
    await saveAtomically(fixture, REQUIREMENT_FILE, requirement(REQUIREMENT, "One"));
    expect(await titleShown(workspace, REQUIREMENT, "One")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    // The replaced file is still watched: a save in place afterwards shows as well.
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Two"));
    expect(await titleShown(workspace, REQUIREMENT, "Two")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    // And a file deleted and written again.
    await fs.rm(fixture.path(REQUIREMENT_FILE));
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Three"));
    expect(await titleShown(workspace, REQUIREMENT, "Three")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    await saveAtomically(fixture, REQUIREMENT_FILE, requirement(REQUIREMENT, "Four"));
    expect(await titleShown(workspace, REQUIREMENT, "Four")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
  });

  it("[SR-007/AK1] shows an element file that an editor saved by renaming a new file over it within 2 seconds", async () => {
    const { fixture, workspace } = await opened();
    await watching(fixture, workspace);
    // Editors such as vim and VS Code write a new file next to the old one and rename it over it.
    await saveAtomically(fixture, REQUIREMENT_FILE, requirement(REQUIREMENT, "Show gusts"));
    const elapsed = await titleShown(workspace, REQUIREMENT, "Show gusts");
    expect(elapsed).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    // A new element file in a new folder shows as well.
    await fixture.write("later/deep/SR-0c1d2e3f4a5b.md", requirement(OTHER, "Later"));
    expect(await titleShown(workspace, OTHER, "Later")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    // A file in a folder that was renamed shows under its new path, and its next save shows too.
    await fs.rename(fixture.path("later"), fixture.path("moved"));
    await within(SAVE_LIMIT_MS, async () =>
      records(await workspace.get(elementStoreState), OTHER).some(
        (r) => r.file === "moved/deep/SR-0c1d2e3f4a5b.md",
      ),
    );
    await fixture.write("moved/deep/SR-0c1d2e3f4a5b.md", requirement(OTHER, "Moved"));
    expect(await titleShown(workspace, OTHER, "Moved")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
  });

  it("[SR-007/AK1] shows saves within 2 seconds in a folder that a checkout replaced", async () => {
    const { fixture, workspace } = await opened({ git: true });
    // A branch on which `requirements` holds another file only: a checkout empties the folder,
    // so Git removes it and creates it again.
    await fixture.git(["checkout", "--quiet", "-b", "other"]);
    await fs.rm(fixture.path(REQUIREMENT_FILE));
    await fixture.write("requirements/SR-0c1d2e3f4a5b.md", requirement(OTHER, "Other"));
    await fixture.commit(undefined, "other");
    await fixture.git(["checkout", "--quiet", "main"]);
    await watching(fixture, workspace);

    await fixture.git(["checkout", "--quiet", "other"]);
    expect(await titleShown(workspace, OTHER, "Other")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    await fixture.write("requirements/SR-0c1d2e3f4a5b.md", requirement(OTHER, "Other, edited"));
    expect(await titleShown(workspace, OTHER, "Other, edited")).toBeLessThanOrEqual(SAVE_LIMIT_MS);

    await fixture.git(["checkout", "--quiet", "--force", "main"]);
    expect(await titleShown(workspace, REQUIREMENT, "Show wind speed")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Back on main"));
    expect(await titleShown(workspace, REQUIREMENT, "Back on main")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
  });

  it("[SR-007/AK1] shows saves within 2 seconds in a folder that was deleted and created again, or replaced", async () => {
    const { fixture, workspace } = await opened();
    await watching(fixture, workspace);
    await fs.rm(fixture.path("needs"), { recursive: true });
    await fixture.write(NEED_FILE, need(NEED, "Created again"));
    expect(await titleShown(workspace, NEED, "Created again")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    await fixture.write(NEED_FILE, need(NEED, "Saved in place"));
    expect(await titleShown(workspace, NEED, "Saved in place")).toBeLessThanOrEqual(SAVE_LIMIT_MS);

    // A folder moved over by another one.
    await fixture.write("next/N-8beffcbd8c26.md", need(NEED, "Replaced"));
    await fs.rm(fixture.path("needs"), { recursive: true });
    await fs.rename(fixture.path("next"), fixture.path("needs"));
    expect(await titleShown(workspace, NEED, "Replaced")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    await fixture.write(NEED_FILE, need(NEED, "Saved after the move"));
    expect(await titleShown(workspace, NEED, "Saved after the move")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
  });

  it("[SR-007/AK1] shows saves within 2 seconds in a folder named in NFD, and reads its metamodel again, whatever normal form the workspace file names it in (#225)", async () => {
    const { fixture, workspace } = await opened({
      files: { [`${NFD}/SR-0c1d2e3f4a5b.md`]: requirement(OTHER, "Decomposed") },
    });
    const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
    await fixture.write(`${NFD}/metamodel/model.yaml`, model);
    // APFS ignores the normal form of names: there the workspace file names the folder in NFC, as
    // keyboards type it. NTFS and ext4 keep NFC and NFD apart: there it names the folder as stored.
    const same = await sameFolder(fixture.path(NFC), fixture.path(NFD));
    if (process.env["CI"] !== undefined) {
      expect(same).toBe(process.platform === "darwin");
    }
    const typed = same ? NFC : NFD;
    await fixture.write(
      "logreq-workspace.yaml",
      `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: "${typed}/metamodel" }\n`,
    );
    await watching(fixture, workspace);
    await fixture.write(`${NFD}/SR-0c1d2e3f4a5b.md`, requirement(OTHER, "Decomposed, edited"));
    expect(await titleShown(workspace, OTHER, "Decomposed, edited")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    await workspace.get(metamodelState);
    await fixture.write(`${NFD}/metamodel/model.yaml`, `${model}\n# edited\n`);
    expect(
      await within(SAVE_LIMIT_MS, () => Promise.resolve(workspace.peek(metamodelState) === undefined)),
    ).toBeLessThanOrEqual(SAVE_LIMIT_MS);
  });

  it("[SR-007/AK1] shows saves within 2 seconds in a nested repository named in NFD, and reads the metamodel again when the workspace file types its folder in another letter case (#231)", async () => {
    const { fixture, workspace } = await opened({
      files: { [`vendor/${NFD}/SR-0c1d2e3f4a5b.md`]: requirement(OTHER, "Nested") },
    });
    // Typed as a keyboard types it where the file system ignores normal form (APFS) or letter
    // case (APFS, NTFS); elsewhere as stored, since another spelling is another folder there.
    const sameForm = await sameFolder(fixture.path(`vendor/${NFC}`), fixture.path(`vendor/${NFD}`));
    const sameCase = await sameFolder(fixture.path("Metamodel"), fixture.path("metamodel"));
    if (process.env["CI"] !== undefined) {
      expect(sameForm).toBe(process.platform === "darwin");
      expect(sameCase).toBe(process.platform !== "linux");
    }
    const nested = sameForm ? NFC : NFD;
    const metamodel = sameCase ? "Metamodel" : "metamodel";
    await fixture.write(
      "logreq-workspace.yaml",
      `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: sub, url: y, path: "vendor/${nested}" }\nmetamodel: { repository: system, path: ${metamodel} }\n`,
    );
    await watching(fixture, workspace);
    const layout = workspace.peek(workspaceLayoutState);
    expect(records(await workspace.get(elementStoreState), OTHER)[0]?.repository).toBe("sub");
    // Written through the typed spellings: the file system keeps the names as stored.
    await fixture.write(`vendor/${nested}/SR-0c1d2e3f4a5b.md`, requirement(OTHER, "Nested, edited"));
    expect(await titleShown(workspace, OTHER, "Nested, edited")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
    await workspace.get(metamodelState);
    await fixture.write(`${metamodel}/model.yaml`, `${model}\n# edited\n`);
    expect(
      await within(SAVE_LIMIT_MS, () => Promise.resolve(workspace.peek(metamodelState) === undefined)),
    ).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    expect((await workspace.get(metamodelState)).valid).toBe(true);
    // The layout was kept: no repository or metamodel folder changed.
    await watchWorkspace(workspace).settled();
    expect(workspace.peek(workspaceLayoutState)).toBe(layout);
  });

  it("[SR-007/AK2] has search, relations and status of 1,000 files changed by a pull current within 10 seconds", async () => {
    const count = 1000;
    const files: Record<string, string> = {};
    for (let i = 1; i <= count; i++) {
      files[`pulled/SR-${uuid(i).slice(-12)}.md`] = requirement(uuid(i), `Requirement ${String(i)}`);
    }
    const { fixture, workspace } = await opened({ git: true });
    // The commits are made with `commitFiles` (one `git fast-import`): writing and adding 1,000
    // files twice took most of the test's time on a loaded windows-2025 runner (#226).
    const before = await fixture.commitFiles(files);
    // Upstream: every file approved and derived from a new need.
    const target = uuid(count + 1);
    const upstreamFiles: Record<string, string> = {
      [`needs/N-${target.slice(-12)}.md`]: need(target, "Gusts"),
    };
    for (let i = 1; i <= count; i++) {
      upstreamFiles[`pulled/SR-${uuid(i).slice(-12)}.md`] = requirement(
        uuid(i),
        `Requirement ${String(i)} pulled`,
        "approved",
        target,
      );
    }
    const upstream = await fixture.commitFiles(upstreamFiles, { parent: before, message: "upstream" });
    // The working tree at the old commit: Git writes the 1,000 files with drafts.
    await fixture.git(["reset", "--quiet", "--hard", before]);
    const store = await workspace.get(elementStoreState);
    expect(records(store, uuid(1))[0]?.data["status"]).toBe("draft");
    expect(resolveId(store.byId, target).kind).toBe("unknown");
    // A server holds the search index from its start (`warmWorkspace`).
    expect(searchElements(await searchIndex(workspace), "pulled").total).toBe(0);
    await watching(fixture, workspace);

    // The pull: Git writes the 1,000 changed files (and the new need) into the working tree.
    await fixture.git(["merge", "--ff-only", upstream]);
    const current = async (): Promise<boolean> => {
      const now = await workspace.get(elementStoreState);
      if (resolveId(now.byId, target).kind !== "found") {
        return false;
      }
      for (let i = 1; i <= count; i++) {
        const record = records(now, uuid(i))[0];
        const relation = (
          record?.data["derives-from"] as readonly { readonly id: string }[] | undefined
        )?.[0];
        if (record?.data["status"] !== "approved" || relation?.id !== target) {
          return false;
        }
      }
      // The search finds the pulled texts (the index carried over the watcher's batches).
      return searchElements(await searchIndex(workspace), "pulled").total === count;
    };
    const elapsed = await within(PULL_LIMIT_MS, current);
    expect(elapsed).toBeLessThanOrEqual(PULL_LIMIT_MS);
    // State built on the store is built anew from the current files: the new need has a short ID.
    const shortIds = await workspace.get(shortIdState);
    expect(shortIds.find(`N-${target.slice(-12)}`)).toMatchObject({ kind: "found" });
    // Files Git replaced are still watched: an edit of a pulled file afterwards shows (AK1).
    const pulled = `pulled/SR-${uuid(7).slice(-12)}.md`;
    await fixture.write(pulled, requirement(uuid(7), "Edited after the pull", "approved", target));
    expect(await titleShown(workspace, uuid(7), "Edited after the pull")).toBeLessThanOrEqual(SAVE_LIMIT_MS);
  }, 60_000);

  it("[SR-007/AK3] treats a relation to an element whose file was deleted outside the tool as a missing target", async () => {
    const { fixture, workspace } = await opened();
    const before = await workspace.get(elementStoreState);
    expect(resolveId(before.byId, NEED).kind).toBe("found");
    await watching(fixture, workspace);
    await fs.rm(fixture.path(NEED_FILE));
    await within(PULL_LIMIT_MS, async () => !(await workspace.get(elementStoreState)).byId.has(NEED));
    const store = await workspace.get(elementStoreState);
    // The target is unknown, like a target in a missing repository (D-045); nothing else changes.
    expect(resolveId(store.byId, NEED)).toEqual({ kind: "unknown" });
    expect(store.elements.some((e) => e.file === NEED_FILE)).toBe(false);
    const source = records(store, REQUIREMENT)[0];
    expect(source?.data["derives-from"]).toEqual([
      { id: NEED, version: "n1:56c3cc9cb6dcd50b", title: "Wind speed visible at a glance" },
    ]);
    // The file of the relation is not touched.
    expect(await fs.readFile(fixture.path(REQUIREMENT_FILE), "utf8")).toContain(`id: ${NEED}`);
  });

  it("[SR-007/AK3] treats relations to the elements of a deleted folder as missing targets", async () => {
    const { fixture, workspace } = await opened();
    await watching(fixture, workspace);
    await fs.rm(fixture.path("needs"), { recursive: true });
    await within(PULL_LIMIT_MS, async () => !(await workspace.get(elementStoreState)).byId.has(NEED));
    const store = await workspace.get(elementStoreState);
    expect(resolveId(store.byId, NEED).kind).toBe("unknown");
    expect(resolveId(store.byId, REQUIREMENT).kind).toBe("found");
  });

  it("is one watcher per workspace and stops when the workspace is closed", async () => {
    const { workspace } = await opened();
    const watcher = watchWorkspace(workspace);
    expect(watchWorkspace(workspace)).toBe(watcher);
    await watcher.ready;
    await watcher.settled();
    await workspace.close();
    await expect(watcher.settled()).resolves.toBeUndefined();
  });
});

/** A watch function that records the folders it watches and lets the test send events. */
class FakeWatch {
  readonly handles: {
    folder: string;
    recursive: boolean;
    emitter: EventEmitter;
    closed: boolean;
    send: (name: string | null, event?: string) => void;
  }[] = [];
  /** Folders whose watch fails, with the error code. */
  readonly throwFor = new Map<string, string>();
  /** Runs when a folder is watched, before the watch is returned. */
  onWatch: (folder: string) => void = () => undefined;

  readonly watch: WatchFunction = (folder, options, listener) => {
    const code = this.throwFor.get(folder);
    if (code !== undefined) {
      throw Object.assign(new Error(code), { code });
    }
    this.onWatch(folder);
    const emitter = new EventEmitter();
    const handle = {
      folder,
      recursive: options.recursive,
      emitter,
      closed: false,
      send: (name: string | null, event = "rename"): void => {
        listener(event, name === null ? null : name.split("/").join(path.sep));
      },
    };
    this.handles.push(handle);
    return {
      close: () => {
        handle.closed = true;
      },
      on: (event: string, l: (...args: unknown[]) => void) => {
        emitter.on(event, l);
        return emitter as never;
      },
    } as ReturnType<WatchFunction>;
  };

  open(): FakeWatch["handles"] {
    return this.handles.filter((h) => !h.closed);
  }

  /** The open handle of `folder`. */
  of(folder: string): FakeWatch["handles"][number] {
    const handle = this.open().find((h) => h.folder === folder);
    if (handle === undefined) {
      throw new Error(`${folder} is not watched`);
    }
    return handle;
  }

  /** The one open handle. */
  only(): FakeWatch["handles"][number] {
    const open = this.open();
    expect(open).toHaveLength(1);
    const [first] = open;
    if (first === undefined) {
      throw new Error("no open watch");
    }
    return first;
  }
}

const watched = async (
  workspace: Workspace,
  options: WatcherOptions = {},
): Promise<{ fake: FakeWatch; watcher: ReturnType<typeof startWatcher> }> => {
  const fake = new FakeWatch();
  // The rules of one recursive watch per repository; the per-folder watch has its own tests.
  const watcher = startWatcher(workspace, { watch: fake.watch, recursive: true, debounceMs: 5, ...options });
  onTestFinished(() => watcher.close());
  await watcher.ready;
  return { fake, watcher };
};

/** The folder of the main repository. */
const folderOf = (layout: { readonly repositories: readonly { readonly folder: string }[] }): string => {
  const [main] = layout.repositories;
  if (main === undefined) {
    throw new Error("no repository");
  }
  return main.folder;
};

const NESTED_WORKSPACE =
  "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: sub, url: y, path: vendor/sub }\n  - { name: gone, url: z, path: ../gone }\nmetamodel: { repository: gone, path: metamodel }\n";

/** State built on the store whose disposal fails. */
const fragile = defineWorkspaceState("fragile", () => 1, {
  dependsOn: [elementStoreState],
  dispose: () => {
    throw new Error("dispose failed");
  },
});

/** Holds the store state on a Promise the test settles, so a batch waits in the middle of its update. */
const held = async (workspace: Workspace): Promise<() => void> => {
  const store = workspace.get(elementStoreState);
  let release: (store: ElementStore) => void = () => undefined;
  const pending = new Promise<ElementStore>((resolve) => {
    release = resolve;
  });
  expect(await workspace.replace(elementStoreState, store, pending)).toBe(true);
  const loaded = await store;
  return () => {
    release(loaded);
  };
};

describe("the watcher's rules (SR-007)", () => {
  it("watches every available repository once, recursively, and the nested one through the outer watcher", async () => {
    const { fixture, workspace } = await opened({
      files: {
        "logreq-workspace.yaml": NESTED_WORKSPACE,
        "vendor/sub/SR-0c1d2e3f4a5b.md": requirement(OTHER, "Sub"),
      },
    });
    const store = await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const layout = await workspace.get(workspaceLayoutState);
    expect(fake.open().map((h) => [h.folder, h.recursive])).toEqual([[layout.repositories[0]?.folder, true]]);
    // An event inside the nested repository updates that repository.
    await fs.writeFile(fixture.path("vendor/sub/SR-0c1d2e3f4a5b.md"), requirement(OTHER, "Sub 2"));
    fake.only().send("vendor/sub/SR-0c1d2e3f4a5b.md");
    await watcher.settled();
    const now = await workspace.get(elementStoreState);
    expect(now).not.toBe(store);
    expect(records(now, OTHER)[0]).toMatchObject({ repository: "sub", data: { title: "Sub 2" } });
    // Without a file name, both repositories below the watched folder are checked.
    await fixture.write("vendor/sub/SR-0c1d2e3f4a5b.md", requirement(OTHER, "Sub 3 is longer"));
    fake.only().send(null);
    await watcher.settled();
    expect(await title(workspace, OTHER)).toBe("Sub 3 is longer");
  });

  it("leaves the store alone for Git's folder, installed packages, temporary files, other files and the root itself", async () => {
    const { fixture, workspace } = await opened({
      files: { "docs/image.png": "png", "node_modules/x/a.md": "" },
    });
    const store = workspace.get(elementStoreState);
    await store;
    const { fake, watcher } = await watched(workspace);
    for (const name of [
      ".git/index",
      "node_modules/x/a.md",
      "requirements/.SR-88cc6ebc472a.md.0a1b2c3d.logreq-tmp",
      "docs/image.png",
      ".",
    ]) {
      fake.only().send(name);
    }
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBe(store);
    // A deleted folder and a new folder may hold element files: they are looked at.
    await fs.mkdir(fixture.path("empty"));
    fake.only().send("empty");
    fake.only().send("vanished");
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBe(store);
  });

  it("does nothing while no command has read the store", async () => {
    const { workspace } = await opened();
    const { fake, watcher } = await watched(workspace);
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBeUndefined();
  });

  it("checks every file when the operating system gives no file name", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "A title that makes the file longer"));
    fake.only().send(null);
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(await title(workspace, REQUIREMENT)).toBe("A title that makes the file longer");
  });

  it("[SR-007/AK2] reads the metamodel again and keeps an unchanged layout when the OS drops the names of a burst", async () => {
    const { fixture, workspace } = await opened();
    const store = await workspace.get(elementStoreState);
    await workspace.get(metamodelState);
    const layout = workspace.peek(workspaceLayoutState);
    const { fake, watcher } = await watched(workspace);
    const first = fake.only();
    // An overflow (Windows): the names of the pull are gone, one event without a name is left.
    first.send(null);
    await watcher.settled();
    expect(workspace.peek(metamodelState)).toBeUndefined();
    expect(workspace.peek(workspaceLayoutState)).toBe(layout);
    expect(first.closed).toBe(false);
    expect(workspace.peek(elementStoreState)).toBeDefined();
    expect(await workspace.get(elementStoreState)).toBe(store);
    // The same, when the pull changed an element file: it is read again, nothing else.
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Pulled with an overflow", "approved"));
    first.send(null);
    await watcher.settled();
    expect(workspace.peek(workspaceLayoutState)).toBe(layout);
    expect(records(await workspace.get(elementStoreState), REQUIREMENT)[0]?.data).toMatchObject({
      title: "Pulled with an overflow",
      status: "approved",
    });
  });

  it("[SR-007/AK2] reads the layout again when the OS dropped the name of a changed workspace file", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    await workspace.get(workspaceLayoutState);
    const layout = workspace.peek(workspaceLayoutState);
    const { fake, watcher } = await watched(workspace);
    const first = fake.only();
    const text = await fs.readFile(fixture.path("logreq-workspace.yaml"), "utf8");
    await fixture.write(
      "logreq-workspace.yaml",
      text.replace("name: Weather station", "name: Pulled station"),
    );
    first.send(null);
    await watcher.settled();
    expect(first.closed).toBe(true);
    expect(workspace.peek(elementStoreState)).toBeUndefined();
    expect(workspace.peek(workspaceLayoutState)).not.toBe(layout);
    expect((await workspace.get(workspaceLayoutState)).name).toBe("Pulled station");
    expect(fake.only().recursive).toBe(true);
    // A workspace file that no longer reads: the layout is reset and only the root is watched for it.
    await fixture.write("logreq-workspace.yaml", "logreq-workspace: [\n");
    fake.only().send(null);
    await watcher.settled();
    expect(workspace.peek(workspaceLayoutState)).toBeUndefined();
    expect(fake.open().map((h) => [h.folder, h.recursive])).toEqual([[workspace.root, false]]);
  });

  it("[SR-007/AK2] reads the layout again after a nameless event when the workspace was opened through a link", async () => {
    const { fixture } = await opened();
    // A junction on Windows (no admin rights needed), a symbolic link elsewhere: the repository
    // folders are real paths, the root is the path the workspace was opened with.
    const link = path.join(path.dirname(fixture.root), "linked");
    await fs.symlink(fixture.root, link, "junction");
    const workspace = new Workspace(link);
    onTestFinished(async () => {
      await workspace.close();
      // Runs before the fixture is removed; the link alone goes, never its target.
      await fs.unlink(link);
    });
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const first = fake.only();
    expect(first.folder).not.toBe(link);
    const text = await fs.readFile(fixture.path("logreq-workspace.yaml"), "utf8");
    await fixture.write(
      "logreq-workspace.yaml",
      text.replace("name: Weather station", "name: Linked station"),
    );
    first.send(null);
    await watcher.settled();
    expect(first.closed).toBe(true);
    expect((await workspace.get(workspaceLayoutState)).name).toBe("Linked station");
  });

  it("[SR-007/AK2] reads the metamodel again after a nameless event in another repository that holds it", async () => {
    const { workspace } = await opened({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: model, url: y, path: ../model }\nmetamodel: { repository: model, path: metamodel }\n",
      },
    });
    const other = path.join(workspace.root, "..", "model");
    await fs.cp(path.join(workspace.root, "metamodel"), path.join(other, "metamodel"), { recursive: true });
    await workspace.get(elementStoreState);
    await workspace.get(metamodelState);
    const layout = workspace.peek(workspaceLayoutState);
    const { fake, watcher } = await watched(workspace);
    fake.of(other).send(null);
    await watcher.settled();
    expect(workspace.peek(metamodelState)).toBeUndefined();
    expect(workspace.peek(workspaceLayoutState)).toBe(layout);
  });

  it("[SR-007/AK2] checks only the repository whose names the OS dropped when it holds neither the workspace file nor the metamodel", async () => {
    const { workspace } = await opened({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: other, url: y, path: ../other }\nmetamodel: { repository: system, path: metamodel }\n",
      },
    });
    const other = path.join(workspace.root, "..", "other");
    await fs.mkdir(path.join(other, "requirements"), { recursive: true });
    await fs.writeFile(path.join(other, "requirements", "SR-0c1d2e3f4a5b.md"), requirement(OTHER, "Other"));
    await workspace.get(elementStoreState);
    const metamodel = workspace.get(metamodelState);
    await metamodel;
    const layout = workspace.peek(workspaceLayoutState);
    const { fake, watcher } = await watched(workspace);
    await fs.writeFile(
      path.join(other, "requirements", "SR-0c1d2e3f4a5b.md"),
      requirement(OTHER, "Other, pulled"),
    );
    fake.of(other).send(null);
    await watcher.settled();
    expect(workspace.peek(metamodelState)).toBe(metamodel);
    expect(workspace.peek(workspaceLayoutState)).toBe(layout);
    expect(await title(workspace, OTHER)).toBe("Other, pulled");
  });

  it("reads the layout again when the workspace file or the local file changes, and watches anew", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    for (const name of ["logreq-workspace.yaml", ".logreq/local.yaml"]) {
      const layout = workspace.peek(workspaceLayoutState);
      const first = fake.only();
      fake.only().send(name);
      await watcher.settled();
      expect(first.closed).toBe(true);
      expect(fake.only()).not.toBe(first);
      expect(workspace.peek(workspaceLayoutState)).not.toBe(layout);
      expect(workspace.peek(elementStoreState)).toBeUndefined();
      await workspace.get(elementStoreState);
    }
    // A layout reset by someone else is noticed with the next event.
    await workspace.reset(workspaceLayoutState);
    const first = fake.only();
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Later"));
    first.send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(first.closed).toBe(true);
    expect(await title(workspace, REQUIREMENT)).toBe("Later");
  });

  it("reads the metamodel again when a file of its folder changes, and keeps the store", async () => {
    const { workspace } = await opened();
    const store = workspace.get(elementStoreState);
    const metamodel = workspace.get(metamodelState);
    await Promise.all([store, metamodel]);
    const { fake, watcher } = await watched(workspace);
    for (const name of ["metamodel/model.yaml", "metamodel"]) {
      fake.only().send(name);
      await watcher.settled();
      expect(workspace.peek(metamodelState)).toBeUndefined();
      expect(workspace.peek(elementStoreState)).toBe(store);
      await workspace.get(metamodelState);
    }
  });

  it("updates the store for a file or folder that an event spells in another Unicode normal form than the walk (#225)", async () => {
    for (const [onDisk, inEvent] of FORMS) {
      const { fixture, workspace } = await opened({
        files: { [`${onDisk}/SR-0c1d2e3f4a5b.md`]: requirement(OTHER, "Before") },
      });
      await workspace.get(elementStoreState);
      const { fake, watcher } = await watched(workspace);
      // The file named: read again even with the same size and time.
      await fixture.write(`${onDisk}/SR-0c1d2e3f4a5b.md`, requirement(OTHER, "Edited"));
      fake.only().send(`${inEvent}/SR-0c1d2e3f4a5b.md`);
      await watcher.settled();
      expect(await title(workspace, OTHER)).toBe("Edited");
      // Its folder named: the file is checked again.
      await fixture.write(`${onDisk}/SR-0c1d2e3f4a5b.md`, requirement(OTHER, "Edited in the folder"));
      fake.only().send(inEvent);
      await watcher.settled();
      expect(await title(workspace, OTHER)).toBe("Edited in the folder");
    }
  });

  it("reads the metamodel again for events spelled as its folder is stored, whatever letter case or normal form the workspace file types it in, and once more for a twin folder (#225, #231)", async () => {
    for (const [typed, stored] of SPELLINGS) {
      const { fixture, workspace } = await opened();
      const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
      await fixture.write(`${stored}/model.yaml`, model);
      // APFS (macOS) and NTFS ignore letter case, APFS also the normal form: there both spellings
      // name the stored folder. Elsewhere the typed spelling is a folder of its own, its twin.
      const same = await sameFolder(fixture.path(typed), fixture.path(stored));
      if (!same) {
        await fixture.write(`${typed}/model.yaml`, model);
      }
      await fixture.write(
        "logreq-workspace.yaml",
        `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: "${typed}" }\n`,
      );
      const store = workspace.get(elementStoreState);
      await Promise.all([store, workspace.get(metamodelState)]);
      const layout = await workspace.get(workspaceLayoutState);
      // The layout gives the folder as stored, as events and the walk spell it.
      expect(layout.metamodel.folder).toBe(fixture.path(same ? stored : typed));
      const { fake, watcher } = await watched(workspace);
      // Where the spellings are twins, an event of the other one resets the metamodel too: a safety
      // net, should an event ever spell the folder otherwise than `realpath`.
      for (const name of [`${stored}/model.yaml`, stored]) {
        fake.only().send(name);
        await watcher.settled();
        expect(workspace.peek(metamodelState)).toBeUndefined();
        expect(workspace.peek(elementStoreState)).toBe(store);
        expect(await workspace.get(workspaceLayoutState)).toBe(layout);
        await workspace.get(metamodelState);
      }
    }
  });

  it("reads the layout again when a missing metamodel folder appears, also spelled in another letter case or normal form than typed (#231)", async () => {
    for (const [typed, created] of [[NFC, NFC] as const, ...SPELLINGS]) {
      const { fixture, workspace } = await opened({
        files: {
          "logreq-workspace.yaml": `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: "docs/${typed}" }\n`,
        },
      });
      const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
      await workspace.get(elementStoreState);
      const missing = await workspace.get(workspaceLayoutState);
      expect(missing.metamodel.exists).toBe(false);
      const { fake, watcher } = await watched(workspace);
      // Still missing: the layout is read, compared and kept.
      fake.only().send(`docs/${created}/model.yaml`);
      await watcher.settled();
      expect(await workspace.get(workspaceLayoutState)).toBe(missing);
      // Created: an event elsewhere does not look for it; one in the folder, spelled as created,
      // reads the layout again.
      await fixture.write(`docs/${created}/model.yaml`, model);
      fake.only().send(REQUIREMENT_FILE);
      await watcher.settled();
      expect(await workspace.get(workspaceLayoutState)).toBe(missing);
      fake.only().send(`docs/${created}/model.yaml`);
      await watcher.settled();
      const found = await workspace.get(workspaceLayoutState);
      // Where the file system keeps the spellings apart, the typed folder is still missing.
      expect(found !== missing).toBe(
        await sameFolder(fixture.path(`docs/${typed}`), fixture.path(`docs/${created}`)),
      );
      expect(found.metamodel.exists).toBe(found !== missing);
    }
  });

  it("reads the layout again when the metamodel folder or a folder above it is renamed, moved, deleted or created, in any letter case (#231)", async () => {
    const { fixture, workspace } = await opened({
      files: {
        "logreq-workspace.yaml": `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: docs/model }\n`,
      },
    });
    const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
    await fixture.write("docs/model/model.yaml", model);
    await workspace.get(elementStoreState);
    expect((await workspace.get(workspaceLayoutState)).metamodel.exists).toBe(true);
    const { fake, watcher } = await watched(workspace);
    const exists = async (): Promise<boolean> => (await workspace.get(workspaceLayoutState)).metamodel.exists;
    // The folder itself renamed: it is missing now.
    await fs.rename(fixture.path("docs/model"), fixture.path("docs/renamed"));
    fake.only().send("docs/model");
    await watcher.settled();
    expect(await exists()).toBe(false);
    // Created with the folder above it (`mkdir -p`), the event naming only that folder.
    await fs.rm(fixture.path("docs"), { recursive: true });
    await fixture.write("docs/model/model.yaml", model);
    fake.only().send("docs");
    await watcher.settled();
    expect(await exists()).toBe(true);
    // The folder above it moved away, the event spelling it in another letter case.
    await fs.rename(fixture.path("docs"), fixture.path("moved"));
    fake.only().send("DOCS");
    await watcher.settled();
    expect(await exists()).toBe(false);
  });

  it("[SR-007/AK2] reads the layout again after a nameless event in another repository whose missing metamodel folder appeared (#231)", async () => {
    const { workspace } = await opened({
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: model, url: y, path: ../model }\nmetamodel: { repository: model, path: metamodel }\n",
      },
    });
    const other = path.join(workspace.root, "..", "model");
    await fs.mkdir(other, { recursive: true });
    await workspace.get(elementStoreState);
    const missing = await workspace.get(workspaceLayoutState);
    expect(missing.metamodel.exists).toBe(false);
    const { fake, watcher } = await watched(workspace);
    await fs.cp(path.join(workspace.root, "metamodel"), path.join(other, "metamodel"), { recursive: true });
    fake.of(await fs.realpath(other)).send(null);
    await watcher.settled();
    const found = await workspace.get(workspaceLayoutState);
    expect(found).not.toBe(missing);
    expect(found.metamodel.exists).toBe(true);
  });

  it("watches anew after a watch broke, and leaves out a folder that cannot be watched", async () => {
    const { workspace } = await opened();
    const fake = new FakeWatch();
    fake.throwFor.set(folderOf(await workspace.get(workspaceLayoutState)), "EACCES");
    const broken = startWatcher(workspace, { watch: fake.watch, recursive: true, debounceMs: 5 });
    onTestFinished(() => broken.close());
    await broken.ready;
    expect(fake.open()).toEqual([]);
    // Reported, so `workspace.status` can show it.
    expect(broken.problems).toEqual([
      {
        code: "workspace.not-watched",
        severity: "warning",
        repository: "system",
        file: ".",
        message:
          "Changes in this folder are not seen until LogReq restarts or the layout changes: it cannot be watched (EACCES)",
      },
    ]);

    const { fake: working, watcher } = await watched(workspace);
    const first = working.only();
    first.emitter.emit("error", new Error("EPERM"));
    await watcher.settled();
    expect(first.closed).toBe(true);
    expect(working.only()).not.toBe(first);
  });

  it("drops events of a watch whose layout is no longer watched", async () => {
    const { fixture, workspace } = await opened();
    const { fake, watcher } = await watched(workspace);
    const stale = fake.only();
    stale.send("logreq-workspace.yaml");
    await watcher.settled();
    expect(stale.closed).toBe(true);
    await workspace.get(elementStoreState);
    const store = workspace.peek(elementStoreState);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Late"));
    stale.send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBe(store);
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(await title(workspace, REQUIREMENT)).toBe("Late");
  });

  it("without a workspace file, waits for one in the root folder only", async () => {
    const fixture = await createFixtureWorkspace({ files: { "README.md": "# Not yet\n" } });
    const workspace = new Workspace(fixture.root);
    onTestFinished(async () => {
      await workspace.close();
      await fixture.cleanup();
    });
    const { fake, watcher } = await watched(workspace);
    expect(fake.open().map((h) => [h.folder, h.recursive])).toEqual([[workspace.root, false]]);
    fake.only().send("README.md");
    await watcher.settled();
    expect(fake.handles).toHaveLength(1);
    // Without details, or for `.logreq`, the layout is tried again; still none.
    for (const name of [null, ".logreq"]) {
      fake.only().send(name);
      await watcher.settled();
      expect(fake.open().map((h) => h.recursive)).toEqual([false]);
    }
    expect(fake.handles).toHaveLength(3);
    await fixture.write(
      "logreq-workspace.yaml",
      "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: metamodel }\n",
    );
    fake.only().send("logreq-workspace.yaml");
    await watcher.settled();
    expect(fake.open().map((h) => h.recursive)).toEqual([true]);
  });

  it("starts no batch once closed", async () => {
    const fixture = await createFixtureWorkspace({ files: { "README.md": "# Not yet\n" } });
    const workspace = new Workspace(fixture.root);
    onTestFinished(async () => {
      await workspace.close();
      await fixture.cleanup();
    });
    const { fake, watcher } = await watched(workspace);
    const root = fake.only();
    await watcher.close();
    root.send("logreq-workspace.yaml");
    await watcher.settled();
    expect(fake.handles).toEqual([root]);
  });

  it("processes a steady stream of events at the longest wait", async () => {
    const { fixture, workspace } = await opened();
    const store = workspace.get(elementStoreState);
    await store;
    const { fake, watcher } = await watched(workspace, { debounceMs: 50, maxWaitMs: 60 });
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Streamed"));
    // Events every 10 ms never leave 50 ms quiet, yet the batch runs after 60 ms.
    const handle = fake.only();
    const elapsed = await within(SAVE_LIMIT_MS, () => {
      handle.send(REQUIREMENT_FILE);
      return Promise.resolve(workspace.peek(elementStoreState) !== store);
    });
    expect(elapsed).toBeLessThan(SAVE_LIMIT_MS);
    await watcher.settled();
    expect(await title(workspace, REQUIREMENT)).toBe("Streamed");
  });

  it("reads the store in full on the next use when an update fails", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    workspace.get(fragile);
    const { fake, watcher } = await watched(workspace);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "After the failure"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBeUndefined();
    expect(await title(workspace, REQUIREMENT)).toBe("After the failure");
  });

  it("stops at once when closed with a batch waiting", async () => {
    const { workspace } = await opened();
    const store = workspace.get(elementStoreState);
    await store;
    const { fake, watcher } = await watched(workspace, { debounceMs: 1000 });
    fake.only().send(REQUIREMENT_FILE);
    await watcher.close();
    await watcher.settled();
    fake.handles[0]?.send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBe(store);
  });

  /** Lets timers of 0 ms that were set before it run first (Node runs timers in order). */
  const afterZeroTimers = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

  it("goes on when the reset after a failed update fails as well", async () => {
    const { workspace } = await opened();
    const store = workspace.get(elementStoreState);
    await store;
    let fail: (reason: Error) => void = () => undefined;
    const failing = new Promise<ElementStore>((_resolve, reject) => {
      fail = reject;
    });
    expect(await workspace.replace(elementStoreState, store, failing)).toBe(true);
    workspace.get(fragile);
    const { fake, watcher } = await watched(workspace, { debounceMs: 0 });
    fake.only().send(REQUIREMENT_FILE);
    await afterZeroTimers();
    // The store the batch waits for fails to build; resetting it then fails in `fragile`.
    fail(new Error("read failed"));
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBeUndefined();
    expect(workspace.peek(fragile)).toBeUndefined();
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
  });

  for (const [change, expected] of [
    ["deleted", "drops the finished update"],
    ["changed", "aborts the reads"],
  ] as const) {
    it(`stops when closed with a batch running: a ${change} file ${expected}`, async () => {
      const { fixture, workspace } = await opened();
      const release = await held(workspace);
      const pending = workspace.peek(elementStoreState);
      const { fake, watcher } = await watched(workspace, { debounceMs: 0 });
      if (change === "deleted") {
        await fs.rm(fixture.path(NEED_FILE));
        fake.only().send(NEED_FILE);
      } else {
        await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Changed"));
        fake.only().send(REQUIREMENT_FILE);
      }
      await afterZeroTimers();
      // A second batch queues behind the first one.
      fake.only().send(REQUIREMENT_FILE);
      await afterZeroTimers();
      const closing = watcher.close();
      release();
      await closing;
      await watcher.settled();
      expect(workspace.peek(elementStoreState)).toBe(pending);
    });
  }

  it("closes before the layout is read", async () => {
    const { workspace } = await opened();
    const fake = new FakeWatch();
    const watcher = startWatcher(workspace, { watch: fake.watch });
    await watcher.close();
    await watcher.ready;
    expect(fake.handles).toEqual([]);
  });

  it("does not fail on a closed workspace", async () => {
    const { workspace } = await opened();
    await workspace.close();
    const fake = new FakeWatch();
    const watcher = startWatcher(workspace, { watch: fake.watch });
    onTestFinished(() => watcher.close());
    await expect(watcher.ready).resolves.toBeUndefined();
  });
});

/** The workspace file of the per-folder tests: a nested repository, a missing one, ignore globs. */
const treeWorkspace = (metamodelRepository: string): string =>
  `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: sub, url: y, path: vendor/sub }\n  - { name: gone, url: z, path: ../gone }\nmetamodel: { repository: ${metamodelRepository}, path: metamodel }\nignore: ["site/**", "metamodel/**"]\n`;

describe("the watcher's watch per folder (SR-007, Linux)", () => {
  const perFolder = async (
    workspace: Workspace,
    fake = new FakeWatch(),
  ): Promise<{ fake: FakeWatch; watcher: ReturnType<typeof startWatcher> }> => {
    const watcher = startWatcher(workspace, { watch: fake.watch, recursive: false, debounceMs: 5 });
    onTestFinished(() => watcher.close());
    await watcher.ready;
    return { fake, watcher };
  };

  const treeFixture = (metamodelRepository = "system"): ReturnType<typeof opened> =>
    opened({
      files: {
        "logreq-workspace.yaml": treeWorkspace(metamodelRepository),
        "vendor/sub/SR-0c1d2e3f4a5b.md": requirement(OTHER, "Sub"),
        "site/docs/page.md": "# Site\n",
        "node_modules/x/a.md": "",
        "other/.git": "gitdir: elsewhere\n",
        "other/SR-1d2e3f4a5b6c.md": "",
      },
    });

  /** Watched folders relative to the workspace root (`/`), "" for the root itself. */
  const folders = (fake: FakeWatch, root: string): readonly string[] =>
    fake
      .open()
      .map((h) => {
        expect(h.recursive).toBe(false);
        return path.relative(root, h.folder).split(path.sep).join("/");
      })
      .sort();

  it("watches every folder that can hold element files with one plain watch each", async () => {
    const { workspace } = await treeFixture();
    const { fake } = await perFolder(workspace);
    // Left out: an ignored folder, installed packages, a nested repository that is not in the
    // workspace; the nested repository of the workspace has its own tree; the metamodel stays
    // watched although an ignore glob names it.
    expect(folders(fake, workspace.root)).toEqual([
      "",
      "metamodel",
      "needs",
      "requirements",
      "vendor",
      "vendor/sub",
    ]);
  });

  it("keeps the metamodel folder watched below an ignore glob when the workspace file spells it in another Unicode normal form (#225)", async () => {
    for (const [typed, onDisk] of FORMS) {
      const { workspace } = await opened({
        files: {
          "logreq-workspace.yaml": `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: "docs/${typed}" }\nignore: ["docs/**"]\n`,
          [`docs/${onDisk}/model.yaml`]: "",
          "docs/other/page.md": "",
        },
      });
      const { fake } = await perFolder(workspace);
      expect(folders(fake, workspace.root)).toEqual([
        "",
        "docs",
        `docs/${onDisk}`,
        "metamodel",
        "needs",
        "requirements",
      ]);
    }
  });

  it("keeps a folder below an ignore glob watched that may hold the missing metamodel folder in another letter case or normal form (#231)", async () => {
    for (const [typed, onDisk] of [
      ["docs", "Docs"],
      [NFC, NFD],
    ] as const) {
      const { workspace } = await opened({
        files: {
          "logreq-workspace.yaml": `logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\nmetamodel: { repository: system, path: "${typed}/metamodel" }\nignore: ["${onDisk}/**"]\n`,
          [`${onDisk}/other/page.md`]: "",
        },
      });
      expect((await workspace.get(workspaceLayoutState)).metamodel.exists).toBe(false);
      const { fake } = await perFolder(workspace);
      expect(folders(fake, workspace.root)).toEqual(["", onDisk, "metamodel", "needs", "requirements"]);
    }
  });

  it("follows events per folder: changed files, new and deleted folders, broken watches", async () => {
    const { fixture, workspace } = await treeFixture("gone");
    await workspace.get(elementStoreState);
    const layout = workspace.peek(workspaceLayoutState);
    const { fake, watcher } = await perFolder(workspace);
    // Without a metamodel folder the ignore globs leave out `metamodel` as well.
    expect(folders(fake, workspace.root)).toEqual(["", "needs", "requirements", "vendor", "vendor/sub"]);
    const root = fake.of(workspace.root);

    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Per folder"));
    fake.of(fixture.path("requirements")).send("SR-88cc6ebc472a.md");
    await watcher.settled();
    expect(await title(workspace, REQUIREMENT)).toBe("Per folder");

    // A new folder is watched with its subfolders, and its files are read.
    await fixture.write("later/deep/SR-1d2e3f4a5b6c.md", requirement(uuid(9), "Later"));
    root.send("later");
    // A folder that is watched already and a skipped one are left as they are.
    root.send("requirements");
    root.send("node_modules");
    await watcher.settled();
    expect(folders(fake, workspace.root)).toContain("later/deep");
    expect(await title(workspace, uuid(9))).toBe("Later");

    // A deleted folder: its watches are dropped and its elements are gone.
    await fs.rm(fixture.path("later"), { recursive: true });
    root.send("later");
    await watcher.settled();
    expect(folders(fake, workspace.root)).not.toContain("later");
    expect((await workspace.get(elementStoreState)).byId.has(uuid(9))).toBe(false);

    // A broken watch of a folder: dropped, the folder checked again and watched anew, without a
    // new layout.
    await fs.rm(fixture.path(NEED_FILE));
    const broken = fake.of(fixture.path("needs"));
    broken.emitter.emit("error", new Error("EPERM"));
    await watcher.settled();
    expect(broken.closed).toBe(true);
    expect(fake.of(fixture.path("needs"))).not.toBe(broken);
    expect((await workspace.get(elementStoreState)).byId.has(NEED)).toBe(false);
    expect(workspace.peek(workspaceLayoutState)).toBe(layout);
    // When it cannot be watched anew, it is reported (once, however often that happens).
    fake.throwFor.set(fixture.path("needs"), "ENOSPC");
    fake.of(fixture.path("needs")).emitter.emit("error", new Error("EPERM"));
    await watcher.settled();
    root.send("needs");
    await watcher.settled();
    expect(folders(fake, workspace.root)).not.toContain("needs");
    expect(watcher.problems.map((p) => [p.repository, p.file])).toEqual([["system", "needs"]]);
    fake.throwFor.delete(fixture.path("needs"));

    // A broken watch of the root, and no file name: every file is checked.
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Checked in full"));
    fake.of(fixture.path("requirements")).send(null);
    root.emitter.emit("error", new Error("EPERM"));
    await watcher.settled();
    expect(await title(workspace, REQUIREMENT)).toBe("Checked in full");
    expect(workspace.peek(workspaceLayoutState)).toBe(layout);
  });

  it("reports folders it cannot watch, and skips folders that vanish while it walks", async () => {
    const { fixture, workspace } = await treeFixture();
    const fake = new FakeWatch();
    fake.throwFor.set(fixture.path("needs"), "ENOSPC");
    fake.throwFor.set(fixture.path("vendor/sub"), "EACCES");
    fake.onWatch = (folder) => {
      if (folder === fixture.path("requirements")) {
        nodeFs.rmSync(folder, { recursive: true });
      }
    };
    const { watcher } = await perFolder(workspace, fake);
    expect(folders(fake, workspace.root)).toEqual(["", "metamodel", "vendor"]);
    expect(watcher.problems.map((p) => [p.repository, p.file, p.message])).toEqual([
      [
        "system",
        "needs",
        "Changes in this folder are not seen until LogReq restarts or the layout changes: the operating system's limit of watched folders is reached (ENOSPC; on Linux raise fs.inotify.max_user_watches)",
      ],
      [
        "sub",
        ".",
        "Changes in this folder are not seen until LogReq restarts or the layout changes: it cannot be watched (EACCES)",
      ],
    ]);
    expect(watcherProblems(workspace)).toEqual([]);
  });

  it("stops walking and ignores events once closed", async () => {
    const { fixture, workspace } = await treeFixture();
    const fake = new FakeWatch();
    const started: { watcher?: ReturnType<typeof startWatcher> } = {};
    fake.onWatch = (folder) => {
      if (folder === fixture.path("needs")) {
        void started.watcher?.close();
      }
    };
    const watcher = startWatcher(workspace, { watch: fake.watch, recursive: false });
    started.watcher = watcher;
    await watcher.ready;
    const opened = fake.handles.map((h) => path.relative(workspace.root, h.folder).split(path.sep).join("/"));
    expect(opened).not.toContain("requirements");
    // The tree of the second repository is never opened.
    expect(opened).not.toContain("vendor/sub");
    expect(fake.open()).toEqual([]);
    fake.handles[0]?.send("needs");
    fake.handles[0]?.emitter.emit("error", new Error("EPERM"));
    await watcher.settled();
    expect(fake.open()).toEqual([]);
  });

  it("watches a folder anew that was deleted and created again, moved away, or replaced", async () => {
    const { fixture, workspace } = await treeFixture();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await perFolder(workspace);
    const root = fake.of(workspace.root);

    // Deleted and created again: Linux names the watched folder itself; its watch is dropped at
    // once, as the new folder may have the same inode.
    const first = fake.of(fixture.path("needs"));
    await fs.rm(fixture.path("needs"), { recursive: true });
    await fixture.write(NEED_FILE, need(NEED, "Created again"));
    first.send("needs");
    expect(first.closed).toBe(true);
    await watcher.settled();
    const second = fake.of(fixture.path("needs"));
    expect(second).not.toBe(first);
    expect(await title(workspace, NEED)).toBe("Created again");

    // Replaced by another folder, reported only to its parent: the inode differs.
    await fixture.write("next/deep/N-8beffcbd8c26.md", need(NEED, "Replaced"));
    await fs.rename(fixture.path("needs"), fixture.path("old"));
    await fs.rename(fixture.path("next"), fixture.path("needs"));
    root.send("needs");
    await watcher.settled();
    expect(second.closed).toBe(true);
    expect(folders(fake, workspace.root)).toContain("needs/deep");
    expect(records(await workspace.get(elementStoreState), NEED).map((r) => r.file)).toContain(
      "needs/deep/N-8beffcbd8c26.md",
    );

    // A folder that kept its inode keeps its watch; a subfolder found in it is watched and read.
    const kept = fake.of(fixture.path("needs"));
    await fixture.write("needs/added/SR-1d2e3f4a5b6c.md", requirement(uuid(9), "Added"));
    root.send("needs");
    await watcher.settled();
    expect(fake.of(fixture.path("needs"))).toBe(kept);
    expect(folders(fake, workspace.root)).toContain("needs/added");
    expect(await title(workspace, uuid(9))).toBe("Added");

    // A folder that became a file, and a `change` naming the folder itself, are no new folders.
    await fs.rm(fixture.path("old"), { recursive: true });
    await fixture.write("old", "");
    root.send("old");
    kept.send("needs", "change");
    await watcher.settled();
    expect(folders(fake, workspace.root)).not.toContain("old");
    expect(fake.of(fixture.path("needs"))).toBe(kept);

    // The folder goes while its new watch attaches: the walk that its drop queued takes over.
    let again = true;
    fake.onWatch = (folder) => {
      if (folder === fixture.path("needs") && again) {
        again = false;
        queueMicrotask(() => {
          fake.of(fixture.path("needs")).send("needs");
        });
      }
    };
    kept.send("needs");
    await watcher.settled();
    expect(again).toBe(false);
    expect(folders(fake, workspace.root)).toContain("needs");

    // A folder that became a file in its place is not watched.
    const last = fake.of(fixture.path("needs"));
    await fs.rm(fixture.path("needs"), { recursive: true });
    await fixture.write("needs", "");
    last.send("needs");
    await watcher.settled();
    expect(folders(fake, workspace.root)).not.toContain("needs");
  });

  it("reads the layout again when a repository folder is gone", async () => {
    const { fixture, workspace } = await treeFixture();
    const layout = await workspace.get(workspaceLayoutState);
    const { fake, watcher } = await perFolder(workspace);
    const sub = fake.of(fixture.path("vendor/sub"));
    await fs.rm(fixture.path("vendor/sub"), { recursive: true });
    sub.send("sub");
    await watcher.settled();
    expect(workspace.peek(workspaceLayoutState)).not.toBe(layout);
    expect(folders(fake, workspace.root)).toEqual(["", "metamodel", "needs", "requirements", "vendor"]);
  });

  it("drops a start that a new layout overtook, with its watches and its events", async () => {
    const { fixture, workspace } = await treeFixture();
    await workspace.get(elementStoreState);
    const fake = new FakeWatch();
    // The first start waits in the walk of `needs` until the layout changed and was watched anew.
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const readdir = fs.readdir.bind(fs);
    let held = 0;
    const spy = vi.spyOn(fs, "readdir").mockImplementation(async (...args: Parameters<typeof fs.readdir>) => {
      if (args[0] === fixture.path("needs") && held++ === 0) {
        await gate;
      }
      return readdir(...args);
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    const watcher = startWatcher(workspace, { watch: fake.watch, recursive: false, debounceMs: 0 });
    onTestFinished(() => watcher.close());
    await vi.waitFor(() => {
      expect(held).toBe(1);
    });
    const stale = fake.of(workspace.root);
    await fixture.write("logreq-workspace.yaml", treeWorkspace("system").replace("name: W", "name: V"));
    stale.send("logreq-workspace.yaml");
    await vi.waitFor(() => {
      expect(fake.open().filter((h) => h.folder === workspace.root)).toHaveLength(1);
      expect(fake.of(workspace.root)).not.toBe(stale);
    });
    release();
    await watcher.ready;
    await watcher.settled();
    // One watch per folder, all of the new start; the second repository is watched once.
    expect(folders(fake, workspace.root)).toEqual([
      "",
      "metamodel",
      "needs",
      "requirements",
      "vendor",
      "vendor/sub",
    ]);
    const store = workspace.peek(elementStoreState);
    // An event of the old start is not sorted with the new layout.
    stale.send("requirements/SR-88cc6ebc472a.md");
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBe(store);
  });

  it("reports nothing when the root of a folder without workspace cannot be watched", async () => {
    const fixture = await createFixtureWorkspace({ files: { "README.md": "# Not yet\n" } });
    const workspace = new Workspace(fixture.root);
    onTestFinished(async () => {
      await workspace.close();
      await fixture.cleanup();
    });
    const fake = new FakeWatch();
    fake.throwFor.set(workspace.root, "EACCES");
    const watcher = startWatcher(workspace, { watch: fake.watch });
    onTestFinished(() => watcher.close());
    await watcher.ready;
    expect(watcher.problems).toEqual([]);
  });
});

describe("watcherProblems (SR-007)", () => {
  it("gives the folders the workspace's watcher cannot watch, for workspace.status", async () => {
    const { workspace } = await opened();
    expect(watcherProblems(workspace)).toEqual([]);
    const watch = vi.spyOn(nodeFs, "watch").mockImplementation(() => {
      throw Object.assign(new Error("limit"), { code: "ENOSPC" });
    });
    onTestFinished(() => {
      watch.mockRestore();
    });
    await watchWorkspace(workspace).ready;
    expect(watcherProblems(workspace).map((p) => [p.code, p.repository, p.file])).toEqual([
      ["workspace.not-watched", "system", "."],
    ]);
    const status = (await invoke("workspace.status", {}, { workspace })) as {
      problems: readonly { code: string }[];
    };
    expect(status.problems.map((p) => p.code)).toContain("workspace.not-watched");
  });
});

describe("the watcher and LogReq's own writes (#166)", () => {
  it("does not apply a write of element.update or element.create a second time when it sees the file", async () => {
    const { workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    await invoke("element.update", { ref: REQUIREMENT, title: "Renamed by LogReq" }, { workspace });
    const created = (await invoke("element.create", { type: "need", title: "New" }, { workspace })) as {
      readonly files: readonly string[];
    };
    const store = workspace.peek(elementStoreState);
    expect(store).toBeDefined();
    const shortIds = await workspace.get(shortIdState);
    expect(await title(workspace, REQUIREMENT)).toBe("Renamed by LogReq");
    fake.only().send(REQUIREMENT_FILE, "change");
    fake.only().send(String(created.files[0]));
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBe(store);
    expect(await workspace.get(shortIdState)).toBe(shortIds);
  });
});

/** Every change the watcher reports from now on, in order (`onChange`, #331). */
const changesOf = (watcher: WorkspaceWatcher): WorkspaceChange[] => {
  const seen: WorkspaceChange[] = [];
  onTestFinished(
    watcher.onChange((change) => {
      seen.push(change);
    }),
  );
  return seen;
};

const elements = (
  added: readonly string[] = [],
  changed: readonly string[] = [],
  removed: readonly string[] = [],
): WorkspaceChange["elements"] => ({ added, changed, removed });

/** Every UUID the changes name under `kind`. */
const named = (changes: readonly WorkspaceChange[], kind: keyof WorkspaceChange["elements"]): Set<string> =>
  new Set(changes.flatMap((c) => c.elements[kind]));

/** The last list each UUID appears in, over all changes in order. */
const lastNamed = (changes: readonly WorkspaceChange[]): Map<string, keyof WorkspaceChange["elements"]> => {
  const last = new Map<string, keyof WorkspaceChange["elements"]>();
  for (const change of changes) {
    for (const kind of ["added", "changed", "removed"] as const) {
      for (const id of change.elements[kind]) {
        last.set(id, kind);
      }
    }
  }
  return last;
};

describe("the watcher tells its listeners what changed (#331, SR-007)", () => {
  it("[SR-007/AK1] tells a listener within 2 seconds that an element file saved by another editor changed, once the store holds it", async () => {
    const { fixture, workspace } = await opened();
    await watching(fixture, workspace);
    const stores: (Promise<ElementStore> | undefined)[] = [];
    const changes: WorkspaceChange[] = [];
    onTestFinished(
      watchWorkspace(workspace).onChange((change) => {
        changes.push(change);
        stores.push(workspace.peek(elementStoreState));
      }),
    );
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Told to the app"));
    const elapsed = await within(SAVE_LIMIT_MS, () =>
      Promise.resolve(named(changes, "changed").has(REQUIREMENT)),
    );
    expect(elapsed).toBeLessThanOrEqual(SAVE_LIMIT_MS);
    const index = changes.findIndex((c) => c.elements.changed.includes(REQUIREMENT));
    expect(changes[index]).toEqual({ scope: "elements", elements: elements([], [REQUIREMENT]) });
    // The listener is called after the new store is in place: what it reads is the saved file.
    const store = await stores[index];
    expect(store === undefined ? undefined : records(store, REQUIREMENT)[0]?.data["title"]).toBe(
      "Told to the app",
    );
  });

  it("[SR-007/AK2] names every element a pull of 1,000 files changed or added, in a few batches within 10 seconds", async () => {
    const count = 1000;
    const files: Record<string, string> = {};
    for (let i = 1; i <= count; i++) {
      files[`pulled/SR-${uuid(i).slice(-12)}.md`] = requirement(uuid(i), `Requirement ${String(i)}`);
    }
    const { fixture, workspace } = await opened({ git: true });
    const before = await fixture.commitFiles(files);
    const target = uuid(count + 1);
    const upstreamFiles: Record<string, string> = {
      [`needs/N-${target.slice(-12)}.md`]: need(target, "Gusts"),
    };
    for (let i = 1; i <= count; i++) {
      upstreamFiles[`pulled/SR-${uuid(i).slice(-12)}.md`] = requirement(
        uuid(i),
        `Requirement ${String(i)}`,
        "approved",
        target,
      );
    }
    const upstream = await fixture.commitFiles(upstreamFiles, { parent: before, message: "upstream" });
    await fixture.git(["reset", "--quiet", "--hard", before]);
    await workspace.get(elementStoreState);
    await watching(fixture, workspace);
    const changes = changesOf(watchWorkspace(workspace));
    await fixture.git(["merge", "--ff-only", upstream]);
    const pulled = Array.from({ length: count }, (_, i) => uuid(i + 1));
    // What counts is the last list a UUID appears in: a batch that is due while Git still writes a
    // file reads it as no element (`removed`), a later one reads it in full (`added`).
    const shown = (last: ReadonlyMap<string, string>, id: string): boolean =>
      ["added", "changed"].includes(String(last.get(id)));
    const elapsed = await within(PULL_LIMIT_MS, async () => {
      const last = lastNamed(changes);
      const now = await workspace.get(elementStoreState);
      return (
        shown(last, target) &&
        named(changes, "added").has(target) &&
        pulled.every((id) => shown(last, id) && records(now, id)[0]?.data["status"] === "approved")
      );
    });
    expect(elapsed).toBeLessThanOrEqual(PULL_LIMIT_MS);
    await watchWorkspace(workspace).settled();
    const last = lastNamed(changes);
    expect(pulled.every((id) => shown(last, id))).toBe(true);
    // Only the pulled elements are named, and each one removed is added again later.
    expect([...last.keys()].sort()).toEqual([...pulled, target].sort());
    // Batched (100 ms after the last event, at most 1 s after the first), not one call per file.
    expect(changes.length).toBeLessThanOrEqual(count / 10);
    expect(changes.every((c) => c.scope === "elements")).toBe(true);
  }, 60_000);

  it("[SR-007/AK3] names an element whose file was deleted outside the tool as removed", async () => {
    const { fixture, workspace } = await opened();
    await watching(fixture, workspace);
    const changes = changesOf(watchWorkspace(workspace));
    await fs.rm(fixture.path(NEED_FILE));
    await within(PULL_LIMIT_MS, () => Promise.resolve(named(changes, "removed").has(NEED)));
    expect(named(changes, "added")).toEqual(new Set());
    expect(named(changes, "changed")).toEqual(new Set());
    expect((await workspace.get(elementStoreState)).byId.has(NEED)).toBe(false);
  });

  it("names added, changed and removed elements of one batch, sorted, and a moved or copied file as changed", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const changes = changesOf(watcher);
    // One batch: a new element, a changed one, a deleted one.
    await fixture.write("requirements/SR-0c1d2e3f4a5b.md", requirement(OTHER, "New"));
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Changed"));
    await fs.rm(fixture.path(NEED_FILE));
    fake.only().send("requirements/SR-0c1d2e3f4a5b.md");
    fake.only().send(REQUIREMENT_FILE);
    fake.only().send(NEED_FILE);
    await watcher.settled();
    expect(changes).toEqual([{ scope: "elements", elements: elements([OTHER], [REQUIREMENT], [NEED]) }]);
    // A file moved to another folder, and a copy with the same UUID: the same UUID, other records.
    await fs.mkdir(fixture.path("moved"));
    await fs.rename(
      fixture.path("requirements/SR-0c1d2e3f4a5b.md"),
      fixture.path("moved/SR-0c1d2e3f4a5b.md"),
    );
    await fs.copyFile(fixture.path(REQUIREMENT_FILE), fixture.path("moved/copy.md"));
    fake.only().send("requirements/SR-0c1d2e3f4a5b.md");
    fake.only().send("moved");
    await watcher.settled();
    expect(changes[1]).toEqual({ scope: "elements", elements: elements([], [REQUIREMENT, OTHER].sort()) });
    expect(changes).toHaveLength(2);
    // Plain frozen data: one object for every listener, and nothing a listener can change.
    expect(Object.isFrozen(changes[1])).toBe(true);
    expect(Object.isFrozen(changes[1]?.elements.changed)).toBe(true);
  });

  it("reports a changed file that is no element with empty lists, and nothing for a batch that changed nothing or a store nobody read", async () => {
    const { fixture, workspace } = await opened();
    const { fake, watcher } = await watched(workspace);
    const changes = changesOf(watcher);
    // The store was not read: nothing was replaced, nobody is told.
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(changes).toEqual([]);
    await workspace.get(elementStoreState);
    // Git's folder, other files, a file read again with the same contents: nothing changed.
    fake.only().send(".git/index");
    fake.only().send("docs/image.png");
    fake.only().send(NEED_FILE);
    await watcher.settled();
    expect(changes).toEqual([]);
    // A faulty file and a Markdown file without frontmatter are no elements, but the findings differ.
    await fixture.write("broken.md", "---\nid: [\n---\n");
    fake.only().send("broken.md");
    await watcher.settled();
    expect(changes).toEqual([{ scope: "elements", elements: elements() }]);
  });

  it("reports a changed metamodel, with the elements of the same batch", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const changes = changesOf(watcher);
    fake.only().send("metamodel/model.yaml");
    await watcher.settled();
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "With a new metamodel"));
    fake.only().send("metamodel/model.yaml");
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(changes).toEqual([
      { scope: "metamodel", elements: elements() },
      { scope: "metamodel", elements: elements([], [REQUIREMENT]) },
    ]);
  });

  it("reports a new layout once the new repositories are watched, and a failed update, as a change of the whole workspace", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const first = fake.only();
    const watchedWhenTold: boolean[] = [];
    onTestFinished(
      watcher.onChange(() => {
        watchedWhenTold.push(first.closed && fake.open().length === 1);
      }),
    );
    const changes = changesOf(watcher);
    first.send("logreq-workspace.yaml");
    await watcher.settled();
    expect(changes).toEqual([{ scope: "workspace", elements: elements() }]);
    expect(watchedWhenTold).toEqual([true]);
    // An update that fails resets the store: nothing names what changed.
    await workspace.get(elementStoreState);
    workspace.get(fragile);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "After the failure"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(workspace.peek(elementStoreState)).toBeUndefined();
    expect(changes).toEqual([
      { scope: "workspace", elements: elements() },
      { scope: "workspace", elements: elements() },
    ]);
  });

  it("stops calling a listener that unsubscribed, goes on past one that throws or rejects, and tells nobody once closed", async () => {
    const { fixture, workspace } = await opened();
    const store = workspace.get(elementStoreState);
    await store;
    const { fake, watcher } = await watched(workspace);
    const throwing = vi.fn(() => {
      throw new Error("listener failed");
    });
    const unsubscribeThrowing = watcher.onChange(throwing);
    // Not awaited, and its rejection is dropped (an unhandled one would fail the test run).
    const rejecting = vi.fn(() => Promise.reject(new Error("asynchronous listener failed")));
    onTestFinished(watcher.onChange(rejecting));
    const later = changesOf(watcher);
    let calls = 0;
    const counting = (): void => {
      calls += 1;
    };
    // The same function twice: called twice, each subscription ends on its own.
    const unsubscribe = watcher.onChange(counting);
    const twice = watcher.onChange(counting);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Once"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(rejecting).toHaveBeenCalledTimes(1);
    expect(later).toHaveLength(1);
    expect(calls).toBe(2);
    unsubscribe();
    unsubscribeThrowing();
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Twice"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(calls).toBe(3);
    expect(later).toHaveLength(2);
    expect(await title(workspace, REQUIREMENT)).toBe("Twice");
    twice();
    // Closed with a batch running: the store is replaced by nobody, and nobody is told.
    const release = await held(workspace);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Never told"));
    fake.only().send(REQUIREMENT_FILE);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closing = watcher.close();
    release();
    await closing;
    expect(later).toHaveLength(2);
  });

  it("calls no listener that one before it unsubscribed", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const after = vi.fn();
    // One that unsubscribes itself is called once.
    const once = vi.fn(() => {
      unsubscribeOnce();
    });
    const unsubscribeOnce = watcher.onChange(once);
    let unsubscribeNext: () => void = () => undefined;
    watcher.onChange(() => {
      unsubscribeNext();
    });
    unsubscribeNext = watcher.onChange(after);
    const seen = changesOf(watcher);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "First"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    // The second listener unsubscribed the third before its turn; the last one is still called.
    expect(after).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Second"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(once).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
  });

  it("calls no further listener once one of them closed the watcher", async () => {
    const { fixture, workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    let closing: Promise<void> | undefined;
    watcher.onChange(() => {
      closing = watcher.close();
    });
    const second = vi.fn();
    watcher.onChange(second);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Closed by a listener"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    await closing;
    expect(closing).toBeDefined();
    expect(second).not.toHaveBeenCalled();
    // The store was updated before the listeners were told.
    expect(await title(workspace, REQUIREMENT)).toBe("Closed by a listener");
  });

  it("reports a store that a batch read in full as a change of the whole workspace", async () => {
    const { fixture, workspace } = await opened();
    const store = workspace.get(elementStoreState);
    const loaded = await store;
    // A store without what each file contributed: the next batch reads it in full.
    const { repositories: _dropped, ...bare } = loaded;
    expect(await workspace.replace(elementStoreState, store, Promise.resolve(bare))).toBe(true);
    const { fake, watcher } = await watched(workspace);
    const changes = changesOf(watcher);
    await fixture.write(REQUIREMENT_FILE, requirement(REQUIREMENT, "Read in full"));
    fake.only().send(REQUIREMENT_FILE);
    await watcher.settled();
    expect(changes).toEqual([{ scope: "workspace", elements: elements() }]);
    expect(await title(workspace, REQUIREMENT)).toBe("Read in full");
  });

  it("tells nobody about LogReq's own writes when it sees their files (#166)", async () => {
    const { workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const changes = changesOf(watcher);
    await invoke("element.update", { ref: REQUIREMENT, title: "Renamed by LogReq" }, { workspace });
    const created = (await invoke("element.create", { type: "need", title: "New" }, { workspace })) as {
      readonly files: readonly string[];
    };
    fake.only().send(REQUIREMENT_FILE, "change");
    fake.only().send(String(created.files[0]));
    await watcher.settled();
    expect(changes).toEqual([]);
  });

  it("tells nobody when it was closed while a batch read the layout again", async () => {
    const { workspace } = await opened();
    await workspace.get(elementStoreState);
    const { fake, watcher } = await watched(workspace);
    const changes = changesOf(watcher);
    // Closed while the batch resets the layout (a state built on it closes the watcher on disposal).
    let closing: Promise<void> | undefined;
    const closer = defineWorkspaceState("closes-the-watcher", () => 1, {
      dependsOn: [workspaceLayoutState],
      dispose: () => {
        closing = watcher.close();
      },
    });
    workspace.get(closer);
    fake.only().send("logreq-workspace.yaml");
    await watcher.settled();
    await closing;
    expect(closing).toBeDefined();
    expect(changes).toEqual([]);
  });
});
