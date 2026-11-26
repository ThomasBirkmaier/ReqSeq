// workspace.connectAgent (SR-227): the setup that connects a client of an AI agent to the MCP server of this
// workspace, made from the installation that runs the command (installation.ts) and the system's facts
// (agent-setup.ts). It only reads: whether the command line's entry and the delivery's launcher exist, and the
// workspace file for its name, and the Git root of the workspace folder for `.mcp.json` (AK7, D-079); it creates and changes no file, the client's included, and opens no
// connection (AK6, D-068).
import { realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InvokedOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { sentence } from "../answer.js";
import { CHOOSE_CLIENT, CLIENTS, deliveryLauncher, setupOf } from "../../agent-setup.js";
import { currentInstallation } from "../../installation.js";
import { gitRootOf, workspaceLayoutState } from "../../workspace/index.js";

/** The output with its answer: `run` builds the sentence, as it names the workspace, which the output does not hold. */
type Output = InvokedOutput<"workspace.connectAgent">;

/** The real path of a file; undefined when there is none. */
const realFile = async (file: string): Promise<string | undefined> => {
  try {
    const real = await realpath(file);
    return (await stat(real)).isFile() ? real : undefined;
  } catch {
    return undefined;
  }
};

const exists = async (file: string | undefined): Promise<boolean> =>
  file !== undefined && (await realFile(file)) !== undefined;

/**
 * The folder of `.mcp.json` (AK7): the Git root the workspace folder lies in, else that folder, as D-079 finds
 * the folder of the skill file; and the workspace relative to it, with `/`, `.` for the folder itself.
 */
const repositoryOf = async (root: string): Promise<{ folder: string; workspace: string }> => {
  const real = await realpath(root);
  const folder = (await gitRootOf(real)) ?? real;
  const relative = path.relative(folder, real).split(path.sep).join("/");
  return { folder, workspace: relative === "" ? "." : relative };
};

const CLI_MISSING =
  "The command line of this installation (its bin.js) is missing, so no client could start it.";

export default defineCommand({
  name: "workspace.connectAgent",
  // The sentence `run` built, kept first by `invoke` (SR-224 AK1); it is the same through every access.
  answer: (output) => (output as Partial<Output>).answer ?? CHOOSE_CLIENT,
  run: async (ctx, input): Promise<Output> => {
    const { client } = input;
    if (client === undefined) {
      return {
        answer: CHOOSE_CLIENT,
        clients: CLIENTS.map((entry) => ({ value: entry.value, title: entry.title })),
      };
    }
    const given = currentInstallation();
    const entry = given === undefined ? undefined : await realFile(given.entry);
    if (given === undefined || entry === undefined) {
      throw new CommandError("agent.cli-missing", CLI_MISSING);
    }
    // Real paths, so that a delivery reached through a link or another spelling of its folder is found.
    const installation = { ...given, entry, runtime: (await realFile(given.runtime)) ?? given.runtime };
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const result = setupOf(client, {
      installation,
      platform: process.platform,
      launcherExists: await exists(deliveryLauncher(installation, process.platform)),
      home: os.homedir(),
      env: { APPDATA: process.env["APPDATA"], XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"] },
      workspace: ctx.workspace.root,
      workspaceName: layout.name,
      repository: await repositoryOf(ctx.workspace.root),
    });
    if ("code" in result) {
      throw new CommandError(result.code, result.message);
    }
    return {
      // One line also for a workspace name with a line break (SR-224 AK1).
      answer: sentence(result.answer.replace(/\.$/, "")),
      client,
      server: { ...result.server, args: [...result.server.args] },
      setup: result.setup,
      valid: result.valid,
      next: result.next,
      ...(result.mcpJson === undefined
        ? {}
        : { mcpJson: { ...result.mcpJson, entries: result.mcpJson.entries.map((entry) => ({ ...entry })) } }),
    };
  },
});
