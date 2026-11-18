// The SPEC-RELATIONs of the plan (`planRelation`) and the losses of the parts of the file the
// import does not take: specifications, relation groups and unread parts. Part of import.ts, whose
// file comment says what the plan does; "the file comment" here means that one.
import type { ItemValue, ScalarValue } from "../files/index.js";
import type { MetamodelProperty, ReqifLoss } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { allowsType } from "../metamodel/index.js";
import { hasId } from "../model/index.js";
import type { ReqifFile, ReqifSpecRelation, ReqifValue } from "./model.js";
import { ownId } from "./own.js";
import { allowed, itemsOf, nameOf } from "./import-context.js";
import type { Context, Draft, Index, Loss } from "./import-context.js";

/**
 * The names of the attributes of the `values` of a relation or specification, which the import does
 * not take over (a loss); an attribute the file does not define is named as such.
 */
const valueNames = (index: Index, values: readonly ReqifValue[]): string =>
  values
    .map((value) => {
      const known = index.attributes.get(value.definition);
      return known === undefined ? `${value.definition} (not in the file)` : nameOf(known.a);
    })
    .join(", ");

/** Adds `relation` to the draft of its source, or lists it as a loss. */
export const planRelation = (
  context: Context,
  drafts: ReadonlyMap<string, Draft>,
  relation: ReqifSpecRelation,
): void => {
  const { index } = context;
  const t = index.types.get(relation.type);
  // The import needs no reference of a relation, so one the file does not define is a loss.
  const kind = t === undefined ? undefined : context.coverage.relations.get(t.identifier);
  const source = drafts.get(relation.source);
  if (source?.ownRelations !== undefined && kind !== undefined) {
    // Its relations come from `reqseq-values` (see the file comment); a kind the metamodel here
    // does not know is still a loss (#695).
    return;
  }
  const loss: Loss = (code, reason) => {
    context.losses.push({
      identifier: relation.identifier,
      kind: "spec-relation",
      ...(source === undefined ? {} : { id: source.id }),
      code,
      reason,
    });
  };
  if (t?.category !== "spec-relation") {
    loss("omitted-type", `its SPEC-RELATION-TYPE ${relation.type} is not in the file`);
  } else if (kind === undefined) {
    loss("omitted-type", `the mapping omits its type ${nameOf(t)}`);
  } else {
    const target = drafts.get(relation.target) ?? ownMissingTarget(context, relation, kind);
    if (source === undefined || target === undefined) {
      const [end, identifier] =
        source === undefined ? ["source", relation.source] : ["target", relation.target];
      const why = index.objects.has(identifier) ? "is not imported" : "is not in the file";
      loss("relation-end-not-imported", `its ${end} ${identifier} ${why}`);
    } else {
      addRelation(context, source, kind, target, relation, loss);
    }
  }
  if (relation.values.length > 0) {
    loss(
      "omitted-attribute",
      `the values of a SPEC-RELATION are not imported: ${valueNames(index, relation.values)}`,
    );
  }
};

/** A target of a relation: an element of this call, or a missing one kept as stored (`ownMissingTarget`). */
type RelationEnd = Draft | { readonly id: string; readonly version: string };

/**
 * The target of a SPEC-RELATION of a file of ReqSeq that is not imported (a stub): kept to its UUID
 * with the version `reqseq-values` of the source stores for it (ADR-0013 step 4, N-041, D-058);
 * undefined in a file of another tool or without a stored version.
 */
const ownMissingTarget = (
  context: Context,
  relation: ReqifSpecRelation,
  kind: string,
): RelationEnd | undefined => {
  const stored = context.stored.get(relation.source)?.[kind];
  const item = [stored].flat().find((i) => hasId(i) && ownId.element(i.id) === relation.target);
  const version = hasId(item) ? item["version"] : undefined;
  return context.own && hasId(item) && typeof version === "string" ? { id: item.id, version } : undefined;
};

/**
 * Why the relation or relation-valued property `kind` (`property`) must not lead from `source` to
 * `target`: undefined when it may, else the target's type (null for a target outside the file).
 */
const relationRefusal = (
  metamodel: Metamodel,
  source: Draft,
  kind: string,
  property: MetamodelProperty | undefined,
  target: RelationEnd,
): string | null | undefined => {
  const to = "base" in target ? target.base.type.key : null;
  const fits =
    to === null ||
    (property === undefined
      ? allowed(metamodel, kind, source, target as Draft)
      : allowsType(property["target-types"], to, metamodel));
  return fits && (property === undefined || source.base.type.properties.includes(kind)) ? undefined : to;
};

/** Adds the relation `kind` from `source` to `target` (see `planRelation`). */
const addRelation = (
  context: Context,
  source: Draft,
  kind: string,
  target: RelationEnd,
  relation: ReqifSpecRelation,
  loss: Loss,
): void => {
  const property = context.metamodel.properties.find((p) => p.key === kind);
  const refusal = relationRefusal(context.metamodel, source, kind, property, target);
  if (refusal !== undefined) {
    loss(
      "relation-not-allowed",
      `the metamodel does not allow ${kind} from ${source.base.type.key} to ${refusal ?? relation.target}`,
    );
    return;
  }
  const item: Record<string, ScalarValue> = {
    id: target.id,
    version: "base" in target ? "" : target.version,
    // A target in another repository names it (ADR-0004, D-058).
    ...("base" in target && target.repository !== source.repository ? { repository: target.repository } : {}),
  };
  if ("base" in target) {
    context.pending.set(target.id, [...(context.pending.get(target.id) ?? []), item]);
  }
  const items = itemsOf(property === undefined ? source.relations.get(kind) : source.properties.get(kind));
  if (items.some((i) => hasId(i) && i.id === target.id)) {
    loss("relation-duplicate", `${kind} to ${relation.target} is imported once already`);
  } else if (property === undefined) {
    source.relations.set(kind, [...(items as Record<string, ScalarValue>[]), item]);
  } else if (property.many !== true && items.length > 0) {
    loss("relation-duplicate", `${kind} holds one target, so ${relation.target} is not imported`);
  } else {
    // A relation-valued property can count to the version (validity, D-057).
    source.relationProperties = true;
    source.properties.set(kind, property.many === true ? [...(items as ItemValue[]), item] : item);
  }
};

/**
 * A loss for every part of an imported object, relation or specification the parser did not read
 * (`unread` with an owner: ALTERNATIVE-ID, THE-ORIGINAL-VALUE, unknown children, ...). Parts of an
 * object or relation whose type the mapping omits are not listed again.
 */
export const unreadLosses = (
  file: ReqifFile,
  drafts: ReadonlyMap<string, Draft>,
  losses: ReqifLoss[],
): void => {
  const omitted = new Set(
    losses.filter((l) => l.code === "omitted-type").map((l) => `${l.kind} ${l.identifier}`),
  );
  const sources = new Map(file.specRelations.map((r) => [r.identifier, r.source]));
  for (const { name, line, owner } of file.unread) {
    if (owner === undefined || omitted.has(`${owner.kind} ${owner.identifier}`)) {
      continue;
    }
    const { kind, identifier } = owner;
    const draft = drafts.get(kind === "spec-object" ? identifier : (sources.get(identifier) ?? ""));
    losses.push({
      identifier,
      kind,
      ...(draft === undefined ? {} : { id: draft.id }),
      code: "omitted-value",
      reason: `<${name}> on line ${String(line)} is not read`,
    });
  }
};

/** The losses of each SPECIFICATION: its values and its hierarchy are not imported. */
export const specificationLosses = (context: Context, file: ReqifFile): void => {
  const { index } = context;
  for (const specification of file.specifications) {
    if (specification.values.length > 0) {
      const names = valueNames(index, specification.values);
      context.losses.push({
        identifier: specification.identifier,
        kind: "specification",
        code: "omitted-attribute",
        reason: `the values of a SPECIFICATION are not imported: ${names}`,
      });
    }
    if (specification.children.length > 0) {
      context.losses.push({
        identifier: specification.identifier,
        kind: "specification",
        code: "hierarchy",
        reason: `the SPEC-HIERARCHY of ${nameOf(specification)} (order and nesting) is not imported`,
      });
    }
  }
};

/**
 * A loss for each SPEC-RELATION a RELATION-GROUP names: the group is not imported. Like
 * `unreadLosses`, on the source element, and not for a relation whose type the mapping omits.
 */
export const relationGroupLosses = (
  context: Context,
  file: ReqifFile,
  drafts: ReadonlyMap<string, Draft>,
): void => {
  const { losses, index } = context;
  const omitted = new Set(
    losses.filter((l) => l.code === "omitted-type" && l.kind === "spec-relation").map((l) => l.identifier),
  );
  const sources = new Map(file.specRelations.map((r) => [r.identifier, r.source]));
  for (const group of file.relationGroups) {
    const type = group.type === undefined ? undefined : index.types.get(group.type);
    const typed = type?.category === "relation-group" ? ` (type ${nameOf(type)})` : "";
    const name = `${nameOf(group)}${typed}`;
    // Once per relation, and not for an empty reference.
    for (const identifier of new Set(group.relations.filter((r) => r !== "" && !omitted.has(r)))) {
      const draft = drafts.get(sources.get(identifier) ?? "");
      losses.push({
        identifier,
        kind: "spec-relation",
        ...(draft === undefined ? {} : { id: draft.id }),
        code: "relation-group",
        reason: `its RELATION-GROUP ${name} is not imported`,
      });
    }
  }
};
