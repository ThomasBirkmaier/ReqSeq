// Writing a new baseline file (write.ts): the folder created when missing, the next free name for a
// taken one in any case, a file that appears meanwhile, and other write errors passed on.
import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import * as files from "../files/index.js";
import { writeNewBaseline } from "./write.js";

vi.mock("../files/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof files>();
  return { ...original, writeFileAtomic: vi.fn(original.writeFileAtomic) };
});

const repository = async (): Promise<{ folder: string; read: (file: string) => string }> => {
  const fixture = await createFixtureWorkspace({ files: { "baselines/release-1.yaml": "old\n" } });
  onTestFinished(() => fixture.cleanup());
  return { folder: fixture.root, read: (file) => fs.readFileSync(fixture.path(file), "utf8") };
};

describe("writeNewBaseline", () => {
  it("creates the folder, takes the next free name for a taken one in any case and replaces nothing", async () => {
    const repo = await repository();
    expect(await writeNewBaseline(repo, "new/baselines", "Release 1", "a\n")).toBe(
      "new/baselines/Release-1.yaml",
    );
    expect(await writeNewBaseline(repo, "baselines", "Release 1", "b\n")).toBe("baselines/Release-1-2.yaml");
    expect([repo.read("baselines/release-1.yaml"), repo.read("baselines/Release-1-2.yaml")]).toEqual([
      "old\n",
      "b\n",
    ]);
  });

  it("takes the next name when a file appears meanwhile, and passes other errors on", async () => {
    const repo = await repository();
    const write = vi.mocked(files.writeFileAtomic);
    write.mockRejectedValueOnce(new CommandError("file.changed-on-disk", "exists"));
    expect(await writeNewBaseline(repo, "baselines", "Next", "c\n")).toBe("baselines/Next-2.yaml");
    write.mockRejectedValueOnce(new CommandError("file.faulty", "read-only"));
    await expect(writeNewBaseline(repo, "baselines", "Other", "d\n")).rejects.toMatchObject({
      code: "file.faulty",
    });
  });
});
