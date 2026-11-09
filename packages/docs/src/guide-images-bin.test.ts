import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as GuideImages from "./guide-images.js";

const checks = [{ name: "a.png", share: 0, problem: undefined }];
const checkGuideImages = vi.fn<() => Promise<typeof checks | undefined>>(() => Promise.resolve(checks));
vi.mock("./guide-images.js", async (importOriginal) => ({
  ...(await importOriginal<typeof GuideImages>()),
  checkGuideImages,
}));

describe("guide-images-bin", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reqseq-guide-images-bin-"));
    vi.resetModules();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("compares in the repository root, logs and appends the step summary", async () => {
    const summary = join(dir, "summary.md");
    vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await import("./guide-images-bin.js");
    expect(checkGuideImages).toHaveBeenCalledWith(fileURLToPath(new URL("../../../", import.meta.url)));
    expect(write).toHaveBeenCalledWith("guide images: 1 compared, 0 stale\n");
    write.mockRestore();
    expect(await readFile(summary, "utf8")).toContain("### Guide screenshots");
  });

  it("writes no summary outside CI or when the run made no screenshots", async () => {
    vi.stubEnv("GITHUB_STEP_SUMMARY", undefined);
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await import("./guide-images-bin.js");
    vi.resetModules();
    const summary = join(dir, "summary.md");
    vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
    checkGuideImages.mockResolvedValueOnce(undefined);
    await import("./guide-images-bin.js");
    write.mockRestore();
    await expect(readFile(summary, "utf8")).rejects.toThrow("ENOENT");
  });
});
