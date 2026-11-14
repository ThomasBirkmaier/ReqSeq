// The commander tree, generated from the command catalog (ADR-0002 rule 3, ADR-0009). No command is
// named here: groups, actions, arguments and flags all come from the catalog entries.
import type { CatalogEntry, CommandRuntime } from "@reqseq/core";
import { Command, Option } from "commander";
import type { InputField, PartFlag } from "./fields.js";
import { RESERVED_FLAGS, inputFields, kebab } from "./fields.js";

/** What the command line asked for, before it becomes a command input. */
export interface Invocation {
  readonly entry: CatalogEntry;
  /** All input fields of the command. */
  readonly fields: readonly InputField[];
  /** Positional fields with their values (`undefined` when not given). */
  readonly positionals: readonly { readonly field: InputField; readonly value: string | undefined }[];
  /** Arguments beyond the positional fields; `buildInput` refuses them and names the right call (#449). */
  readonly extraArguments: readonly string[];
  /**
   * Flag fields with their raw values (`undefined` when not given); positional fields given as a
   * flag (`--title` next to `<title>`) too.
   */
  readonly flags: readonly {
    readonly field: InputField;
    /** The part of the field this flag sets (`--ids` of `selection`), `undefined` for a whole field. */
    readonly part?: PartFlag | undefined;
    readonly value: unknown;
  }[];
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

/**
 * `reqseq serve api` or `reqseq mcp`: a server over the whole catalog instead of one command; `reqseq serve
 * docs`: the documentation of the delivery (SR-141).
 */
export type ServeRequest =
  | { readonly server: "api"; readonly port: string | undefined; readonly workspace: string | undefined }
  | { readonly server: "mcp"; readonly workspace: string | undefined }
  | { readonly server: "docs"; readonly port: string | undefined };

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
  "workspace root (default: nearest folder upwards with reqseq-workspace.yaml)",
] as const;

/**
 * `reqseq serve api`, `reqseq serve docs` and `reqseq mcp` (ADR-0009, ADR-0017). There is no option for the
 * address (SR-079 AK3), nor one for another documentation folder.
 */
const addServers = (program: Command, options: ProgramOptions): void => {
  const serve = program
    .command("serve")
    .description(
      "the local API or the documentation on loopback: reqseq serve api --help, reqseq serve docs --help",
    )
    .usage("api|docs [options]");
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
  const docs = serve
    .command("docs")
    .description(
      "The documentation of this ReqSeq version on 127.0.0.1 only, to read and search in a browser without network. " +
        "Prints its address. Needs no workspace. Runs until Ctrl-C.",
    )
    .option("--port <number>", "TCP port (default: 0, any free port)");
  docs.action(async () => {
    await options.serve({ server: "docs", port: text(docs.opts<Record<string, unknown>>()["port"]) });
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

/**
 * `text` with every input field name that the command line spells otherwise (`changedSince`) as its
 * flag (`--changed-since`) or argument (`<ref>`), so help names what a person types (#148). Only
 * names with a capital letter are respelled: a one-word name is its own flag and reads as prose. A
 * name in backticks is left as it is: the catalog quotes output fields so, which may share the name.
 */
const spelledHelp = (text: string, fields: readonly InputField[]): string =>
  fields
    .filter((field) => field.use !== "input-only" && field.name !== field.flag && /[A-Z]/.test(field.name))
    .reduce(
      (spelled, field) =>
        spelled.replace(
          new RegExp(`(?<![\\w.\`-])${field.name}(?![\\w\`])`, "g"),
          field.use === "positional" ? `<${field.flag}>` : `--${field.flag}`,
        ),
      text,
    );

const describeField = (field: InputField): string =>
  [
    field.description,
    field.choices === undefined ? undefined : `one of: ${field.choices.join(", ")}`,
    field.defaultValue === undefined ? undefined : `default: ${JSON.stringify(field.defaultValue)}`,
    field.array ? "repeatable" : undefined,
    field.entries
      ? "repeatable; the value as JSON when it parses (a list, number, true, null), else as text: version=1.10 is the number 1.1, give 'version=\"1.10\"' for text; the last value of a key counts; keys add to --input"
      : undefined,
    field.textFile
      ? "@file or - reads it from a file or standard input, as --input does; a text that is - or starts with @ only via --input"
      : undefined,
    field.nullable ? "null only via --input" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("; ")
    .replaceAll(".; ", ". ");

const collect = (value: string, previous: unknown): string[] => [
  ...(Array.isArray(previous) ? (previous as string[]) : []),
  value,
];

/** Help text of a part flag: what it sets and how it combines with `--input` (#149, #173). */
const describePart = (field: InputField, part: PartFlag): string => {
  const at = [field.name, ...part.path].join(".");
  const rule = {
    property: part.array
      ? `repeatable; sets ${at}, replacing the list of --input`
      : `sets ${at}, replacing that of --input`,
    condition: `a condition as JSON (filter.schema.json): inline, @file or -; replaces ${at} of --input`,
    key: `repeatable; matches any of them; added to ${at} with all`,
    sort: `<by>[:asc|desc], repeatable; replaces ${at} of --input`,
  }[part.role];
  return [part.description, rule]
    .filter((text) => text !== undefined)
    .join("; ")
    .replaceAll(".; ", ". ");
};

const PART_PLACEHOLDER: Readonly<Record<PartFlag["role"], string>> = {
  property: "<value>",
  condition: "<json|@file|->",
  key: "<key>",
  sort: "<by[:asc|desc]>",
};

/** The option of a part flag. */
const partOption = (field: InputField, part: PartFlag): Option => {
  const option = new Option(`--${part.flag} ${PART_PLACEHOLDER[part.role]}`, describePart(field, part));
  return part.array ? option.argParser(collect) : option;
};

/** The flag names a command line takes, each with `--no-x`; a name twice throws (#149). */
const checkClashes = (entry: CatalogEntry, options: readonly Option[], jsonl: boolean): void => {
  const names = [
    ...RESERVED_FLAGS,
    ...(jsonl ? ["jsonl"] : []),
    ...options.map((option) => option.long?.replace(/^--/, "") ?? ""),
  ];
  const twice = names.filter((name, i) => names.indexOf(name) !== i);
  if (twice.length > 0) {
    throw new Error(`${entry.name}: the flag --${twice.join(", --")} is derived twice`);
  }
};

interface FieldOptions {
  /** Carries the value; `--no-x` shares its attribute. */
  readonly main: Option;
  /** `--no-x` of a boolean field. */
  readonly negation: Option | undefined;
}

/** The commander options of one flag field (two for a boolean: `--x` and `--no-x`). */
const optionsOf = (field: InputField, fields: readonly InputField[]): FieldOptions => {
  const description = spelledHelp(describeField(field), fields);
  if (field.kind === "boolean" && !field.array) {
    return {
      main: new Option(`--${field.flag}`, description),
      negation: new Option(`--no-${field.flag}`, `set ${field.flag} to false`),
    };
  }
  const placeholder = field.entries
    ? "<key=value>"
    : field.textFile
      ? "<text|@file|->"
      : field.kind === "number"
        ? "<number>"
        : "<value>";
  const option = new Option(`--${field.flag} ${placeholder}`, description);
  return { main: field.array || field.entries ? option.argParser(collect) : option, negation: undefined };
};

const addCommand = (group: Command, entry: CatalogEntry, options: ProgramOptions): void => {
  const action = entry.name.slice(entry.name.indexOf(".") + 1);
  const implemented = options.runtime.commands.has(entry.name);
  const fields = inputFields(entry, options.runtime.contracts.schemas);
  const positional = fields.filter((f) => f.use === "positional");
  const flags = fields.filter((f) => f.use === "flag");
  const parted = fields.filter((f) => f.use === "parts");
  const inputOnly = fields.filter((f) => f.use === "input-only");

  const command = group
    .command(kebab(action))
    .description(spelledHelp(implemented ? entry.summary : `${entry.summary} (not implemented yet)`, fields))
    .usage([...positional.map((f) => `<${f.flag}>`), "[options]"].join(" "))
    // Too many arguments reach buildInput, whose error names the call they fit (#449).
    .allowExcessArguments();
  // Optional for commander, so the value may also come from --input; core reports a missing one.
  for (const field of positional) {
    command.argument(`[${field.flag}]`, spelledHelp(describeField(field), fields));
  }
  // A positional field can also be given as a flag, so `element create <type> --title x` and
  // `element update <ref> --title x` read alike (ThomasBirkmaier/ReqSeq-archive#310); a field given so is not filled positionally.
  const flagOptions = [
    ...positional
      .filter((field) => !RESERVED_FLAGS.includes(field.flag))
      .map((field) => ({
        field,
        part: undefined,
        main: new Option(`--${field.flag} <value>`, `instead of the argument <${field.flag}>`),
        negation: undefined,
      })),
    ...flags.map((field) => ({ field, part: undefined, ...optionsOf(field, fields) })),
    ...parted.flatMap((field) =>
      field.parts.map((part) => ({ field, part, main: partOption(field, part), negation: undefined })),
    ),
  ];
  checkClashes(
    entry,
    flagOptions.flatMap(({ main, negation }) => (negation === undefined ? [main] : [main, negation])),
    entry.jsonLines !== undefined,
  );
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
      extraArguments: command.args.slice(positional.length),
      flags: flagOptions.map(({ field, part, main }) => ({
        field,
        part,
        value: opts[main.attributeName()],
      })),
      json: opts["json"] === true,
      yaml: opts["yaml"] === true,
      jsonl: opts["jsonl"] === true,
      workspace: text(opts["workspace"]),
      input: text(opts["input"]),
    });
  });
};

/** Build `reqseq` with one subcommand per catalog entry, `reqseq <group> <action>`. */
export function buildProgram(options: ProgramOptions): Command {
  const program = new Command("reqseq")
    .description(
      "ReqSeq: requirements as plain files in Git. Every command of the catalog, from the command line.",
    )
    .version(options.version, "-V, --version", "print the ReqSeq version")
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
    .addHelpText("after", "\nOptions of a command follow it: reqseq <group> <action> --help");
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
