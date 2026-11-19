// The HTML export of a workspace (SR-235 AK4, AK5): images it copies and those it shows as text,
// Markdown properties, elements that get no page and folders it never writes into.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { InvokedOutput } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { elementStoreState } from "../model/index.js";
import { writeHtmlExport } from "./export.js";
import { expectSafe } from "./safe-html.test-helper.js";

const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const element = (body: string, extra = ""): string =>
  `---\nid: ${WIND}\ntype: system-requirement\nstatus: draft\ntitle: Show wind speed\n${extra}---\n\n${body}\n`;

const open = async (files: Readonly<Record<string, string | Uint8Array>>) => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace, output = "site") =>
  invoke("html.export", { output }, { workspace }) as Promise<InvokedOutput<"html.export">>;

describe("html.export with images and Markdown properties", () => {
  it("[SR-235/AK-t7cw] copies an image of the repository and leaves a missing, linked or non-image one as text", async () => {
    const { fixture, workspace } = await open({
      "requirements/SR-6328cee88fb3.md": element(
        "![ok](img/wind.png) ![ok again](./img/wind.png) ![gone](img/gone.png) ![text](img/notes.png) ![link](img/link.png) ![trap](img/trap.svg) ![plain](img/plain.svg) [doc](img/notes.png) ![dir](img/)",
        'rationale: "Seen on the mast. <b>bold</b> ![m](img/wind.png)"\n',
      ),
      "requirements/img/wind.png": PNG,
      "requirements/img/notes.png": "not an image\n",
      "requirements/img/trap.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "requirements/img/plain.svg":
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
    });
    await fs.symlink(fixture.path("requirements/img/wind.png"), fixture.path("requirements/img/link.png"));
    const output = await exported(workspace);
    const page = await fs.readFile(fixture.path(`site/elements/${WIND}.html`), "utf8");
    expectSafe(page.replace(/^[\s\S]*<main>/, "").replace(/<\/main>[\s\S]*$/, ""));
    expect(page).toContain(
      `<img src="../images/${WIND}-0.png" alt="ok"> <img src="../images/${WIND}-0.png" alt="ok again"> ![gone](img/gone.png) ![text](img/notes.png) ![link](img/link.png) ![trap](img/trap.svg) <img src="../images/${WIND}-5.svg" alt="plain"> doc ![dir](img/)`,
    );
    expect(page).toContain(
      `<section><h2>Rationale</h2><p>Seen on the mast. &lt;b&gt;bold&lt;/b&gt; <img src="../images/${WIND}-0.png" alt="m"></p></section>`,
    );
    expect(await fs.readFile(fixture.path(`site/images/${WIND}-0.png`))).toEqual(PNG);
    expect((await fs.readdir(fixture.path("site/images"))).sort()).toEqual([
      `${WIND}-0.png`,
      `${WIND}-5.svg`,
    ]);
    expect(output.problems.map((p) => [p.code, p.message, p.elementShortId])).toEqual([
      [
        "html.image-not-copied",
        "Text: the image img/gone.png is not in the repository; it is shown as text",
        "SR-e88fb3",
      ],
      [
        "html.image-not-copied",
        "Text: the image img/notes.png is no image by its content; it is shown as text",
        "SR-e88fb3",
      ],
      [
        "html.image-not-copied",
        "Text: the image img/link.png is no regular file (a link is never followed); it is shown as text",
        "SR-e88fb3",
      ],
      [
        "html.unsafe-content",
        "Text: the image img/trap.svg is an SVG image with a script or embedded content; it is shown as text",
        "SR-e88fb3",
      ],
      [
        "html.image-not-copied",
        "Text: the image img/ is not in the repository; it is shown as text",
        "SR-e88fb3",
      ],
      ["html.unsafe-content", "Rationale: raw HTML is shown as text", "SR-e88fb3"],
      ["html.unsafe-content", "Rationale: raw HTML is shown as text", "SR-e88fb3"],
    ]);
    expect(output.answer).toBe("Exported 2 element pages to site; 7 problems.");
  });

  it("gives no page to elements that share a UUID or cannot be read, and reports them", async () => {
    const { fixture, workspace } = await open({
      "copy/SR-6328cee88fb3.md": element("A copy."),
      "requirements/broken.md": "---\nid: [\n---\n",
      "notes/X-aaaaaaaaaaaa.md":
        "---\nid: 0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa\ntype: memo\n---\n\nNo type the metamodel knows.\n",
    });
    const rm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation(async (p, o) => {
      if (String(p).endsWith(".reqseq-export-staging")) {
        throw Object.assign(new Error("busy"), { code: "EBUSY" });
      }
      return rm(p, o);
    });
    const output = await exported(workspace);
    vi.restoreAllMocks();
    expect(output.pages).toBe(2);
    expect(
      await fs.readFile(fixture.path("site/elements/0b7c6e1a-1111-4222-8333-aaaaaaaaaaaa.html"), "utf8"),
    ).toContain('<h1>UNKNOWN-aaaaaa</h1><p class="rq-facts">memo</p>');
    expect(output.problems.map((p) => [p.code, p.file])).toEqual([
      ["file.invalid-yaml", "requirements/broken.md"],
      ["element.duplicate-id", "copy/SR-6328cee88fb3.md"],
      ["element.duplicate-id", "requirements/SR-6328cee88fb3.md"],
      ["html.cleanup-failed", undefined],
    ]);
    await expect(fs.stat(fixture.path(`site/elements/${WIND}.html`))).rejects.toThrow();
  });

  it("refuses a folder ReqSeq reads YAML files from, and writes into an empty folder", async () => {
    const { fixture, workspace } = await open({ "filters/.keep": "" });
    await fs.rm(fixture.path("filters/.keep"));
    for (const folder of ["metamodel", "filters", "reqif"]) {
      const error = await exported(workspace, folder).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).message).toBe(
        `output: ReqSeq reads the YAML files of ${folder}, so an HTML export cannot go there; choose another folder`,
      );
    }
    expect(await fs.readdir(fixture.path("filters"))).toEqual([]);
    await fs.mkdir(fixture.path("empty"));
    expect((await exported(workspace, "empty")).pages).toBe(2);
    // Outside the workspace the command line names the folder as given.
    const outside = path.join(path.dirname(fixture.root), `${path.basename(fixture.root)}-out`);
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    expect((await exported(workspace, outside)).folder).toBe(outside);
  });

  it("stops with an internal error for an element of a repository the layout does not name", async () => {
    const { fixture, workspace } = await open({});
    const layout = await workspace.get(workspaceLayoutState);
    // The store is read first, from the whole layout.
    await workspace.get(elementStoreState);
    const get = workspace.get.bind(workspace);
    vi.spyOn(workspace, "get").mockImplementation((state: unknown) =>
      state === workspaceLayoutState ? Promise.resolve({ ...layout, repositories: [] }) : get(state as never),
    );
    const error = await writeHtmlExport(workspace, fixture.path("site")).catch((e: unknown) => e);
    vi.restoreAllMocks();
    expect((error as CommandError).code).toBe("internal");
    await expect(fs.stat(fixture.path("site"))).rejects.toThrow();
  });
});
