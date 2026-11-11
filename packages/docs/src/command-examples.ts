// The example of every command page (#1250): the input of schemas/examples/commands/<name>.json, run when the
// docs are built through the command line of this build on a copy of one fixed workspace, the weather station of
// fixtures/enabler-1250/weather-station with the standard model as its metamodel, so an example can never be out of
// date. Every command runs on a copy of
// its own, as the files a write leaves behind would change the next example. What differs between two builds (the
// temporary folder, today's date and time, a new random UUID) is replaced by a fixed text.
import { execFile } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { argvFor, runCli } from "@reqseq/cli";
import type { CatalogEntry, CommandRuntime } from "@reqseq/core";
import { Workspace, rememberWorkspace } from "@reqseq/core";

/** The fixed workspace the examples run on. */
export const EXAMPLE_FIXTURE: string = fileURLToPath(
  new URL("../../../fixtures/enabler-1250/weather-station/", import.meta.url),
);

/** The standard model, which the fixed workspace takes as its metamodel. */
const STANDARD_MODEL = fileURLToPath(
  new URL("../../../schemas/examples/metamodel/standard-model.yaml", import.meta.url),
);

/** The folder of the example inputs, relative to the repository. */
export const EXAMPLE_INPUTS = "schemas/examples/commands";

/** The folder the outputs show instead of the temporary copy of the workspace. */
export const SHOWN_ROOT = "/work/weather-station";

/** The time the outputs show instead of the time of the build. */
export const SHOWN_TIME = "2026-11-05T12:00:00Z";

/** The baseline made before the examples run; the wind direction requirement changes after it (`baseline.*`). */
export const BASELINE = "Release 1";

/** The date of that baseline, and of the first commit. */
export const BASELINE_TIME = "2026-11-04T16:00:00Z";

/** The date of the commit with the change since the baseline. */
export const CHANGE_TIME = "2026-11-04T17:00:00Z";

/** Commands without an example, each with the reason. */
export const WITHOUT_EXAMPLE: Readonly<Record<string, string>> = {};

/** One example of a command page: the input, the same call on the command line, and the output. */
export interface CommandExample {
  readonly input: Readonly<Record<string, unknown>>;
  readonly cli: string;
  readonly output: string;
}

/** The example inputs by command name, from `<repoRoot>/schemas/examples/commands/`. */
export async function readExampleInputs(repoRoot: string): Promise<Map<string, Record<string, unknown>>> {
  const folder = join(repoRoot, ...EXAMPLE_INPUTS.split("/"));
  const files = (await readdir(folder)).filter((file) => file.endsWith(".json")).sort();
  const inputs = new Map<string, Record<string, unknown>>();
  for (const file of files) {
    inputs.set(
      file.slice(0, -".json".length),
      JSON.parse(await readFile(join(folder, file), "utf8")) as Record<string, unknown>,
    );
  }
  return inputs;
}

/** A word of a command line as a shell takes it: quoted when it holds anything but plain characters. */
export const shellWord = (word: string): string =>
  /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'"'"'`)}'`;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

/** The UUIDs in the files of a folder, `.git` left out. */
async function uuidsIn(folder: string): Promise<Set<string>> {
  const found = new Set<string>();
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const outsideGit = (path: string): boolean => relative(folder, path).split(sep)[0] !== ".git";
  for (const entry of entries.filter((e) => e.isFile() && outsideGit(e.parentPath))) {
    for (const [uuid] of (await readFile(join(entry.parentPath, entry.name), "utf8")).matchAll(UUID)) {
      found.add(uuid);
    }
  }
  return found;
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a run gives that a build changes. */
export interface Volatile {
  /** Folders of the copy, as the output names them (JSON-escaped), with the text shown instead. */
  readonly folders: readonly (readonly [string, string])[];
  /** The UUIDs of the fixed workspace: any other is new. */
  readonly known: ReadonlySet<string>;
  /** When the run started and ended. */
  readonly from: Date;
  readonly to: Date;
}

const DATE_TIME = /\b(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z\b/g;
const DATE = /\b\d{4}-\d{2}-\d{2}\b(?!T\d)/g;
/** A criterion key the tool gives (`newCriterionKey`), as the JSON of a criterion shows it before its text. */
const CRITERION_KEY = /"key": "([a-z][a-z0-9]{3})",(\s*)"text"/g;

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);
const localDay = (date: Date): string =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join("-");

/**
 * The output with the volatile parts fixed: the copy's folders, each new UUID (and its 12 and 6 digit tails, the file
 * name and the short ID) as a numbered placeholder in the order they appear, each new criterion key likewise, a time
 * within the run as SHOWN_TIME, and the date of the run as its date.
 */
export function stable(output: string, { folders, known, from, to }: Volatile): string {
  let text = output;
  for (const [folder, shown] of folders) {
    text = text.replaceAll(folder, shown);
  }
  const fresh = [...new Set([...text.matchAll(UUID)].map(([uuid]) => uuid))].filter(
    (uuid) => !known.has(uuid),
  );
  for (const [index, uuid] of fresh.entries()) {
    const tail = (index + 1).toString(16).padStart(12, "0");
    text = text
      .replaceAll(uuid, `00000000-0000-4000-8000-${tail}`)
      .replace(new RegExp(`\\b${escape(uuid.slice(-12))}\\b`, "g"), tail)
      .replace(new RegExp(`\\b(?<=-)${escape(uuid.slice(-6))}\\b`, "g"), tail.slice(-6));
  }
  // A new criterion key (SR-204) as a numbered placeholder in the order the keys appear.
  const keys = new Map<string, string>();
  text = text.replace(CRITERION_KEY, (_match: string, key: string, space: string) => {
    const shown = keys.get(key) ?? `c${(keys.size + 1).toString().padStart(3, "0")}`;
    keys.set(key, shown);
    return `"key": "${shown}",${space}"text"`;
  });
  const early = from.getTime() - 1000;
  const late = to.getTime() + 1000;
  text = text.replace(
    DATE_TIME,
    (match: string, day: string, hours: string, minutes: string, seconds: string) => {
      const at = Date.parse(`${day}T${hours}:${minutes}:${seconds}Z`);
      return at >= early && at <= late ? SHOWN_TIME : match;
    },
  );
  const days = new Set([isoDay(from), isoDay(to), localDay(from), localDay(to)]);
  return text.replace(DATE, (day) => (days.has(day) ? SHOWN_TIME.slice(0, 10) : day));
}

/**
 * The forms in which an output can name the copy's folder, each with SHOWN_ROOT: its real path first, then the path
 * it was made with (macOS `/private/var` and `/var`), each as JSON escapes it and with `/` (Windows); once each.
 */
export const shownFolders = (roots: readonly string[]): (readonly [string, string])[] =>
  [...new Set(roots.flatMap((root) => [JSON.stringify(root).slice(1, -1), root.split(sep).join("/")]))].map(
    (folder) => [folder, SHOWN_ROOT] as const,
  );

/** Runs `reqseq <argv>` in `cwd` with `runtime`; the exit code and what it printed. */
async function runIn(
  argv: readonly string[],
  cwd: string,
  runtime: CommandRuntime,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv,
    cwd,
    stdin: Readable.from([]),
    stdout: { write: (text: string) => void (stdout += text) },
    stderr: { write: (text: string) => void (stderr += text) },
    runtime,
  });
  return { exitCode, stdout, stderr };
}

const execFileAsync = promisify(execFile);

/**
 * `git <args>` in `cwd` as of `date`: no system, user or inherited configuration, no global ignore or attributes file
 * (home and config folders are the folder of `config`, an empty file), and fixed names and dates, so a commit gets the
 * same ID on every build and machine.
 */
async function git(args: readonly string[], cwd: string, config: string, date: string): Promise<void> {
  const home = dirname(config);
  const inherited = Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_"));
  const env = {
    ...Object.fromEntries(inherited),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: config,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    GIT_AUTHOR_NAME: "ReqSeq docs",
    GIT_AUTHOR_EMAIL: "docs@example.com",
    GIT_COMMITTER_NAME: "ReqSeq docs",
    GIT_COMMITTER_EMAIL: "docs@example.com",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  const settings = ["core.autocrlf=false", `core.excludesFile=${config}`, `core.attributesFile=${config}`];
  await execFileAsync("git", [...settings.flatMap((setting) => ["-c", setting]), ...args], { cwd, env });
}

/**
 * The fixed workspace in `<top>/template`, one Git repository: the fixture, committed, then its baseline and one
 * requirement changed since, committed too. The baseline file gets a fixed date, so the working tree is clean and
 * every commit ID the same on every build.
 */
async function templateIn(top: string, runtime: CommandRuntime): Promise<string> {
  const root = join(top, "template", "weather-station");
  const config = join(top, "gitconfig");
  await writeFile(config, "");
  await cp(EXAMPLE_FIXTURE, root, { recursive: true });
  // The metamodel is the standard model as `workspace.init` writes it, so the examples follow its changes.
  await cp(STANDARD_MODEL, join(root, "metamodel", "standard-model.yaml"));
  await git(["init", "--quiet", "--template=", "--initial-branch=main"], root, config, BASELINE_TIME);
  await git(["add", "--all"], root, config, BASELINE_TIME);
  await git(["commit", "--quiet", "--message", "Weather station"], root, config, BASELINE_TIME);
  const workspace = new Workspace(root);
  try {
    await runtime.invoke(
      "baseline.create",
      { name: BASELINE, selection: { package: "PKG-899714" } },
      { workspace },
    );
  } finally {
    await workspace.close();
  }
  const baseline = join(root, "baselines", "Release-1.yaml");
  await writeFile(
    baseline,
    (await readFile(baseline, "utf8")).replace(/^date: .*$/m, `date: ${BASELINE_TIME}`),
  );
  const file = join(root, "system-requirement", "SR-8660d8297f21.md");
  await writeFile(file, (await readFile(file, "utf8")).replace("in degrees.", "in degrees from north."));
  await git(["add", "--all"], root, config, CHANGE_TIME);
  await git(
    ["commit", "--quiet", "--message", "Say where the direction is measured from"],
    root,
    config,
    CHANGE_TIME,
  );
  return root;
}

/** What a command needs before it runs, beyond the fixed workspace: the app's list of recent workspaces. */
const PREPARE: Readonly<Record<string, (root: string) => Promise<void>>> = {
  "workspace.recent": async (root) => {
    await rememberWorkspace(root, { now: new Date(SHOWN_TIME) });
  },
};

/** The variables that name the user's home and cache folders, which `workspace.recent` and the activity read. */
const HOME_VARIABLES = ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"] as const;

/** Runs `body` with the home and cache folders in `home`, so no example reads or writes the user's own. */
async function withHome<T>(home: string, body: () => Promise<T>): Promise<T> {
  const saved = HOME_VARIABLES.map((name) => [name, process.env[name]] as const);
  for (const name of HOME_VARIABLES) {
    process.env[name] = name === "XDG_CACHE_HOME" || name === "LOCALAPPDATA" ? join(home, ".cache") : home;
  }
  try {
    return await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }
}

/** Fails unless every command has an example input or a reason, and every input names a command. */
export function checkExampleInputs(
  entries: readonly CatalogEntry[],
  inputs: ReadonlyMap<string, unknown>,
  without: Readonly<Record<string, string>> = WITHOUT_EXAMPLE,
): void {
  const names = new Set(entries.map((entry) => entry.name));
  const errors = [
    ...entries
      .filter((entry) => !inputs.has(entry.name) && without[entry.name] === undefined)
      .map((entry) => `${entry.name}: no example in ${EXAMPLE_INPUTS}/${entry.name}.json`),
    ...[...inputs.keys()]
      .filter((name) => !names.has(name))
      .map((name) => `${EXAMPLE_INPUTS}/${name}.json: no command ${name}`),
    ...Object.keys(without)
      .filter((name) => inputs.has(name))
      .map((name) => `${name}: an example and a reason for none`),
  ];
  if (errors.length > 0) {
    throw new Error(`docs: command examples\n${errors.join("\n")}`);
  }
}

/** Runs the example of every command with an input, each on its own copy of the fixed workspace; throws with every failure. */
export async function commandExamples(
  entries: readonly CatalogEntry[],
  inputs: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  runtime: CommandRuntime,
  without: Readonly<Record<string, string>> = WITHOUT_EXAMPLE,
): Promise<Map<string, CommandExample>> {
  checkExampleInputs(entries, inputs, without);
  const made = await mkdtemp(join(tmpdir(), "reqseq-command-examples-"));
  const top = await realpath(made);
  try {
    const template = await templateIn(top, runtime);
    const known = await uuidsIn(template);
    const examples = new Map<string, CommandExample>();
    const failures: string[] = [];
    await withHome(join(top, "home"), async () => {
      for (const [index, entry] of entries.entries()) {
        const input = inputs.get(entry.name);
        if (input === undefined) {
          continue;
        }
        const root = join(top, String(index), "weather-station");
        await cp(template, root, { recursive: true });
        await PREPARE[entry.name]?.(root);
        const argv = [...argvFor(entry, input, runtime.contracts.schemas), "--json"];
        const cli = ["reqseq", ...argv].map(shellWord).join(" ");
        const from = new Date();
        const result = await runIn(argv, root, runtime);
        const to = new Date();
        if (result.exitCode !== 0) {
          failures.push(`${entry.name}: \`${cli}\`: exit code ${String(result.exitCode)}\n${result.stderr}`);
          continue;
        }
        const folders = shownFolders([root, join(made, String(index), "weather-station")]);
        examples.set(entry.name, {
          input,
          cli,
          output: stable(result.stdout, { folders, known, from, to }).trimEnd(),
        });
      }
    });
    if (failures.length > 0) {
      throw new Error(`docs: failing command examples\n${failures.join("\n")}`);
    }
    return examples;
  } finally {
    await rm(top, { recursive: true, force: true });
  }
}
