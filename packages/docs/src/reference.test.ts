import { fileURLToPath } from "node:url";
import { appCommandEntry } from "@reqseq/app";
import { contractsBundle, createCommandRuntime, getCommandRuntime, loadContracts } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { commandSlug } from "./command-page.js";
import { inline } from "./markdown.js";
import { codeAnchor, readProblemCodes } from "./codes.js";
import { FORMATS, headingSlug, readExamples, schemaName } from "./formats.js";
import { readGeneratedContracts, referencePages } from "./reference.js";
import { modelAnchor, readStandardModel } from "./standard-model.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The text below `## heading` up to the next heading. */
const section = (page: string, heading: string): string =>
  (page.split(`\n## ${heading}\n`)[1] ?? "").split("\n## ")[0]?.trim() ?? "";

const pageOf = (pages: readonly { path: string; text: string }[], name: string): string =>
  pages.find((page) => page.path === `reference/commands/${commandSlug(name)}.md`)?.text ?? "";

const sources = async (runtime: ReturnType<typeof getCommandRuntime>) => ({
  runtime,
  generated: await readGeneratedContracts(repoRoot),
  codes: await readProblemCodes(repoRoot),
  schemas: runtime.contracts.schemas,
  examples: await readExamples(repoRoot),
  standardModel: await readStandardModel(repoRoot),
});

/** A definition's heading, with its own anchor where the heading's id differs from the name: never both. */
const anchored = (name: string): RegExp =>
  headingSlug(name) === name
    ? new RegExp(`(?<!<a id="${name}"></a>\\n\\n)### \`${name}\``)
    : new RegExp(`<a id="${name}"></a>\\n\\n### \`${name}\``);

const pageAt = (pages: readonly { path: string; text: string }[], path: string): string =>
  pages.find((page) => page.path === path)?.text ?? "";

const codesOf = (pages: readonly { path: string; text: string }[]): string =>
  pages.find((page) => page.path === "reference/problem-codes.md")?.text ?? "";

describe("reference", () => {
  it("[SR-139/AK1] gives every command a page with title, summary, input, output and its call in app, CLI, API and MCP", async () => {
    const runtime = getCommandRuntime();
    const pages = await referencePages(await sources(runtime), "/ReqSeq");
    expect(pages).toHaveLength(runtime.contracts.commands.length + 2 + FORMATS.length + 4);
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

  it("[SR-139/AK2] gives every problem code and every error code its cause and remedy", async () => {
    const pages = await referencePages(await sources(getCommandRuntime()), "/ReqSeq");
    const page = codesOf(pages);
    const common = contractsBundle.schemas.find((schema) =>
      String(schema["$id"]).endsWith("/common.schema.json"),
    );
    const defs = common?.["$defs"] as {
      problemCode: { enum: string[] };
      error: { properties: { code: { enum: string[] } } };
    };
    const kinds = [
      ["problem", defs.problemCode.enum],
      ["error", defs.error.properties.code.enum],
    ] as const;
    expect(kinds[0][1].length + kinds[1][1].length).toBeGreaterThanOrEqual(67);
    for (const [kind, codes] of kinds) {
      for (const code of codes) {
        const entry = page.split(`<a id="${codeAnchor(code, kind)}"></a>\n\n### \`${code}\`\n\n`)[1] ?? "";
        expect(entry, code).toMatch(/^\*\*Cause:\*\* \S[^\n]*\n\n\*\*Remedy:\*\* \S/);
      }
    }
    expect(pages[0]?.text).toContain("](/ReqSeq/reference/problem-codes/)");
  });

  it("[SR-139/AK3] describes every file format with its fields, definitions and examples, and every part of the standard model", async () => {
    const runtime = getCommandRuntime();
    const pages = await referencePages(await sources(runtime), "/ReqSeq");
    const examples = await readExamples(repoRoot);
    for (const name of FORMATS) {
      const schema = runtime.contracts.schemas.find((candidate) => schemaName(candidate) === name) ?? {};
      const page = pageAt(pages, `reference/formats/${name}.md`);
      expect(page, name).toContain(`title: ${JSON.stringify(schema["title"])}`);
      expect(page, name).toContain(`\n${inline(String(schema["description"]))}\n`);
      for (const field of Object.keys(schema["properties"] ?? {})) {
        expect(page, `${name}.${field}`).toContain(`| \`${field}\` |`);
      }
      for (const definition of Object.keys(schema["$defs"] ?? {})) {
        expect(page, `${name}#${definition}`).toMatch(anchored(definition));
      }
      for (const example of examples[name] ?? []) {
        expect(page, example.file).toContain(`### \`${example.file}\``);
      }
    }
    const common = runtime.contracts.schemas.find((schema) => schemaName(schema) === "common") ?? {};
    for (const definition of Object.keys(common["$defs"] ?? {})) {
      expect(pageAt(pages, "reference/common-types.md")).toMatch(anchored(definition));
    }
    expect(pageOf(pages, "element.get")).toContain(
      "[`elementRef`](/ReqSeq/reference/common-types/#elementRef)",
    );
    const model = await readStandardModel(repoRoot);
    const modelPage = pageAt(pages, "reference/standard-model.md");
    const parts = [
      ["type", model.types],
      ["property", model.properties],
      ["relation", model.relations],
      ["status", model.statuses],
    ] as const;
    for (const [part, items] of parts) {
      expect(items.length, part).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.description, `${part} ${item.key}`).toMatch(/\S/);
        expect(modelPage, `${part} ${item.key}`).toContain(
          `<a id="${modelAnchor(part, item.key)}"></a>\n\n### ${inline(item.name)} (\`${item.key}\`)\n\n${inline(item.description ?? "")}\n`,
        );
      }
    }
  });

  it("[SR-139/AK4] shows a changed summary of a command and a changed remedy of a code, a changed format description and a changed standard model description without a page changed by hand", async () => {
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
    const codes = await readProblemCodes(repoRoot);
    const remedy = "A changed remedy of <ref>.";
    const changedCodes = {
      ...codes,
      problems: { ...codes.problems, "relation.outdated": { cause: "Unchanged.", remedy } },
    };
    const format = "A changed description of the workspace file.";
    const schemas = runtime.contracts.schemas.map((schema) =>
      schemaName(schema) === "workspace" ? { ...schema, description: format } : schema,
    );
    const model = await readStandardModel(repoRoot);
    const description = "A changed description of the status <draft>.";
    const standardModel = {
      ...model,
      statuses: model.statuses.map((status) =>
        status.initial === true ? { ...status, description } : status,
      ),
    };
    const pages = await referencePages(
      { ...(await sources(runtime)), codes: changedCodes, schemas, examples: {}, standardModel },
      "/",
    );
    expect(pageAt(pages, "reference/standard-model.md")).toContain(`\n${inline(description)}\n`);
    expect(pageAt(pages, "reference/formats/workspace.md")).toContain(`\n${format}\n`);
    const page = pageOf(pages, "element.get");
    expect(page).toContain(`\n${inline(changed)}\n`);
    expect(codesOf(pages)).toContain(
      `### \`relation.outdated\`\n\n**Cause:** Unchanged.\n\n**Remedy:** ${inline(remedy)}\n`,
    );
    expect(section(page, "CLI")).toContain(changed);
    expect(pages[0]?.text).toContain(`](/reference/commands/element-get/): ${inline(changed)}`);
  });
});
