// metamodel.changeRelationKind (SR-239 AK2, frame SR-236): changes fields of a relation kind in
// place, in the file it is in (SR-236 AK3, AK4), through the write layer of the metamodel commands.
//
// Every field changes at any time, whatever elements hold: a relation that the new source or target
// types no longer allow, or that breaks a new limit, stays in its element file as it is, and the
// check of the workspace reports it (`relation.not-allowed`, `relation.too-many`, `relation.too-few`;
// SR-086, SR-152). So no use is counted and no repository needs to be on this machine.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { setMapValue } from "../../files/index.js";
import type { MetamodelRelationKind } from "../../generated/types.js";
import type { LineEdit } from "../../metamodel/index.js";
import { definitionAt, editedFiles } from "../../metamodel/index.js";
import { writeMetamodel } from "../../model/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";
import { givenFields, hasValue, refuseTakenName, unknownRelationKind } from "../metamodel-relation-kind.js";

const COMMAND = "metamodel.changeRelationKind";

export default defineCommand({
  name: COMMAND,
  // The relation kind by its name as written afterwards: the metamodel is read again after the change.
  answer: (output) =>
    sentence(
      output.files.length === 0
        ? `The relation kind ${output.relationKind.name} has these values already`
        : `Changed the relation kind ${output.relationKind.name}`,
      filesNote(output.files),
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      output.missingRequired === 0
        ? ""
        : `${counted(output.missingRequired, "element")} missing a required property`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.changeRelationKind">> => {
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files }) => {
      const place = definitionAt(files, "relations", input.kind);
      const own = metamodel.relations.find((r) => r.key === input.kind);
      if (place === undefined || own === undefined) {
        throw unknownRelationKind(input.kind);
      }
      refuseTakenName(metamodel, input.name, input.kind);
      // A field that already has the value is left as it is, with its line; null removes the line.
      const changed = givenFields(input).filter(([field, value]) => !hasValue(own, field, value));
      const edits = changed.map(
        ([field, value]): { readonly file: typeof place.file; readonly edit: LineEdit } => ({
          file: place.file,
          edit: (yaml) =>
            setMapValue(yaml, place.file.path, ["relations", place.index], field, value ?? undefined),
        }),
      );
      // The definition afterwards, in the order of its lines: a changed field in its place, a new one
      // at the end (as `setMapValue` writes it), a removed one left out.
      const values = new Map<string, unknown>(Object.entries(own));
      for (const [field, value] of changed) {
        values.set(field, value);
      }
      const result = Object.fromEntries(
        [...values].filter(([, value]) => value !== null && value !== undefined),
      ) as unknown as MetamodelRelationKind;
      return { bytes: editedFiles(edits), result };
    });
    return {
      relationKind: change.result,
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      versionsChangedElements: [...change.versionsChangedElements],
      missingRequiredElements: [...change.missingRequiredElements],
      problems: change.warnings,
    };
  },
});
