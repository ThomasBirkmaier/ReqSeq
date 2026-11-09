import { contractsBundle, getCommandRuntime } from "@reqseq/core";
import type { CatalogEntry } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import type { CommandAccess } from "./access.js";
import { commandIndex, commandPage } from "./command-page.js";

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

const page = (command: CatalogEntry, commandAccess: CommandAccess = access): string =>
  commandPage(command, commandAccess, { schemas: contractsBundle.schemas }, 1);

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
    expect(text).toContain("This version does not implement the command yet.");
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
});
