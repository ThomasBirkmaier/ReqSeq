// The setup of workspace.connectAgent (SR-227): how a client of an AI agent starts the MCP server of a
// workspace, as the program with its arguments (AK3), and as the command or JSON block the user pastes (AK2),
// written for the client from its documentation (named in the PR of #1888). Pure: the facts of the system come
// in as values, so every system can be tested on any system. The templates are data; a new client is a
// spec change (SR-227).
import path from "node:path";
import type { Installation } from "./installation.js";

export const CLIENTS = [
  { value: "claude-code", title: "Claude Code" },
  { value: "claude-desktop", title: "Claude Desktop" },
  { value: "cursor", title: "Cursor" },
  { value: "vscode", title: "VS Code" },
  { value: "codex-cli", title: "Codex CLI" },
  { value: "other", title: "Other" },
] as const;

export type Client = (typeof CLIENTS)[number]["value"];

/** The name of the server in the client's configuration. */
export const SERVER_NAME = "reqseq";

/** The launcher of a delivery on macOS and Linux (ADR-0014). */
const LAUNCHER = "reqseq";

/** What the setup is made from. */
export interface SetupFacts {
  readonly installation: Installation;
  /** `process.platform`. */
  readonly platform: string;
  /** Whether the launcher of a delivery exists at the place `deliveryLauncher` names. */
  readonly launcherExists: boolean;
  /** The home folder, and the environment variables that move the configuration folders. */
  readonly home: string;
  readonly env: { readonly APPDATA?: string | undefined; readonly XDG_CONFIG_HOME?: string | undefined };
  /** The absolute path and the name of the workspace. */
  readonly workspace: string;
  readonly workspaceName: string;
}

export interface Server {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface Setup {
  readonly answer: string;
  readonly server: Server;
  readonly setup: {
    readonly form: "command" | "json";
    readonly shell?: "sh" | "powershell";
    readonly text: string;
    readonly file?: string;
  };
  readonly valid: string;
  readonly next: string;
}

/** Why no setup can be given: the error code and its message. */
export interface SetupRefusal {
  readonly code: "agent.app-translocated" | "agent.path-unsupported";
  readonly message: string;
}

const pathsOf = (platform: string): path.PlatformPath => (platform === "win32" ? path.win32 : path.posix);

/** Whether two folders are the same; Windows and macOS compare names without case. */
const sameFolder = (platform: string, a: string, b: string): boolean =>
  platform === "win32" || platform === "darwin" ? a.toLowerCase() === b.toLowerCase() : a === b;

/** The delivery an installation belongs to: its resources folder and the folder a user moves (`ReqSeq.app`, or the unpacked folder). */
const deliveryOf = (
  installation: Installation,
  platform: string,
): { readonly resources: string; readonly folder: string } | undefined => {
  if (!installation.electron) {
    return undefined;
  }
  const p = pathsOf(platform);
  // `<resources>/cli/dist/bin.js`; the runtime is in `Contents/MacOS` next to `Contents/Resources` on macOS, else next to `resources`.
  const resources = p.dirname(p.dirname(p.dirname(installation.entry)));
  const runtimeFolder = p.dirname(installation.runtime);
  if (platform === "darwin") {
    const contents = p.dirname(resources);
    return sameFolder(platform, runtimeFolder, p.join(contents, "MacOS"))
      ? { resources, folder: p.dirname(contents) }
      : undefined;
  }
  const folder = p.dirname(resources);
  return sameFolder(platform, runtimeFolder, folder) ? { resources, folder } : undefined;
};

/** Where the launcher of the delivery would be; undefined on Windows (its `.cmd` starts only through a shell) and outside a delivery. */
export const deliveryLauncher = (installation: Installation, platform: string): string | undefined => {
  const delivery = platform === "win32" ? undefined : deliveryOf(installation, platform);
  if (delivery === undefined) {
    return undefined;
  }
  const p = pathsOf(platform);
  return platform === "darwin"
    ? p.join(delivery.resources, "bin", LAUNCHER)
    : p.join(delivery.folder, "bin", LAUNCHER);
};

/** The program, arguments and environment that start the MCP server for the workspace (AK3). */
export const serverOf = (facts: SetupFacts): Server => {
  const { installation, platform, workspace } = facts;
  const mcp = ["mcp", "--workspace", workspace];
  const launcher = deliveryLauncher(installation, platform);
  if (launcher !== undefined && facts.launcherExists) {
    return { command: launcher, args: mcp, env: {} };
  }
  return {
    command: installation.runtime,
    args: [installation.entry, ...mcp],
    env: installation.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {},
  };
};

/** A token for a POSIX shell: as it is when it is plain, else in single quotes. */
export const quoteSh = (token: string): string =>
  /^[A-Za-z0-9_./:=@%+-]+$/.test(token) ? token : `'${token.replaceAll("'", `'\\''`)}'`;

/** A token for PowerShell in single quotes, which take everything literally but `'`. */
export const quotePowerShell = (token: string): string =>
  `'${token.replace(/['\u2018\u2019\u201A\u201B]/g, "$&$&")}'`;

/**
 * An argument for a Windows program in double quotes, by the rules programs split their command line with:
 * backslashes before a quote are doubled, and a quote is escaped.
 */
export const quoteWindowsArgument = (token: string): string => {
  let out = '"';
  let backslashes = 0;
  for (const char of token) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    out += char === '"' ? `${"\\".repeat(backslashes * 2 + 1)}"` : `${"\\".repeat(backslashes)}${char}`;
    backslashes = 0;
  }
  return `${out}${"\\".repeat(backslashes * 2)}"`;
};

/** Characters `cmd.exe` interprets outside quotes; `code` is `code.cmd` on Windows, which reads its arguments twice. */
const CMD_SPECIAL = /[&^%<>|!"]/;

/** The arguments of the server that are no path and need no quotes. */
const LITERALS: ReadonlySet<string> = new Set(["mcp", "--workspace"]);

const TITLES: Readonly<Record<Client, string>> = Object.fromEntries(
  CLIENTS.map((entry) => [entry.value, entry.title]),
) as Record<Client, string>;

/** A folder from the environment when it is absolute, else the folder the client takes without it. */
const absoluteOr = (p: path.PlatformPath, value: string | undefined, fallback: string): string =>
  value !== undefined && p.isAbsolute(value) ? value : fallback;

/** The configuration file of the client on this system, for the clients configured by a file. */
const configFile = (client: "claude-desktop" | "cursor", facts: SetupFacts): string => {
  const p = pathsOf(facts.platform);
  if (client === "cursor") {
    return p.join(facts.home, ".cursor", "mcp.json");
  }
  const file = ["Claude", "claude_desktop_config.json"] as const;
  if (facts.platform === "darwin") {
    return p.join(facts.home, "Library", "Application Support", ...file);
  }
  if (facts.platform === "win32") {
    return p.join(absoluteOr(p, facts.env.APPDATA, p.join(facts.home, "AppData", "Roaming")), ...file);
  }
  return p.join(absoluteOr(p, facts.env.XDG_CONFIG_HOME, p.join(facts.home, ".config")), ...file);
};

const entryJson = (server: Server): Record<string, unknown> => ({
  command: server.command,
  args: server.args,
  ...(Object.keys(server.env).length === 0 ? {} : { env: server.env }),
});

const mcpServersJson = (server: Server): string =>
  JSON.stringify({ mcpServers: { [SERVER_NAME]: entryJson(server) } }, null, 2);

const envOptions = (server: Server): string[] =>
  Object.entries(server.env).map(([name, value]) => `--env ${name}=${value}`);

/** The terminal command for a client configured by its own command line (AK2). */
const commandText = (
  client: "claude-code" | "vscode" | "codex-cli",
  server: Server,
  windows: boolean,
): string => {
  const quote = windows ? quotePowerShell : quoteSh;
  // A `.ps1` shim (npm installs of claude and codex) would take a bare `--` as the end of its own parameters.
  const separator = windows ? "'--'" : "--";
  const program = [server.command, ...server.args].map((token) =>
    LITERALS.has(token) ? token : quote(token),
  );
  if (client === "claude-code") {
    // `--env` must not stand right before the name, which it would take as another pair (Claude Code docs).
    return [
      "claude mcp add",
      ...envOptions(server),
      "--transport stdio",
      SERVER_NAME,
      separator,
      ...program,
    ].join(" ");
  }
  if (client === "codex-cli") {
    return ["codex mcp add", SERVER_NAME, ...envOptions(server), separator, ...program].join(" ");
  }
  const json = JSON.stringify({ name: SERVER_NAME, type: "stdio", ...entryJson(server) });
  // `code` is `code.cmd` on Windows: `--%` hands the rest to it unchanged, in the quoting of the Windows rules.
  return windows ? `code --% --add-mcp ${quoteWindowsArgument(json)}` : `code --add-mcp ${quoteSh(json)}`;
};

const NEXT: Readonly<Record<Client, string>> = {
  "claude-code":
    "Run it in the folder where you start Claude Code; `/mcp` there lists reqseq. If a server named reqseq exists, remove it first with `claude mcp remove reqseq`.",
  "claude-desktop":
    "Create the file if it is missing and keep the other entries under mcpServers, then quit and restart Claude Desktop.",
  cursor:
    "Create the file if it is missing and keep the other entries under mcpServers, then restart Cursor.",
  vscode: "VS Code adds the server to the MCP configuration of your user profile.",
  "codex-cli": "Codex CLI adds the server to its configuration; a new Codex session uses it.",
  other:
    "Add the entry to your client's MCP configuration; a client with another form takes the same command, args and env.",
};

/**
 * The sentence under Claude Code's command that names the call writing the skill file into the workspace's
 * repository (AK2, SR-229 AK8), with the workspace quoted for the shell of the command.
 */
const skillSentence = (workspace: string, windows: boolean): string =>
  `To give Claude Code the skill file, run \`reqseq tool guide --skill --write --workspace ${(windows ? quotePowerShell : quoteSh)(workspace)}\`.`;

/** The folder whose move ends the setup, as the `valid` sentence names it (AK3). */
const validSentence = (facts: SetupFacts): string => {
  const delivery = deliveryOf(facts.installation, facts.platform);
  if (delivery !== undefined) {
    return `The setup holds as long as ReqSeq stays in ${delivery.folder}.`;
  }
  const p = pathsOf(facts.platform);
  return `The setup holds as long as the command line stays in ${p.dirname(p.dirname(facts.installation.entry))} and its runtime at ${facts.installation.runtime}.`;
};

/** Why no setup is given for these facts (AK4, and paths `code.cmd` cannot take); undefined when one is. */
export const refusalOf = (client: Client, facts: SetupFacts, server: Server): SetupRefusal | undefined => {
  const { installation } = facts;
  if (
    facts.platform === "darwin" &&
    // Split at both separators, so the check is the same wherever the tests run.
    [installation.runtime, installation.entry].some((value) =>
      value.split(/[\\/]/).includes("AppTranslocation"),
    )
  ) {
    return {
      code: "agent.app-translocated",
      message:
        "ReqSeq runs from a temporary place macOS gave it for this start, so a setup would stop working. Move ReqSeq.app to /Applications, start it from there, and run Connect AI agent again.",
    };
  }
  if (client === "vscode" && facts.platform === "win32") {
    const bad = CMD_SPECIAL.exec([server.command, ...server.args].join(""));
    if (bad !== null) {
      return {
        code: "agent.path-unsupported",
        message: `The path of ReqSeq or of the workspace holds "${bad[0]}", which the VS Code command cannot pass on Windows. Move it to a path without "${bad[0]}", or choose the client other and add its JSON block to VS Code by hand.`,
      };
    }
  }
  return undefined;
};

/** The setup for a client (AK2, AK3), or why there is none. */
export const setupOf = (client: Client, facts: SetupFacts): Setup | SetupRefusal => {
  const server = serverOf(facts);
  const refusal = refusalOf(client, facts, server);
  if (refusal !== undefined) {
    return refusal;
  }
  const title = TITLES[client];
  const to = `to connect ${client === "other" ? "it" : title} to the workspace "${facts.workspaceName}"`;
  const common = { server, valid: validSentence(facts), next: NEXT[client] };
  if (client === "claude-desktop" || client === "cursor") {
    const file = configFile(client, facts);
    return {
      ...common,
      answer: `Add this entry under mcpServers in ${file} ${to}.`,
      setup: { form: "json", text: mcpServersJson(server), file },
    };
  }
  if (client === "other") {
    return {
      ...common,
      answer: `Add this entry to your client's MCP configuration ${to}.`,
      setup: { form: "json", text: mcpServersJson(server) },
    };
  }
  const windows = facts.platform === "win32";
  return {
    ...common,
    ...(client === "claude-code"
      ? { next: `${NEXT[client]} ${skillSentence(facts.workspace, windows)}` }
      : {}),
    answer: `Run this command in ${windows ? "PowerShell" : "a terminal"} ${to}.`,
    setup: {
      form: "command",
      shell: windows ? "powershell" : "sh",
      text: commandText(client, server, windows),
    },
  };
};

/** The answer without a client (AK1). */
const TITLE_LIST = CLIENTS.map((entry) => entry.title);
export const CHOOSE_CLIENT = `Choose the client to connect: ${TITLE_LIST.slice(0, -1).join(", ")} or ${TITLE_LIST.slice(-1).join("")}.`;
