import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

/** What invoke gives: the output with its answer. */
type Output = CommandOutput<"element.readImage"> & { readonly answer: string };

/** WIND of fixtures/SR-001/two-elements, in requirements/SR-6328cee88fb3.md. */
const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";

/** A 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** The leading bytes of one image of each format, enough for its signature. */
const SIGNATURES: Readonly<Record<string, Buffer>> = {
  "image/avif": Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypavif\0\0\0\0avifmif1")]),
  "image/bmp": Buffer.concat([Buffer.from("BM"), Buffer.alloc(12), Buffer.from([40, 0, 0, 0])]),
  "image/gif": Buffer.from("GIF89a\x01\0\x01\0"),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
  "image/png": PNG,
  "image/svg+xml": Buffer.from(
    '<?xml version="1.0"?>\n<!-- logo -->\n<svg xmlns="http://www.w3.org/2000/svg"/>',
  ),
  "image/webp": Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBPVP8 ")]),
};

/** 20 MiB, the largest image the command returns (SR-251 AK1, AK6). */
const LIMIT = 20_971_520;

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
}

const open = async (options: FixtureOptions = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", ...options });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const read = async (opened: Opened, destination: string, ref = WIND): Promise<Output> =>
  (await invoke("element.readImage", { ref, destination }, { workspace: opened.workspace })) as Output;

const readError = async (opened: Opened, destination: string): Promise<CommandError> => {
  const error = await read(opened, destination).then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error instanceof CommandError) {
    return error;
  }
  throw new Error(`expected element.readImage to refuse ${destination}, got ${String(error)}`);
};

/** The code and reason of a refusal. */
const refusal = async (opened: Opened, destination: string): Promise<string> => {
  const error = await readError(opened, destination);
  return `${error.code} ${String(error.details?.["reason"])}`;
};

/** Every file below the fixture with its SHA-256, so a test sees that nothing changed. */
const snapshot = async (root: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files: Record<string, string> = {};
  for (const e of entries.filter((entry) => entry.isFile())) {
    const file = path.join(e.parentPath, e.name);
    files[path.relative(root, file)] = createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  }
  return files;
};

/** A file of `size` bytes that starts with `head`, written sparse. */
const sized = async (fixture: FixtureWorkspace, file: string, head: Buffer, size: number): Promise<void> => {
  await fixture.write(file, head);
  await fs.truncate(fixture.path(file), size);
};

/** Mocks `fs.open` for files ending in `suffix` with `opened`, and calls every other open as before. */
const mockOpen = (suffix: string, opened: () => Promise<FileHandle>): void => {
  const original = fs.open.bind(fs);
  vi.spyOn(fs, "open").mockImplementation(((file: string, ...rest: never[]) =>
    file.endsWith(suffix) ? opened() : original(file, ...rest)) as typeof fs.open);
  onTestFinished(() => {
    vi.restoreAllMocks();
  });
};

const errno = (code: string): Error => Object.assign(new Error(code), { code });

describe("element.readImage", () => {
  it("[SR-251/AK-bbgy] returns an image byte for byte with its media type and size, and changes no file", async () => {
    const opened = await open({
      files: {
        "requirements/SR-6328cee88fb3/Wind map (v2).png": PNG,
        "images/logo.png": PNG,
        [`requirements/limit.png`]: PNG,
      },
    });
    await sized(opened.fixture, "requirements/limit.png", PNG, LIMIT);
    const before = await snapshot(opened.fixture.root);
    // Escapes removed, query and fragment dropped, percent-decoded, `.` and `..` resolved without the disk;
    // an invalid percent-encoding stays as written. The text of WIND embeds none of these images.
    const same = [
      "SR-6328cee88fb3/Wind%20map%20\\(v2\\).png?raw=1#top",
      "./SR-6328cee88fb3/../SR-6328cee88fb3/Wind map (v2).png",
    ];
    for (const destination of same) {
      const output = await read(opened, destination);
      expect(output).toMatchObject({ mediaType: "image/png", size: PNG.length });
      expect(Buffer.from(output.content, "base64").equals(PNG)).toBe(true);
    }
    expect(await read(opened, "../images/logo.png")).toMatchObject({ size: PNG.length });
    await opened.fixture.write("requirements/100%.png", PNG);
    expect(await read(opened, "100%.png")).toMatchObject({ size: PNG.length });
    const largest = await read(opened, "limit.png");
    expect(largest.size).toBe(LIMIT);
    expect(Buffer.from(largest.content, "base64").length).toBe(LIMIT);
    expect((await read(opened, "x/../limit.png")).answer).toBe(
      `Read the image x/../limit.png: image/png, ${String(LIMIT)} bytes.`,
    );
    await fs.rm(opened.fixture.path("requirements/100%.png"));
    expect(await snapshot(opened.fixture.root)).toEqual(before);
  });

  it("[SR-251/AK-bbgy] tells the media type by the content of the file, not by its name", async () => {
    const signatures = Object.entries(SIGNATURES);
    const files = Object.fromEntries(
      signatures.map(([, bytes], i) => [`requirements/img/${String(i)}.bin`, bytes]),
    );
    const opened = await open({ files });
    for (const [i, [type, bytes]] of signatures.entries()) {
      const output = await read(opened, `img/${String(i)}.bin`);
      expect(output.mediaType).toBe(type);
      expect(Buffer.from(output.content, "base64").equals(bytes)).toBe(true);
    }
  });

  it("[SR-251/AK-y08y] refuses as missing what is no file in the repository or not spelled as on disk", async () => {
    const opened = await open({
      files: {
        "requirements/img/a.png": PNG,
        "requirements/img/sub/b.png": PNG,
        ".git/c.png": PNG,
        "requirements/node_modules/d.png": PNG,
        "requirements/drafts/e.png": PNG,
        "reqseq-workspace.yaml": [
          "reqseq-workspace: 1",
          "name: Weather station",
          "repositories:",
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
          "metamodel: { repository: system, path: metamodel }",
          "ignore: [requirements/drafts]",
          "",
        ].join("\n"),
      },
    });
    const nfd = "Cafe\u0301.png";
    await opened.fixture.write(`requirements/${nfd}`, PNG);
    await fs.symlink("img/a.png", opened.fixture.path("requirements/link.png"), "file");
    await fs.symlink(
      opened.fixture.path("requirements/img"),
      opened.fixture.path("requirements/linked"),
      "junction",
    );
    if (process.platform !== "win32") {
      // Names that Windows changes or refuses, on a disk where they exist; a fifo is never opened.
      for (const name of ["dot.png.", "space.png ", "a<b.png", "nul", "com1.png"]) {
        await opened.fixture.write(`requirements/${name}`, PNG);
      }
      await fs.writeFile(path.join(opened.fixture.path("requirements"), "a\\b.png"), PNG);
      const { execFileSync } = await import("node:child_process");
      execFileSync("mkfifo", [opened.fixture.path("requirements/fifo.png")]);
    }
    // In the other Unicode normal form the name is the same.
    expect(await read(opened, "Café.png")).toMatchObject({ size: PNG.length });
    const missing = [
      "gone.png",
      "img/gone/a.png",
      "img",
      "img/",
      ".",
      "..",
      "img/a.png/",
      "img/A.png",
      "IMG/a.png",
      "link.png",
      "linked/a.png",
      "../.git/c.png",
      "node_modules/d.png",
      "drafts/e.png",
      "dot.png.",
      "space.png%20",
      "a%3Cb.png",
      "nul",
      "com1.png",
      "img%5Ca.png",
      "a\\b.png",
      "%01.png",
      "?raw=1",
      "#top",
      ...(process.platform === "win32" ? [] : ["fifo.png"]),
    ];
    for (const destination of missing) {
      expect(`${destination}: ${await refusal(opened, destination)}`).toBe(
        `${destination}: input.invalid image-missing`,
      );
    }
    expect((await readError(opened, "gone.png")).message).toBe("Not read: the image gone.png does not exist");
  });

  it("[SR-251/AK-y08y] refuses a `\\` by its text, before any file system call", async () => {
    const opened = await open();
    await expect(read(opened, "x.png")).rejects.toThrow(); // loads the workspace first
    const calls = [
      vi.spyOn(fs, "readdir"),
      vi.spyOn(fs, "lstat"),
      vi.spyOn(fs, "open"),
      vi.spyOn(fs, "stat"),
    ];
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    for (const destination of ["\\\\host\\share\\a.png", "%5C%5Chost%5Cshare%5Ca.png", "img\\a.png"]) {
      expect(await refusal(opened, destination)).toBe("input.invalid image-missing");
    }
    expect(calls.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0, 0]);
  });

  it("[SR-251/AK-thgm] refuses a file or a folder on the way that cannot be read", async () => {
    const opened = await open({ files: { "requirements/img/a.png": PNG } });
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation(((folder: string, options: never) =>
      folder.endsWith(`requirements${path.sep}img`)
        ? Promise.reject(errno("EACCES"))
        : readdir(folder, options)) as typeof fs.readdir);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const folder = await readError(opened, "img/a.png");
    expect(folder).toMatchObject({
      code: "file.faulty",
      details: { reason: "image-unreadable", cause: "EACCES" },
    });
    expect(folder.message).toBe("Not read: the image img/a.png cannot be read (EACCES)");
    vi.restoreAllMocks();

    mockOpen("a.png", () => Promise.reject(errno("EACCES")));
    expect(await refusal(opened, "img/a.png")).toBe("file.faulty image-unreadable");
    vi.restoreAllMocks();

    // The file was there at the lookup and is gone or a link when it is opened: missing.
    for (const code of ["ENOENT", "ELOOP"]) {
      mockOpen("a.png", () => Promise.reject(errno(code)));
      expect(await refusal(opened, "img/a.png")).toBe("input.invalid image-missing");
      vi.restoreAllMocks();
    }

    const close = vi.fn(() => Promise.resolve());
    const handle = {
      stat: () => Promise.resolve({ size: PNG.length }),
      readFile: () => Promise.reject(errno("EIO")),
      close,
    } as unknown as FileHandle;
    mockOpen("a.png", () => Promise.resolve(handle));
    expect(await refusal(opened, "img/a.png")).toBe("file.faulty image-unreadable");
    expect(close).toHaveBeenCalledOnce();
  });

  it("[SR-251/AK-thgm] refuses a file whose entry cannot be read", async () => {
    const opened = await open({ files: { "requirements/img/a.png": PNG } });
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(((file: string, options: never) =>
      file.endsWith("a.png") ? Promise.reject(errno("EPERM")) : lstat(file, options)) as typeof fs.lstat);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    expect(await readError(opened, "img/a.png")).toMatchObject({
      code: "file.faulty",
      details: { reason: "image-unreadable", cause: "EPERM", destination: "img/a.png" },
    });
  });

  it("[SR-251/AK-jqn3] refuses a file whose content is no image of the formats, whatever its name", async () => {
    const opened = await open({
      files: {
        "requirements/img/notes.png": "no image",
        "requirements/img/empty.svg": "",
        "requirements/img/html.svg": "<html><svg/></html>",
        "requirements/img/gif.gif": "GIF90a",
      },
    });
    for (const destination of [
      "img/notes.png",
      "img/empty.svg",
      "img/html.svg",
      "img/gif.gif",
      "SR-6328cee88fb3.md",
    ]) {
      expect(`${destination}: ${await refusal(opened, destination)}`).toBe(
        `${destination}: input.invalid not-an-image`,
      );
    }
    expect((await readError(opened, "img/notes.png")).message).toBe(
      "Not read: img/notes.png is no AVIF, BMP, GIF, JPEG, PNG, SVG or WebP image by its content",
    );
  });

  it("[SR-251/AK-vj1m] refuses a destination with a scheme, a leading / or one out of the repository, unopened", async () => {
    const opened = await open({ files: { "outside.png": PNG } });
    await expect(read(opened, "x.png")).rejects.toThrow(); // loads the workspace first
    const calls = [vi.spyOn(fs, "readdir"), vi.spyOn(fs, "lstat"), vi.spyOn(fs, "open")];
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const causes: Record<string, string> = {
      "https://example.com/a.png": "scheme",
      "data:image/png;base64,iVBORw0KGgo=": "scheme",
      "file:///etc/passwd": "scheme",
      "C:/Windows/a.png": "scheme",
      "C:\\Windows\\a.png": "scheme",
      "/etc/passwd": "absolute",
      "\\/etc/passwd": "absolute",
      "../../outside.png": "parent",
      "%2e%2e/%2e%2e/outside.png": "parent",
      "../../x\\y.png": "parent",
    };
    for (const [destination, cause] of Object.entries(causes)) {
      const error = await readError(opened, destination);
      expect(
        `${destination}: ${error.code} ${String(error.details?.["reason"])} ${String(error.details?.["cause"])}`,
      ).toBe(`${destination}: input.invalid image-outside-repository ${cause}`);
    }
    expect(calls.map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
    expect((await readError(opened, "../../outside.png")).message).toBe(
      "Not read: the image ../../outside.png leads out of the repository with ..",
    );
  });

  it("[SR-251/AK-vj1m] refuses a destination into a nested Git repository or another repository of the workspace", async () => {
    const opened = await open({
      files: {
        "requirements/nested/.git": "gitdir: elsewhere",
        "requirements/nested/a.png": PNG,
        "inner/a.png": PNG,
        "reqseq-workspace.yaml": [
          "reqseq-workspace: 1",
          "name: Weather station",
          "repositories:",
          '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
          '  - { name: inner, url: "git@git.example.com:ws/inner.git", path: inner }',
          "metamodel: { repository: system, path: metamodel }",
          "",
        ].join("\n"),
      },
    });
    for (const destination of ["nested/a.png", "../inner/a.png"]) {
      const error = await readError(opened, destination);
      expect(error).toMatchObject({
        code: "input.invalid",
        details: { reason: "image-outside-repository", cause: "nested", destination },
      });
    }
    expect((await readError(opened, "nested/a.png")).message).toBe(
      "Not read: the image nested/a.png leads into a nested repository",
    );
  });

  it("[SR-251/AK-zbkc] refuses a file over 20 MiB with its size and the limit, also when it is no image", async () => {
    const opened = await open();
    await sized(opened.fixture, "requirements/big.png", PNG, LIMIT + 1);
    await sized(opened.fixture, "requirements/big.txt", Buffer.from("text"), LIMIT + 1);
    for (const destination of ["big.png", "big.txt"]) {
      const error = await readError(opened, destination);
      expect(error).toMatchObject({
        code: "input.invalid",
        details: { reason: "image-too-large", size: LIMIT + 1, limit: LIMIT },
      });
      expect(error.message).toBe(
        `Not read: the image ${destination} has 20971521 bytes, more than the limit of 20971520 bytes (20 MiB)`,
      );
    }
  });

  it("[SR-251/AK-zbkc] names the first reason in the order AK5, AK2, AK3, AK6, AK4", async () => {
    const opened = await open({
      files: {
        "requirements/nested/.git": "gitdir: elsewhere",
        "requirements/node_modules/x.png": "no image",
      },
    });
    await sized(opened.fixture, "requirements/big.txt", Buffer.from("text"), LIMIT + 1);
    // AK5 before AK2: a nested repository before a missing file, `..` out before a `\`.
    expect(await refusal(opened, "nested/gone.png")).toBe("input.invalid image-outside-repository");
    expect(await refusal(opened, "../../a\\b.png")).toBe("input.invalid image-outside-repository");
    // AK2 before AK4: a skipped name before content that is no image.
    expect(await refusal(opened, "node_modules/x.png")).toBe("input.invalid image-missing");
    // AK6 before AK4, and AK3 before AK6.
    expect(await refusal(opened, "big.txt")).toBe("input.invalid image-too-large");
    mockOpen("big.txt", () => Promise.reject(errno("EACCES")));
    expect(await refusal(opened, "big.txt")).toBe("file.faulty image-unreadable");
  });
});
