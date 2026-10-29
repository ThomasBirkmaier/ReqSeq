import { fileURLToPath } from "node:url";
import { appCommandEntry } from "@reqseq/app";
import { contractsBundle, createCommandRuntime, getCommandRuntime, loadContracts } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { commandSlug } from "./command-page.js";
import { inline } from "./markdown.js";
import { commandReference, readGeneratedContracts } from "./reference.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The text below `## heading` up to the next heading. */
const section = (page: string, heading: string): string =>
  (page.split(`\n## ${heading}\n`)[1] ?? "").split("\n## ")[0]?.trim() ?? "";

const pageOf = (pages: readonly { path: string; text: string }[], name: string): string =>
  pages.find((page) => page.path === `reference/commands/${commandSlug(name)}.md`)?.text ?? "";

describe("command reference", () => {
  it("[SR-139/AK1] gives every command a page with title, summary, input, output and its call in app, CLI, API and MCP", async () => {
    const runtime = getCommandRuntime();
    const pages = await commandReference(runtime, await readGeneratedContracts(repoRoot), "/ReqSeq");
    expect(pages).toHaveLength(runtime.contracts.commands.length + 1);
    expect(runtime.contracts.commands.length).toBeGreaterThanOrEqual(49);
    for (const entry of runtime.contracts.commands) {
      const page = pageOf(pages, entry.name);
      expect(page).toContain(`title: ${JSON.stringify(entry.title)}`);
      expect(page).toContain(`\n${inline(entry.summary)}\n`);
      for (const heading of ["Input", "Output", "App", "CLI", "API", "MCP"]) {
        expect(section(page, heading), `${entry.name}: ${heading}`).not.toBe("");
      }
      expect(section(page, "CLI")).toMatch(/^`reqseq \S+ \S+`[^]*```text\nUsage: reqseq \S+ \S+/);
      if (runtime.commands.has(entry.name)) {
        const app = appCommandEntry(entry, false);
        expect(section(page, "App"), entry.name).toMatch(
          new RegExp(
            `^In the command prompt \\(Ctrl\\+Shift\\+P, macOS .+\\): the ${app.action ? "action" : "command"} \\*\\*`,
          ),
        );
        expect(section(page, "App"), entry.name).toContain(`**${inline(app.name)}**`);
      }
      expect(section(page, "API")).toContain(`POST /v1/commands/${entry.name}`);
      expect(section(page, "MCP")).toContain(`\`${entry.name.replace(".", "_")}\``);
    }
    const index = pages[0]?.text ?? "";
    expect(index).toContain("](/ReqSeq/reference/commands/element-get/): ");
  });

  it("[SR-139/AK4] shows a changed summary of a command without a page changed by hand", async () => {
    const catalog = structuredClone(contractsBundle.catalog) as {
      commands: { name: string; summary: string }[];
    };
    const changed = 'A changed summary of <ref> and {"status":null}.';
    const entry = catalog.commands.find((command) => command.name === "element.get");
    expect(entry).toBeDefined();
    if (entry !== undefined) {
      entry.summary = changed;
    }
    const runtime = createCommandRuntime({ contracts: loadContracts({ catalog }) });
    const pages = await commandReference(runtime, await readGeneratedContracts(repoRoot), "/");
    const page = pageOf(pages, "element.get");
    expect(page).toContain(`\n${inline(changed)}\n`);
    expect(section(page, "CLI")).toContain(changed);
    expect(pages[0]?.text).toContain(`](/reference/commands/element-get/): ${inline(changed)}`);
  });
});
