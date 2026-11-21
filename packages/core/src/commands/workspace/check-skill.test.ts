// The skill file findings of workspace.check (SR-229 AK10, `tool/guide/skill-check.ts`), per place of D-079: ReqSeq's own
// skill file with an older version and other content than this version writes is one info with the call that
// renews it; a newer version, only another version line, and a restricted check report none. A place with nothing,
// while another holds ReqSeq's own file, is one info with the call that creates it. Each says what its call does at
// the other place when it would replace a file ReqSeq did not write or one changed since, or not write there.
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
import { skillProblems } from "../tool/guide/skill-check.js";
import { SKILL_FILES, skillChecksum, skillFile } from "../tool/guide/skill.js";

const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;
const [CLAUDE, AGENTS] = SKILL_FILES;

const WORKSPACE_FILE =
  "reqseq-workspace: 1\nname: Station\nrepositories:\n  - { name: main, url: '', main: true }\nmetamodel: { repository: main, path: metamodel }\n";

/** A workspace without Git, so the skill files lie in its folder, with `skill` at `.claude/…` and `other` at `.agents/…` when given. */
const workspaceWith = async (skill?: string, other?: string): Promise<Workspace> => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-skill-check-")));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "reqseq-workspace.yaml"), WORKSPACE_FILE);
  await fs.mkdir(path.join(root, "metamodel"));
  await fs.writeFile(path.join(root, "metamodel", "standard-model.yaml"), STANDARD_MODEL_TEXT);
  for (const [file, text] of [
    [CLAUDE, skill],
    [AGENTS, other],
  ] as const) {
    if (text !== undefined) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), text);
    }
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

const findings = async (workspace: Workspace, code = "workspace.skill-older-version"): Promise<Problem[]> =>
  ((await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">).problems.filter(
    (p) => p.code === code,
  );

const CALL = "`reqseq tool guide --skill --write`";
const CURRENT = skillFile(ENTRIES);

describe("workspace.check: the skill file of an older ReqSeq version", () => {
  it("[SR-229/AK-gmk1] reports an older skill file with other content as info with the call that renews it, and no newer one", async () => {
    expect(await findings(await workspaceWith(otherSkill("0.0.1"), CURRENT))).toEqual([
      {
        code: "workspace.skill-older-version",
        severity: "info",
        file: CLAUDE,
        message: `The skill file ${CLAUDE} was written by ReqSeq 0.0.1, and ReqSeq ${PRODUCT_VERSION} writes another; ${CALL} renews it`,
      },
    ]);
    // One per place.
    expect(
      (await findings(await workspaceWith(otherSkill("0.0.1"), otherSkill("0.0.2")))).map((p) => p.file),
    ).toEqual([CLAUDE, AGENTS]);
    // A newer version, and an older one that differs only in its version line, are not reported.
    expect(await findings(await workspaceWith(otherSkill("999.0.0")))).toEqual([]);
    expect(await findings(await workspaceWith(skillFile(ENTRIES, "0.0.1")))).toEqual([]);
    expect(await findings(await workspaceWith(skillFile(ENTRIES)))).toEqual([]);
  });

  it("names the call with replace for a file changed since ReqSeq wrote it", async () => {
    const [problem] = await findings(await workspaceWith(otherSkill("0.0.1", true), CURRENT));
    expect(problem?.message).toMatch(
      /; it was changed since, so `reqseq tool guide --skill --write --replace` renews it and drops those changes$/,
    );
  });

  it("reports nothing for no file, another file, a version that is none, a place that cannot be read, or a restricted check", async () => {
    expect(await findings(await workspaceWith())).toEqual([]);
    expect(await findings(await workspaceWith("# Mine\n"))).toEqual([]);
    expect(await findings(await workspaceWith(otherSkill("next")))).toEqual([]);
    const folder = await workspaceWith();
    await fs.mkdir(path.join(folder.root, CLAUDE), { recursive: true });
    expect(await findings(folder)).toEqual([]);
    const restricted = await workspaceWith(otherSkill("0.0.1"));
    expect(await skillProblems(restricted, { restricted: true })).toEqual([]);
    expect(await skillProblems(restricted, { restricted: false })).toHaveLength(2);
  });

  it("[SR-229/AK-gmk1] reports a place with nothing while another holds ReqSeq's file, of any version, with the call that creates it", async () => {
    for (const own of [CURRENT, skillFile(ENTRIES, "0.0.1"), otherSkill("999.0.0"), `${CURRENT}Mine.\n`]) {
      const missing = await findings(await workspaceWith(own), "workspace.skill-missing");
      expect(missing.map((p) => [p.severity, p.file, p.message.split("; ")[0]])).toEqual([
        ["info", AGENTS, `The skill file ${AGENTS} is missing, while ${CLAUDE} is ReqSeq's skill file`],
      ]);
      expect(missing[0]?.message.split("; ")[1]).toBe(`${CALL} creates it`);
    }
    expect(
      (await findings(await workspaceWith(undefined, CURRENT), "workspace.skill-missing"))[0]?.file,
    ).toBe(CLAUDE);
    // Not for both places missing, another file at the only place, or a place where something is in the way.
    expect(await findings(await workspaceWith(), "workspace.skill-missing")).toEqual([]);
    expect(await findings(await workspaceWith("# Mine\n"), "workspace.skill-missing")).toEqual([]);
    // ReqSeq's own file of this version in a folder that meets Git is still the holder: a write leaves it.
    const nested = await workspaceWith(CURRENT);
    await fs.mkdir(path.join(nested.root, ".claude", ".git"));
    expect((await findings(nested, "workspace.skill-missing")).map((p) => p.file)).toEqual([AGENTS]);
    const inTheWay = await workspaceWith(CURRENT);
    await fs.writeFile(path.join(inTheWay.root, ".agents"), "x");
    expect(await findings(inTheWay, "workspace.skill-missing")).toEqual([]);
  });

  it("[SR-229/AK-gmk1] says when the call would replace a file at the other place, or not write there and fail", async () => {
    const changed = `${CURRENT}Mine.\n`;
    // The missing place: the call without replace writes nothing over a changed file at the other place.
    const [missing] = await findings(await workspaceWith(changed), "workspace.skill-missing");
    expect(missing?.message.split("; ").slice(1)).toEqual([
      `${CALL} creates it`,
      `the call writes nothing at ${CLAUDE}, which was changed since ReqSeq wrote it, and so fails`,
    ]);
    // An older intact file: the call without replace writes nothing over a file ReqSeq did not write.
    const [older] = await findings(await workspaceWith(otherSkill("0.0.1"), "# Mine\n"));
    expect(older?.message.split("; ").slice(2)).toEqual([
      `the call writes nothing at ${AGENTS}, which ReqSeq did not write, and so fails`,
    ]);
    // An older changed file: the call with replace also replaces those.
    for (const [other, what] of [
      ["# Mine\n", "which ReqSeq did not write"],
      [changed, "which was changed since ReqSeq wrote it"],
    ] as const) {
      const [replacing] = await findings(await workspaceWith(otherSkill("0.0.1", true), other));
      expect(replacing?.message.split("; ").slice(2)).toEqual([`the call also replaces ${AGENTS}, ${what}`]);
    }
    // A place nothing can be written at fails the call with replace or without.
    const blocked = await workspaceWith(otherSkill("0.0.1", true));
    await fs.mkdir(path.join(blocked.root, ".agents/skills/managing-requirements"), { recursive: true });
    await fs.symlink("../../../reqseq-workspace.yaml", path.join(blocked.root, AGENTS));
    const [failing] = await findings(blocked);
    expect(failing?.message.split("; ").slice(2)).toEqual([
      `the call writes nothing at ${AGENTS}, where it cannot write, and so fails`,
    ]);
  });

  it("passes on an error that is not ReqSeq's", async () => {
    const broken = {
      get root(): string {
        throw new TypeError("no root");
      },
    } as unknown as Workspace;
    await expect(skillProblems(broken, { restricted: false })).rejects.toThrow("no root");
  });
});
