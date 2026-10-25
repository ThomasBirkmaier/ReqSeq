// The content before a save (SR-024 AK2, `contentBefore` in write.ts): an old text whose images
// cannot be read (`file.faulty`) gives none, and the save counts as a change, so a save that repairs
// the element still works. Errors that are bugs are passed on. The image lookup is replaced by a
// stand-in that fails once on request. A value without a normal form has a content to compare
// (`elementContent`, #276; element.update tests).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type * as Images from "./images.js";
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

/** fixtures/SR-024/affected, with a picture in the text of b001 (two elements point at it). */
const open = async (): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-024/affected",
    files: { "requirements/img/a.png": "A" },
  });
  onTestFinished(() => fixture.cleanup());
  const file = fixture.path(SPEED_FILE);
  await fs.writeFile(file, `${await fs.readFile(file, "utf8")}\n![speed](img/a.png)\n`);
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

describe("the content before a save (SR-024 AK2)", () => {
  it("[SR-024/AK2] counts a save whose old text embeds an image that cannot be read as a change", async () => {
    const workspace = await open();
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation(((folder: string, options: never) =>
      folder.endsWith("img")
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : readdir(folder, options)) as typeof fs.readdir);
    // The save removes the broken link; the new text embeds no image.
    const out = await updateElement(workspace, { ref: "SR-00b001", text: "No picture.\n" });
    expect([out.files, out.affected]).toEqual([[SPEED_FILE], 2]);
  });

  it("passes on an image lookup that fails with anything but file.faulty", async () => {
    const workspace = await open();
    failures.images = new Error("bug in the image lookup");
    await expect(updateElement(workspace, { ref: "SR-00b001", text: "No picture.\n" })).rejects.toThrow(
      "bug in the image lookup",
    );
  });
});
