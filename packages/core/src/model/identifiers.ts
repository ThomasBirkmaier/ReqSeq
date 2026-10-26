// Duplicate identifiers (#305): an identifier (the property with the meaning `identifier`, an ID from
// another source such as SR-036, D-017) is unique per type. When elements of one type share one
// (compared in any case, as references compare it), each of them gets a hint naming the others: a
// reference by that identifier is ambiguous (`ref.ambiguous`) until a person gives one of them
// another identifier. The tool changes neither file. Elements of different types may share an
// identifier; a reference by it is ambiguous as well, but that is no finding.
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementRecord } from "./elements.js";
import { identifierKeyOf, identifierValue } from "./identifier-index.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore, StoreUpdate } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

/** What the check reads: the key from the metamodel, the identifiers from the short IDs. */
export interface IdentifierContext {
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

const where = (element: ElementRecord): string => `${element.file} (${element.repository})`;

/**
 * The finding of `element` when another element of its type has its identifier: one
 * `element.duplicate-identifier`, severity `warning`, at the identifier key, naming the other files
 * (not their short IDs, which may change when other elements come, D-056). Another file is another
 * element, also when `element` is a record of a file just read and `shortIds` hold the one before.
 */
export const duplicateIdentifierFindings = (
  element: ElementRecord,
  context: IdentifierContext,
): readonly LocatableFinding[] => {
  const { metamodel, shortIds } = context;
  const identifier = shortIds.identifierOf(element);
  const key = identifierKeyOf(metamodel);
  if (identifier === undefined || key === undefined) {
    return [];
  }
  const others = shortIds
    .withIdentifier(identifier)
    // The element itself and its copies (one UUID, SR-088; duplicate-id names those) are left out.
    .filter((e) => e.type === element.type && e.id !== element.id);
  if (others.length === 0) {
    return [];
  }
  const type = findType(metamodel, element.type)?.name ?? element.type;
  return [
    {
      element,
      path: [key],
      problem: {
        code: "element.duplicate-identifier",
        severity: "warning",
        message: `The identifier ${identifier} is also on ${type} ${others.map(where).join(", ")}; an identifier is unique per type, so a reference by it is ambiguous: give one of them another ${key}`,
        repository: element.repository,
        file: element.file,
        elementId: element.id,
      },
    },
  ];
};

/** The findings of every element of `store`, in store order; none when no property has the meaning. */
export const allDuplicateIdentifierFindings = (
  store: ElementStore,
  context: IdentifierContext,
): readonly LocatableFinding[] =>
  identifierKeyOf(context.metamodel) === undefined
    ? []
    : store.elements.flatMap((element) => duplicateIdentifierFindings(element, context));

/**
 * The elements of the new store whose finding may have changed with `update` although their files
 * did not: those that have an identifier a changed file had before or has now.
 */
const sharing = (update: StoreUpdate, context: IdentifierContext): readonly ElementRecord[] => {
  const key = identifierKeyOf(context.metamodel);
  const values = new Set<string>();
  for (const id of update.ids) {
    for (const element of [...(update.from.byId.get(id) ?? []), ...(update.to.byId.get(id) ?? [])]) {
      const value = identifierValue(element, key);
      if (value !== undefined) {
        values.add(value);
      }
    }
  }
  return [...values].flatMap((value) => context.shortIds.withIdentifier(value));
};

/**
 * Every element whose identifier another element of its type has, for `workspace.check` and
 * `hint.list`, with the line of the identifier. Nothing against a metamodel that is not valid (#208,
 * #220). Carried over a change of the store (#184): the changed files and the elements that share
 * an identifier with them before or after are looked at again.
 */
export const duplicateIdentifierProblemsState = defineWorkspaceState(
  "duplicate-identifiers",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    if (!metamodel.valid) {
      return [];
    }
    const [store, shortIds] = await Promise.all([
      workspace.get(elementStoreState),
      workspace.get(shortIdState),
    ]);
    return locateFindings(layout, allDuplicateIdentifierFindings(store, { metamodel, shortIds }));
  },
  {
    dependsOn: [elementStoreState, metamodelState, shortIdState],
    carry: carryStoreUpdate((value, update, workspace) => {
      // Synchronously, so these are the short IDs carried over the same update.
      const context = Promise.all([workspace.get(metamodelState), workspace.get(shortIdState)]).then(
        ([metamodel, shortIds]): IdentifierContext => ({ metamodel, shortIds }),
      );
      return carryProblems(workspace, value, update, {
        findingsOf: context.then((c) => (element) => duplicateIdentifierFindings(element, c)),
        again: context.then((c) => sharing(update, c)),
        skip: context.then((c) => !c.metamodel.valid),
      });
    }),
  },
);
