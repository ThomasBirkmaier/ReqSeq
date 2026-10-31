// reqif.import (SR-053; ADR-0013 "Import"): imports a ReqIF 1.2 file through a saved mapping, all or
// nothing. Read and parse (`readDelivery`, `reqif.invalid`), mapping (`readMappingFile`, SR-054 AK2), the plan in memory
// (reqif/import.ts: `reqif.unmapped`, losses), then every new element file at once
// (`createElementFiles`); a refusal comes before any write. The own metamodel is only read (SR-054
// AK3), and no status is set but the initial one (D-030).
//
// Each element keeps its origin (SR-057): source, IDENTIFIER, import date (this machine's calendar),
// delivery and import version (reqif/origin.ts).
//
// Not yet: updating the elements of an earlier delivery and the
// conflicts `take` and `keep` decide (SR-056; until then no import finds a conflict, so both lists
// change nothing, and a repeated import creates new elements), the one-to-one mapping of a ReqSeq
// file (SR-052).
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { createFolder } from "../../files/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { NewElementFile, NewImageFile } from "../../model/index.js";
import { createElementFiles, refuseUnlisted } from "../../model/index.js";
import {
  imageContent,
  imageReader,
  importDate,
  planImport,
  readDelivery,
  readMappingFile,
} from "../../reqif/index.js";
import type { PlannedImage } from "../../reqif/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../../workspace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/**
 * The plan's files under the folder spelled as on disk (#194): the rules of the walk are checked on
 * the target before the folder is created and again after, as `element.create` does, and the files
 * go under the spelling the second check finds. Every file of the plan lies in the one target folder.
 */
const spelledFiles = async (
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  folder: string,
  files: readonly NewElementFile[],
  first: NewElementFile,
): Promise<{ readonly spelled: string; readonly files: NewElementFile[] }> => {
  const before = await refuseUnlisted(layout, repository, first.file);
  if (folder !== "") {
    await createFolder(repository.folder, path.posix.dirname(before));
  }
  const spelled = path.posix.dirname(await refuseUnlisted(layout, repository, before));
  return {
    spelled,
    files: files.map((f) => ({ ...f, file: path.posix.join(spelled, path.posix.basename(f.file)) })),
  };
};

/**
 * The image copies under the target folder as spelled (`spelled`, the folder of the element files),
 * each in the image folder of its element (`<element stem>/<name>`), read while they are written
 * (`imageContent`). Every copy is checked like the target before and after its folder is created
 * (SR-095 AK2, as `element.addAttachment`), so the walk lists each one. A folder made for a call
 * that fails later stays, empty (#530).
 */
const spelledImages = async (
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  spelled: string,
  images: readonly PlannedImage[],
): Promise<NewImageFile[]> => {
  const out: NewImageFile[] = [];
  for (const { stem, name, file } of images) {
    const before = await refuseUnlisted(layout, repository, path.posix.join(spelled, stem, name));
    await createFolder(repository.folder, path.posix.dirname(before));
    const at = await refuseUnlisted(layout, repository, before);
    out.push({ file: at, content: imageContent(file, name) });
  }
  return out;
};

export default defineCommand({
  name: "reqif.import",
  run: async (ctx, input): Promise<CommandOutput<"reqif.import">> => {
    const command = "reqif.import";
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    if (input.mapping === undefined) {
      throw new CommandError(
        "input.invalid",
        "mapping: name the mapping file of the source (reqif.saveMapping); a file of ReqSeq without mapping is not read yet",
        { command, fields: ["mapping"] },
      );
    }
    const delivery = await readDelivery(workspace.root, input.file);
    const { mapping } = await readMappingFile(layout, metamodel, workspace.root, input.mapping, command);
    const plan = await planImport(
      delivery,
      mapping,
      layout,
      metamodel,
      { delivery: input.delivery, date: importDate(new Date()) },
      imageReader(path.resolve(workspace.root, input.file), ctx.localPaths),
    );
    const [first] = plan.files;
    let files: string[] = [];
    if (first !== undefined) {
      const { spelled, files: elements } = await spelledFiles(
        layout,
        plan.repository,
        plan.folder,
        plan.files,
        first,
      );
      const images = await spelledImages(layout, plan.repository, spelled, plan.images);
      files = await createElementFiles(workspace, layout, plan.repository, elements, images);
    }
    return {
      created: [...plan.created],
      updated: [],
      kept: [],
      dropped: [],
      losses: [...plan.losses],
      files,
      problems: [],
    };
  },
});
