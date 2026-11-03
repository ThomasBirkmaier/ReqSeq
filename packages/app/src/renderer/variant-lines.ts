// The two lines of a requirement's page about its variants, from `element.get` as it is (ADR-0002: core
// computes, the app lays out). The line of replacements and exclusions (SR-046 AK2): "Replaced in <variant>
// by <replacement> · Excluded in <variant>, <variant>", from `replacedBy` and `excludedBy`. The line of the
// verification status (SR-047 AK3): "Verification — Core: verified · <variant>: open", one part per entry of
// `verification` in core's order (core gives no row for a variant that excludes or replaces the
// requirement); an `open` one without own record names the children that are missing for an indirect
// verification (SR-034 AK2): "Core: open (missing SR-1 Title, SR-2 Title)". The validation status (SR-038
// AK1) is a line of its own: "Validation — validated". Variants, replacements and missing children are
// named by `names`; one `names` lacks is named by its UUID.
// On the page of a variant, one line per hint about a core requirement since its newest baseline (SR-103:
// changed, or new in its view), with core's message as `element.get` and the CLI give it (SR-080).
import type { ElementGetOutput, ElementName, ProblemCode } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import { elementBufferOf } from "./buffers.js";
import { idTitle } from "./id-title.js";
import { CORE_VIEW } from "./views.js";

/** A piece of a line: text, or an element named by its title that opens it. */
export type LinePart =
  { readonly text: string } | { readonly text: string; readonly id: string; readonly open: ElementBuffer };

export interface VariantLines {
  /** Where the requirement is replaced or excluded; undefined when nowhere. */
  readonly use: readonly LinePart[] | undefined;
  /** Its verification status per view; undefined when `element.get` gives none (not a requirement). */
  readonly verification: readonly LinePart[] | undefined;
  /** Its validation status (SR-038), apart from the verification status; undefined when `element.get` gives none. */
  readonly validation: readonly LinePart[] | undefined;
  /** The variant's hints since its newest baseline (SR-103), in core's order: whether new, and core's message. */
  readonly sinceBaseline: readonly SinceBaseline[];
}

/** A hint at a variant since its newest baseline: a core requirement changed since then, or new in its view. */
export interface SinceBaseline {
  readonly kind: "changed" | "new";
  readonly message: string;
}

/** The codes of the hints at a variant since its newest baseline (SR-103 AK1, AK7). Display only. */
export const SINCE_BASELINE_CODES: ReadonlySet<ProblemCode> = new Set<ProblemCode>([
  "variant.core-changed-since-baseline",
  "variant.core-new-since-baseline",
]);

const SEPARATOR: LinePart = { text: " · " };

/** An element by UUID: a link with `label` of its name, or its UUID when `names` lacks it. */
const named = (
  byId: ReadonlyMap<string, ElementName>,
  id: string,
  label: (name: ElementName) => string,
): LinePart => {
  const name = byId.get(id);
  return name === undefined ? { text: id } : { text: label(name), id, open: elementBufferOf(name) };
};

const titleOf = (name: ElementName): string => name.title;
const idTitleOf = (name: ElementName): string => idTitle(name.identifier ?? name.shortId, name.title);

/** `groups` joined by " · ". */
const joined = (groups: readonly (readonly LinePart[])[]): LinePart[] =>
  groups.flatMap((group, at) => (at === 0 ? group : [SEPARATOR, ...group]));

/** " (missing <child>, <child>)", each child a link by ID and title; nothing without missing children. */
const missing = (byId: ReadonlyMap<string, ElementName>, children: readonly string[]): LinePart[] =>
  children.length === 0
    ? []
    : [
        { text: " (missing " },
        ...children.flatMap((child, at) => [
          ...(at === 0 ? [] : [{ text: ", " }]),
          named(byId, child, idTitleOf),
        ]),
        { text: ")" },
      ];

/** The lines of the element `output` gives. */
export const variantLines = (output: Pick<ElementGetOutput, "element" | "names">): VariantLines => {
  const { element } = output;
  const byId = new Map((output.names ?? []).map((name) => [name.id, name]));
  const replaced = (element.replacedBy ?? []).map((entry): LinePart[] => [
    { text: "Replaced in " },
    named(byId, entry.variant, titleOf),
    { text: " by " },
    named(byId, entry.replacement, idTitleOf),
  ]);
  const excludedBy = element.excludedBy ?? [];
  const excluded: LinePart[][] =
    excludedBy.length === 0
      ? []
      : [
          [
            { text: "Excluded in " },
            ...excludedBy.flatMap((variant, at) => [
              ...(at === 0 ? [] : [{ text: ", " }]),
              named(byId, variant, titleOf),
            ]),
          ],
        ];
  const use = [...replaced, ...excluded];
  const verification = element.verification?.map((entry): LinePart[] => [
    entry.view === CORE_VIEW.view ? { text: CORE_VIEW.title } : named(byId, entry.view, titleOf),
    { text: `: ${entry.status}` },
    ...missing(byId, entry.missingChildren ?? []),
  ]);
  return {
    use: use.length === 0 ? undefined : joined(use),
    verification:
      verification === undefined || verification.length === 0
        ? undefined
        : [{ text: "Verification — " }, ...joined(verification)],
    validation:
      element.validation === undefined ? undefined : [{ text: `Validation — ${element.validation}` }],
    sinceBaseline: (element.problems ?? [])
      .filter((problem) => SINCE_BASELINE_CODES.has(problem.code))
      .map((problem) => ({
        kind: problem.code === "variant.core-new-since-baseline" ? "new" : "changed",
        message: problem.message,
      })),
  };
};
