// metamodel.addType (SR-237 AK1, frame SR-236): adds a type at the end of `types` of the first
// metamodel file by name that has the list, else of the first file (SR-236 AK4), through the write
// layer of the metamodel commands (`changeMetamodel`), which reads, checks and writes.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";
import { appendListItem } from "../../files/index.js";
import type { MetamodelType } from "../../generated/types.js";
import type { Metamodel } from "../../metamodel/index.js";
import { keyOrMade } from "../../metamodel/index.js";
import { writeMetamodel } from "../../model/index.js";

const COMMAND = "metamodel.addType";

/** Refuses a name or prefix another type has (SR-236 AK2), compared in Unicode normal form NFC. */
const refuseTaken = (metamodel: Metamodel, name: string, prefix: string): void => {
  for (const field of ["name", "prefix"] as const) {
    const value = field === "name" ? name : prefix;
    // A name counts as taken in the same Unicode normal form, as the key is made from it (SR-236 AK6).
    const other = metamodel.types.find((t) => t[field].normalize("NFC") === value.normalize("NFC"));
    if (other !== undefined) {
      throw new CommandError("input.invalid", `Type ${other.key} already has the ${field} ${value}`, {
        reason: "taken",
        field,
        type: other.key,
      });
    }
  }
};

export default defineCommand({
  name: COMMAND,
  answer: (output, input) =>
    sentence(
      `Added the type ${input.name} with prefix ${input.prefix}`,
      filesNote(output.files),
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      output.missingRequired === 0
        ? ""
        : `${counted(output.missingRequired, "element")} now missing a required property`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.addType">> => {
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files }) => {
      refuseTaken(metamodel, input.name, input.prefix);
      const title = metamodel.meanings.title[0];
      const added: MetamodelType = {
        key: keyOrMade(input.name, input.key, (key) => metamodel.types.some((t) => t.key === key), "a type"),
        name: input.name,
        prefix: input.prefix,
        ...(input.extends === undefined ? {} : { extends: input.extends }),
        ...(input.abstract ? { abstract: true } : {}),
        ...(input.extends === undefined && title !== undefined ? { required: [title] } : {}),
      };
      const target =
        files.find((f) => (f.data as { readonly types?: unknown }).types !== undefined) ?? files[0];
      return {
        bytes: new Map([[target.path, appendListItem(target, target.path, ["types"], added).bytes]]),
        result: added,
      };
    });
    return {
      type: change.result,
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      versionsChangedElements: [...change.versionsChangedElements],
      missingRequiredElements: [...change.missingRequiredElements],
      problems: change.warnings,
    };
  },
});
