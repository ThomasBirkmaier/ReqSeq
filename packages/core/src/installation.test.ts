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
  it("takes the runtime and the script of a process, and whether it runs on Electron", () => {
    expect(
      installationOfProcess({ execPath: "/usr/bin/node", argv: ["/usr/bin/node", "bin.js"], versions: {} }),
    ).toEqual({
      runtime: "/usr/bin/node",
      entry: path.resolve("bin.js"),
      electron: false,
    });
    expect(
      installationOfProcess({
        execPath: "/x/ReqSeq",
        argv: ["/x/ReqSeq", "/x/bin.js"],
        versions: { electron: "38.0.0" },
      }),
    ).toMatchObject({ electron: true });
    expect(installationOfProcess({ execPath: "/x", argv: ["/x"], versions: {} })).toBeUndefined();
  });

  it("stands for a set installation, else for this process", () => {
    expect(currentInstallation()).toEqual(installationOfProcess(process));
    const given = { runtime: "/a/ReqSeq", entry: "/a/resources/cli/dist/bin.js", electron: true };
    setInstallation(given);
    expect(currentInstallation()).toBe(given);
    // Handed none: no installation, not the script of this process.
    setInstallation(null);
    expect(currentInstallation()).toBeUndefined();
  });

  it("hands an installation over as one argument", () => {
    const given = {
      runtime: "C:\\a b\\ReqSeq.exe",
      entry: "C:\\a b\\resources\\cli\\dist\\bin.js",
      electron: true,
    };
    expect(installationFromArgv(["x", installationArgument(given)])).toEqual(given);
    expect(installationFromArgv(["x"])).toBeUndefined();
    expect(installationFromArgv(["--reqseq-installation={"])).toBeUndefined();
    expect(installationFromArgv(["--reqseq-installation=null"])).toBeUndefined();
    expect(installationFromArgv(['--reqseq-installation={"runtime":"a","entry":"b"}'])).toBeUndefined();
  });
});
