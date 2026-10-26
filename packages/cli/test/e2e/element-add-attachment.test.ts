// `logreq element add-attachment` end to end (SR-097, ADR-0009): the built binary on
// fixtures/SR-004/one-repository as a Git repository, a source path relative to the current folder,
// the Markdown it prints, the text saved with `logreq element update`, and the image found from the
// link on disk and in the commit. Inserting an image in the editor comes with the editor (#77);
// core and this test cover the function now. Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { logreq, requireBuiltCli } from "../support/logreq.js";

const ELEMENT_FILE = "requirements/SR-6328cee88fb3.md";
const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const workspace = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    fixture: "SR-004/one-repository",
    files: { "incoming/Wind layout.png": IMAGE },
    git: true,
  });
  fixtures.push(ws);
  return ws;
};

interface Added {
  readonly file: string;
  readonly markdown: string;
}

describe("logreq element add-attachment (SR-097)", () => {
  it("[SR-097/AK1] [SR-097/AK2] copies the image next to the element file; the saved text links it relatively and the link finds it on disk and in the commit", async () => {
    const ws = await workspace();
    // A path relative to the current folder, as on any command line (ADR-0009 localPath).
    const out = await logreq(
      ["element", "add-attachment", "SR-e88fb3", "../incoming/Wind layout.png", "--json"],
      {
        cwd: ws.path("requirements"),
      },
    );
    expect([out.code, out.stderr]).toEqual([0, ""]);
    const added = JSON.parse(out.stdout) as Added;
    expect(added).toEqual({
      file: "requirements/SR-6328cee88fb3/Wind-layout.png",
      markdown: "![Wind-layout](SR-6328cee88fb3/Wind-layout.png)",
    });
    expect(await fs.readFile(ws.path(added.file))).toEqual(IMAGE);

    const text = `The station shows the current wind speed.\n\n${added.markdown}\n`;
    const saved = await logreq(["element", "update", "SR-e88fb3", "--text", text], { cwd: ws.root });
    expect([saved.code, saved.stderr]).toEqual([0, ""]);
    await ws.commit();

    // Resolved as a text editor or a Git server does: relative to the folder of the element file.
    const destination = /!\[[^\]]*\]\(([^)]+)\)/.exec(await fs.readFile(ws.path(ELEMENT_FILE), "utf8"))?.[1];
    const linked = path.posix.join(path.posix.dirname(ELEMENT_FILE), decodeURIComponent(String(destination)));
    expect(linked).toBe(added.file);
    expect(await fs.readFile(ws.path(linked))).toEqual(IMAGE);
    expect((await ws.git(["ls-tree", "-r", "--name-only", "HEAD"])).split("\n")).toContain(linked);

    // The image counts to the version, which the commit has: so the version has a date.
    const got = await logreq(["element", "get", "SR-e88fb3", "--version-date", "--json"], { cwd: ws.root });
    const { element } = JSON.parse(got.stdout) as {
      element: { version: string; versionDate: string | null };
    };
    expect(element.versionDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    await fs.writeFile(ws.path(linked), Buffer.concat([IMAGE, Buffer.from([4])]));
    const changed = await logreq(["element", "get", "SR-e88fb3", "--json"], { cwd: ws.root });
    expect((JSON.parse(changed.stdout) as { element: { version: string } }).element.version).not.toBe(
      element.version,
    );
  });

  it("prints the file and the Markdown, and refuses a file that is no image with exit code 2", async () => {
    const ws = await workspace();
    const out = await logreq(["element", "add-attachment", "SR-e88fb3", "incoming/Wind layout.png"], {
      cwd: ws.root,
    });
    expect([out.code, out.stdout, out.stderr]).toEqual([
      0,
      'file: requirements/SR-6328cee88fb3/Wind-layout.png\nmarkdown: "![Wind-layout](SR-6328cee88fb3/Wind-layout.png)"\n',
      "",
    ]);
    const refused = await logreq(["element", "add-attachment", "SR-e88fb3", "logreq-workspace.yaml"], {
      cwd: ws.root,
    });
    expect([refused.code, refused.stdout, refused.stderr]).toEqual([
      2,
      "",
      "error input.invalid: logreq-workspace.yaml is no image LogReq embeds; the name must end in .avif, .bmp, .gif, .jpeg, .jpg, .png, .svg, .webp\n",
    ]);
  });
});
