// The evidence files as the watcher sees them (#785, `evidence-files.ts`): the marker state and the
// own writes. The rules of the watcher are in watch.test.ts.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { evidenceFilesState, onlyOwnEvidenceWrites, ownEvidenceWrite } from "./evidence-files.js";

const SHA256_OF_A = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

describe("evidence files for the watcher (#785)", () => {
  it("has a marker state that holds no data", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-030/record" });
    const workspace = new Workspace(fixture.root);
    onTestFinished(async () => {
      await workspace.close();
      await fixture.cleanup();
    });
    expect(workspace.get(evidenceFilesState)).toBe(true);
  });

  it("counts a file as an own write only while it holds the bytes written, in any letter case or normal form", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-030/record" });
    const workspace = new Workspace(fixture.root);
    onTestFinished(async () => {
      await workspace.close();
      await fixture.cleanup();
    });
    const file = fixture.path("evidence/a.md");
    await fs.writeFile(file, "a");
    expect(await onlyOwnEvidenceWrites(workspace, [file])).toBe(false);
    ownEvidenceWrite(workspace, path.join(path.dirname(file), "A.MD"), SHA256_OF_A);
    expect(await onlyOwnEvidenceWrites(workspace, [])).toBe(true);
    expect(await onlyOwnEvidenceWrites(workspace, [file])).toBe(true);
    expect(await onlyOwnEvidenceWrites(workspace, [file, fixture.path("evidence/b.md")])).toBe(false);
    await fs.writeFile(file, "b");
    expect(await onlyOwnEvidenceWrites(workspace, [file])).toBe(false);
    await fs.rm(file);
    expect(await onlyOwnEvidenceWrites(workspace, [file])).toBe(false);
    // A path the file system refuses to look at (a name longer than any allows) is no own write either.
    const unreadable = fixture.path(`evidence/${"x".repeat(300)}.md`);
    ownEvidenceWrite(workspace, unreadable, SHA256_OF_A);
    expect(await onlyOwnEvidenceWrites(workspace, [unreadable])).toBe(false);
  });
});
