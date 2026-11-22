// The built pages hold what the page CSP allows (ADR-0020, Response headers): no inline script or style, no asset
// inlined as a `data:` URL, only relative URLs.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PAGES } from "./start-ui.js";

const files = (): string[] =>
  fs
    .readdirSync(PAGES, { recursive: true, encoding: "utf8" })
    .filter((f) => fs.statSync(path.join(PAGES, f)).isFile());

test("the built pages have no inline script or style and inline no asset", () => {
  const html = fs.readFileSync(path.join(PAGES, "index.html"), "utf8");
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  expect(html).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=/i);
  expect(html).not.toMatch(/(?:src|href)="\/(?!\/)/);
  for (const file of files().filter((f) => f.endsWith(".css"))) {
    expect(fs.readFileSync(path.join(PAGES, file), "utf8"), file).not.toContain("url(data:");
  }
  // Fonts are woff2 files of their own.
  expect(files().filter((f) => f.endsWith(".woff2")).length).toBeGreaterThan(0);
  expect(files().filter((f) => /\.(?:woff|ttf)$/.test(f))).toEqual([]);
});
