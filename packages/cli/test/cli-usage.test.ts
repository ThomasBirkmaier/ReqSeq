// The command help of the app shows the call of a command on the command line (SR-210 AK3). The app's core
// process writes it from the catalog (`packages/app/src/core/cli-usage.ts`); this checks, for every command of
// the catalog, that it is the usage line of the command's own `--help`.
import { Readable } from "node:stream";
import { cliUsage } from "@reqseq/app";
import { createCommandRuntime } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/index.js";

const runtime = createCommandRuntime();

/** The usage line of `reqseq <args> --help`, without "Usage: ". */
const usageOf = async (args: readonly string[]): Promise<string | undefined> => {
  let text = "";
  const sink = {
    write: (chunk: string): boolean => {
      text += chunk;
      return true;
    },
  };
  await runCli({
    argv: [...args, "--help"],
    cwd: process.cwd(),
    stdin: Readable.from([]),
    stdout: sink,
    stderr: sink,
    runtime,
  });
  return /^Usage: (.*)$/mu.exec(text)?.[1];
};

describe("the call on the command line in the app's command help (SR-210 AK3)", () => {
  it.each(runtime.contracts.commands.map((entry) => [entry.name, entry] as const))(
    "%s: the app writes the usage line of the command's --help",
    async (_name, entry) => {
      const line = cliUsage(entry, runtime.contracts.schemas);
      const [, group, action] = line.split(" ");
      expect(await usageOf([group ?? "", action ?? ""])).toBe(line);
    },
  );
});
