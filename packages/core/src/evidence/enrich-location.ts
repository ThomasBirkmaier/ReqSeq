// Whether an enriched JUnit file counts where it lies (SR-230 AK3): when `evidence.enrichJunit` ends, a
// file that the evidence walk does not read gives `evidence.outside-location` (warning), since its
// results count only once it is read. The file is enriched all the same, and the warning does not
// change the exit code (only an error or `ok: false` does, ADR-0009).
//
// AK3 names a file outside every evidence location. A file below the folder of a location that the walk
// leaves out (a name not ending in `.xml` in lower case, an `ignore` glob, a link, a nested repository)
// does not count either, so it warns too, with its own message. The check is the one the walk applies to
// one path (`listsFile` of the model block below a location `isReadEvidenceLocation` accepts), without
// walking the folders; the file's real path gives its names as stored, so a name typed in another case
// on a file system that ignores case is the file the walk reads. A location in a repository that is not
// on this machine holds nothing here. When the check itself fails, the file is taken as not read.
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { ignoredBy, listsFile } from "../model/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { locate } from "../workspace/index.js";
import { isReadEvidenceLocation, startOf } from "./folders.js";

/** Where an enriched file lies for the evidence walk. */
type Place = "read" | "not-read" | "outside";

/** `file` relative to `folder` with `/` when it lies below it, else undefined. */
const relativeBelow = (folder: string, file: string): string | undefined => {
  const relative = path.relative(folder, file);
  return relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
    ? undefined
    : relative.split(path.sep).join("/");
};

/** Where the existing file `file` lies: read by the walk, below a location but not read, or outside. */
const placeOf = async (layout: WorkspaceLayout, file: string): Promise<Place> => {
  // The native `realpath` gives the names as stored.
  const real = await fs.realpath(file);
  const ignored = ignoredBy(layout);
  let place: Place = "outside";
  for (const location of layout.file.evidence ?? []) {
    const { repository } = locate(layout, location);
    if (repository?.available !== true) {
      continue;
    }
    const relative = relativeBelow(await fs.realpath(repository.folder), real);
    const start = startOf(location.path);
    if (relative === undefined || (start !== "" && !relative.startsWith(`${start}/`))) {
      continue;
    }
    if (
      relative.endsWith(".xml") &&
      (await isReadEvidenceLocation(layout, location)) &&
      (await listsFile(repository, ignored, relative))
    ) {
      return "read";
    }
    place = "not-read";
  }
  return place;
};

/** The message of `evidence.outside-location` for the file named `shown`. */
const messageOf = (place: Exclude<Place, "read">, shown: string): string =>
  place === "outside"
    ? `${shown} lies in no evidence location, so its results do not count until it lies in one: move it into a folder under evidence of the workspace file, or enrich with an output there`
    : `${shown} is not read as evidence (its name does not end in .xml in lower case, or an ignore glob, a link or a nested repository leaves it out), so its results do not count: rename it to end in .xml, or move it into a folder the evidence walk reads`;

/**
 * `evidence.outside-location` for the enriched file at `file` (it exists), named `shown`, when the
 * evidence walk does not read it (see the file comment); none otherwise.
 */
export const outsideLocationProblems = async (
  layout: WorkspaceLayout,
  file: string,
  shown: string,
): Promise<Problem[]> => {
  const place = await placeOf(layout, file).catch((): Place => "not-read");
  return place === "read"
    ? []
    : [
        {
          code: "evidence.outside-location",
          severity: "warning",
          file: shown,
          message: messageOf(place, shown),
        },
      ];
};
