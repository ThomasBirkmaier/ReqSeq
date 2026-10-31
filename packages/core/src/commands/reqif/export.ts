// reqif.export (SR-052; ADR-0013 "Export"): the elements of a selection (query/selection.ts,
// SR-101) as one ReqIF 1.2 file at `output`, in the order of the list (`orderedSelection`), planned
// by reqif/export.ts and written by `writeReqif` in chunks. The file is new, or replaces a file that
// still parses as XML and is unchanged since it was read (`writeFileAtomic`); no status is changed
// (D-030).
//
// - Images (ADR-0013 "Export"): each image a text embeds that is there (`imageLinks`) is copied to
//   `<output stem>-images/<element file stem>/<name>` next to the output, a name taken twice in one
//   element folder with `-2`, `-3`, ...; the `object` names it relative to the output. A copy is new,
//   or replaces an unchanged earlier copy; one with the same bytes is left as it is. A missing image
//   keeps its link as the text has it. `files` lists the copies.
// - Refused before anything is written: two selected elements with one UUID (`ref.ambiguous`,
//   SR-088: the file would name one IDENTIFIER twice, ReqIF 1.2 §10.8.32), a content the writer
//   refuses (`reqif.invalid` naming each problem), an element or image file changed since it was
//   read (`file.changed-on-disk`), an output that is no XML file (`file.faulty`).
// - Not yet: `profile` (SR-101 profiles of a mapping), `mapping` and `omitProperties` (SR-059) and
//   `statements` (SR-058). Each refuses with `input.invalid` naming itself.
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import {
  createFolder,
  readElementText,
  readFileSnapshot,
  sha256,
  writeFileAtomic,
} from "../../files/index.js";
import type { ElementRecord, TargetItem } from "../../model/index.js";
import { ignoredBy, imageLink, imageLinks, resolveTarget } from "../../model/index.js";
import { PRODUCT_VERSION } from "../../product.js";
import { orderedSelection, resolveSelection } from "../../query/index.js";
import type { ExportedElement } from "../../reqif/export.js";
import { planExport } from "../../reqif/export.js";
import { problemText, writeReqif } from "../../reqif/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../../workspace/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

/** An image copy: its source file and SHA-256 when it was read, and its path relative to the output folder. */
interface ImageCopy {
  readonly folder: string;
  readonly file: string;
  readonly sha256: string;
  readonly target: string;
}

/**
 * The `data` of each image `text` of `record` embeds that is there, by its link path, with the copies
 * it needs added to `copies` (see the file comment).
 */
const imageCopies = async (
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  record: ElementRecord,
  text: string,
  folder: string,
  copies: ImageCopy[],
): Promise<Map<string, string>> => {
  const stem = path.posix.basename(record.file, ".md");
  const data = new Map<string, string>();
  const names = new Map<string, string>();
  for (const link of imageLinks(record.file, text, ignoredBy(layout))) {
    const file = link.names.join("/");
    const read = link.missing ? undefined : await readFileSnapshot(repository.folder, file);
    if (read?.kind !== "read") {
      continue;
    }
    const base = path.posix.basename(link.path);
    const extension = path.posix.extname(base);
    let name = base;
    for (let n = 2; names.has(name.toLowerCase()); n++) {
      name = `${base.slice(0, base.length - extension.length)}-${String(n)}${extension}`;
    }
    names.set(name.toLowerCase(), file);
    const target = `${folder}/${stem}/${name}`;
    copies.push({ folder: repository.folder, file, sha256: read.snapshot.sha256, target });
    data.set(link.path, target.split("/").map(encodeURIComponent).join("/"));
  }
  return data;
};

/** Writes `copy` below `root` (see the file comment). */
const writeCopy = async (root: string, copy: ImageCopy, command: string): Promise<void> => {
  const read = await readFileSnapshot(copy.folder, copy.file);
  if (read.kind !== "read" || sha256(read.bytes) !== copy.sha256) {
    throw new CommandError(
      "file.changed-on-disk",
      `Not exported: the image ${copy.file} changed since it was read; run the export again`,
      { command, file: copy.file },
    );
  }
  await createFolder(root, path.posix.dirname(copy.target));
  const before = await readFileSnapshot(root, copy.target);
  if (before.kind === "read" && before.snapshot.sha256 === copy.sha256) {
    return;
  }
  if (before.kind === "problem" && !before.missing) {
    throw new CommandError(
      "file.faulty",
      `output: ${copy.target} cannot be replaced: ${before.problem.message}`,
      {
        command,
        fields: ["output"],
      },
    );
  }
  await writeFileAtomic(root, copy.target, read.bytes, before.kind === "read" ? before.snapshot : null, {
    kind: "copy",
  });
};

/** `absolute` relative to the workspace `root` when it lies inside, else as it is. */
const shown = (root: string, absolute: string): string => {
  const relative = path.relative(root, absolute);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    ? absolute
    : relative.split(path.sep).join("/");
};

/** The inputs this version does not take yet, each when it asks for something. */
const notYet = (input: CommandInput<"reqif.export">): string[] => [
  ...(input.profile === undefined ? [] : ["profile"]),
  ...(input.mapping === undefined ? [] : ["mapping"]),
  ...((input.omitProperties ?? []).length === 0 ? [] : ["omitProperties"]),
  ...(input.statements === true ? ["statements"] : []),
];

/** The export time: now, in UTC, to the second. */
const exportTime = (now: Date): string => `${now.toISOString().slice(0, 19)}Z`;

export default defineCommand({
  name: "reqif.export",
  run: async (ctx, input): Promise<CommandOutput<"reqif.export">> => {
    const command = "reqif.export";
    const given = notYet(input);
    if (given.length > 0) {
      throw new CommandError(
        "input.invalid",
        `${given.join(", ")}: not available yet in this version; export a selection without ${given.length === 1 ? "it" : "them"}`,
        { command, fields: given },
      );
    }
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const selected = await resolveSelection(workspace, input.selection ?? {}, command);
    const { elements } = orderedSelection(selected, command, undefined);
    const ids = new Set<string>();
    for (const record of elements) {
      if (ids.has(record.id)) {
        throw new CommandError(
          "ref.ambiguous",
          `Not exported: ${record.id} is the UUID of several selected element files (element.duplicate-id); give the copy a new UUID`,
          { command, id: record.id },
        );
      }
      ids.add(record.id);
    }
    const absolute = path.resolve(workspace.root, input.output);
    const outputFolder = path.dirname(absolute);
    const name = path.basename(absolute);
    const imagesFolder = `${path.basename(name, path.extname(name))}-images`;
    const copies: ImageCopy[] = [];
    const read: ExportedElement[] = [];
    for (const record of elements) {
      // A selected element lies in exactly one available repository.
      for (const repository of layout.repositories.filter((r) => r.name === record.repository)) {
        const text = await readElementText(repository.folder, record.file, record.snapshot);
        if (text === undefined) {
          throw new CommandError(
            "file.changed-on-disk",
            `Not exported: ${record.file} in repository ${record.repository} changed since it was read; run the export again`,
            { command, file: record.file, repository: record.repository },
          );
        }
        const images = await imageCopies(layout, repository, record, text, imagesFolder, copies);
        read.push({ record, text, images });
      }
    }
    const target = (source: ElementRecord, item: TargetItem): ElementRecord | undefined => {
      const match = resolveTarget(selected.store, source.repository, item);
      return match.kind === "found" ? match.element : undefined;
    };
    const plan = planExport({
      metamodel: selected.metamodel,
      title: layout.name,
      time: exportTime(new Date()),
      header: randomUUID(),
      sourceToolId: `ReqSeq ${PRODUCT_VERSION}`,
      elements: read,
      targetType: (source, item) => target(source, item)?.type,
      shortId: (source, item) => {
        const found = target(source, item);
        return found === undefined ? item.id : selected.shortIds.of(found);
      },
      image: ({ record, images }, url) => {
        const link = imageLink(record.file, url, () => false);
        return (link === undefined ? undefined : images.get(link.path)) ?? url;
      },
    });
    const written = writeReqif(plan.file);
    if (written.kind === "refused") {
      throw new CommandError(
        "reqif.invalid",
        `Not exported: ${written.problems.slice(0, 5).map(problemText).join("; ")}${written.problems.length > 5 ? `; and ${String(written.problems.length - 5)} more` : ""}`,
        { command, problems: written.problems },
      );
    }
    const before = await readFileSnapshot(outputFolder, name);
    if (before.kind === "problem" && !before.missing) {
      throw new CommandError("file.faulty", `output: ${name} cannot be replaced: ${before.problem.message}`, {
        command,
        fields: ["output"],
      });
    }
    for (const copy of copies) {
      await writeCopy(outputFolder, copy, command);
    }
    const { chunks } = written;
    await writeFileAtomic(outputFolder, name, () => chunks, before.kind === "read" ? before.snapshot : null, {
      kind: "xml",
    });
    return {
      file: shown(workspace.root, absolute),
      elements: read.length,
      relations: plan.relations,
      files: copies.map((copy) => shown(workspace.root, path.join(outputFolder, copy.target))),
      problems: [],
    };
  },
});
