// HTML and ReqIF exports over the command line to a target outside the repositories of the workspace
// (SR-142 AK3): HTML creates only the target folder itself, ReqIF needs the folder of its file, and a
// missing folder above is refused without creating one (SR-235 AK9, SR-207 AK6).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const setup = async (): Promise<{ root: string; outside: string }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-052/package" });
  onTestFinished(() => fixture.cleanup());
  const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-outside-")));
  onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
  return { root: fixture.root, outside };
};

describe("exports outside the repositories over the command line", () => {
  it("[SR-235/AK-nqgk] reqseq html export creates only the target folder itself, and refuses a missing folder above it", async () => {
    const { root, outside } = await setup();
    const made = await run(["html", "export", path.join(outside, "html")], { cwd: root });
    expect([made.code, made.stderr]).toEqual([0, ""]);
    expect(await fs.readdir(path.join(outside, "html"))).toContain("index.html");
    const refused = await run(["html", "export", path.join(outside, "gone", "html")], { cwd: root });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      "the folder above html does not exist; outside the repositories of the workspace ReqSeq creates only the export folder itself",
    );
    expect(await fs.readdir(outside)).toEqual(["html"]);
  });

  it("[SR-207/AK-p2qv] reqseq reqif export refuses a file whose folder is missing, and creates no folder", async () => {
    const { root, outside } = await setup();
    const refused = await run(["reqif", "export", path.join(outside, "gone", "s.reqif")], { cwd: root });
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain(
      "the folder of s.reqif does not exist; outside the repositories of the workspace ReqSeq creates no folder",
    );
    expect(await fs.readdir(outside)).toEqual([]);
    const made = await run(["reqif", "export", path.join(outside, "s.reqif")], { cwd: root });
    expect([made.code, made.stderr]).toEqual([0, ""]);
    expect(await fs.readdir(outside)).toEqual(expect.arrayContaining(["s.reqif"]));
  });
});
