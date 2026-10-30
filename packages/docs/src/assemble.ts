import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import type { Page } from "./reference.js";

/** Where the hand-written pages are read from and where the Starlight site reads its content (ADR-0017). */
export interface ContentPaths {
  readonly repoRoot: string;
  readonly guideDir: string;
  readonly contentDir: string;
}

/**
 * The folders of docs/guide/ (D-067: Get started, How-to, Concepts); the sidebar lists each of them
 * (site/astro.config.mjs, GUIDE_SECTIONS). A page elsewhere, except the landing page, would be in no sidebar.
 */
export const GUIDE_SECTIONS: readonly string[] = ["start", "how-to", "concepts"];

/**
 * The folder of docs/guide/ for the images of the pages, such as the app's screenshots that the Electron spec
 * `packages/app/test/guide-screenshots.spec.ts` writes on Linux (ADR-0017). It holds no pages.
 */
export const GUIDE_IMAGES = "images";

/** The paths of the repository, from the folder of this package (`packages/docs`). */
export function contentPaths(packageDir: string): ContentPaths {
  return {
    repoRoot: join(packageDir, "..", ".."),
    guideDir: join(packageDir, "..", "..", "docs", "guide"),
    contentDir: join(packageDir, "site", "src", "content", "docs"),
  };
}

/**
 * A hand-written page with its site links (`](/start/get-started/)`, `[name]: /reference/`) prefixed with the base
 * path, so the pages name no base and build for Pages (`/ReqSeq`) and offline (`/`) alike. Links to other sites
 * (`//host`) and code spans stay as they are.
 */
export function withBase(text: string, base: string): string {
  const prefix = base.replace(/\/$/, "");
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(
            /(\]\(|^\[[^\]\n]+\]:[ \t]*)\/(?!\/)/gm,
            (_link, start: string) => `${start}${prefix}/`,
          ),
    )
    .join("");
}

/**
 * Replaces the content folder of the site with a copy of the hand-written pages (their site links with `base`) plus
 * the generated `pages`, and returns its files, relative and with `/`, sorted. A copy, not a symbolic link, so the
 * build reads the same files on every system. A generated page never replaces a hand-written one.
 */
export async function assembleContent(
  paths: ContentPaths,
  pages: readonly Page[] = [],
  base = "/",
): Promise<readonly string[]> {
  await rm(paths.contentDir, { recursive: true, force: true });
  await cp(paths.guideDir, paths.contentDir, { recursive: true });
  for (const file of (await files(paths.contentDir)).filter((name) => name.endsWith(".md"))) {
    const path = join(paths.contentDir, ...file.split("/"));
    await writeFile(path, withBase(await readFile(path, "utf8"), base));
  }
  const copied = await files(paths.contentDir);
  const outside = copied.filter(
    (file) =>
      file !== "index.md" &&
      !(file.includes("/") && GUIDE_SECTIONS.includes(file.slice(0, file.indexOf("/")))) &&
      !(file.startsWith(`${GUIDE_IMAGES}/`) && !file.endsWith(".md")),
  );
  if (outside.length > 0) {
    throw new Error(
      `docs/guide: ${outside.join(", ")} not in a section of the sidebar (${GUIDE_SECTIONS.join(", ")})`,
    );
  }
  const missing: string[] = [];
  for (const file of copied.filter((name) => name.endsWith(".md"))) {
    const text = await readFile(join(paths.contentDir, ...file.split("/")), "utf8");
    missing.push(...imageProblems(file, text, new Set(copied)));
  }
  // A generated page, such as the standard model, may show an image of the guide too.
  for (const page of pages) {
    missing.push(...imageProblems(page.path, page.text, new Set(copied)));
  }
  if (missing.length > 0) {
    throw new Error(`docs/guide: ${missing.join("; ")}`);
  }
  for (const page of pages) {
    const file = join(paths.contentDir, ...page.path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, page.text, { flag: "wx" });
  }
  return files(paths.contentDir);
}

/**
 * What is wrong with the images of a page (`![alt](path)`): an image without alt text, and an image path that is
 * not relative to the page or names no file of the guide, so a page never shows a screenshot that is gone. Images of
 * other sites are not allowed either (no network, ADR-0017). Code spans are skipped.
 */
export function imageProblems(page: string, text: string, files: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const prose = text.replace(/^(```|~~~)[^]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");
  for (const match of prose.matchAll(/!\[([^\]\n]*)\]\(([^)\s]*)[^)\n]*\)/g)) {
    const [alt, target] = [String(match[1]), String(match[2])];
    if (alt.trim() === "") {
      problems.push(`${page}: the image ${target} has no alt text`);
    }
    const file = posix.normalize(posix.join(posix.dirname(page), target));
    if (!target.startsWith(".") || !files.has(file)) {
      problems.push(`${page}: the image ${target} is no file of the guide relative to the page`);
    }
  }
  return problems;
}

/** The files below `folder`, relative and with `/`, sorted. */
async function files(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}
