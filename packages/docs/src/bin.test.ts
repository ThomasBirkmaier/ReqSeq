import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type * as Assemble from "./assemble.js";
import type * as Examples from "./examples.js";

const assembleContent = vi.fn(() => Promise.resolve(["index.md"]));
const pages = [{ path: "index.md", text: "Index." }];
const readGuidePages = vi.fn(() => Promise.resolve(pages));
const checkExamples = vi.fn(() => Promise.resolve(7));
const wordWarnings = vi.fn(() => ["index.md has 601 words, above the budget of 600"]);
vi.mock("./assemble.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Assemble>()),
  assembleContent,
}));
vi.mock("./examples.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Examples>()),
  readGuidePages,
  checkExamples,
  wordWarnings,
}));

describe("bin", () => {
  it("warns on long pages, runs the examples and assembles the content folder of this package's site", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await import("./bin.js");
    const { contentPaths } = await import("./assemble.js");
    const { runReqseq } = await import("./examples.js");
    const paths = contentPaths(fileURLToPath(new URL("../", import.meta.url)));
    expect(readGuidePages).toHaveBeenCalledWith(paths.guideDir);
    expect(wordWarnings).toHaveBeenCalledWith(pages);
    expect(warn).toHaveBeenCalledWith("docs: warning: index.md has 601 words, above the budget of 600\n");
    expect(checkExamples).toHaveBeenCalledWith(pages, runReqseq);
    expect(assembleContent).toHaveBeenCalledWith(paths);
    expect(write).toHaveBeenCalledWith("docs: 7 example commands passed, 1 files in the content folder\n");
    write.mockRestore();
    warn.mockRestore();
  });
});
