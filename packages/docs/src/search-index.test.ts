import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchIndexFile } from "./search-index.js";
import {
  SEARCH_INDEX_FILE,
  htmlText,
  loadSearch,
  pageDocument,
  searchIndex,
  writeSearchIndex,
} from "./search-index.js";

const page = (title: string, body: string): string =>
  `<html><head><title>${title} | Tool 1.0.0</title><script>var x = "head";</script></head><body>` +
  `<header>Search</header><main data-x><div><h1 id="_top">${title}</h1></div>` +
  `<div class="sl-markdown-content">${body}</div>` +
  `<footer><a href="/prev/">Previous page</a></footer></main></body></html>`;

const BASELINE = page(
  "List baselines",
  `<p>Lists the frozen states of the workspace &amp; their dates.</p>` +
    `<div class="sl-heading-wrapper"><h2 id="input">Input</h2><a class="sl-anchor-link" href="#input">` +
    `<span aria-hidden="true"><svg><path d="m1"></path></svg></span><span class="sr-only">Section titled “Input”</span></a></div>` +
    `<script>var hidden = "scriptword";</script><style>.x{color:red}</style><p>Snapshot &#x2014; &#8212; &bogus; &#0;</p>`,
);

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((f) => rm(f, { recursive: true, force: true })));
});

describe("search index of the documentation site (SR-141 AK1)", () => {
  it("reads title, headings and text of a page without markup, scripts, anchor labels and footer", () => {
    expect(pageDocument(BASELINE, "/reference/baseline-list/", 3)).toEqual({
      id: 3,
      url: "/reference/baseline-list/",
      title: "List baselines",
      headings: "Input",
      text: "Lists the frozen states of the workspace & their dates. Input Snapshot — — &bogus; &#0;",
      excerpt: "Lists the frozen states of the workspace & their dates. Input Snapshot — — &bogus; &#0;",
    });
    expect(pageDocument("<html><body>no main</body></html>", "/", 0)).toBeUndefined();
    expect(pageDocument("<main><p>no title</p></main>", "/", 0)).toBeUndefined();
    const long = pageDocument(page("Long", `<p>${"word ".repeat(100)}</p>`), "/long/", 0);
    expect(long?.excerpt).toBe(`${"word ".repeat(32).trimEnd()}…`);
  });

  it("decodes named and numeric entities and keeps unknown ones", () => {
    expect(htmlText("<b>a&nbsp;&lt;b&gt;</b>  &QUOT;c&apos; &#65;&#X42;")).toBe("a <b> \"c' AB");
  });

  it("finds a page by a word of its body, and by a prefix of its title", () => {
    const other = pageDocument(page("Create element", "<p>Writes a new element file.</p>"), "/create/", 1);
    const known = pageDocument(BASELINE, "/baselines/", 0);
    if (known === undefined || other === undefined) {
      throw new Error("fixture pages have no document");
    }
    const file = JSON.parse(JSON.stringify(searchIndex([known, other]))) as SearchIndexFile;
    const search = loadSearch(file);
    expect(search("frozen")).toEqual([{ url: "/baselines/", title: "List baselines" }]);
    expect(search("creat")[0]).toEqual({ url: "/create/", title: "Create element" });
    expect(search("scriptword")).toEqual([]);
    expect(search("previous")).toEqual([]);
  });

  it("writes the index of every page of a built site below its base, without the 404 page", async () => {
    const dist = await mkdtemp(join(tmpdir(), "search-index-"));
    folders.push(dist);
    await mkdir(join(dist, "reference", "baseline-list"), { recursive: true });
    await writeFile(join(dist, "index.html"), page("Overview", "<p>Start here.</p>"));
    await writeFile(join(dist, "reference", "baseline-list", "index.html"), BASELINE);
    await writeFile(join(dist, "reference", "index.html"), "<html><body>redirect</body></html>");
    await writeFile(join(dist, "404.html"), page("Not found", "<p>missing</p>"));
    expect(await writeSearchIndex(dist, "/ReqSeq")).toBe(2);
    const search = loadSearch(
      JSON.parse(await readFile(join(dist, SEARCH_INDEX_FILE), "utf8")) as SearchIndexFile,
    );
    expect(search("frozen")).toEqual([{ url: "/ReqSeq/reference/baseline-list/", title: "List baselines" }]);
    expect(search("start")).toEqual([{ url: "/ReqSeq/", title: "Overview" }]);
    expect(search("missing")).toEqual([]);
    expect(await writeSearchIndex(dist, "/")).toBe(2);
    expect(
      loadSearch(JSON.parse(await readFile(join(dist, SEARCH_INDEX_FILE), "utf8")) as SearchIndexFile)(
        "frozen",
      )[0]?.url,
    ).toBe("/reference/baseline-list/");
  });
});
