// reqif.import (SR-053; ADR-0013 "Import"): imports a ReqIF 1.2 file through a saved mapping, all or
// nothing. Parse (`reqif.invalid`), mapping (`readMappingFile`, SR-054 AK2), the plan in memory
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
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { createFolder } from "../../files/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { NewElementFile, NewImageFile } from "../../model/index.js";
import { createElementFiles, refuseUnlisted } from "../../model/index.js";
import {
  REQIF_LIMITS,
  imageContent,
  imageReader,
  importDate,
  parseReqif,
  planImport,
  readMappingFile,
} from "../../reqif/index.js";
import type { PlannedImage } from "../../reqif/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../../workspace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/** Opening never waits: a FIFO in place of the file opens at once and is then no file (no O_NONBLOCK on Windows). */
const READ_NOW = constants.O_RDONLY | constants.O_NONBLOCK;

/** Bytes read at a time. */
const CHUNK = 1024 * 1024;

/**
 * The bytes of the ReqIF file at the local path `given`. The limit holds for the bytes read, not for
 * a size looked at before, so a file growing meanwhile is refused too; a FIFO or device is no file.
 */
const readDelivery = async (root: string, given: string): Promise<Uint8Array> => {
  const absolute = path.resolve(root, given);
  const name = path.basename(absolute);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(absolute, READ_NOW);
  } catch (error) {
    throw new CommandError(
      "file.faulty",
      `file: cannot read ${name}: ${String((error as NodeJS.ErrnoException).code)}`,
      { fields: ["file"] },
    );
  }
  try {
    if (!(await handle.stat()).isFile()) {
      throw new CommandError("file.faulty", `file: ${name} is not a file`, { fields: ["file"] });
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(chunk, 0, CHUNK, null);
      if (bytesRead === 0) {
        return Buffer.concat(chunks, total);
      }
      total += bytesRead;
      if (total > REQIF_LIMITS.bytes) {
        throw new CommandError(
          "reqif.invalid",
          `file: ${name} is larger than ${String(REQIF_LIMITS.bytes)} bytes, the most ReqSeq reads`,
          { fields: ["file"] },
        );
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
};

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
    const parsed = parseReqif(await readDelivery(workspace.root, input.file));
    if (parsed.kind === "refused") {
      throw new CommandError("reqif.invalid", `file: line ${String(parsed.line)}: ${parsed.message}`, {
        fields: ["file"],
        line: parsed.line,
      });
    }
    const { mapping } = await readMappingFile(layout, metamodel, workspace.root, input.mapping, command);
    const plan = await planImport(
      parsed.file,
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
