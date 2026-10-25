// Relations between allowed types (SR-086, D-012). A relation kind may name the types it goes
// from (`source-types`) and to (`target-types`); a property of kind relation may name its target
// types. A relation between types that are not allowed is a hint (`warning`: it blocks nothing and
// changes no status, glossary "Hinweis") with source, target and relation kind; the file is kept
// unchanged. A source of a type that is not allowed is reported whatever the target. The type of
// the target is checked only when the target resolves to one element of a known type: a target
// that is missing (SR-089), lies in a missing repository (SR-006) or is ambiguous (SR-088) and a
// type the metamodel does not know (SR-016) are other checks, as is a value that is no relation
// target (SR-085).
import type { Problem } from "../catalog.js";
import type { MetamodelKey, RelationTarget } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { allowsType, findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementRecord } from "./elements.js";
import type { IncomingIndex } from "./incoming.js";
import { incomingState } from "./incoming.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { hasId, relationItems, relationKey } from "./relation-keys.js";
import { isRelationTarget, resolveTarget } from "./relations.js";
import type { ShortIds } from "./short-id.js";
import { shortIdGroup, shortIdState } from "./short-id.js";
import type { ElementStore, StoreUpdate } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";
import type { ValuePath } from "./values.js";

/** What the check needs: targets are looked up in the store, messages show short IDs (SR-084). */
export interface RelationTypeContext {
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/**
 * A relation between types that are not allowed, before its line is known (`locateFindings` adds
 * it). `element` is the source; the problem has code `relation.not-allowed`, severity `warning`,
 * repository, file, element and target ID.
 */
export type RelationTypeFinding = LocatableFinding & {
  readonly path: ValuePath;
  /** The target as written in the source file; `resolveTarget` finds its element. */
  readonly target: RelationTarget;
};

/** What the metamodel allows for one key. An absent list allows every type. */
interface Rule {
  /** How messages name the key: kind of definition, display name and key (D-043). */
  readonly label: string;
  readonly many: boolean;
  readonly sources: readonly MetamodelKey[] | undefined;
  readonly targets: readonly MetamodelKey[] | undefined;
  /** What is allowed, for messages: `from System Requirement to Need`. */
  readonly allowed: string;
}

/** The display names of `keys`; a key that names no type is shown as written. */
const typeNames = (metamodel: Metamodel, keys: readonly MetamodelKey[]): string =>
  keys.length === 0 ? "no type" : keys.map((key) => findType(metamodel, key)?.name ?? key).join(", ");

const rule = (
  metamodel: Metamodel,
  label: string,
  many: boolean,
  sources: readonly MetamodelKey[] | undefined,
  targets: readonly MetamodelKey[] | undefined,
): Rule | undefined => {
  if (sources === undefined && targets === undefined) {
    return undefined;
  }
  const allowed = [
    ...(sources === undefined ? [] : [`from ${typeNames(metamodel, sources)}`]),
    ...(targets === undefined ? [] : [`to ${typeNames(metamodel, targets)}`]),
  ].join(" ");
  return { label, many, sources, targets, allowed };
};

/** The rule of a key, undefined for a key whose relations are not restricted or that holds no relations. */
const ruleOf = (metamodel: Metamodel, key: string): Rule | undefined => {
  const found = relationKey(metamodel, key);
  return found === undefined
    ? undefined
    : rule(metamodel, found.label, found.many, found.sourceTypes, found.targetTypes);
};

type Rules = (key: string) => Rule | undefined;

/** One cache per metamodel object; a reset of the metamodel state makes a new object. */
const indexes = new WeakMap<Metamodel, Rules>();

/** The rules by key (`keyDefinition`: a property wins over a relation kind), built on first use. */
const rulesOf = (metamodel: Metamodel): Rules => {
  const known = indexes.get(metamodel);
  if (known !== undefined) {
    return known;
  }
  const cache = new Map<string, Rule | undefined>();
  const rules: Rules = (key) => {
    if (!cache.has(key)) {
      cache.set(key, ruleOf(metamodel, key));
    }
    return cache.get(key);
  };
  indexes.set(metamodel, rules);
  return rules;
};

/**
 * Whether the type of `target` is not allowed. False when that cannot be decided: the target does
 * not resolve to one element (SR-089, SR-006, SR-088) or its type is unknown (SR-016).
 */
const targetNotAllowed = (keyRule: Rule, target: ElementRecord | undefined, metamodel: Metamodel): boolean =>
  target !== undefined &&
  findType(metamodel, target.type) !== undefined &&
  !allowsType(keyRule.targets, target.type, metamodel);

/** How a message names the target: type name and short ID, or the UUID's tail when it does not resolve. */
const targetName = (
  target: RelationTarget,
  element: ElementRecord | undefined,
  context: RelationTypeContext,
): string =>
  element === undefined
    ? context.shortIds.tail(target.id)
    : `${findType(context.metamodel, element.type)?.name ?? element.type} ${context.shortIds.of(element)}`;

const collect = (
  element: ElementRecord,
  rules: Rules,
  context: RelationTypeContext,
  out: RelationTypeFinding[],
): void => {
  const { metamodel, store, shortIds } = context;
  const sourceType = findType(metamodel, element.type);
  if (sourceType === undefined) {
    return;
  }
  for (const [key, value] of Object.entries(element.data)) {
    const keyRule = rules(key);
    if (keyRule === undefined) {
      continue;
    }
    const sourceAllowed = allowsType(keyRule.sources, sourceType.key, metamodel);
    for (const [path, item] of relationItems(key, keyRule, value)) {
      if (!isRelationTarget(item)) {
        continue;
      }
      const match = resolveTarget(store, element.repository, item);
      const resolved = match.kind === "found" ? match.element : undefined;
      if (sourceAllowed && !targetNotAllowed(keyRule, resolved, metamodel)) {
        continue;
      }
      const from = `${sourceType.name} ${shortIds.of(element)}`;
      const to = targetName(item, resolved, context);
      out.push({
        element,
        path,
        target: item,
        problem: {
          code: "relation.not-allowed",
          severity: "warning",
          message: `${keyRule.label} from ${from} to ${to} is not allowed; allowed: ${keyRule.allowed}`,
          repository: element.repository,
          file: element.file,
          elementId: element.id,
          targetId: item.id,
        },
      });
    }
  }
};

/**
 * The relations of one element between types the metamodel does not allow, in the order of the
 * keys in the file, then of the list items. For a command about one element: `element.get` (with
 * `locateFindings` for the lines of just this element) and a command that has just written it.
 */
export const relationTypeFindings = (
  element: ElementRecord,
  context: RelationTypeContext,
): readonly RelationTypeFinding[] => {
  const out: RelationTypeFinding[] = [];
  collect(element, rulesOf(context.metamodel), context, out);
  return out;
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allRelationTypeFindings = (context: RelationTypeContext): readonly RelationTypeFinding[] => {
  const rules = rulesOf(context.metamodel);
  const out: RelationTypeFinding[] = [];
  for (const element of context.store.elements) {
    collect(element, rules, context, out);
  }
  return out;
};

/** Whether `item` names a target (`hasId`) whose UUID lies in one of `groups` (`shortIdGroup`). */
const targetIn = (item: unknown, groups: ReadonlySet<string>): boolean =>
  hasId(item) && groups.has(shortIdGroup(item.id));

/**
 * Whether the findings of `element`, whose file did not change, may differ after a change of the
 * UUIDs of `groups` (`shortIdGroup`): its own UUID lies in one of them (its short ID), or a target
 * of a key with a rule does (the target, its type or its short ID). Used when the workspace has no
 * incoming relation index (`againFromIndex`): no allocation per relation, so it scans 200,000
 * relations in about 40 ms with the walk of `carryProblems`.
 */
const namesGroup = (element: ElementRecord, rules: Rules, groups: ReadonlySet<string>): boolean => {
  if (groups.has(shortIdGroup(element.id))) {
    return true;
  }
  for (const [key, value] of Object.entries(element.data)) {
    const keyRule = rules(key);
    if (keyRule === undefined) {
      continue;
    }
    // Every item of a list, else the value: more than `relationItems` gives, never less.
    const items: readonly unknown[] = Array.isArray(value) ? value : [value];
    if (items.some((item) => targetIn(item, groups))) {
      return true;
    }
  }
  return false;
};

/**
 * The elements `namesGroup` picks, from the incoming relation index of the store before the change
 * (#272) instead of a scan of every relation: the records of the new store whose own UUID lies in
 * one of `groups`, and the sources of relations under a key with a rule to a UUID in one of them.
 * The UUIDs of a group are found by a scan of the index's keys and the store's UUIDs (a short ID
 * depends on every UUID of its group, also one no element has, so this part stays a scan, of about
 * 100,000 strings instead of 200,000 relations). The index of `update.from` holds the relations of
 * every file that did not change as they are now (the same records), so it is good also when the
 * new store has none (a change above `CARRY_LIMIT`); the changed files are looked at anyway. The
 * index holds what `collect` reads under a key with a rule (`relationKey`, `hasId`, a text
 * `repository`), so no element with a finding that may differ is left out. Some elements may come
 * twice or from a changed file: `carryProblems` merges by file.
 */
const againFromIndex = (
  index: IncomingIndex,
  to: ElementStore,
  rules: Rules,
  groups: ReadonlySet<string>,
): readonly ElementRecord[] => {
  const again: ElementRecord[] = [];
  for (const [id, records] of to.byId) {
    if (groups.has(shortIdGroup(id))) {
      again.push(...records);
    }
  }
  for (const [id, links] of index.relationsById) {
    if (groups.has(shortIdGroup(id))) {
      for (const link of links) {
        if (rules(link.key) !== undefined) {
          again.push(link.source);
        }
      }
    }
  }
  return again;
};

/**
 * The elements whose files did not change but whose findings may differ after `update`, for
 * `carryProblems` (`again`) when a changed UUID came, went or changed its repository or type: from
 * `incoming`, the incoming relation index of `update.from` built with `metamodel`, a list
 * (`againFromIndex`); without it, a test that every element is put to (`namesGroup`).
 */
export const relationTypeAgain = (
  update: StoreUpdate,
  metamodel: Metamodel,
  incoming: IncomingIndex | undefined,
): ((element: ElementRecord) => boolean) | readonly ElementRecord[] => {
  const rules = rulesOf(metamodel);
  const groups = new Set([...update.ids].map(shortIdGroup));
  return incoming?.store === update.from && incoming.metamodel === metamodel
    ? againFromIndex(incoming, update.to, rules, groups)
    : (element) => namesGroup(element, rules, groups);
};

/** Repository and type of each record of `id`, in store order. */
const places = (store: ElementStore, id: string): string =>
  JSON.stringify((store.byId.get(id) ?? []).map((r) => [r.repository, r.type]));

/** Whether `id` has as many records in both stores, with the same repository and type pair by pair. */
const samePlaces = (from: ElementStore, to: ElementStore, id: string): boolean =>
  places(from, id) === places(to, id);

/**
 * Every relation of the workspace between types that are not allowed, as a problem with repository,
 * file, line, element and target ID (SR-086 AK2), for `workspace.check` (SR-019). Reads every file
 * with findings again for the lines (`locateFindings`). Kept until the element store or the
 * metamodel is reset; carried over a change of the store (#184): the changed files are looked at
 * again, and so is every element whose UUID or a target's UUID lies in a short-ID group of a changed
 * UUID (its targets or the short IDs in its messages may have changed).
 */
export const relationTypeProblemsState = defineWorkspaceState(
  "relation-types",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const shortIds = await workspace.get(shortIdState);
    return locateFindings(layout, allRelationTypeFindings({ store, metamodel, shortIds }));
  },
  {
    dependsOn: [elementStoreState, metamodelState, shortIdState],
    carry: carryStoreUpdate((value, update, workspace) => {
      // Synchronously, so these are the short IDs carried over the same update.
      const context = Promise.all([workspace.get(metamodelState), workspace.get(shortIdState)]);
      return carryProblems(workspace, value, update, {
        findingsOf: context.then(
          ([metamodel, shortIds]) =>
            (element) =>
              relationTypeFindings(element, { store: update.to, metamodel, shortIds }),
        ),
        // The usual save keeps every changed UUID in the same repositories with the same types:
        // no short ID changes and every target resolves as before, so only the written files count.
        again: [...update.ids].every((id) => samePlaces(update.from, update.to, id))
          ? Promise.resolve([])
          : context.then(([metamodel]) =>
              // Read once `replace` has carried every state (a `then` runs after it): inside the
              // hook the incoming memo may not be carried yet. The index of the store before the
              // change, when a chain built it (#272); the save does not build it.
              relationTypeAgain(update, metamodel, workspace.peek(incomingState)?.get(update.from)),
            ),
        // Nothing against a metamodel that is not valid, as a full build (#208, #220).
        skip: context.then(([metamodel]) => !metamodel.valid),
      });
    }),
  },
);
