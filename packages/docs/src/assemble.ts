import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
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

/** The paths of the repository, from the folder of this package (`packages/docs`). */
export function contentPaths(packageDir: string): ContentPaths {
  return {
    repoRoot: join(packageDir, "..", ".."),
    guideDir: join(packageDir, "..", "..", "docs", "guide"),
    contentDir: join(packageDir, "site", "src", "content", "docs"),
  };
}

/**
 * Replaces the content folder of the site with a copy of the hand-written pages plus the generated `pages`, and
 * returns its files, relative and with `/`, sorted. A copy, not a symbolic link, so the build reads the same files
 * on every system. A generated page never replaces a hand-written one.
 */
export async function assembleContent(
  paths: ContentPaths,
  pages: readonly Page[] = [],
): Promise<readonly string[]> {
  await rm(paths.contentDir, { recursive: true, force: true });
  await cp(paths.guideDir, paths.contentDir, { recursive: true });
  const outside = (await files(paths.contentDir)).filter(
    (file) =>
      file !== "index.md" &&
      !(file.includes("/") && GUIDE_SECTIONS.includes(file.slice(0, file.indexOf("/")))),
  );
  if (outside.length > 0) {
    throw new Error(
      `docs/guide: ${outside.join(", ")} not in a section of the sidebar (${GUIDE_SECTIONS.join(", ")})`,
    );
  }
  for (const page of pages) {
    const file = join(paths.contentDir, ...page.path.split("/"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, page.text, { flag: "wx" });
  }
  return files(paths.contentDir);
}

/** The files below `folder`, relative and with `/`, sorted. */
async function files(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}
