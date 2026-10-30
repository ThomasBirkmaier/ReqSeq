import { fileURLToPath } from "node:url";
import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it, vi } from "vitest";
import type * as Assemble from "./assemble.js";
import type * as Codes from "./codes.js";
import type * as Formats from "./formats.js";
import type * as Reference from "./reference.js";

const assembleContent = vi.fn(() => Promise.resolve(["index.md"]));
const referencePages = vi.fn(() => Promise.resolve([{ path: "reference/commands/index.md", text: "" }]));
const generated = { openapi: { paths: {} }, mcpTools: { tools: [] } };
const readGeneratedContracts = vi.fn(() => Promise.resolve(generated));
const codes = { problems: {}, errors: {} };
const readProblemCodes = vi.fn(() => Promise.resolve(codes));
const examples = { workspace: [] };
const readExamples = vi.fn(() => Promise.resolve(examples));
vi.mock("./assemble.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Assemble>()),
  assembleContent,
}));
vi.mock("./reference.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Reference>()),
  referencePages,
  readGeneratedContracts,
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
  it("writes the guide and the reference into this package's site and reports the number of files", async () => {
    vi.stubEnv("REQSEQ_DOCS_BASE", "/base");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await import("./bin.js");
    const { contentPaths } = await import("./assemble.js");
    const paths = contentPaths(fileURLToPath(new URL("../", import.meta.url)));
    expect(readGeneratedContracts).toHaveBeenCalledWith(paths.repoRoot);
    expect(readProblemCodes).toHaveBeenCalledWith(paths.repoRoot);
    expect(referencePages).toHaveBeenCalledWith(
      {
        runtime: getCommandRuntime(),
        schemas: getCommandRuntime().contracts.schemas,
        examples,
        generated,
        codes,
      },
      "/base",
    );
    expect(assembleContent).toHaveBeenCalledWith(paths, [{ path: "reference/commands/index.md", text: "" }]);
    expect(write).toHaveBeenCalledWith("docs: 1 files in the content folder\n");
    vi.unstubAllEnvs();
    vi.resetModules();
    await import("./bin.js");
    expect(referencePages).toHaveBeenLastCalledWith(expect.anything(), "/ReqSeq");
    write.mockRestore();
  });
});
