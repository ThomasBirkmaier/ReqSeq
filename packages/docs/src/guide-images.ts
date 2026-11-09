// Whether the committed screenshots of the guide still show the app (#1258). The Linux Electron run of CI writes
// them to test-results/electron/guide-images/ (packages/app/test/guide-screenshots.spec.ts); this compares each with
// its copy in docs/guide/images/ and reports the ones that differ beyond a threshold, as warning annotations and in the
// step summary. It never fails: fonts or a runner image may move pixels, and `pnpm docs:screenshots` is the fix.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { decodePng } from "./png.js";
import type { Pixels } from "./png.js";

/** Where the Electron run writes the screenshots and where their committed copies are, relative to the root. */
export const SHOTS_DIR = "test-results/electron/guide-images";
export const GUIDE_IMAGES_DIR = "docs/guide/images";
/** The command that writes the committed copies. */
export const SCREENSHOTS_COMMAND = "pnpm docs:screenshots";
/** A pixel differs when one of its channels differs by more than this (anti-aliasing moves a few levels). */
export const CHANNEL_TOLERANCE = 32;
/** An image is reported when more than this share of its pixels differs: a changed word is about 0.1 %. */
export const DIFF_LIMIT = 0.0005;

/** The result of one screenshot: `share` is the share of differing pixels, undefined when the image is new or resized. */
export interface ImageCheck {
  readonly name: string;
  readonly share: number | undefined;
  /** Why it is reported, undefined when the committed copy is current. */
  readonly problem: string | undefined;
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

/** Compares one screenshot of the run with its committed copy (undefined when there is none). */
export function checkImage(name: string, shot: Uint8Array, committed: Uint8Array | undefined): ImageCheck {
  if (committed === undefined) {
    return { name, share: undefined, problem: "is new and not committed" };
  }
  if (Buffer.compare(shot, committed) === 0) {
    return { name, share: 0, problem: undefined };
  }
  const [now, before] = [decodePng(shot), decodePng(committed)];
  if (now.width !== before.width || now.height !== before.height) {
    const size = (image: Pixels): string => `${String(image.width)}×${String(image.height)}`;
    return { name, share: undefined, problem: `is ${size(now)} in the app, ${size(before)} committed` };
  }
  const share = differingShare(now, before);
  return {
    name,
    share,
    problem: share > DIFF_LIMIT ? `differs from the app in ${percent(share)} of its pixels` : undefined,
  };
}

/** Compares every screenshot in `<root>/SHOTS_DIR` with its committed copy; undefined when the run made none. */
export async function checkGuideImages(root: string): Promise<ImageCheck[] | undefined> {
  const names = await readdir(join(root, SHOTS_DIR)).catch(() => undefined);
  if (names === undefined) {
    return undefined;
  }
  const pngs = names.filter((name) => name.endsWith(".png")).sort();
  return Promise.all(
    pngs.map(async (name) =>
      checkImage(
        name,
        await readFile(join(root, SHOTS_DIR, name)),
        await readFile(join(root, GUIDE_IMAGES_DIR, name)).catch(() => undefined),
      ),
    ),
  );
}

/** Escapes the message of a GitHub workflow command, which reads `%`, CR and LF as its own. */
const escapeData = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/** The log lines (warning annotations for the stale images) and the Markdown of the step summary. */
export function guideImagesReport(checks: readonly ImageCheck[] | undefined): {
  log: string;
  summary: string;
} {
  if (checks === undefined) {
    return { log: `guide images: none in ${SHOTS_DIR} (another shard or system makes them)\n`, summary: "" };
  }
  const stale = checks.filter((check) => check.problem !== undefined);
  const log = stale
    .map(
      ({ name, problem = "" }) =>
        `::warning file=${GUIDE_IMAGES_DIR}/${name},title=Guide screenshot is stale::${escapeData(
          `${name} ${problem}: run \`${SCREENSHOTS_COMMAND}\` and commit docs/guide/images/.`,
        )}\n`,
    )
    .join("");
  const rows = checks.map(
    ({ name, share, problem }) =>
      `| ${name} | ${share === undefined ? "-" : percent(share)} | ${problem === undefined ? "current" : `stale: ${problem}`} |`,
  );
  const summary = [
    "### Guide screenshots",
    "",
    stale.length === 0
      ? `The ${String(checks.length)} screenshots of the app match docs/guide/images/.`
      : `${String(stale.length)} of ${String(checks.length)} screenshots differ from the app: run \`${SCREENSHOTS_COMMAND}\` and commit them.`,
    "",
    `| Image | Differing pixels | State (limit ${percent(DIFF_LIMIT)}) |`,
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  return {
    log: `${log}guide images: ${String(checks.length)} compared, ${String(stale.length)} stale\n`,
    summary,
  };
}
