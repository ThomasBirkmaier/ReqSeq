// A variant builds only on the core (SR-039, D-020): a variant whose own validity names entries would
// be a variant of a variant. Only the validity decides (SR-039 AK2): a relation between two variants
// is no nesting. The validity is the property with the meaning `validity` (`validityOf`, SR-013),
// read as the view reads it (`validityEntries`); every entry counts, also one that names no variant,
// since a variant builds on nothing but the core. In the standard model the type Variant has no
// validity, so the case does not arise there.
//
// - Writes: `element.create`, `element.update` and `element.bulkUpdate` refuse with `variant.nested`
//   (SR-039 AK2). The commands pass `nestedVariantCheck` to the model's write path (`WriteCheck`),
//   which asks it on each element as it is about to be written; a bulk preview lists the hints.
// - Files written by hand: `workspace.check`, `hint.list` and `element.get` give one hint
//   `variant.nested` (a `warning`) at the line of each entry (SR-039 AK3).
//
// N-036: one pass over the variants of the workspace (variants are few); other elements are not read.
import type { CommandName, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, LocatableFinding, SupersededContext, WriteCheck } from "../model/index.js";
import {
  elementLabel,
  elementStoreState,
  locateFindings,
  resolveTarget,
  shortIdState,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Validity } from "./views.js";
import { validityEntries, validityOf, validityTarget } from "./views.js";

/** The validity and the variant types that have it. */
interface Scope {
  readonly validity: Validity;
  readonly types: ReadonlySet<string>;
}

/**
 * Undefined when no type with the meaning `variant` has the validity (the standard model: a
 * `validity` key written by hand on a variant there is an unknown property, SR-016), or the metamodel
 * is not valid.
 */
const scopeOf = (metamodel: Metamodel): Scope | undefined => {
  const validity = validityOf(metamodel);
  // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
  if (!metamodel.valid || validity === undefined) {
    return undefined;
  }
  const types = new Set(
    typesWithMeaning(metamodel, "variant")
      .filter((t) => t.properties.includes(validity.key))
      .map((t) => t.key),
  );
  return types.size === 0 ? undefined : { validity, types };
};

/** One hint per validity entry of `record` when its type has the meaning `variant`, before their lines are known. */
const findingsOf = (context: SupersededContext, scope: Scope, record: ElementRecord): LocatableFinding[] => {
  if (!scope.types.has(record.type)) {
    return [];
  }
  // A new element (`element.create`) has an ID nobody knows yet.
  const source = context.store.byId.has(record.id) ? elementLabel(context, record) : "the new variant";
  return validityEntries(scope.validity, record).map(({ path, value }) => {
    const target = validityTarget(value, record);
    const match = target === undefined ? undefined : resolveTarget(context.store, record.repository, target);
    // The element the entry names when it resolves to one, else its UUID; a free name names none.
    const named =
      match?.kind === "found" ? elementLabel(context, match.element) : (target?.id ?? "no element");
    const problem: Problem = {
      code: "variant.nested",
      severity: "warning",
      message: `${scope.validity.label} of ${source} names ${named}, but a variant builds only on the core (D-020)`,
      repository: record.repository,
      file: record.file,
      elementId: record.id,
      ...(match?.kind === "found" ? { targetId: match.element.id } : {}),
    };
    return { element: record, path, problem };
  });
};

/** The `variant.nested` hints of one element, for a command that shows it (`element.get`). */
export const nestedVariantFindingsOf = (
  context: SupersededContext,
  record: ElementRecord,
): readonly LocatableFinding[] => {
  const scope = scopeOf(context.metamodel);
  return scope === undefined ? [] : findingsOf(context, scope, record);
};

/**
 * The write check of `element.create`, `element.update` and `element.bulkUpdate` (SR-039 AK2): a
 * variant is not written with validity entries. The refusal `variant.nested` names each refused
 * variant and what its entries name; `details.elements` holds the UUIDs of those already stored. Undefined when no variant type
 * has the validity (the standard model) or the metamodel is not valid. The short IDs the message
 * needs are read only when a variant is written (N-036).
 */
export const nestedVariantCheck = async (
  workspace: Workspace,
  command: CommandName,
): Promise<WriteCheck | undefined> => {
  const metamodel = await workspace.get(metamodelState);
  const scope = scopeOf(metamodel);
  if (scope === undefined) {
    return undefined;
  }
  const store = await workspace.get(elementStoreState);
  return {
    types: scope.types,
    findings: async (record) =>
      findingsOf({ metamodel, store, shortIds: await workspace.get(shortIdState) }, scope, record),
    refusal: (findings) =>
      new CommandError(
        "variant.nested",
        `Not written: ${findings.map((f) => f.problem.message).join("; ")}. Write the variant without validity entries; a relation between variants is allowed`,
        {
          command,
          elements: [...new Set(findings.map((f) => f.element.id))].filter((id) => store.byId.has(id)),
        },
      ),
  };
};

/**
 * Every validity entry of a variant in the workspace, as a hint `variant.nested` with repository,
 * file, line, element and, when it resolves, target ID (SR-039 AK3), for `workspace.check` and
 * `hint.list`. One pass over the variants, then the files with hints are read again for the lines.
 */
export const nestedVariantsState = defineWorkspaceState(
  "nested-variants",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const scope = scopeOf(metamodel);
    if (scope === undefined) {
      return [];
    }
    const context = { store, metamodel, shortIds: await workspace.get(shortIdState) };
    const variants = store.elements.filter((e) => scope.types.has(e.type));
    return locateFindings(
      layout,
      variants.flatMap((record) => findingsOf(context, scope, record)),
    );
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
