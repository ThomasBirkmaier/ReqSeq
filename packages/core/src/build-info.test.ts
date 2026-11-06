import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { BUILD_INFO_FILE, readBuildInfo } from "./build-info.js";

const folderWith = async (content?: string): Promise<string> => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-build-info-"));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
  if (content !== undefined) {
    await fs.writeFile(path.join(folder, BUILD_INFO_FILE), content);
  }
  return folder;
};

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

describe("readBuildInfo", () => {
  it("reads the commit and date the packaging wrote", async () => {
    const folder = await folderWith(
      JSON.stringify({ commit: COMMIT, date: "2026-11-06T09:00:00Z", more: 1 }),
    );
    expect(await readBuildInfo(folder)).toEqual({ commit: COMMIT, date: "2026-11-06T09:00:00Z" });
  });

  it("has none in a build from a checkout", async () => {
    expect(await readBuildInfo(await folderWith())).toBeUndefined();
    expect(await readBuildInfo()).toBeUndefined();
  });

  it("ignores a file that is no JSON or has no valid commit", async () => {
    expect(await readBuildInfo(await folderWith("{"))).toBeUndefined();
    expect(await readBuildInfo(await folderWith("null"))).toBeUndefined();
    expect(
      await readBuildInfo(await folderWith(JSON.stringify({ commit: "abc", date: "x" }))),
    ).toBeUndefined();
    expect(await readBuildInfo(await folderWith(JSON.stringify({ commit: COMMIT })))).toBeUndefined();
  });
});
