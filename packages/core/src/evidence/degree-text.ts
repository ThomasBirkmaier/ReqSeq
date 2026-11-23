// How a verification degree (SR-037, `data-export.schema.json#/$defs/verificationDegree`) is shown: its
// share as a percentage rounded down to one decimal, `60 %`, `66.6 %`, `64.2 %`, so 100 % only when every
// counted requirement is verified or indirect (ADR-0012 "Status rules", bullet "Verification degree";
// assumption of spec question ThomasBirkmaier/ReqSeq-archive#592 Q3). One rule on every access. The head of
// a matrix column with minima (SR-153 AK1) and the sentence on a degree (`degreeClause`) are built here too,
// so the CLI, the HTML export and every test that compares with them use one rule.

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

/** A verification degree (`evidence.degree`): its share and the count per verification status. */
export interface SummaryDegree {
  readonly share?: number;
  readonly counts: Readonly<Record<"verified" | "indirect" | "failed" | "outdated" | "open", number>>;
}

/**
 * The sentence on a degree without its period, e.g. "1 of 3 requirements in the core are verified or indirectly
 * verified (33.3 %)": `where` (" in the core", " in view core", or empty) follows the noun, the noun and its verb
 * agree with `total`, not with the verified count, and the share is left out when the degree has none. The HTML
 * export's start page and variant pages and the answer of `evidence.degree` build it here.
 */
export const degreeClause = (degree: SummaryDegree & { readonly total: number }, where = ""): string => {
  const verified = degree.counts.verified + degree.counts.indirect;
  const one = degree.total === 1;
  const share = degree.share === undefined ? "" : ` (${degreePercent(degree.share)})`;
  return `${String(verified)} of ${String(degree.total)} ${one ? "requirement" : "requirements"}${where} ${one ? "is" : "are"} verified or indirectly verified${share}`;
};
