// The current version of every element as a workspace state (#259, ADR-0008): each version must
// equal what reading the element's file and images now gives (`currentTarget` does the same for
// one target), also after the state was carried over a save or a watcher batch, and after images
// changed on disk, which the watcher does not report.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { readElementFile } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { CurrentVersions } from "./current-versions.js";
import {
  buildCurrentVersions,
  checkImages,
  currentVersions,
  currentVersionsState,
  currentVersionOf,
} from "./current-versions.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import { embeddedImages } from "./images.js";
import { applyStoreChange, elementStoreState, ignoredBy, updateElements } from "./store.js";
import { elementVersion } from "./view.js";
import { createElement, updateElement } from "./write.js";

const NEED = "1a1a1a1a-1111-4111-8111-a0000000000";
const PICTURED = "7c7c7c7c-7777-4777-8777-c00000000001";

const need = (id: string, text: string, title = "A need"): string =>
  `---\nid: ${id}\ntype: need\nstatus: draft\ntitle: ${title}\n---\n\n${text}\n`;

/** An element that embeds an image that is there, one that is missing and one in a nested repository. */
const PICTURES = {
  "pictures/N-c00000000001.md": need(PICTURED, "![a](img/a.png) ![b](img/gone.png) ![c](nested/c.png)"),
  "pictures/img/a.png": "A",
  "pictures/nested/.git": "gitdir: elsewhere",
  "pictures/nested/c.png": "C",
};

const open = async (
  files: Readonly<Record<string, string>> = PICTURES,
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-019/findings", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** The version of `record` as reading its file and images now gives it (as `currentTarget` reads one). */
const readNow = async (workspace: Workspace, record: ElementRecord): Promise<string | undefined> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const repository = layout.repositories.find((r) => r.name === record.repository);
  if (repository === undefined) {
    return undefined;
  }
  const read = await readElementFile(repository.folder, record.file);
  const classified = read.kind === "parsed" ? classifyFile(record.repository, read.file) : undefined;
  if (read.kind !== "parsed" || classified?.kind !== "element" || classified.element.id !== record.id) {
    return undefined;
  }
  const images = await embeddedImages(
    { repository, ignored: ignoredBy(layout) },
    record.file,
    read.file.body,
  );
  return elementVersion(classified.element, read.file.body, metamodel, images);
};

/** Every version of `versions` equals what reading the files now gives, for every element of the store. */
const expectNow = async (workspace: Workspace, versions: CurrentVersions): Promise<void> => {
  const store = await workspace.get(elementStoreState);
  expect(versions.store).toBe(store);
  expect([...versions.byRecord.keys()]).toEqual(store.elements);
  for (const record of store.elements) {
    expect(currentVersionOf(versions, record), record.file).toBe(await readNow(workspace, record));
  }
};

const recordOf = async (workspace: Workspace, file: string): Promise<ElementRecord> => {
  const record = (await workspace.get(elementStoreState)).elements.find((e) => e.file === file);
  if (record === undefined) {
    throw new Error(`no element in ${file}`);
  }
  return record;
};

describe("the current version of every element (#259)", () => {
  it("equals the version a fresh read of each file and its images gives", async () => {
    const { workspace } = await open();
    const versions = await currentVersions(workspace);
    await expectNow(workspace, versions);
    // Copies that share a UUID (SR-088) each have their own.
    const copies = versions.store.elements.filter((e) => e.id === `${NEED}3`);
    expect(copies).toHaveLength(2);
    expect(copies.map((e) => currentVersionOf(versions, e))).not.toContain(undefined);
    // The image that is there and the missing one are looked up; the nested one is seen, not counted.
    const pictured = versions.byRecord.get(await recordOf(workspace, "pictures/N-c00000000001.md"));
    expect(pictured).toMatchObject({
      kind: "version",
      images: [
        { names: ["pictures", "img", "a.png"], found: { size: 1 } },
        { names: ["pictures", "img", "gone.png"], found: null },
        { names: ["pictures", "nested", "c.png"], found: "nested" },
      ],
    });
    expect(versions.byRecord.get(await recordOf(workspace, "needs/N-a00000000001.md"))).toMatchObject({
      images: [],
    });
    // A record that is not in the store has none.
    expect(
      currentVersionOf(versions, { ...(await recordOf(workspace, "needs/N-a00000000001.md")) }),
    ).toBeUndefined();
  });

  it("counts a file changed since the store read it as it is now, and gives none where the element is gone", async () => {
    const { fixture, workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const one = await fs.readFile(fixture.path("needs/N-a00000000001.md"), "utf8");
    await fixture.write("needs/N-a00000000001.md", one.replace("No finding.", "Changed text."));
    await fixture.write("needs/N-a00000000002.md", need("5e5e5e5e-5555-4555-8555-e00000000002", "Other."));
    await fixture.write("needs/N-a00000000004.md", "No frontmatter any more.\n");
    await fs.rm(fixture.path("requirements/SR-b00000000001.md"));
    await fixture.write("requirements/SR-b00000000002.md", "---\nid: [unclosed\n---\n");
    const versions = await currentVersions(workspace);
    expect(versions.store).toBe(store);
    await expectNow(workspace, versions);
    const changed = await recordOf(workspace, "needs/N-a00000000001.md");
    expect(currentVersionOf(versions, changed)).toBeDefined();
    for (const file of [
      "needs/N-a00000000002.md",
      "needs/N-a00000000004.md",
      "requirements/SR-b00000000001.md",
      "requirements/SR-b00000000002.md",
    ]) {
      expect(versions.byRecord.get(await recordOf(workspace, file)), file).toMatchObject({
        kind: "unknown",
        reason: "not-in-file",
        message: expect.stringContaining(
          `${file} of repository system no longer holds the element`,
        ) as unknown,
      });
    }
  });

  it("gives none for an element of a repository the layout does not have", async () => {
    const { workspace } = await open();
    const store = await workspace.get(elementStoreState);
    const [first] = store.elements;
    if (first === undefined) {
      throw new Error("the fixture has no element");
    }
    const stray = { ...first, repository: "elsewhere" };
    const versions = await buildCurrentVersions(
      { ...store, elements: [stray] },
      await workspace.get(workspaceLayoutState),
      await workspace.get(metamodelState),
    );
    expect(versions.byRecord.get(stray)).toEqual({
      kind: "unknown",
      reason: "not-in-file",
      message: `${first.file} of repository elsewhere is not in a repository of the workspace`,
    });
  });

  it("gives none for an element whose images cannot be read", async () => {
    const { workspace } = await open();
    await workspace.get(elementStoreState);
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation(((folder: string, options: never) =>
      folder.endsWith("img")
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : readdir(folder, options)) as typeof fs.readdir);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const versions = await currentVersions(workspace);
    expect(versions.byRecord.get(await recordOf(workspace, "pictures/N-c00000000001.md"))).toEqual({
      kind: "unknown",
      reason: "image-unreadable",
      message: "Cannot read folder pictures/img: EACCES",
    });
  });

  it("gives none for an element with a counted number that has no normal form", async () => {
    const { fixture, workspace } = await open({
      "requirements/SR-b0000000000a.md":
        "---\nid: 2b2b2b2b-2222-4222-8222-b0000000000a\ntype: system-requirement\nstatus: draft\ntitle: Endless\nverification-method: test\nweight: .inf\n---\n\nText.\n",
    });
    const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
    await fixture.write(
      "metamodel/model.yaml",
      model.replace(
        "{ key: weight, name: Weight, kind: number }",
        "{ key: weight, name: Weight, kind: number, content: true }",
      ),
    );
    const versions = await currentVersions(workspace);
    expect(versions.byRecord.get(await recordOf(workspace, "requirements/SR-b0000000000a.md"))).toEqual({
      kind: "unknown",
      reason: "not-computable",
      message:
        "requirements/SR-b0000000000a.md of repository system: version: Infinity is not a valid number",
    });
    // Every other element has its version.
    expect(currentVersionOf(versions, await recordOf(workspace, "needs/N-a00000000001.md"))).toBeDefined();
  });

  it("reads many files in chunks and gives each its version", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 510 }, (_, i) => {
        const tail = (0xd00000000000 + i).toString(16);
        return [`many/N-${tail}.md`, need(`8d8d8d8d-8888-4888-8888-${tail}`, `Text ${String(i)}.`)];
      }),
    );
    const { workspace } = await open(files);
    await expectNow(workspace, await currentVersions(workspace));
  });
});

describe("the current versions carried over a change of the store (ADR-0008, #184)", () => {
  it("give the written records their new version after element.update and element.create, and keep the rest", async () => {
    const { workspace } = await open();
    const before = await currentVersions(workspace);
    const old = await recordOf(workspace, "needs/N-a00000000001.md");
    await updateElement(workspace, { ref: `${NEED}1`, text: "A new text." });
    // Carried, not reset: the state is there right after the save.
    expect(workspace.peek(currentVersionsState)).toBeDefined();
    const after = await currentVersions(workspace);
    await expectNow(workspace, after);
    const updated = await recordOf(workspace, "needs/N-a00000000001.md");
    expect(currentVersionOf(after, updated)).not.toBe(currentVersionOf(before, old));
    // Every other record keeps its entry.
    for (const record of after.store.elements.filter((e) => e !== updated)) {
      expect(after.byRecord.get(record)).toBe(before.byRecord.get(record));
    }
    await createElement(workspace, { type: "need", title: "A new need" });
    expect(workspace.peek(currentVersionsState)).toBeDefined();
    await expectNow(workspace, await currentVersions(workspace));
  });

  it("follow a watcher batch", async () => {
    const { fixture, workspace } = await open();
    await currentVersions(workspace);
    await fixture.write("needs/N-a00000000002.md", need(`${NEED}2`, "Edited outside."));
    await fixture.write("needs/N-new.md", need("9c9c9c9c-9999-4999-8999-c00000000077", "New."));
    const layout = await workspace.get(workspaceLayoutState);
    await applyStoreChange(workspace, (store) =>
      updateElements(
        store,
        layout,
        new Map([["system", { paths: ["needs/N-a00000000002.md", "needs/N-new.md"] }]]),
      ),
    );
    expect(workspace.peek(currentVersionsState)).toBeDefined();
    await expectNow(workspace, await currentVersions(workspace));
  });

  it("are built again after the metamodel changed which properties count", async () => {
    const { fixture, workspace } = await open();
    const before = await currentVersions(workspace);
    const model = await fs.readFile(fixture.path("metamodel/model.yaml"), "utf8");
    await fixture.write(
      "metamodel/model.yaml",
      model.replace(
        "{ key: title, name: Title, kind: text, meaning: title }",
        "{ key: title, name: Title, kind: text, meaning: title, content: true }",
      ),
    );
    await workspace.reset(metamodelState);
    expect(workspace.peek(currentVersionsState)).toBeUndefined();
    const after = await currentVersions(workspace);
    await expectNow(workspace, after);
    const record = await recordOf(workspace, "needs/N-a00000000001.md");
    expect(currentVersionOf(after, record)).not.toBe(currentVersionOf(before, record));
  });
});

describe("images checked on use (the watcher does not report them, ADR-0008)", () => {
  it("keeps the state while no image changed, and computes again the versions whose images did", async () => {
    const { fixture, workspace } = await open();
    const first = await currentVersions(workspace);
    expect(await currentVersions(workspace)).toBe(first);
    const pictured = await recordOf(workspace, "pictures/N-c00000000001.md");
    await fixture.write("pictures/img/a.png", "AA");
    const second = await currentVersions(workspace);
    expect(second).not.toBe(first);
    expect(await workspace.peek(currentVersionsState)).toBe(second);
    expect(currentVersionOf(second, pictured)).not.toBe(currentVersionOf(first, pictured));
    await expectNow(workspace, second);
    // The other entries are kept.
    for (const record of second.store.elements.filter((e) => e !== pictured)) {
      expect(second.byRecord.get(record)).toBe(first.byRecord.get(record));
    }
    // A missing image that appears, and an image of a nested repository that counts now.
    await fixture.write("pictures/img/gone.png", "G");
    await fs.rm(fixture.path("pictures/nested/.git"));
    const third = await currentVersions(workspace);
    expect(currentVersionOf(third, pictured)).not.toBe(currentVersionOf(second, pictured));
    await expectNow(workspace, third);
  });

  it("computes a version again when its images cannot be looked up, and gives none while they cannot be read", async () => {
    const { workspace } = await open();
    const first = await currentVersions(workspace);
    vi.spyOn(fs, "readdir").mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const checked = await currentVersions(workspace);
    expect(checked).not.toBe(first);
    const pictured = await recordOf(workspace, "pictures/N-c00000000001.md");
    expect(checked.byRecord.get(pictured)).toMatchObject({ kind: "unknown", reason: "image-unreadable" });
    // Readable again: the entry without a version is computed again on the next use.
    vi.restoreAllMocks();
    const again = await currentVersions(workspace);
    expect(again).not.toBe(checked);
    expect(again.byRecord.get(pictured)).toMatchObject({ kind: "version" });
    expect(currentVersionOf(again, pictured)).toBe(currentVersionOf(first, pictured));
  });

  it("lets callers that come while a check runs share it", async () => {
    const { fixture, workspace } = await open();
    await currentVersions(workspace);
    await fixture.write("pictures/img/a.png", "AAA");
    const [one, two] = await Promise.all([currentVersions(workspace), currentVersions(workspace)]);
    expect(two).toBe(one);
    await expectNow(workspace, one);
  });

  it("keeps the state while the entries without a version come out the same", async () => {
    const { fixture, workspace } = await open({});
    const store = await workspace.get(elementStoreState);
    await fs.rm(fixture.path("needs/N-a00000000004.md"));
    const versions = await buildCurrentVersions(
      store,
      await workspace.get(workspaceLayoutState),
      await workspace.get(metamodelState),
    );
    expect([...versions.byRecord.values()].some((v) => v.kind === "unknown")).toBe(true);
    expect(await checkImages(versions)).toBe(versions);
  });
});
