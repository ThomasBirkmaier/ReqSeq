// Paths of files ReqSeq writes outside the ReqSeq files (ADR-0002 rule 5): how `files` and problems
// show them, and the refusal of a `.git` folder. Used by `evidence.enrichJunit` (SR-029) and
// `data.store` (SR-062). Pure path code: nothing is read.
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { WorkspaceLayout } from "./layout.js";

/** Refuses a file in a `.git` folder, in any case and through links (D-036): `real` is its real folder. */
export const refuseGit = (real: string, file: string): void => {
  if (real.split(path.sep).some((segment) => segment.toLowerCase() === ".git")) {
    throw new CommandError(
      "input.invalid",
      `${path.basename(file)} lies in a .git folder; ReqSeq never writes to Git`,
      { file: path.basename(file), reason: "git-folder" },
    );
  }
};

/**
 * `file` (absolute, in the real folder `real`) as `files` and problems give it: relative to the
 * main repository with `/` when it lies below it or in another repository of the workspace (as
 * `workspacePath` gives element files), else absolute. `main` is the real folder of the main repository.
 */
export const shownPath = (
  layout: Pick<WorkspaceLayout, "repositories">,
  main: string,
  real: string,
  file: string,
): string => {
  const target = path.join(real, path.basename(file));
  const folders = [main, ...layout.repositories.filter((r) => r.available).map((r) => r.folder)];
  const inside = folders.some((folder) => {
    const relative = path.relative(folder, target);
    return relative.split(path.sep)[0] !== ".." && !path.isAbsolute(relative);
  });
  return inside ? path.relative(main, target).split(path.sep).join("/") : file;
};
