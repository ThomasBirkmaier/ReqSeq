// metamodel.removeRelationKind (SR-239 AK3, frame SR-236): removes a relation kind that no element
// file holds from the file it is in (SR-236 AK3, AK4). No element and no element file changes
// (D-045): the file of an element in any status that holds the key, with a relation of the kind or
// an empty list, refuses the command (SR-236 AK7). Saved filters, perspectives and mapping files
// that name the key are listed, not changed. While the store cannot read an element file, which may
// hold the key, the removal is refused (`file.faulty`, assumption of #1990).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { removeListItem } from "../../files/index.js";
import { definitionAt } from "../../metamodel/index.js";
import {
  holdsKey,
  mentioningFiles,
  elementStoreState,
  refuseMissingRepositories,
  refuseUnreadableFiles,
  refuseUses,
  shortIdState,
  useOf,
  writeMetamodel,
} from "../../model/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, filesNote, problemsNote, sentence } from "../answer.js";
import { unknownRelationKind } from "../metamodel-relation-kind.js";

const COMMAND = "metamodel.removeRelationKind";

export default defineCommand({
  name: COMMAND,
  answer: (output) =>
    sentence(
      `Removed the relation kind ${output.relationKind}`,
      filesNote(output.files),
      output.mentions.length === 0
        ? ""
        : `${counted(output.mentions.length, "file")} naming the removed key, not changed`,
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.removeRelationKind">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const shortIds = await ctx.workspace.get(shortIdState);
    // Before the write layer, so `file.faulty` names the element files, not the metamodel repository.
    refuseUnreadableFiles(await ctx.workspace.get(elementStoreState), COMMAND);
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ files, store }) => {
      const place = definitionAt(files, "relations", input.kind);
      if (place === undefined) {
        throw unknownRelationKind(input.kind);
      }
      refuseMissingRepositories(layout, COMMAND);
      refuseUses(`Relation kind ${input.kind} cannot be removed`, [
        useOf(store, shortIds, "relation", input.kind, (e) => holdsKey(e, input.kind)),
      ]);
      return {
        bytes: new Map([
          [place.file.path, removeListItem(place.file, place.file.path, ["relations"], place.index).bytes],
        ]),
        result: undefined,
      };
    });
    return {
      relationKind: input.kind,
      mentions: [...(await mentioningFiles(layout, new Set([input.kind])))],
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      problems: change.warnings,
    };
  },
});
