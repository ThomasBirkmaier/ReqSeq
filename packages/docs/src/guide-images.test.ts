import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CHANNEL_TOLERANCE,
  GUIDE_IMAGES_DIR,
  SHOTS_DIR,
  checkGuideImages,
  checkImage,
  differingShare,
  guideImagesReport,
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
  it("finds a committed copy with the same bytes or the same pixels current", () => {
    expect(checkImage("app-overview.png", overview, overview)).toEqual({
      name: "app-overview.png",
      share: 0,
      problem: undefined,
    });
    // A chunk after the image data changes the bytes, not the pixels.
    const tail = Buffer.from([0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0, 0, 0, 0]);
    expect(checkImage("app-overview.png", Buffer.concat([overview, tail]), overview).problem).toBeUndefined();
  });

  it("reports a screenshot that is new, resized or differs beyond the limit", () => {
    expect(checkImage("app-new.png", overview, undefined)).toEqual({
      name: "app-new.png",
      share: undefined,
      problem: "is new and not committed",
    });
    expect(checkImage("app-overview.png", overview, standardModel).problem).toBe(
      "is 1024×576 in the app, 1368×922 committed",
    );
    const changed = checkImage("app-overview.png", overview, element);
    expect(changed.share).toBeGreaterThan(0.01);
    expect(changed.problem).toMatch(/^differs from the app in \d+\.\d\d % of its pixels$/);
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

  it("is undefined when the run made no screenshots", async () => {
    expect(await checkGuideImages(root)).toBeUndefined();
  });

  it("compares each screenshot of the run with its committed copy", async () => {
    await mkdir(join(root, SHOTS_DIR), { recursive: true });
    await mkdir(join(root, GUIDE_IMAGES_DIR), { recursive: true });
    await writeFile(join(root, SHOTS_DIR, "b.png"), overview);
    await writeFile(join(root, SHOTS_DIR, "a.png"), overview);
    await writeFile(join(root, SHOTS_DIR, "notes.txt"), "not an image");
    await writeFile(join(root, GUIDE_IMAGES_DIR, "a.png"), overview);
    expect(await checkGuideImages(root)).toEqual([
      { name: "a.png", share: 0, problem: undefined },
      { name: "b.png", share: undefined, problem: "is new and not committed" },
    ]);
  });
});

describe("guideImagesReport", () => {
  it("says so when this run made no screenshots", () => {
    expect(guideImagesReport(undefined)).toEqual({
      log: `guide images: none in ${SHOTS_DIR} (another shard or system makes them)\n`,
      summary: "",
    });
  });

  it("writes a warning per stale image and a table of all", () => {
    const { log, summary } = guideImagesReport([
      { name: "a.png", share: 0, problem: undefined },
      { name: "b.png", share: 0.0123, problem: "differs from the app in 1.23 % of its pixels" },
      { name: "c.png", share: undefined, problem: "is new and not committed" },
    ]);
    expect(log.split("\n")).toEqual([
      "::warning file=docs/guide/images/b.png,title=Guide screenshot is stale::b.png differs from the app in 1.23 %25 of its pixels: run `pnpm docs:screenshots` and commit docs/guide/images/.",
      "::warning file=docs/guide/images/c.png,title=Guide screenshot is stale::c.png is new and not committed: run `pnpm docs:screenshots` and commit docs/guide/images/.",
      "guide images: 3 compared, 2 stale",
      "",
    ]);
    expect(summary).toContain(
      "2 of 3 screenshots differ from the app: run `pnpm docs:screenshots` and commit them.",
    );
    expect(summary).toContain("| Image | Differing pixels | State (limit 0.05 %) |");
    expect(summary).toContain("| a.png | 0.00 % | current |");
    expect(summary).toContain("| b.png | 1.23 % | stale: differs from the app in 1.23 % of its pixels |");
    expect(summary).toContain("| c.png | - | stale: is new and not committed |");
  });

  it("escapes line breaks in a message and says when all are current", () => {
    const { log } = guideImagesReport([{ name: "a.png", share: undefined, problem: "x\r\ny" }]);
    expect(log).toContain("a.png x%0D%0Ay: run");
    expect(guideImagesReport([{ name: "a.png", share: 0, problem: undefined }])).toEqual({
      log: "guide images: 1 compared, 0 stale\n",
      summary: expect.stringContaining("The 1 screenshots of the app match docs/guide/images/.") as string,
    });
  });
});
