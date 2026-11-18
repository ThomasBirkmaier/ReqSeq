// Cross-access scenarios of workspace.connectAgent (SR-227): without a client and for each client, every access
// gives the same setup, as all of them stand for the installation of this process (D-029). Running the setup is
// the CLI e2e test (AK5).
import { scenariosOf } from "../../scenario.js";

scenariosOf("workspace.connectAgent", [
  { name: "without a client: the clients to choose from", input: {}, expect: "output" },
  ...["claude-code", "claude-desktop", "cursor", "vscode", "codex-cli", "other"].map((client) => ({
    name: `the setup for ${client}`,
    input: { client },
    expect: "output" as const,
  })),
]);
