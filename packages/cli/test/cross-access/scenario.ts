// The shape of a cross-access scenario and of the results it compares (cross-access.test.ts).
import type { CommandName } from "@reqseq/core";
import type { FixtureOptions } from "@reqseq/testkit";

export interface Scenario {
  readonly name: string;
  /** The fixture workspace; default: SR-004/one-repository as one Git repository. */
  readonly fixture?: FixtureOptions;
  /** Folder of the workspace inside the fixture; default its root. */
  readonly root?: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** The tag the test name starts with; default `[SR-080/AK2]`. */
  readonly tag?: string;
  /** What core gives; guards against a scenario that only ever compares the same error. */
  readonly expect: "output" | "error";
  /**
   * The output names a new element with a random UUID: its UUID, the 12 and 6 digit tails (file name,
   * short ID) and its version are replaced by placeholders in the outcome and the files before comparing.
   * For the new elements of an import (`created`), each UUID and its tails get a numbered placeholder,
   * and every version is replaced, as the planned versions hold the random UUIDs.
   */
  readonly newElement?: boolean;
  /**
   * Prepares state before each access, with the same result every time (the list of recent
   * workspaces in the OS cache folder, SR-131; a commit after a baseline, SR-051). A read command's
   * shared copy is prepared once more before its files are taken, so the preparation must be idempotent.
   */
  readonly prepare?: (copy: Copy) => Promise<void>;
  /** Parts of the outcome and the files that differ by call (an export time, a new UUID), each replaced by `<masked>`. */
  readonly masks?: readonly RegExp[];
  /** More checks on the results of all accesses, after they compared equal. */
  readonly check?: (results: Readonly<Record<string, Result>>) => void;
}

export type Outcome = { readonly output: unknown } | { readonly error: unknown };

/** A copy of a fixture: its top folder, and the workspace root in it. */
export interface Copy {
  readonly top: string;
  readonly root: string;
}

/** The result of one access: its outcome, and the files of its copy afterwards. */
export interface Result {
  readonly outcome: Outcome;
  readonly files: Record<string, string>;
}

/** The explicit scenarios by command, as the modules under scenarios/ register them. */
export const SCENARIOS = new Map<CommandName, readonly Scenario[]>();

/** Registers the explicit scenarios of `command`, in addition to its default one; one module per command. */
export const scenariosOf = (command: CommandName, scenarios: readonly Scenario[]): void => {
  if (SCENARIOS.has(command)) {
    throw new Error(`Scenarios of ${command} registered twice`);
  }
  SCENARIOS.set(command, scenarios);
};
