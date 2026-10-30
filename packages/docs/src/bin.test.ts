import { fileURLToPath } from "node:url";
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it, vi } from "vitest";
import type * as Assemble from "./assemble.js";
import type * as Codes from "./codes.js";
import type * as Examples from "./examples.js";
import type * as Formats from "./formats.js";
import type * as Reference from "./reference.js";
import type * as Model from "./standard-model.js";

const assembleContent = vi.fn(() => Promise.resolve(["index.md"]));
const referencePages = vi.fn(() => Promise.resolve([{ path: "reference/commands/index.md", text: "" }]));
const generated = { openapi: { paths: {} }, mcpTools: { tools: [] } };
const readGeneratedContracts = vi.fn(() => Promise.resolve(generated));
const guide = [{ path: "index.md", text: "Index." }];
const readGuidePages = vi.fn(() => Promise.resolve(guide));
const checkExamples = vi.fn(() => Promise.resolve(7));
const wordWarnings = vi.fn(() => ["index.md has 601 words, above the budget of 600"]);
const codes = { problems: {}, errors: {} };
const readProblemCodes = vi.fn(() => Promise.resolve(codes));
const examples = { workspace: [] };
const readExamples = vi.fn(() => Promise.resolve(examples));
const standardModel = { types: [], properties: [], relations: [], statuses: [] };
const readStandardModel = vi.fn(() => Promise.resolve(standardModel));
vi.mock("./standard-model.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Model>()),
  readStandardModel,
}));
vi.mock("./assemble.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Assemble>()),
  assembleContent,
}));
vi.mock("./reference.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Reference>()),
  referencePages,
  readGeneratedContracts,
}));
vi.mock("./examples.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Examples>()),
  readGuidePages,
  checkExamples,
  wordWarnings,
}));
vi.mock("./formats.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Formats>()),
  readExamples,
}));
vi.mock("./codes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Codes>()),
  readProblemCodes,
}));

describe("bin", () => {
  it("warns on long pages, runs the examples, and writes the guide and the reference into this package's site", async () => {
    vi.stubEnv("REQSEQ_DOCS_BASE", "/base");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    await import("./bin.js");
    const { contentPaths } = await import("./assemble.js");
    const { runReqseq } = await import("./examples.js");
    const paths = contentPaths(fileURLToPath(new URL("../", import.meta.url)));
    expect(readGuidePages).toHaveBeenCalledWith(paths.guideDir);
    expect(wordWarnings).toHaveBeenCalledWith(guide);
    expect(warn).toHaveBeenCalledWith("docs: warning: index.md has 601 words, above the budget of 600\n");
    expect(checkExamples).toHaveBeenCalledWith(guide, runReqseq);
    expect(readGeneratedContracts).toHaveBeenCalledWith(paths.repoRoot);
    expect(readProblemCodes).toHaveBeenCalledWith(paths.repoRoot);
    expect(readStandardModel).toHaveBeenCalledWith(paths.repoRoot);
    expect(referencePages).toHaveBeenCalledWith(
      {
        runtime: getCommandRuntime(),
        schemas: getCommandRuntime().contracts.schemas,
        examples,
        generated,
        codes,
        standardModel,
      },
      "/base",
    );
    expect(assembleContent).toHaveBeenCalledWith(
      paths,
      [{ path: "reference/commands/index.md", text: "" }],
      "/base",
    );
    expect(write).toHaveBeenCalledWith("docs: 7 example commands passed, 1 files in the content folder\n");
    vi.unstubAllEnvs();
    vi.resetModules();
    await import("./bin.js");
    expect(referencePages).toHaveBeenLastCalledWith(expect.anything(), "/ReqSeq");
    write.mockRestore();
    warn.mockRestore();
  });
});
