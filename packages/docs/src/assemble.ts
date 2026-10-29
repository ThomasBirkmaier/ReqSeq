import { cp, readdir, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** Where the hand-written pages are read from and where the Starlight site reads its content (ADR-0017). */
export interface ContentPaths {
  readonly guideDir: string;
  readonly contentDir: string;
}

/** The paths of the repository, from the folder of this package (`packages/docs`). */
export function contentPaths(packageDir: string): ContentPaths {
  return {
    guideDir: join(packageDir, "..", "..", "docs", "guide"),
    contentDir: join(packageDir, "site", "src", "content", "docs"),
  };
}

/**
 * Replaces the content folder of the site with a copy of the hand-written pages and returns the copied files,
 * relative and with `/`, sorted. A copy, not a symbolic link, so the build reads the same files on every system.
 */
export async function assembleContent(paths: ContentPaths): Promise<readonly string[]> {
  await rm(paths.contentDir, { recursive: true, force: true });
  await cp(paths.guideDir, paths.contentDir, { recursive: true });
  const entries = await readdir(paths.contentDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(paths.contentDir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .sort();
}
