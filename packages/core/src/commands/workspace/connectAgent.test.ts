// workspace.connectAgent (SR-227) as a command: the clients without a client (AK1), the setup made from the
// installation of the process and the workspace, and the errors. The setup per system is agent-setup.test.ts;
// running the pasted text is the CLI e2e test (AK5, AK6).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { setInstallation } from "../../installation.js";
import { getCommandRuntime, invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = InvokedOutput<"workspace.connectAgent">;

const fixture = async (): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  onTestFinished(() => created.cleanup());
  return created;
};

const run = async (root: string, input: Record<string, unknown>): Promise<Output> => {
  const workspace = new Workspace(root);
  try {
    return (await invoke("workspace.connectAgent", input, { workspace })) as Output;
  } finally {
    await workspace.close();
  }
};

/** A folder with a command line entry, `<top>/cli/dist/bin.js`, as the installation of this process. */
const installation = async (): Promise<string> => {
  const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-connect-agent-")));
  onTestFinished(() => fs.rm(top, { recursive: true, force: true }));
  await fs.mkdir(path.join(top, "cli", "dist"), { recursive: true });
  const entry = path.join(top, "cli", "dist", "bin.js");
  await fs.writeFile(entry, "");
  setInstallation({ runtime: process.execPath, entry, electron: false });
  return entry;
};

const platform = (value: string): void => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value, configurable: true });
  onTestFinished(() => {
    if (original !== undefined) {
      Object.defineProperty(process, "platform", original);
    }
  });
};

const failure = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error: unknown = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

afterEach(() => {
  setInstallation(undefined);
});

describe("workspace.connectAgent", () => {
  it("[SR-227/AK-gvt5] offers the six clients as fixed values, and without a client names them", async () => {
    const entry = getCommandRuntime().contracts.entry("workspace.connectAgent");
    expect(entry?.arguments).toEqual([{ field: "client", complete: "choice" }]);
    const values = ["claude-code", "claude-desktop", "cursor", "vscode", "codex-cli", "other"];
    expect((entry?.input as { properties: { client: { enum: string[] } } }).properties.client.enum).toEqual(
      values,
    );
    const ws = await fixture();
    const output = await run(ws.root, {});
    expect(output.clients?.map((client) => client.value)).toEqual(values);
    expect(output.clients?.map((client) => client.title)).toEqual([
      "Claude Code",
      "Claude Desktop",
      "Cursor",
      "VS Code",
      "Codex CLI",
      "Other",
    ]);
    expect(output.answer).toBe(
      "Choose the client to connect: Claude Code, Claude Desktop, Cursor, VS Code, Codex CLI or Other.",
    );
    expect(output.setup).toBeUndefined();
  });

  it("gives the setup from the installation of the process and the workspace", async () => {
    const entry = await installation();
    const ws = await fixture();
    const output = await run(ws.root, { client: "other" });
    expect(output.client).toBe("other");
    expect(output.server).toEqual({
      command: process.execPath,
      args: [entry, "mcp", "--workspace", ws.root],
      env: {},
    });
    expect(output.answer).toBe(
      'Add this entry to your client\'s MCP configuration to connect it to the workspace "Weather station".',
    );
    expect(Object.keys(output)).toEqual(["answer", "client", "server", "setup", "valid", "next"]);
  });

  it("keeps its answer on one line for a workspace name with a line break (SR-224 AK1)", async () => {
    await installation();
    const ws = await fixture();
    const file = path.join(ws.root, "reqseq-workspace.yaml");
    await fs.writeFile(
      file,
      (await fs.readFile(file, "utf8")).replace("name: Weather station", 'name: "Weather\\nstation"'),
    );
    expect((await run(ws.root, { client: "other" })).answer).toBe(
      'Add this entry to your client\'s MCP configuration to connect it to the workspace "Weather station".',
    );
  });

  it("refuses without the command line's entry", async () => {
    const ws = await fixture();
    setInstallation({ runtime: process.execPath, entry: path.join(ws.root, "missing.js"), electron: false });
    expect((await failure(run(ws.root, { client: "other" }))).code).toBe("agent.cli-missing");
    setInstallation({ runtime: process.execPath, entry: ws.root, electron: false });
    expect((await failure(run(ws.root, { client: "other" }))).code).toBe("agent.cli-missing");
    // A process without a script (a REPL) stands for no installation.
    setInstallation(undefined);
    const argv = process.argv;
    process.argv = [process.execPath];
    onTestFinished(() => {
      process.argv = argv;
    });
    expect((await failure(run(ws.root, { client: "other" }))).code).toBe("agent.cli-missing");
  });

  it("refuses for the app macOS runs from a translocated place", async () => {
    const top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-connect-agent-")));
    onTestFinished(() => fs.rm(top, { recursive: true, force: true }));
    const resources = path.join(top, "AppTranslocation", "d", "ReqSeq.app", "Contents", "Resources");
    await fs.mkdir(path.join(resources, "cli", "dist"), { recursive: true });
    await fs.mkdir(path.join(resources, "bin"));
    await fs.writeFile(path.join(resources, "cli", "dist", "bin.js"), "");
    await fs.writeFile(path.join(resources, "bin", "reqseq"), "");
    setInstallation({
      runtime: path.join(resources, "..", "MacOS", "ReqSeq"),
      entry: path.join(resources, "cli", "dist", "bin.js"),
      electron: true,
    });
    const ws = await fixture();
    platform("darwin");
    const error = await failure(run(ws.root, { client: "claude-code" }));
    expect(error.code).toBe("agent.app-translocated");
  });
});
