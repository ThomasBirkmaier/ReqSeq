// The agent guide (SR-229, tool.guide) on this command line: printed as Markdown, and its calls parse: each command-line call of
// the guide with `names: cli` gives the command the same input as the same call of the guide with
// `names: mcp`, which shows that input as JSON. Core writes both forms from one call (commands/tool/guide/calls.ts there).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { CommandName, CommandRuntime } from "@reqseq/core";
import {
  Workspace,
  createCommandRuntime,
  defineTestCommand,
  getCommandRuntime,
  loadContracts,
} from "@reqseq/core";
import { describe, expect, it, onTestFinished } from "vitest";
import { runCli } from "./main.js";

const guideOf = async (root: string, names: "cli" | "mcp"): Promise<string> => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  const output = await getCommandRuntime().invoke("tool.guide", { names }, { workspace });
  return (output as { guide: string }).guide;
};

/** The words of a shell command line in single quotes or without quotes, as the guide writes them. */
const shellWords = (line: string): string[] =>
  [...line.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) =>
    m[1] === undefined ? (m[2] ?? "") : m[1].replaceAll("'\\''", "'"),
  );

const sink = (): { write: (text: string) => boolean } => ({ write: () => true });

/**
 * Runs each command-line call of `cli` on this command line and each call of `mcp` through the runtime, with
 * commands that only record their input, and expects the same commands with the same inputs.
 */
const sameCalls = async (
  root: string,
  cli: readonly string[],
  mcp: readonly { command: CommandName; input: object }[],
): Promise<void> => {
  const received: { command: string; input: unknown }[] = [];
  const contracts = loadContracts();
  const runtime = createCommandRuntime({
    contracts,
    validateOutput: false,
    commands: [...new Set(mcp.map((call) => call.command))].map((name) =>
      defineTestCommand({
        name,
        run: (_ctx, input: unknown) => {
          received.push({ command: name, input });
          return Promise.resolve({});
        },
      }),
    ),
  });
  for (const line of cli) {
    await runCli({
      argv: shellWords(line).slice(1),
      cwd: root,
      stdin: Readable.from([]),
      stdout: sink(),
      stderr: sink(),
      runtime,
    });
  }
  const fromCli = received.splice(0);
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  for (const call of mcp) {
    await runtime.invoke(call.command, call.input, { workspace, access: "mcp" });
  }
  // The command line passes a local path absolute, resolved against its current folder (ADR-0009).
  const absolute = (value: unknown): unknown =>
    Object.fromEntries(
      Object.entries(value as object).map(([key, item]) => [
        key,
        typeof item === "string" && /<junit\.xml>|<run>\.xml/.test(item) ? path.resolve(root, item) : item,
      ]),
    );
  expect(fromCli).toEqual(received.map((call) => ({ command: call.command, input: absolute(call.input) })));
};

describe("the command-line calls of the agent guide", () => {
  it("give each command the input that the MCP form of the guide names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-guide-cli-"));
    onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
    const init = new Workspace(root);
    await getCommandRuntime().invoke("workspace.init", { path: root, name: "Station" }, { workspace: init });
    await init.close();
    await fs.appendFile(
      path.join(root, "reqseq-workspace.yaml"),
      "evidence:\n  - { repository: main, path: evidence }\n",
    );
    const steps = (text: string): string => text.slice(0, text.indexOf("## In a pipeline"));
    const cli = [...steps(await guideOf(root, "cli")).matchAll(/`(reqseq [^`]+)`/g)].map((m) => m[1] ?? "");
    const mcp = [
      ...steps(await guideOf(root, "mcp")).matchAll(/`([a-z]+)_([A-Za-z]+)`(?: with `([^`]+)`)?/g),
    ].map((m) => ({
      command: `${m[1] ?? ""}.${m[2] ?? ""}` as CommandName,
      input: JSON.parse(m[3] ?? "{}") as object,
    }));
    expect(cli.length).toBe(mcp.length);
    expect(cli.length).toBeGreaterThan(8);

    await sameCalls(root, cli, mcp);
  });

  it("[SR-229/AK-j7mz] give each command of the skill file the input its MCP form names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-skill-cli-"));
    onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
    const workspace = new Workspace(root);
    onTestFinished(() => workspace.close());
    const output = await getCommandRuntime().invoke("tool.guide", { skill: true }, { workspace });
    const skill = (output as { guide: string }).guide;
    const pairs = [...skill.matchAll(/`([a-z]+)_([A-Za-z]+)`(?: with `([^`]+)`)? or `(reqseq [^`]+)`/g)];
    expect(pairs.length).toBeGreaterThan(15);
    // The skill names no metamodel, so its calls hold placeholders such as `<type>` that no input schema
    // takes: the command line only parses them here, into a runtime that records each input unchecked.
    const received: { command: string; input: unknown }[] = [];
    const recording = {
      ...getCommandRuntime(),
      invoke: (command: string, input: unknown) => {
        received.push({ command, input });
        return Promise.resolve({});
      },
    } as CommandRuntime;
    for (const m of pairs) {
      await runCli({
        argv: shellWords(m[4] ?? "").slice(1),
        cwd: root,
        stdin: Readable.from([]),
        stdout: sink(),
        stderr: sink(),
        runtime: recording,
      });
    }
    const absolute = (input: object): object =>
      Object.fromEntries(
        Object.entries(input).map(([key, item]) => [
          key,
          typeof item === "string" && /<junit\.xml>|<run>\.xml/.test(item) ? path.resolve(root, item) : item,
        ]),
      );
    expect(received).toEqual(
      pairs.map((m) => ({
        command: `${m[1] ?? ""}.${m[2] ?? ""}`,
        input: absolute(JSON.parse(m[3] ?? "{}") as object),
      })),
    );
  });

  it("prints the guide as Markdown, unchanged, as --json gives it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-guide-text-"));
    onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
    const run = async (argv: string[]): Promise<string> => {
      let text = "";
      await runCli({
        argv,
        cwd: root,
        stdin: Readable.from([]),
        stdout: { write: (chunk: string) => ((text += chunk), true) },
        stderr: sink(),
      });
      return text;
    };
    const json = JSON.parse(await run(["tool", "guide", "--json"])) as { guide: string };
    expect(json.guide.startsWith("# Working with ReqSeq\n")).toBe(true);
    expect(await run(["tool", "guide"])).toBe(json.guide);
  });
});
