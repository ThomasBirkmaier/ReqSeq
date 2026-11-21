// element.update (SR-001, SR-102, SR-106): changes title, text or properties of one element. Only the lines
// of the changed keys and the text are rewritten; unknown properties, the file name and the UUID
// stay. Status changes only through element.setStatus (ADR-0002 rule 6). `affected` is the number
// of directly affected elements when the save changed the version, else 0 (SR-024 AK2, AK3). See
// model/write.ts. `expectedFileSha256` is the caller's write precondition, `fileSha256` the hash of
// the file as written for the next save (SR-106); `repository` picks one copy of a duplicate as in
// element.get (ThomasBirkmaier/ReqSeq-archive#255). A variant is not written with validity entries (SR-039 AK2, variants/nested.ts).
// The element has its verification and validation status as element.get gives it (#214), with `names`
// for its variants and views (#1216). With `dryRun` it checks and shows the change without writing
// (SR-246): `dryRun` and `filesToWrite` in the output, `files` empty, `fileSha256` of the file as read.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { shortIdState, updateElement } from "../../model/index.js";
import { elementHints } from "../../hints/index.js";
import { writtenWithNames } from "../../data/index.js";
import { nestedVariantCheck } from "../../variants/index.js";
import { counted, filesNote, named, problemsNote, sentence, toWriteNote } from "../answer.js";

export default defineCommand({
  name: "element.update",
  answer: (output) =>
    sentence(
      `${output.dryRun === true ? "Dry run: would update" : "Updated"} ${named(output.element)}`,
      output.affected === 0 ? "" : `${counted(output.affected, "element")} directly affected`,
      toWriteNote(output.filesToWrite),
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"element.update">> => {
    const written = await updateElement(
      ctx.workspace,
      input,
      elementHints,
      await nestedVariantCheck(ctx.workspace, "element.update"),
    );
    const { fileSha256, files, problems, affected, dryRun } = written;
    const { element, ...names } = await writtenWithNames(ctx.workspace, written.element, dryRun?.record);
    const shortIds = await ctx.workspace.get(shortIdState);
    return {
      element,
      ...names,
      fileSha256,
      files: [...files],
      ...(dryRun === undefined ? {} : { dryRun: true as const, filesToWrite: [...dryRun.files] }),
      affected,
      // The elements `affected` counts (SR-224 AK4).
      affectedElements: written.affectedElements.map((record) => ({
        id: record.id,
        shortId: shortIds.of(record),
        repository: record.repository,
      })),
      problems: [...problems],
    };
  },
});
