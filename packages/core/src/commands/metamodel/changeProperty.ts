// metamodel.changeProperty (SR-238 AK2–AK4, frame SR-236): changes fields of a property, its fixed
// values, and whether a type requires it, in place, in the files they are in (SR-236 AK3, AK4),
// through the write layer of the metamodel commands.
//
// - Name, description, maximum entries, target types, Markdown, part of the version and meaning
//   change at any time (SR-238 AK2); the workspace check reports values that no longer fit.
// - `kind` and `many` change only while no element file holds its key, of any type, also with an
//   empty value (SR-238 AK3, SR-236 AK7: `propertyUse`, the count `metamodel.get` shows). A new kind removes the fields that do not belong to it, and
//   `many: false` removes `max-items`, which the loader allows on lists only (`dropped`).
// - Fixed values (only of kind `choice`): added at the end of `choices`, changed in name and
//   description, removed only while no element has the value (SR-238 AK4). The fixed values a new
//   kind removes count the same way.
// - `type` with `required`: true adds the key to the type's own `required`; false takes it out of
//   there and, when the type would lose the property, adds it to its own `properties`. A requirement
//   a parent type gives is refused, naming that type.
// - A change that needs a count is refused while a repository is not on this machine or the store
//   cannot read an element file (SR-236 AK7, SR-008 AK3, `refuseIncompleteStore`).
import { isDeepStrictEqual } from "node:util";
import type { CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { EditableYaml, YamlEditResult, YamlPath } from "../../files/index.js";
import { appendListItem, refuseShared, removeListItem, setMapValue } from "../../files/index.js";
import type { MetamodelNamed, MetamodelProperty } from "../../generated/types.js";
import type { WorkspaceLayout } from "../../workspace/index.js";
import type {
  DefinitionPlace,
  KindField,
  LineEdit,
  Metamodel,
  MetamodelSource,
  PropertyKind,
} from "../../metamodel/index.js";
import {
  choicesOf,
  definitionAt,
  editedFiles,
  fieldsOutside,
  findType,
  newChoices,
  ownLists,
  ownerAbove,
  propertyDefinition,
  refuseOutsideKind,
  refusePropertyName,
  refuseSingleLimit,
  unknownDefinition,
} from "../../metamodel/index.js";
import type { ElementStore, ShortIds } from "../../model/index.js";
import {
  mentioningFiles,
  propertyUse,
  refuseIncompleteStore,
  refuseUses,
  shortIdState,
  valueUse,
  writeMetamodel,
} from "../../model/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, filesNote, listed, problemsNote, sentence } from "../answer.js";

const COMMAND = "metamodel.changeProperty";

type Input = CommandInput<"metamodel.changeProperty">;

interface Edit {
  readonly file: MetamodelSource["files"][number];
  readonly edit: LineEdit;
}

/** The fields of the input written into the definition, with their key in the file, in this order. */
const FIELDS = [
  ["name", "name"],
  ["description", "description"],
  ["kind", "kind"],
  ["many", "many"],
  ["maxItems", "max-items"],
  ["targetTypes", "target-types"],
  ["markdown", "markdown"],
  ["content", "content"],
  ["meaning", "meaning"],
] as const;

/** The flags whose `false` is no line. */
const FLAGS: ReadonlySet<string> = new Set(["many", "markdown", "content"]);

/** The value written for `field`; undefined removes its line (null, and `false` of a flag). */
const writtenValue = (field: string, value: unknown): unknown =>
  value === null || (FLAGS.has(field) && value === false) ? undefined : value;

/** The fields of a kind the input gives a value to (null removes, so it gives none). */
const kindFieldsGiven = (input: Input): readonly KindField[] => [
  ...(input.addChoices !== undefined || input.changeChoices !== undefined || input.removeChoices !== undefined
    ? (["choices"] as const)
    : []),
  ...(input.targetTypes === undefined || input.targetTypes === null ? [] : (["target-types"] as const)),
  ...(input.maxItems === undefined || input.maxItems === null ? [] : (["max-items"] as const)),
  ...(input.markdown === true ? (["markdown"] as const) : []),
];

/** The fixed value `choice` of `property`, by its position; refused when it has none. */
const choiceAt = (property: MetamodelProperty, choice: string): number => {
  const index = choicesOf(property).findIndex((c) => c.key === choice);
  if (index === -1) {
    throw new CommandError(
      "input.invalid",
      `Unknown fixed value ${choice}: the property ${property.key} has no fixed value with this key`,
      { reason: "unknown", property: property.key, choice },
    );
  }
  return index;
};

/**
 * The fixed values of `property` after the removals and changes of the input, without the added
 * ones. Refuses a fixed value the input both changes and removes, and a new name another fixed value
 * has afterwards (SR-236 AK2); names the metamodel has twice already are left to the workspace check.
 */
const choicesAfter = (property: MetamodelProperty, input: Input): readonly MetamodelNamed[] => {
  const removed = new Set(input.removeChoices);
  const both = (input.changeChoices ?? []).find((c) => removed.has(c.choice));
  if (both !== undefined) {
    throw new CommandError(
      "input.invalid",
      `The fixed value ${both.choice} is both changed and removed; give one of them`,
      { reason: "change-and-remove", property: property.key, choice: both.choice },
    );
  }
  const renamed = new Map((input.changeChoices ?? []).map((c) => [c.choice, c.name]));
  const after = choicesOf(property)
    .filter((c) => !removed.has(c.key))
    .map((c) => ({ ...c, name: renamed.get(c.key) ?? c.name }));
  for (const [choice, name] of renamed) {
    const other = after.find((c) => c.key !== choice && c.name.normalize("NFC") === name?.normalize("NFC"));
    if (other !== undefined) {
      throw new CommandError(
        "input.invalid",
        `The fixed value ${other.key} already has the name ${other.name}`,
        {
          reason: "taken",
          field: "name",
          key: other.key,
        },
      );
    }
  }
  return after;
};

/**
 * The edits of the type's lists for `type` and `required` (see the file comment); none when the type
 * requires the property as asked already.
 */
const requiredEdits = (
  metamodel: Metamodel,
  files: MetamodelSource["files"],
  key: string,
  typeKey: string,
  required: boolean,
): readonly Edit[] => {
  const place = definitionAt(files, "types", typeKey);
  const type = findType(metamodel, typeKey);
  const own = metamodel.types.find((t) => t.key === typeKey);
  if (place === undefined || type === undefined || own === undefined) {
    throw unknownDefinition("type", typeKey);
  }
  const { file, index } = place;
  if (!type.properties.includes(key)) {
    throw new CommandError("input.invalid", `Type ${typeKey} does not have the property ${key}`, {
      reason: "not-on-type",
      type: typeKey,
      property: key,
    });
  }
  if (type.required.includes(key) === required) {
    return [];
  }
  const from = required ? undefined : ownerAbove(metamodel, type, key, "required");
  if (from !== undefined) {
    throw new CommandError(
      "input.invalid",
      `Type ${typeKey} has the property ${key} required by its parent type ${from}; change it there`,
      { reason: "inherited", type: typeKey, property: key, from },
    );
  }
  refuseShared(file, file.path, ["types", index]);
  const list = (name: "properties" | "required"): YamlPath => ["types", index, name];
  if (required) {
    return [{ file, edit: (yaml) => appendListItem(yaml, file.path, list("required"), key) }];
  }
  const lists = ownLists(own, key);
  // Without its own requirement, the type keeps the property through its own list or a parent.
  const keeps = lists.properties !== -1 || ownerAbove(metamodel, type, key, "properties") !== undefined;
  const edits: Edit[] = [
    { file, edit: (yaml) => removeListItem(yaml, file.path, list("required"), lists.required) },
  ];
  if (!keeps) {
    edits.push({ file, edit: (yaml) => appendListItem(yaml, file.path, list("properties"), key) });
  }
  return edits;
};

/** The fields a new kind removes, and `max-items` with `many: false` (see the file comment). */
const droppedFields = (input: Input, own: MetamodelProperty, kind: PropertyKind): readonly KindField[] => {
  const dropped: KindField[] = kind === own.kind ? [] : [...fieldsOutside(own, kind)];
  if (input.many === false && own["max-items"] !== undefined && !dropped.includes("max-items")) {
    dropped.push("max-items");
  }
  return dropped;
};

/**
 * Refuses `type` without `required` or the other way round, a limit for a single value, and a name
 * another property has.
 */
const refuseFields = (input: Input, own: MetamodelProperty, metamodel: Metamodel): void => {
  refuseSingleLimit(
    (input.many ?? own.many) === true,
    input.maxItems !== undefined && input.maxItems !== null,
  );
  if ((input.type === undefined) !== (input.required === undefined)) {
    throw new CommandError("input.invalid", "Give `type` and `required` together", {
      reason: "type-and-required",
    });
  }
  if (input.name !== undefined) {
    refusePropertyName(metamodel, input.name, own.key);
  }
};

/** What the checks of the input give the edits (see the file comment). */
interface Checked {
  /** The fields a new kind or `many: false` removes. */
  readonly dropped: readonly KindField[];
  /** The fixed values removed: those of the input, or all of them with a kind without fixed values. */
  readonly removedChoices: readonly string[];
  /** The fixed values added, with their keys. */
  readonly added: readonly MetamodelNamed[];
}

/** Checks the input against `own` and the uses (see the file comment); refuses by throwing. */
const checked = (
  input: Input,
  own: MetamodelProperty,
  uses: {
    readonly metamodel: Metamodel;
    readonly store: ElementStore;
    readonly shortIds: ShortIds;
    readonly layout: WorkspaceLayout;
  },
): Checked => {
  refuseFields(input, own, uses.metamodel);
  const kind = input.kind ?? own.kind;
  refuseOutsideKind(kind, kindFieldsGiven(input));
  // Only what differs from the definition is a change: the same kind or flag counts nothing.
  const kindChanges = kind !== own.kind;
  const manyChanges = input.many !== undefined && input.many !== (own.many === true);
  const dropped = droppedFields(input, own, kind);
  for (const choice of [
    ...(input.changeChoices ?? []).map((c) => c.choice),
    ...(input.removeChoices ?? []),
  ]) {
    choiceAt(own, choice);
  }
  // A new kind without fixed values takes them all; the input names none then (`refuseOutsideKind`).
  const removedChoices = dropped.includes("choices")
    ? choicesOf(own).map((c) => c.key)
    : (input.removeChoices ?? []);
  const added = newChoices(choicesAfter(own, input), input.addChoices ?? []);
  if (kindChanges || manyChanges || removedChoices.length > 0) {
    refuseIncompleteStore(uses.layout, uses.store, COMMAND);
  }
  const { store, shortIds } = uses;
  refuseUses(`Property ${own.key} keeps its kind, several values and fixed values while elements use them`, [
    ...(kindChanges || manyChanges ? [propertyUse(store, shortIds, own.key)] : []),
    ...removedChoices.map((choice) => valueUse(store, shortIds, own.key, choice)),
  ]);
  return { dropped, removedChoices, added };
};

/** The edits of the definition at `place` itself: its fields, then its fixed values. */
const definitionEdits = (
  input: Input,
  own: MetamodelProperty,
  place: DefinitionPlace,
  { dropped, added }: Checked,
): readonly Edit[] => {
  const { file, index } = place;
  const at: YamlPath = ["properties", index];
  const choices: YamlPath = [...at, "choices"];
  const edit = (change: (yaml: EditableYaml) => YamlEditResult): Edit => ({ file, edit: change });
  const current = own as unknown as Readonly<Record<string, unknown>>;
  const edits: Edit[] = [];
  for (const [field, line] of FIELDS) {
    const value = writtenValue(field, input[field]);
    if (input[field] !== undefined && !isDeepStrictEqual(value, writtenValue(field, current[line]))) {
      edits.push(edit((yaml) => setMapValue(yaml, file.path, at, line, value)));
    }
  }
  for (const field of dropped) {
    edits.push(edit((yaml) => setMapValue(yaml, file.path, at, field, undefined)));
  }
  for (const { choice, ...fields } of input.changeChoices ?? []) {
    const position = choiceAt(own, choice);
    const was = choicesOf(own)[position] as unknown as Readonly<Record<string, unknown>>;
    for (const [field, given] of Object.entries(fields)) {
      const value = writtenValue(field, given);
      if (!isDeepStrictEqual(value, was[field])) {
        edits.push(edit((yaml) => setMapValue(yaml, file.path, [...choices, position], field, value)));
      }
    }
  }
  // From the last position up: a removal moves only the items after it.
  const positions = (input.removeChoices ?? []).map((choice) => choiceAt(own, choice)).sort((a, b) => b - a);
  for (const position of positions) {
    edits.push(edit((yaml) => removeListItem(yaml, file.path, choices, position)));
  }
  for (const choice of added) {
    edits.push(edit((yaml) => appendListItem(yaml, file.path, choices, choice)));
  }
  return edits;
};

export default defineCommand({
  name: COMMAND,
  answer: (output) =>
    sentence(
      output.files.length === 0
        ? `The property ${output.property.name} has these values already`
        : `Changed the property ${output.property.name}`,
      output.dropped.length === 0
        ? ""
        : `removed ${listed([...output.dropped])}, which the new kind or single value does not take`,
      filesNote(output.files),
      output.mentions.length === 0
        ? ""
        : `${counted(output.mentions.length, "file")} naming a removed fixed value, not changed`,
      output.versionsChanged === 0
        ? ""
        : `${counted(output.versionsChanged, "element")} with another version`,
      output.missingRequired === 0
        ? ""
        : `${counted(output.missingRequired, "element")} missing a required property`,
      problemsNote(output.problems),
    ),
  run: async (ctx, input): Promise<CommandOutput<"metamodel.changeProperty">> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const shortIds = await ctx.workspace.get(shortIdState);
    const change = await writeMetamodel(ctx.workspace, COMMAND, ({ metamodel, files, store }) => {
      const place = definitionAt(files, "properties", input.property);
      if (place === undefined) {
        throw unknownDefinition("property", input.property);
      }
      const own = propertyDefinition(metamodel, input.property);
      const result = checked(input, own, { metamodel, store, shortIds, layout });
      const definitionChanges = definitionEdits(input, own, place, result);
      if (definitionChanges.length > 0) {
        // The definition changes: an anchor or alias in it is refused (SR-236 AK5).
        refuseShared(place.file, place.file.path, ["properties", place.index]);
      }
      const edits = [
        ...definitionChanges,
        ...(input.type === undefined || input.required === undefined
          ? []
          : requiredEdits(metamodel, files, own.key, input.type, input.required)),
      ];
      return { bytes: editedFiles(edits), result };
    });
    return {
      // As written afterwards, in the order of its lines.
      property: propertyDefinition(change.after, input.property),
      dropped: [...change.result.dropped],
      mentions:
        change.result.removedChoices.length === 0
          ? []
          : [...(await mentioningFiles(layout, new Set(change.result.removedChoices)))],
      files: change.files,
      versionsChanged: change.versionsChanged,
      missingRequired: change.missingRequired,
      versionsChangedElements: [...change.versionsChangedElements],
      missingRequiredElements: [...change.missingRequiredElements],
      problems: change.warnings,
    };
  },
});
