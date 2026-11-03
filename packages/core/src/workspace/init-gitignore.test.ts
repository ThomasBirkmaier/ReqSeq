// createWorkspace (init.ts): a failed write of the `.gitignore` line never fails a workspace that is
// complete (#271). The writer is wrapped so the `.gitignore` write fails.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import type * as files from "../files/index.js";
import { WORKSPACE_FILE } from "./config.js";
import { createWorkspace } from "./init.js";

vi.mock("../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    writeFileAtomic: async (...args: Parameters<typeof files.writeFileAtomic>) => {
      if (args[1] === ".gitignore") {
        throw new CommandError("file.changed-on-disk", "Not written: .gitignore changed");
      }
      return actual.writeFileAtomic(...args);
    },
  };
});

describe("createWorkspace and .gitignore", () => {
  it("leaves .gitignore out of the files when its write fails, and succeeds", async () => {
    const ws = await createFixtureWorkspace({ files: {} });
    onTestFinished(() => ws.cleanup());
    const written = await createWorkspace(ws.root, {
      name: "W",
      metamodelFile: { name: "standard-model.yaml", text: "reqseq-metamodel: 1\n" },
    });
    expect(written).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE]);
    await expect(fs.lstat(ws.path(".gitignore"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
