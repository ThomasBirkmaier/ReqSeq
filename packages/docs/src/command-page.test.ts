import { contractsBundle, getCommandRuntime } from "@reqseq/core";
import type { CatalogEntry } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import type { CommandAccess } from "./access.js";
import type { CommandExample } from "./command-examples.js";
import { FOLDED_OUTPUT_LINES, commandIndex, commandPage } from "./command-page.js";

const entry = (name: string): CatalogEntry => {
  const found = getCommandRuntime().contracts.entry(name);
  if (found === undefined) {
    throw new Error(name);
  }
  return found;
};

const access: CommandAccess = {
  implemented: true,
  app: { name: "Do <it>", action: false },
  appMac: { name: "Do <it>", action: false },
  promptKey: "Ctrl+Shift+P",
  promptKeyMac: "⌘⇧P",
  cliCall: "reqseq x y",
  cliHelp: "Usage: reqseq x y\n",
  apiCall: "POST /v1/commands/x.y",
  mcpTool: "x_y",
};

const page = (
  command: CatalogEntry,
  commandAccess: CommandAccess = access,
  example?: CommandExample | string,
): string => commandPage(command, commandAccess, { schemas: contractsBundle.schemas }, 1, example);

/** The text below `## heading` up to the next heading. */
const section = (text: string, heading: string): string =>
  (text.split(`\n## ${heading}\n`)[1] ?? "").split("\n## ")[0]?.trim() ?? "";

describe("commandPage", () => {
  it("says how a write command behaves while the workspace is read-only", () => {
    const { whileReadOnlyReason: _reason, ...write } = entry("element.create");
    expect(page({ ...write, whileReadOnly: "refuse" })).toContain(
      "never to Git. It is refused while the workspace is read-only.\n",
    );
    expect(page({ ...write, whileReadOnly: "allow", whileReadOnlyReason: "It makes <one>." })).toContain(
      "It also runs while the workspace is read-only. It makes \\<one\\>.\n",
    );
    expect(page(entry("element.get"))).toContain("Reads the workspace and changes no file.");
  });

  it("names the app's command or action, with its key where it has one", () => {
    expect(page(entry("element.get"))).toContain("Ctrl+Shift+P, macOS ⌘⇧P): the command **Do \\<it\\>**.\n");
    const action = { name: "Show graph", action: true, key: "Ctrl+Shift+G" };
    expect(
      page(entry("trace.graph"), { ...access, app: action, appMac: { ...action, key: "⌘⇧G" } }),
    ).toContain("the action **Show graph**. Key: Ctrl+Shift+G (macOS ⌘⇧G).");
  });

  it("marks a command this version does not implement", () => {
    const text = page(entry("element.get"), { ...access, implemented: false });
    expect(text).toContain("This ReqSeq version does not implement the command yet.");
    expect(text).toContain("Not offered by the app yet");
  });

  it("shows the details below the summary, and the index and the page description the summary only (#1252)", () => {
    const command = { ...entry("element.get"), summary: "Gets one.", details: "More about <it>." };
    expect(page(command)).toContain("\nGets one.\n\nMore about \\<it\\>.\n\nCommand `element.get`.");
    expect(page(command)).toContain('description: "Gets one."');
    expect(commandIndex([command], "")).not.toContain("More about");
    const { details: _details, ...plain } = command;
    expect(page(plain)).toContain("\nGets one.\n\nCommand `element.get`.");
  });

  it("says when a command has no input or no output fields", () => {
    const empty = { type: "object", additionalProperties: false } as const;
    const text = page({ ...entry("element.get"), input: empty, output: empty });
    expect(text).toContain("## Input\n\nNo input.");
    expect(text).toContain("## Output\n\nNo output fields.");
  });

  it("shows the example input as JSON, the same call on the command line and the output", () => {
    const example = {
      input: { ref: "SR-c67baa" },
      cli: "reqseq element get SR-c67baa --json",
      output: '{\n  "a": 1\n}',
    };
    expect(section(page(entry("element.get"), access, example), "Example")).toBe(
      [
        "Run in the folder of the weather station, a small example workspace, when this page was built. The input:",
        "",
        "```json",
        "{",
        '  "ref": "SR-c67baa"',
        "}",
        "```",
        "",
        "The same call on the command line:",
        "",
        "```sh",
        "reqseq element get SR-c67baa --json",
        "```",
        "",
        "The output:",
        "",
        "```json",
        "{",
        '  "a": 1',
        "}",
        "```",
        "",
        "The folder of the workspace, the time of the run and new UUIDs are shown as fixed values.",
      ].join("\n"),
    );
  });

  it("folds a long output, and says why a command has no example", () => {
    const output = Array.from({ length: FOLDED_OUTPUT_LINES + 1 }, (_, n) => String(n)).join("\n");
    expect(page(entry("tool.info"), access, { input: {}, cli: "reqseq tool info --json", output })).toContain(
      `<details>\n<summary>The output (${String(FOLDED_OUTPUT_LINES + 1)} lines)</summary>\n\n\`\`\`json\n0\n`,
    );
    expect(section(page(entry("tool.info"), access, "It needs <a> server."), "Example")).toBe(
      "No example: It needs \\<a\\> server.",
    );
    expect(section(page(entry("tool.info")), "Example")).toBe("No example.");
  });
});
