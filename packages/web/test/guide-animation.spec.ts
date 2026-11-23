// The animation at the top of the README and the guide's start page: the web UI in use on a copy of the repository's
// own specification (`spec/`), ending in the trace graph of a need with its system requirements. The scenes: the
// overview, a system requirement found with ⌘K (Ctrl+K), the list of system requirements narrowed to the approved
// ones, sorted by title and grouped by package, and the trace graph of a need. The elements are chosen by rule, so
// that the animation follows the specification as it changes: the need is an approved one whose system requirements
// are 2 to 4 approved ones that derive from it, so that they fit in one row below it, the most first, then the lowest
// spec-id; the requirement found with ⌘K is its first by spec-id.
//
// Each step is a frame with the time it stays, and typing is a frame every two letters. It runs only with
// REQSEQ_GUIDE_IMAGES set (`pnpm docs:screenshots`): the frames go to `test-results/web/guide-animation/`, and ffmpeg
// makes `docs/guide/images/ui-tour.gif` of them, committed after a run (ADR-0017). The times of the frames add up to
// at most 30 s, and every run checks that the README shows the committed animation and that it takes no longer.
// Linux only, at 1280×720 with the settings of the Playwright project `guide`, as the guide's screenshots; unlike
// those, nothing compares its pixels. The animation gets a grey frame with round corners, transparent outside, so that it
// reads as a screen on a light page and leaves no square corners on a dark one; ImageMagick then stores each frame
// as the rectangle that changed, which ffmpeg does not do once a frame has transparent pixels.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { CommandTypes } from "@reqseq/core";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { drawn, open } from "./fixtures.js";
import type { Run } from "./start-ui.js";
import { runOn, startUi } from "./start-ui.js";

const execFileAsync = promisify(execFile);
const REPO = path.join(import.meta.dirname, "..", "..", "..");
const FRAMES = path.join(REPO, "test-results", "web", "guide-animation");
const GIF = path.join(REPO, "docs", "guide", "images", "ui-tour.gif");
/** The most the animation may take once through. */
const LIMIT_MS = 30_000;
/**
 * The ffmpeg filter that draws the frame: a border of `B` pixels in a grey that shows on light and dark pages, round
 * corners of radius `R`, and transparent pixels outside them. `D` is the distance from the centre of the nearest
 * corner's circle, 0 away from the corners.
 */
const ROUNDED_FRAME = (() => {
  const R = "12";
  /** The radius at which the border starts: R less its width of 2 pixels. */
  const inner = "10";
  const B = "2";
  const D = `hypot(max(max(${R}-X,X-(W-1-${R})),0),max(max(${R}-Y,Y-(H-1-${R})),0))`;
  const border = `lt(min(min(X,W-1-X),min(Y,H-1-Y)),${B})+gt(${D},${inner})`;
  const grey = { r: "175", g: "184", b: "193" };
  return [
    `geq=r='if(${border},${grey.r},r(X,Y))'`,
    `g='if(${border},${grey.g},g(X,Y))'`,
    `b='if(${border},${grey.b},b(X,Y))'`,
    `a='if(gt(${D},${R}),0,255)'`,
  ].join(":");
})();
/** How long a frame of typing stays, and how many letters it adds: slow enough to read what is typed. */
const TYPING = { ms: 100, letters: 2 };
/** How long a frame stays: a typed input with its marked hit before Enter, a changed choice, and a loaded page. */
const HOLD = { input: 900, choice: 900, loaded: 1600 };

type Entry = NonNullable<CommandTypes["element.list"]["output"]["partial"]>[number];

interface Chosen {
  readonly need: Entry;
  /** Its system requirements, by spec-id. */
  readonly requirements: readonly Entry[];
}

/** The number in a spec-id such as SR-036, for the order. */
const number = (element: Entry): number => Number(/\d+$/.exec(element.identifier ?? "")?.[0] ?? Infinity);

/** The need of the graph and its system requirements, by the rule above, from the elements of the workspace. */
async function choose(run: Run): Promise<Chosen> {
  const { partial: all = [], total } = await run("element.list", {
    limit: 5000,
    fields: ["identifier", "type", "status", "title", "relations"],
  });
  // Every element on the one page: an incoming relation can come from any of them.
  expect(all.length).toBe(total);
  const candidates = all
    .filter((need) => need.type === "need" && need.status === "approved")
    .map((need) => {
      const derived = all.filter(
        (other) =>
          other.type === "system-requirement" &&
          (other.relations ?? []).some(
            (relation) =>
              relation.direction === "out" && relation.kind === "derives-from" && relation.id === need.id,
          ),
      );
      const fits =
        derived.length >= 2 &&
        derived.length <= 4 &&
        derived.every((requirement) => requirement.status === "approved");
      return { need, requirements: [...derived].sort((a, b) => number(a) - number(b)), fits };
    })
    .filter((candidate) => candidate.fits)
    .sort((a, b) => b.requirements.length - a.requirements.length || number(a.need) - number(b.need));
  const chosen = candidates[0];
  if (chosen === undefined) {
    throw new Error("spec/ has no approved need with 2 to 4 system requirements, all approved");
  }
  return chosen;
}

/**
 * The delays of a GIF's frames in ms, from its Graphic Control Extensions (GIF89a): the blocks are walked, so that
 * no byte of the image data is read as one.
 */
const gifDelays = (gif: Buffer): number[] => {
  const delays: number[] = [];
  /** Skips the data sub-blocks starting at `at`, returns the position after their terminator. */
  const skipBlocks = (at: number): number => {
    let position = at;
    while (gif[position] !== 0) {
      position += (gif[position] ?? 0) + 1;
    }
    return position + 1;
  };
  const tableSize = (packed: number): number => ((packed & 0x80) === 0 ? 0 : 3 * 2 ** ((packed & 0x07) + 1));
  let at = 13 + tableSize(gif[10] ?? 0);
  while (at < gif.length && gif[at] !== 0x3b) {
    if (gif[at] === 0x21) {
      if (gif[at + 1] === 0xf9) {
        delays.push(gif.readUInt16LE(at + 4) * 10);
      }
      at = skipBlocks(at + 2);
    } else if (gif[at] === 0x2c) {
      at = skipBlocks(at + 10 + tableSize(gif[at + 9] ?? 0) + 1);
    } else {
      throw new Error(`no GIF block at byte ${String(at)}`);
    }
  }
  return delays;
};
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** Waits until the page drew the route of the address bar and is no longer busy. */
const settled = async (page: Page): Promise<void> => {
  await drawn(page, await page.evaluate(() => location.hash.replace(/^#/, "")));
};

test.skip(process.platform !== "linux", "the guide's images are made on Linux only (ADR-0017)");

const regenerate = (process.env["REQSEQ_GUIDE_IMAGES"] ?? "") !== "";

test("the README shows the committed animation, and it takes at most 30 s once through", async () => {
  expect(await fs.readFile(path.join(REPO, "README.md"), "utf8")).toContain(
    "(docs/guide/images/ui-tour.gif)",
  );
  // A run that regenerates it checks the new one instead (below), so that a copy over the limit can be replaced.
  test.skip(regenerate, "the animation is made anew in this run");
  expect(sum(gifDelays(await fs.readFile(GIF)))).toBeLessThanOrEqual(LIMIT_MS);
});

test("the README animation: the web UI on spec/, a list narrowed, sorted and grouped, ending in a trace graph", async ({
  page,
}) => {
  test.skip(!regenerate, "made by `pnpm docs:screenshots` only");
  // About fifty frames on a workspace of some 600 elements: more than the default minute on a slow runner.
  test.setTimeout(180_000);
  const workspace = await createFixtureWorkspace({ fixture: "spec", fixturesDir: REPO });
  const run = runOn(workspace.root);
  const server = await startUi(workspace.root);
  const frames: { readonly file: string; readonly ms: number }[] = [];
  /** A frame of the page as it is now, shown for `ms`. */
  const frame = async (ms: number): Promise<void> => {
    const file = `${String(frames.length + 1).padStart(3, "0")}.png`;
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await fs.writeFile(
      path.join(FRAMES, file),
      await page.screenshot({ animations: "disabled", caret: "hide" }),
    );
    frames.push({ file, ms });
  };
  /** Types `text` into `field` a few letters at a time, a frame after each. */
  const type = async (field: ReturnType<Page["locator"]>, text: string): Promise<void> => {
    for (let at = 0; at < text.length; at += TYPING.letters) {
      await field.pressSequentially(text.slice(at, at + TYPING.letters));
      await frame(TYPING.ms);
    }
  };
  /** Finds `element` with ⌘K by its spec-id and opens it. */
  const find = async (element: Entry): Promise<void> => {
    await page.keyboard.press("ControlOrMeta+K");
    const finder = page.getByRole("combobox", { name: "Find a list or an element" });
    await expect(finder).toBeFocused();
    await type(finder, element.identifier ?? "");
    const hit = page
      .getByRole("listbox", { name: "Found" })
      .getByRole("option", { name: new RegExp((element.title ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })
      .first();
    await expect(hit).toBeVisible();
    await hit.hover();
    await expect(hit).toHaveAttribute("aria-selected", "true");
    await frame(HOLD.input);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(element.title ?? "");
    await settled(page);
  };

  try {
    await fs.rm(FRAMES, { recursive: true, force: true });
    await fs.mkdir(FRAMES, { recursive: true });
    const { need, requirements } = await choose(run);
    const [searched] = requirements;
    if (searched === undefined) {
      throw new Error("no system requirement");
    }

    // The overview of the workspace.
    await open(page, server.url);
    await frame(HOLD.loaded - 200);

    // A system requirement found with ⌘K.
    await find(searched);
    await frame(HOLD.loaded);

    // The list of the system requirements, from the rail.
    await open(page, server.url);
    const rail = page.getByRole("navigation", { name: "Workspace" });
    await rail.getByRole("link", { name: /^System requirements/ }).click();
    await settled(page);
    await expect(page.getByRole("heading", { level: 1, name: "System requirements" })).toBeVisible();
    await frame(HOLD.loaded);

    // Narrowed to the approved ones.
    const approved = await run("element.list", {
      limit: 1,
      selection: {
        where: { all: [{ type: ["system-requirement"], subtypes: false }, { status: ["approved"] }] },
      },
    });
    await page.locator(`[data-facet="status"][data-value='"approved"']`).check();
    await settled(page);
    await expect(page.locator(".count")).toHaveAttribute("data-count", String(approved.total));
    await frame(HOLD.choice);

    // Sorted by title, then grouped by package.
    await page.locator('[data-ctl="sort"]').selectOption("title");
    await settled(page);
    await frame(HOLD.choice);
    await page.locator('[data-ctl="group"]').selectOption("package");
    await settled(page);
    await frame(HOLD.loaded);

    // The end: the need and its system requirements, as a trace graph of the derivations.
    await find(need);
    await frame(800);
    await page.getByRole("link", { name: "Trace graph" }).click();
    await settled(page);
    await page.getByLabel("Derivations only").check();
    await settled(page);
    for (const requirement of requirements) {
      await expect(
        page.locator(".gnode").getByText(requirement.title ?? "", { exact: true }),
      ).toBeInViewport();
    }
    await frame(3000);
  } finally {
    await server.close();
    await workspace.cleanup();
  }

  // The animation once through takes at most 30 s.
  expect(sum(frames.map(({ ms }) => ms))).toBeLessThanOrEqual(LIMIT_MS);
  // The frame list of ffmpeg's concat demuxer; its last frame is named twice, so that its time counts.
  const list = [
    ...frames.flatMap(({ file, ms }) => [`file '${file}'`, `duration ${String(ms / 1000)}`]),
    `file '${frames.at(-1)?.file ?? ""}'`,
  ];
  await fs.writeFile(path.join(FRAMES, "frames.txt"), `${list.join("\n")}\n`);
  // One palette for all frames from what changes, with a transparent entry for the corners, and no dithering, so
  // that the text stays sharp.
  const raw = path.join(FRAMES, "ui-tour.raw.gif");
  await execFileAsync(
    "ffmpeg",
    [
      ["-y", "-loglevel", "error", "-f", "concat", "-i", "frames.txt"],
      [
        "-filter_complex",
        `format=rgba,${ROUNDED_FRAME},split[a][b];[a]palettegen=stats_mode=diff:reserve_transparent=1[p];` +
          "[b][p]paletteuse=dither=none:alpha_threshold=128",
      ],
      ["-loop", "0", raw],
    ].flat(),
    { cwd: FRAMES },
  );
  await execFileAsync("convert", [raw, "-layers", "Optimize", GIF]);
  expect(sum(gifDelays(await fs.readFile(GIF)))).toBeLessThanOrEqual(LIMIT_MS);
});
