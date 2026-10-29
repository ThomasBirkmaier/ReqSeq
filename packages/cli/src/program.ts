// The commander tree, generated from the command catalog (ADR-0002 rule 3, ADR-0009). No command is
// named here: groups, actions, arguments and flags all come from the catalog entries.
import type { CatalogEntry, CommandRuntime } from "@logreq/core";
import { Command, Option } from "commander";
import type { InputField } from "./fields.js";
import { RESERVED_FLAGS, inputFields, kebab } from "./fields.js";

/** What the command line asked for, before it becomes a command input. */
export interface Invocation {
  readonly entry: CatalogEntry;
  /** All input fields of the command. */
  readonly fields: readonly InputField[];
  /** Positional fields with their values (`undefined` when not given). */
  readonly positionals: readonly { readonly field: InputField; readonly value: string | undefined }[];
  /**
   * Flag fields with their raw values (`undefined` when not given); positional fields given as a
   * flag (`--title` next to `<title>`) too.
   */
  readonly flags: readonly { readonly field: InputField; readonly value: unknown }[];
  /** `--json`. */
  readonly json: boolean;
  /** `--yaml`: the whole output as YAML instead of the compact form. */
  readonly yaml: boolean;
  /** `--jsonl`: the output as JSON Lines (only on entries with `jsonLines`, #319). */
  readonly jsonl: boolean;
  /** `--workspace`, as given. */
  readonly workspace: string | undefined;
  /** `--input`, as given. */
  readonly input: string | undefined;
}

/** `logreq serve api` or `logreq mcp`: a server over the whole catalog instead of one command. */
export type ServeRequest =
  | { readonly server: "api"; readonly port: string | undefined; readonly workspace: string | undefined }
  | { readonly server: "mcp"; readonly workspace: string | undefined };

/** Top-level commands of the CLI itself; no catalog group may take these names. */
export const SERVER_COMMANDS: readonly string[] = ["serve", "mcp"];

export interface ProgramOptions {
  readonly runtime: CommandRuntime;
  readonly version: string;
  readonly writeOut: (text: string) => void;
  readonly writeErr: (text: string) => void;
  /** Usage errors as the error object of common.schema.json (`--json` or `--jsonl` on the line). */
  readonly jsonErrors: boolean;
  /** Runs the command the line asked for. */
  readonly run: (invocation: Invocation) => Promise<void>;
  /** Runs a server until it is stopped. */
  readonly serve: (request: ServeRequest) => Promise<void>;
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

const WORKSPACE_OPTION = [
  "--workspace <path>",
  "workspace root (default: nearest folder upwards with logreq-workspace.yaml)",
] as const;

/** `logreq serve api` and `logreq mcp` (ADR-0009). There is no option for the address (SR-079 AK3). */
const addServers = (program: Command, options: ProgramOptions): void => {
  const serve = program
    .command("serve")
    .description("the local API on loopback: logreq serve api --help")
    .usage("api [options]");
  const api = serve
    .command("api")
    .description(
      "Local API on 127.0.0.1 and ::1 only: POST /v1/commands/<name>, GET /v1/commands. " +
        "Port and token are in api.json in the cache folder of the workspace. Runs until Ctrl-C.",
    )
    .option("--port <number>", "TCP port (default: 0, any free port)")
    .option(...WORKSPACE_OPTION);
  api.action(async () => {
    const opts = api.opts<Record<string, unknown>>();
    await options.serve({ server: "api", port: text(opts["port"]), workspace: text(opts["workspace"]) });
  });
  const mcp = program
    .command("mcp")
    .description(
      "MCP server over standard input and output, one tool per command. Runs until the input ends or Ctrl-C.",
    )
    .option(...WORKSPACE_OPTION);
  mcp.action(async () => {
    await options.serve({ server: "mcp", workspace: text(mcp.opts<Record<string, unknown>>()["workspace"]) });
  });
};

const describeField = (field: InputField): string =>
  [
    field.description,
    field.choices === undefined ? undefined : `one of: ${field.choices.join(", ")}`,
    field.defaultValue === undefined ? undefined : `default: ${JSON.stringify(field.defaultValue)}`,
    field.array ? "repeatable" : undefined,
    field.nullable ? "null only via --input" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("; ");

const collect = (value: string, previous: unknown): string[] => [
  ...(Array.isArray(previous) ? (previous as string[]) : []),
  value,
];

interface FieldOptions {
  /** Carries the value; `--no-x` shares its attribute. */
  readonly main: Option;
  /** `--no-x` of a boolean field. */
  readonly negation: Option | undefined;
}

/** The commander options of one flag field (two for a boolean: `--x` and `--no-x`). */
const optionsOf = (field: InputField): FieldOptions => {
  const description = describeField(field);
  if (field.kind === "boolean" && !field.array) {
    return {
      main: new Option(`--${field.flag}`, description),
      negation: new Option(`--no-${field.flag}`, `set ${field.flag} to false`),
    };
  }
  const placeholder = field.kind === "number" ? "<number>" : "<value>";
  const option = new Option(`--${field.flag} ${placeholder}`, description);
  return { main: field.array ? option.argParser(collect) : option, negation: undefined };
};

const addCommand = (group: Command, entry: CatalogEntry, options: ProgramOptions): void => {
  const action = entry.name.slice(entry.name.indexOf(".") + 1);
  const implemented = options.runtime.commands.has(entry.name);
  const fields = inputFields(entry, options.runtime.contracts.schemas);
  const positional = fields.filter((f) => f.use === "positional");
  const flags = fields.filter((f) => f.use === "flag");
  const inputOnly = fields.filter((f) => f.use === "input-only");

  const command = group
    .command(kebab(action))
    .description(implemented ? entry.summary : `${entry.summary} (not implemented yet)`)
    .usage([...positional.map((f) => `<${f.flag}>`), "[options]"].join(" "));
  // Optional for commander, so the value may also come from --input; core reports a missing one.
  for (const field of positional) {
    command.argument(`[${field.flag}]`, describeField(field));
  }
  // A positional field can also be given as a flag, so `element create <type> --title x` and
  // `element update <ref> --title x` read alike (#310); a field given so is not filled positionally.
  const flagOptions = [
    ...positional
      .filter((field) => !RESERVED_FLAGS.includes(field.flag))
      .map((field) => ({
        field,
        main: new Option(`--${field.flag} <value>`, `instead of the argument <${field.flag}>`),
        negation: undefined,
      })),
    ...flags.map((field) => ({ field, ...optionsOf(field) })),
  ];
  for (const { main, negation } of flagOptions) {
    command.addOption(main);
    if (negation !== undefined) {
      command.addOption(negation);
    }
  }
  command
    .option("--input <json|@file|->", "command input as JSON: inline, from a file, or from standard input")
    .option(...WORKSPACE_OPTION)
    .option("--json", "print exactly the command output as JSON")
    .addOption(
      new Option("--yaml", "print the whole command output as YAML, problems one per line").conflicts("json"),
    );
  if (entry.jsonLines !== undefined) {
    // Only where the catalog offers the form (#319, ADR-0009): elsewhere commander reports an unknown option.
    command.addOption(
      new Option(
        "--jsonl",
        `print the output as JSON Lines: one line per item of ${entry.jsonLines.items}, each with ${entry.jsonLines.fields.join(", ")} first`,
      ).conflicts(["json", "yaml"]),
    );
  }
  if (inputOnly.length > 0) {
    command.addHelpText("after", `\nOnly via --input: ${inputOnly.map((f) => f.name).join(", ")}`);
  }
  command.action(async (...args: unknown[]) => {
    const opts = command.opts<Record<string, unknown>>();
    await options.run({
      entry,
      fields,
      positionals: positional.map((field, i) => ({ field, value: text(args[i]) })),
      flags: flagOptions.map(({ field, main }) => ({ field, value: opts[main.attributeName()] })),
      json: opts["json"] === true,
      yaml: opts["yaml"] === true,
      jsonl: opts["jsonl"] === true,
      workspace: text(opts["workspace"]),
      input: text(opts["input"]),
    });
  });
};

/** Build `logreq` with one subcommand per catalog entry, `logreq <group> <action>`. */
export function buildProgram(options: ProgramOptions): Command {
  const program = new Command("logreq")
    .description(
      "LogReq: requirements as plain files in Git. Every command of the catalog, from the command line.",
    )
    .version(options.version, "-V, --version", "print the version")
    .helpOption("-h, --help", "show help")
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeOut: options.writeOut,
      writeErr: options.writeErr,
      // commander's messages are "error: <text>\n"; with --json or --jsonl they become an input.invalid error object.
      outputError: (text, write) => {
        write(
          options.jsonErrors
            ? `${JSON.stringify({ code: "input.invalid", message: text.replace(/^error: /, "").trim() })}\n`
            : text,
        );
      },
    })
    // List subcommands with their own usage (`get <ref> [options]`), as their help shows it.
    .configureHelp({ subcommandTerm: (cmd) => `${cmd.name()} ${cmd.usage()}` })
    .addHelpText("after", "\nOptions of a command follow it: logreq <group> <action> --help");
  const groups = new Map<string, Command>();
  for (const entry of options.runtime.contracts.commands) {
    const name = entry.name.slice(0, entry.name.indexOf("."));
    let group = groups.get(name);
    if (group === undefined) {
      group = program.command(name).description(`${name} commands`).usage("<action> [options]");
      groups.set(name, group);
    }
    addCommand(group, entry, options);
  }
  const clash = SERVER_COMMANDS.filter((name) => groups.has(name));
  if (clash.length > 0) {
    throw new Error(`catalog group ${clash.join(", ")} clashes with a command of the CLI`);
  }
  addServers(program, options);
  return program;
}
