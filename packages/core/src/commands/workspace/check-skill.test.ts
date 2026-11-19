// The skill file of an older ReqSeq version of workspace.check (SR-229 AK10, `tool/guide/skill-check.ts`): ReqSeq's own skill
// file with an older version and other content than this version writes is one info with the call that
// renews it; a newer version, only another version line, and a restricted check report none.
// Cross-access: packages/cli/test/cross-access/scenarios/workspace/check.ts.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
import type { CommandCatalog } from "../../generated/types.js";
import { STANDARD_MODEL_TEXT } from "../../metamodel/index.js";
import { PRODUCT_VERSION } from "../../product.js";
import { contractsBundle } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { olderSkillProblems } from "../tool/guide/skill-check.js";
import { SKILL_FILE, skillChecksum, skillFile } from "../tool/guide/skill.js";

const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;

const WORKSPACE_FILE =
  "reqseq-workspace: 1\nname: Station\nrepositories:\n  - { name: main, url: '', main: true }\nmetamodel: { repository: main, path: metamodel }\n";

/** A workspace without Git, so the skill file lies in its folder, with `skill` there when given. */
const workspaceWith = async (skill?: string): Promise<Workspace> => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-skill-check-")));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "reqseq-workspace.yaml"), WORKSPACE_FILE);
  await fs.mkdir(path.join(root, "metamodel"));
  await fs.writeFile(path.join(root, "metamodel", "standard-model.yaml"), STANDARD_MODEL_TEXT);
  if (skill !== undefined) {
    await fs.mkdir(path.dirname(path.join(root, SKILL_FILE)), { recursive: true });
    await fs.writeFile(path.join(root, SKILL_FILE), skill);
  }
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** The skill file of `version` with another first workflow heading, and a checksum that matches unless `changed`. */
const otherSkill = (version: string, changed = false): string => {
  const text = skillFile(ENTRIES, version).replace("## Create a requirement", "## Add a requirement");
  const sum = changed ? "0".repeat(64) : skillChecksum(text).actual;
  return text.replace(/reqseq-checksum: "sha256:[0-9a-f]*"/, `reqseq-checksum: "sha256:${sum}"`);
};

const findings = async (workspace: Workspace, input: Record<string, unknown> = {}): Promise<Problem[]> =>
  (
    (await invoke("workspace.check", input, { workspace })) as CommandOutput<"workspace.check">
  ).problems.filter((p) => p.code === "workspace.skill-older-version");

describe("workspace.check: the skill file of an older ReqSeq version", () => {
  it("[SR-229/AK-gmk1] reports an older skill file with other content as info with the call that renews it, and no newer one", async () => {
    expect(await findings(await workspaceWith(otherSkill("0.0.1")))).toEqual([
      {
        code: "workspace.skill-older-version",
        severity: "info",
        file: SKILL_FILE,
        message: `The skill file ${SKILL_FILE} was written by ReqSeq 0.0.1, and ReqSeq ${PRODUCT_VERSION} writes another; \`reqseq tool guide --skill --write\` renews it`,
      },
    ]);
    // A newer version, and an older one that differs only in its version line, are not reported.
    expect(await findings(await workspaceWith(otherSkill("999.0.0")))).toEqual([]);
    expect(await findings(await workspaceWith(skillFile(ENTRIES, "0.0.1")))).toEqual([]);
    expect(await findings(await workspaceWith(skillFile(ENTRIES)))).toEqual([]);
  });

  it("names the call with replace for a file changed since ReqSeq wrote it", async () => {
    const [problem] = await findings(await workspaceWith(otherSkill("0.0.1", true)));
    expect(problem?.message).toMatch(
      /; it was changed since, so `reqseq tool guide --skill --write --replace` renews it and drops those changes$/,
    );
  });

  it("reports nothing for no file, another file, a version that is none, a place that cannot be read, or a restricted check", async () => {
    expect(await findings(await workspaceWith())).toEqual([]);
    expect(await findings(await workspaceWith("# Mine\n"))).toEqual([]);
    expect(await findings(await workspaceWith(otherSkill("next")))).toEqual([]);
    const folder = await workspaceWith();
    await fs.mkdir(path.join(folder.root, SKILL_FILE), { recursive: true });
    expect(await findings(folder)).toEqual([]);
    const restricted = await workspaceWith(otherSkill("0.0.1"));
    expect(await olderSkillProblems(restricted, { restricted: true })).toEqual([]);
    expect(await olderSkillProblems(restricted, { restricted: false })).toHaveLength(1);
  });

  it("passes on an error that is not ReqSeq's", async () => {
    const broken = {
      get root(): string {
        throw new TypeError("no root");
      },
    } as unknown as Workspace;
    await expect(olderSkillProblems(broken, { restricted: false })).rejects.toThrow("no root");
  });
});
