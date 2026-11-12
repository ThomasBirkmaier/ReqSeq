// The content before a save (SR-024 AK2, `contentBefore` in write.ts): an old text whose images
// cannot be read (`file.faulty`) gives none, and the save counts as a change, so a save that repairs
// the element still works. Errors that are bugs are passed on. The image lookup is replaced by a
// stand-in that fails once on request. A value without a normal form has a content to compare
// (`elementContent`, ThomasBirkmaier/ReqSeq-archive#276; element.update tests).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type * as Images from "./images.js";
import type { UpdateElementInput } from "./write.js";
import { updateElement } from "./write.js";

const failures = vi.hoisted(() => ({
  images: undefined as Error | undefined,
}));

vi.mock("./images.js", async (original) => {
  const real = await original<typeof Images>();
  return {
    ...real,
    embeddedImages: (...args: Parameters<typeof real.embeddedImages>) => {
      const failure = failures.images;
      failures.images = undefined;
      return failure === undefined ? real.embeddedImages(...args) : Promise.reject(failure);
    },
  };
});

afterEach(() => {
  failures.images = undefined;
  vi.restoreAllMocks();
});

const SPEED_FILE = "requirements/SR-00000000b001.md";

/**
 * fixtures/SR-024/affected, with a picture in the text of b001 (two elements point at it), and the input
 * of a save of b001 on the bytes as written (`expectedFileSha256`, #269).
 */
const open = async (): Promise<{ readonly workspace: Workspace; readonly save: UpdateElementInput }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-024/affected",
    files: { "requirements/img/a.png": "A" },
  });
  onTestFinished(() => fixture.cleanup());
  const file = fixture.path(SPEED_FILE);
  const bytes = `${await fs.readFile(file, "utf8")}\n![speed](img/a.png)\n`;
  await fs.writeFile(file, bytes);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const expectedFileSha256 = createHash("sha256").update(bytes).digest("hex");
  return { workspace, save: { ref: "SR-00b001", text: "No picture.\n", expectedFileSha256 } };
};

describe("the content before a save (SR-024 AK2)", () => {
  it("[SR-024/AK-mf7x] counts a save whose old text embeds an image that cannot be read as a change", async () => {
    const { workspace, save } = await open();
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation(((folder: string, options: never) =>
      folder.endsWith("img")
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : readdir(folder, options)) as typeof fs.readdir);
    // The save removes the broken link; the new text embeds no image.
    const out = await updateElement(workspace, save);
    expect([out.files, out.affected]).toEqual([[SPEED_FILE], 2]);
  });

  it("passes on an image lookup that fails with anything but file.faulty", async () => {
    const { workspace, save } = await open();
    failures.images = new Error("bug in the image lookup");
    await expect(updateElement(workspace, save)).rejects.toThrow("bug in the image lookup");
  });
});
