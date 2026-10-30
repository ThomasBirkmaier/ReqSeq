import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const writeDiagrams = vi.fn(() => Promise.resolve(["docs/architecture/ci.svg"]));
vi.mock("./diagrams.js", () => ({ writeDiagrams }));

describe("diagrams-bin", () => {
  it("writes the diagrams into the repository root and names them", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await import("./diagrams-bin.js");
    expect(writeDiagrams).toHaveBeenCalledWith(fileURLToPath(new URL("../../../", import.meta.url)));
    expect(write).toHaveBeenCalledWith("docs: wrote docs/architecture/ci.svg\n");
    write.mockRestore();
  });
});
