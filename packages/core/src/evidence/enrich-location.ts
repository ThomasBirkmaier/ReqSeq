// Whether an enriched JUnit file counts where it lies (SR-230 AK3): when `evidence.enrichJunit` ends, a
// file that lies outside every evidence location gives `evidence.outside-location` (warning), since its
// results count only once it lies in one. The file is enriched all the same, and the warning does not
// change the exit code (only an error or `ok: false` does, ADR-0009).
//
// "In an evidence location" means: one of the files the evidence walk reads (`evidenceFiles`), so a file
// below a location that the walk leaves out (an extension not in lower case, an `ignore` glob, a
// nested repository) is outside too. A file below no location folder needs no walk; for one below a location
// folder the walk runs once, and its files of the same name are compared by real path. A location in a
// repository that is not on this machine holds nothing here.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { locate } from "../workspace/index.js";
import { evidenceFiles } from "./folders.js";

/** The real path of `file`, or `file` itself when it cannot be resolved. */
const realOf = async (file: string): Promise<string> => fs.realpath(file).catch(() => file);

/** Whether `file` is `folder` or lies below it. */
const below = (folder: string, file: string): boolean => {
  const relative = path.relative(folder, file);
  return relative !== "" && relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative);
};

/** Whether the real path `file` lies below the folder of an evidence location of an available repository. */
const belowLocation = async (layout: WorkspaceLayout, file: string): Promise<boolean> => {
  for (const location of layout.file.evidence ?? []) {
    // `folder` is undefined for a repository that is not on this machine.
    const { folder } = locate(layout, location);
    if (folder !== undefined && below(await realOf(folder), file)) {
      return true;
    }
  }
  return false;
};

/** Whether the evidence walk reads the file at the real path `file`. */
const readByWalk = async (layout: WorkspaceLayout, file: string): Promise<boolean> => {
  const name = path.basename(file);
  for (const listed of (await evidenceFiles(layout)).files) {
    if (path.basename(listed.absolute) === name && (await realOf(listed.absolute)) === file) {
      return true;
    }
  }
  return false;
};

/**
 * `evidence.outside-location` for the enriched file at the real path `file`, named `shown`, when the
 * evidence walk does not read it (see the file comment); none otherwise.
 */
export const outsideLocationProblems = async (
  layout: WorkspaceLayout,
  file: string,
  shown: string,
): Promise<Problem[]> =>
  (await belowLocation(layout, file)) && (await readByWalk(layout, file))
    ? []
    : [
        {
          code: "evidence.outside-location",
          severity: "warning",
          file: shown,
          message: `${shown} lies in no evidence location, so its results do not count until it lies in one: move it into a folder under evidence of the workspace file, or enrich with an output there`,
        },
      ];
