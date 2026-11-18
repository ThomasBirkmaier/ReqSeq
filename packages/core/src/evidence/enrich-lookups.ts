// The lookups `enrichJunitFile` gives the pure enrich (SR-029; `enrich.ts`): references, given views and
// `reqseq:variant` values through the store and `resolveView`, and where a record would count nowhere.
import { CommandError } from "../catalog.js";
import type { ElementRecord } from "../model/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { resolveView } from "../variants/index.js";
import type { RecordViewContext, ViewContext } from "./in-variant.js";
import { recordOutOfView } from "./in-variant.js";
import type { GivenView, RefResolution, VariantLookup } from "./enrich-model.js";
import { COMMAND, CORE, VARIANT } from "./enrich-model.js";

/** `; the workspace is incomplete (...)` when repositories of the workspace are not on this machine. */
export const incompleteNote = (layout: WorkspaceLayout): string => {
  const names = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  return names.length === 0
    ? ""
    : `; the workspace is incomplete, the element may lie in a repository that is not on this machine (${names.join(", ")})`;
};

/** A candidate of `ref.ambiguous` (`resolveRef`). */
interface Candidate {
  readonly id: string;
  readonly repository: string;
  readonly file: string;
}

/**
 * `resolve` (`resolveRef` of the store) as a `RefResolution`: `ref.unknown` and `ref.ambiguous` become
 * results, any other error passes on. Remembers the record of every element found in `found`.
 */
export const resolverOf =
  (resolve: (ref: string) => ElementRecord, found: Map<string, ElementRecord>) =>
  (ref: string): RefResolution => {
    try {
      const record = resolve(ref);
      found.set(record.id, record);
      return { kind: "found", id: record.id };
    } catch (error) {
      if (error instanceof CommandError && error.code === "ref.unknown") {
        return { kind: "unknown" };
      }
      if (error instanceof CommandError && error.code === "ref.ambiguous") {
        // resolveRef always gives the candidates of `ref.ambiguous`.
        const { candidates } = error.details as { readonly candidates: readonly Candidate[] };
        return {
          kind: "ambiguous",
          candidates: candidates.map((c) => `${c.id} in ${c.repository}/${c.file}`),
        };
      }
      throw error;
    }
  };

/**
 * The given views (AK6) through `resolveView`, each once in the order first given: a variant, or
 * `core`, whose records count in the core, and in every view of an element of a `variant-independent`
 * repository (SR-173).
 */
export const givenViews = (
  views: ViewContext,
  refs: readonly string[] | undefined,
  variants: Map<string, ElementRecord>,
): GivenView[] | undefined => {
  if (refs === undefined) {
    return undefined;
  }
  const given = new Map<string, GivenView>();
  for (const ref of refs) {
    const view = resolveView(views, ref, COMMAND, "variant", true);
    if (view.kind === "core") {
      given.set(CORE, { id: CORE, name: CORE });
    } else {
      variants.set(view.variant.id, view.variant);
      given.set(view.variant.id, { id: view.variant.id, name: views.shortIds.of(view.variant) });
    }
  }
  return [...given.values()];
};

/**
 * What a `reqseq:variant` of a test case names (AK7), through `resolveView`: a variant, or `core`; any
 * refusal (no element, several, no variant, a metamodel without variants) is a result. Remembers each
 * variant found.
 * `unknownNote` follows the reason when no element has the reference, as for an unknown element.
 */
export const variantResolverOf = (
  views: ViewContext,
  variants: Map<string, ElementRecord>,
  unknownNote = "",
): ((ref: string) => VariantLookup) => {
  /** One lookup per distinct value: a CI file repeats the same variant in every test case. */
  const known = new Map<string, VariantLookup>();
  return (ref) => {
    const before = known.get(ref);
    if (before !== undefined) {
      return before;
    }
    const lookup = lookupVariant(views, variants, ref, unknownNote);
    known.set(ref, lookup);
    return lookup;
  };
};

/** One lookup of `variantResolverOf`. */
const lookupVariant = (
  views: ViewContext,
  variants: Map<string, ElementRecord>,
  ref: string,
  unknownNote: string,
): VariantLookup => {
  try {
    const view = resolveView(views, ref, COMMAND, VARIANT, true);
    if (view.kind === "core") {
      return { kind: "view", id: CORE };
    }
    variants.set(view.variant.id, view.variant);
    return { kind: "view", id: view.variant.id };
  } catch (error) {
    if (error instanceof CommandError) {
      return { kind: "invalid", reason: error.message + (error.code === "ref.unknown" ? unknownNote : "") };
    }
    throw error;
  }
};

/**
 * `outOfVariant` over the records `resolve` and `resolveVariant` found (`recordOutOfView`, as
 * `evidence.record` refuses a record, SR-047 AK4 and AK5: a record of the core of an element of a
 * repository marked `variant-independent` counts in the variants that hold it, SR-173). An element or
 * variant not found counts: enrich asks only for those it found.
 */
export const outOfVariantOf =
  (
    views: RecordViewContext,
    found: ReadonlyMap<string, ElementRecord>,
    variants: ReadonlyMap<string, ElementRecord>,
  ) =>
  (id: string, viewId: string): string | undefined => {
    const element = found.get(id);
    const variant = variants.get(viewId);
    if (element === undefined || (variant === undefined && viewId !== CORE)) {
      return undefined;
    }
    const out = recordOutOfView(
      views,
      element,
      variant === undefined ? { kind: "core" } : { kind: "variant", variant },
    );
    return out === undefined ? undefined : `${views.shortIds.of(element)} ${out.why}`;
  };
