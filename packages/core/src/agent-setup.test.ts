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
  skillCall,
} from "./agent-setup.js";

// The unpacked delivery of ADR-0020: `<folder>/bin/reqseq`, `<folder>/runtime/node`, `<folder>/lib/dist/bin.js`.
/** The delivery inside the macOS bundle (SR-249 AK3), moved to /Applications. */
const MAC_APP = "/Applications/ReqSeq.app";
const MAC_FOLDER = `${MAC_APP}/Contents/Resources`;
const mac: SetupFacts = {
  installation: {
    runtime: `${MAC_FOLDER}/runtime/node`,
    entry: `${MAC_FOLDER}/lib/dist/bin.js`,
    electron: false,
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
    runtime: "/home/ann/ReqSeq/runtime/node",
    entry: "/home/ann/ReqSeq/lib/dist/bin.js",
    electron: false,
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
    runtime: "C:\\Tools\\ReqSeq\\runtime\\node.exe",
    entry: "C:\\Tools\\ReqSeq\\lib\\dist\\bin.js",
    electron: false,
  },
  platform: "win32",
  launcherExists: false,
  home: "C:\\Users\\ann",
  env: { APPDATA: "C:\\Users\\ann\\AppData\\Roaming" },
  workspace: "C:\\Work\\station",
  workspaceName: "Weather station",
};
/** A command line run by Electron (the paused app's checkout), which needs `ELECTRON_RUN_AS_NODE`. */
const windowsElectron: SetupFacts = {
  ...windows,
  installation: {
    runtime: "C:\\Tools\\ReqSeq\\ReqSeq.exe",
    entry: "C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js",
    electron: true,
  },
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
  it("[SR-227/AK-fx6t] gives a terminal command for Claude Code, VS Code and Codex CLI, for PowerShell on Windows, and JSON for the others, with the file only for Claude Desktop and Cursor, and the skill-file call for all but Claude Desktop", () => {
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
    expect(setup("claude-code", windowsElectron).setup.text).toBe(
      "claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio reqseq '--' 'C:\\Tools\\ReqSeq\\ReqSeq.exe' 'C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js' mcp --workspace 'C:\\Work\\station'",
    );
    expect(setup("codex-cli", windowsElectron).setup.text).toBe(
      "codex mcp add reqseq --env ELECTRON_RUN_AS_NODE=1 '--' 'C:\\Tools\\ReqSeq\\ReqSeq.exe' 'C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js' mcp --workspace 'C:\\Work\\station'",
    );
    expect(setup("vscode", windowsElectron).setup.text).toBe(
      String.raw`code --% --add-mcp "{\"name\":\"reqseq\",\"type\":\"stdio\",\"command\":\"C:\\Tools\\ReqSeq\\ReqSeq.exe\",\"args\":[\"C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js\",\"mcp\",\"--workspace\",\"C:\\Work\\station\"],\"env\":{\"ELECTRON_RUN_AS_NODE\":\"1\"}}"`,
    );
    // Under the setup of every client but Claude Desktop, the call that writes the skill file, for a terminal
    // (PowerShell on Windows), started as the setup starts the server.
    expect(setup("claude-code", mac).next).toMatch(
      /To give Claude Code the skill file, run this in a terminal: `\/Applications\/ReqSeq\.app\/Contents\/Resources\/bin\/reqseq tool guide --skill --write --workspace \/Users\/ann\/Projects\/station`\.$/,
    );
    expect(skillCall({ ...linux, workspace: "/home/ann/my station" })).toBe(
      "/home/ann/ReqSeq/bin/reqseq tool guide --skill --write --workspace '/home/ann/my station'",
    );
    expect(skillCall({ ...linux, launcherExists: false })).toBe(
      "/home/ann/ReqSeq/runtime/node /home/ann/ReqSeq/lib/dist/bin.js tool guide --skill --write --workspace /home/ann/station",
    );
    expect(
      skillCall({
        ...linux,
        installation: { runtime: "/repo/electron", entry: "/repo/cli/dist/bin.js", electron: true },
      }),
    ).toBe(
      "ELECTRON_RUN_AS_NODE=1 /repo/electron /repo/cli/dist/bin.js tool guide --skill --write --workspace /home/ann/station",
    );
    expect(skillCall(windowsElectron)).toBe(
      "$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\\Tools\\ReqSeq\\ReqSeq.exe' 'C:\\Tools\\ReqSeq\\resources\\cli\\dist\\bin.js' tool guide --skill --write --workspace 'C:\\Work\\station'; Remove-Item Env:ELECTRON_RUN_AS_NODE",
    );
    const node = {
      runtime: "C:\\Program Files\\nodejs\\node.exe",
      entry: "C:\\npm\\reqseq\\dist\\bin.js",
      electron: false,
    };
    expect(skillCall({ ...windows, installation: node })).toBe(
      "& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\npm\\reqseq\\dist\\bin.js' tool guide --skill --write --workspace 'C:\\Work\\station'",
    );
    const who = {
      "claude-code": "Claude Code",
      cursor: "Cursor",
      vscode: "VS Code",
      "codex-cli": "Codex CLI",
      other: "your agent",
    };
    for (const [client, name] of Object.entries(who) as [keyof typeof who, string][]) {
      expect(setup(client, linux).next, client).toMatch(
        new RegExp(` To give ${name} the skill file, run this in a terminal: \`[^\`]+\`\\.$`),
      );
      expect(setup(client, linux).next, client).toContain(`\`${skillCall(linux)}\`.`);
      expect(setup(client, windows).next, client).toContain(
        `To give ${name} the skill file, run this in PowerShell: \`${skillCall(windows)}\`.`,
      );
    }
    for (const facts of [linux, windows, mac]) {
      expect(setup("claude-desktop", facts).next).not.toContain("tool guide");
    }
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

  // The Windows form is the assumption of #2352: the shipped node.exe and bin.js, without ELECTRON_RUN_AS_NODE.
  it("[SR-227/AK-cw0k] names the absolute launcher or runtime and the workspace, the Windows form with node.exe and bin.js, where it holds, and differs between two installations", () => {
    expect(serverOf(mac)).toEqual({
      command: `${MAC_FOLDER}/bin/reqseq`,
      args: ["mcp", "--workspace", mac.workspace],
      env: {},
    });
    expect(serverOf(linux)).toEqual({
      command: "/home/ann/ReqSeq/bin/reqseq",
      args: ["mcp", "--workspace", linux.workspace],
      env: {},
    });
    expect(serverOf(windows)).toEqual({
      command: "C:\\Tools\\ReqSeq\\runtime\\node.exe",
      args: ["C:\\Tools\\ReqSeq\\lib\\dist\\bin.js", "mcp", "--workspace", "C:\\Work\\station"],
      env: {},
    });
    for (const client of CLIENTS) {
      const text = setup(client.value, windows).setup.text;
      expect(text).toContain("node.exe");
      expect(text).toContain("bin.js");
      expect(text).not.toContain("ELECTRON_RUN_AS_NODE");
      expect(text).toContain("station");
    }
    // On macOS the folder a person moves is the bundle; an unpacked folder of an earlier layout is named itself.
    expect(setup("claude-code", mac).valid).toBe(`The setup holds as long as ReqSeq stays in ${MAC_APP}.`);
    const folder: SetupFacts = {
      ...mac,
      installation: {
        runtime: "/Users/ann/ReqSeq/runtime/node",
        entry: "/Users/ann/ReqSeq/lib/dist/bin.js",
        electron: false,
      },
    };
    expect(serverOf(folder).command).toBe("/Users/ann/ReqSeq/bin/reqseq");
    expect(setup("other", folder).valid).toBe(
      "The setup holds as long as ReqSeq stays in /Users/ann/ReqSeq.",
    );
    const resources: SetupFacts = {
      ...mac,
      installation: {
        runtime: "/Users/ann/Resources/runtime/node",
        entry: "/Users/ann/Resources/lib/dist/bin.js",
        electron: false,
      },
    };
    expect(setup("other", resources).valid).toBe(
      "The setup holds as long as ReqSeq stays in /Users/ann/Resources.",
    );
    const contents: SetupFacts = {
      ...mac,
      installation: {
        runtime: "/Users/ann/Contents/Resources/runtime/node",
        entry: "/Users/ann/Contents/Resources/lib/dist/bin.js",
        electron: false,
      },
    };
    expect(setup("other", contents).valid).toBe(
      "The setup holds as long as ReqSeq stays in /Users/ann/Contents/Resources.",
    );
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
        runtime: "/opt/ReqSeq/runtime/node",
        entry: "/opt/ReqSeq/lib/dist/bin.js",
        electron: false,
      },
    };
    expect(serverOf(moved).command).toBe("/opt/ReqSeq/bin/reqseq");
    expect(serverOf(moved).command).not.toBe(serverOf(linux).command);
  });

  it("[SR-227/AK-wvgw] gives no setup for a desktop shell macOS runs from a translocated place, and says to move it to /Applications", () => {
    // The server the shell starts runs the Node and the command line inside the translocated bundle.
    const bundle = "/private/var/folders/x1/T/AppTranslocation/0F2E/d/ReqSeq.app/Contents/Resources";
    const translocated: SetupFacts = {
      ...mac,
      installation: {
        runtime: `${bundle}/runtime/node`,
        entry: `${bundle}/lib/dist/bin.js`,
        electron: false,
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
    // A checkout run by Electron: no runtime/ and lib/ of a delivery.
    const checkout = {
      runtime: "/repo/node_modules/electron/dist/electron",
      entry: "/repo/packages/cli/dist/bin.js",
      electron: true,
    };
    expect(deliveryLauncher(checkout, "linux")).toBeUndefined();
    expect(deliveryLauncher(checkout, "darwin")).toBeUndefined();
    // Node elsewhere, or bin.js not in lib/dist/ of the folder.
    expect(deliveryLauncher({ ...linux.installation, runtime: "/usr/bin/node" }, "linux")).toBeUndefined();
    expect(
      deliveryLauncher({ ...linux.installation, entry: "/home/ann/ReqSeq/cli/dist/bin.js" }, "linux"),
    ).toBeUndefined();
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

describe("folders and environment", () => {
  it("finds a delivery whose runtime folder differs only in case on Windows and macOS, not on Linux", () => {
    const upper = { ...windows.installation, runtime: "C:\\TOOLS\\ReqSeq\\runtime\\node.exe" };
    expect(setup("other", { ...windows, installation: upper }).valid).toBe(
      "The setup holds as long as ReqSeq stays in C:\\Tools\\ReqSeq.",
    );
    const macUpper = {
      ...mac.installation,
      runtime: "/applications/reqseq.app/contents/resources/runtime/node",
    };
    expect(serverOf({ ...mac, installation: macUpper }).command).toBe(`${MAC_FOLDER}/bin/reqseq`);
    const linuxUpper = { ...linux.installation, runtime: "/home/ann/REQSEQ/runtime/node" };
    expect(serverOf({ ...linux, installation: linuxUpper }).command).toBe("/home/ann/REQSEQ/runtime/node");
  });

  it("takes a configuration folder from the environment only when it is absolute", () => {
    expect(setup("claude-desktop", { ...windows, env: { APPDATA: "" } }).setup.file).toBe(
      "C:\\Users\\ann\\AppData\\Roaming\\Claude\\claude_desktop_config.json",
    );
    expect(setup("claude-desktop", { ...linux, env: { XDG_CONFIG_HOME: "cfg" } }).setup.file).toBe(
      "/home/ann/.config/Claude/claude_desktop_config.json",
    );
  });
});

describe("quoting", () => {
  it("quotes a POSIX token only when it is not plain", () => {
    expect(quoteSh("/a/b-c_d.e:f=g@h%i+j")).toBe("/a/b-c_d.e:f=g@h%i+j");
    expect(quoteSh("/a b/it's")).toBe("'/a b/it'\\''s'");
  });

  it("quotes for PowerShell in single quotes", () => {
    expect(quotePowerShell("C:\\a b\\it's")).toBe("'C:\\a b\\it''s'");
    // PowerShell ends a single-quoted string at the typographic quotes too.
    expect(quotePowerShell("C:\\w\\x\u2019; calc; \u2018")).toBe(
      "'C:\\w\\x\u2019\u2019; calc; \u2018\u2018'",
    );
    expect(quotePowerShell("\u201A\u201B")).toBe("'\u201A\u201A\u201B\u201B'");
  });

  it("quotes a Windows argument by the rules of the command line split", () => {
    expect(quoteWindowsArgument('a"b')).toBe('"a\\"b"');
    expect(quoteWindowsArgument('a\\"b')).toBe('"a\\\\\\"b"');
    expect(quoteWindowsArgument("a\\b")).toBe('"a\\b"');
    expect(quoteWindowsArgument("a\\")).toBe('"a\\\\"');
  });
});
