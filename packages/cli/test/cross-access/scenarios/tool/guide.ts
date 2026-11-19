// Cross-access scenarios of tool.guide (SR-229), in addition to the default one (cross-access.test.ts): the
// same input gives the same guide in every access, for both `names` and without a workspace. That the MCP
// server sends the MCP guide as its instructions is server.test.ts in packages/mcp.
import { scenariosOf } from "../../scenario.js";

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
]);
