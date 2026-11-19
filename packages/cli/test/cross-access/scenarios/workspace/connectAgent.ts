// Cross-access scenarios of workspace.connectAgent (SR-227): without a client and for each client, every access
// gives the same setup, as all of them stand for the installation of this process (D-029). Each client gets its
// form (AK2) and the setup names absolute paths (AK3). Running the setup is the CLI e2e test (AK5). AK4 needs
// injected macOS facts (core's tests) and AK6 is about files, which a comparison of outputs does not see (CLI e2e).
import path from "node:path";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";

interface Setup {
  readonly server: { readonly command: string; readonly args: readonly string[] };
  readonly setup: {
    readonly form: string;
    readonly shell?: string;
    readonly text: string;
    readonly file?: string;
  };
}

const setupOf = (results: Readonly<Record<string, Result>>): Setup =>
  (results["core"]?.outcome as { output: Setup }).output;

/** The start of the command of each client that sets itself up by its command line. */
const COMMANDS: Readonly<Record<string, string>> = {
  "claude-code": "claude mcp add ",
  vscode: "code ",
  "codex-cli": "codex mcp add reqseq ",
};

/** Checks the form of the setup for `client` (SR-227 AK2). */
const formOf = (client: string, { setup }: Setup): void => {
  const command = COMMANDS[client];
  if (command !== undefined) {
    expect(setup.form).toBe("command");
    expect(setup.shell).toBe(process.platform === "win32" ? "powershell" : "sh");
    expect(setup.text.startsWith(command)).toBe(true);
    expect(setup.file).toBeUndefined();
    return;
  }
  expect(setup.form).toBe("json");
  expect(setup.shell).toBeUndefined();
  expect(Object.keys((JSON.parse(setup.text) as { mcpServers: object }).mcpServers)).toEqual(["reqseq"]);
  if (client === "other") {
    expect(setup.file).toBeUndefined();
  } else {
    expect(path.isAbsolute(setup.file ?? "")).toBe(true);
  }
};

scenariosOf("workspace.connectAgent", [
  {
    name: "without a client: the clients to choose from",
    tag: "[SR-227/AK-gvt5]",
    input: {},
    expect: "output",
  },
  ...["claude-code", "claude-desktop", "cursor", "vscode", "codex-cli", "other"].map((client) => ({
    name: `the setup for ${client}`,
    tag: "[SR-227/AK-fx6t]",
    input: { client },
    expect: "output" as const,
    check: (results: Readonly<Record<string, Result>>) => {
      formOf(client, setupOf(results));
    },
  })),
  {
    name: "the setup names the absolute paths of the program and of the workspace",
    tag: "[SR-227/AK-cw0k]",
    input: { client: "other" },
    expect: "output",
    check: (results) => {
      const { server } = setupOf(results);
      expect(path.isAbsolute(server.command)).toBe(true);
      expect(server.args.at(-2)).toBe("--workspace");
      // The absolute path of the copy of the workspace, which the comparison writes as `<copy>`.
      expect(server.args.at(-1)?.startsWith("<copy>")).toBe(true);
    },
  },
]);
