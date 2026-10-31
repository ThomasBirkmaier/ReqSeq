// The images a ReqIF file embeds (SR-095 AK2): which `data` is read, which is a loss, how a copy is
// read, and the names of the copies.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { LocalPaths } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { ImageFile, ImageRead } from "./images.js";
import { IMAGE_LIMIT_BYTES, ImageNames, imageContent, imageReader } from "./images.js";

const OPEN: LocalPaths = { check: () => Promise.resolve() };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
const WINDOWS = process.platform === "win32";

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

const bytesOf = (file: ImageFile): Buffer => Buffer.concat([...imageContent(file, "x.png")()]);

describe("imageReader (SR-095 AK2)", () => {
  it("reads a relative path below the folder of the ReqIF file, percent-decoded, without query or fragment", async () => {
    const root = await folder({
      "wind rose.PNG": PNG,
      nul: PNG,
      "pic.tiff": PNG,
      "doc.txt": PNG,
      "..logo.png": PNG,
    });
    const read = imageReader(path.join(root, "in", "delivery.reqif"), OPEN);
    const found = await read({ data: "wind%20rose.PNG?x=1#y" });
    expect(found).toEqual({
      kind: "found",
      file: {
        path: await fs.realpath(path.join(root, "in", "wind rose.PNG")),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
        stem: "wind-rose",
        extension: ".png",
        size: PNG.length,
        dev: expect.any(Number) as unknown,
        ino: expect.any(Number) as unknown,
      },
    });
    // Read once per data and type.
    expect(await read({ data: "wind%20rose.PNG?x=1#y" })).toBe(found);
    // A name that starts with two dots is no `..` segment.
    expect(kindOf(await read({ data: "..logo.png" }))).toBe("logo.png");
    // The extension of the type for a name without one; a Windows device name gets `-image`.
    expect(kindOf(await read({ data: "nul" }))).toBe("image-missing");
    expect(kindOf(await read({ data: "nul", type: "image/png" }))).toBe("nul-image.png");
    expect(kindOf(await read({ data: "x/../nul", type: "image/jpeg" }))).toBe("nul-image.jpg");
    expect(kindOf(await read({ data: "nul", type: "image/avif" }))).toBe("nul-image.avif");
    expect(kindOf(await read({ data: "nul", type: "image/bmp" }))).toBe("nul-image.bmp");
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
    const data = [
      "http://example.org/a.png",
      "/etc/a.png",
      "\\a.png",
      "%E0%A4%A",
      "../outside.png",
      "../gone.png",
      "link.png",
      ".",
    ];
    const results = await Promise.all(data.map(async (d) => kindOf(await read({ data: d }))));
    expect(results).toEqual(data.map(() => "image-outside"));
    expect(await read({ data: "gone.png" })).toEqual({
      kind: "image-missing",
      reason: "the image gone.png is not next to the ReqIF file",
    });
    expect(await read({ data: "sub", type: "image/png" })).toEqual({
      kind: "image-missing",
      reason: "the image sub is no file",
    });
  });

  it.skipIf(WINDOWS)("never waits for a FIFO or a socket, and refuses an image above the limit", async () => {
    const root = await folder({});
    execFileSync("mkfifo", [path.join(root, "in", "fifo.png")]);
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(path.join(root, "in", "socket.png"), resolve));
    onTestFinished(
      () =>
        new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        ),
    );
    const big = await fs.open(path.join(root, "in", "big.png"), "w");
    await big.truncate(IMAGE_LIMIT_BYTES + 1);
    await big.close();
    const read = imageReader(path.join(root, "in", "delivery.reqif"), OPEN);
    expect(await read({ data: "fifo.png" })).toEqual({
      kind: "image-missing",
      reason: "the image fifo.png is no file",
    });
    expect(await read({ data: "socket.png" })).toEqual({
      kind: "image-missing",
      // ENXIO on Linux, EOPNOTSUPP on macOS.
      reason: expect.stringMatching(/^the image socket\.png cannot be read \(.+\)$/) as unknown,
    });
    expect(await read({ data: "big.png" })).toEqual({
      kind: "image-missing",
      reason: `the image big.png is larger than ${String(IMAGE_LIMIT_BYTES)} bytes, the most the import copies`,
    });
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

  it("refuses a file swapped for another after it was opened, as it then reads another file", async () => {
    const root = await folder({ "a.png": PNG });
    // The path names another file once the handle is open (a swap, which Windows refuses for an
    // open file, so the check after the open is given another inode).
    const stat = fs.stat.bind(fs);
    const spy = vi.spyOn(fs, "stat").mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
      const got = await stat(...args);
      return Object.assign(got, { ino: Number(got.ino) + 1 });
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    expect(await imageReader(path.join(root, "in", "delivery.reqif"), OPEN)({ data: "a.png" })).toEqual({
      kind: "image-missing",
      reason: "the image a.png changed while it was read",
    });
  });

  it("refuses a file whose size changes while it is hashed", async () => {
    const root = await folder({ "a.png": PNG });
    const file = path.join(root, "in", "a.png");
    const stat = fs.stat.bind(fs);
    const spy = vi.spyOn(fs, "stat").mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
      await fs.truncate(file, 2);
      return stat(...args);
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    expect(await imageReader(path.join(root, "in", "delivery.reqif"), OPEN)({ data: "a.png" })).toEqual({
      kind: "image-missing",
      reason: "the image a.png changed while it was read",
    });
  });
});

describe("imageContent", () => {
  it("reads the image while it is copied, and refuses bytes that changed since they were hashed", async () => {
    const root = await folder({ "a.png": PNG });
    const read = await imageReader(path.join(root, "in", "delivery.reqif"), OPEN)({ data: "a.png" });
    if (read.kind !== "found") {
      throw new Error("not found");
    }
    expect(bytesOf(read.file)).toEqual(PNG);
    const refused = "Not imported: the image x.png changed while it was copied. Import again.";
    // The same size and file, other bytes.
    await fs.writeFile(read.file.path, Buffer.from([0, 0, 0, 0, 0]));
    expect(() => bytesOf(read.file)).toThrow(refused);
    // Another file of the same bytes.
    await fs.writeFile(`${read.file.path}.new`, PNG);
    await fs.rename(`${read.file.path}.new`, read.file.path);
    expect(() => bytesOf(read.file)).toThrow(refused);
    // A link to a file outside, swapped in for it (not followed), or no file at all.
    await fs.rm(read.file.path);
    expect(() => bytesOf(read.file)).toThrow(refused);
    if (!WINDOWS) {
      await fs.symlink(path.join(root, "outside.png"), read.file.path);
      expect(() => bytesOf(read.file)).toThrow(refused);
    }
  });
});

describe("ImageNames", () => {
  const image = (stem: string, sha256: string): ImageFile => ({
    path: "",
    sha256,
    stem,
    extension: ".png",
    size: 0,
    dev: 0,
    ino: 0,
  });

  it("gives each image a free name in the element's folder, in any case, and the same bytes one name", () => {
    const names = new ImageNames();
    expect(names.nameOf(image("Rose", "1"))).toBe("Rose.png");
    expect(names.nameOf(image("rose", "2"))).toBe("rose-2.png");
    expect(names.nameOf(image("other", "1"))).toBe("Rose.png");
    expect(names.files.map((f) => f.name)).toEqual(["Rose.png", "rose-2.png"]);
  });
});
