// metamodel.addRelationKind (SR-239 AK1, frame SR-236): adds a relation kind at the end of
// `relations` of the first metamodel file by name that has the list, else of the first file
// (SR-236 AK4), through the write layer of the metamodel commands, which reads, checks and writes.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { appendListItem } from "../../files/index.js";
import type { MetamodelRelationKind } from "../../generated/types.js";
import type { Metamodel } from "../../metamodel/index.js";
import { keyFromName } from "../../metamodel/index.js";
import { writeMetamodel } from "../../model/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";
import { givenFields, refuseTakenName } from "../metamodel-relation-kind.js";

const COMMAND = "metamodel.addRelationKind";

/**
 * The key of the new relation kind: as given, else made from the name (SR-236 AK6), which must not
 * be the key of a property or relation kind: both are keys in element files (ADR-0004).
 */
const relationKindKey = (metamodel: Metamodel, name: string, key: string | undefined): string => {
  if (key !== undefined) {
    return key;
  }
  const made = keyFromName(name);
  const taken = [...metamodel.properties, ...metamodel.relations].some((d) => d.key === made.key);
  if (made.usable && !taken) {
    return made.key;
  }
  const why = taken
    ? "is already the key of a property or relation kind"
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

export default defineCommand({
  name: COMMAND,
  answer: (output) =>
    sentence(
      `Added the relation kind ${output.relationKind.name}`,
      filesNote(output.files),
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      output.missingRequired === 0
        ? ""
        : `${counted(output.missingRequired, "element")} now missing a required property`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.addRelationKind">> => {
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files }) => {
      refuseTakenName(metamodel, input.name);
      const added = {
        key: relationKindKey(metamodel, input.name, input.key),
        ...Object.fromEntries(givenFields(input)),
      } as MetamodelRelationKind;
      const target =
        files.find((f) => (f.data as { readonly relations?: unknown }).relations !== undefined) ?? files[0];
      return {
        bytes: new Map([[target.path, appendListItem(target, target.path, ["relations"], added).bytes]]),
        result: added,
      };
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
