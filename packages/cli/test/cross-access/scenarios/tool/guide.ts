// Cross-access scenarios of tool.guide (SR-229), in addition to the default one (cross-access.test.ts): the
// same input gives the same guide in every access, for both `names` and without a workspace, the same skill
// file (AK7), and the same write of it in a workspace folder at the root of its Git repository (AK8). That
// the API and the MCP server refuse a place outside the repositories (SR-142, the exception to SR-080 AK2)
// is local-paths.test.ts. That the MCP server sends the MCP guide as its instructions is server.test.ts in
// packages/mcp.
import fs from "node:fs/promises";
import path from "node:path";
import { ONE_REPOSITORY } from "../../fixtures.js";
import { scenariosOf } from "../../scenario.js";

const SKILL = ".claude/skills/managing-requirements/SKILL.md";

scenariosOf("tool.guide", [
  {
    name: "the guide with command-line calls",
    tag: "[SR-229/AK-p4y6]",
    input: { names: "cli" },
    expect: "output",
  },
  {
    name: "the guide with MCP tool names",
    tag: "[SR-229/AK-p4y6]",
    input: { names: "mcp" },
    expect: "output",
  },
  {
    name: "the guide in a folder without a workspace",
    tag: "[SR-229/AK-hyqj]",
    root: "requirements",
    input: {},
    expect: "output",
    check: (results) => {
      for (const { outcome } of Object.values(results)) {
        const guide = "output" in outcome ? (outcome.output as { guide: string }).guide : "";
        if (!guide.includes("Reason: No reqseq-workspace.yaml") || !guide.includes("reqseq workspace init")) {
          throw new Error(`not the guide without a workspace: ${guide.slice(0, 200)}`);
        }
      }
    },
  },
  {
    name: "the skill file",
    tag: "[SR-229/AK-nrf2]",
    input: { skill: true },
    expect: "output",
    check: (results) => {
      for (const { outcome } of Object.values(results)) {
        const text = "output" in outcome ? (outcome.output as { guide: string }).guide : "";
        if (!text.startsWith("---\nname: managing-requirements\n")) {
          throw new Error(`not the skill file: ${text.slice(0, 200)}`);
        }
      }
    },
  },
  {
    name: "writes the skill file at the Git root, which is the workspace folder",
    tag: "[SR-229/AK-v09f]",
    fixture: ONE_REPOSITORY,
    input: { skill: true, write: true },
    expect: "output",
    prepare: async (copy) => {
      // The fixture is a Git repository whose root is the workspace folder.
      await fs.access(path.join(copy.root, ".git", "HEAD"));
    },
    check: (results) => {
      for (const [access, { outcome, changed }] of Object.entries(results)) {
        const file = "output" in outcome ? (outcome.output as { file?: unknown }).file : undefined;
        if (
          JSON.stringify(file) !== JSON.stringify({ path: SKILL, action: "created" }) ||
          !changed.includes(SKILL)
        ) {
          throw new Error(`${access} did not create ${SKILL}: ${JSON.stringify(file)} ${changed.join(", ")}`);
        }
      }
    },
  },
]);
