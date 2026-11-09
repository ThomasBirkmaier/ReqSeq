// Whether a pull request changes what the guide's screenshots show (#1258). The Linux Electron run of CI writes them to
// test-results/electron/guide-images/ (packages/app/test/guide-screenshots.spec.ts). The nightly (or a manual) run on main keeps its
// screenshots in the Actions cache, and a pull request's run restores them to build/guide-images-main/; this compares
// the two and reports each screenshot that differs beyond a threshold, as a warning annotation and in the step summary,
// so the author runs `pnpm docs:screenshots` and commits docs/guide/images/. Both sides come from the same runner image:
// the committed copies cannot be the reference, because another machine's fonts move more pixels (0.5-4 %) than a
// changed layout does (0.2-0.6 %). It never fails the job.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodePng } from "./png.js";
import type { Pixels } from "./png.js";

/** Where the Electron run writes the screenshots, relative to the root. */
export const SHOTS_DIR = "test-results/electron/guide-images";
/** Where a pull request's run restores the screenshots of main's last nightly or manual run, relative to the root. */
export const MAIN_SHOTS_DIR = "build/guide-images-main";
/** The committed copies the author regenerates. */
export const GUIDE_IMAGES_DIR = "docs/guide/images";
/** The command that writes the committed copies. */
export const SCREENSHOTS_COMMAND = "pnpm docs:screenshots";
/** A pixel differs when one of its channels differs by more than this (anti-aliasing moves a few levels). */
export const CHANNEL_TOLERANCE = 32;
/** An image is reported when more than this share of its pixels differs: a changed word is about 0.1 %. */
export const DIFF_LIMIT = 0.0005;

/** The result of one screenshot: `share` is the share of differing pixels, undefined when it is new, resized or broken. */
export interface ImageCheck {
  readonly name: string;
  readonly share: number | undefined;
  /** Why it is reported, undefined when it shows what main shows or the pull request updated its copy. */
  readonly problem: string | undefined;
  /** Set when it differs from main and the pull request changed its copy in docs/guide/images/. */
  readonly updated?: true;
}

/** The share of pixels of two images of the same size that differ in a colour channel by more than the tolerance. */
export function differingShare(a: Pixels, b: Pixels): number {
  let differing = 0;
  const pixels = a.width * a.height;
  // A missing alpha channel is opaque.
  const channelOf = ({ channels, data }: Pixels) => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return (pixel: number, channel: number): number =>
      channel < channels ? view.getUint8(pixel * channels + channel) : 255;
  };
  const [left, right] = [channelOf(a), channelOf(b)];
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(left(pixel, channel) - right(pixel, channel)) > CHANNEL_TOLERANCE) {
        differing += 1;
        break;
      }
    }
  }
  return differing / pixels;
}

const percent = (share: number): string => `${(share * 100).toFixed(2)} %`;

/** Compares one screenshot of the run with main's (undefined when main has none); a broken PNG is reported too. */
export function checkImage(name: string, shot: Uint8Array, main: Uint8Array | undefined): ImageCheck {
  if (main === undefined) {
    return { name, share: undefined, problem: "is new" };
  }
  if (Buffer.compare(shot, main) === 0) {
    return { name, share: 0, problem: undefined };
  }
  let now: Pixels;
  let before: Pixels;
  try {
    [now, before] = [decodePng(shot), decodePng(main)];
  } catch (error) {
    return { name, share: undefined, problem: `cannot be compared (${(error as Error).message})` };
  }
  if (now.width !== before.width || now.height !== before.height) {
    const size = (image: Pixels): string => `${String(image.width)}×${String(image.height)}`;
    return { name, share: undefined, problem: `is ${size(now)}, ${size(before)} on main` };
  }
  const share = differingShare(now, before);
  return {
    name,
    share,
    problem: share > DIFF_LIMIT ? `differs from main in ${percent(share)} of its pixels` : undefined,
  };
}

/** Why nothing was compared: the run made no screenshots, or no screenshots of main were restored. */
export type NoComparison = "no-shots" | "no-main";

/**
 * Compares every screenshot in `<root>/SHOTS_DIR` with main's in `<root>/MAIN_SHOTS_DIR`. One that differs is not
 * reported when its name is in `updated`, the images whose copy in docs/guide/images/ the pull request changed: the
 * author did what the warning asks.
 */
export async function checkGuideImages(
  root: string,
  updated: ReadonlySet<string> = new Set(),
): Promise<ImageCheck[] | NoComparison> {
  const names = await readdir(join(root, SHOTS_DIR)).catch(() => undefined);
  if (names === undefined) {
    return "no-shots";
  }
  if ((await readdir(join(root, MAIN_SHOTS_DIR)).catch(() => undefined)) === undefined) {
    return "no-main";
  }
  const pngs = names.filter((name) => name.endsWith(".png")).sort();
  const checks = await Promise.all(
    pngs.map(async (name) =>
      checkImage(
        name,
        await readFile(join(root, SHOTS_DIR, name)),
        await readFile(join(root, MAIN_SHOTS_DIR, name)).catch(() => undefined),
      ),
    ),
  );
  return checks.map((check) =>
    check.problem !== undefined && updated.has(check.name)
      ? { name: check.name, share: check.share, problem: undefined, updated: true }
      : check,
  );
}

/** The names of the images in the text of `git diff --name-only` (one path per line, `/` or `\\`). */
export const updatedImages = (diff: string): ReadonlySet<string> =>
  new Set(
    diff
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^.*[\\/]/, ""))
      .filter((name) => name !== ""),
  );

/** Escapes the message of a GitHub workflow command, which reads `%`, CR and LF as its own. */
const escapeData = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/** The log lines (warning annotations for the changed images) and the Markdown of the step summary. */
export function guideImagesReport(
  checks: readonly ImageCheck[] | NoComparison,
  reference?: string,
): {
  log: string;
  summary: string;
} {
  if (checks === "no-shots") {
    return { log: `guide images: none in ${SHOTS_DIR} (another shard or system makes them)\n`, summary: "" };
  }
  if (checks === "no-main") {
    return {
      log: `guide images: no screenshots of a run on main in ${MAIN_SHOTS_DIR}, nothing compared\n`,
      summary: "",
    };
  }
  const stale = checks.filter((check) => check.problem !== undefined);
  const log = stale
    .map(
      ({ name, problem = "" }) =>
        `::warning file=${GUIDE_IMAGES_DIR}/${name},title=Guide screenshot changed::${escapeData(
          `${name} ${problem}: if the app's look changed, run \`${SCREENSHOTS_COMMAND}\` and commit ${GUIDE_IMAGES_DIR}/.`,
        )}\n`,
    )
    .join("");
  const state = ({ problem, updated }: ImageCheck): string =>
    problem !== undefined ? `changed: ${problem}` : updated ? "changed, copy updated" : "as on main";
  const rows = checks.map(
    (check) =>
      `| ${check.name} | ${check.share === undefined ? "-" : percent(check.share)} | ${state(check)} |`,
  );
  const summary = [
    "### Guide screenshots",
    "",
    stale.length === 0
      ? `None of the ${String(checks.length)} screenshots of the app differs from main without an updated copy.`
      : `${String(stale.length)} of ${String(checks.length)} screenshots differ from main: if the app's look changed, run \`${SCREENSHOTS_COMMAND}\` and commit them.`,
    "",
    `Screenshots of main: ${reference === undefined || reference === "" ? "the last run on main" : `cache \`${reference}\``}. A pull request merged after that run shows as a difference until the next nightly run.`,
    "",
    `| Image | Differing pixels | State (limit ${percent(DIFF_LIMIT)}) |`,
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  return {
    log: `${log}guide images: ${String(checks.length)} compared with main, ${String(stale.length)} changed\n`,
    summary,
  };
}
