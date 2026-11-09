import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHANNEL_TOLERANCE,
  MAIN_SHOTS_DIR,
  SHOTS_DIR,
  checkGuideImages,
  checkImage,
  differingShare,
  guideImagesReport,
  updatedImages,
} from "./guide-images.js";

const image = (name: string): Promise<Buffer> =>
  readFile(fileURLToPath(new URL(`../../../docs/guide/images/${name}`, import.meta.url)));
let overview: Buffer;
let element: Buffer;
let standardModel: Buffer;
beforeAll(async () => {
  [overview, element, standardModel] = await Promise.all([
    image("app-overview.png"),
    image("app-element.png"),
    image("app-standard-model.png"),
  ]);
});

describe("differingShare", () => {
  it("counts the pixels with a channel beyond the tolerance, a missing alpha as opaque", () => {
    const rgb = {
      width: 2,
      height: 2,
      channels: 3 as const,
      data: Uint8Array.from([0, 0, 0, 9, 9, 9, 0, 0, 0, 0, 0, 0]),
    };
    const rgba = {
      width: 2,
      height: 2,
      channels: 4 as const,
      data: Uint8Array.from([CHANNEL_TOLERANCE, 0, 0, 255, 99, 9, 9, 255, 0, 0, 0, 0, 0, 0, 0, 255]),
    };
    // Pixel 1: within the tolerance; pixel 2: red differs; pixel 3: transparent; pixel 4: equal.
    expect(differingShare(rgb, rgba)).toBe(0.5);
    expect(differingShare(rgb, rgb)).toBe(0);
  });
});

describe("checkImage", () => {
  it("finds a screenshot with main's bytes or main's pixels unchanged", () => {
    expect(checkImage("app-overview.png", overview, overview)).toEqual({
      name: "app-overview.png",
      share: 0,
      problem: undefined,
    });
    // A chunk after the image data changes the bytes, not the pixels.
    const tail = Buffer.from([0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0, 0, 0, 0]);
    expect(checkImage("app-overview.png", Buffer.concat([overview, tail]), overview).problem).toBeUndefined();
  });

  it("reports a screenshot that is new, resized, broken or differs beyond the limit", () => {
    expect(checkImage("app-new.png", overview, undefined)).toEqual({
      name: "app-new.png",
      share: undefined,
      problem: "is new",
    });
    expect(checkImage("app-overview.png", overview, standardModel).problem).toBe(
      "is 1024×576, 1368×922 on main",
    );
    const changed = checkImage("app-overview.png", overview, element);
    expect(changed.share).toBeGreaterThan(0.01);
    expect(changed.problem).toMatch(/^differs from main in \d+\.\d\d % of its pixels$/);
    expect(checkImage("app-overview.png", Buffer.from("not a png"), overview)).toMatchObject({
      share: undefined,
      problem: expect.stringMatching(/^cannot be compared \(.+\)$/) as string,
    });
  });
});

describe("checkGuideImages", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "reqseq-guide-images-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("says when the run made no screenshots or main's were not restored", async () => {
    expect(await checkGuideImages(root)).toBe("no-shots");
    await mkdir(join(root, SHOTS_DIR), { recursive: true });
    expect(await checkGuideImages(root)).toBe("no-main");
  });

  it("compares each screenshot of the run with main's", async () => {
    await mkdir(join(root, MAIN_SHOTS_DIR), { recursive: true });
    await writeFile(join(root, SHOTS_DIR, "b.png"), overview);
    await writeFile(join(root, SHOTS_DIR, "a.png"), overview);
    await writeFile(join(root, SHOTS_DIR, "notes.txt"), "not an image");
    await writeFile(join(root, MAIN_SHOTS_DIR, "a.png"), overview);
    expect(await checkGuideImages(root)).toEqual([
      { name: "a.png", share: 0, problem: undefined },
      { name: "b.png", share: undefined, problem: "is new" },
    ]);
  });

  it("reports no image that differs from main when the pull request updated its copy", async () => {
    await writeFile(join(root, MAIN_SHOTS_DIR, "a.png"), element);
    expect(await checkGuideImages(root, new Set(["a.png", "c.png"]))).toEqual([
      { name: "a.png", share: expect.any(Number) as number, problem: undefined, updated: true },
      { name: "b.png", share: undefined, problem: "is new" },
    ]);
  });
});

describe("guideImagesReport", () => {
  it("reads the image names of a diff, with either separator", () => {
    expect(updatedImages("docs/guide/images/a.png\r\ndocs\\guide\\images\\b.png\n\n")).toEqual(
      new Set(["a.png", "b.png"]),
    );
    expect(updatedImages("")).toEqual(new Set());
  });

  it("says so when this run made no screenshots or has none of main", () => {
    expect(guideImagesReport("no-shots")).toEqual({
      log: `guide images: none in ${SHOTS_DIR} (another shard or system makes them)\n`,
      summary: "",
    });
    expect(guideImagesReport("no-main")).toEqual({
      log: `guide images: no screenshots of a run on main in ${MAIN_SHOTS_DIR}, nothing compared\n`,
      summary: "",
    });
  });

  it("writes a warning per changed image and a table of all", () => {
    const { log, summary } = guideImagesReport([
      { name: "a.png", share: 0, problem: undefined },
      { name: "b.png", share: 0.0123, problem: "differs from main in 1.23 % of its pixels" },
      { name: "c.png", share: undefined, problem: "is new" },
      { name: "d.png", share: 0.02, problem: undefined, updated: true },
    ]);
    expect(log.split("\n")).toEqual([
      "::warning file=docs/guide/images/b.png,title=Guide screenshot changed::b.png differs from main in 1.23 %25 of its pixels: if the app's look changed, run `pnpm docs:screenshots` and commit docs/guide/images/.",
      "::warning file=docs/guide/images/c.png,title=Guide screenshot changed::c.png is new: if the app's look changed, run `pnpm docs:screenshots` and commit docs/guide/images/.",
      "guide images: 4 compared with main, 2 changed",
      "",
    ]);
    expect(summary).toContain(
      "2 of 4 screenshots differ from main: if the app's look changed, run `pnpm docs:screenshots` and commit them.",
    );
    expect(summary).toContain("| Image | Differing pixels | State (limit 0.05 %) |");
    expect(summary).toContain("| a.png | 0.00 % | as on main |");
    expect(summary).toContain("| b.png | 1.23 % | changed: differs from main in 1.23 % of its pixels |");
    expect(summary).toContain("| c.png | - | changed: is new |");
    expect(summary).toContain("| d.png | 2.00 % | changed, copy updated |");
    expect(summary).toContain("Screenshots of main: the last run on main.");
  });

  it("escapes line breaks in a message and says when none changed", () => {
    const { log } = guideImagesReport([{ name: "a.png", share: undefined, problem: "x\r\ny" }]);
    expect(log).toContain("a.png x%0D%0Ay: if");
    expect(guideImagesReport([{ name: "a.png", share: 0, problem: undefined }], "")).toEqual({
      log: "guide images: 1 compared with main, 0 changed\n",
      summary: expect.stringContaining(
        "None of the 1 screenshots of the app differs from main without an updated copy.",
      ) as string,
    });
  });
});
