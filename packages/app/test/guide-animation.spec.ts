// The animation at the top of the README (SR-203): the app in use on a copy of the repository's own specification
// (`spec/`), ending in the graph of a need with its system requirements. The scenes: the overview, a system
// requirement opened through the search (Ctrl+P), the list of system requirements, the command prompt with
// "Filter list" marked and its command help (Ctrl+H, offered in a list), the list filtered, sorted and grouped, an
// element opened from the list, and the graph of a need. The elements are chosen by rule from the workspace, so
// that the animation follows the specification as it changes: the need is an approved one whose graph at depth 1
// holds only its packages and 3 to 6 approved system requirements that derive from it, the fewest first (a graph
// of three fits the window), then the lowest spec-id; the requirement opened through the search is its first by
// spec-id.
//
// Each step is a frame with the time it stays, and typing is a frame every few letters; while the command help
// slides in, its transition is paused and stepped, a frame per step. The frames go to
// `test-results/electron/guide-animation/` (the CI artifact); with REQSEQ_GUIDE_IMAGES set (`pnpm docs:screenshots`)
// ffmpeg also makes `docs/guide/images/app-tour.gif` of them, committed after a run (ADR-0017). The times of the
// frames, and of the committed animation, add up to at most 30 s (SR-203 AK2). Linux only, light, 1024×576, as the
// guide's screenshots; unlike those, nothing compares its pixels. The animation gets a grey frame with round
// corners, transparent outside, so that it reads as a screen on a light page and leaves no square corners on a dark
// one; ImageMagick then stores each frame as the rectangle that changed, which ffmpeg does not do once a frame has
// transparent pixels.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { RunningApp } from "./support/app.js";
import { launchApp, shownLayer } from "./support/app.js";

const execFileAsync = promisify(execFile);
const folder = (relative: string): string => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
const SPEC = folder("spec");
const FRAMES = folder("test-results/electron/guide-animation");
const GIF = folder("docs/guide/images/app-tour.gif");
/** The most the animation may take once through (SR-203 AK2). */
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
/** How long a frame of typing stays, and how many letters it adds. */
const TYPING = { ms: 60, letters: 4 };
/** The frames of the command help sliding in, and how long each stays. */
const SLIDE = { frames: 6, ms: 40 };

interface Listed {
  readonly partial: readonly Entry[];
  readonly total: number;
}
interface Entry {
  readonly id: string;
  readonly identifier: string;
  readonly type: string;
  readonly status: string;
  readonly title: string;
  readonly relations: readonly { readonly kind: string; readonly id: string; readonly direction: string }[];
}
interface Chosen {
  readonly need: Entry;
  /** Its system requirements, by spec-id. */
  readonly requirements: readonly Entry[];
}

/** The number in a spec-id such as SR-036, for the order. */
const number = (element: Entry): number => Number(/\d+$/.exec(element.identifier)?.[0] ?? Infinity);

/** The CLI's JSON output for `argv`. */
const cliJson = async <T>(running: RunningApp, argv: readonly string[]): Promise<T> => {
  const result = await running.cli([...argv]);
  expect(result.code, result.stdout).toBe(0);
  return JSON.parse(result.stdout) as T;
};

/** The need of the graph and its system requirements, by the rule above, from the elements of the workspace. */
const choose = async (running: RunningApp): Promise<Chosen> => {
  const { partial: all, total } = await cliJson<Listed>(running, [
    "element",
    "list",
    "--input",
    JSON.stringify({ limit: 5000, fields: ["identifier", "type", "status", "title", "relations"] }),
  ]);
  // Every element on the one page: an incoming relation can come from any of them.
  expect(all.length).toBe(total);
  const byId = new Map(all.map((element) => [element.id, element]));
  const candidates = all
    .filter((need) => need.type === "need" && need.status === "approved")
    .map((need) => {
      const out = need.relations.filter((relation) => relation.direction === "out");
      const incoming = all.filter((other) =>
        other.relations.some((relation) => relation.direction === "out" && relation.id === need.id),
      );
      const onlyPackages = out.every((relation) => byId.get(relation.id)?.type === "package");
      const derived = incoming.filter(
        (other) =>
          other.type === "system-requirement" &&
          other.relations.some((relation) => relation.kind === "derives-from" && relation.id === need.id),
      );
      const fits =
        onlyPackages &&
        derived.length === incoming.length &&
        derived.length >= 3 &&
        derived.length <= 6 &&
        derived.every((requirement) => requirement.status === "approved");
      return { need, requirements: [...derived].sort((a, b) => number(a) - number(b)), fits };
    })
    .filter((candidate) => candidate.fits)
    .sort((a, b) => a.requirements.length - b.requirements.length || number(a.need) - number(b.need));
  const chosen = candidates[0];
  if (chosen === undefined) {
    throw new Error("spec/ has no approved need with 3 to 6 approved system requirements and nothing else");
  }
  return chosen;
};

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

const label = (window: Page) => window.getByLabel("Minibuffer").locator("label");
const modeline = (window: Page) => window.getByLabel("Modeline");
const marked = (window: Page) => window.locator('.candidates [aria-selected="true"] .name');
const firstHit = (window: Page) => window.locator('.candidates [role="option"]').first();
const heading = (window: Page) => shownLayer(window).locator("article h1");
const help = (window: Page) => window.getByRole("region", { name: "Command help" });
const rows = (window: Page) => shownLayer(window).locator(".row .title");

test.skip(process.platform !== "linux", "the guide's images are made on Linux only (ADR-0017)");

test("[SR-203/AK-vj7k] [SR-203/AK-qq6z] the README animation: the app on spec/, the command help, a list filtered, sorted and grouped, ending in the graph of a need, at most 30 s", async () => {
  // About a hundred frames on a workspace of some 500 elements: more than the default minute on a slow runner.
  test.setTimeout(180_000);
  // The README shows the animation, and the committed one runs at most 30 s.
  expect(await fs.readFile(folder("README.md"), "utf8")).toContain("(docs/guide/images/app-tour.gif)");
  expect(sum(gifDelays(await fs.readFile(GIF)))).toBeLessThanOrEqual(LIMIT_MS);
  const running = await launchApp({ folder: SPEC }, { colorScheme: "light" });
  const { app, window } = running;
  const frames: { readonly file: string; readonly ms: number }[] = [];
  /** A frame of the window as it is now, shown for `ms`; `moving` keeps a paused transition where it stands. */
  const frame = async (ms: number, moving = false): Promise<void> => {
    const file = `${String(frames.length + 1).padStart(3, "0")}.png`;
    await fs.writeFile(
      path.join(FRAMES, file),
      await window.screenshot({ animations: moving ? "allow" : "disabled", caret: "hide" }),
    );
    frames.push({ file, ms });
  };
  /** Types `text` a few letters at a time, a frame after each. */
  const type = async (text: string): Promise<void> => {
    for (let at = 0; at < text.length; at += TYPING.letters) {
      await window.keyboard.type(text.slice(at, at + TYPING.letters));
      await frame(TYPING.ms);
    }
  };
  /** Opens the command prompt and types `name` until it is the marked command. */
  const mark = async (name: string): Promise<void> => {
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await type(name);
    await expect(marked(window)).toHaveText(name);
    await frame(500);
  };
  /** Runs the command `name`, then answers its prompt `prompt` with the choice `choice`, typed as `typed`. */
  const run = async (name: string, prompt: string, typed: string, choice: string): Promise<void> => {
    await mark(name);
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(prompt);
    await type(typed);
    await expect(marked(window)).toHaveText(choice);
    await frame(400);
    await window.keyboard.press("Enter");
  };
  /** Opens `element` through the search (Ctrl+P) by its spec-id. */
  const search = async (element: Entry): Promise<void> => {
    await window.keyboard.press("ControlOrMeta+P");
    await type(element.identifier);
    await expect(firstHit(window)).toContainText(element.title);
    await frame(500);
    await window.keyboard.press("Enter");
    await expect(heading(window)).toHaveText(element.title);
    await expect(modeline(window)).toContainText(element.identifier);
  };

  try {
    await fs.rm(FRAMES, { recursive: true, force: true });
    await fs.mkdir(FRAMES, { recursive: true });
    const { need, requirements } = await choose(running);
    const [searched] = requirements;
    if (searched === undefined) {
      throw new Error("no system requirement");
    }
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 576);
    });
    await expect
      .poll(() => window.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]))
      .toEqual([1024, 576]);
    // Until the workspace is loaded, within the test's own bound: on a loaded runner it takes longer than 5 s.
    await expect(modeline(window)).toContainText("elements", { timeout: 0 });

    // The overview of the workspace.
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await frame(1500);

    // A system requirement through the search.
    await search(searched);
    await frame(1800);

    // The list of the system requirements, from the line of their type in the overview.
    const { total: count } = await cliJson<{ total: number }>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ selection: { where: { type: ["system-requirement"], subtypes: false } }, limit: 1 }),
    ]);
    await mark("Show overview");
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox", { name: "Overview" })).toBeVisible();
    await window.keyboard.press("ArrowDown");
    await window.keyboard.press("ArrowDown");
    await expect(window.getByRole("option", { selected: true })).toHaveText(
      `System Requirement ${String(count)}`,
    );
    await frame(500);
    await window.keyboard.press("Enter");
    await expect(window.getByRole("listbox")).toHaveAttribute("aria-label", "type: system-requirement");
    await expect(modeline(window)).toContainText(`${String(count)} elements`);
    await frame(1500);

    // "Filter list" marked, and its command help sliding in (Ctrl+H, SR-133 AK1): the transitions it starts are
    // paused and stepped, a frame per step.
    await mark("Filter list");
    await window.keyboard.press("Control+H");
    await expect(window.locator('#command-help[data-open="true"]')).toHaveCount(1);
    await expect
      .poll(() =>
        window.evaluate(() => {
          const moving = document.getAnimations().filter((one) => one instanceof CSSTransition);
          for (const one of moving) {
            one.pause();
          }
          return moving.length;
        }),
      )
      .toBeGreaterThan(0);
    for (let step = 1; step <= SLIDE.frames; step += 1) {
      await window.evaluate((share) => {
        for (const one of document.getAnimations().filter((each) => each instanceof CSSTransition)) {
          const end = Number(one.effect?.getComputedTiming().endTime ?? 0);
          one.currentTime = end * share;
        }
      }, step / SLIDE.frames);
      await frame(SLIDE.ms, true);
    }
    await window.evaluate(() => {
      for (const one of document.getAnimations().filter((each) => each instanceof CSSTransition)) {
        one.finish();
      }
    });
    await expect(help(window).locator("h2")).toHaveText("Filter list");
    await frame(2500);
    await window.keyboard.press("Control+H");
    await expect(window.locator('#command-help[data-open="true"]')).toHaveCount(0);
    await frame(300);

    // Filtered to the approved ones, sorted by title, grouped by package.
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Filter by");
    await type("Status");
    await expect(marked(window)).toHaveText("Status");
    await frame(400);
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Status");
    await type("appr");
    await expect(marked(window)).toHaveText("Approved");
    await frame(400);
    await window.keyboard.press("Enter");
    const selection = {
      where: { all: [{ type: ["system-requirement"], subtypes: false }, { status: ["approved"] }] },
    };
    const { total: approved } = await cliJson<{ total: number }>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ selection, limit: 1 }),
    ]);
    await expect(modeline(window)).toContainText("status: approved");
    await expect(modeline(window)).toContainText(`${String(approved)} elements`);
    await frame(1500);

    await run("Sort list", "Sort by", "Title", "Title");
    await expect(label(window)).toHaveText("Order");
    await type("asc");
    await expect(marked(window)).toHaveText("ascending");
    await frame(400);
    await window.keyboard.press("Enter");
    await expect(modeline(window)).toContainText("sorted by title");
    const { elements: byTitle } = await cliJson<{ elements: readonly { title: string }[] }>(running, [
      "element",
      "list",
      "--input",
      JSON.stringify({ selection, sort: [{ by: "title", order: "asc" }], limit: 10 }),
    ]);
    await expect(rows(window).first()).toHaveText(byTitle[0]?.title ?? "");
    expect((await rows(window).allTextContents()).slice(0, 10)).toEqual(byTitle.map((one) => one.title));
    await frame(1500);

    await run("Group list", "Group by", "Pack", "Package");
    await expect(modeline(window)).toContainText("grouped by package");
    await expect(shownLayer(window).locator(".group h2").first()).toBeVisible();
    await frame(2000);

    // The first element of the list.
    const title = (await rows(window).first().textContent()) ?? "";
    await window.keyboard.press("ArrowDown");
    await frame(400);
    await window.keyboard.press("Enter");
    await expect(heading(window)).toHaveText(title);
    await frame(1500);

    // The end: the need and its system requirements, as a graph.
    await search(need);
    await frame(900);
    await window.keyboard.press("ControlOrMeta+Shift+G");
    const { nodes } = await cliJson<{ nodes: readonly unknown[] }>(running, [
      "trace",
      "graph",
      "--input",
      JSON.stringify({ ref: need.identifier, maxDepth: 1, limit: 500 }),
    ]);
    await expect(shownLayer(window).locator(".graph")).toHaveAttribute("data-laid-out", String(nodes.length));
    for (const requirement of requirements) {
      await expect(shownLayer(window).locator(".graph").getByText(requirement.title)).toBeInViewport();
    }
    await frame(4000);
  } finally {
    await running.close();
  }

  // The animation once through takes at most 30 s (AK2).
  expect(sum(frames.map(({ ms }) => ms))).toBeLessThanOrEqual(LIMIT_MS);
  // The frame list of ffmpeg's concat demuxer; its last frame is named twice, so that its time counts.
  const list = [
    ...frames.flatMap(({ file, ms }) => [`file '${file}'`, `duration ${String(ms / 1000)}`]),
    `file '${frames.at(-1)?.file ?? ""}'`,
  ];
  await fs.writeFile(path.join(FRAMES, "frames.txt"), `${list.join("\n")}\n`);
  if ((process.env["REQSEQ_GUIDE_IMAGES"] ?? "") !== "") {
    // One palette for all frames from what changes, with a transparent entry for the corners, and no dithering, so
    // that the text stays sharp.
    const raw = path.join(FRAMES, "app-tour.raw.gif");
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
  }
});
