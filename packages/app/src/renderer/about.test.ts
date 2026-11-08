import { describe, expect, it } from "vitest";
import type { AboutInfo } from "./about.js";
import { aboutGroups, aboutText } from "./about.js";

const DELIVERY: AboutInfo = {
  versions: { app: "0.9.0", cli: "0.9.0", mcp: "0.9.0" },
  build: { commit: "abc1234", date: "2026-11-08T10:00:00Z", platform: "darwin", arch: "arm64" },
  runtime: { electron: "39.0.0", node: "22.20.0", chromium: "142.0.0" },
  workspace: { path: "/work/spec", name: "Spec", repositories: ["spec", "pilot"], elements: 42 },
  license: {
    notice: ["Copyright 2026", "", "All rights", "reserved."],
    thirdParty: "THIRD_PARTY_NOTICES.txt",
  },
  documentation: {
    bundled: "docs",
    online: "https://thomasbirkmaier.github.io/ReqSeq/",
    releases: "https://github.com/ThomasBirkmaier/ReqSeq/releases",
  },
};

const CHECKOUT: AboutInfo = {
  versions: { app: "0.9.0", cli: "0.9.0", mcp: "0.9.0" },
  build: { development: true, platform: "linux", arch: "x64" },
  runtime: { node: "22.20.0" },
  workspace: { path: "/work/empty", name: "", repositories: [], elements: 0 },
  license: { notice: ["Copyright 2026"] },
  documentation: { online: "https://example.invalid/docs", releases: "https://example.invalid/releases" },
};

const values = (info: AboutInfo): Record<string, string> =>
  Object.fromEntries(aboutGroups(info).flatMap((group) => group.rows.map((row) => [row.label, row.value])));

describe("the window About ReqSeq (SR-161)", () => {
  it("[SR-161/AK1] lays out versions, build, runtime and the open workspace as groups of rows", () => {
    expect(aboutGroups(DELIVERY).map((group) => group.heading)).toEqual([
      "Version",
      "Build",
      "Runtime",
      "Workspace",
      "Licence",
      "Documentation",
    ]);
    expect(values(DELIVERY)).toEqual({
      App: "0.9.0",
      "Command line": "0.9.0",
      "MCP server": "0.9.0",
      Commit: "abc1234",
      "Build date": "2026-11-08T10:00:00Z",
      Platform: "darwin",
      Architecture: "arm64",
      Electron: "39.0.0",
      Node: "22.20.0",
      Chromium: "142.0.0",
      Name: "Spec",
      Path: "/work/spec",
      Repositories: "spec, pilot",
      Elements: "42",
      Licence: "Copyright 2026\n\nAll rights reserved.",
      "Third-party licences": "THIRD_PARTY_NOTICES.txt",
      Bundled: "docs",
      Online: "https://thomasbirkmaier.github.io/ReqSeq/",
      Releases: "https://github.com/ThomasBirkmaier/ReqSeq/releases",
    });
  });

  it("[SR-161/AK1] leaves out the rows of values a build from a checkout does not have", () => {
    expect(values(CHECKOUT)).toEqual({
      App: "0.9.0",
      "Command line": "0.9.0",
      "MCP server": "0.9.0",
      Build: "from a checkout, not a delivery",
      Platform: "linux",
      Architecture: "x64",
      Node: "22.20.0",
      Path: "/work/empty",
      Elements: "0",
      Licence: "Copyright 2026",
      Online: "https://example.invalid/docs",
      Releases: "https://example.invalid/releases",
    });
  });

  it("[SR-161/AK3] Copy all gives the whole content as one block, each row as its label and value", () => {
    const text = aboutText(aboutGroups(DELIVERY));
    const lines = text.split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "About ReqSeq",
      "Version",
      "  App: 0.9.0",
      "  Command line: 0.9.0",
      "  MCP server: 0.9.0",
    ]);
    // A value of several lines keeps them, indented under its label.
    expect(text).toContain("  Licence: Copyright 2026\n\n    All rights reserved.");
    expect(text).toContain("  Path: /work/spec");
    expect(lines.at(-1)).toBe("  Releases: https://github.com/ThomasBirkmaier/ReqSeq/releases");
  });
});
