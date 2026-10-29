// The generated reference (SR-139): the pages written next to the hand-written ones in the content folder.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandRuntime } from "@reqseq/core";
import type { GeneratedContracts } from "./access.js";
import { commandAccess } from "./access.js";
import type { ProblemCodes } from "./codes.js";
import { CODES_PAGE, codesPage } from "./codes.js";
import { COMMANDS_FOLDER, commandIndex, commandPage, commandSlug } from "./command-page.js";

/** A page of the content folder: its path relative to it, with `/`, and its Markdown. */
export interface Page {
  readonly path: string;
  readonly text: string;
}

/** `schemas/generated/openapi.json` and `mcp-tools.json` of the repository at `repoRoot`. */
export async function readGeneratedContracts(repoRoot: string): Promise<GeneratedContracts> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(join(repoRoot, "schemas", "generated", file), "utf8")) as unknown;
  return {
    openapi: (await read("openapi.json")) as GeneratedContracts["openapi"],
    mcpTools: (await read("mcp-tools.json")) as GeneratedContracts["mcpTools"],
  };
}

/** The sources of the reference: the catalog (of `runtime`), the generated contracts and the code texts. */
export interface ReferenceSources {
  readonly runtime: CommandRuntime;
  readonly generated: GeneratedContracts;
  readonly codes: ProblemCodes;
}

/** The command index, one page per command of the catalog in its order, and the page of the codes. */
export async function referencePages(
  { runtime, generated, codes }: ReferenceSources,
  base: string,
): Promise<Page[]> {
  const entries = runtime.contracts.commands;
  const pages: Page[] = [
    { path: `${COMMANDS_FOLDER}/index.md`, text: commandIndex(entries, base) },
    { path: CODES_PAGE, text: codesPage(codes) },
  ];
  for (const [index, entry] of entries.entries()) {
    const access = await commandAccess(entry, runtime, generated);
    pages.push({
      path: `${COMMANDS_FOLDER}/${commandSlug(entry.name)}.md`,
      text: commandPage(entry, access, runtime.contracts.schemas, index + 1),
    });
  }
  return pages;
}
