// metamodel.removeStatus (SR-240 AK3, frame SR-236): removes a status from a type, in the file the
// type is in (SR-236 AK3, AK4), through the write layer of the metamodel commands. No element and no
// element file changes (D-045, D-030).
//
// - Refused while an element of the type or of a type that extends it has the status, in any status
//   of the element's own life (SR-236 AK7), and while a repository is not on this machine.
// - A status the type has from an ancestor's list is removed at that type: refused, naming it.
// - A type without a list, neither its own nor an ancestor's, gets the list of every status it had
//   but this one; a type that extends it with a list of its own would then get more statuses, which
//   is refused (as in metamodel.addStatus).
// - Once no type has the status, also no type without a list, its definition goes, unless an
//   element of any type still has the status: then it stays and `kept` names it with the number of
//   those elements (`keptDefinitions`). The initial status's definition never goes, but `kept`
//   names it the same way (SR-240 AK3). Saved filters, perspectives and mapping files that name a
//   removed definition are listed.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { refuseShared, removeListItem, setMapValue } from "../../files/index.js";
import type { LineEdit, Metamodel } from "../../metamodel/index.js";
import {
  definitionAt,
  editedFiles,
  findType,
  statusListHolders,
  typeDefinition,
  widenedTypes,
} from "../../metamodel/index.js";
import {
  hasStatus,
  keptDefinitions,
  keptNote,
  mentioningFiles,
  refuseMissingRepositories,
  refuseUses,
  shortIdState,
  useOf,
  withSubtypes,
  writeMetamodel,
} from "../../model/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, filesNote, listed, problemsNote, sentence } from "../answer.js";

const COMMAND = "metamodel.removeStatus";

/**
 * Whether any type but `type` has `status` once the own list of `type` is `list`: a type whose chain
 * has no list has every status, else a list of the chain names it.
 */
const keptElsewhere = (
  metamodel: Metamodel,
  type: string,
  status: string,
  list: readonly string[],
): boolean =>
  metamodel.effectiveTypes
    .filter((t) => t.key !== type)
    .some((t) => {
      const lists = [t.key, ...t.ancestors].flatMap((key) => {
        const statuses = key === type ? list : typeDefinition(metamodel, key)?.statuses;
        return statuses === undefined ? [] : [statuses];
      });
      return lists.length === 0 || lists.some((l) => l.includes(status));
    });

export default defineCommand({
  name: COMMAND,
  answer: (output) =>
    sentence(
      `Removed the status ${output.status} from the type ${output.type}`,
      output.removed ? "no type has it any more, so its definition went too" : "",
      keptNote(output.kept),
      filesNote(output.files),
      output.mentions.length === 0
        ? ""
        : `${counted(output.mentions.length, "file")} naming a removed key, not changed`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.removeStatus">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files, store }) => {
      const place = definitionAt(files, "types", input.type);
      const type = findType(metamodel, input.type);
      if (place === undefined || type === undefined) {
        throw new CommandError(
          "input.invalid",
          `Unknown type ${input.type}: the metamodel has no type with this key`,
          { reason: "unknown", type: input.type },
        );
      }
      const status = metamodel.statuses.find((s) => s.key === input.status);
      if (status === undefined || !type.statuses.includes(status.key)) {
        throw new CommandError(
          "input.invalid",
          status === undefined
            ? `Unknown status ${input.status}: the metamodel has no status with this key`
            : `Type ${input.type} does not have the status ${input.status}`,
          { reason: status === undefined ? "unknown" : "not-had", type: input.type, status: input.status },
        );
      }
      const holders = statusListHolders(metamodel, input.type);
      const inherited = holders.filter(
        (h) => h.key !== input.type && h.statuses?.includes(status.key) === true,
      );
      if (inherited.length > 0) {
        const at = inherited.map((h) => h.key);
        throw new CommandError(
          "input.invalid",
          `Type ${input.type} has the status ${status.key} from the status list of ${listed(at.map((k) => `type ${k}`))}; remove it there`,
          { reason: "inherited", type: input.type, status: status.key, types: at },
        );
      }
      refuseMissingRepositories(layout, COMMAND);
      const scope = withSubtypes(metamodel, input.type);
      refuseUses(`Type ${input.type} keeps the status ${status.key} while elements have it`, [
        useOf(store, shortIds, "status", status.key, (e) => scope.has(e.type) && hasStatus(e, status.key)),
      ]);
      const at = ["types", place.index] as const;
      refuseShared(place.file, place.file.path, at);
      const own = typeDefinition(metamodel, input.type)?.statuses;
      const edits: { readonly file: typeof place.file; readonly edit: LineEdit }[] = [];
      let list: readonly string[];
      if (own !== undefined) {
        // Not inherited, so the own list has it: each time it is there, from the last one up.
        list = own.filter((key) => key !== status.key);
        const positions = own.flatMap((key, index) => (key === status.key ? [index] : [])).reverse();
        for (const index of positions) {
          edits.push({
            file: place.file,
            edit: (yaml) => removeListItem(yaml, place.file.path, [...at, "statuses"], index),
          });
        }
      } else {
        // No list in its chain (an ancestor's would have it, refused above): every status it had,
        // in metamodel order, but this one (SR-240 AK3).
        list = type.statuses.filter((key) => key !== status.key);
        edits.push({
          file: place.file,
          edit: (yaml) => setMapValue(yaml, place.file.path, at, "statuses", list),
        });
      }
      const unhad = !keptElsewhere(metamodel, input.type, status.key, list);
      const { statuses, kept } = keptDefinitions(store, shortIds, {
        properties: [],
        statuses: unhad ? [status.key] : [],
      });
      // The initial status's definition never goes, also when no element has it (SR-240 AK3).
      const removed = statuses.length > 0 && status.initial !== true;
      const definition = removed ? definitionAt(files, "statuses", status.key) : undefined;
      if (definition !== undefined) {
        edits.push({
          file: definition.file,
          edit: (yaml) => removeListItem(yaml, definition.file.path, ["statuses"], definition.index),
        });
      }
      return {
        bytes: editedFiles(edits),
        result: { removed, kept },
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
    return {
      type: input.type,
      status: input.status,
      removed: change.result.removed,
      kept: [...change.result.kept],
      mentions: change.result.removed ? [...(await mentioningFiles(layout, new Set([input.status])))] : [],
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      versionsChangedElements: [...change.versionsChangedElements],
      missingRequiredElements: [...change.missingRequiredElements],
      problems: change.warnings,
    };
  },
});
