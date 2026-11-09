import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import MiniSearch from "minisearch";

// The search of the documentation site (SR-141 AK1, ADR-0017): the integration in packages/docs/site/astro.config.mjs
// calls writeSearchIndex once the pages are built, and the site's search box (site/src/components/Search.astro)
// fetches the file and searches it with MiniSearch in the browser. The file carries the options it was built with,
// so the browser loads it with the same ones; the site pins the same MiniSearch version as this package.

/** The file of the index, at the root of the built site. */
export const SEARCH_INDEX_FILE = "search-index.json";

/** One page as the search sees it. */
export interface SearchDocument {
  readonly id: number;
  /** The address of the page below the site's base, ending in `/`. */
  readonly url: string;
  readonly title: string;
  /** The texts of its headings below the title, one per line. */
  readonly headings: string;
  /** Its text without markup, the title, the anchor labels and the page footer left out. */
  readonly text: string;
  /** The start of its text, shown under a hit. */
  readonly excerpt: string;
}

/** What the browser needs: the options of MiniSearch and the index as `MiniSearch.toJSON` gives it. */
export interface SearchIndexFile {
  readonly fields: readonly string[];
  readonly storeFields: readonly string[];
  readonly searchOptions: {
    readonly prefix: true;
    readonly fuzzy: number;
    readonly boost: Record<string, number>;
  };
  readonly index: unknown;
}

const FIELDS = ["title", "headings", "text"] as const;
const STORE_FIELDS = ["title", "url", "excerpt"] as const;
const SEARCH_OPTIONS = { prefix: true, fuzzy: 0.2, boost: { title: 3, headings: 2 } } as const;
const EXCERPT_LENGTH = 160;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Text of an HTML fragment: tags removed, entities decoded, white space collapsed. */
export function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
      if (name.startsWith("#")) {
        const code =
          name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The search document of a built Starlight page (`html`) at `url`, or undefined for a page without `<main>` or
 * title. The text is the content of `<main>` without scripts, styles, icons, the screen-reader labels of the
 * heading anchors and the footer with the links to the previous and next page.
 */
export function pageDocument(html: string, url: string, id: number): SearchDocument | undefined {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1];
  const title = main === undefined ? undefined : /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(main)?.[1];
  if (main === undefined || title === undefined) {
    return undefined;
  }
  const body = main
    .replace(/<(script|style|svg|footer)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<span class="sr-only"[^>]*>[\s\S]*?<\/span>/g, " ")
    .replace(/<h1\b[\s\S]*?<\/h1>/, " ");
  const headings = [...body.matchAll(/<h[2-6]\b[^>]*>([\s\S]*?)<\/h[2-6]>/g)].map((m) =>
    htmlText(String(m[1])),
  );
  const text = htmlText(body);
  return {
    id,
    url,
    title: htmlText(title),
    headings: headings.join("\n"),
    text,
    excerpt: text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text,
  };
}

/** The index of `documents`, with the options the browser loads it with. */
export function searchIndex(documents: readonly SearchDocument[]): SearchIndexFile {
  const search = new MiniSearch<SearchDocument>({ fields: [...FIELDS], storeFields: [...STORE_FIELDS] });
  search.addAll(documents);
  return { fields: FIELDS, storeFields: STORE_FIELDS, searchOptions: SEARCH_OPTIONS, index: search.toJSON() };
}

/** The search over a loaded index file, as the site's search box runs it. */
export function loadSearch(file: SearchIndexFile): (term: string) => { url: string; title: string }[] {
  const search = MiniSearch.loadJS<SearchDocument>(file.index as Parameters<typeof MiniSearch.loadJS>[0], {
    fields: [...file.fields],
    storeFields: [...file.storeFields],
  });
  return (term) =>
    search
      .search(term, { ...file.searchOptions, boost: { ...file.searchOptions.boost } })
      .map((hit) => ({ url: String(hit["url"]), title: String(hit["title"]) }));
}

/**
 * Writes `SEARCH_INDEX_FILE` into the built site `dist`: one document per page (`index.html` of each folder; the
 * 404 page is left out), its address below `base`. Gives the number of pages.
 */
export async function writeSearchIndex(dist: string, base: string): Promise<number> {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const pages = (await readdir(dist, { recursive: true }))
    .filter((file) => file === "index.html" || file.endsWith(`${sep}index.html`))
    .sort();
  const documents: SearchDocument[] = [];
  for (const file of pages) {
    const folder = dirname(file);
    const url = folder === "." ? prefix : `${prefix}${folder.split(sep).join("/")}/`;
    const document = pageDocument(await readFile(join(dist, file), "utf8"), url, documents.length);
    if (document !== undefined) {
      documents.push(document);
    }
  }
  await writeFile(join(dist, SEARCH_INDEX_FILE), JSON.stringify(searchIndex(documents)));
  return documents.length;
}
