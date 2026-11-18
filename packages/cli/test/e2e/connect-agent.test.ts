// End-to-end test of `reqseq workspace connect-agent` (SR-227 AK5, AK6): the built command line gives the setup
// of each client for a workspace whose path holds a space, `'`, `’`, `(` and `ü`; the setup is run as the user would
// paste it, in sh on Linux and macOS and in Windows PowerShell 5.1 and PowerShell 7 on Windows, with stub
// programs `claude`, `code` and `codex` that only write down their arguments (shaped like npm installs on
// Windows: a `.ps1` and a `.cmd`, and `code.cmd`). What the client would start from those arguments, or from
// the JSON block, is started, and its MCP server answers `initialize` for this workspace.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LineTransport } from "@reqseq/mcp";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));
const bin = path.join(cliDir, "dist", "bin.js");
// The spawned CLI and server fail any connection that leaves the machine, like the test process (SR-077).
const blockNetwork = pathToFileURL(
  path.join(cliDir, "..", "..", "scripts", "test-support", "block-network.mjs"),
).href;

const CLIENTS = ["claude-code", "claude-desktop", "cursor", "vscode", "codex-cli", "other"] as const;
type ClientName = (typeof CLIENTS)[number];

interface Server {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}
interface Output {
  readonly server: Server;
  readonly setup: { readonly form: "command" | "json"; readonly shell?: string; readonly text: string };
}

let top = "";
let ws: FixtureWorkspace;
let home = "";
let stubs = "";
const children: ChildProcessWithoutNullStreams[] = [];

/** The environment of every process: HOME and the configuration folders in a temporary folder of their own. */
const environment = (extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = `${stubs}${path.delimiter}${env[pathKey] ?? ""}`;
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData"),
    LOCALAPPDATA: path.join(home, "Local"),
    XDG_CONFIG_HOME: path.join(home, "config"),
    XDG_CACHE_HOME: path.join(home, "cache"),
    ...extra,
  };
};

/** Every file and folder below `folder` with its size and modification time. */
const snapshot = async (folder: string): Promise<string[]> => {
  const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const file = path.join(entry.parentPath, entry.name);
      const stat = await fs.lstat(file);
      return `${file} ${String(stat.size)} ${String(stat.mtimeMs)}`;
    }),
  ).then((lines) => lines.sort());
};

const run = (
  command: string,
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ws.root, env: environment(extra), stdio: "pipe" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

const connectAgent = async (client: ClientName): Promise<Output> => {
  const result = await run(
    process.execPath,
    [
      "--import",
      blockNetwork,
      bin,
      "workspace",
      "connect-agent",
      "--client",
      client,
      "--json",
      "--workspace",
      ws.root,
      // The compile cache of the command line's start (#178) is no file of the command.
    ],
    { NODE_DISABLE_COMPILE_CACHE: "1" },
  );
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Output;
};

/** A stub program that writes its arguments as JSON into `<stubs>/<name>.json`. */
const writeStub = async (name: string): Promise<void> => {
  const script = path.join(stubs, "stub.mjs");
  if (process.platform === "win32") {
    // As npm installs a program: PowerShell takes the `.ps1`, cmd.exe the `.cmd`.
    if (name !== "code") {
      await fs.writeFile(
        path.join(stubs, `${name}.ps1`),
        `& "${process.execPath}" "${script}" ${name} $args\r\n`,
      );
    }
    await fs.writeFile(path.join(stubs, `${name}.cmd`), `@"${process.execPath}" "${script}" ${name} %*\r\n`);
    return;
  }
  const file = path.join(stubs, name);
  await fs.writeFile(file, `#!/bin/sh\nexec '${process.execPath}' '${script}' ${name} "$@"\n`);
  await fs.chmod(file, 0o755);
};

/** The shells the pasted command runs in on this system. */
const shells = (): { readonly name: string; readonly run: (file: string) => [string, string[]] }[] => {
  if (process.platform !== "win32") {
    return [{ name: "sh", run: (file) => ["sh", [file]] }];
  }
  const ps =
    (exe: string) =>
    (file: string): [string, string[]] => [
      exe,
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
    ];
  const found = spawnSync("where.exe", ["pwsh"]).status === 0;
  return [
    { name: "Windows PowerShell 5.1", run: ps("powershell.exe") },
    ...(found ? [{ name: "PowerShell 7", run: ps("pwsh") }] : []),
  ];
};

/** What the client starts, from the arguments the stub of its command got. */
const serverFromArguments = (client: ClientName, argv: readonly string[]): Server => {
  if (client === "vscode") {
    expect(argv[0]).toBe("--add-mcp");
    const json = JSON.parse(argv[1] ?? "") as Omit<Server, "env"> & {
      name: string;
      type: string;
      env?: Server["env"];
    };
    expect(json).toMatchObject({ name: "reqseq", type: "stdio" });
    return { command: json.command, args: json.args, env: json.env ?? {} };
  }
  const separator = argv.indexOf("--");
  const own = argv.slice(0, separator);
  expect(own.slice(0, 2)).toEqual(["mcp", "add"]);
  expect(own).toContain("reqseq");
  const env: Record<string, string> = {};
  own.forEach((value, index) => {
    if (value === "--env") {
      const [name = "", ...rest] = (own[index + 1] ?? "").split("=");
      env[name] = rest.join("=");
    }
  });
  const [command = "", ...args] = argv.slice(separator + 1);
  return { command, args, env };
};

/** Starts the server and answers with the workspace path its tool.info gives, after `initialize`. */
const workspaceOf = async (server: Server): Promise<string> => {
  const child = spawn(server.command, [...server.args], {
    stdio: "pipe",
    env: environment({ ...server.env, NODE_OPTIONS: `--import=${blockNetwork}` }),
  });
  children.push(child);
  const client = new Client({ name: "connect-agent-e2e", version: "1" });
  await client.connect(new LineTransport(child.stdout, { write: (text) => child.stdin.write(text) }));
  expect(client.getServerVersion()?.name).toBeDefined();
  const result = await client.callTool({ name: "tool_info", arguments: {} });
  await client.close();
  child.stdin.end();
  return (result.structuredContent as { workspace: { path: string } }).workspace.path;
};

beforeAll(async () => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} is missing: run pnpm build before pnpm test:e2e`);
  }
  top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-connect-")));
  // A typographic quote ends a single-quoted PowerShell string too.
  const parent = path.join(top, "Ann's work (ü) \u2019");
  await fs.mkdir(parent);
  ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true, tempDir: parent });
  home = path.join(top, "home");
  stubs = path.join(top, "bin");
  for (const folder of [home, stubs, path.join(home, "AppData"), path.join(home, "config")]) {
    await fs.mkdir(folder, { recursive: true });
  }
  await fs.writeFile(
    path.join(stubs, "stub.mjs"),
    [
      'import { writeFileSync } from "node:fs";',
      'import path from "node:path";',
      "const [name, ...args] = process.argv.slice(2);",
      "writeFileSync(path.join(path.dirname(process.argv[1]), `${name}.json`), JSON.stringify(args));",
      "",
    ].join("\n"),
  );
  for (const name of ["claude", "code", "codex"]) {
    await writeStub(name);
  }
});

afterAll(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
  await ws.cleanup();
  await fs.rm(top, { recursive: true, force: true, maxRetries: 3 });
});

describe("reqseq workspace connect-agent", () => {
  it("[SR-227/AK-qxzf] the program the pasted setup of each client names starts the MCP server of this workspace", async () => {
    for (const client of CLIENTS) {
      const output = await connectAgent(client);
      const started: Server[] = [];
      if (output.setup.form === "json") {
        const json = JSON.parse(output.setup.text) as {
          mcpServers: { reqseq: Omit<Server, "env"> & { env?: Server["env"] } };
        };
        started.push({ ...json.mcpServers.reqseq, env: json.mcpServers.reqseq.env ?? {} });
      } else {
        const program = { "claude-code": "claude", vscode: "code", "codex-cli": "codex" }[client as "vscode"];
        for (const shell of shells()) {
          const script = path.join(top, process.platform === "win32" ? "setup.ps1" : "setup.sh");
          // With a byte order mark, Windows PowerShell 5.1 reads the script as UTF-8, not in the ANSI code page.
          await fs.writeFile(script, `${process.platform === "win32" ? "﻿" : ""}${output.setup.text}\n`);
          await fs.rm(path.join(stubs, `${program}.json`), { force: true });
          const [command, args] = shell.run(script);
          const result = await run(command, args);
          expect(result.code, `${client} in ${shell.name}: ${result.stderr}`).toBe(0);
          const argv = JSON.parse(await fs.readFile(path.join(stubs, `${program}.json`), "utf8")) as string[];
          const server = serverFromArguments(client, argv);
          expect(server, `${client} in ${shell.name}`).toEqual(output.server);
          started.push(server);
        }
      }
      for (const server of started) {
        expect(await workspaceOf(server), client).toBe(ws.root);
      }
    }
  });

  it("[SR-227/AK-nq91] creates and changes no file, in the workspace or the home and configuration folders", async () => {
    const before = [await snapshot(ws.root), await snapshot(home)];
    for (const client of CLIENTS) {
      await connectAgent(client);
    }
    expect([await snapshot(ws.root), await snapshot(home)]).toEqual(before);
  });
});
