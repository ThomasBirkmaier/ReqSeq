// workspace.init when writing the skill file fails with an error that is no refusal: the workspace stays created,
// and the failure is the warning `workspace.skill-not-written` with only the error code (SR-229 AK9).
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { WORKSPACE_FILE } from "../../workspace/index.js";
import type * as SkillFile from "../tool/guide/skill-file.js";

const failure = vi.hoisted((): { error: Error } => ({ error: new Error("boom") }));

vi.mock("../tool/guide/skill-file.js", async (actual) => ({
  ...(await actual<typeof SkillFile>()),
  writeSkillFile: () => Promise.reject(failure.error),
}));

describe("workspace.init when the skill file cannot be written", () => {
  it("[SR-229/AK-x7d8] creates the workspace and names only the code of the failure", async () => {
    for (const [code, shown] of [
      ["EIO", "EIO"],
      [undefined, "unknown"],
    ] as const) {
      failure.error = Object.assign(new Error("/an/absolute/path"), code === undefined ? {} : { code });
      const ws = await createFixtureWorkspace();
      onTestFinished(() => ws.cleanup());
      const workspace = new Workspace(ws.root);
      onTestFinished(() => workspace.close());
      const out = (await invoke(
        "workspace.init",
        { path: ws.root, name: "W" },
        { workspace },
      )) as CommandOutput<"workspace.init">;
      expect(out.files).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE, ".gitignore"]);
      expect(out.problems).toEqual([
        {
          code: "workspace.skill-not-written",
          severity: "warning",
          message: `Not written: the skill file cannot be written (${shown})`,
        },
      ]);
    }
  });
});
