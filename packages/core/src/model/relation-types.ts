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
import { allowsType, findType, keyDefinition, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { isRelationTarget, resolveTarget } from "./relations.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
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
  const found = keyDefinition(metamodel, key);
  if (found === undefined) {
    return undefined;
  }
  const { definition } = found;
  if (found.kind === "relation") {
    const label = `Relation ${definition.name} (${definition.key})`;
    return rule(metamodel, label, true, found.definition["source-types"], found.definition["target-types"]);
  }
  if (found.definition.kind !== "relation") {
    return undefined;
  }
  const label = `Property ${definition.name} (${definition.key})`;
  return rule(metamodel, label, found.definition.many === true, undefined, found.definition["target-types"]);
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

/** The relation targets of a value with their paths; values of another shape are SR-085's. */
const targetsOf = (key: string, many: boolean, value: unknown): (readonly [ValuePath, unknown])[] => {
  if (many) {
    return Array.isArray(value) ? value.map((item: unknown, i) => [[key, i], item] as const) : [];
  }
  return Array.isArray(value) ? [] : [[[key], value]];
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
    for (const [path, item] of targetsOf(key, keyRule.many, value)) {
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

/**
 * Every relation of the workspace between types that are not allowed, as a problem with repository,
 * file, line, element and target ID (SR-086 AK2), for `workspace.check` (SR-019). Reads every file
 * with findings again for the lines (`locateFindings`). Kept until the element store or the
 * metamodel is reset.
 */
export const relationTypeProblemsState = defineWorkspaceState(
  "relation-types",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const shortIds = await workspace.get(shortIdState);
    return locateFindings(layout, allRelationTypeFindings({ store, metamodel, shortIds }));
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
