#!/usr/bin/env node
// Generates every icon file of the app and the docs from one master drawing (#410, ADR-0014):
// toolchain/packaging/icon/icon.svg. Renders the PNGs with the Chromium of Playwright (no network) and writes
// the results into the repository; run it after changing the master and commit what it writes.
//
//   node scripts/icon/generate.mjs
//   REQSEQ_CHROMIUM=/path/to/chromium node scripts/icon/generate.mjs   with a Chromium other than Playwright's
//
// macOS takes the master with the margin of its icon grid; Windows, Linux and the docs take it full bleed.
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fullBleed, icnsFile, icoFile } from "./lib.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const icon = path.join(root, "toolchain", "packaging", "icon");
const site = path.join(root, "packages", "docs", "site", "public");
const appPublic = path.join(root, "packages", "app", "src", "renderer", "public");
const { chromium } = createRequire(path.join(root, "packages", "app", "package.json"))("@playwright/test");

const master = await fs.readFile(path.join(icon, "icon.svg"), "utf8");
const bleed = fullBleed(master);

const executablePath = process.env.REQSEQ_CHROMIUM;
const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
const page = await browser.newPage();
/** The drawing as a PNG of size × size pixels, transparent outside the drawing. */
const render = async (svg, size) => {
  await page.setViewportSize({ width: size, height: size });
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};

const mac = new Map();
for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
  mac.set(size, await render(master, size));
}
const windows = [];
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  windows.push(await render(bleed, size));
}
const linux = new Map();
for (const size of [16, 32, 48, 64, 128, 256, 512]) {
  linux.set(size, await render(bleed, size));
}
const touch = await render(bleed, 180);
const favicon = await render(bleed, 32);
await browser.close();

await fs.writeFile(path.join(icon, "icon.icns"), icnsFile(mac));
await fs.writeFile(path.join(icon, "icon.ico"), icoFile(windows));
await fs.mkdir(path.join(icon, "icons"), { recursive: true });
for (const [size, png] of linux) {
  await fs.writeFile(path.join(icon, "icons", `${size}x${size}.png`), png);
}
// The window icon on Linux (shell.ts); the renderer build copies public/ into out/renderer/.
await fs.mkdir(appPublic, { recursive: true });
await fs.writeFile(path.join(appPublic, "icon.png"), linux.get(512));
await fs.writeFile(path.join(site, "favicon.svg"), `${bleed}\n`);
await fs.writeFile(path.join(site, "favicon.ico"), icoFile([favicon]));
await fs.writeFile(path.join(site, "apple-touch-icon.png"), touch);
