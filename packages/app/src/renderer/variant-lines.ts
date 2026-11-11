// The lines of a requirement's page about its variants, from `element.get` as it is (ADR-0002: core
// computes, the app lays out). The line of replacements and exclusions (SR-046 AK2): "Replaced in <variant>
// by <replacement> · Excluded in <variant>, <variant>", from `replacedBy` and `excludedBy`. The verification
// status (SR-047 AK3) is one badge per entry of `verification` in core's order (SR-157 AK1; core gives no
// entry for a variant that excludes or replaces the requirement): the name of the core or the variant, and
// its status with the details that belong to it. An `open` one without own record names the children that
// are missing for an indirect verification (SR-034 AK2): "open (missing SR-1, SR-2)"; one from
// own records of a requirement with acceptance criteria counts them (SR-031 AK5): "open (2 of 3 criteria,
// AK3 not verified)". The validation status (SR-038
// AK1) is a line of its own: "Validation — validated"; an inconclusive one gives its reason on that line
// (SR-172 AK2): "Validation — inconclusive: <reason>", one line, cut at `REASON_LENGTH`; a cut one gives the
// whole reason as written as the line's title, shown on demand (#846, D-062). Variants, replacements and missing children are
// named by `names`; one `names` lacks is named by its UUID.
// On the page of a variant, one line per hint about a core requirement since its newest baseline (SR-103:
// changed, or new in its view), with core's message as `element.get` and the CLI give it (SR-080).
import type { ElementGetOutput, ElementName, ProblemCode } from "@reqseq/core";
import type { ElementBuffer } from "./buffers.js";
import { elementBufferOf } from "./buffers.js";
import { criterionLabel } from "@reqseq/core/criterion-items";
import { shownIdTitle } from "./id-title.js";
import { CORE_VIEW } from "./views.js";

/** A piece of a line: text, or an element named by its title that opens it. */
export type LinePart =
  { readonly text: string } | { readonly text: string; readonly id: string; readonly open: ElementBuffer };

export interface VariantLines {
  /** Where the requirement is replaced or excluded; undefined when nowhere. */
  readonly use: readonly LinePart[] | undefined;
  /** Its verification status, one badge per view; undefined when `element.get` gives none (not a requirement). */
  readonly verification: readonly Badge[] | undefined;
  /** Its validation status (SR-038), apart from the verification status; undefined when `element.get` gives none. */
  readonly validation: readonly LinePart[] | undefined;
  /** The whole reason of an inconclusive validation, as written, when the validation line cuts it; else undefined. */
  readonly validationTitle: string | undefined;
  /** The variant's hints since its newest baseline (SR-103), in core's order: whether new, and core's message. */
  readonly sinceBaseline: readonly SinceBaseline[];
}

type Verification = NonNullable<ElementGetOutput["element"]["verification"]>[number];

/** The verification status of one view as a badge (SR-157 AK1). */
export interface Badge {
  /** The left half: the word for the core, or the variant, a link to it (AK5). */
  readonly name: LinePart;
  /** Core's status word, which picks the colour of the right half (AK3). */
  readonly status: Verification["status"];
  /** The right half: the status with its details, the missing children as links (SR-031 AK5, SR-034 AK2). */
  readonly parts: readonly LinePart[];
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

export const SEPARATOR: LinePart = { text: " · " };

/** The longest reason the validation line shows; a longer one ends in `…` (the file keeps it whole). */
export const REASON_LENGTH = 200;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `text` with each run of white space and control characters one space, trimmed. */
const oneLine = (text: string): string => text.replace(/[\s\p{Cc}]+/gu, " ").trim();

/**
 * The whole `reason` when `reasonLine` cuts it, else undefined: as written, its line breaks and tabs kept,
 * other control characters (such as an escape from YAML) left out.
 */
export const wholeReason = (reason: string): string | undefined =>
  reasonLine(reason) === oneLine(reason) ? undefined : reason.replace(/[^\P{Cc}\n\t]/gu, "");

/**
 * A reason (SR-172) on one line: each run of white space and control characters one space, cut to
 * `REASON_LENGTH` characters as the reader sees them (graphemes), so an emoji is never split.
 */
export const reasonLine = (reason: string): string => {
  const line = oneLine(reason);
  // A string never has more graphemes than UTF-16 units, so a short one needs no segmenting, and
  // a long one is segmented only up to the cut.
  if (line.length <= REASON_LENGTH) {
    return line;
  }
  const kept: string[] = [];
  for (const { segment } of GRAPHEMES.segment(line)) {
    if (kept.length === REASON_LENGTH) {
      return `${kept.slice(0, REASON_LENGTH - 1).join("")}…`;
    }
    kept.push(segment);
  }
  return line;
};

/** The validation line: "Validation — <status>", with ": <reason>" for an inconclusive one (SR-172 AK2). */
const validationLine = (element: ElementGetOutput["element"]): string =>
  `Validation — ${String(element.validation)}${
    element.validationReason === undefined ? "" : `: ${reasonLine(element.validationReason)}`
  }`;

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
const idTitleOf = (name: ElementName): string => shownIdTitle(name.shortId, name.identifier, name.title);
/** The short ID alone, for a compact badge (#1283); its hover gives the full name (SR-084 AK4). */
const shortIdOf = (name: ElementName): string => name.shortId;

/** `groups` joined by " · ". */
export const joined = (groups: readonly (readonly LinePart[])[]): LinePart[] =>
  groups.flatMap((group, at) => (at === 0 ? group : [SEPARATOR, ...group]));

/**
 * " (missing <child>, <child>)", each child a link by its short ID with the shown ID and title as its title
 * (shown on hover); nothing without missing children. Only the short ID, so that a badge stays compact (#1283).
 */
const missing = (byId: ReadonlyMap<string, ElementName>, children: readonly string[]): LinePart[] =>
  children.length === 0
    ? []
    : [
        { text: " (missing " },
        ...children.flatMap((child, at) => [
          ...(at === 0 ? [] : [{ text: ", " }]),
          named(byId, child, shortIdOf),
        ]),
        { text: ")" },
      ];

type Criteria = NonNullable<Verification["criteria"]>;

/** How many acceptance criteria are verified (SR-031 AK5): " (2 of 3 criteria, AK3 not verified)"; empty without. */
const criteriaText = (criteria: Criteria | undefined): string => {
  if (criteria === undefined) {
    return "";
  }
  const open = (criteria.notVerified ?? []).map(criterionLabel);
  return ` (${String(criteria.verified)} of ${String(criteria.total)} criteria${open.length === 0 ? "" : `, ${open.join(", ")} not verified`})`;
};

/** Whether the element has a verification or validation status: a requirement or need, or one with a validation record. */
export const hasStatus = (
  element: Pick<ElementGetOutput["element"], "verification" | "validation">,
): boolean => element.verification !== undefined || element.validation !== undefined;

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
  const verification = element.verification?.map((entry): Badge => ({
    name: entry.view === CORE_VIEW.view ? { text: CORE_VIEW.title } : named(byId, entry.view, titleOf),
    status: entry.status,
    parts: [
      { text: `${entry.status}${criteriaText(entry.criteria)}` },
      ...missing(byId, entry.missingChildren ?? []),
    ],
  }));
  return {
    use: use.length === 0 ? undefined : joined(use),
    verification: verification === undefined || verification.length === 0 ? undefined : verification,
    validation: element.validation === undefined ? undefined : [{ text: validationLine(element) }],
    validationTitle:
      element.validation === undefined || element.validationReason === undefined
        ? undefined
        : wholeReason(element.validationReason),
    sinceBaseline: (element.problems ?? [])
      .filter((problem) => SINCE_BASELINE_CODES.has(problem.code))
      .map((problem) => ({
        kind: problem.code === "variant.core-new-since-baseline" ? "new" : "changed",
        message: problem.message,
      })),
  };
};
