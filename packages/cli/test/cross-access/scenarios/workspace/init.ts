// Cross-access scenarios of workspace.init, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";

/** The places of the skill file (D-079). */
const SKILLS = [
  ".claude/skills/managing-requirements/SKILL.md",
  ".agents/skills/managing-requirements/SKILL.md",
];

// `path` is a localPath: the CLI makes it absolute from its current folder (the root here), API and MCP
// take it relative to the root, so all four write into the same folder of their copy.
scenariosOf("workspace.init", [
  {
    name: "new folder",
    // The next steps name the new workspace, the same in every access (SR-226 AK4).
    tag: "[SR-226/AK-whxq]",
    fixture: { files: { "new/.keep": "" } },
    input: { path: "new", name: "New" },
    expect: "output",
  },
  {
    name: "root of call",
    fixture: { files: { ".keep": "" } },
    input: { path: ".", name: "New" },
    expect: "output",
  },
  {
    name: "skill file and evidence location",
    // The same skill file at both places, each listed among the files, and the evidence location `evidence` in every access.
    tag: "[SR-229/AK-x7d8] [SR-230/AK-x4g5]",
    fixture: { files: { "new/.keep": "" } },
    input: { path: "new", name: "New" },
    expect: "output",
    check: (results) => {
      for (const [access, { outcome, changed, files }] of Object.entries(results)) {
        const listed = "output" in outcome ? (outcome.output as { files: string[] }).files : [];
        const workspaceFile = Object.entries(files).find(([name]) =>
          name.endsWith("new/reqseq-workspace.yaml"),
        );
        if (
          !SKILLS.every((skill) => listed.includes(skill)) ||
          !SKILLS.every((skill) => changed.some((name) => name.endsWith(`new/${skill}`))) ||
          !(workspaceFile?.[1] ?? "").includes("evidence:\n  - repository: new\n    path: evidence\n")
        ) {
          throw new Error(`${access}: no skill file or evidence location: ${listed.join(", ")}`);
        }
      }
    },
  },
  { name: "existing workspace", input: { path: ".", name: "Again" }, expect: "error" },
]);
