// The installation that runs a command (workspace.connectAgent, SR-227 AK3): the runtime binary and the command
// line's `bin.js`. In the command line, `reqseq mcp`, `reqseq serve api` and `reqseq ui` the process is that command
// line, so its facts are those of the process; tests set others (`setInstallation`).
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

let given: Installation | undefined;

/** Sets the installation this process stands for; `undefined` goes back to the facts of the process. */
export const setInstallation = (installation: Installation | undefined): void => {
  given = installation;
};

/** The installation this process stands for. */
export const currentInstallation = (): Installation | undefined => given ?? installationOfProcess(process);
