// What the tests of the relation kind commands share besides the small model of
// metamodel-commands.test-helper.ts: the own metamodel repository of fixtures/SR-018/own-repository
// and a snapshot of every file below a folder.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { Opened } from "./metamodel-commands.test-helper.js";

/**
 * fixtures/SR-018/own-repository with `files`, opened at its workspace folder `system`: types,
 * properties and statuses in three files of the repository `models`, no relation kind.
 */
export const openOwn = async (files: FixtureOptions["files"] = {}): Promise<Opened> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-018/own-repository", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(path.join(fixture.root, "system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace, read: (file) => fs.readFile(fixture.path(file), "utf8") };
};

/** The files below `folder`, by path relative to it, with their bytes as text; `.git` included. */
export const snapshot = async (folder: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile());
  return Object.fromEntries(
    await Promise.all(
      files.map(async (e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(folder, file), await fs.readFile(file, "latin1")] as const;
      }),
    ),
  );
};
