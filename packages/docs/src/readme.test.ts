import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pageSteps } from "./examples.js";

const repo = new URL("../../../", import.meta.url);
const read = async (path: string): Promise<string> => readFile(fileURLToPath(new URL(path, repo)), "utf8");

/** The first paragraph after the frontmatter and a level-1 heading. */
const firstParagraph = (text: string): string =>
  text
    .replace(/^---\r?\n[^]*?\r?\n---\r?\n/, "")
    .replace(/^\s*# .*\r?\n/, "")
    .trim()
    .split(/\r?\n\r?\n/)[0] ?? "";

// The README repeats two parts of the documentation (#344): they must not drift apart.
describe("README", () => {
  it("says what ReqSeq is in the same sentence as the landing page of the documentation", async () => {
    const sentence = firstParagraph(await read("docs/guide/index.md"));
    expect(sentence).toMatch(/^ReqSeq is /);
    expect(firstParagraph(await read("README.md"))).toBe(sentence);
  });

  it("has the commands of Get started as its quick start", async () => {
    const steps = async (path: string): Promise<(readonly string[])[]> =>
      pageSteps({ path, text: await read(path) }).map((step) => step.argv);
    const readme = await steps("README.md");
    expect(readme.length).toBeGreaterThanOrEqual(6);
    expect(readme).toEqual(await steps("docs/guide/start/get-started.md"));
  });
});
