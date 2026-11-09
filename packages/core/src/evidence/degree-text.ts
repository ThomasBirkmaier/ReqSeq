// How a verification degree (SR-037, `data-export.schema.json#/$defs/verificationDegree`) is shown: its
// share as a percentage rounded down to one decimal, `60 %`, `66.6 %`, `64.2 %`, so 100 % only when every
// counted requirement is verified or indirect (ADR-0012 "Status rules", bullet "Verification degree";
// assumption of spec question ThomasBirkmaier/ReqSeq-archive#592 Q3). One rule on every access: the CLI's readable output imports it
// from `@reqseq/core`, the app's result buffer from `@reqseq/core/verification-degree`. This module
// imports nothing but types, so the renderer bundle loads no other part of core with it. The line of a package page
// (SR-112 AK3) and the head of a matrix column with minima (SR-153 AK1) are built here too, so the app,
// the CLI and every test that compares with them use one rule.

import type { EvidenceDegreeOutput } from "../generated/types.js";

/**
 * `share` (0 to 1) as a percentage rounded down to one decimal, with a space before `%`. The `1e-9`
 * keeps a float error from dropping a whole tenth; it cannot lift a value: for `k/n` with n up to 10⁶,
 * `1000 k/n` is at least `1/n` away from the next integer above it.
 */
export const degreePercent = (share: number): string => `${String(Math.floor(share * 1000 + 1e-9) / 10)} %`;

/**
 * The head of a matrix column with minima (SR-153 AK1): how many rows meet them, of how many they apply to,
 * and their share as `degreePercent`, e.g. "2 of 5 · 40 %".
 */
export const minimumHeadText = (met: number, expected: number, share: number): string =>
  `${String(met)} of ${String(expected)} · ${degreePercent(share)}`;

/**
 * The share of `value` when it has the shape of a verification degree (a number `share` next to an
 * object `counts`), else undefined. Layout code finds a degree by this shape alone, at any depth of
 * any output (`evidence.degree`, `trace.matrix` with SR-126), without naming a command (ADR-0002).
 */
export const degreeShareOf = (value: unknown): number | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const { share, counts } = value as Readonly<Record<string, unknown>>;
  return typeof share === "number" && typeof counts === "object" && counts !== null && !Array.isArray(counts)
    ? share
    : undefined;
};

/** A level of `evidence.coverage`; `withEvidence` is there only for a type with the meaning `requirement`. */
export interface SummaryLevel {
  readonly total: number;
  readonly withEvidence?: number;
}

/** A verification degree (`evidence.degree`): its share and the count per verification status. */
export interface SummaryDegree {
  readonly share?: number;
  readonly counts: Readonly<Record<"verified" | "indirect" | "failed" | "outdated" | "open", number>>;
}

/** A variant as `names` of `evidence.degree` gives it (`common.schema.json#/$defs/elementName`). */
export type SummaryName = NonNullable<EvidenceDegreeOutput["names"]>[number];

/** What the line takes of `evidence.degree`: the degree, the view it is for, and the name of a variant view. */
export type SummaryDegreeOutput = Pick<EvidenceDegreeOutput, "view" | "names"> & {
  readonly degree: SummaryDegree;
};

/**
 * How the line names the view of the degree (SR-112 AK3). The core is `core`, as the example of SR-112 AK3
 * writes it (and `evidence.degree` gives it). A variant is its title from `names`, the title the modeline
 * shows for the view (`viewMark` in the app's `views.ts`). Our own choice beyond that: a variant without a
 * title is its short ID, and one that `names` does not name is the ID in `view`.
 */
export const summaryViewText = (view: string, names: readonly SummaryName[] | undefined): string => {
  if (view === "core") {
    return view;
  }
  const name = names?.find((entry) => entry.id === view);
  if (name === undefined) {
    return view;
  }
  return name.title === "" ? name.shortId : name.title;
};

/** The order the statuses are named in the line: those that count for the degree first. */
const SUMMARY_STATUSES = ["verified", "indirect", "failed", "outdated", "open"] as const;

/**
 * The line of a package page (SR-112 AK3, AK4): the coverage summed over the requirement levels (those with
 * `withEvidence`; needs are not in it), then the degree with the view it is for (`summaryViewText`) and the
 * count of each status that occurs, e.g.
 * "Coverage 8 of 10 with evidence · Degree (core) 60 % (6 verified, 1 failed, 1 outdated, 2 open)". Undefined
 * when the selection has no counted requirement: such a package has no line (AK4).
 */
export const packageSummaryText = (
  levels: readonly SummaryLevel[],
  output: SummaryDegreeOutput,
): string | undefined => {
  let total = 0;
  let withEvidence = 0;
  for (const level of levels) {
    if (level.withEvidence !== undefined) {
      total += level.total;
      withEvidence += level.withEvidence;
    }
  }
  if (total === 0) {
    return undefined;
  }
  const { degree } = output;
  const counts = SUMMARY_STATUSES.filter((status) => degree.counts[status] > 0).map(
    (status) => `${String(degree.counts[status])} ${status}`,
  );
  const view = summaryViewText(output.view, output.names);
  return `Coverage ${String(withEvidence)} of ${String(total)} with evidence · Degree (${view}) ${degreePercent(degree.share ?? 0)} (${counts.join(", ")})`;
};
