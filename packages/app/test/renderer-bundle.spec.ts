// The built renderer (`pnpm build:electron`) runs offline and under the CSP (SR-078, ADR-0010): a tripwire
// on the bundle, the third-party code included (KaTeX, SR-096). A hit is reviewed and fixed in our code or
// the build configuration; a string is never allowed here without that review.
import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const RENDERER = path.join(import.meta.dirname, "..", "out", "renderer");

/** The file types the `app:` handler serves (`src/main/protocols.ts`); any other file would not load. */
const SERVED = [".css", ".html", ".js", ".json", ".png", ".svg", ".woff2"];

/**
 * What a script of the renderer must not contain: a network or worker API, code built from strings, or a
 * Node module. `fetch() {` is a method of KaTeX's parser (it reads the next token), not the network call.
 */
const FORBIDDEN: readonly RegExp[] = [
  /XMLHttpRequest/,
  /WebSocket/,
  /EventSource/,
  /sendBeacon/,
  /importScripts/,
  /new\s+(?:Shared)?Worker\s*\(/,
  /(?<![\w$.])(?:new\s+)?Function\s*\(/,
  /(?<![\w$.])eval\s*\(/,
  /child_process/,
  /(?<![\w$.])fetch\s*\((?!\)\s*\{)/,
];

const files = async (folder: string): Promise<string[]> => {
  const entries = await fs.readdir(folder, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
};

test.describe("the renderer bundle", () => {
  test("has only files the app serves: no woff or ttf font of KaTeX (SR-096)", async () => {
    const all = await files(RENDERER);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((file) => !SERVED.includes(path.extname(file).toLowerCase()))).toEqual([]);
    // KaTeX's fonts are there, as files.
    expect(all.some((file) => /KaTeX_Main-Regular-[\w-]+\.woff2$/.test(file))).toBe(true);
  });

  test("inlines nothing into its style sheets: a data: URL font is blocked by the CSP (SR-096)", async () => {
    for (const file of (await files(RENDERER)).filter((name) => name.endsWith(".css"))) {
      const css = await fs.readFile(file, "utf8");
      expect([path.basename(file), css.includes("url(data:")]).toEqual([path.basename(file), false]);
    }
  });

  test("has no network, worker or eval in its scripts (SR-078)", async () => {
    for (const file of (await files(RENDERER)).filter((name) => name.endsWith(".js"))) {
      const script = await fs.readFile(file, "utf8");
      const hits = FORBIDDEN.flatMap((pattern) => {
        const found = pattern.exec(script);
        return found === null
          ? []
          : [`${pattern.source}: …${script.slice(found.index - 40, found.index + 40)}…`];
      });
      expect([path.basename(file), hits]).toEqual([path.basename(file), []]);
    }
  });
});
