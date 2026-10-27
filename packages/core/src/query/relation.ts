// Conditions on relations (SR-069 AK3, `filter.schema.json#/$defs/relationCondition`): whether an
// element has (`exists: true`) or has not (`false`) a relation of some kinds in a direction, whose
// other end meets `to` when it is given. "Without child" is `{relation: {meaning: derivation,
// direction: down}, exists: false}`, "without evidence" `{relation: {direction: evidence}, exists:
// false}`.
//
// - Kinds: `kind` names a relation kind or a property of kind `relation` (validity, packages;
//   `relationKey`), `meaning` takes every relation kind with that meaning (D-012; with `kind` too,
//   that kind must have it), neither takes every relation kind. A kind the metamodel does not have
//   is `input.invalid`; a meaning no relation kind has is `metamodel.meaning-unassigned` (SR-013 AK3).
// - `up`: the element's own relations, the items under those keys that name a target (`hasId`; a
//   list's items, or the one value). Without `to`, every such item counts, also one whose target is
//   missing or not available (#336: the relation is there, which is what `exists` asks). With `to`,
//   the target is looked up where the item names it (`targetState`, D-058) and must be available and
//   meet `to`, so `to: {all: []}` counts only available targets. A target in a repository that the
//   workspace file does not list marks the result incomplete (as in the chain, spec question #193);
//   one in a listed repository that is not on this machine does too, through the selection, which
//   is incomplete whenever such a repository exists (selection.ts).
// - `down`: the relations of other elements that point at the element in its repository, from the
//   incoming relation index (`model/incoming.ts`, built once per store and only when a condition
//   needs it). With `to`, their source must meet it.
// - No direction: `up` or `down`.
// - `evidence`: the verification records that point at the element in the view of the selection,
//   else in the core, from the evidence provider (evidence.ts); it takes no `kind`, `meaning` or `to`.
// - Inline references are no relations (ADR-0004).
import type { FilterRelationCondition } from "../generated/types.js";
import { keyDefinition, relationKindsWithMeaning, requireMeaning } from "../metamodel/index.js";
import type { ElementRecord, IncomingIndex } from "../model/index.js";
import { hasId, incomingFor, relationKey, targetState } from "../model/index.js";
import type { CompileContext, Predicate } from "./context.js";
import { invalidAt, valuesOf } from "./context.js";

type Relation = FilterRelationCondition["relation"];

/** The keys of the relations a condition is about (see the file comment). */
const keysOf = (context: CompileContext, relation: Relation, at: string): ReadonlySet<string> => {
  const { metamodel, command } = context;
  const { kind, meaning } = relation;
  if (kind === undefined) {
    if (meaning !== undefined) {
      requireMeaning(metamodel, meaning, command);
    }
    const kinds = meaning === undefined ? metamodel.relations : relationKindsWithMeaning(metamodel, meaning);
    return new Set(kinds.map((k) => k.key));
  }
  const found = keyDefinition(metamodel, kind);
  const holds = relationKey(metamodel, kind);
  if (found === undefined || holds === undefined) {
    throw invalidAt(
      context,
      `${at}.relation.kind`,
      `${kind} is neither a relation kind nor a property of kind relation`,
    );
  }
  if (meaning !== undefined && (found.kind !== "relation" || found.definition.meaning !== meaning)) {
    throw invalidAt(context, `${at}.relation.meaning`, `${holds.label} has not the meaning ${meaning}`);
  }
  return new Set([kind]);
};

/** Whether `element` has an own relation under `keys` whose target meets `to` (`up`). */
const upward =
  (context: CompileContext, keys: ReadonlySet<string>, to: Predicate | undefined): Predicate =>
  (element) => {
    const { layout, store, notes } = context;
    for (const key of keys) {
      for (const item of valuesOf(element.data[key])) {
        if (!hasId(item)) {
          continue;
        }
        if (to === undefined) {
          return true;
        }
        const state = targetState(layout, store, element.repository, item);
        if (state.kind === "available" && to(state.element)) {
          return true;
        }
        if (state.kind === "unknown-repository") {
          notes.incomplete = true;
        }
      }
    }
    return false;
  };

/** Whether a relation under `keys` points at `element` from a source that meets `to` (`down`). */
const downward =
  (index: IncomingIndex, keys: ReadonlySet<string>, to: Predicate | undefined): Predicate =>
  (element: ElementRecord) =>
    (index.relationsById.get(element.id) ?? NONE).some(
      (link) =>
        keys.has(link.key) && link.repository === element.repository && (to === undefined || to(link.source)),
    );

const NONE: readonly never[] = Object.freeze([]);

/** Compiles a relation condition (see the file comment). */
export const compileRelation = async (
  context: CompileContext,
  condition: FilterRelationCondition,
  at: string,
): Promise<Predicate> => {
  const { relation, exists } = condition;
  const { direction } = relation;
  let has: Predicate;
  if (direction === "evidence") {
    const extra = (["kind", "meaning", "to"] as const).find((field) => relation[field] !== undefined);
    if (extra !== undefined) {
      throw invalidAt(
        context,
        `${at}.relation.${extra}`,
        "the direction evidence takes no kind, meaning or to",
      );
    }
    const { hasEvidence } = await context.evidence();
    // In the view of the selection, else in the core, as `verification` without `variant`.
    const view = context.view ?? { kind: "core" };
    has = (e) => hasEvidence(e, view);
  } else {
    const keys = keysOf(context, relation, at);
    const to =
      relation.to === undefined ? undefined : await context.compile(relation.to, `${at}.relation.to`);
    const up = upward(context, keys, to);
    const down =
      direction === "up"
        ? undefined
        : downward(incomingFor(context.workspace, context.store, context.metamodel), keys, to);
    has = down === undefined ? up : direction === "down" ? down : (e) => up(e) || down(e);
  }
  return exists ? has : (e) => !has(e);
};
