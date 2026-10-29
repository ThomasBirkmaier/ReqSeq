import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type * as Assemble from "./assemble.js";

const assembleContent = vi.fn(() => Promise.resolve(["index.md"]));
vi.mock("./assemble.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Assemble>()),
  assembleContent,
}));

describe("bin", () => {
  it("assembles the content folder of this package's site and reports the number of files", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await import("./bin.js");
    const { contentPaths } = await import("./assemble.js");
    expect(assembleContent).toHaveBeenCalledWith(
      contentPaths(fileURLToPath(new URL("../", import.meta.url))),
    );
    expect(write).toHaveBeenCalledWith("docs: 1 files in the content folder\n");
    write.mockRestore();
  });
});
