// reqif.import (SR-053; ADR-0013 "Import"): imports a ReqIF 1.2 file through a saved mapping, all or
// nothing. Read and parse (`readDelivery`, `reqif.invalid`), mapping (`readMappingFile`, SR-054 AK2), the plan in memory
// (reqif/import.ts: `reqif.unmapped`, losses), then every new element file at once
// (`createElementFiles`); a refusal comes before any write. The own metamodel is only read (SR-054
// AK3), and no status is set but the initial one (D-030).
//
// Each element keeps its origin (SR-057): source, IDENTIFIER, import date (this machine's calendar),
// delivery and import version (reqif/origin.ts).
//
// A repeated delivery (SR-056, reqif/repeat.ts) updates the elements of the source in place; a
// conflict needs `take` or `keep` (`reqif.conflict` names those without, before any write). While a
// repository of the workspace is not on this machine, its elements of the source cannot be
// matched, so the import is refused (`file.folder-missing`, #575/7); so is it while the store cannot
// read an element file (`file.faulty`, #575/8). The writes, each undone when a
// later one fails: the image copies of updated elements, the updated files (`writeElementFiles`),
// then the new files (`createElementFiles`); nothing is deleted that the call did not create.
//
// Not yet: the one-to-one mapping of a ReqSeq file (SR-052).
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { createFilesAtomic, createFolder, removeCreatedFiles, zip } from "../../files/index.js";
import type { Problem, ReqifObject } from "../../generated/types.js";
import { metamodelState } from "../../metamodel/index.js";
import type { ElementStore, NewElementFile, NewImageFile, ShortIds } from "../../model/index.js";
import {
  createElementFiles,
  elementStoreState,
  refuseUnlisted,
  resolveRef,
  shortIdState,
  workspacePath,
} from "../../model/index.js";
import type { ElementFileWrite, WrittenElementFile } from "../../model/write.js";
import { restoreElementFiles, writeElementFiles } from "../../model/write.js";
import {
  existingElements,
  imageContent,
  imageReader,
  importDate,
  originKeys,
  planImport,
  readDelivery,
  readMappingFile,
  unreadableFiles,
} from "../../reqif/index.js";
import type { ConflictChoices, PlannedImage, PlannedUpdateImage } from "../../reqif/index.js";
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

/** Files written at the same time, as `element.bulkUpdate` writes them (N-036). */
const WRITE_CONCURRENCY = 16;

/**
 * The choices of `take` and `keep` for the conflicts: an entry is an exact source IDENTIFIER of a
 * conflict, else an element reference (`resolveRef`) of a conflict's element. The same conflict in
 * both lists is `input.invalid`; an entry that names no conflict is a `reqif.choice-unused` warning.
 */
const chooser =
  (store: ElementStore, shortIds: ShortIds, take: readonly string[], keep: readonly string[]) =>
  (conflicts: readonly ReqifObject[]): { choices: ConflictChoices; problems: Problem[] } => {
    const choices = new Map<string, "take" | "keep">();
    const problems: Problem[] = [];
    const identifierOf = (entry: string): string | undefined => {
      const exact = conflicts.find((c) => c.identifier === entry);
      if (exact !== undefined) {
        return exact.identifier;
      }
      try {
        const { id } = resolveRef(store, shortIds, entry);
        return conflicts.find((c) => c.id === id)?.identifier;
      } catch {
        return undefined;
      }
    };
    for (const [list, choice] of [
      [take, "take"],
      [keep, "keep"],
    ] as const) {
      for (const entry of list) {
        const identifier = identifierOf(entry);
        if (identifier === undefined) {
          problems.push({
            code: "reqif.choice-unused",
            severity: "warning",
            message: `${choice}: ${entry} names no conflict of this delivery`,
          });
        } else if (choices.get(identifier) !== undefined && choices.get(identifier) !== choice) {
          throw new CommandError("input.invalid", `${identifier} is in both take and keep`, {
            fields: ["take", "keep"],
            identifier,
            reason: "take-and-keep",
          });
        } else {
          choices.set(identifier, choice);
        }
      }
    }
    return { choices, problems };
  };

/** The error of a failed step with the files the call could not undo added to `details.written`. */
const withWritten = (error: unknown, kept: readonly string[]): unknown => {
  if (kept.length === 0 || !(error instanceof CommandError)) {
    return error;
  }
  const written = Array.isArray(error.details?.["written"]) ? (error.details["written"] as string[]) : [];
  return new CommandError(
    error.code,
    error.message,
    { ...error.details, written: [...written, ...kept] },
    { cause: error },
  );
};

/**
 * The image copies of updated elements, each into its element's image folder, checked like a new
 * copy before and after its folder is created; per repository all or nothing. Returns what was
 * created, to remove it again when a later step fails.
 */
const copyUpdateImages = async (
  layout: WorkspaceLayout,
  images: readonly PlannedUpdateImage[],
): Promise<{ readonly repository: RepositoryLocation; readonly path: string; readonly sha256: string }[]> => {
  const created: { repository: RepositoryLocation; path: string; sha256: string }[] = [];
  const byRepository = new Map<
    RepositoryLocation,
    { path: string; content: ReturnType<typeof imageContent> }[]
  >();
  for (const { repository, file, name, image } of images) {
    const before = await refuseUnlisted(layout, repository, file);
    await createFolder(repository.folder, path.posix.dirname(before));
    const at = await refuseUnlisted(layout, repository, before);
    byRepository.set(repository, [
      ...(byRepository.get(repository) ?? []),
      { path: at, content: imageContent(image, name) },
    ]);
  }
  try {
    for (const [repository, files] of byRepository) {
      for (const { file, snapshot } of await createFilesAtomic(repository.folder, files)) {
        created.push({ repository, path: file.path, sha256: snapshot.sha256 });
      }
    }
  } catch (error) {
    throw withWritten(error, await removeCopies(layout, created));
  }
  return created;
};

/** Removes the copies `copyUpdateImages` created, while unchanged; returns those it could not remove. */
const removeCopies = async (
  layout: WorkspaceLayout,
  created: readonly {
    readonly repository: RepositoryLocation;
    readonly path: string;
    readonly sha256: string;
  }[],
): Promise<string[]> => {
  const kept: string[] = [];
  for (const { repository, path: file, sha256 } of created) {
    for (const left of await removeCreatedFiles(repository.folder, [{ path: file, sha256 }])) {
      kept.push(workspacePath(layout, repository, left));
    }
  }
  return kept;
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
    const missing = layout.repositories.filter((r) => !r.available).map((r) => r.name);
    if (missing.length > 0) {
      throw new CommandError(
        "file.folder-missing",
        `Not imported: repository ${missing.join(", ")} is not on this machine, so elements of an earlier delivery there cannot be matched and would be created again`,
        { repositories: missing },
      );
    }
    const store = await workspace.get(elementStoreState);
    const unreadable = unreadableFiles(store);
    if (unreadable.length > 0) {
      throw new CommandError(
        "file.faulty",
        `Not imported: ${unreadable.map((p) => String(p.file)).join(", ")} cannot be read as elements, so an element of an earlier delivery there would be created again; fix them first`,
        { files: unreadable.map(({ repository, file }) => ({ repository, file })) },
      );
    }
    const shortIds = await workspace.get(shortIdState);
    const existing = await existingElements(
      workspace,
      layout,
      metamodel,
      delivery,
      mapping.source.name,
      originKeys(metamodel),
    );
    const plan = await planImport(
      delivery,
      mapping,
      layout,
      metamodel,
      { delivery: input.delivery, date: importDate(new Date()) },
      imageReader(path.resolve(workspace.root, input.file), ctx.localPaths),
      { existing, choose: chooser(store, shortIds, input.take ?? [], input.keep ?? []) },
    );
    // Every refusal came with the plan; the walk checks of the update copies come before any
    // folder is created, as those of the new files do in spelledFiles.
    for (const { repository, file } of plan.updateImages) {
      await refuseUnlisted(layout, repository, file);
    }
    const [first] = plan.files;
    const prepared =
      first === undefined
        ? undefined
        : await spelledFiles(layout, plan.repository, plan.folder, plan.files, first);
    const newImages =
      prepared === undefined
        ? []
        : await spelledImages(layout, plan.repository, prepared.spelled, plan.images);
    const copies = await copyUpdateImages(layout, plan.updateImages);
    const writes: ElementFileWrite[] = plan.updates.map((u) => u.write);
    let written: WrittenElementFile[];
    try {
      written = await writeElementFiles(workspace, layout, writes, {
        titles: { metamodel, store },
        concurrency: WRITE_CONCURRENCY,
      });
    } catch (error) {
      throw withWritten(error, await removeCopies(layout, copies));
    }
    let files: string[] = [];
    if (prepared !== undefined) {
      try {
        files = await createElementFiles(workspace, layout, plan.repository, prepared.files, newImages);
      } catch (error) {
        const kept = [
          ...(await restoreElementFiles(zip(writes, written))),
          ...(await removeCopies(layout, copies)),
        ];
        await workspace.reset(elementStoreState);
        throw withWritten(error, kept);
      }
    }
    const list = (kind: "updated" | "kept"): ReqifObject[] =>
      plan.updates.filter((u) => u.kind === kind).map(({ identifier, id }) => ({ identifier, id }));
    return {
      created: [...plan.created],
      updated: list("updated"),
      kept: list("kept"),
      dropped: [...plan.dropped],
      losses: [...plan.losses],
      files: [
        ...written.map((w) => w.file),
        ...copies.map((c) => workspacePath(layout, c.repository, c.path)),
        ...files,
      ],
      problems: [...plan.problems],
    };
  },
});
