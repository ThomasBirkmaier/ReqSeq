// Runs a property over generated elements (#1394), so that the property tests in core need no fast-check import of
// their own. `numRuns` and `seed` come from the environment (STATUS_MODEL_RUNS, STATUS_MODEL_SEED) with fixed
// defaults, so a pull request run is reproducible and a nightly run can pass a random seed. fast-check names the seed
// and the shrunk input in the error of a failing run; the message adds how to replay it.
import fc from "fast-check";
import { type ModelFileWorkspace, statusModelFileWorkspace } from "./file-workspace.js";
import { statusModelElement } from "./generator.js";
import type { ModelElement } from "./model.js";
import { statusModelWorkspace } from "./workspace-generator.js";
import type { ModelWorkspace } from "./workspace-model.js";

/** The fixed seed of a run without STATUS_MODEL_SEED. */
export const DEFAULT_SEED = 1394;
/** The runs per property without STATUS_MODEL_RUNS. */
export const DEFAULT_RUNS = 1000;

export interface PropertyParameters {
  readonly numRuns: number;
  readonly seed: number;
}

/** The runs of a level-2 property (a workspace on disk each) without STATUS_MODEL_FILE_RUNS (#1396). */
export const DEFAULT_FILE_RUNS = 30;

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

/** The parameters of a level-2 run: STATUS_MODEL_FILE_RUNS (default 30) and the seed of `propertyParameters`. */
export function fileParameters(env: Readonly<Record<string, string | undefined>>): PropertyParameters {
  return {
    numRuns: Math.max(1, integerOr(env["STATUS_MODEL_FILE_RUNS"], DEFAULT_FILE_RUNS)),
    seed: propertyParameters(env).seed,
  };
}

/** Checks `check` (which throws on a difference) on generated elements; throws with the seed on the first failure. */
export function forAllElements(check: (element: ModelElement) => void, parameters: PropertyParameters): void {
  try {
    fc.assert(fc.property(statusModelElement(), check), parameters);
  } catch (error) {
    throw replayError(error, parameters);
  }
}

/** Checks the async `check` on generated workspaces (#1395), like `forAllElements`. */
export async function forAllWorkspaces(
  check: (workspace: ModelWorkspace) => Promise<void>,
  parameters: PropertyParameters,
): Promise<void> {
  try {
    await fc.assert(fc.asyncProperty(statusModelWorkspace(), check), parameters);
  } catch (error) {
    throw replayError(error, parameters);
  }
}

/** Checks the async `check` on generated file workspaces (#1396), like `forAllElements`. */
export async function forAllFileWorkspaces(
  check: (files: ModelFileWorkspace) => Promise<void>,
  parameters: PropertyParameters,
): Promise<void> {
  try {
    await fc.assert(fc.asyncProperty(statusModelFileWorkspace(), check), parameters);
  } catch (error) {
    throw replayError(error, parameters);
  }
}

// fast-check's message holds the seed, the replay path and the shrunk counterexample; keep it in the message, as a
// short reporter may not print the cause. fc.assert always throws an Error.
function replayError(error: unknown, parameters: PropertyParameters): Error {
  const detail = (error as Error).message;
  return new Error(
    `Status model property failed; replay with STATUS_MODEL_SEED=${String(parameters.seed)} ` +
      `STATUS_MODEL_RUNS=${String(parameters.numRuns)} (level 2: STATUS_MODEL_FILE_RUNS)\n${detail}`,
    { cause: error },
  );
}
