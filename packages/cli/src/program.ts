// The commander tree, generated from the command catalog (ADR-0002 rule 3, ADR-0009). No command is
// named here: groups, actions, arguments and flags all come from the catalog entries.
import type { CatalogEntry, CommandRuntime } from "@reqseq/core";
import { catalogGroupName, GET_STARTED } from "@reqseq/core";
import { Command, Help, Option } from "commander";
import type { InputField, PartFlag } from "./fields.js";
import { RESERVED_FLAGS, inputFields, kebab } from "./fields.js";
import { nextLines } from "./present/next.js";

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
  | { readonly server: "docs"; readonly port: string | undefined }
  | {
      readonly server: "ui";
      readonly port: string | undefined;
      readonly workspace: string | undefined;
      /** `--no-open`: start no program to open the address. */
      readonly open: boolean;
    };

/** Top-level commands of the CLI itself; no catalog group may take these names. */
export const SERVER_COMMANDS: readonly string[] = ["serve", "mcp", "ui"];

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
 * `reqseq serve api`, `reqseq serve docs`, `reqseq mcp` and `reqseq ui` (ADR-0009, ADR-0017, ADR-0020). There is no option for the
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
  const ui = program
    .command("ui")
    .description(
      "The web UI on 127.0.0.1 and ::1 only. Prints its address with a token that is new on every start and " +
        "opens it in the browser. Without a workspace found or named it starts without one. Runs until Ctrl-C.",
    )
    .option("--port <number>", "TCP port from 1 to 65535 (default: any free port)")
    .option(...WORKSPACE_OPTION)
    .option("--no-open", "print the address only; open no browser");
  ui.action(async () => {
    const opts = ui.opts<Record<string, unknown>>();
    await options.serve({
      server: "ui",
      port: text(opts["port"]),
      workspace: text(opts["workspace"]),
      open: opts["open"] !== false,
    });
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
    field.array || field.entries ? "repeatable" : undefined,
    // How a value is read is the same for every such option, so the help says it once (#2529, `valueRules`).
    field.entryLists ? "a kind given again adds its targets" : undefined,
    field.nullable ? "null only via --input" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("; ")
    .replaceAll(".; ", ". ");

/**
 * What a key given again does, unless every option adds the targets of a kind given again
 * (`entryLists`), which its own line says.
 */
const lastValueRule = (entries: readonly InputField[]): string | undefined => {
  const lists = entries.filter((field) => field.entryLists).length;
  if (lists === entries.length) {
    return undefined;
  }
  return lists === 0
    ? "A key given again keeps its last value."
    : "A key given again keeps its last value, unless its option says otherwise.";
};

/** The rules a placeholder stands for, said once per command under its options (#2529). */
const VALUE_RULES: readonly {
  readonly term: string;
  readonly applies: (field: InputField) => boolean;
  readonly rule: (fields: readonly InputField[]) => string;
}[] = [
  {
    term: "<key=value>",
    applies: (field) => field.entries,
    rule: (fields) =>
      [
        `Read as JSON when it parses (an array, number, true, null), else as text: version=1.10 is the number 1.1, give 'version="1.10"' for text.`,
        lastValueRule(fields.filter((field) => field.entries)),
        "The keys add to those of --input.",
      ]
        .filter((part) => part !== undefined)
        .join(" "),
  },
  {
    term: "<text|@file|->",
    applies: (field) => field.textFile,
    rule: () =>
      "@file or - reads the text from a file or standard input, as --input does; a text that is - or starts with @ only via --input.",
  },
];

interface ValueRule {
  /** The placeholder of the options, `<key=value>`. */
  readonly term: string;
  readonly rule: string;
}

/** The section "Option values" of a command whose options use a placeholder of `VALUE_RULES`; `[]` without one. */
const valueRules = (fields: readonly InputField[]): readonly ValueRule[] => {
  // Only flags read `@file` and `-`; a positional value is taken as it is (`buildInput`).
  const shown = fields.filter((field) => field.use === "flag");
  return VALUE_RULES.filter((rule) => shown.some(rule.applies)).map((rule) => ({
    term: rule.term,
    rule: rule.rule(shown),
  }));
};

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

/** Flags other tools take for the output form; the CLI has `--json`, `--yaml` and `--jsonl` for it (ADR-0009). */
const OUTPUT_FORM_FLAGS: readonly string[] = ["format", "output"];

/** Flags other tools take for paging, by the flag of the CLI that does it (#2427). */
const PAGING_FLAGS: Readonly<Record<string, string>> = {
  "page-size": "limit",
  "per-page": "limit",
  "max-results": "limit",
  skip: "offset",
};

/** Flags of every command with their value, which go after the command, not before it (`commandFlagHint`). */
const COMMAND_FLAGS: Readonly<Record<string, string>> = {
  json: "--json",
  yaml: "--yaml",
  input: "--input <json|@file|->",
  workspace: "--workspace <path>",
};

/** The value of `table` at `key`, never an inherited one (`--constructor`). */
const own = (table: Readonly<Record<string, string>>, key: string): string | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

/** The flag name without `--` and without a `=value`. */
const flagName = (flag: string): string => flag.replace(/^--/, "").replace(/=.*$/s, "");

/** `name`, and `name` with a plural `s` taken away or added: `--types` means `--where-type` (#2427). */
const spellings = (name: string): string[] =>
  name.endsWith("s") ? [name, name.slice(0, -1)] : [name, `${name}s`];

/** `(Did you mean a?)`, `(Did you mean a or b?)`, with the further sentence `after`. */
const didYouMean = (flags: readonly string[], after?: string): string =>
  `(Did you mean ${flags.join(" or ")}?${after === undefined ? "" : ` ${after}`})`;

/**
 * The hint after commander's `unknown option '--x'` on `command` (#1831, #2427), in place of its own
 * suggestion: `--where-x` when the command has that flag (also for `--xs`), `--add-x` and `--remove-x`
 * when it has those, its paging flag for `--page-size` and its like, the output flags it has for
 * `--format` or `--output`; `undefined` otherwise (also for those when the command has no such flag),
 * and commander's suggestion stays.
 */
export const unknownOptionHint = (flag: string, command: Command): string | undefined => {
  const name = flagName(flag);
  const longs = new Set(command.options.map((option) => option.long));
  const has = (form: string): boolean => longs.has(form);
  const where = spellings(name)
    .map((spelling) => `--where-${spelling}`)
    .find(has);
  if (where !== undefined) {
    return didYouMean([where]);
  }
  const changes = spellings(name).flatMap((spelling) =>
    [`--add-${spelling}`, `--remove-${spelling}`].filter(has),
  );
  if (changes.length > 0) {
    return didYouMean(changes);
  }
  const paging = own(PAGING_FLAGS, name);
  if (paging !== undefined && has(`--${paging}`)) {
    return didYouMean([`--${paging}`]);
  }
  const forms = OUTPUT_FORM_FLAGS.includes(name) ? ["--json", "--jsonl", "--yaml"].filter(has) : [];
  if (forms.length === 0) {
    return undefined;
  }
  const without = "Without them, the output is the readable form.";
  return forms.length === 1
    ? didYouMean(forms, without.replace("them", "it"))
    : `(Did you mean one of ${forms.join(", ")}? ${without})`;
};

/** The words that call `command`: `reqseq element`. */
const callOf = (command: Command): string =>
  command.parent === null ? command.name() : `${callOf(command.parent)} ${command.name()}`;

/**
 * The hint after commander's `unknown option '--json'` on `reqseq` or a group (#2427): a flag of every
 * command goes after the command, so `reqseq --json element list` names `reqseq <group> <action> --json`;
 * `undefined` for any other flag.
 */
const commandFlagHint = (flag: string, command: Command): string | undefined => {
  const name = flagName(flag);
  const usage = own(COMMAND_FLAGS, name);
  if (usage === undefined) {
    return undefined;
  }
  const rest = command.parent === null ? "<group> <action>" : "<action>";
  return `(--${name} goes after the command: ${callOf(command)} ${rest} ${usage})`;
};

/**
 * The hint after commander's `unknown command 'x'` on `reqseq` (#2427), in place of its own suggestion:
 * the calls of the groups with an action x, so `reqseq init` names `reqseq workspace init`; `undefined`
 * when no group has one, and commander's suggestion stays. Only for an action given without a group:
 * `reqseq element delete` names no action of another group, as if it deleted elements (SR-099).
 */
export const unknownCommandHint = (name: string, program: Command): string | undefined => {
  const calls = program.commands
    .filter((group) => group.commands.some((action) => action.name() === name))
    .map((group) => `${callOf(group)} ${name}`);
  if (calls.length === 0) {
    return undefined;
  }
  return calls.length === 1 ? didYouMean(calls) : `(Did you mean one of ${calls.join(", ")}?)`;
};

/** The hint for commander's error `message` on `command`; `undefined` when there is none. */
const hintOf = (message: string, command: Command): string | undefined => {
  const flag = /^error: unknown option '([^']*)'/.exec(message)?.[1];
  if (flag !== undefined) {
    return command.commands.length === 0 ? unknownOptionHint(flag, command) : commandFlagHint(flag, command);
  }
  const name = /^error: unknown command '([^']*)'/.exec(message)?.[1];
  return name === undefined || command.parent !== null ? undefined : unknownCommandHint(name, command);
};

/** `command` with `hintOf` added to commander's error for an unknown option or command. */
const withOptionHints = (command: Command): void => {
  const error = command.error.bind(command);
  command.error = (message, errorOptions) => {
    const hint = hintOf(message, command);
    return error(
      hint === undefined ? message : `${message.replace(/\n\(Did you mean [^)]*\)$/, "")}\n${hint}`,
      errorOptions,
    );
  };
};

/** The section "Option values" by command, written by `formatHelp` after the options. */
type ValueRules = Map<Command, readonly ValueRule[]>;

const addCommand = (
  group: Command,
  entry: CatalogEntry,
  options: ProgramOptions,
  rulesOf: ValueRules,
): void => {
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
  const rules = valueRules(fields);
  if (rules.length > 0) {
    rulesOf.set(command, rules);
  }
  if (inputOnly.length > 0) {
    command.addHelpText("after", `\nOnly via --input: ${inputOnly.map((f) => f.name).join(", ")}`);
  }
  withOptionHints(command);
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

/** Characters of a value an error message quotes, counted in code points; a longer one is cut and ends with `…`. */
const SHOWN_VALUE = 60;

const shown = (value: unknown): string => {
  const points = Array.from(String(value));
  return points.length <= SHOWN_VALUE ? points.join("") : `${points.slice(0, SHOWN_VALUE - 1).join("")}…`;
};

/**
 * Refuse a single-value option given twice with different values, and `--x` with `--no-x`, instead of
 * keeping the last one (#1828). Applies to every option of `command` and its subcommands that takes one
 * required value and has no parser of its own (a repeatable option collects), and to every boolean
 * option with its `--no-x`. One program parses one command line, so what was given is kept here.
 */
const refuseRepeats = (command: Command): void => {
  const given = new Map<string, { readonly flag: string; readonly value: unknown }>();
  for (const option of command.options) {
    const single = option.required && !option.variadic && option.parseArg === undefined;
    if (!single && (option.required || option.optional)) {
      continue;
    }
    const name = option.attributeName();
    const flag = option.long ?? option.flags;
    command.on(`option:${option.name()}`, (value: unknown) => {
      const previous = given.get(name);
      given.set(name, { flag, value });
      if (previous === undefined || (single ? previous.value === value : previous.flag === flag)) {
        return;
      }
      const [positive, negative] = flag.startsWith("--no-") ? [previous.flag, flag] : [flag, previous.flag];
      command.error(
        single
          ? `error: ${flag} takes one value, given twice: ${shown(previous.value)} and ${shown(value)}; give it once`
          : `error: ${positive} and ${negative} both given; give one`,
        { code: "commander.optionRepeated" },
      );
    });
  }
  for (const sub of command.commands) {
    refuseRepeats(sub);
  }
};

/**
 * The help of `reqseq` itself with the section "Get started" before its commands (SR-226 AK3): the calls of
 * core's `GET_STARTED`, which name no path, so the current folder plays no part.
 */
const withGetStarted = (help: string, commands: readonly CatalogEntry[]): string => {
  const section = nextLines(GET_STARTED, { commands, cwd: ".", platform: process.platform }, "Get started:");
  const at = help.indexOf("\nCommands:\n");
  return at < 0 ? help : `${help.slice(0, at + 1)}${section.join("\n")}\n${help.slice(at)}`;
};

/**
 * `help` with the section "Option values" after its options (#2529): how a value of each placeholder is read,
 * said once instead of in each option. `help` as it is without `rules`.
 */
const withValueRules = (help: string, rules: readonly ValueRule[] | undefined, helper: Help): string => {
  if (rules === undefined) {
    return help;
  }
  const width = Math.max(...rules.map((rule) => helper.displayWidth(rule.term)));
  const items = rules.map((rule) => helper.formatItem(rule.term, width, rule.rule, helper));
  return `${help}\n${helper.formatItemList("Option values:", items, helper).join("\n")}`;
};

/** Build `reqseq` with one subcommand per catalog entry, `reqseq <group> <action>`. */
export function buildProgram(options: ProgramOptions): Command {
  const rulesOf: ValueRules = new Map();
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
    .configureHelp({
      subcommandTerm: (cmd) => `${cmd.name()} ${cmd.usage()}`,
      // Only `reqseq` itself, which has no parent, gets "Get started"; a command, its "Option values".
      formatHelp: (cmd, helper): string => {
        const help = Help.prototype.formatHelp.call(helper, cmd, helper);
        return cmd.parent === null
          ? withGetStarted(help, options.runtime.contracts.commands)
          : withValueRules(help, rulesOf.get(cmd), helper);
      },
    })
    .addHelpText("after", "\nOptions of a command follow it: reqseq <group> <action> --help");
  const groups = new Map<string, Command>();
  for (const entry of options.runtime.contracts.commands) {
    const name = entry.name.slice(0, entry.name.indexOf("."));
    let group = groups.get(name);
    if (group === undefined) {
      group = program.command(name).description(catalogGroupName(name)).usage("<action> [options]");
      groups.set(name, group);
    }
    addCommand(group, entry, options, rulesOf);
  }
  const clash = SERVER_COMMANDS.filter((name) => groups.has(name));
  if (clash.length > 0) {
    throw new Error(`catalog group ${clash.join(", ")} clashes with a command of the CLI`);
  }
  addServers(program, options);
  for (const command of [program, ...groups.values()]) {
    withOptionHints(command);
  }
  refuseRepeats(program);
  return program;
}
