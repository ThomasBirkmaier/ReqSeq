// `evidence.counts-in-no-view` (warning, SR-047 AK5) for `workspace.check`: a verification record that counts in
// no view. Its view is its variant, or the core without one; it counts nowhere when that view does not
// hold its element (`recordOutOfView`: not valid there, excluded or replaced) and, for a record of the
// core of an element of a repository marked `variant-independent`, no variant's view holds it either
// (SR-173 AK1). A record is not reported while another record of the same execution (a JUnit test
// case for several views, SR-093 AK5, SR-029 AK11) counts for the same element, since CI writes the
// core and one variant per test case.
//
// Only a verification record whose element has one copy of a type with the meaning `requirement`, and
// whose variant (when it names one) is one element of a type with the meaning `variant`: the other
// cases have their own findings (`evidence.unknown-element`, `evidence.ambiguous-element`,
// `evidence.kind-mismatch`) or count for no status anyway. A validation counts per element, in no view
// (SR-038 AK4). None while the metamodel is not valid, since the views need the meanings.
import type { Problem } from "../catalog.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import type { ResolvedView } from "../variants/index.js";
import { variantTypes } from "../variants/index.js";
import type { OutOfView, RecordViewContext } from "./in-variant.js";
import { recordOutOfView } from "./in-variant.js";
import { executionOf } from "./holds.js";
import type { EvidenceRecord } from "./record.js";

/** The one copy of `id` in the store, or undefined. */
const onlyCopy = (context: RecordViewContext, id: string): ElementRecord | undefined => {
  const [element, ...others] = context.store.byId.get(id) ?? [];
  return others.length > 0 ? undefined : element;
};

/** A checked record: its element, its view and why it counts nowhere (undefined: it counts). */
interface Checked {
  readonly record: EvidenceRecord;
  readonly element: ElementRecord;
  readonly view: ResolvedView;
  readonly out: OutOfView | undefined;
}

/** `the core`, or `the variant <short ID>`. */
const viewName = (context: RecordViewContext, view: ResolvedView): string =>
  view.kind === "core" ? "the core" : `the variant ${context.shortIds.of(view.variant)}`;

/** `evidence.counts-in-no-view` of `records`, in their order (see the file comment). */
export const noViewProblems = (context: RecordViewContext, records: readonly EvidenceRecord[]): Problem[] => {
  const { metamodel, shortIds } = context;
  if (!metamodel.valid) {
    return [];
  }
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  const variants = variantTypes(metamodel);
  const checked: Checked[] = [];
  for (const record of records) {
    const element = record.kind === "verification" ? onlyCopy(context, record.element) : undefined;
    if (element === undefined || !requirements.has(element.type)) {
      continue;
    }
    const variant = record.variant === undefined ? undefined : onlyCopy(context, record.variant);
    if (record.variant !== undefined && (variant === undefined || !variants.has(variant.type))) {
      continue;
    }
    const view: ResolvedView = variant === undefined ? { kind: "core" } : { kind: "variant", variant };
    checked.push({ record, element, view, out: recordOutOfView(context, element, view) });
  }
  const counting = new Set(checked.filter((c) => c.out === undefined).map((c) => executionOf(c.record)));
  return checked.flatMap(({ record, element, view, out }): Problem[] =>
    out === undefined || counting.has(executionOf(record))
      ? []
      : [
          {
            code: "evidence.counts-in-no-view",
            severity: "warning",
            message: `The verification record of ${shortIds.of(element)} for ${viewName(context, view)} counts in no view: ${shortIds.of(element)} ${out.why}`,
            ...(record.repository === undefined ? {} : { repository: record.repository }),
            ...(record.file === undefined ? {} : { file: record.file }),
            ...(record.line === undefined ? {} : { line: record.line }),
            targetId: record.element,
            targetRepository: element.repository,
          },
        ],
  );
};
