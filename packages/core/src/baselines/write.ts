// Writing a new baseline file (ADR-0018 "Never overwritten"): the file name is `baselineStem` of
// its name; a name the folder has in any case or Unicode normal form gets `-2`, `-3`, … (as
// attachments). The file is created through the create path of `writeFileAtomic` (no snapshot), so an
// existing file is never replaced; one that appears meanwhile makes it take the next name. The folder
// is created when missing. Nothing else is written, and Git is never touched (D-036).
import path from "node:path";
import { CommandError } from "../catalog.js";
import { createFolder, listFolderFiles, writeFileAtomic } from "../files/index.js";
import { clashKey } from "../model/index.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { BASELINE_FILE_EXTENSION } from "./read.js";
import { baselineStem } from "./text.js";

/** Writes `text` as a new file in `folder` (relative to `repository`), with the first free name; returns the file. */
export const writeNewBaseline = async (
  repository: Pick<RepositoryLocation, "folder">,
  folder: string,
  name: string,
  text: string,
): Promise<string> => {
  const listing = await listFolderFiles(path.join(repository.folder, folder));
  if (listing.kind === "missing") {
    await createFolder(repository.folder, folder);
  }
  const taken = new Set(listing.kind === "names" ? listing.entries.map(clashKey) : []);
  const stem = baselineStem(name);
  for (let n = 1; ; n++) {
    const file = path.posix.join(
      folder,
      `${stem}${n === 1 ? "" : `-${String(n)}`}${BASELINE_FILE_EXTENSION}`,
    );
    if (!taken.has(clashKey(path.posix.basename(file)))) {
      try {
        await writeFileAtomic(repository.folder, file, text, null, { kind: "yaml" });
        return file;
      } catch (error) {
        // A file that appeared since the folder was listed: take the next name.
        if (!(error instanceof CommandError && error.code === "file.changed-on-disk")) {
          throw error;
        }
      }
    }
  }
};
