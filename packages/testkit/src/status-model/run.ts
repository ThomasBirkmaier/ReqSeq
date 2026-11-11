// Runs a property over generated elements (#1394), so that the property tests in core need no fast-check import of
// their own. `numRuns` and `seed` come from the environment (STATUS_MODEL_RUNS, STATUS_MODEL_SEED) with fixed
// defaults, so a pull request run is reproducible and a nightly run can pass a random seed. fast-check names the seed
// and the shrunk input in the error of a failing run; the message adds how to replay it.
import fc from "fast-check";
import { statusModelElement } from "./generator.js";
import type { ModelElement } from "./model.js";

/** The fixed seed of a run without STATUS_MODEL_SEED. */
export const DEFAULT_SEED = 1394;
/** The runs per property without STATUS_MODEL_RUNS. */
export const DEFAULT_RUNS = 1000;

export interface PropertyParameters {
  readonly numRuns: number;
  readonly seed: number;
}

/** A whole number from `value`, or `fallback` when it is absent or not one. */
function integerOr(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value === undefined || value.trim() === "" || !Number.isSafeInteger(parsed) ? fallback : parsed;
}

/** The parameters of a run from `env` (see the file comment). */
export function propertyParameters(env: Readonly<Record<string, string | undefined>>): PropertyParameters {
  return {
    numRuns: Math.max(1, integerOr(env["STATUS_MODEL_RUNS"], DEFAULT_RUNS)),
    // fast-check takes a 32-bit seed; reduced here, so the seed a failure prints is the one that ran and replays.
    seed: integerOr(env["STATUS_MODEL_SEED"], DEFAULT_SEED) | 0,
  };
}

/** Checks `check` (which throws on a difference) on generated elements; throws with the seed on the first failure. */
export function forAllElements(check: (element: ModelElement) => void, parameters: PropertyParameters): void {
  try {
    fc.assert(fc.property(statusModelElement(), check), {
      numRuns: parameters.numRuns,
      seed: parameters.seed,
    });
  } catch (error) {
    // fast-check's message holds the seed, the replay path and the shrunk counterexample; keep it in the message, as
    // a short reporter may not print the cause.
    // fc.assert always throws an Error.
    const detail = (error as Error).message;
    throw new Error(
      `Status model property failed; replay with STATUS_MODEL_SEED=${String(parameters.seed)} ` +
        `STATUS_MODEL_RUNS=${String(parameters.numRuns)}\n${detail}`,
      { cause: error },
    );
  }
}
