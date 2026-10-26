// What the compilers of the filter conditions share (condition.ts, property.ts, relation.ts).
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { FilterCondition, MetamodelProperty } from "../generated/types.js";
import type { Metamodel, PropertyMeaning } from "../metamodel/index.js";
import { meaningUnassigned, propertyWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { EvidenceStatuses } from "./evidence.js";

/** A compiled condition: whether an element of the store meets it. */
export type Predicate = (element: ElementRecord) => boolean;

/** The states a query reads, each read once (ADR-0008); `store` and `shortIds` belong together. */
export interface QueryContext {
  readonly workspace: Workspace;
  /** The command the query runs for, named by `metamodel.meaning-unassigned` (SR-013 AK3). */
  readonly command: CommandName;
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
  /** The view of the selection: the default view of `verification` (SR-047). */
  readonly view: View | undefined;
}

/** What applying the predicates of one query found besides the elements. */
export interface QueryNotes {
  /** A condition on the other end of a relation met a target it cannot see (SR-006 AK2). */
  incomplete: boolean;
}

/** What the compilers of the operators share while one condition is compiled. */
export interface CompileContext extends QueryContext {
  readonly notes: QueryNotes;
  /** Compiles a nested condition, `at` the path of its field. */
  readonly compile: (condition: FilterCondition, at: string) => Promise<Predicate>;
  /** The evidence provider, read on first use (evidence.ts). */
  readonly evidence: () => Promise<EvidenceStatuses>;
}

/** `input.invalid` about the field `at` of the input. */
export const invalidAt = (
  context: Pick<QueryContext, "command">,
  at: string,
  message: string,
): CommandError =>
  new CommandError("input.invalid", `${at}: ${message}`, { command: context.command, fields: [at] });

/** The property with `meaning`; `metamodel.meaning-unassigned` when none has it (SR-013 AK3). */
export const propertyFor = (
  context: Pick<QueryContext, "command" | "metamodel">,
  meaning: PropertyMeaning,
): MetamodelProperty => {
  const property = propertyWithMeaning(context.metamodel, meaning);
  if (property === undefined) {
    throw meaningUnassigned(meaning, context.command);
  }
  return property;
};

/** The values of a frontmatter value: none for absent, `null` and `[]` (ADR-0005), a list's items, else the value. */
export const valuesOf = (value: unknown): readonly unknown[] => {
  if (value === undefined || value === null) {
    return NONE;
  }
  return Array.isArray(value) ? value : [value];
};

const NONE: readonly never[] = Object.freeze([]);

/** A text as conditions and sorting compare it ignoring case: NFC, lower case. */
export const fold = (text: string): string => text.normalize("NFC").toLowerCase();
