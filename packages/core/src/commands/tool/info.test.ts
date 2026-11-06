import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { PRODUCT_LICENSE, PRODUCT_VERSION } from "../../product.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { ONLINE_DOCUMENTATION, RELEASES, toolFacts } from "./info.js";

const BUILD = { commit: "0123456789abcdef0123456789abcdef01234567", date: "2026-11-06T09:00:00.000Z" };
const ELECTRON = {
  versions: { node: "24.1.0", electron: "44.9.3", chrome: "146.0.7000.0" },
  platform: "darwin",
  arch: "arm64",
};

const fixture = async (): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
  onTestFinished(() => created.cleanup());
  return created;
};

const info = async (root: string): Promise<CommandOutput<"tool.info">> => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return (await invoke("tool.info", {}, { workspace })) as CommandOutput<"tool.info">;
};

describe("tool.info", () => {
  it("[SR-161/AK1] shows versions, build, runtime and the open workspace, and writes nothing", async () => {
    const ws = await fixture();
    const output = await info(ws.root);
    expect(output.versions).toEqual({ app: PRODUCT_VERSION, cli: PRODUCT_VERSION, mcp: PRODUCT_VERSION });
    expect(output.build).toMatchObject({ platform: process.platform, arch: process.arch });
    expect(output.runtime.node).toBe(process.versions.node);
    expect(output.workspace).toEqual({
      path: ws.root,
      name: "Weather station",
      repositories: ["system"],
      elements: 1,
    });
    expect(await ws.git(["status", "--porcelain", "--untracked-files=all"])).toBe("");
  });

  it("[SR-161/AK1] gives Electron and Chromium of an Electron process, and the commit and date of a delivery", () => {
    const facts = toolFacts(ELECTRON, BUILD);
    expect(facts.build).toEqual({
      commit: BUILD.commit,
      date: BUILD.date,
      platform: "darwin",
      arch: "arm64",
    });
    expect(facts.runtime).toEqual({ electron: "44.9.3", node: "24.1.0", chromium: "146.0.7000.0" });
  });

  it("[SR-161/AK2] names the licences and the documentation, the addresses as text only", () => {
    const delivered = toolFacts(ELECTRON, BUILD);
    expect(delivered.license).toEqual({
      notice: [...PRODUCT_LICENSE],
      thirdParty: "THIRD_PARTY_NOTICES.txt",
    });
    expect(delivered.documentation).toEqual({
      bundled: "docs",
      online: ONLINE_DOCUMENTATION,
      releases: RELEASES,
    });
    expect(PRODUCT_LICENSE[0]).toMatch(/^Copyright/);
  });

  it("[SR-161/AK2] opens no network connection", async () => {
    const ws = await fixture();
    const fetch = vi.spyOn(globalThis, "fetch");
    await info(ws.root);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks a build from a checkout and names no delivery files there", () => {
    const facts = toolFacts({ versions: { node: "24.1.0" }, platform: "linux", arch: "x64" }, undefined);
    expect(facts.build).toEqual({ development: true, platform: "linux", arch: "x64" });
    expect(facts.runtime).toEqual({ node: "24.1.0" });
    expect(facts.license).toEqual({ notice: [...PRODUCT_LICENSE] });
    expect(facts.documentation).toEqual({ online: ONLINE_DOCUMENTATION, releases: RELEASES });
  });
});
