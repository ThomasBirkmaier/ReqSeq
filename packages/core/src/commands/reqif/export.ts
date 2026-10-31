// reqif.export (SR-052; ADR-0013 "Export"): the elements of a selection (query/selection.ts,
// SR-101) as one ReqIF 1.2 file at `output`, in the order of the list (`orderedSelection`), planned
// by reqif/export.ts and written by `writeReqif` in chunks. The file is new, or replaces a file that
// still parses as XML and is unchanged since it was read (`writeFileAtomic`); nothing else is
// written and no status is changed (D-030).
//
// - A content the writer refuses (a character XML 1.0 cannot carry, ...) refuses the export with
//   `reqif.invalid` naming each problem; nothing is written.
// - An element whose file changed since the store read it is `file.changed-on-disk`.
// - Not yet: `profile` (SR-101 profiles of a mapping), `mapping` and `omitProperties` (SR-059),
//   `statements` (SR-058) and the copies of embedded images next to the output (ADR-0013): image
//   links are written as the text has them. Each refuses with `input.invalid` naming itself.
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { readFileSnapshot, writeFileAtomic } from "../../files/index.js";
import type { ElementRecord, TargetItem } from "../../model/index.js";
import { resolveTarget, textNow } from "../../model/index.js";
import { PRODUCT_VERSION } from "../../product.js";
import { orderedSelection, resolveSelection } from "../../query/index.js";
import type { ExportedElement } from "../../reqif/export.js";
import { planExport } from "../../reqif/export.js";
import { problemText, writeReqif } from "../../reqif/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

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
    const folders = new Map(layout.repositories.map((r) => [r.name, r.folder]));
    const read = elements.map((record): ExportedElement => {
      const { text } = textNow(folders, record);
      if (text === undefined) {
        throw new CommandError(
          "file.changed-on-disk",
          `Not exported: ${record.file} in repository ${record.repository} changed since it was read; run the export again`,
          { command, file: record.file, repository: record.repository },
        );
      }
      return { record, text };
    });
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
    });
    const written = writeReqif(plan.file);
    if (written.kind === "refused") {
      throw new CommandError(
        "reqif.invalid",
        `Not exported: ${written.problems.slice(0, 5).map(problemText).join("; ")}${written.problems.length > 5 ? `; and ${String(written.problems.length - 5)} more` : ""}`,
        { command, problems: written.problems },
      );
    }
    const absolute = path.resolve(workspace.root, input.output);
    const folder = path.dirname(absolute);
    const name = path.basename(absolute);
    const before = await readFileSnapshot(folder, name);
    if (before.kind === "problem" && !before.missing) {
      throw new CommandError("file.faulty", `output: ${name} cannot be replaced: ${before.problem.message}`, {
        command,
        fields: ["output"],
      });
    }
    const { chunks } = written;
    await writeFileAtomic(folder, name, () => chunks, before.kind === "read" ? before.snapshot : null, {
      kind: "xml",
    });
    const relative = path.relative(workspace.root, absolute);
    return {
      // Relative to the workspace root when it lies inside, else as the absolute path.
      file:
        relative.startsWith("..") || path.isAbsolute(relative)
          ? absolute
          : relative.split(path.sep).join("/"),
      elements: read.length,
      relations: plan.relations,
      files: [],
      problems: [],
    };
  },
});
