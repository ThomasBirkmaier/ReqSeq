// The user documentation site (ADR-0017). Nothing here loads from the network: no CDN, no analytics, and no fonts but
// the site's own (IBM Plex, src/styles/fonts.css).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import starlight from "@astrojs/starlight";
import { defineConfig, passthroughImageService } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";
// Built by `pnpm docs:generate` (the @reqseq/docs package), which every site build runs first.
import { focusableCodeBlocks } from "../dist/code-focus.js";
import { writeLlmsFiles } from "../dist/llms.js";
import { writeSearchIndex } from "../dist/search-index.js";
import { howToSidebar } from "../dist/sidebar.js";

// The sections of the hand-written pages (D-067), each a folder of docs/guide/. packages/docs/src/assemble.ts
// (GUIDE_SECTIONS) refuses a page outside them and index.md, so no page is left out of the sidebar. A section of one
// page is a plain link, the how-to guides are in the topic groups of packages/docs/src/sidebar.ts (#2191), and a
// section without pages yet is left out rather than shown empty.
const GUIDE_SECTIONS = [
  ["start", "Get started"],
  ["how-to", "How-to"],
  ["concepts", "Concepts"],
];
const pagesOf = (directory) => {
  const folder = new URL(`src/content/docs/${directory}`, import.meta.url);
  return existsSync(folder) ? readdirSync(folder).filter((file) => /\.mdx?$/.test(file)) : [];
};
const guideSection = (directory, label) => {
  const pages = pagesOf(directory);
  if (pages.length === 0) {
    return [];
  }
  if (directory === "how-to") {
    return [{ label, items: howToSidebar(pages) }];
  }
  if (pages.length === 1) {
    // An index page is the folder's own address, as pageUrl of llms.ts has it.
    const name = pages[0].replace(/\.mdx?$/, "");
    return [{ label, slug: name === "index" ? directory : `${directory}/${name}` }];
  }
  return [{ label, items: [{ autogenerate: { directory } }] }];
};

// REQSEQ_DOCS_OFFLINE=1: the build that ships with a delivery (SR-141, ADR-0017), with base `/` and no link to the
// repository. Otherwise `/ReqSeq` for GitHub Pages, or REQSEQ_DOCS_BASE. packages/docs/src/bin.ts has the same rule.
const offline = process.env.REQSEQ_DOCS_OFFLINE === "1";
const base = offline ? "/" : (process.env.REQSEQ_DOCS_BASE ?? "/ReqSeq");
// Every page title names the product and the version the site documents (SR-141 AK1), online too; the staging
// checks the title by the same two values (scripts/package/lib.mjs, offlineSiteProblems).
const readJson = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const { version } = readJson("../../../package.json");
const { productName } = readJson("../../../toolchain/packaging/names.json");
const title = `${productName} ${version}`;
/** A path of public/ under the base. */
const publicPath = (name) => `${base.replace(/\/$/, "")}/${name}`;

export default defineConfig({
  // The address of the Pages site, for its canonical links and sitemap. Left out offline: a delivery's site has no
  // address of its own, so it names none (no canonical link, no sitemap).
  ...(offline ? {} : { site: "https://thomasbirkmaier.github.io" }),
  base,
  // Offline, the scripts get source maps that no page names, so that `stage.mjs --docs-site` can tell each script's
  // packages from them (ADR-0015); it deletes them before the site is staged.
  vite: { build: { sourcemap: offline ? "hidden" : false } },
  // Every stylesheet as a file, never inlined: `reqseq serve docs` allows no inline `<style>` (`style-src 'self'`),
  // and the HTML export takes the docs theme from the linked stylesheets (`docs:export-theme`). The tabs of the four
  // ways in (#2192) move a small rule out of the shared stylesheet, which Astro would otherwise inline.
  build: { inlineStylesheets: "never" },
  // The screenshots of docs/guide/images/ are served as they are: Astro's default service needs Sharp, a native
  // package that the site's install (--ignore-scripts) does not build. A missing image still fails the build.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title,
      description: "User documentation of ReqSeq.",
      // A link only; the site loads nothing from it. Left out offline, where it leads nowhere.
      social: offline
        ? []
        : [{ icon: "github", label: "GitHub", href: "https://github.com/ThomasBirkmaier/ReqSeq" }],
      customCss: ["./src/styles/fonts.css", "./src/styles/theme.css"],
      // A tab stop on each code block, so that a keyboard user can scroll a wide one (#2190).
      expressiveCode: { plugins: [focusableCodeBlocks()] },
      // The search (SR-141 AK1): MiniSearch over search-index.json instead of Pagefind, online and offline.
      pagefind: false,
      components: { Search: "./src/components/Search.astro" },
      // The icons of the app (#410), from toolchain/packaging/icon/icon.svg (scripts/icon/generate.mjs).
      favicon: "/favicon.svg",
      head: [
        { tag: "link", attrs: { rel: "icon", href: publicPath("favicon.ico"), sizes: "32x32" } },
        { tag: "link", attrs: { rel: "apple-touch-icon", href: publicPath("apple-touch-icon.png") } },
      ],
      sidebar: [
        { label: "Overview", slug: "index" },
        // Written by `stage.mjs --whats-new` after the generator (#1259): the release notes of each version.
        { label: "What's new", slug: "whats-new" },
        ...GUIDE_SECTIONS.flatMap(([directory, label]) => guideSection(directory, label)),
        // Generated by packages/docs/src (SR-139), under one heading (the reference of D-067), named Lookup since "reference" is the english-term of another
        // glossary term (#1428); the two long lists start collapsed.
        {
          label: "Lookup",
          items: [
            // The index page and then the commands in catalog order.
            {
              label: "Commands",
              collapsed: true,
              items: [{ autogenerate: { directory: "reference/commands" } }],
            },
            { label: "Problem and error codes", slug: "reference/problem-codes" },
            {
              label: "File formats",
              collapsed: true,
              items: [{ autogenerate: { directory: "reference/formats" } }],
            },
            { label: "Common types", slug: "reference/common-types" },
            { label: "Standard model", slug: "reference/standard-model" },
          ],
        },
        // ReqSeq's own spec as an HTML export, which the Pages workflow adds under /spec/ with each release (#1971).
        // Left out offline: a delivery's site has no /spec/.
        ...(offline
          ? []
          : [
              { label: "ReqSeq's own specification", link: "https://thomasbirkmaier.github.io/ReqSeq/spec/" },
            ]),
      ],
      // A dead internal link fails the build.
      plugins: [starlightLinksValidator()],
    }),
    {
      name: "reqseq-search-index",
      hooks: {
        "astro:build:done": async ({ dir, logger }) => {
          const pages = await writeSearchIndex(fileURLToPath(dir), base);
          logger.info(`search index of ${String(pages)} pages`);
          // The documentation as plain text for AI assistants (#1260), from the same content folder.
          const content = fileURLToPath(new URL("src/content/docs/", import.meta.url));
          const listed = await writeLlmsFiles(content, fileURLToPath(dir), base, title);
          logger.info(`llms.txt of ${String(listed)} pages`);
        },
      },
    },
  ],
});
