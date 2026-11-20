import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pageSteps } from "./examples.js";

const repo = new URL("../../../", import.meta.url);
const read = async (path: string): Promise<string> => readFile(fileURLToPath(new URL(path, repo)), "utf8");

/** The paragraphs after the frontmatter and a level-1 heading, up to the first one that is not text. */
const lead = (text: string): string =>
  text
    .replace(/^---\r?\n[^]*?\r?\n---\r?\n/, "")
    .replace(/^\s*# .*\r?\n/, "")
    .trim()
    .split(/\r?\n\r?\n/)
    .filter((_paragraph, index, all) => !all.slice(0, index + 1).some((one) => /^[!<[]/.test(one)))
    .join("\n\n");

// The README repeats two parts of the documentation (#344): they must not drift apart.
describe("README", () => {
  it("says what ReqSeq is in the same sentences as the landing page of the documentation", async () => {
    const sentences = lead(await read("docs/guide/index.md"));
    expect(sentences).toMatch(/ReqSeq/);
    expect(lead(await read("README.md"))).toBe(sentences);
  });

  it("shows the pictures of the README on the landing page of the documentation", async () => {
    const pictures = (text: string): string[] =>
      [
        ...new Set([...text.matchAll(/images\/([\w-]+\.(?:svg|gif|png))/g)].map((match) => match[1] ?? "")),
      ].sort();
    const readme = pictures(await read("README.md"));
    expect(readme.length).toBeGreaterThanOrEqual(3);
    expect(pictures(await read("docs/guide/index.md"))).toEqual(readme);
  });

  it("has the commands of Get started as its quick start", async () => {
    const steps = async (path: string): Promise<(readonly string[])[]> =>
      pageSteps({ path, text: await read(path) }).flatMap((step) => ("argv" in step ? [step.argv] : []));
    const readme = await steps("README.md");
    expect(readme.length).toBeGreaterThanOrEqual(6);
    expect(readme).toEqual(await steps("docs/guide/start/get-started.md"));
  });
});
