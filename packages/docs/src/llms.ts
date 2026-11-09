import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

// The documentation as plain text for AI assistants (llmstxt.org): `llms.txt`, an index with one line per page, and
// `llms-full.txt`, every page as Markdown. The integration in packages/docs/site/astro.config.mjs writes both into
// the built site from the content folder, so they hold the same pages as the site and ship offline too (ADR-0017).

/** The index file at the root of the built site. */
export const LLMS_FILE = "llms.txt";
/** The file with every page at the root of the built site. */
export const LLMS_FULL_FILE = "llms-full.txt";

/** A page of the content folder as the files show it. */
export interface TextPage {
  /** Its path in the content folder, with `/`. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
  /** Its place in its sidebar group. */
  readonly order: number;
  /** Its Markdown without the front matter. */
  readonly body: string;
}

/** The groups of the files, in the order of the sidebar (site/astro.config.mjs), by the start of a page's path. */
export const LLMS_SECTIONS: readonly (readonly [string, string])[] = [
  ["start/", "Get started"],
  ["how-to/", "How-to"],
  ["concepts/", "Concepts"],
  ["reference/commands/", "Commands"],
  ["reference/problem-codes", "Problem and error codes"],
  ["reference/formats/", "File formats"],
  ["reference/common-types", "Common types"],
  ["reference/standard-model", "Standard model"],
  ["reference/keyboard-shortcuts", "Keyboard shortcuts"],
];

const FRONT_MATTER = /^---\r?\n([^]*?)\r?\n---\r?\n/;

/** A Markdown page at `path` with its front matter read. Fails on a page without a title. */
export function textPage(path: string, text: string): TextPage {
  const match = FRONT_MATTER.exec(text);
  const data = (parse(match?.[1] ?? "") ?? {}) as {
    title?: unknown;
    description?: unknown;
    sidebar?: { order?: unknown };
  };
  if (match === null || typeof data.title !== "string") {
    throw new Error(`${path}: no title in the front matter`);
  }
  return {
    path,
    title: data.title,
    description: typeof data.description === "string" ? data.description : "",
    order: typeof data.sidebar?.order === "number" ? data.sidebar.order : 0,
    body: text.slice(match[0].length).replace(/\r\n/g, "\n").trim(),
  };
}

/** The address of a page below `base`: `how-to/install-reqseq.md` → `/ReqSeq/how-to/install-reqseq/`. */
export function pageUrl(path: string, base: string): string {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const page = path.replace(/\.md$/, "").replace(/(^|\/)index$/, "");
  return page === "" ? prefix : `${prefix}${page}/`;
}

/** The pages of each section, sorted as in the sidebar; the landing page and pages of no section are left out. */
function sections(pages: readonly TextPage[]): (readonly [string, TextPage[]])[] {
  return LLMS_SECTIONS.map(([start, label]) => [
    label,
    pages
      .filter((page) => page.path.startsWith(start))
      .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path)),
  ]);
}

const landing = (pages: readonly TextPage[]): TextPage | undefined =>
  pages.find((page) => page.path === "index.md");

/** `llms.txt`: the site's title, the landing page's description, and one linked line per page by section. */
export function llmsIndex(pages: readonly TextPage[], base: string, title: string): string {
  const home = landing(pages);
  const lines = [`# ${title}`, ""];
  if (home !== undefined && home.description !== "") {
    lines.push(`> ${home.description}`, "");
  }
  lines.push(
    `All pages as Markdown in one file: [${LLMS_FULL_FILE}](${pageUrl("", base)}${LLMS_FULL_FILE}).`,
    "",
  );
  for (const [label, members] of sections(pages)) {
    if (members.length > 0) {
      lines.push(`## ${label}`, "");
      for (const page of members) {
        const description = page.description === "" ? "" : `: ${page.description}`;
        lines.push(`- [${page.title}](${pageUrl(page.path, base)})${description}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** `llms-full.txt`: the landing page and then every page of `llms.txt`, each under its title and address. */
export function llmsFull(pages: readonly TextPage[], base: string, title: string): string {
  const home = landing(pages);
  const ordered = [
    ...(home === undefined ? [] : [home]),
    ...sections(pages).flatMap(([, members]) => members),
  ];
  return [
    `# ${title}`,
    "",
    ...ordered.flatMap((page) => [
      `# ${page.title}`,
      "",
      `Page: ${pageUrl(page.path, base)}`,
      "",
      page.body,
      "",
    ]),
  ].join("\n");
}

/**
 * Writes `LLMS_FILE` and `LLMS_FULL_FILE` into the built site `dist` from the Markdown pages of the content folder
 * `contentDir`, with addresses below `base`. Gives the number of pages in `llms.txt`.
 */
export async function writeLlmsFiles(
  contentDir: string,
  dist: string,
  base: string,
  title: string,
): Promise<number> {
  const files = (await readdir(contentDir, { recursive: true }))
    .map((file) => file.split(/[\\/]/).join("/"))
    .filter((file) => file.endsWith(".md"))
    .sort();
  const pages: TextPage[] = [];
  for (const file of files) {
    pages.push(textPage(file, await readFile(join(contentDir, ...file.split("/")), "utf8")));
  }
  await writeFile(join(dist, LLMS_FILE), llmsIndex(pages, base, title));
  await writeFile(join(dist, LLMS_FULL_FILE), llmsFull(pages, base, title));
  return sections(pages).reduce((count, [, members]) => count + members.length, 0);
}
