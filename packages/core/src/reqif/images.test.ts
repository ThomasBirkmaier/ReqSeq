// The images a ReqIF file embeds (SR-095 AK2): which `data` is read, which is a loss, and the names
// of the copies.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { LocalPaths } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { ImageFile, ImageRead } from "./images.js";
import { ImageNames, imageReader } from "./images.js";

const OPEN: LocalPaths = { check: () => Promise.resolve() };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);

/** A folder with `in/delivery.reqif`, `in/<files>` and `outside.png` next to `in`. */
const folder = async (files: Readonly<Record<string, Uint8Array>>): Promise<string> => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-images-"));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "in", "sub"), { recursive: true });
  await fs.writeFile(path.join(root, "in", "delivery.reqif"), "");
  await fs.writeFile(path.join(root, "outside.png"), PNG);
  for (const [name, bytes] of Object.entries(files)) {
    await fs.writeFile(path.join(root, "in", name), bytes);
  }
  return root;
};

const kindOf = (read: ImageRead): string =>
  read.kind === "found" ? read.file.stem + read.file.extension : read.kind;

describe("imageReader (SR-095 AK2)", () => {
  it("reads a relative path below the folder of the ReqIF file, percent-decoded, without query or fragment", async () => {
    const root = await folder({ "wind rose.PNG": PNG, nul: PNG, "pic.tiff": PNG, "doc.txt": PNG });
    const read = imageReader(path.join(root, "in", "delivery.reqif"), OPEN);
    const found = await read({ data: "wind%20rose.PNG?x=1#y" });
    expect(found).toEqual({
      kind: "found",
      file: {
        bytes: PNG,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
        stem: "wind-rose",
        extension: ".png",
      },
    });
    // Read once per data.
    expect(await read({ data: "wind%20rose.PNG?x=1#y" })).toBe(found);
    // The extension of the type for a name without one; a Windows device name gets `-image`.
    expect(kindOf(await read({ data: "nul", type: "image/png" }))).toBe("nul-image.png");
    expect(await read({ data: "pic.tiff", type: "image/tiff" })).toEqual({
      kind: "image-missing",
      reason: "the image pic.tiff is no image ReqSeq embeds",
    });
    expect(kindOf(await read({ data: "doc.txt" }))).toBe("image-missing");
  });

  it("is image-outside for a scheme, an absolute path, a path above the folder or a link out of it, and image-missing for no file", async () => {
    const root = await folder({});
    await fs.symlink(path.join(root, "outside.png"), path.join(root, "in", "link.png"));
    const read = imageReader(path.join(root, "in", "delivery.reqif"), OPEN);
    const results = await Promise.all(
      [
        "http://example.org/a.png",
        "/etc/a.png",
        "\\a.png",
        "%E0%A4%A",
        "../outside.png",
        "../gone.png",
        "link.png",
      ].map(async (data) => kindOf(await read({ data }))),
    );
    expect(results).toEqual([
      "image-outside",
      "image-outside",
      "image-outside",
      "image-outside",
      "image-outside",
      "image-outside",
      "image-outside",
    ]);
    expect(await read({ data: "gone.png" })).toEqual({
      kind: "image-missing",
      reason: "the image gone.png is not next to the ReqIF file",
    });
    expect(kindOf(await read({ data: "sub" }))).toBe("image-missing");
  });

  it("is image-outside for a path the access refuses (SR-142), and passes other errors on", async () => {
    const root = await folder({ "a.png": PNG });
    const file = path.join(root, "in", "delivery.reqif");
    const refused = imageReader(file, {
      check: () => Promise.reject(new CommandError("input.invalid", "outside the repositories")),
    });
    expect(await refused({ data: "a.png" })).toEqual({
      kind: "image-outside",
      reason: "the image a.png is outside the repositories of the workspace, so it is not copied",
    });
    const broken = imageReader(file, { check: () => Promise.reject(new CommandError("internal", "boom")) });
    await expect(broken({ data: "a.png" })).rejects.toThrow("boom");
  });
});

describe("ImageNames", () => {
  const image = (stem: string, sha256: string): ImageFile => ({
    bytes: PNG,
    sha256,
    stem,
    extension: ".png",
  });

  it("gives each image a free name in the element's folder, in any case, and the same bytes one name", () => {
    const names = new ImageNames();
    expect(names.nameOf(image("Rose", "1"))).toBe("Rose.png");
    expect(names.nameOf(image("rose", "2"))).toBe("rose-2.png");
    expect(names.nameOf(image("other", "1"))).toBe("Rose.png");
    expect(names.files.map((f) => f.name)).toEqual(["Rose.png", "rose-2.png"]);
  });
});
