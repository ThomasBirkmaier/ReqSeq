// metamodel.removeProperty (SR-238 AK5, frame SR-236): removes a property from a type that has it
// itself, in the file of the type (SR-236 AK3, AK4). No element and no element file changes (D-045).
//
// - The key leaves the type's own `properties` and `required` lists; an inherited property is
//   removed at the type that has it itself (refused here, naming that type). A type that lists a
//   property a parent has as well loses its own entry and keeps the property (`inheritedFrom`).
// - Refused while an element of the type, or of a type that extends it and loses the property,
//   holds its key, also with an empty value, in any status (SR-236 AK7): `lostUses` on the metamodel
//   afterwards, as metamodel.changeType checks a new parent, so a subtype that lists the key itself
//   keeps it and its elements do not count.
// - When no type has the property itself afterwards, its definition goes too (SR-238 AK5).
// - Saved filters, perspectives and mapping files that name a removed definition are listed, not changed.
// - While the store cannot read an element file, which may hold the key, the removal is refused
//   (`file.faulty`, assumption of #1990).
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { refuseSharedAt, removeListItem } from "../../files/index.js";
import type { LineEdit, Metamodel, MetamodelSource } from "../../metamodel/index.js";
import {
  definitionAt,
  editedFiles,
  findType,
  ownLists,
  ownerAbove,
  unknownDefinition,
} from "../../metamodel/index.js";
import {
  lostUses,
  mentioningFiles,
  elementStoreState,
  refuseMissingRepositories,
  refuseUnreadableFiles,
  refuseUses,
  shortIdState,
  withSubtypes,
  writeMetamodel,
} from "../../model/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";

const COMMAND = "metamodel.removeProperty";

interface Edit {
  readonly file: MetamodelSource["files"][number];
  readonly edit: LineEdit;
}

export default defineCommand({
  name: COMMAND,
  answer: (output, input) =>
    sentence(
      `Removed the property ${input.property} from the type ${input.type}${
        output.definitionRemoved ? " and from the metamodel" : ""
      }`,
      output.inheritedFrom === undefined ? "" : `it keeps it from its parent type ${output.inheritedFrom}`,
      filesNote(output.files),
      output.mentions.length === 0
        ? ""
        : `${counted(output.mentions.length, "file")} naming a removed key, not changed`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.removeProperty">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const shortIds = await ctx.workspace.get(shortIdState);
    // Before the write layer, so `file.faulty` names the element files, not the metamodel repository.
    refuseUnreadableFiles(await ctx.workspace.get(elementStoreState), COMMAND);
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files, store }) => {
      const typePlace = definitionAt(files, "types", input.type);
      const type = findType(metamodel, input.type);
      const own = metamodel.types.find((t) => t.key === input.type);
      if (typePlace === undefined || type === undefined || own === undefined) {
        throw unknownDefinition("type", input.type);
      }
      const propertyPlace = definitionAt(files, "properties", input.property);
      if (propertyPlace === undefined) {
        throw unknownDefinition("property", input.property);
      }
      const lists = ownLists(own, input.property);
      const from = ownerAbove(metamodel, type, input.property, "properties");
      if (lists.properties === -1 && lists.required === -1) {
        throw from === undefined
          ? new CommandError(
              "input.invalid",
              `Type ${input.type} does not have the property ${input.property}`,
              { reason: "not-on-type", type: input.type, property: input.property },
            )
          : new CommandError(
              "input.invalid",
              `Type ${input.type} inherits the property ${input.property} from ${from}; remove it there`,
              { reason: "inherited", type: input.type, property: input.property, from },
            );
      }
      refuseMissingRepositories(layout, COMMAND);
      const { file, index } = typePlace;
      // The type's definition changes: an anchor or alias in it is refused (SR-236 AK5).
      refuseSharedAt(file, file.path, ["types", index]);
      const edits: Edit[] = (["properties", "required"] as const)
        .filter((list) => lists[list] !== -1)
        .map((list) => ({
          file,
          edit: (yaml) => removeListItem(yaml, file.path, ["types", index, list], lists[list]),
        }));
      // Required keys are properties too (metamodel.schema.json).
      const kept = metamodel.types.some(
        (t) =>
          t.key !== input.type &&
          (t.properties?.includes(input.property) === true || t.required?.includes(input.property) === true),
      );
      if (!kept) {
        edits.push({
          file: propertyPlace.file,
          edit: (yaml) => removeListItem(yaml, propertyPlace.file.path, ["properties"], propertyPlace.index),
        });
      }
      return {
        bytes: editedFiles(edits),
        result: { definitionRemoved: !kept, from },
        check: (after: Metamodel): void => {
          refuseUses(
            `Property ${input.property} stays in type ${input.type} while elements hold it`,
            lostUses(store, shortIds, metamodel, after, withSubtypes(metamodel, input.type)),
          );
        },
      };
    });
    return {
      type: input.type,
      property: input.property,
      definitionRemoved: change.result.definitionRemoved,
      ...(change.result.from === undefined ? {} : { inheritedFrom: change.result.from }),
      mentions: change.result.definitionRemoved
        ? [...(await mentioningFiles(layout, new Set([input.property])))]
        : [],
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      versionsChangedElements: [...change.versionsChangedElements],
      missingRequiredElements: [...change.missingRequiredElements],
      problems: change.warnings,
    };
  },
});
