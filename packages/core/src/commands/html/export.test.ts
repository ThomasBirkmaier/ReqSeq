// html.export (SR-231 AK1, AK3; SR-235 AK1, AK2, AK3, AK6): the folder it writes, what it refuses and
// what it leaves as it is.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const GUSTS = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const OLD = "0b7c6e1a-1111-4222-8333-444455556666";
const MARKER = "reqseq-html-export.yaml";

const obsolete = [
  "---",
  `id: ${OLD}`,
  "type: system-requirement",
  "status: obsolete",
  "title: Show rain",
  "---",
  "",
  "Gone.",
  "",
].join("\n");

const open = async (files: Readonly<Record<string, string>> = {}) => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-001/two-elements",
    files: { "requirements/SR-444455556666.md": obsolete, ...files },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace, output: string, access?: "mcp" | "api") =>
  invoke("html.export", { output }, { workspace, ...(access === undefined ? {} : { access }) }) as Promise<
    InvokedOutput<"html.export">
  >;

const refusal = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** Every file below `folder`, relative with `/`, with its bytes as text. */
const tree = async (folder: string): Promise<Record<string, string>> => {
  const files: Record<string, string> = {};
  for (const entry of await fs.readdir(folder, { recursive: true, withFileTypes: true })) {
    const absolute = path.join(entry.parentPath, entry.name);
    if (entry.isFile()) {
      files[path.relative(folder, absolute).split(path.sep).join("/")] = await fs.readFile(absolute, "utf8");
    }
  }
  return files;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("html.export writes the workspace as HTML (SR-231)", () => {
  it("[SR-231/AK-vm0n] writes index.html and one page per element without an invalid status, none for an obsolete one", async () => {
    const { fixture, workspace } = await open();
    const output = await exported(workspace, "site");
    expect(output).toMatchObject({ folder: "site", pages: 2, removed: 0, problems: [] });
    expect(output.answer).toBe("Exported 2 element pages to site.");
    const files = await tree(fixture.path("site"));
    expect(Object.keys(files).sort()).toEqual([
      "assets/copy.js",
      "assets/docs.css",
      "assets/reqseq.css",
      "assets/reqseq.js",
      "assets/theme.js",
      `elements/${GUSTS}.html`,
      `elements/${WIND}.html`,
      "index.html",
      "licenses/THIRD-PARTY-NOTICES.txt",
      MARKER,
    ]);
    expect(files[`elements/${WIND}.html`]).toMatch(/<h1 id="_top"[^>]*>SR-e88fb3 Show wind speed<\/h1>/u);
    expect(files[`elements/${WIND}.html`]).toContain("<p>The station shows the current wind speed.</p>");
    expect(files["index.html"]).toContain("<p>Element pages: 2</p>");
    expect(JSON.stringify(files)).not.toContain(OLD);
    expect(files[MARKER]).toBe(
      [
        "# Written by ReqSeq html.export; lists the files of this export. Do not edit.",
        "reqseq-html-export: 1",
        "files:",
        '  - "assets/copy.js"',
        '  - "assets/docs.css"',
        '  - "assets/reqseq.css"',
        '  - "assets/reqseq.js"',
        '  - "assets/theme.js"',
        `  - "elements/${GUSTS}.html"`,
        `  - "elements/${WIND}.html"`,
        '  - "index.html"',
        '  - "licenses/THIRD-PARTY-NOTICES.txt"',
        "",
      ].join("\n"),
    );
  });

  it("[SR-231/AK-z3tv] keeps the page of an element at the same file when its identifier, title and short ID change", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "enabler-305/identifiers" });
    onTestFinished(() => fixture.cleanup());
    const id = "30500000-0000-4000-8000-0000000b0036";
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    await exported(workspace, "site");
    const page = fixture.path(`site/elements/${id}.html`);
    expect(await fs.readFile(page, "utf8")).toContain(">SR-036 Accept identifiers as references</h1>");
    // A new identifier and title; a second element whose UUID ends alike lengthens the short ID (SR-084 AK2).
    await fixture.write(
      "requirements/SR-0000000b0036.md",
      `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: Take identifiers\nspec-id: SR-900\n---\n\nText.\n`,
    );
    await fixture.write(
      "requirements/SR-1000000b0036.md",
      "---\nid: 11111111-2222-4333-8444-1000000b0036\ntype: system-requirement\nstatus: draft\ntitle: Twin\n---\n",
    );
    const again = new Workspace(fixture.root);
    onTestFinished(() => again.close());
    const output = await exported(again, "site");
    expect(output.removed).toBe(0);
    expect(await fs.readFile(page, "utf8")).toContain(">SR-900 Take identifiers</h1>");
    expect(
      await fs.readFile(fixture.path("site/elements/11111111-2222-4333-8444-1000000b0036.html"), "utf8"),
    ).toContain(">SR-1000000b0036 Twin</h1>");
  });
});

describe("html.export changes only its own folder (SR-235)", () => {
  it("[SR-235/AK-zh58] refuses a non-empty folder without the marker file, names why and changes nothing", async () => {
    const { fixture, workspace } = await open({ "docs/notes.txt": "mine\n" });
    const error = await refusal(exported(workspace, "docs"));
    expect(error.code).toBe("file.faulty");
    expect(error.message).toBe(
      "Not exported: docs is not empty and holds no marker file reqseq-html-export.yaml of an HTML export",
    );
    expect(await tree(fixture.path("docs"))).toEqual({ "notes.txt": "mine\n" });
  });

  it("[SR-235/AK-pnk8] replaces and removes only the files the marker names, reports the others and touches nothing outside", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-outside-"));
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    await fs.writeFile(path.join(outside, "keep.txt"), "outside\n");
    const { fixture, workspace } = await open({ "requirements/notes.txt": "beside\n" });
    await exported(workspace, "site");
    // An earlier export that also wrote a page the new one no longer writes, and entries that lead out.
    await fixture.write("site/elements/gone.html", "old page\n");
    await fixture.write("site/mine.txt", "mine\n");
    await fixture.write("site/assets/mine.css", "mine\n");
    await fixture.write("site/sub/.git/HEAD", "ref: refs/heads/main\n");
    await fs.symlink(outside, fixture.path("site/out"), "junction");
    const marker = await fs.readFile(fixture.path(`site/${MARKER}`), "utf8");
    await fixture.write(
      `site/${MARKER}`,
      `${marker}  - "elements/gone.html"\n  - "../requirements/notes.txt"\n  - "out/keep.txt"\n  - ".git/HEAD"\n  - "sub/.git/HEAD"\n  - "/etc/hostname"\n  - "INDEX.html"\n`,
    );
    const output = await exported(workspace, "site");
    expect(output.removed).toBe(1);
    await expect(fs.stat(fixture.path("site/elements/gone.html"))).rejects.toThrow();
    expect(await fs.readFile(fixture.path("site/mine.txt"), "utf8")).toBe("mine\n");
    expect(await fs.readFile(fixture.path("site/assets/mine.css"), "utf8")).toBe("mine\n");
    expect(await fs.readFile(fixture.path("site/sub/.git/HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
    expect(await fs.readFile(fixture.path("requirements/notes.txt"), "utf8")).toBe("beside\n");
    expect(await fs.readFile(path.join(outside, "keep.txt"), "utf8")).toBe("outside\n");
    expect(output.problems.map((p) => [p.code, p.message])).toEqual([
      [
        "html.marker-entry-ignored",
        "The marker file entry ../requirements/notes.txt is neither replaced nor removed: it holds an empty name, . or ..",
      ],
      [
        "html.marker-entry-ignored",
        "The marker file entry out/keep.txt is neither replaced nor removed: it is no file the export wrote: a folder, a link or inside one",
      ],
      [
        "html.marker-entry-ignored",
        "The marker file entry .git/HEAD is neither replaced nor removed: it leads into a .git folder",
      ],
      [
        "html.marker-entry-ignored",
        "The marker file entry sub/.git/HEAD is neither replaced nor removed: it leads into a .git folder",
      ],
      [
        "html.marker-entry-ignored",
        "The marker file entry /etc/hostname is neither replaced nor removed: it is no relative path with / in NFC",
      ],
      [
        "html.marker-entry-ignored",
        "The marker file entry INDEX.html is neither replaced nor removed: it is listed twice",
      ],
      ["html.foreign-file", "assets/mine.css was not written by the earlier export and is left as it is"],
      ["html.foreign-file", "mine.txt was not written by the earlier export and is left as it is"],
      ["html.foreign-file", "out was not written by the earlier export and is left as it is"],
      ["html.foreign-file", "sub was not written by the earlier export and is left as it is"],
    ]);
    expect(await fs.readFile(fixture.path(`site/${MARKER}`), "utf8")).toBe(marker);
  });

  it("[SR-235/AK-m01q] refuses a target in a .git folder and, over API and MCP, one outside the repositories, writing nothing", async () => {
    const { fixture, workspace } = await open({ ".git/info/exclude": "" });
    const git = await refusal(exported(workspace, ".git/site"));
    expect(git.code).toBe("input.invalid");
    expect(git.message).toBe("site lies in a .git folder; ReqSeq never writes to Git");
    await expect(fs.stat(fixture.path(".git/site"))).rejects.toThrow();
    const outside = path.join(path.dirname(fixture.root), `${path.basename(fixture.root)}-site`);
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    for (const access of ["mcp", "api"] as const) {
      const error = await refusal(exported(workspace, `../${path.basename(outside)}`, access));
      expect(error.code).toBe("input.invalid");
      await expect(fs.stat(outside)).rejects.toThrow();
    }
    // Inside a repository the same accesses write it (SR-142 AK2).
    expect((await exported(workspace, "site", "mcp")).pages).toBe(2);
  });

  it("[SR-235/AK-k6qy] leaves an earlier export as it was when the export fails while writing or while putting the files in place", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace, "site");
    await fixture.write("site/mine.txt", "mine\n");
    const before = await tree(fixture.path("site"));
    // While writing: an element file changed since it was read.
    await workspace.get((await import("../../model/index.js")).elementStoreState);
    await fs.writeFile(fixture.path("requirements/SR-6328cee88fb3.md"), "---\nchanged: true\n---\n");
    const changed = await refusal(exported(workspace, "site"));
    expect(changed.code).toBe("file.changed-on-disk");
    expect(await tree(fixture.path("site"))).toEqual(before);
    // While putting the files in place: a rename fails.
    const fresh = await open();
    await exported(fresh.workspace, "site");
    await fresh.fixture.write("site/mine.txt", "mine\n");
    const earlier = await tree(fresh.fixture.path("site"));
    await fresh.fixture.write(
      "requirements/SR-6328cee88fb3.md",
      `---\nid: ${WIND}\ntype: system-requirement\nstatus: draft\ntitle: Renamed\n---\n`,
    );
    const again = new Workspace(fresh.fixture.root);
    onTestFinished(() => again.close());
    const rename = fs.rename.bind(fs);
    let calls = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      // The second file put in place, after the first moved and the old files went to the backup.
      if (String(from).includes(`.reqseq-export-staging${path.sep}new`) && ++calls === 2) {
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      }
      return rename(from, to);
    });
    const failed = await refusal(exported(again, "site"));
    expect(failed.code).toBe("internal");
    vi.restoreAllMocks();
    expect(await tree(fresh.fixture.path("site"))).toEqual(earlier);
    // A new target the failed export created is removed again.
    await fs.writeFile(fixture.path("requirements/SR-6328cee88fb3.md"), "---\nchanged: again\n---\n");
    await refusal(exported(workspace, "fresh"));
    await expect(fs.stat(fixture.path("fresh"))).rejects.toThrow();
  });
});
