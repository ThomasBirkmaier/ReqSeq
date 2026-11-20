// The last change of the metamodel made in the app (SR-130 AK7): after a metamodel command succeeds in the
// command prompt (`metamodel-prompt.ts`), the graph and the text mark every place where a definition it
// added or changed appears, until the next such command, until a workspace is opened or until the app ends.
// Pure display (ADR-0002): the definitions are the ones the command's output names; this module only says
// where they are shown. Only the places that show the definition itself, never one where another definition
// names it (the "extends" of a type that extends it, a source, target or limit type of a relation kind).
// - "Add type" and "Change type definition": the type (`type`), at its head, its own "extends" row and the
//   "extends" label of its curve to its parent.
// - "Add property to type": the property in that type and in the types that inherit it from there.
// - "Change property definition": the property wherever it is shown, also its curves.
// - "Add relation kind" and "Change relation kind": the kind (`relationKind`), its label lines, its row and
//   its limit rows.
// - "Add status to type": the status in that type, in the types that inherit it from there, and in the other
//   types that have it now (`alsoTypes`).
// - "Change status definition": the status wherever it is shown, and the one that lost the initial mark
//   (`previousInitial`).
// - A removal marks nothing; a command that does not change the metamodel, or whose output names no written
//   file (`files`), leaves the marks as they are.
import type { CommandTypes, MetamodelGetOutput } from "@reqseq/core";

/** The definitions the last metamodel command added or changed, and where each counts. */
export interface MetamodelChange {
  readonly types: readonly string[];
  /** A property, in `type` and the types that extend it; without `type` in every type. */
  readonly properties: readonly { readonly key: string; readonly type?: string }[];
  /** A status, in `types` and the types that extend one of them; without `types` in every type. */
  readonly statuses: readonly { readonly key: string; readonly types?: readonly string[] }[];
  readonly kinds: readonly string[];
}

export const NO_CHANGE: MetamodelChange = { types: [], properties: [], statuses: [], kinds: [] };

type Out<Name extends keyof CommandTypes> = CommandTypes[Name]["output"];

/**
 * What the output of `command` added or changed; undefined for a command that changes no metamodel, which
 * leaves the marks as they are.
 */
export const changeOf = (command: string, output: unknown): MetamodelChange | undefined => {
  const change = definitionsOf(command, output);
  // A command that wrote no file (the same value confirmed) changed nothing: the marks stay.
  return change === undefined || (output as { readonly files: readonly unknown[] }).files.length === 0
    ? undefined
    : change;
};

/** What a metamodel command names as added or changed, whether or not it wrote a file. */
const definitionsOf = (command: string, output: unknown): MetamodelChange | undefined => {
  switch (command) {
    case "metamodel.addType":
    case "metamodel.changeType":
      return { ...NO_CHANGE, types: [(output as Out<"metamodel.addType">).type.key] };
    case "metamodel.addProperty": {
      const added = output as Out<"metamodel.addProperty">;
      return { ...NO_CHANGE, properties: [{ key: added.property.key, type: added.type }] };
    }
    case "metamodel.changeProperty":
      return {
        ...NO_CHANGE,
        properties: [{ key: (output as Out<"metamodel.changeProperty">).property.key }],
      };
    case "metamodel.addRelationKind":
    case "metamodel.changeRelationKind":
      return { ...NO_CHANGE, kinds: [(output as Out<"metamodel.addRelationKind">).relationKind.key] };
    case "metamodel.addStatus": {
      const added = output as Out<"metamodel.addStatus">;
      return { ...NO_CHANGE, statuses: [{ key: added.status.key, types: [added.type, ...added.alsoTypes] }] };
    }
    case "metamodel.changeStatus": {
      const changed = output as Out<"metamodel.changeStatus">;
      const before = changed.previousInitial;
      return {
        ...NO_CHANGE,
        statuses: [{ key: changed.status.key }, ...(before === undefined ? [] : [{ key: before }])],
      };
    }
    case "metamodel.removeType":
    case "metamodel.removeProperty":
    case "metamodel.removeRelationKind":
    case "metamodel.removeStatus":
      return NO_CHANGE;
    default:
      return undefined;
  }
};

/** Where the view marks the last change: each test takes the keys of the place it draws. */
export interface ChangeMarks {
  readonly type: (type: string) => boolean;
  /** A property row of a type, or a curve of the property from it. */
  readonly property: (type: string, property: string) => boolean;
  readonly status: (type: string, status: string) => boolean;
  readonly kind: (kind: string) => boolean;
}

const NOTHING = (): boolean => false;

export const NO_MARKS: ChangeMarks = { type: NOTHING, property: NOTHING, status: NOTHING, kind: NOTHING };

/** The marks of `change` in the metamodel `output` shows: a type counts for a scope it is in or extends. */
export const marksOf = (change: MetamodelChange, output: Pick<MetamodelGetOutput, "types">): ChangeMarks => {
  if (change === NO_CHANGE) {
    return NO_MARKS;
  }
  const lines = new Map(output.types.map((type) => [type.key, [type.key, ...type.ancestors]]));
  const within = (type: string, scope: readonly string[] | undefined): boolean =>
    scope === undefined || (lines.get(type) ?? [type]).some((key) => scope.includes(key));
  return {
    type: (type) => change.types.includes(type),
    property: (type, property) =>
      change.properties.some(
        (mark) => mark.key === property && within(type, mark.type === undefined ? undefined : [mark.type]),
      ),
    status: (type, status) => change.statuses.some((mark) => mark.key === status && within(type, mark.types)),
    kind: (kind) => change.kinds.includes(kind),
  };
};
