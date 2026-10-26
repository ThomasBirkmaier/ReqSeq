import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { portableName } from "../../model/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.addAttachment">;

/** The elements of fixtures/SR-001/two-elements. */
const WIND = { id: "e8df96ea-a168-4d90-8d65-6328cee88fb3", file: "requirements/SR-6328cee88fb3.md" };
const GUSTS = { id: "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c", file: "requirements/SR-1d2e3f4a5b6c.md" };

/** A 1x1 PNG, and other bytes that stand for a second image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const OTHER_PNG = Buffer.concat([PNG, Buffer.from([0])]);

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-001/two-elements",
    ...options,
    files: { "incoming/layout.png": PNG, ...options.files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const add = async (opened: Opened, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.addAttachment", input, { workspace: opened.workspace })) as Output;

const addError = async (opened: Opened, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await add(opened, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected element.addAttachment to fail");
};

const versionOf = async (opened: Opened, ref: string): Promise<string> => {
  // A new Workspace each time, so the version is computed from the files as they are now.
  const workspace = new Workspace(opened.fixture.root);
  try {
    const out = (await invoke("element.get", { ref }, { workspace })) as CommandOutput<"element.get">;
    if (out.element.version === undefined) {
      throw new Error(`${ref} has no version`);
    }
    return out.element.version;
  } finally {
    await workspace.close();
  }
};

/** Every file below the fixture (relative, `/`), except Git's own. */
const filesBelow = async (root: string): Promise<string[]> => {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && !e.parentPath.split(path.sep).includes(".git"))
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
};

/**
 * The file the first image of `text` names, as a text editor or a Git server resolves it: the
 * destination of `![alt](destination)`, percent-decoded, relative to the folder of `elementFile`.
 */
const linkedFile = (elementFile: string, text: string): string => {
  const destination = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(text)?.[1];
  if (destination === undefined) {
    throw new Error(`no image in ${text}`);
  }
  return path.posix.join(path.posix.dirname(elementFile), decodeURIComponent(destination));
};

describe("element.addAttachment", () => {
  it("[SR-097/AK1] puts the image into the folder named like the element file, next to it, and the saved text links it relatively", async () => {
    const opened = await open();
    const before = await fs.readFile(opened.fixture.path(WIND.file), "utf8");
    const out = await add(opened, { ref: "SR-e88fb3", sourcePath: "incoming/layout.png" });
    expect(out).toEqual({
      file: "requirements/SR-6328cee88fb3/layout.png",
      markdown: "![layout](SR-6328cee88fb3/layout.png)",
    });
    expect(await fs.readFile(opened.fixture.path(out.file))).toEqual(PNG);
    // The text is the caller's: the command changes no element file, the source stays.
    expect(await fs.readFile(opened.fixture.path(WIND.file), "utf8")).toBe(before);
    expect(await fs.readFile(opened.fixture.path("incoming/layout.png"))).toEqual(PNG);

    const text = `The station shows the current wind speed.\n\n${out.markdown}\n`;
    const saved = (await invoke(
      "element.update",
      { ref: WIND.id, text },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.update">;
    expect(saved.files).toEqual([WIND.file]);
    const file = await fs.readFile(opened.fixture.path(WIND.file), "utf8");
    expect(file).toBe(`${before.replace(/\n$/, "")}\n\n![layout](SR-6328cee88fb3/layout.png)\n`);
    expect(linkedFile(WIND.file, file)).toBe(out.file);
    expect(path.dirname(opened.fixture.path(out.file))).toBe(
      opened.fixture.path(WIND.file).replace(/\.md$/, ""),
    );
  });

  it("[SR-097/AK2] the link finds the image on disk and in the commit, as a text editor and a Git server look it up, and the image counts to the version", async () => {
    const opened = await open({ git: true });
    const out = await add(opened, { ref: WIND.id, sourcePath: opened.fixture.path("incoming/layout.png") });
    await invoke(
      "element.update",
      { ref: WIND.id, text: `Wind speed.\n\n${out.markdown}\n` },
      { workspace: opened.workspace },
    );
    await opened.fixture.commit();
    const text = await fs.readFile(opened.fixture.path(WIND.file), "utf8");
    const linked = linkedFile(WIND.file, text);
    // A text editor opens the file from disk, a Git server from the tree of the commit.
    expect(await fs.readFile(opened.fixture.path(linked))).toEqual(PNG);
    expect((await opened.fixture.git(["ls-tree", "-r", "--name-only", "HEAD"])).split("\n")).toContain(
      linked,
    );
    expect(await opened.fixture.git(["cat-file", "-s", `HEAD:${linked}`])).toBe(`${String(PNG.length)}\n`);
    // LogReq finds it the same way: the version of the commit is the current one, so it has a date.
    const got = (await invoke(
      "element.get",
      { ref: WIND.id, versionDate: true },
      { workspace: opened.workspace },
    )) as CommandOutput<"element.get">;
    expect(got.element.versionDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    // Its bytes count to the version (D-057, ADR-0005 "Files").
    const version = await versionOf(opened, WIND.id);
    await fs.writeFile(opened.fixture.path(linked), OTHER_PNG);
    expect(await versionOf(opened, WIND.id)).not.toBe(version);
  });

  it("[SR-097/AK2] a folder name LogReq did not choose is percent-encoded in the link, which still finds the image", async () => {
    const element =
      "---\nid: 0b7c6e1a-1111-4222-8333-000000000001\ntype: system-requirement\nstatus: draft\ntitle: Odd\n---\n";
    const opened = await open({
      files: {
        "my reqs/Wind (gusts) ü.md": element,
        "Top.md": element.replace("000000000001", "000000000002"),
      },
    });
    const odd = await add(opened, {
      ref: "0b7c6e1a-1111-4222-8333-000000000001",
      sourcePath: "incoming/layout.png",
    });
    expect(odd).toEqual({
      file: "my reqs/Wind (gusts) ü/layout.png",
      markdown: "![layout](Wind%20%28gusts%29%20%C3%BC/layout.png)",
    });
    expect(linkedFile("my reqs/Wind (gusts) ü.md", odd.markdown)).toBe(odd.file);
    // An element in the repository folder itself.
    const top = await add(opened, {
      ref: "0b7c6e1a-1111-4222-8333-000000000002",
      sourcePath: "incoming/layout.png",
    });
    expect(top).toEqual({ file: "Top/layout.png", markdown: "![layout](Top/layout.png)" });
  });

  it("[SR-097/AK2] gives every image a name that is the same and allowed on Windows, macOS and Linux", async () => {
    const sources: Record<string, string> = {
      "incoming/Wind Läyout; v2 (final)&.PNG": "Wind-Layout-v2-final.png",
      // Windows itself refuses to create a file with a device name; the rule is checked elsewhere.
      ...(process.platform === "win32"
        ? {}
        : { "incoming/CON.png": "CON-image.png", "incoming/nul.svg": "nul-image.svg" }),
      "incoming/!!!.jpg": "image.jpg",
      "incoming/日本.gif": "image.gif",
      "incoming/ﬁle_name-.webp": "file_name.webp",
      [`incoming/${"x".repeat(70)}.png`]: `${"x".repeat(64)}.png`,
      [`incoming/${"y".repeat(63)} z.png`]: `${"y".repeat(63)}.png`,
    };
    const opened = await open({
      files: Object.fromEntries(Object.keys(sources).map((source, i) => [source, Buffer.from([i])])),
    });
    for (const [sourcePath, name] of Object.entries(sources)) {
      const out = await add(opened, { ref: WIND.id, sourcePath });
      expect([sourcePath, out]).toEqual([
        sourcePath,
        {
          file: `requirements/SR-6328cee88fb3/${name}`,
          markdown: `![${name.slice(0, name.lastIndexOf("."))}](SR-6328cee88fb3/${name})`,
        },
      ]);
    }
    expect(portableName("")).toBe("image");
  });

  it("never replaces a file: a name in use gets -2, -3, also in another case; the same bytes under the same name are reused", async () => {
    const opened = await open({
      files: {
        "requirements/SR-6328cee88fb3/layout.png": OTHER_PNG,
        "requirements/SR-6328cee88fb3/LAYOUT-2.png": OTHER_PNG,
        "incoming/other/layout.png": OTHER_PNG,
      },
    });
    const first = await add(opened, { ref: WIND.id, sourcePath: "incoming/layout.png" });
    expect(first.file).toBe("requirements/SR-6328cee88fb3/layout-3.png");
    expect(await fs.readFile(opened.fixture.path("requirements/SR-6328cee88fb3/layout.png"))).toEqual(
      OTHER_PNG,
    );
    expect(await fs.readFile(opened.fixture.path(first.file))).toEqual(PNG);
    // Pasting the same image again gives the same file, unchanged.
    const { mtimeMs } = await fs.stat(opened.fixture.path(first.file));
    const files = await filesBelow(opened.fixture.root);
    expect(await add(opened, { ref: WIND.id, sourcePath: "incoming/layout.png" })).toEqual(first);
    expect((await fs.stat(opened.fixture.path(first.file))).mtimeMs).toBe(mtimeMs);
    expect(await filesBelow(opened.fixture.root)).toEqual(files);
    // The bytes of the first name: that file is reused.
    expect(await add(opened, { ref: WIND.id, sourcePath: "incoming/other/layout.png" })).toEqual({
      file: "requirements/SR-6328cee88fb3/layout.png",
      markdown: "![layout](SR-6328cee88fb3/layout.png)",
    });
  });

  it("skips a name the text embeds while the image is missing, so the version does not change", async () => {
    const opened = await open();
    await invoke(
      "element.update",
      { ref: WIND.id, text: "Wind.\n\n![old](SR-6328cee88fb3/Layout.png)\n" },
      { workspace: opened.workspace },
    );
    const version = await versionOf(opened, WIND.id);
    const out = await add(opened, { ref: WIND.id, sourcePath: "incoming/layout.png" });
    expect(out.file).toBe("requirements/SR-6328cee88fb3/layout-2.png");
    expect(await versionOf(opened, WIND.id)).toBe(version);
  });

  it("takes only image files, and names only the source's base name in an error", async () => {
    const opened = await open({ files: { "incoming/notes.txt": "x", "incoming/folder.png/.keep": "" } });
    const cases: [string, string][] = [
      ["incoming/notes.txt", "not-an-image"],
      ["logreq-workspace.yaml", "not-an-image"],
      ["incoming/.png", "not-an-image"],
      ["incoming/gone.png", "source-missing"],
      ["incoming/notes.txt/x.png", "source-missing"],
      ["incoming/folder.png", "source-not-a-file"],
    ];
    for (const [sourcePath, reason] of cases) {
      const error = await addError(opened, { ref: WIND.id, sourcePath });
      expect([sourcePath, error.code, error.details]).toEqual([
        sourcePath,
        "input.invalid",
        expect.objectContaining({ reason }),
      ]);
      expect(error.message).not.toContain(opened.fixture.root);
    }
    expect((await addError(opened, { ref: WIND.id, sourcePath: "incoming/notes.txt" })).message).toBe(
      "notes.txt is no image LogReq embeds; the name must end in .avif, .bmp, .gif, .jpeg, .jpg, .png, .svg, .webp",
    );
    expect(await filesBelow(opened.fixture.path("requirements"))).toEqual([
      "SR-1d2e3f4a5b6c.md",
      "SR-6328cee88fb3.md",
    ]);
  });

  it("reports a source it cannot read as file.faulty", async () => {
    const opened = await open();
    // Everything the command reads first is loaded, so the mock meets the read it is about.
    await invoke("element.get", { ref: WIND.id }, { workspace: opened.workspace });
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "readFile").mockRejectedValueOnce(denied);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const error = await addError(opened, { ref: WIND.id, sourcePath: "incoming/layout.png" });
    expect([error.code, error.message, error.details]).toEqual([
      "file.faulty",
      "Cannot read the image layout.png (EACCES)",
      { reason: "EACCES" },
    ]);
  });

  it("reports an image folder it cannot list as file.faulty", async () => {
    const opened = await open({ files: { "requirements/SR-6328cee88fb3/.keep": "" } });
    // Everything the command reads first is loaded, so the mock meets the read it is about.
    await invoke("element.get", { ref: WIND.id }, { workspace: opened.workspace });
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(denied);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const error = await addError(opened, { ref: WIND.id, sourcePath: "incoming/layout.png" });
    expect([error.code, error.message, error.details]).toEqual([
      "file.faulty",
      "Cannot read folder requirements/SR-6328cee88fb3 (EACCES)",
      { file: "requirements/SR-6328cee88fb3", reason: "EACCES" },
    ]);
  });

  it("refuses an element it may not change and a target the element walk would leave out", async () => {
    const unknown =
      "---\nid: 0b7c6e1a-1111-4222-8333-000000000003\ntype: nope\nstatus: draft\ntitle: Unknown\n---\n";
    const opened = await open({
      files: {
        "unknown/N-000000000003.md": unknown,
        // A file where the image folder of GUSTS would go.
        "requirements/SR-1d2e3f4a5b6c": "not a folder",
        "other/.md": unknown.replace("000000000003", "000000000004").replace("type: nope", "type: need"),
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
          "metamodel: { repository: system, path: metamodel }\nignore: ['**/*.svg']\n",
        "incoming/layout.svg": "<svg/>",
      },
    });
    const codes = async (input: Record<string, unknown>): Promise<unknown> => {
      const error = await addError(opened, input);
      return [error.code, error.details?.["reason"], error.details?.["rule"]];
    };
    expect(await codes({ ref: "SR-ffffff", sourcePath: "incoming/layout.png" })).toEqual([
      "ref.unknown",
      undefined,
      undefined,
    ]);
    expect(
      await codes({ ref: "0b7c6e1a-1111-4222-8333-000000000003", sourcePath: "incoming/layout.png" }),
    ).toEqual(["element.read-only", "unknown-type", undefined]);
    expect(await codes({ ref: GUSTS.id, sourcePath: "incoming/layout.png" })).toEqual([
      "input.invalid",
      "not-listed",
      "not-a-folder",
    ]);
    expect(await codes({ ref: WIND.id, sourcePath: "incoming/layout.svg" })).toEqual([
      "input.invalid",
      "not-listed",
      "ignored",
    ]);
    expect(
      await codes({ ref: "0b7c6e1a-1111-4222-8333-000000000004", sourcePath: "incoming/layout.png" }),
    ).toEqual(["input.invalid", "no-image-folder", undefined]);
    expect(await filesBelow(opened.fixture.path("requirements"))).toEqual([
      "SR-1d2e3f4a5b6c",
      "SR-1d2e3f4a5b6c.md",
      "SR-6328cee88fb3.md",
    ]);
  });
});
