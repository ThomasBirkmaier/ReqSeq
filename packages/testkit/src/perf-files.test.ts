// The performance suite runs in the pull request check at a small size (`REQSEQ_PERF_ELEMENTS`, #2037), so every
// Vitest perf file that generates a workspace takes its size from `perfSize`. A file with a fixed size of its own
// would run at 50,000 elements there and overrun the job (#2074). The check works per file: a file that calls
// `perfSize` is trusted to pass its size to each workspace it generates. Fixtures sized with `scaledCount` are outside it.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const PACKAGES = path.join(ROOT, "packages");

/**
 * The TypeScript files of the Vitest performance suite (`vitest.perf.config.ts`: `packages/*\/test/perf/**\/*.test.ts`)
 * with their helpers; the app's Playwright specs (`*.spec.ts`) run in their own suite.
 */
const perfFiles = (): string[] =>
  fs
    .readdirSync(PACKAGES)
    .map((name) => path.join(PACKAGES, name, "test", "perf"))
    .filter((folder) => fs.existsSync(folder))
    .flatMap((folder) =>
      (fs.readdirSync(folder, { recursive: true }) as string[])
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".spec.ts"))
        .map((file) => path.join(folder, file)),
    );

describe("the Vitest performance suite", () => {
  it("takes the size of every generated workspace from perfSize", () => {
    const files = perfFiles();
    expect(files.length).toBeGreaterThan(0);
    const fixed = files
      .filter((file) => {
        const text = fs.readFileSync(file, "utf8");
        return /\bgenerateLargeWorkspace\s*\(/.test(text) && !/\bperfSize\s*\(/.test(text);
      })
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"));
    expect(fixed).toEqual([]);
  });
});
