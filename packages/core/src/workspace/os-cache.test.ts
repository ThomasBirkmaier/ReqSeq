import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileCacheFolder, osCacheFolder } from "./os-cache.js";

describe("compileCacheFolder (#178)", () => {
  it("is reqseq/node-compile-cache in the OS cache folder, one per OS user", () => {
    expect(compileCacheFolder({ platform: "linux", env: {}, home: "/home/ada" })).toBe(
      "/home/ada/.cache/reqseq/node-compile-cache",
    );
    expect(
      compileCacheFolder({ platform: "win32", env: { LOCALAPPDATA: "D:\\Local" }, home: "C:\\Users\\ada" }),
    ).toBe("D:\\Local\\reqseq\\node-compile-cache");
  });

  it("defaults to the environment of this process", () => {
    expect(compileCacheFolder()).toBe(path.join(osCacheFolder(), "reqseq", "node-compile-cache"));
  });
});
