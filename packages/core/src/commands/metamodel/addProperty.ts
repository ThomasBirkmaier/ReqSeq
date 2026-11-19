// metamodel.addProperty (SR-238 AK1, frame SR-236): gives a type an existing property or a new one,
// through the write layer of the metamodel commands (`writeMetamodel`), which reads, checks and writes.
//
// - The key goes at the end of the type's own `required` list, or of its `properties` list, in the
//   file of the type (SR-236 AK4); a missing list is added after the definition's last line.
// - A new definition goes at the end of `properties` of the first file by name that has the list,
//   else of the first file (SR-236 AK4), with its name, key, kind and the fields of its kind only;
//   every other field is set with metamodel.changeProperty (SR-238 AK1).
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { appendListItem, refuseSharedAt } from "../../files/index.js";
import type { MetamodelProperty } from "../../generated/types.js";
import type { KindField, LineEdit, Metamodel, MetamodelSource, PropertyKind } from "../../metamodel/index.js";
import {
  definitionAt,
  editedFiles,
  findType,
  newChoices,
  newPropertyKey,
  ownLists,
  propertyDefinition,
  refuseOutsideKind,
  refusePropertyName,
  refuseSingleLimit,
  unknownDefinition,
} from "../../metamodel/index.js";
import { writeMetamodel } from "../../model/index.js";
import { counted, filesNote, listed, problemsNote, sentence } from "../answer.js";

const COMMAND = "metamodel.addProperty";

type Input = CommandInput<"metamodel.addProperty">;

interface Edit {
  readonly file: MetamodelSource["files"][number];
  readonly edit: LineEdit;
}

/** The fields of the input that describe a new property. */
const NEW_FIELDS = ["name", "key", "kind", "choices", "targetTypes", "many", "maxItems"] as const;

/** Refused: the input gives both an existing property and fields of a new one, or neither. */
const propertyOrNew = (): CommandError =>
  new CommandError(
    "input.invalid",
    "Give either the key of an existing property, or the name and kind of a new one",
    { reason: "property-or-new" },
  );

/** The new definition the input describes (SR-238 AK1), with its keys, in the order it is written. */
const newDefinition = (
  metamodel: Metamodel,
  input: Input,
  name: string,
  kind: PropertyKind,
): MetamodelProperty => {
  const given: readonly KindField[] = [
    ...(input.choices === undefined ? [] : (["choices"] as const)),
    ...(input.targetTypes === undefined ? [] : (["target-types"] as const)),
    ...(input.maxItems === undefined ? [] : (["max-items"] as const)),
  ];
  refuseOutsideKind(kind, given);
  refuseSingleLimit(input.many === true, input.maxItems !== undefined);
  refusePropertyName(metamodel, name);
  return {
    key: newPropertyKey(metamodel, name, input.key),
    name,
    kind,
    ...(input.many === true ? { many: true } : {}),
    ...(input.maxItems === undefined ? {} : { "max-items": input.maxItems }),
    ...(input.choices === undefined ? {} : { choices: newChoices([], input.choices) }),
    ...(input.targetTypes === undefined ? {} : { "target-types": input.targetTypes }),
  };
};

export default defineCommand({
  name: COMMAND,
  answer: (output) =>
    sentence(
      `Gave the type ${output.type} the ${output.required ? "required " : ""}${output.defined ? "new " : ""}property ${output.property.name}`,
      output.listedBy.length === 0 ? "" : `also listed by ${listed([...output.listedBy])}`,
      filesNote(output.files),
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      output.missingRequired === 0
        ? ""
        : `${counted(output.missingRequired, "element")} now missing a required property`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.addProperty">> => {
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files }) => {
      const typePlace = definitionAt(files, "types", input.type);
      const type = findType(metamodel, input.type);
      const own = metamodel.types.find((t) => t.key === input.type);
      if (typePlace === undefined || type === undefined || own === undefined) {
        throw unknownDefinition("type", input.type);
      }
      // `many: false` is the default, so it describes no new property.
      const fresh = NEW_FIELDS.some((field) => input[field] !== undefined && input[field] !== false);
      const { name, kind } = input;
      const edits: Edit[] = [];
      let property: MetamodelProperty;
      if (input.property === undefined) {
        if (name === undefined || kind === undefined) {
          throw propertyOrNew();
        }
        const definition = newDefinition(metamodel, input, name, kind);
        const target =
          files.find((f) => (f.data as { readonly properties?: unknown }).properties !== undefined) ??
          files[0];
        edits.push({
          file: target,
          edit: (yaml) => appendListItem(yaml, target.path, ["properties"], definition),
        });
        property = definition;
      } else {
        if (fresh) {
          throw propertyOrNew();
        }
        property = propertyDefinition(metamodel, input.property);
      }
      const { key } = property;
      if (type.properties.includes(key)) {
        throw new CommandError("input.invalid", `Type ${input.type} has the property ${key} already`, {
          reason: "has-property",
          type: input.type,
          property: key,
        });
      }
      const { file, index } = typePlace;
      // The type's definition changes: an anchor or alias in it is refused (SR-236 AK5).
      refuseSharedAt(file, file.path, ["types", index]);
      // A key the type lists already without a definition (a metamodel warning) is not listed twice.
      const lists = ownLists(own, key);
      const required = input.required || lists.required !== -1;
      if ((required ? lists.required : lists.properties) === -1) {
        const list = required ? "required" : "properties";
        edits.push({ file, edit: (yaml) => appendListItem(yaml, file.path, ["types", index, list], key) });
      }
      // The other types that list the key of a new definition have the property now too.
      const listedBy = metamodel.types
        .filter((t) => t.key !== input.type && input.property === undefined)
        .filter((t) => {
          const other = ownLists(t, key);
          return other.properties !== -1 || other.required !== -1;
        })
        .map((t) => t.key);
      return { bytes: editedFiles(edits), result: { property, required, listedBy } };
    });
    return {
      type: input.type,
      property: change.result.property,
      required: change.result.required,
      defined: input.property === undefined,
      listedBy: [...change.result.listedBy],
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      versionsChangedElements: [...change.versionsChangedElements],
      missingRequiredElements: [...change.missingRequiredElements],
      problems: change.warnings,
    };
  },
});
