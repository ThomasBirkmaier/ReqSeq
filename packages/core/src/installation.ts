// The installation that runs a command (workspace.connectAgent, SR-227 AK3): the runtime binary and the command
// line's `bin.js`. In the command line, `reqseq mcp`, `reqseq serve api` and `reqseq ui` the process is that command
// line, so its facts are those of the process. A process that runs another entry is handed the facts as one
// argument (`installationArgument`), which it reads (`installationFromArgv`).
import path from "node:path";

export interface Installation {
  /** The absolute path of the runtime binary: the Node of a delivery (`runtime/node`) or another Node. */
  readonly runtime: string;
  /** The absolute path of the command line's entry, `cli/dist/bin.js`. */
  readonly entry: string;
}

/** The parts of `process` the facts come from. */
export interface InstallationProcess {
  readonly execPath: string;
  readonly argv: readonly string[];
}

/** The installation of a process that runs the command line's `bin.js`; undefined without a script. */
export const installationOfProcess = (facts: InstallationProcess): Installation | undefined => {
  const script = facts.argv[1];
  return script === undefined ? undefined : { runtime: facts.execPath, entry: path.resolve(script) };
};

let given: Installation | null | undefined;

/**
 * Sets the installation a process that does not run `bin.js` itself stands for; `null`
 * when it was handed none, so that the process stands for no installation rather than for its own script.
 * `undefined` goes back to the facts of the process.
 */
export const setInstallation = (installation: Installation | null | undefined): void => {
  given = installation;
};

/** The installation this process stands for. */
export const currentInstallation = (): Installation | undefined =>
  given === null ? undefined : (given ?? installationOfProcess(process));

const ARGUMENT = "--reqseq-installation=";

/** The argument that hands an installation to a forked process. */
export const installationArgument = (installation: Installation): string =>
  `${ARGUMENT}${JSON.stringify(installation)}`;

/** The installation an `installationArgument` in `argv` names; undefined without one or when it is not valid. */
export const installationFromArgv = (argv: readonly string[]): Installation | undefined => {
  const argument = argv.find((value) => value.startsWith(ARGUMENT));
  if (argument === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(argument.slice(ARGUMENT.length));
  } catch {
    return undefined;
  }
  const { runtime, entry } = (value ?? {}) as Partial<Record<keyof Installation, unknown>>;
  return typeof runtime === "string" && typeof entry === "string" ? { runtime, entry } : undefined;
};
