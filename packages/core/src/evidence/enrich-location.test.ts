// Where an enriched JUnit file lies for the evidence walk (SR-230 AK3, `enrich-location.ts`). Enabler
// tests of the block; the AK tests are in commands/evidence/enrichJunit.test.ts.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { loadWorkspaceLayout } from "../workspace/index.js";
import { outsideLocationProblems } from "./enrich-location.js";

/** A workspace in `system/` with the repositories `system` and `ci` (both in the fixture). */
const WORKSPACE = (evidence: string, ignore = ""): string =>
  "reqseq-workspace: 1\nname: Station\nrepositories:\n" +
  "  - { name: system, url: u, main: true }\n  - { name: ci, url: u }\n" +
  `metamodel: { repository: system, path: metamodel }\nevidence:\n${evidence}${ignore}`;

const fixture = async (files: Readonly<Record<string, string>>): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ files });
  onTestFinished(() => created.cleanup());
  return created;
};

/** The message of the warning for `file` of `ws` (relative to the fixture), or undefined for none. */
const warning = async (ws: FixtureWorkspace, file: string): Promise<string | undefined> =>
  (await outsideLocationProblems(await loadWorkspaceLayout(ws.path("system")), ws.path(file), file))[0]
    ?.message;

describe("outsideLocationProblems", () => {
  it("reads a location at the root of a repository, and a file of another repository is outside the main one's", async () => {
    const ws = await fixture({
      "system/reqseq-workspace.yaml": WORKSPACE("  - { repository: ci, path: . }\n"),
      "system/run.xml": "",
      "ci/run.xml": "",
    });
    expect(await warning(ws, "ci/run.xml")).toBeUndefined();
    expect(await warning(ws, "system/run.xml")).toMatch(/^system\/run\.xml lies in no evidence location, /);
  });

  it("tells a file below a location that the walk leaves out from one outside every location", async () => {
    const ws = await fixture({
      "system/reqseq-workspace.yaml": WORKSPACE(
        "  - { repository: system, path: evidence }\n",
        "ignore: ['evidence/old/**']\n",
      ),
      "system/evidence/old/run.xml": "",
      "system/evidence/run.junit": "",
      "system/evidenced/run.xml": "",
    });
    expect(await warning(ws, "system/evidence/old/run.xml")).toMatch(/ is not read as evidence \(/);
    expect(await warning(ws, "system/evidence/run.junit")).toMatch(/ is not read as evidence \(/);
    // A folder whose name only starts with that of the location is outside it.
    expect(await warning(ws, "system/evidenced/run.xml")).toMatch(/ lies in no evidence location, /);
  });

  it("takes a file it cannot look at as not read", async () => {
    const ws = await fixture({
      "system/reqseq-workspace.yaml": WORKSPACE("  - { repository: system, path: evidence }\n"),
      "system/evidence/run.xml": "",
    });
    await fs.rm(ws.path("system/evidence/run.xml"));
    expect(await warning(ws, "system/evidence/run.xml")).toMatch(/ is not read as evidence \(/);
  });
});
