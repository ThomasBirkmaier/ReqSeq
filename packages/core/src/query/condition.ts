// The filter conditions (SR-069, `filter.schema.json#/$defs/condition`): the `where` of every command
// that takes a selection (SR-101) and of a saved filter (SR-070). A condition is compiled once into a
// predicate on element records: references, views, type sets, regular expressions and meanings are
// resolved while compiling, so applying it is one cheap call per element and a filter over the
// 50,000 elements of N-036 is one pass over the store (ADR-0008, SR-082 AK4). ADR-0008 "Filter and
// selection" describes the semantics of each operator.
//
// - `all`, `any`, `not` combine conditions (AK2); `all: []` holds, `any: []` does not.
// - `type` (with the types that extend one, SR-012, unless `subtypes` is false), `status`, `invalid`
//   (D-044), `package` (D-040), `validFor` (SR-040), `source` (SR-057 AK2) and the property
//   conditions (property.ts) read the frontmatter of the element (AK1). Type and status keys are
//   taken as written: a file may hold a key the metamodel does not know (SR-016 AK3), and the check
//   reports it, not the filter.
// - `verification` and `validation` ask the evidence provider (evidence.ts, AK1 "Nachweisstatus"),
//   and so does a relation condition with the direction `evidence` (relation.ts, AK3).
// - `text` (SR-068): the elements `element.search` finds for the query, from the search index of
//   the workspace (`searchIndex`, which waits for a build that runs), compared by repository and
//   file, so the store the index was carried to may be newer than the one compiled against.
// - Not yet: `emergent` (SR-035, stage 4, decides which value marks an element emergent). It is
//   refused with `input.invalid`, as `element.get` refuses a view, so no caller takes an unfiltered
//   list for a filtered one.
//
// Errors name the field of the input they are about (`details.fields`, the path from `at`).
// To add an operator, compile it in `compileLeaf`; the compiler refuses a schema operator without a
// branch there. A compiled condition is for one run (`CompiledCondition`).
import type { ElementRef, FilterCondition, View as ViewInput } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { invalidStatuses, resolveRef } from "../model/index.js";
import type { View } from "../variants/index.js";
import { appliesIn, resolveView, validityEntries, validityOf, validityTarget } from "../variants/index.js";
import type { CompileContext, Predicate, QueryContext, QueryNotes } from "./context.js";
import { invalidAt, propertyFor } from "./context.js";
import type { EvidenceStatuses } from "./evidence.js";
import { evidenceStatusState } from "./evidence.js";
import { compileProperty } from "./property.js";
import { compileRelation } from "./relation.js";
import { matchingKeys, recordKey } from "./search-index.js";
import { searchIndex } from "./search-state.js";

const ALWAYS: Predicate = () => true;
const NEVER: Predicate = () => false;

/** `all` and `any`: the predicates of the list, short-circuited; compiled in order, so the first wrong one is reported. */
const combine = async (
  context: CompileContext,
  conditions: readonly FilterCondition[],
  at: string,
  every: boolean,
): Promise<Predicate> => {
  const predicates: Predicate[] = [];
  for (const [i, condition] of conditions.entries()) {
    predicates.push(await context.compile(condition, `${at}[${String(i)}]`));
  }
  if (predicates.length === 0) {
    return every ? ALWAYS : NEVER;
  }
  return every ? (e) => predicates.every((p) => p(e)) : (e) => predicates.some((p) => p(e));
};

/** The type keys `keys` names: with `subtypes`, also every type of the metamodel that extends one (SR-012). */
const typeKeys = (metamodel: Metamodel, keys: readonly string[], subtypes: boolean): ReadonlySet<string> => {
  const named = new Set(keys);
  if (subtypes) {
    for (const type of metamodel.effectiveTypes) {
      if (type.ancestors.some((key) => keys.includes(key))) {
        named.add(type.key);
      }
    }
  }
  return named;
};

/** The status key of an element as written; any other value names no status. */
const statusOf = (element: ElementRecord): unknown => element.data["status"];

/** `view` of the input as the tool computes it (`resolveView`); `at` names the field, which takes `core` too. */
const viewAt = (context: QueryContext, view: ViewInput, at: string): View =>
  resolveView(context, view, context.command, at, true);

/**
 * `package`: the elements whose property with the meaning `packages` names the package, in the
 * repository it names or in the element's own (D-058), read as the validity names variants.
 */
const compilePackage = (context: QueryContext, ref: ElementRef, at: string): Predicate => {
  const { metamodel, store, shortIds } = context;
  const property = propertyFor(context, "packages");
  const pkg = resolveRef(store, shortIds, ref);
  if (!typesWithMeaning(metamodel, "package").some((t) => t.key === pkg.type)) {
    throw invalidAt(context, at, `${ref} is no package: an element whose type has the meaning package`);
  }
  const packages = { key: property.key, many: property.many === true };
  return (element) =>
    validityEntries(packages, element).some((entry) => {
      const target = validityTarget(entry.value, element);
      return target?.id === pkg.id && target.repository === pkg.repository;
    });
};

/** `source`: the value of the property with the meaning `source` (SR-057 AK2). */
const compileSource = (context: QueryContext, source: string): Predicate => {
  const { key } = propertyFor(context, "source");
  return (element) => element.data[key] === source;
};

/** The conditions on one fact of the element, besides properties and relations. */
type Leaf = Exclude<
  FilterCondition,
  | { readonly all: unknown }
  | { readonly any: unknown }
  | { readonly not: unknown }
  | { readonly property: unknown }
  | { readonly relation: unknown }
>;

/** The evidence conditions (see the file comment). */
const compileEvidence = async (
  context: CompileContext,
  condition: Extract<Leaf, { readonly verification: unknown } | { readonly validation: unknown }>,
  at: string,
): Promise<Predicate> => {
  const evidence = await context.evidence();
  if ("validation" in condition) {
    const wanted: ReadonlySet<unknown> = new Set(condition.validation);
    return (e) => wanted.has(evidence.validation(e));
  }
  const view =
    condition.variant === undefined
      ? (context.view ?? { kind: "core" })
      : viewAt(context, condition.variant, `${at}.variant`);
  const wanted: ReadonlySet<unknown> = new Set(condition.verification);
  return (e) => wanted.has(evidence.verification(e, view));
};

const compileLeaf = async (context: CompileContext, condition: Leaf, at: string): Promise<Predicate> => {
  const { metamodel } = context;
  if ("type" in condition) {
    const keys = typeKeys(metamodel, condition.type, condition.subtypes !== false);
    return (e) => keys.has(e.type);
  }
  if ("status" in condition) {
    const keys: ReadonlySet<unknown> = new Set(condition.status);
    return (e) => keys.has(statusOf(e));
  }
  if ("invalid" in condition) {
    const invalid: ReadonlyMap<unknown, unknown> = invalidStatuses(metamodel);
    const wanted = condition.invalid;
    return (e) => invalid.has(statusOf(e)) === wanted;
  }
  if ("package" in condition) {
    return compilePackage(context, condition.package, `${at}.package`);
  }
  if ("validFor" in condition) {
    const view = viewAt(context, condition.validFor, `${at}.validFor`);
    const validity = validityOf(metamodel);
    return (e) => appliesIn(validity, e, view);
  }
  if ("verification" in condition || "validation" in condition) {
    return compileEvidence(context, condition, at);
  }
  if ("source" in condition) {
    return compileSource(context, condition.source);
  }
  if ("emergent" in condition) {
    throw invalidAt(
      context,
      `${at}.emergent`,
      "the condition emergent comes with SR-035 (stage 4); leave it out",
    );
  }
  if ("text" in condition) {
    const keys = matchingKeys(await searchIndex(context.workspace), condition.text);
    return (e) => keys.has(recordKey(e));
  }
  // Every operator of the schema is a branch above; the compiler checks that none is left (#336). Core
  // validates each input first, so only a caller that bypasses it gets here: a bug, not an input error.
  const unknown: never = condition;
  throw new Error(`no compiler for the condition ${JSON.stringify(unknown)}`);
};

/** Compiles one condition (see the file comment); `at` is the path of its field in the input. */
const compileCondition = async (
  context: CompileContext,
  condition: FilterCondition,
  at: string,
): Promise<Predicate> => {
  if ("all" in condition) {
    return combine(context, condition.all, `${at}.all`, true);
  }
  if ("any" in condition) {
    return combine(context, condition.any, `${at}.any`, false);
  }
  if ("not" in condition) {
    const inner = await context.compile(condition.not, `${at}.not`);
    return (e) => !inner(e);
  }
  if ("property" in condition) {
    return compileProperty(context, condition, at);
  }
  if ("relation" in condition) {
    return compileRelation(context, condition, at);
  }
  return compileLeaf(context, condition, at);
};

/**
 * A compiled condition and the notes it writes while it is applied. It belongs to one run: it holds the
 * states it was compiled against (store, short IDs, incoming index, evidence provider, views) and its
 * `notes` only ever gain `incomplete`. So compile again for every run (#336): a saved filter (#82) or
 * a bulk update (#83) keeps the condition, never the compiled one.
 */
export interface CompiledCondition {
  readonly predicate: Predicate;
  readonly notes: QueryNotes;
}

/**
 * Compiles `condition` for `context` (see the file comment), for one run (`CompiledCondition`). `at`
 * is the path of the condition in the input, e.g. `selection.where`, for the messages.
 */
export const compileWhere = async (
  context: QueryContext,
  condition: FilterCondition,
  at: string,
): Promise<CompiledCondition> => {
  const notes: QueryNotes = { incomplete: false };
  let evidence: Promise<EvidenceStatuses> | undefined;
  const compiling: CompileContext = {
    ...context,
    notes,
    compile: (c, path) => compileCondition(compiling, c, path),
    evidence: () => (evidence ??= context.workspace.get(evidenceStatusState)),
  };
  return { predicate: await compileCondition(compiling, condition, at), notes };
};
