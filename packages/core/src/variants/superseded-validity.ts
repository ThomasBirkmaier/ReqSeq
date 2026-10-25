// Hints on validities that list a superseded variant (SR-040 AK3, D-020, D-044, D-045). A variant
// is superseded when its status is one the metamodel marks `invalid` (D-044), whichever command or
// person set it. Every entry of a validity whose target is such a variant gets one hint
// `variant.superseded-in-validity` (a `warning`: it blocks nothing and changes no status), at the
// requirement that lists it. Relations of relation kinds to superseded elements are
// `relation.target-superseded` (model/superseded.ts, SR-072).
//
// The entries are read as the view reads them (`validityEntries`, `validityTarget`), so every
// requirement with an entry that names a superseded variant gets the hint, also when the entry has
// another shape than SR-085 allows (SR-085 reports that). Only targets whose type
// has the meaning `variant` count; another type in a validity is the relation-type check's (SR-086).
//
// N-036: one cheap pass collects the UUIDs of the superseded variants; without any, the check ends
// there. An entry is looked up in the store only when it names one of these UUIDs.
import type { Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import type { MetamodelStatus } from "../generated/types.js";
import type { ElementRecord, LocatableFinding, SupersededContext } from "../model/index.js";
import {
  elementLabel,
  elementStoreState,
  invalidStatuses,
  locateFindings,
  resolveTarget,
  shortIdState,
} from "../model/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Validity } from "./views.js";
import { validityEntries, validityOf, validityTarget, variantTypes } from "./views.js";

/** What the hints of the sources need, once per call: the validity and the superseded variants. */
interface Scope {
  readonly validity: Validity;
  readonly invalid: ReadonlyMap<string, MetamodelStatus>;
  readonly types: ReadonlySet<string>;
  /** The UUIDs of the variants with an invalid status. */
  readonly superseded: ReadonlySet<string>;
}

/** The scope of `context`; undefined when no hint is possible (no validity, no invalid status or no superseded variant). */
const scopeOf = (context: SupersededContext): Scope | undefined => {
  const { store, metamodel } = context;
  const validity = validityOf(metamodel);
  const invalid = invalidStatuses(metamodel);
  if (validity === undefined || invalid.size === 0) {
    return undefined;
  }
  const types = variantTypes(metamodel);
  const superseded = new Set(
    store.elements.filter((e) => types.has(e.type) && invalid.has(String(e.data["status"]))).map((e) => e.id),
  );
  return superseded.size === 0 ? undefined : { validity, invalid, types, superseded };
};

/** The hints of one source, in the order of its validity entries. */
const findingsOfSource = (
  context: SupersededContext,
  scope: Scope,
  source: ElementRecord,
  findings: LocatableFinding[],
): void => {
  const { validity, invalid, types, superseded } = scope;
  for (const { path, value } of validityEntries(validity, source)) {
    const named = validityTarget(value, source);
    if (named === undefined || !superseded.has(named.id)) {
      continue;
    }
    const match = resolveTarget(context.store, source.repository, named);
    if (match.kind !== "found" || !types.has(match.element.type)) {
      continue;
    }
    const target = match.element;
    const status = invalid.get(String(target.data["status"]));
    if (status === undefined) {
      continue;
    }
    const problem: Problem = {
      code: "variant.superseded-in-validity",
      severity: "warning",
      message: `${validity.label} of ${elementLabel(context, source)} lists ${elementLabel(context, target)}, which is superseded (status ${status.name})`,
      repository: source.repository,
      file: source.file,
      elementId: source.id,
      targetId: target.id,
    };
    findings.push({ element: source, path, problem });
  }
};

/**
 * The hints `variant.superseded-in-validity` (SR-040 AK3), one per validity entry that names a
 * variant (`validityTarget`) which resolves to one element (`resolveTarget`) with an invalid status,
 * before their lines are known (`locateFindings` adds them): in store order of the requirements,
 * then in the order of the entries. A target that is missing, lies in a missing repository or is
 * ambiguous is another check (SR-089, SR-006, SR-088). Empty when the metamodel has no validity or
 * marks no status invalid.
 */
export const supersededValidityFindings = (context: SupersededContext): readonly LocatableFinding[] => {
  const scope = scopeOf(context);
  const findings: LocatableFinding[] = [];
  if (scope !== undefined) {
    for (const source of context.store.elements) {
      findingsOfSource(context, scope, source, findings);
    }
  }
  return findings;
};

/**
 * The same hints for one element, for a command that shows it (`element.get`). `source` need not
 * be the store's copy (a file read again); the variants are looked up in the store. One pass over
 * the store for the superseded variants (N-036: about as cheap as a filter).
 */
export const supersededValidityFindingsOf = (
  context: SupersededContext,
  source: ElementRecord,
): readonly LocatableFinding[] => {
  const scope = scopeOf(context);
  const findings: LocatableFinding[] = [];
  if (scope !== undefined) {
    findingsOfSource(context, scope, source, findings);
  }
  return findings;
};

/**
 * Every validity entry of the workspace that lists a superseded variant, as a hint with repository,
 * file, line, element and target ID (SR-040 AK3), for `workspace.check` (SR-019). One pass over the
 * store, then the files with hints are read again for the lines. Kept until the element store or
 * the metamodel is reset.
 */
export const supersededValidityProblemsState = defineWorkspaceState(
  "superseded-validity",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const shortIds = await workspace.get(shortIdState);
    return locateFindings(layout, supersededValidityFindings({ store, metamodel, shortIds }));
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
