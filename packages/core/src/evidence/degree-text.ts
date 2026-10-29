// How a verification degree (SR-037, `data-export.schema.json#/$defs/verificationDegree`) is shown: its
// share as a percentage rounded down to one decimal, `60 %`, `66.6 %`, `64.2 %`, so 100 % only when every
// counted requirement is verified or indirect (ADR-0012 "Status rules", bullet "Verification degree";
// assumption of spec question #592 Q3). One rule on every access: the CLI's readable output imports it
// from `@reqseq/core`, the app's result buffer from `@reqseq/core/verification-degree`. This module
// imports nothing, so the renderer bundle loads no other part of core with it.

/**
 * `share` (0 to 1) as a percentage rounded down to one decimal, with a space before `%`. The `1e-9`
 * keeps a float error from dropping a whole tenth; it cannot lift a value: for `k/n` with n up to 10⁶,
 * `1000 k/n` is at least `1/n` away from the next integer above it.
 */
export const degreePercent = (share: number): string => `${String(Math.floor(share * 1000 + 1e-9) / 10)} %`;

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
