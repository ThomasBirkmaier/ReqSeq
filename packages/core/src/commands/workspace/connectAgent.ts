// workspace.connectAgent (SR-227): the setup that connects a client of an AI agent to the MCP server of this
// workspace, made from the installation that runs the command (installation.ts) and the system's facts
// (agent-setup.ts). It only reads: whether the command line's entry and the delivery's launcher exist, and the
// workspace file for its name; it creates and changes no file, the client's included, and opens no
// connection (AK6, D-068).
import { realpath, stat } from "node:fs/promises";
import os from "node:os";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { CHOOSE_CLIENT, CLIENTS, deliveryLauncher, setupOf } from "../../agent-setup.js";
import { currentInstallation } from "../../installation.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Output = CommandOutput<"workspace.connectAgent">;

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

const CLI_MISSING =
  "The command line of this installation (its bin.js) is missing, so no client could start it.";

export default defineCommand({
  name: "workspace.connectAgent",
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
    });
    if ("code" in result) {
      throw new CommandError(result.code, result.message);
    }
    return {
      answer: result.answer,
      client,
      server: { ...result.server, args: [...result.server.args] },
      setup: result.setup,
      valid: result.valid,
      next: result.next,
    };
  },
});
