// metamodel.changeType (SR-237 AK2–AK4, frame SR-236): changes fields of a type in place, in the
// file the type is in (SR-236 AK3, AK4), through the write layer of the metamodel commands.
//
// - Name, description and meaning change at any time, and so does removing the abstract mark.
// - A new prefix and the abstract mark need a type no element has (SR-237 AK3); a prefix or mark
//   the type has already changes nothing and counts nothing.
// - A changed parent type is checked on the metamodel afterwards: the properties and statuses the
//   type and its subtypes lose must not be used there (SR-237 AK4, `lostUses`).
// - A change that needs a count is refused while a repository is not on this machine (SR-236 AK7).
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { setMapValue } from "../../files/index.js";
import type { MetamodelType } from "../../generated/types.js";
import type { LineEdit, Metamodel } from "../../metamodel/index.js";
import { definitionAt, editedFiles } from "../../metamodel/index.js";
import type { Use } from "../../model/index.js";
import {
  lostUses,
  refuseMissingRepositories,
  refuseUses,
  shortIdState,
  useOf,
  withSubtypes,
  writeMetamodel,
} from "../../model/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";

const COMMAND = "metamodel.changeType";

type Input = CommandInput<"metamodel.changeType">;

/** The fields of the input that are written into the definition, in the order they are applied. */
const FIELDS = ["name", "description", "prefix", "extends", "abstract", "meaning"] as const;

/** The value written for `field`; undefined removes its line (null, and `abstract: false`). */
const written = (input: Input, field: (typeof FIELDS)[number]): unknown => {
  const value = input[field];
  return value === null || (field === "abstract" && value === false) ? undefined : value;
};

/** Refuses a name or prefix another type has (SR-236 AK2), compared in Unicode normal form NFC. */
const refuseTaken = (metamodel: Metamodel, input: Input): void => {
  for (const field of ["name", "prefix"] as const) {
    const value = input[field];
    const other =
      value === undefined
        ? undefined
        : metamodel.types.find(
            (t) => t.key !== input.type && t[field].normalize("NFC") === value.normalize("NFC"),
          );
    if (other !== undefined) {
      throw new CommandError("input.invalid", `Type ${other.key} already has the ${field} ${String(value)}`, {
        reason: "taken",
        field,
        type: other.key,
      });
    }
  }
};

export default defineCommand({
  name: COMMAND,
  // The type by its name as written afterwards: the metamodel is read again after the change.
  answer: (output) =>
    sentence(
      output.files.length === 0
        ? `The type ${output.type.name} has these values already`
        : `Changed the type ${output.type.name}`,
      filesNote(output.files),
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      output.missingRequired === 0
        ? ""
        : `${counted(output.missingRequired, "element")} missing a required property`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.changeType">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files, store }) => {
      const place = definitionAt(files, "types", input.type);
      const own = metamodel.types.find((t) => t.key === input.type);
      if (place === undefined || own === undefined) {
        throw new CommandError(
          "input.invalid",
          `Unknown type ${input.type}: the metamodel has no type with this key`,
          {
            reason: "unknown",
            type: input.type,
          },
        );
      }
      refuseTaken(metamodel, input);
      // Only what differs from the definition is a change: the same prefix or mark counts nothing.
      const locks =
        (input.prefix !== undefined && input.prefix !== own.prefix) ||
        (input.abstract === true && own.abstract !== true);
      const parentChanges = input.extends !== undefined && (input.extends ?? undefined) !== own.extends;
      if (locks || parentChanges) {
        refuseMissingRepositories(layout, COMMAND);
      }
      if (locks) {
        refuseUses(`Type ${input.type} keeps its prefix and abstract mark while elements have it`, [
          useOf(store, shortIds, "type", input.type, (e) => e.type === input.type),
        ]);
      }
      // A field that already has the value is left as it is, with its line.
      const changed = FIELDS.filter(
        (field) =>
          input[field] !== undefined &&
          written(input, field) !== (own as unknown as Record<string, unknown>)[field],
      );
      const edits = changed.map((field): { readonly file: typeof place.file; readonly edit: LineEdit } => ({
        file: place.file,
        edit: (yaml) =>
          setMapValue(yaml, place.file.path, ["types", place.index], field, written(input, field)),
      }));
      // The definition afterwards, in the order of its lines: a changed field in its place, a new one
      // at the end (as `setMapValue` writes it), a removed one left out.
      const values = new Map<string, unknown>(Object.entries(own));
      for (const field of changed) {
        values.set(field, written(input, field));
      }
      const result = Object.fromEntries(
        [...values].filter(([, value]) => value !== undefined),
      ) as unknown as MetamodelType;
      return {
        bytes: editedFiles(edits),
        result,
        check: (after: Metamodel): void => {
          if (!parentChanges) {
            return;
          }
          // The scope under `before`: the subtypes are the same under both, only the type's parent changes.
          const uses: readonly Use[] = lostUses(
            store,
            shortIds,
            metamodel,
            after,
            withSubtypes(metamodel, input.type),
          );
          refuseUses(`Type ${input.type} keeps its parent type while elements use what it would lose`, uses);
        },
      };
    });
    return {
      type: change.result,
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      problems: change.warnings,
    };
  },
});
