// Command line of the app: `--workspace <folder>` (or `--workspace=<folder>`) opens that folder at start,
// relative to the current folder, as the CLI's option does (ADR-0009).
import path from "node:path";

const FLAG = "--workspace";

export const workspaceArgument = (argv: readonly string[], cwd: string): string | undefined => {
  for (const [index, argument] of argv.entries()) {
    const value =
      argument === FLAG
        ? argv[index + 1]
        : argument.startsWith(`${FLAG}=`)
          ? argument.slice(FLAG.length + 1)
          : undefined;
    if (value !== undefined && value !== "") {
      return path.resolve(cwd, value);
    }
  }
  return undefined;
};
