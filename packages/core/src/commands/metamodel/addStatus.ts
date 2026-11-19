// metamodel.addStatus (SR-240 AK1, frame SR-236): gives a type a status, an existing one or a new
// one, through the write layer of the metamodel commands (`writeMetamodel`).
//
// - A new status goes at the end of `statuses` of the first metamodel file by name that has the
//   list, else of the first file (SR-236 AK4); its key is made from the name when none is given
//   (SR-236 AK6), and a name another status has is refused (SR-236 AK2).
// - The type gets the key at the end of its own list, created when it has none, in the file the type
//   is in. A type without a list, neither its own nor an ancestor's, has every status: it gets the
//   list of every status it had and the new one. The output names the other types that get a new
//   status too: those without a list, and those whose list names its key already (a warning before).
// - A type that extends it and has a list of its own would get more statuses: refused, naming it.
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { appendListItem, refuseShared, setMapValue } from "../../files/index.js";
import type { MetamodelStatus } from "../../generated/types.js";
import type { LineEdit, Metamodel } from "../../metamodel/index.js";
import {
  definitionAt,
  editedFiles,
  fileForNew,
  findType,
  keyFromName,
  statusKeysOf,
  statusListHolders,
  typeDefinition,
  widenedTypes,
} from "../../metamodel/index.js";
import { writeMetamodel } from "../../model/index.js";
import { counted, filesNote, listed, problemsNote, sentence } from "../answer.js";

const COMMAND = "metamodel.addStatus";

type Input = CommandInput<"metamodel.addStatus">;

/** The key of a new status: as given, else made from the name (SR-236 AK6). */
const statusKey = (metamodel: Metamodel, name: string, key: string | undefined): string => {
  if (key !== undefined) {
    const other = metamodel.statuses.find((s) => s.key === key);
    if (other !== undefined) {
      throw new CommandError("input.invalid", `The key ${key} is already the key of status ${other.name}`, {
        reason: "taken",
        field: "key",
        status: key,
      });
    }
    return key;
  }
  const made = keyFromName(name);
  const taken = metamodel.statuses.some((s) => s.key === made.key);
  if (made.usable && !taken) {
    return made.key;
  }
  const why = taken
    ? "is already the key of a status"
    : made.key === ""
      ? "is empty"
      : made.key.length > 64
        ? "is longer than 64 characters"
        : "does not start with a letter";
  throw new CommandError(
    "input.invalid",
    `Give a key: the key made from the name${made.key === "" ? "" : `, ${made.key},`} ${why}`,
    { reason: "key-required", key: made.key },
  );
};

/** The refusal of an input that names neither an existing status nor a new one by its name, or both. */
const mixed = (): CommandError =>
  new CommandError(
    "input.invalid",
    "Give either status, the key of an existing status, or name (with key and invalid if needed) for a new one",
    { reason: "status-or-name" },
  );

/** The status the input names, or the new one it describes, and whether it is new. */
const statusOf = (
  metamodel: Metamodel,
  input: Input,
): { readonly status: MetamodelStatus; readonly created: boolean } => {
  if (input.status !== undefined) {
    const found = metamodel.statuses.find((s) => s.key === input.status);
    if (found === undefined) {
      throw new CommandError(
        "input.invalid",
        `Unknown status ${input.status}: the metamodel has no status with this key; give name to add a new one`,
        { reason: "unknown", status: input.status },
      );
    }
    return { status: found, created: false };
  }
  const { name } = input;
  if (name === undefined) {
    throw mixed();
  }
  // A name counts as taken in the same Unicode normal form, as the key is made from it (SR-236 AK6).
  const other = metamodel.statuses.find((s) => s.name.normalize("NFC") === name.normalize("NFC"));
  if (other !== undefined) {
    throw new CommandError("input.invalid", `Status ${other.key} already has the name ${name}`, {
      reason: "taken",
      field: "name",
      status: other.key,
    });
  }
  return {
    status: {
      key: statusKey(metamodel, name, input.key),
      name,
      ...(input.invalid === true ? { invalid: true } : {}),
    },
    created: true,
  };
};

/** Refuses an input that names both an existing status and fields of a new one. */
const refuseMixed = (input: Input): void => {
  const fresh = input.name !== undefined || input.key !== undefined || input.invalid !== undefined;
  if (input.status !== undefined && fresh) {
    throw mixed();
  }
};

export default defineCommand({
  name: COMMAND,
  answer: (output) =>
    sentence(
      `Added the ${output.created ? "new " : ""}status ${output.status.name} to the type ${output.type}`,
      output.alsoTypes.length === 0
        ? ""
        : `${output.alsoTypes.length === 1 ? "the type" : "the types"} ${listed(output.alsoTypes)} ${output.alsoTypes.length === 1 ? "has" : "have"} it too`,
      filesNote(output.files),
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.addStatus">> => {
    refuseMixed(input);
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files }) => {
      const place = definitionAt(files, "types", input.type);
      const type = findType(metamodel, input.type);
      if (place === undefined || type === undefined) {
        throw new CommandError(
          "input.invalid",
          `Unknown type ${input.type}: the metamodel has no type with this key`,
          { reason: "unknown", type: input.type },
        );
      }
      const { status, created } = statusOf(metamodel, input);
      if (type.statuses.includes(status.key)) {
        throw new CommandError("input.invalid", `Type ${input.type} has the status ${status.key} already`, {
          reason: "has",
          type: input.type,
          status: status.key,
        });
      }
      const at = ["types", place.index] as const;
      refuseShared(place.file, place.file.path, at);
      const edits: { readonly file: typeof place.file; readonly edit: LineEdit }[] = [];
      if (created) {
        const target = fileForNew(files, "statuses");
        edits.push({ file: target, edit: (yaml) => appendListItem(yaml, target.path, ["statuses"], status) });
      }
      const own = typeDefinition(metamodel, input.type)?.statuses;
      // A key the own list names already, without a definition (a metamodel warning), is not written twice.
      if (own?.includes(status.key) !== true) {
        edits.push({
          file: place.file,
          edit: (yaml) =>
            own !== undefined
              ? appendListItem(yaml, place.file.path, [...at, "statuses"], status.key)
              : // Its own list: the new status below an inherited list; else every status it had, in
                // metamodel order, and the new one (SR-240 AK1). `setMapValue` also writes into a
                // type in flow style.
                setMapValue(
                  yaml,
                  place.file.path,
                  at,
                  "statuses",
                  statusListHolders(metamodel, input.type).length > 0
                    ? [status.key]
                    : [...type.statuses, status.key],
                ),
        });
      }
      return {
        bytes: editedFiles(edits),
        result: { status, created },
        check: (after: Metamodel): void => {
          const widened = widenedTypes(metamodel, after, input.type);
          if (widened.length > 0) {
            throw new CommandError(
              "input.invalid",
              `Type ${input.type} keeps its statuses: ${listed(widened.map((t) => `type ${t}`))} extends it with a status list of its own and would get more statuses`,
              { reason: "widens", types: widened },
            );
          }
        },
      };
    });
    const { status, created } = change.result;
    const before = change.before;
    // The other types that get the status, except those that extend the type and inherit it: types
    // without a list, and types whose list names the key of a new status already.
    const alsoTypes = change.after.effectiveTypes
      .filter(
        (t) =>
          t.key !== input.type &&
          !t.ancestors.includes(input.type) &&
          t.statuses.includes(status.key) &&
          !statusKeysOf(before, t.key).includes(status.key),
      )
      .map((t) => t.key);
    return {
      type: input.type,
      status,
      created,
      statuses: [...statusKeysOf(change.after, input.type)],
      alsoTypes,
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      problems: change.warnings,
    };
  },
});
