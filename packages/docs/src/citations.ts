// The spec IDs the docs cite (#1307): a guide page or a schema text that cites an SR, need or decision of
// ReqSeq's own spec (`D-045`, `SR-018 AK2`) fails the build when that element is not in spec/, has a status the
// metamodel marks invalid (obsolete, superseded), or has fewer acceptance criteria than the AK cited. Whether
// the element says what it is cited for still needs a reviewer (`merge` skill). The schema texts are the
// sources the reference is generated from, before `userTexts` takes the citations out (scripts/contracts).
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { CommandRuntime } from "@reqseq/core";
import { Workspace } from "@reqseq/core";
import YAML from "yaml";

/** What a citation is checked against: whether the element's status is invalid, and its number of AKs. */
export interface SpecEntry {
  readonly invalid: boolean;
  readonly criteria: number;
}

/** The elements of the spec by their spec ID in upper case. */
export type SpecIndex = ReadonlyMap<string, SpecEntry>;

/** A text that may cite spec IDs, with the file it comes from relative to the repository. */
export interface CitedText {
  readonly source: string;
  readonly text: string;
}

/** One citation: a spec ID, and the AKs named right after it (`SR-061 AK4, AK5`). */
export interface Citation {
  readonly id: string;
  readonly criteria: readonly number[];
}

/** The keys of a schema or catalog file whose texts reach a reader: those of `userTexts`, and the code texts. */
export const TEXT_KEYS: ReadonlySet<string> = new Set([
  "description",
  "summary",
  "details",
  "title",
  "cause",
  "remedy",
]);

/** The folders of `schemas/` that hold no texts of the reference: derived files and example data. */
const SKIPPED: readonly string[] = ["generated", "examples"];

const CITATION = /\b((?:SR|N|D)-\d{3})\b((?:\s+|\/)AK\d+(?:\s*(?:,|and)\s*AK\d+)*)?/g;

/** The spec IDs `text` cites, in order. */
export function citations(text: string): Citation[] {
  return [...text.matchAll(CITATION)].map((match) => ({
    id: String(match[1]),
    criteria: [...(match[2] ?? "").matchAll(/AK(\d+)/g)].map((ak) => Number(ak[1])),
  }));
}

/** Every citation in `texts` that is not in `spec` as a valid element with the AKs named, one line each. */
export function citationProblems(texts: readonly CitedText[], spec: SpecIndex): string[] {
  const problems = new Set<string>();
  for (const { source, text } of texts) {
    for (const { id, criteria } of citations(text)) {
      const entry = spec.get(id.toUpperCase());
      if (entry === undefined) {
        problems.add(`${source}: ${id} is not in spec/`);
        continue;
      }
      if (entry.invalid) {
        problems.add(`${source}: ${id} is obsolete or superseded`);
      }
      for (const ak of criteria.filter((n) => n < 1 || n > entry.criteria)) {
        problems.add(`${source}: ${id} has no AK${String(ak)} (it has ${String(entry.criteria)})`);
      }
    }
  }
  return [...problems];
}

/** The texts under a key of `TEXT_KEYS` in a parsed file, at any depth. */
export function schemaTexts(node: unknown): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(schemaTexts);
  }
  if (node !== null && typeof node === "object") {
    return Object.entries(node).flatMap(([key, value]) =>
      typeof value === "string" && TEXT_KEYS.has(key) ? [value] : schemaTexts(value),
    );
  }
  return [];
}

/** The texts of the JSON and YAML files below `<repoRoot>/schemas/`, without its generated files and examples. */
export async function readSchemaTexts(repoRoot: string): Promise<CitedText[]> {
  const folder = join(repoRoot, "schemas");
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(json|yaml)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !SKIPPED.some((dir) => relative(folder, file).startsWith(`${dir}${sep}`)))
    .sort();
  const texts: CitedText[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const parsed: unknown = file.endsWith(".json")
      ? JSON.parse(content)
      : YAML.parse(content, { version: "1.2", schema: "core" });
    const source = relative(repoRoot, file).split(sep).join("/");
    texts.push(...schemaTexts(parsed).map((text) => ({ source, text })));
  }
  return texts;
}

interface ListedElement {
  readonly identifier?: string;
  readonly status?: string;
  readonly properties?: { readonly "acceptance-criteria"?: unknown };
}

/** The elements of the workspace at `specRoot` by spec ID, read through the commands, `pageSize` at a time. */
export async function readSpecIndex(
  runtime: CommandRuntime,
  specRoot: string,
  pageSize = 5000,
): Promise<SpecIndex> {
  const workspace = new Workspace(specRoot);
  try {
    const model = (await runtime.invoke("metamodel.get", {}, { workspace })) as {
      statuses: readonly { key: string; invalid?: boolean }[];
    };
    const invalid = new Set(model.statuses.filter((s) => s.invalid === true).map((s) => s.key));
    const index = new Map<string, SpecEntry>();
    for (let offset = 0; ; offset += pageSize) {
      const page = (await runtime.invoke("element.list", { limit: pageSize, offset }, { workspace })) as {
        elements: readonly ListedElement[];
        total: number;
      };
      for (const element of page.elements) {
        if (element.identifier === undefined) {
          continue;
        }
        const criteria = element.properties?.["acceptance-criteria"];
        index.set(element.identifier.toUpperCase(), {
          invalid: element.status !== undefined && invalid.has(element.status),
          criteria: Array.isArray(criteria) ? criteria.length : 0,
        });
      }
      if (offset + pageSize >= page.total) {
        return index;
      }
    }
  } finally {
    await workspace.close();
  }
}

/** Throws with every citation of `texts` that `spec` does not hold as a valid element. */
export function checkCitations(texts: readonly CitedText[], spec: SpecIndex): void {
  const problems = citationProblems(texts, spec);
  if (problems.length > 0) {
    throw new Error(
      `docs: cite only spec IDs that are in spec/ and valid, with AKs they have:\n${problems.join("\n")}`,
    );
  }
}
