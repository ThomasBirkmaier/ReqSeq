import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentInstallation, installationOfProcess, setInstallation } from "./installation.js";

afterEach(() => {
  setInstallation(undefined);
});

describe("installation", () => {
  it("takes the runtime and the script of a process", () => {
    expect(installationOfProcess({ execPath: "/usr/bin/node", argv: ["/usr/bin/node", "bin.js"] })).toEqual({
      runtime: "/usr/bin/node",
      entry: path.resolve("bin.js"),
    });
    expect(installationOfProcess({ execPath: "/x", argv: ["/x"] })).toBeUndefined();
  });

  it("stands for a set installation, else for this process", () => {
    expect(currentInstallation()).toEqual(installationOfProcess(process));
    const given = { runtime: "/a/runtime/node", entry: "/a/lib/dist/bin.js" };
    setInstallation(given);
    expect(currentInstallation()).toBe(given);
  });
});
