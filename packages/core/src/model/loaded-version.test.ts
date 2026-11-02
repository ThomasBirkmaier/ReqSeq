// The versions an element gets while the store is read (#439, `loaded-version.ts`): each must equal
// the version reading its file now gives (`currentVersions`, the lazy path), in this thread, in the
// read workers, after a watcher batch and a write; elements whose text links an image, and values
// without a normal form, get none; the model cache holds none yet.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { NORMAL_FORM } from "../version/version.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { currentVersionOf, currentVersions } from "./current-versions.js";
import type { ElementRecord } from "./elements.js";
import type { Versioning } from "./loaded-version.js";
import {
  internedVersion,
  loadedVersion,
  typeVersioningOf,
  versionDefinitions,
  versioningOf,
} from "./loaded-version.js";
import { MODEL_CACHE_FILE, RACY_MS, loadThroughCache } from "./model-cache.js";
import type { ElementStore } from "./store.js";
import {
  elementStoreState,
  loadElements,
  loadedVersionsOf,
  updateElements,
  withWrittenFiles,
  workspaceVersioning,
} from "./store.js";
import { readElementFile } from "../files/index.js";

/** `value`, which the test expects to be there. */
const defined = (value: Versioning | undefined): Versioning => {
  if (value === undefined) {
    throw new Error("expected a versioning");
  }
  return value;
};

const ID = (n: number): string => `9d9d9d9d-9999-4999-8999-${n.toString(16).padStart(12, "0")}`;

const need = (id: string, text: string, extra = ""): string =>
  `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: A need\n${extra}---\n\n${text}\n`;

/** Elements of every kind the version as read tells apart. */
const FILES: Readonly<Record<string, string>> = {
  "loaded/N-1.md": need(ID(1), "Plain text.", "priority: high\n"),
  "loaded/N-2.md": need(ID(2), "Line one.  \r\nLine two.\r\n\r\n\r\n").replaceAll("\n", "\r\n"),
  "loaded/N-3.md": `\uFEFF${need(ID(3), "With a byte order mark.")}`,
  "loaded/N-4.md": need(ID(4), "An image: ![a](img/a.png)"),
  "loaded/N-5.md": need(ID(5), "A missing image: ![b](img/gone.png)"),
  "loaded/N-6.md": need(ID(6), "An external image: ![c](https://example.com/c.png)"),
  "loaded/X-7.md": `---\nid: ${ID(7)}\ntype: no-such-type\ntitle: Unknown\n---\n\nText.\n`,
  "loaded/img/a.png": "A",
  "loaded/plain.md": "# Not an element\n",
};

const open = async (
  files: Readonly<Record<string, string>> = FILES,
  options: { readonly cacheFolder?: string } = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-019/findings", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root, options);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const byFile = (store: ElementStore, file: string): ElementRecord => {
  const found = store.elements.find((e) => e.file === file);
  if (found === undefined) {
    throw new Error(`no element in ${file}`);
  }
  return found;
};

/** Every loaded version of `store` equals the version reading its file now gives; returns the files with one. */
const expectAsRead = async (workspace: Workspace, store: ElementStore): Promise<string[]> => {
  const versions = await currentVersions(workspace);
  const versioning = store.versioning;
  expect(versioning).toBeDefined();
  const loaded = loadedVersionsOf(store);
  for (const [record, version] of loaded) {
    expect(store.elements).toContain(record);
    expect(version.byForm[NORMAL_FORM], record.file).toBe(currentVersionOf(versions, record));
    expect(Object.keys(version.byForm)).toEqual([NORMAL_FORM]);
    expect(version.fingerprint).toBe(typeVersioningOf(defined(versioning), record.type).fingerprint);
  }
  return [...loaded.keys()].map((r) => r.file);
};

describe("versions as read (#439)", () => {
  it("gives each element without image links its version as read, equal to the version its file gives now", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const files = await expectAsRead(workspace, store);
    // Every element of the fixture and of FILES has one, except those whose text links an image.
    expect(files).toEqual(
      store.elements.map((e) => e.file).filter((f) => !["loaded/N-4.md", "loaded/N-5.md"].includes(f)),
    );
    expect(files).toEqual(
      expect.arrayContaining(["loaded/N-2.md", "loaded/N-3.md", "loaded/N-6.md", "loaded/X-7.md"]),
    );
    // The same map on every call for one store.
    expect(loadedVersionsOf(store)).toBe(loadedVersionsOf(store));
  });

  it("gives the same versions in the read workers as in this thread", async () => {
    const { workspace } = await open();
    const layout = await workspace.get(workspaceLayoutState);
    const versioning = versioningOf(await workspace.get(metamodelState));
    const inThread = await loadElements(layout, undefined, { versioning });
    const pooled = await loadElements(layout, undefined, { versioning, workers: 1, workerThreshold: 1 });
    expect(pooled).toEqual(inThread);
    expect(pooled.versioning).toBe(versioning);
    expect(loadedVersionsOf(pooled).size).toBeGreaterThan(0);
    expect([...loadedVersionsOf(pooled).values()].map((v) => v.byForm)).toEqual(
      [...loadedVersionsOf(inThread).values()].map((v) => v.byForm),
    );
    // Promised (as `elementStoreState` passes it) gives the same.
    expect(await loadElements(layout, undefined, { versioning: Promise.resolve(versioning) })).toEqual(
      inThread,
    );
  });

  it("gives no versions without a valid metamodel, and a store without repositories has none", async () => {
    const { workspace } = await open();
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    expect(versioningOf(undefined)).toBeUndefined();
    expect(versioningOf({ ...metamodel, valid: false })).toBeUndefined();
    const none = await loadElements(layout, undefined, { versioning: Promise.resolve(undefined) });
    expect(none.versioning).toBeUndefined();
    expect(loadedVersionsOf(none).size).toBe(0);
    const { repositories: _repositories, ...plain } = await workspace.get(elementStoreState);
    expect(loadedVersionsOf(plain).size).toBe(0);
  });

  it("gives the changed element its new version after a watcher batch and a write, and keeps the others", async () => {
    const { fixture, workspace } = await open();
    const layout = await workspace.get(workspaceLayoutState);
    const before = await workspace.get(elementStoreState);
    const old = loadedVersionsOf(before).get(byFile(before, "loaded/N-1.md"));
    await fixture.write("loaded/N-1.md", need(ID(1), "Changed text.", "priority: high\n"));
    const next = await updateElements(before, layout, new Map([["system", { paths: ["loaded/N-1.md"] }]]));
    if (next === undefined) {
      throw new Error("expected a new store");
    }
    expect(next.versioning).toBe(before.versioning);
    const changed = loadedVersionsOf(next).get(byFile(next, "loaded/N-1.md"));
    expect(changed?.byForm[NORMAL_FORM]).not.toBe(old?.byForm[NORMAL_FORM]);
    const kept = byFile(before, "loaded/N-3.md");
    expect(loadedVersionsOf(next).get(kept)).toBe(loadedVersionsOf(before).get(kept));
    // Read in full (no per-file contents): still with the store's versioning.
    const { repositories: _repositories, ...plain } = before;
    const full = await updateElements(plain, layout, new Map());
    expect(full?.versioning).toBe(before.versioning);
    expect(loadedVersionsOf(full ?? before).get(byFile(full ?? before, "loaded/N-1.md"))).toEqual(changed);
    // A write: the bytes written give the version, as a read of them would.
    await fixture.write("loaded/N-3.md", need(ID(3), "Written text."));
    const read = await readElementFile(fixture.root, "loaded/N-3.md");
    if (read.kind !== "parsed") {
      throw new Error("expected a parsed file");
    }
    const written = await withWrittenFiles(next, layout, [
      { repository: "system", file: read.file, replaced: byFile(next, "loaded/N-3.md").snapshot },
    ]);
    if (written === undefined) {
      throw new Error("expected a new store");
    }
    expect(written.versioning).toBe(before.versioning);
    await workspace.reset(elementStoreState);
    const fresh = await workspace.get(elementStoreState);
    expect(loadedVersionsOf(written).get(byFile(written, "loaded/N-3.md"))).toEqual(
      loadedVersionsOf(fresh).get(byFile(fresh, "loaded/N-3.md")),
    );
    await expectAsRead(workspace, fresh);
  });

  it("writes the versions into the model cache per form, so a store from it has them as read (#439)", async () => {
    const cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-loaded-"));
    onTestFinished(() => fs.rm(cacheFolder, { recursive: true, force: true }));
    const { fixture, workspace } = await open(FILES, { cacheFolder });
    // Files older than the racy window, and a load that starts once their change times settled (model-cache.test.ts).
    const when = new Date(Date.now() - 60_000);
    for (const entry of await fs.readdir(fixture.root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        await fs.utimes(path.join(entry.parentPath, entry.name), when, when);
      }
    }
    const layout = await workspace.get(workspaceLayoutState);
    const versioning = versioningOf(await workspace.get(metamodelState));
    const store = await loadThroughCache(
      workspace,
      cacheFolder,
      layout,
      (reuse) => loadElements(layout, undefined, { versioning, ...(reuse === undefined ? {} : { reuse }) }),
      () => Date.now() + RACY_MS + 200,
    );
    const loaded = loadedVersionsOf(store);
    expect(loaded.size).toBeGreaterThan(0);
    await workspace.close();
    const text = await fs.readFile(path.join(cacheFolder, MODEL_CACHE_FILE), "utf8");
    expect(text).toContain("loaded/N-1.md");
    expect(text).toContain('"byForm":{"n1":');
    // A start from the cache reuses every entry, with its version.
    const again = new Workspace(fixture.root, { cacheFolder });
    onTestFinished(() => again.close());
    const cached = await loadThroughCache(
      again,
      cacheFolder,
      layout,
      (reuse) => loadElements(layout, undefined, { versioning, ...(reuse === undefined ? {} : { reuse }) }),
      () => Date.now() + RACY_MS + 200,
    );
    const byFile = (versions: typeof loaded): Record<string, unknown> =>
      Object.fromEntries([...versions].map(([record, version]) => [record.file, version]));
    expect(byFile(loadedVersionsOf(cached))).toEqual(byFile(loaded));
  });
});

describe("versions as read and the metamodel (#439)", () => {
  it("reads the store without building the metamodel state", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    expect(workspace.peek(metamodelState)).toBeUndefined();
    expect(loadedVersionsOf(store).size).toBeGreaterThan(0);
  });

  it("asks for no versioning when no file is read, and a versioning that fails gives none", async () => {
    const { workspace } = await open();
    const layout = await workspace.get(workspaceLayoutState);
    const first = await workspace.get(elementStoreState);
    const reused = new Map(first.repositories?.[0]?.files ?? []);
    let asked = 0;
    const counted = (): Promise<Versioning | undefined> => {
      asked += 1;
      return Promise.resolve(first.versioning);
    };
    const fromReuse = await loadElements(layout, undefined, {
      versioning: counted,
      reuse: () => Promise.resolve({ reused, read: [] }),
    });
    expect(asked).toBe(0);
    expect(fromReuse.versioning).toBeUndefined();
    expect(fromReuse.elements).toEqual(first.elements);
    for (const versioning of [
      (): Promise<Versioning | undefined> => Promise.reject(new Error("no metamodel")),
      // A source that throws at once (a bug in `versioningOf`, say).
      (): Promise<Versioning | undefined> => {
        throw new TypeError("a bug");
      },
    ]) {
      const none = await loadElements(layout, undefined, { versioning });
      expect(none.versioning).toBeUndefined();
      expect(loadedVersionsOf(none).size).toBe(0);
      expect(none.elements).toHaveLength(first.elements.length);
    }
  });

  it("gives files read after a metamodel change the new fingerprint of a changed type only", async () => {
    const { fixture, workspace } = await open();
    const layout = await workspace.get(workspaceLayoutState);
    const before = await workspace.get(elementStoreState);
    const old = defined(before.versioning);
    const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
    await fixture.write(
      "metamodel/model.yaml",
      model.replace(
        "{ key: weight, name: Weight, kind: number }",
        "{ key: weight, name: Weight, kind: number, content: true }",
      ),
    );
    await workspace.reset(metamodelState);
    const now = defined(versioningOf(await workspace.get(metamodelState)));
    expect(typeVersioningOf(now, "system-requirement").fingerprint).not.toBe(
      typeVersioningOf(old, "system-requirement").fingerprint,
    );
    expect(typeVersioningOf(now, "need").fingerprint).toBe(typeVersioningOf(old, "need").fingerprint);
    const requirement = before.elements.find((e) => e.type === "system-requirement");
    const kept = byFile(before, "loaded/N-3.md");
    if (requirement === undefined) {
      throw new Error("no requirement");
    }
    await fixture.write(
      requirement.file,
      `${await fs.readFile(fixture.path(requirement.file), "utf8")}\nMore.\n`,
    );
    await fixture.write("loaded/N-1.md", need(ID(1), "Changed after the metamodel.", "priority: high\n"));
    const next = await updateElements(
      before,
      layout,
      new Map([["system", { paths: [requirement.file, "loaded/N-1.md"] }]]),
      undefined,
      workspaceVersioning(workspace, layout),
    );
    if (next === undefined) {
      throw new Error("expected a new store");
    }
    expect(next.versioning).toEqual(now);
    const loaded = loadedVersionsOf(next);
    const changed = byFile(next, requirement.file);
    expect(loaded.get(changed)?.fingerprint).toBe(typeVersioningOf(now, "system-requirement").fingerprint);
    expect(loaded.get(byFile(next, "loaded/N-1.md"))?.fingerprint).toBe(
      typeVersioningOf(old, "need").fingerprint,
    );
    // A file not read again keeps the fingerprint it was read with.
    expect(loaded.get(kept)).toBe(loadedVersionsOf(before).get(kept));
    // Its version is the one the new metamodel gives.
    const versions = await currentVersions(workspace);
    const record = (await workspace.get(elementStoreState)).elements.find((e) => e.file === requirement.file);
    if (record === undefined) {
      throw new Error("no requirement");
    }
    expect(loaded.get(changed)?.byForm[NORMAL_FORM]).toBe(currentVersionOf(versions, record));
    // A write after the change gets the new fingerprint too.
    const read = await readElementFile(fixture.root, requirement.file);
    if (read.kind !== "parsed") {
      throw new Error("expected a parsed file");
    }
    const { repositories: _r, versioning: _v, ...withoutVersioning } = next;
    const written = await withWrittenFiles(
      { ...withoutVersioning, repositories: next.repositories ?? [] },
      layout,
      [
        {
          repository: "system",
          file: { ...read.file, snapshot: { ...read.file.snapshot, mtimeMs: 1 } },
          replaced: changed.snapshot,
        },
      ],
      workspaceVersioning(workspace, layout),
    );
    expect(written?.versioning).toEqual(now);
  });
});

describe("loadedVersion and internedVersion", () => {
  const metamodel = {
    valid: true,
    properties: [{ key: "weight", name: "Weight", kind: "number", content: true }],
    effectiveTypes: [{ key: "thing", properties: ["weight"] }],
  } as unknown as Metamodel;

  const thing = (data: Record<string, unknown>): ElementRecord =>
    ({ type: "thing", file: "t/T-1.md", data }) as unknown as ElementRecord;

  it("gives no version for a value without a normal form (.inf), and never throws", () => {
    const versioning = defined(versioningOf(metamodel));
    expect(versionDefinitions({ type: "thing" }, metamodel)).toEqual([
      { key: "weight", kind: "number", content: true },
    ]);
    expect(loadedVersion(thing({ weight: 1 }), "Text.", versioning)?.byForm[NORMAL_FORM]).toMatch(
      /^n1:[0-9a-f]{16}$/,
    );
    expect(loadedVersion(thing({ weight: Number.POSITIVE_INFINITY }), "Text.", versioning)).toBeUndefined();
    expect(loadedVersion(thing({ weight: Number.NaN }), "Text.", versioning)).toBeUndefined();
    const throwing = Object.defineProperty({}, "weight", {
      enumerable: true,
      get: () => {
        throw new TypeError("a getter that fails");
      },
    }) as Record<string, unknown>;
    expect(loadedVersion(thing(throwing), "Text.", versioning)).toBeUndefined();
  });

  it("takes the fingerprint string the versioning holds, and keeps an unknown one", () => {
    const versioning = defined(versioningOf(metamodel));
    const own = typeVersioningOf(versioning, "thing").fingerprint;
    const copied = {
      byForm: { n1: "n1:0000000000000000" },
      fingerprint: `${own.slice(0, 10)}${own.slice(10)}`,
    };
    expect(internedVersion(copied, versioning)).toEqual(copied);
    expect(internedVersion(copied, versioning).fingerprint).toBe(own);
    expect(typeVersioningOf(versioning, "other")).toBe(versioning.unknown);
    const foreign = { byForm: { n1: "n1:0000000000000000" }, fingerprint: "f".repeat(64) };
    expect(internedVersion(foreign, versioning)).toBe(foreign);
  });
});
