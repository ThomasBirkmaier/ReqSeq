// The setup per client and system (SR-227 AK2–AK4) from given facts, so macOS, Linux and Windows are all
// tested on every system; the pasted text is run for real in the CLI e2e test (AK5).
import { describe, expect, it } from "vitest";
import type { Client, Server, Setup, SetupFacts, SetupRefusal } from "./agent-setup.js";
import {
  CLIENTS,
  deliveryLauncher,
  quotePowerShell,
  quoteSh,
  quoteWindowsArgument,
  serverOf,
  setupOf,
} from "./agent-setup.js";

const MAC_APP = "/Applications/ReqSeq.app";
const mac: SetupFacts = {
  installation: {
    runtime: `${MAC_APP}/Contents/MacOS/ReqSeq`,
    entry: `${MAC_APP}/Contents/Resources/cli/dist/bin.js`,
    electron: true,
  },
  platform: "darwin",
  launcherExists: true,
  home: "/Users/ann",
  env: {},
  workspace: "/Users/ann/Projects/station",
  workspaceName: "Weather station",
};
const linux: SetupFacts = {
  installation: {
    runtime: "/home/ann/ReqSeq/ReqSeq",
    entry: "/home/ann/ReqSeq/resources/cli/dist/bin.js",
    electron: true,
  },
  platform: "linux",
  launcherExists: true,
  home: "/home/ann",
  env: {},
  workspace: "/home/ann/station",
  workspaceName: "Weather station",
};
const windows: SetupFacts = {
  installation: {
    runtime: "C:\\Tools\\ReqSeq\\ReqSeq.exe",
    entry: "C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js",
    electron: true,
  },
  platform: "win32",
  launcherExists: false,
  home: "C:\\Users\\ann",
  env: { APPDATA: "C:\\Users\\ann\\AppData\\Roaming" },
  workspace: "C:\\Work\\station",
  workspaceName: "Weather station",
};

/** The entry of a JSON block: env only when it has variables. */
const serverJson = (server: Server): Record<string, unknown> => ({
  command: server.command,
  args: server.args,
  ...(Object.keys(server.env).length === 0 ? {} : { env: server.env }),
});

const setup = (client: Client, facts: SetupFacts): Setup => {
  const result = setupOf(client, facts);
  if ("code" in result) {
    throw new Error(result.message);
  }
  return result;
};

const refusal = (client: Client, facts: SetupFacts): SetupRefusal => {
  const result = setupOf(client, facts);
  if (!("code" in result)) {
    throw new Error("expected a refusal");
  }
  return result;
};

describe("setupOf", () => {
  it("[SR-227/AK-fx6t] gives a terminal command for Claude Code, VS Code and Codex CLI, for PowerShell on Windows, and JSON for the others, with the file only for Claude Desktop and Cursor", () => {
    for (const facts of [mac, linux, windows]) {
      const shell = facts.platform === "win32" ? "powershell" : "sh";
      for (const client of ["claude-code", "vscode", "codex-cli"] as const) {
        const { setup: form, answer } = setup(client, facts);
        expect(form).toMatchObject({ form: "command", shell });
        expect(form.file).toBeUndefined();
        expect(answer).toContain(facts.platform === "win32" ? "in PowerShell" : "in a terminal");
      }
      for (const client of ["claude-desktop", "cursor", "other"] as const) {
        const { setup: form } = setup(client, facts);
        expect(form.form).toBe("json");
        expect(form.shell).toBeUndefined();
        const json = JSON.parse(form.text) as { mcpServers: Record<string, unknown> };
        expect(Object.keys(json.mcpServers)).toEqual(["reqseq"]);
        expect(json.mcpServers["reqseq"]).toEqual(serverJson(serverOf(facts)));
      }
      expect(setup("other", facts).setup.file).toBeUndefined();
    }
    expect(setup("claude-code", mac).setup.text).toBe(
      "claude mcp add --transport stdio reqseq -- /Applications/ReqSeq.app/Contents/Resources/bin/reqseq mcp --workspace /Users/ann/Projects/station",
    );
    expect(setup("codex-cli", linux).setup.text).toBe(
      "codex mcp add reqseq -- /home/ann/ReqSeq/bin/reqseq mcp --workspace /home/ann/station",
    );
    expect(setup("vscode", linux).setup.text).toBe(
      `code --add-mcp '{"name":"reqseq","type":"stdio","command":"/home/ann/ReqSeq/bin/reqseq","args":["mcp","--workspace","/home/ann/station"]}'`,
    );
    expect(setup("claude-code", windows).setup.text).toBe(
      "claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio reqseq '--' 'C:\\Tools\\ReqSeq\\ReqSeq.exe' 'C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js' mcp --workspace 'C:\\Work\\station'",
    );
    expect(setup("codex-cli", windows).setup.text).toBe(
      "codex mcp add reqseq --env ELECTRON_RUN_AS_NODE=1 '--' 'C:\\Tools\\ReqSeq\\ReqSeq.exe' 'C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js' mcp --workspace 'C:\\Work\\station'",
    );
    expect(setup("vscode", windows).setup.text).toBe(
      String.raw`code --% --add-mcp "{\"name\":\"reqseq\",\"type\":\"stdio\",\"command\":\"C:\\Tools\\ReqSeq\\ReqSeq.exe\",\"args\":[\"C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js\",\"mcp\",\"--workspace\",\"C:\\Work\\station\"],\"env\":{\"ELECTRON_RUN_AS_NODE\":\"1\"}}"`,
    );
    expect(setup("claude-desktop", mac).setup.file).toBe(
      "/Users/ann/Library/Application Support/Claude/claude_desktop_config.json",
    );
    expect(setup("claude-desktop", windows).setup.file).toBe(
      "C:\\Users\\ann\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
    );
    expect(setup("claude-desktop", { ...windows, env: {} }).setup.file).toBe(
      "C:\\Users\\ann\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
    );
    expect(setup("claude-desktop", linux).setup.file).toBe(
      "/home/ann/.config/Claude/claude_desktop_config.json",
    );
    expect(setup("claude-desktop", { ...linux, env: { XDG_CONFIG_HOME: "/home/ann/cfg" } }).setup.file).toBe(
      "/home/ann/cfg/Claude/claude_desktop_config.json",
    );
    expect(setup("claude-desktop", { ...linux, env: { XDG_CONFIG_HOME: "" } }).setup.file).toBe(
      "/home/ann/.config/Claude/claude_desktop_config.json",
    );
    expect(setup("cursor", mac).setup.file).toBe("/Users/ann/.cursor/mcp.json");
    expect(setup("cursor", windows).setup.file).toBe("C:\\Users\\ann\\.cursor\\mcp.json");
    expect(setup("cursor", linux).answer).toBe(
      'Add this entry under mcpServers in /home/ann/.cursor/mcp.json to connect Cursor to the workspace "Weather station".',
    );
    expect(setup("other", linux).answer).toBe(
      'Add this entry to your client\'s MCP configuration to connect it to the workspace "Weather station".',
    );
    for (const client of CLIENTS) {
      expect(setup(client.value, linux).next.length).toBeGreaterThan(0);
    }
  });

  it("[SR-227/AK-cw0k] names the absolute launcher or runtime and the workspace, the Windows form with ReqSeq.exe, bin.js and ELECTRON_RUN_AS_NODE, where it holds, and differs between two installations", () => {
    expect(serverOf(mac)).toEqual({
      command: `${MAC_APP}/Contents/Resources/bin/reqseq`,
      args: ["mcp", "--workspace", mac.workspace],
      env: {},
    });
    expect(serverOf(linux)).toEqual({
      command: "/home/ann/ReqSeq/bin/reqseq",
      args: ["mcp", "--workspace", linux.workspace],
      env: {},
    });
    expect(serverOf(windows)).toEqual({
      command: "C:\\Tools\\ReqSeq\\ReqSeq.exe",
      args: ["C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js", "mcp", "--workspace", "C:\\Work\\station"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    for (const client of CLIENTS) {
      const text = setup(client.value, windows).setup.text;
      expect(text).toContain("ReqSeq.exe");
      expect(text).toContain("bin.js");
      expect(text).toContain("ELECTRON_RUN_AS_NODE");
      expect(text).toContain("station");
    }
    expect(setup("claude-code", mac).valid).toBe(`The setup holds as long as ReqSeq stays in ${MAC_APP}.`);
    expect(setup("claude-code", linux).valid).toBe(
      "The setup holds as long as ReqSeq stays in /home/ann/ReqSeq.",
    );
    expect(setup("claude-code", windows).valid).toBe(
      "The setup holds as long as ReqSeq stays in C:\\Tools\\ReqSeq.",
    );
    // A checkout or the npm package on Node: the runtime and the entry, without the Electron variable.
    const node: SetupFacts = {
      ...linux,
      installation: { runtime: "/usr/bin/node", entry: "/opt/reqseq/cli/dist/bin.js", electron: false },
    };
    expect(serverOf(node)).toEqual({
      command: "/usr/bin/node",
      args: ["/opt/reqseq/cli/dist/bin.js", "mcp", "--workspace", linux.workspace],
      env: {},
    });
    expect(setup("other", node).valid).toBe(
      "The setup holds as long as the command line stays in /opt/reqseq/cli and its runtime at /usr/bin/node.",
    );
    // Two installations give different paths.
    const moved: SetupFacts = {
      ...linux,
      installation: {
        runtime: "/opt/ReqSeq/ReqSeq",
        entry: "/opt/ReqSeq/resources/cli/dist/bin.js",
        electron: true,
      },
    };
    expect(serverOf(moved).command).toBe("/opt/ReqSeq/bin/reqseq");
    expect(serverOf(moved).command).not.toBe(serverOf(linux).command);
  });

  it("[SR-227/AK-wvgw] gives no setup for an app macOS runs from a translocated place, and says to move it to /Applications", () => {
    const translocated: SetupFacts = {
      ...mac,
      installation: {
        runtime: "/private/var/folders/x1/T/AppTranslocation/0F2E/d/ReqSeq.app/Contents/MacOS/ReqSeq",
        entry:
          "/private/var/folders/x1/T/AppTranslocation/0F2E/d/ReqSeq.app/Contents/Resources/cli/dist/bin.js",
        electron: true,
      },
    };
    for (const client of CLIENTS) {
      const result = refusal(client.value, translocated);
      expect(result.code).toBe("agent.app-translocated");
      expect(result.message).toContain("/Applications");
    }
    // The same folder name elsewhere is no translocation.
    expect(setupOf("other", { ...translocated, platform: "linux" })).not.toHaveProperty("code");
  });
});

describe("the launch form", () => {
  it("takes the launcher only in a delivery where it exists, and never on Windows", () => {
    expect(serverOf({ ...linux, launcherExists: false }).command).toBe(linux.installation.runtime);
    expect(deliveryLauncher(windows.installation, "win32")).toBeUndefined();
    // A checkout run by Electron: the runtime is not next to the resources folder.
    const checkout = {
      runtime: "/repo/node_modules/electron/dist/electron",
      entry: "/repo/packages/cli/dist/bin.js",
      electron: true,
    };
    expect(deliveryLauncher(checkout, "linux")).toBeUndefined();
    expect(deliveryLauncher(checkout, "darwin")).toBeUndefined();
    expect(deliveryLauncher({ ...linux.installation, electron: false }, "linux")).toBeUndefined();
    expect(setup("other", { ...linux, installation: checkout }).valid).toContain("/repo/packages/cli");
  });

  it("refuses a VS Code command on Windows for a path cmd.exe would read, and keeps the JSON clients", () => {
    const amp = { ...windows, workspace: "C:\\R&D\\station" };
    expect(refusal("vscode", amp)).toMatchObject({ code: "agent.path-unsupported" });
    expect(refusal("vscode", amp).message).toContain('"&"');
    expect(setupOf("vscode", { ...amp, platform: "linux" })).not.toHaveProperty("code");
    expect(setupOf("other", amp)).not.toHaveProperty("code");
    expect(setupOf("claude-code", amp)).not.toHaveProperty("code");
  });
});

describe("quoting", () => {
  it("quotes a POSIX token only when it is not plain", () => {
    expect(quoteSh("/a/b-c_d.e:f=g@h%i+j")).toBe("/a/b-c_d.e:f=g@h%i+j");
    expect(quoteSh("/a b/it's")).toBe("'/a b/it'\\''s'");
  });

  it("quotes for PowerShell in single quotes", () => {
    expect(quotePowerShell("C:\\a b\\it's")).toBe("'C:\\a b\\it''s'");
  });

  it("quotes a Windows argument by the rules of the command line split", () => {
    expect(quoteWindowsArgument('a"b')).toBe('"a\\"b"');
    expect(quoteWindowsArgument('a\\"b')).toBe('"a\\\\\\"b"');
    expect(quoteWindowsArgument("a\\b")).toBe('"a\\b"');
    expect(quoteWindowsArgument("a\\")).toBe('"a\\\\"');
  });
});
