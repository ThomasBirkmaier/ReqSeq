import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  currentInstallation,
  installationArgument,
  installationFromArgv,
  installationOfProcess,
  setInstallation,
} from "./installation.js";

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
    // Handed none: no installation, not the script of this process.
    setInstallation(null);
    expect(currentInstallation()).toBeUndefined();
  });

  it("hands an installation over as one argument", () => {
    const given = { runtime: "C:\\a b\\runtime\\node.exe", entry: "C:\\a b\\lib\\dist\\bin.js" };
    expect(installationFromArgv(["x", installationArgument(given)])).toEqual(given);
    expect(installationFromArgv(["x"])).toBeUndefined();
    expect(installationFromArgv(["--reqseq-installation={"])).toBeUndefined();
    expect(installationFromArgv(["--reqseq-installation=null"])).toBeUndefined();
    expect(installationFromArgv(['--reqseq-installation={"runtime":"a"}'])).toBeUndefined();
  });
});
