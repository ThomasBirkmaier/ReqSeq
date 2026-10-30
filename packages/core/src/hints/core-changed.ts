// A changed core requirement at its replacement (SR-045, D-042, N-022): "Wenn sich ein
// Kern-Requirement ändert, das eine Variante durch ein eigenes Requirement ersetzt hat, muss das
// Tool am ersetzenden Requirement einen Hinweis zeigen, den die Variante auflistet."
//
// - Which items: an outdated item (`outdated.ts`) of a relation kind with the meaning `replacement`,
//   from a source with a validity entry, onto a core requirement (`isCoreRequirement`): the items the
//   view rule reads as replacements (`variants/view-rule.ts`), whatever the variant excludes. Such an
//   item gives `variant.core-changed` instead of `relation.outdated`, so the change is one hint at the
//   replacing requirement, not two (AK1); it is confirmed like an outdated relation (AK2).
// - A replacement from a requirement without validity (SR-041 AK6) or onto no core requirement
//   (SR-041 AK8) stays `relation.outdated`.
// - A superseded target (a status the metamodel marks invalid, D-044) keeps the usual hints of a
//   relation and gives no `variant.core-changed` (AK4): `relation.target-superseded` with its
//   successor and, when its content changed too, `relation.outdated` (assumption: AK4 names only the
//   superseded-target hint, and "kein Hinweis nach AK1" is read as no `variant.core-changed`).
// - Title and status are no part of the version (ADR-0005), so a change of the title alone gives no
//   hint (AK3); the next write of the source's file stores the new title (`withCurrentTitles`).
import type { Metamodel } from "../metamodel/index.js";
import { relationKindsWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { invalidStatuses } from "../model/index.js";
import { isCoreRequirement, validityEntries, validityOf } from "../variants/index.js";

/** What the predicate reads of a metamodel, built once per metamodel. */
interface Scope {
  readonly replacement: ReadonlySet<string>;
  readonly validity: ReturnType<typeof validityOf>;
  readonly invalid: ReadonlyMap<string, unknown>;
}

const scopes = new WeakMap<Metamodel, Scope>();

const scopeOf = (metamodel: Metamodel): Scope => {
  let scope = scopes.get(metamodel);
  if (scope === undefined) {
    scope = {
      replacement: new Set(relationKindsWithMeaning(metamodel, "replacement").map((kind) => kind.key)),
      validity: validityOf(metamodel),
      invalid: invalidStatuses(metamodel),
    };
    scopes.set(metamodel, scope);
  }
  return scope;
};

/** Whether an outdated item under `key` of `source` onto `target` reports a changed core requirement (see the file comment). */
export const isCoreChange = (
  metamodel: Metamodel,
  source: ElementRecord,
  key: string,
  target: ElementRecord,
): boolean => {
  const scope = scopeOf(metamodel);
  return (
    scope.replacement.has(key) &&
    validityEntries(scope.validity, source).length > 0 &&
    isCoreRequirement({ metamodel }, target) &&
    !scope.invalid.has(String(target.data["status"]))
  );
};
