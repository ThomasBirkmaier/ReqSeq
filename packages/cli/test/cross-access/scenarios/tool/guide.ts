// Cross-access scenarios of tool.guide (SR-229), in addition to the default one (cross-access.test.ts): the
// same input gives the same guide in every access, for both `names` and without a workspace, the same skill
// file, which says before its first workflow that project rules go first (AK7), and the same write of it at both
// places in a workspace folder at the root of its Git repository (AK8), and the same failure when one place holds a
// file ReqSeq did not write: the other place is written, and the error names both (AK8). That the API and the MCP server refuse a place
// outside the repositories (SR-142, the exception to SR-080 AK2) is local-paths.test.ts. The MCP server
// instructions (AK17) are the same in every access and for a folder with or without a workspace; that the
// MCP server sends them as its instructions is server.test.ts in packages/mcp.
import fs from "node:fs/promises";
import path from "node:path";
import { ONE_REPOSITORY } from "../../fixtures.js";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";

const SKILL = ".claude/skills/managing-requirements/SKILL.md";
const AGENTS = ".agents/skills/managing-requirements/SKILL.md";
const PRECEDENCE = "Project rules take precedence over this skill and the agent guide.";

/** The start of the MCP server instructions, the same for every folder (SR-229 AK17). */
const INSTRUCTIONS_START = "# Working with ReqSeq\n\nThese instructions hold only the rules.";

const instructionsCheck = (results: Readonly<Record<string, Result>>): void => {
  for (const [access, { outcome }] of Object.entries(results)) {
    const text = "output" in outcome ? (outcome.output as { guide: string }).guide : "";
    if (!text.startsWith(INSTRUCTIONS_START) || text.includes("`reqseq ") || text.includes("Reason:")) {
      throw new Error(`${access} did not give the MCP server instructions: ${text.slice(0, 200)}`);
    }
  }
};

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
    name: "the MCP server instructions",
    tag: "[SR-229/AK-gzbz]",
    input: { instructions: true },
    expect: "output",
    check: instructionsCheck,
  },
  {
    name: "the MCP server instructions in a folder without a workspace",
    tag: "[SR-229/AK-gzbz]",
    root: "requirements",
    input: { instructions: true, names: "cli" },
    expect: "output",
    check: instructionsCheck,
  },
  {
    name: "the MCP server instructions together with the skill file",
    tag: "[SR-229/AK-gzbz]",
    input: { instructions: true, skill: true },
    expect: "error",
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
        const precedence = text.indexOf(PRECEDENCE);
        if (precedence === -1 || precedence > text.indexOf("\n## ")) {
          throw new Error(`no precedence of project rules before the first workflow: ${text.slice(0, 600)}`);
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
        const places = "output" in outcome ? (outcome.output as { places?: unknown }).places : undefined;
        const expected = [SKILL, AGENTS].map((file) => ({ path: file, action: "created" }));
        if (
          JSON.stringify(places) !== JSON.stringify(expected) ||
          !changed.includes(SKILL) ||
          !changed.includes(AGENTS)
        ) {
          throw new Error(
            `${access} did not create both places: ${JSON.stringify(places)} ${changed.join(", ")}`,
          );
        }
      }
    },
  },
  {
    name: "fails when one place holds a file ReqSeq did not write, after writing the other place",
    tag: "[SR-229/AK-v09f]",
    fixture: { ...ONE_REPOSITORY, files: { [SKILL]: "# My own skill\n" } },
    input: { skill: true, write: true },
    expect: "error",
    check: (results) => {
      for (const [access, { outcome, changed }] of Object.entries(results)) {
        const error = "error" in outcome ? (outcome.error as { code?: string; message?: string }) : {};
        if (
          error.code !== "file.exists" ||
          !(error.message ?? "").includes(`${SKILL}: not written:`) ||
          !(error.message ?? "").includes(`${AGENTS}: created`) ||
          changed.includes(SKILL) ||
          !changed.includes(AGENTS)
        ) {
          throw new Error(
            `${access} did not fail naming both places: ${JSON.stringify(error)} ${changed.join(", ")}`,
          );
        }
      }
    },
  },
]);
