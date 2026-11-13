// The animation at the top of the README (SR-203 AK1): the steps of Get started done in the app, from an empty
// folder to the graph of the need, where it ends. The app opens the empty folder, initialises the workspace,
// creates the need and the system requirement with their texts, adds the relation and shows the graph of the need.
// The elements get the UUIDs of Get started and of `fixtures/enabler-344/weather-station` (`fixed-uuids.mjs`), so
// the animation shows the short IDs the README and Get started name (N-7fe707, SR-c67baa).
//
// Each step is a frame with the time it stays, and typing is a frame every few letters. The frames go to
// `test-results/electron/guide-animation/` (the CI artifact); with REQSEQ_GUIDE_IMAGES set (`pnpm docs:screenshots`)
// ffmpeg also makes `docs/guide/images/app-get-started.gif` of them, committed after a run (ADR-0017). Linux only,
// light, 1024×576, as the guide's screenshots; unlike those, nothing compares its pixels. The animation gets a grey frame with round
// corners, transparent outside, so that it reads as a screen on a light page and leaves no square corners on a dark
// one; ImageMagick then stores each frame as the rectangle that changed, which ffmpeg does not do once a frame has
// transparent pixels.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { launchApp, shownLayer } from "./support/app.js";

const execFileAsync = promisify(execFile);
const folder = (relative: string): string => fileURLToPath(new URL(`../../../${relative}`, import.meta.url));
const FRAMES = folder("test-results/electron/guide-animation");
const GIF = folder("docs/guide/images/app-get-started.gif");
const STUB = fileURLToPath(new URL("support/fixed-uuids.mjs", import.meta.url));
/** The UUIDs of the need and the system requirement of Get started, in the order they are created. */
const UUIDS = ["e317eb3c-003e-4db9-b8bf-d0e44b7fe707", "dd7fe8a3-8e25-4d5d-a764-58b371c67baa"];
const NEED = {
  title: "See the wind speed",
  text: "As a sailor, I want to see the wind speed before I leave the harbour.",
};
const REQUIREMENT = {
  title: "Show the wind speed",
  text: "The station must show the wind speed in knots, updated every 10 seconds.",
};
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

const label = (window: Page) => window.getByLabel("Minibuffer").locator("label");
const modeline = (window: Page) => window.getByLabel("Modeline");
const first = (window: Page) => window.locator('.candidates [role="option"] .name').first();
const heading = (window: Page) => shownLayer(window).locator("article h1");

test.skip(process.platform !== "linux", "the guide's images are made on Linux only (ADR-0017)");

test("[SR-203/AK-vj7k] the README animation: Get started in the app, ending in the graph of the need", async () => {
  // About a hundred frames: more than the default minute on a slow runner.
  test.setTimeout(120_000);
  // The README shows the animation.
  expect(await fs.readFile(folder("README.md"), "utf8")).toContain("(docs/guide/images/app-get-started.gif)");
  const empty = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-get-started-")));
  const running = await launchApp(
    { folder: empty, name: "weather-station" },
    { colorScheme: "light", withoutWorkspace: true },
  );
  // launchApp opened a copy of it.
  await fs.rm(empty, { recursive: true, force: true });
  const { app, window } = running;
  const frames: { readonly file: string; readonly ms: number }[] = [];
  /** A frame of the window as it is now, shown for `ms`. */
  const frame = async (ms: number): Promise<void> => {
    const file = `${String(frames.length + 1).padStart(3, "0")}.png`;
    await fs.writeFile(
      path.join(FRAMES, file),
      await window.screenshot({ animations: "disabled", caret: "hide" }),
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
  /** Runs a command of the command prompt by its name, shown typed. */
  const command = async (name: string): Promise<void> => {
    await window.keyboard.press("ControlOrMeta+Shift+P");
    await type(name);
    await expect(first(window)).toHaveText(name);
    await frame(500);
    await window.keyboard.press("Enter");
  };
  /** Creates an element of `type` with its title, then types its text and saves it. */
  const create = async (
    type_: string,
    element: { title: string; text: string },
    skip: number,
  ): Promise<void> => {
    await command("Create element");
    await expect(label(window)).toHaveText("Create element · type:");
    await type(type_);
    await expect(first(window)).toHaveText(type_);
    await frame(400);
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText(`Create element ${type_} · title:`);
    await type(element.title);
    await frame(400);
    await window.keyboard.press("Enter");
    // The required properties stay empty, as in Get started: an empty input skips each.
    for (let property = 0; property < skip; property += 1) {
      await expect(label(window)).toContainText(":");
      await window.keyboard.press("Enter");
    }
    await expect(heading(window)).toHaveText(element.title);
    await frame(900);
    await window.keyboard.press("Enter");
    await type(element.text);
    await window.keyboard.press("ControlOrMeta+S");
    await expect(modeline(window)).not.toContainText("modified");
    await frame(1000);
  };

  try {
    await fs.rm(FRAMES, { recursive: true, force: true });
    await fs.mkdir(FRAMES, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 576);
    });
    await expect
      .poll(() => window.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight]))
      .toEqual([1024, 576]);
    // The core process the folder starts gets the UUIDs (the main process passes its environment on); the folder
    // comes from the menu's dialog, answered here.
    await app.evaluate(
      ({ dialog, Menu }, [root, stub, uuids]) => {
        process.env["NODE_OPTIONS"] = `--import=${stub}`;
        process.env["REQSEQ_TEST_UUIDS"] = uuids;
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [root] });
        const file = Menu.getApplicationMenu()?.items.find((item) => item.label === "File");
        file?.submenu?.items.find((item) => item.label === "Open Workspace…")?.click();
      },
      [running.workspace?.root ?? "", STUB, UUIDS.join(",")] as const,
    );
    // The modeline says "No workspace" before the folder opens too: the hint of the folder's core says it is
    // open, and a prompt opened before then would be closed by the switch (#1413).
    await expect(modeline(window)).toContainText("No workspace");
    await expect(window.getByLabel("Minibuffer")).toContainText("Initialise workspace");
    await frame(1500);

    // reqseq workspace init . "Weather station"
    await command("Initialise workspace");
    await expect(label(window)).toHaveText("Initialise workspace · path:");
    await type(".");
    await frame(300);
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Initialise workspace . · name:");
    await type("Weather station");
    await frame(300);
    await window.keyboard.press("Enter");
    await expect(modeline(window)).toContainText("Weather station");
    await expect(modeline(window)).not.toContainText("No workspace");
    await frame(1500);

    // reqseq element create need … and system-requirement …
    await create("Need", NEED, 0);
    await expect(modeline(window)).toContainText("N-7fe707");
    await create("System Requirement", REQUIREMENT, 2);
    await expect(modeline(window)).toContainText("SR-c67baa");

    // reqseq relation add SR-c67baa derives-from N-7fe707
    await command("Create relation");
    await expect(label(window)).toHaveText("Create relation · source:");
    await window.keyboard.press("Enter");
    await expect(label(window)).toHaveText("Create relation SR-c67baa · kind:");
    await type("derives");
    await expect(first(window)).toHaveText("Derives from");
    await frame(400);
    await window.keyboard.press("Enter");
    await type("wind");
    await expect(first(window)).toHaveText(`N-7fe707 ${NEED.title}`);
    await frame(600);
    await window.keyboard.press("Enter");
    await expect(shownLayer(window).locator(".result")).toBeVisible();
    await frame(1000);

    // The end: the need and what hangs on it, as a graph.
    await window.keyboard.press("ControlOrMeta+P");
    await type("wind speed");
    await expect(window.locator('.candidates [role="option"]').first()).toContainText(NEED.title);
    await frame(500);
    await window.keyboard.press("Enter");
    await expect(heading(window)).toHaveText(NEED.title);
    await frame(900);
    await window.keyboard.press("ControlOrMeta+Shift+G");
    await expect(shownLayer(window).locator(".graph")).toBeVisible();
    await expect(window.getByText(REQUIREMENT.title)).toBeVisible();
    await frame(4000);
  } finally {
    await running.close();
  }

  // The frame list of ffmpeg's concat demuxer; its last frame is named twice, so that its time counts.
  const list = [
    ...frames.flatMap(({ file, ms }) => [`file '${file}'`, `duration ${String(ms / 1000)}`]),
    `file '${frames.at(-1)?.file ?? ""}'`,
  ];
  await fs.writeFile(path.join(FRAMES, "frames.txt"), `${list.join("\n")}\n`);
  if ((process.env["REQSEQ_GUIDE_IMAGES"] ?? "") !== "") {
    // One palette for all frames from what changes, with a transparent entry for the corners, and no dithering, so
    // that the text stays sharp.
    const raw = path.join(FRAMES, "app-get-started.raw.gif");
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
  }
});
