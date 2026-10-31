// reqif.import (SR-053; ADR-0013 "Import"): imports a ReqIF 1.2 file through a saved mapping, all or
// nothing. Read and parse (`readDelivery`, `reqif.invalid`), mapping (`readMappingFile`, SR-054 AK2), the plan in memory
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
// change nothing, and a repeated import creates new elements).
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { Problem } from "../../catalog.js";
import type { FileSnapshot } from "../../files/index.js";
import { createFolder, readFileSnapshot, renderYamlDocument, writeFileAtomic } from "../../files/index.js";
import type { Metamodel } from "../../metamodel/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { NewElementFile, NewImageFile } from "../../model/index.js";
import { createElementFiles, refuseUnlisted, titleKeyOrEmpty, workspacePath } from "../../model/index.js";
import type { AnyMapping, OwnMappingFile, PlannedImage } from "../../reqif/index.js";
import {
  MAPPING_KEYS,
  OWN_TOOL_ID,
  checkMapping,
  imageContent,
  imageReader,
  importDate,
  mappingTarget,
  originKeys,
  ownMapping,
  planImport,
  readDelivery,
  readMappingFile,
} from "../../reqif/index.js";
import type { ReqifMappingFile } from "../../generated/types.js";
import type { ReqifFile } from "../../reqif/model.js";
import type { RepositoryLocation, WorkspaceLayout } from "../../workspace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/** Creates the folder of the mapping file to save, once nothing refuses the import any more. */
const mappingFolder = async (save: SavedMapping): Promise<void> => {
  const folder = path.posix.dirname(save.file.file);
  if (folder !== ".") {
    await createFolder(save.repository.folder, folder);
  }
};

/** A mapping file to write: new (written with the elements) or replacing the one read (`expected`). */
interface SavedMapping {
  readonly repository: RepositoryLocation;
  readonly file: NewElementFile;
  readonly expected?: FileSnapshot;
}

/** The mapping of a file of ReqSeq, and the mapping file to save with the elements. */
interface OwnMapping {
  readonly mapping: AnyMapping;
  readonly save?: SavedMapping;
  readonly problems: readonly Problem[];
}

/** `mapping` as the YAML of a mapping file, its keys in the schema's order. */
const mappingBytes = (mapping: ReqifMappingFile): Uint8Array => {
  const data: Readonly<Record<string, unknown>> = { ...mapping };
  const ordered = Object.fromEntries(
    MAPPING_KEYS.flatMap((key) => (data[key] === undefined ? [] : [[key, data[key]]])),
  );
  return new TextEncoder().encode(renderYamlDocument(ordered));
};

/**
 * `saved` with the entries of the one-to-one mapping `fresh` it lacks (SR-052 AK3: a later file of
 * the same source needs no mapping by hand): each type, attribute and relation type by its source,
 * and each enumeration value an attribute entry with `values` neither maps nor omits. Entries
 * `saved` has stay as they are. Undefined when nothing is added.
 */
const extendedMapping = (saved: ReqifMappingFile, fresh: OwnMappingFile): ReqifMappingFile | undefined => {
  // Set in the callbacks below, so an object: a `let` would read as never changed.
  const found = { added: false };
  const missing = <T extends { readonly source: string }>(
    have: readonly T[] = [],
    more: readonly T[],
  ): T[] => {
    const known = new Set(have.map((e) => e.source));
    const rest = more.filter((e) => !known.has(e.source));
    found.added ||= rest.length > 0;
    return [...have, ...rest];
  };
  const freshValues = new Map(fresh.attributes.map((e) => [e.source, e.values ?? {}]));
  const attributes = missing(
    (saved.attributes ?? []).map((entry) => {
      const omitted = new Set(entry["omit-values"] ?? []);
      const values = Object.entries(freshValues.get(entry.source) ?? {}).filter(
        ([value]) => entry.values !== undefined && !(value in entry.values) && !omitted.has(value),
      );
      found.added ||= values.length > 0;
      // An entry with `values` maps to a property, and keeps doing so.
      return values.length === 0
        ? entry
        : ({ ...entry, values: { ...entry.values, ...Object.fromEntries(values) } } as typeof entry);
    }),
    fresh.attributes,
  );
  const extended: ReqifMappingFile = {
    ...saved,
    types: missing(saved.types, fresh.types),
    attributes,
    relations: missing(saved.relations, fresh.relations),
  };
  return found.added ? extended : undefined;
};

/**
 * The mapping of the file of ReqSeq `file` for `reqif.import` without `mapping` (see the file
 * comment): the saved one of the source, extended by what this file adds, or a new one-to-one one.
 */
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
  const keys = originKeys(metamodel);
  const skipped = new Set([titleKeyOrEmpty(metamodel), ...Object.values(keys)]);
  const fresh = ownMapping(file, metamodel, source, skipped);
  const shown = workspacePath(layout, target.repository, target.file);
  const before = await readFileSnapshot(target.repository.folder, target.file);
  if (before.kind === "problem" && !before.missing) {
    throw new CommandError("file.faulty", `mapping: ${shown} cannot be read: ${before.problem.message}`, {
      command,
      repository: target.repository.name,
      file: target.file,
    });
  }
  if (before.kind === "problem") {
    checkMapping(layout, metamodel, fresh, "mapping", command);
    return {
      mapping: fresh,
      save: { repository: target.repository, file: { file: target.file, bytes: mappingBytes(fresh) } },
      problems: [],
    };
  }
  const absolute = path.join(target.repository.folder, target.file);
  const { mapping: saved } = await readMappingFile(layout, metamodel, root, absolute, command);
  const differs = saved.source.name !== source || saved.source["tool-id"] !== OWN_TOOL_ID;
  const problems: Problem[] = differs
    ? [
        {
          code: "reqif.mapping-differs",
          severity: "warning",
          message: `${shown} maps source ${saved.source.name}${saved.source["tool-id"] === undefined ? "" : ` (${saved.source["tool-id"]})`}, not ${source} (${OWN_TOOL_ID}); it is used as it is`,
          repository: target.repository.name,
          file: target.file,
        },
      ]
    : [];
  const extended = extendedMapping(saved, fresh);
  if (extended === undefined) {
    return { mapping: saved, problems };
  }
  checkMapping(layout, metamodel, extended, "mapping", command);
  return {
    mapping: extended,
    save: {
      repository: target.repository,
      file: { file: target.file, bytes: mappingBytes(extended) },
      expected: before.snapshot,
    },
    problems,
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
    const delivery = await readDelivery(workspace.root, input.file);
    const own = delivery.header.toolId === OWN_TOOL_ID;
    if (input.mapping === undefined && !own) {
      throw new CommandError(
        "input.invalid",
        `mapping: name the mapping file of the source (reqif.saveMapping); only a file of ReqSeq (REQ-IF-TOOL-ID ${OWN_TOOL_ID}) is mapped one to one without it`,
        { command, fields: ["mapping"] },
      );
    }
    const mapped =
      input.mapping === undefined
        ? await ownMappingOf(workspace.root, layout, metamodel, delivery, input.source)
        : {
            mapping: (await readMappingFile(layout, metamodel, workspace.root, input.mapping, command))
              .mapping,
            problems: [],
          };
    const plan = await planImport(
      delivery,
      mapped.mapping,
      layout,
      metamodel,
      { delivery: input.delivery, date: importDate(new Date()) },
      imageReader(path.resolve(workspace.root, input.file), ctx.localPaths),
      own,
    );
    const { save } = mapped;
    // A new mapping file is written with the elements when it lies in their repository.
    const together = save?.expected === undefined && save?.repository.name === plan.repository.name;
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
      if (together) {
        await mappingFolder(save);
      }
      files = await createElementFiles(
        workspace,
        layout,
        plan.repository,
        elements,
        together ? [...images, { file: save.file.file, content: save.file.bytes }] : images,
      );
    }
    if (save !== undefined && (first === undefined || !together)) {
      await mappingFolder(save);
      await writeFileAtomic(save.repository.folder, save.file.file, save.file.bytes, save.expected ?? null, {
        kind: "yaml",
      });
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
