// metamodel.addType (SR-237 AK1, frame SR-236): adds a type at the end of `types` of the first
// metamodel file by name that has the list, else of the first file (SR-236 AK4), through the write
// layer of the metamodel commands (`changeMetamodel`), which reads, checks and writes.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { appendListItem } from "../../files/index.js";
import type { MetamodelType } from "../../generated/types.js";
import type { Metamodel } from "../../metamodel/index.js";
import { keyFromName } from "../../metamodel/index.js";
import { writeMetamodel } from "../../model/index.js";

const COMMAND = "metamodel.addType";

/** The key of the new type: as given, else made from the name (SR-236 AK6). */
const typeKey = (metamodel: Metamodel, name: string, key: string | undefined): string => {
  if (key !== undefined) {
    return key;
  }
  const made = keyFromName(name);
  const taken = metamodel.types.some((t) => t.key === made.key);
  if (made.usable && !taken) {
    return made.key;
  }
  const why = taken
    ? "is already the key of a type"
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
  run: async (ctx, input): Promise<CommandOutput<"metamodel.addType">> => {
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files }) => {
      refuseTaken(metamodel, input.name, input.prefix);
      const title = metamodel.meanings.title[0];
      const added: MetamodelType = {
        key: typeKey(metamodel, input.name, input.key),
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
      problems: change.warnings,
    };
  },
});
