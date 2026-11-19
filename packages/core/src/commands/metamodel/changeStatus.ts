// metamodel.changeStatus (SR-240 AK2, frame SR-236): changes the name, description, invalid mark or
// initial mark of a status in place, in the file it is in (SR-236 AK3, AK4), through the write layer
// of the metamodel commands. Only metamodel files are written, so no element changes its status
// (D-030, SR-087 AK2).
//
// - A status marked initial takes the mark from the status that had it, which may be in another file,
//   so that exactly one status has it; removing the mark from the only initial status leaves none,
//   a metamodel error that refuses the command (SR-236 AK1).
// - A changed invalid mark names the number of elements with the status (D-044), counted over the
//   elements of the store, in any type.
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { setMapValue } from "../../files/index.js";
import type { MetamodelStatus } from "../../generated/types.js";
import type { LineEdit, Metamodel } from "../../metamodel/index.js";
import { definitionAt, editedFiles } from "../../metamodel/index.js";
import { hasStatus, writeMetamodel } from "../../model/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";

const COMMAND = "metamodel.changeStatus";

type Input = CommandInput<"metamodel.changeStatus">;

/** The fields of the input that are written into the definition, in the order they are applied. */
const FIELDS = ["name", "description", "invalid", "initial"] as const;
type Field = (typeof FIELDS)[number];

/** Whether `field` is a mark, which `false` removes. */
const isMark = (field: Field): boolean => field === "invalid" || field === "initial";

/** The value written for `field`; undefined removes its line (null, and false for a mark). */
const written = (input: Input, field: Field): unknown => {
  const value = input[field];
  return value === null || (isMark(field) && value === false) ? undefined : value;
};

/** The value of `field` in `status`; a mark written as false is no mark. */
const current = (status: MetamodelStatus, field: Field): unknown => {
  const value = status[field];
  return isMark(field) && value === false ? undefined : value;
};

/** Refuses a name another status has (SR-236 AK2), compared in Unicode normal form NFC. */
const refuseTaken = (metamodel: Metamodel, input: Input): void => {
  const { name } = input;
  const other =
    name === undefined
      ? undefined
      : metamodel.statuses.find(
          (s) => s.key !== input.status && s.name.normalize("NFC") === name.normalize("NFC"),
        );
  if (other !== undefined) {
    throw new CommandError("input.invalid", `Status ${other.key} already has the name ${String(name)}`, {
      reason: "taken",
      field: "name",
      status: other.key,
    });
  }
};

/** `status` with `changed` fields as the input gives them, in the order of its lines. */
const changedDefinition = (
  status: MetamodelStatus,
  input: Input,
  changed: readonly Field[],
): MetamodelStatus => {
  const values = new Map<string, unknown>(Object.entries(status));
  for (const field of changed) {
    values.set(field, written(input, field));
  }
  return Object.fromEntries(
    [...values].filter(([, value]) => value !== undefined),
  ) as unknown as MetamodelStatus;
};

export default defineCommand({
  name: COMMAND,
  // The status by its name as written afterwards.
  answer: (output) =>
    sentence(
      output.files.length === 0
        ? `The status ${output.status.name} has these values already`
        : `Changed the status ${output.status.name}`,
      output.previousInitial === undefined ? "" : `${output.previousInitial} is no longer the initial status`,
      output.elements === undefined
        ? ""
        : `${counted(output.elements, "element")} ${output.elements === 1 ? "has" : "have"} this status`,
      filesNote(output.files),
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.changeStatus">> => {
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files, store }) => {
      const place = definitionAt(files, "statuses", input.status);
      const own = metamodel.statuses.find((s) => s.key === input.status);
      if (place === undefined || own === undefined) {
        throw new CommandError(
          "input.invalid",
          `Unknown status ${input.status}: the metamodel has no status with this key`,
          { reason: "unknown", status: input.status },
        );
      }
      refuseTaken(metamodel, input);
      // A field that already has the value is left as it is, with its line.
      const changed = FIELDS.filter(
        (field) => input[field] !== undefined && written(input, field) !== current(own, field),
      );
      const edits: { readonly file: typeof place.file; readonly edit: LineEdit }[] = changed.map((field) => ({
        file: place.file,
        edit: (yaml) =>
          setMapValue(yaml, place.file.path, ["statuses", place.index], field, written(input, field)),
      }));
      // The status that had the initial mark loses it, so exactly one has it (SR-240 AK2).
      const previous =
        changed.includes("initial") && input.initial === true
          ? metamodel.statuses.find((s) => s.initial === true)
          : undefined;
      const from = previous === undefined ? undefined : definitionAt(files, "statuses", previous.key);
      if (from !== undefined) {
        edits.push({
          file: from.file,
          edit: (yaml) => setMapValue(yaml, from.file.path, ["statuses", from.index], "initial", undefined),
        });
      }
      return {
        bytes: editedFiles(edits),
        result: {
          status: changedDefinition(own, input, changed),
          previousInitial: previous?.key,
          // The elements with the status, in any type and status of the store (D-044).
          elements: changed.includes("invalid")
            ? store.elements.filter((e) => hasStatus(e, input.status)).length
            : undefined,
        },
      };
    });
    const { status, previousInitial, elements } = change.result;
    return {
      status,
      ...(previousInitial === undefined ? {} : { previousInitial }),
      ...(elements === undefined ? {} : { elements }),
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      problems: change.warnings,
    };
  },
});
