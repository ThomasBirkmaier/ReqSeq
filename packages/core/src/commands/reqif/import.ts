// reqif.import (SR-053; ADR-0013 "Import"): imports a ReqIF 1.2 file through a saved mapping, all or
// nothing. Parse (`reqif.invalid`), mapping (`readMappingFile`, SR-054 AK2), the plan in memory
// (reqif/import.ts: `reqif.unmapped`, losses), then every new element file at once
// (`createElementFiles`); a refusal comes before any write. The own metamodel is only read (SR-054
// AK3), and no status is set but the initial one (D-030).
//
// Each element keeps its origin (SR-057): source, IDENTIFIER, import date (this machine's calendar),
// delivery and import version (reqif/origin.ts).
//
// A file of ReqSeq (REQ-IF-TOOL-ID `reqseq`, SR-052 AK3) needs no `mapping`: the source is `source`,
// else the header TITLE (`input.invalid` without either). Its mapping file in the mapping folder
// (`mappingTarget`) is used when it exists, with a warning `reqif.mapping-differs` when its source
// name or tool ID differs; else the import builds the one-to-one mapping (`ownMapping`) and saves it
// there with the elements, in one all-or-nothing write when both lie in one repository, else right
// after them. The round-trip attributes are read as reqif/import.ts says.
//
// Not yet: updating the elements of an earlier delivery and the
// conflicts `take` and `keep` decide (SR-056; until then no import finds a conflict, so both lists
// change nothing, and a repeated import creates new elements) and images (SR-095).
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { Problem } from "../../catalog.js";
import { createFolder, renderYamlDocument, writeFileAtomic } from "../../files/index.js";
import type { Metamodel } from "../../metamodel/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { NewElementFile } from "../../model/index.js";
import { createElementFiles, refuseUnlisted, titleKeyOrEmpty, workspacePath } from "../../model/index.js";
import type { AnyMapping } from "../../reqif/index.js";
import {
  MAPPING_KEYS,
  OWN_TOOL_ID,
  REQIF_LIMITS,
  checkMapping,
  importDate,
  mappingTarget,
  originKeys,
  ownMapping,
  parseReqif,
  planImport,
  readMappingFile,
} from "../../reqif/index.js";
import type { ReqifFile } from "../../reqif/model.js";
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

/** The mapping of a file of ReqSeq, and a new mapping file to save with the elements. */
interface OwnMapping {
  readonly mapping: AnyMapping;
  readonly save?: { readonly repository: RepositoryLocation; readonly file: NewElementFile };
  readonly problems: readonly Problem[];
}

/** The mapping of the file of ReqSeq `file` for `reqif.import` without `mapping` (see the file comment). */
const ownMappingOf = async (
  root: string,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  file: ReqifFile,
  given: string | undefined,
): Promise<OwnMapping> => {
  const command = "reqif.import";
  const source = given ?? file.header.title;
  if (source === undefined || source === "") {
    throw new CommandError(
      "input.invalid",
      "source: the file of ReqSeq has no TITLE; name the source of its elements in source",
      { command, fields: ["source"] },
    );
  }
  const target = await mappingTarget(layout, root, source, undefined, command);
  const absolute = path.join(target.repository.folder, target.file);
  const exists = await fs.lstat(absolute).then(
    () => true,
    () => false,
  );
  if (exists) {
    const { mapping } = await readMappingFile(layout, metamodel, root, absolute, command);
    const differs = mapping.source.name !== source || mapping.source["tool-id"] !== OWN_TOOL_ID;
    const shown = workspacePath(layout, target.repository, target.file);
    return {
      mapping,
      problems: differs
        ? [
            {
              code: "reqif.mapping-differs",
              severity: "warning",
              message: `${shown} maps source ${mapping.source.name}${mapping.source["tool-id"] === undefined ? "" : ` (${mapping.source["tool-id"]})`}, not ${source} (${OWN_TOOL_ID}); it is used as it is`,
              repository: target.repository.name,
              file: target.file,
            },
          ]
        : [],
    };
  }
  const keys = originKeys(metamodel);
  const skipped = new Set([titleKeyOrEmpty(metamodel), ...Object.values(keys)]);
  const mapping = ownMapping(file, metamodel, source, skipped);
  checkMapping(layout, metamodel, mapping, "mapping", command);
  const data: Readonly<Record<string, unknown>> = { ...mapping };
  const ordered = Object.fromEntries(
    MAPPING_KEYS.flatMap((key) => (data[key] === undefined ? [] : [[key, data[key]]])),
  );
  return {
    mapping,
    save: {
      repository: target.repository,
      file: { file: target.file, bytes: new TextEncoder().encode(renderYamlDocument(ordered)) },
    },
    problems: [],
  };
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
): Promise<NewElementFile[]> => {
  const before = await refuseUnlisted(layout, repository, first.file);
  if (folder !== "") {
    await createFolder(repository.folder, path.posix.dirname(before));
  }
  const spelled = path.posix.dirname(await refuseUnlisted(layout, repository, before));
  return files.map((f) => ({ ...f, file: path.posix.join(spelled, path.posix.basename(f.file)) }));
};

export default defineCommand({
  name: "reqif.import",
  run: async (ctx, input): Promise<CommandOutput<"reqif.import">> => {
    const command = "reqif.import";
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const parsed = parseReqif(await readDelivery(workspace.root, input.file));
    if (parsed.kind === "refused") {
      throw new CommandError("reqif.invalid", `file: line ${String(parsed.line)}: ${parsed.message}`, {
        fields: ["file"],
        line: parsed.line,
      });
    }
    const own = parsed.file.header.toolId === OWN_TOOL_ID;
    if (input.mapping === undefined && !own) {
      throw new CommandError(
        "input.invalid",
        `mapping: name the mapping file of the source (reqif.saveMapping); only a file of ReqSeq (REQ-IF-TOOL-ID ${OWN_TOOL_ID}) is mapped one to one without it`,
        { command, fields: ["mapping"] },
      );
    }
    const mapped =
      input.mapping === undefined
        ? await ownMappingOf(workspace.root, layout, metamodel, parsed.file, input.source)
        : {
            mapping: (await readMappingFile(layout, metamodel, workspace.root, input.mapping, command))
              .mapping,
            problems: [],
          };
    const plan = planImport(
      parsed.file,
      mapped.mapping,
      layout,
      metamodel,
      { delivery: input.delivery, date: importDate(new Date()) },
      own,
    );
    const { save } = mapped;
    const together = save?.repository.name === plan.repository.name;
    if (save !== undefined) {
      const folder = path.posix.dirname(save.file.file);
      if (folder !== ".") {
        await createFolder(save.repository.folder, folder);
      }
    }
    const [first] = plan.files;
    const files =
      first === undefined
        ? []
        : await createElementFiles(
            workspace,
            layout,
            plan.repository,
            await spelledFiles(layout, plan.repository, plan.folder, plan.files, first),
            together ? [save.file] : [],
          );
    if (save !== undefined && (first === undefined || !together)) {
      await writeFileAtomic(save.repository.folder, save.file.file, save.file.bytes, null, { kind: "yaml" });
      files.push(workspacePath(layout, save.repository, save.file.file));
    }
    return {
      created: [...plan.created],
      updated: [],
      kept: [],
      dropped: [],
      losses: [...plan.losses],
      files,
      problems: [...mapped.problems, ...plan.problems],
    };
  },
});
