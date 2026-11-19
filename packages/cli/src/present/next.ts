// The next steps of core (SR-226, `common.schema.json#/$defs/nextStep`) as calls of this command line:
// `reqseq <group> <action>`, the positional fields in order with the known value or `<field>` when it is
// still open, then the known and open flags, then `--workspace <path>` when the step runs in another
// workspace than the current folder's. Pure layout: which steps there are is core's (ADR-0002).
import path from "node:path";
import type { CatalogEntry, NextStep } from "@reqseq/core";
import { inputFields, kebab } from "../fields.js";
import { isRecord } from "./common.js";

/** Where the calls are typed: the catalog, the current folder and the system (for quoting and paths). */
export interface CallSite {
  readonly commands: readonly CatalogEntry[];
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
}

/** A step as core gives it, read from an output or the details of an error. */
export const isNextStep = (value: unknown): value is NextStep =>
  isRecord(value) &&
  typeof value["command"] === "string" &&
  isRecord(value["input"]) &&
  Array.isArray(value["open"]) &&
  value["open"].every((field) => typeof field === "string");

/** A list of steps, never an empty one. */
export const isNextSteps = (value: unknown): value is readonly NextStep[] =>
  Array.isArray(value) && value.length > 0 && value.every(isNextStep);

/** The field of an output that holds next steps, with them; undefined when none does. */
export const nextStepsIn = (
  output: Readonly<Record<string, unknown>>,
): { readonly key: string; readonly steps: readonly NextStep[] } | undefined => {
  for (const [key, value] of Object.entries(output)) {
    if (isNextSteps(value)) {
      return { key, steps: value };
    }
  }
  return undefined;
};

/**
 * A token for the shell of the system: as it is when it is plain, else in single quotes, which take
 * everything literally; PowerShell on Windows (as SR-227 AK2) doubles a `'` in them, a POSIX shell closes
 * the quotes for it.
 */
export const quoted = (token: string, platform: NodeJS.Platform): string => {
  if (platform === "win32") {
    // A path of Windows keeps its `\` and the `~` of a short name plain.
    return /^[\w%+=:,./\\~-]+$/.test(token) ? token : `'${token.replaceAll("'", "''")}'`;
  }
  return /^[\w%+=:,./-]+$/.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`;
};

/** A path as typed in `cwd`: `.` for it, relative below it, else absolute. */
const typedPath = (value: string, cwd: string): string => {
  const relative = path.relative(cwd, value);
  if (relative === "") {
    return ".";
  }
  return relative.startsWith("..") || path.isAbsolute(relative) ? value : relative;
};

/** The call of one step; the command name itself when this command line does not know it. */
export const callOf = (step: NextStep, site: CallSite): string => {
  const entry = site.commands.find((candidate) => candidate.name === step.command);
  if (entry === undefined) {
    return step.command;
  }
  const dot = entry.name.indexOf(".");
  const words = ["reqseq", entry.name.slice(0, dot), kebab(entry.name.slice(dot + 1))];
  const valueOf = (field: { readonly name: string; readonly localPath: boolean }): string | undefined => {
    const value = step.input[field.name];
    if (typeof value === "string") {
      return quoted(field.localPath ? typedPath(value, site.cwd) : value, site.platform);
    }
    return typeof value === "number" ? String(value) : undefined;
  };
  const fields = inputFields(entry);
  const tokens: string[] = [];
  // Positionals in order up to the first one neither known nor open; a known one after it is given as its flag.
  let positional = true;
  const asFlags = new Set<string>();
  for (const field of fields.filter((f) => f.use === "positional")) {
    const shown = valueOf(field) ?? (step.open.includes(field.name) ? `<${field.flag}>` : undefined);
    positional &&= shown !== undefined;
    if (positional && shown !== undefined) {
      tokens.push(shown);
    } else {
      asFlags.add(field.name);
    }
  }
  for (const field of fields.filter((f) => f.use !== "positional" || asFlags.has(f.name))) {
    const value = valueOf(field);
    const known = step.input[field.name];
    if (typeof known === "boolean") {
      tokens.push(known ? `--${field.flag}` : `--no-${field.flag}`);
    } else if (value !== undefined) {
      tokens.push(`--${field.flag}`, value);
    } else if (step.open.includes(field.name)) {
      tokens.push(`--${field.flag}`, `<${field.flag}>`);
    }
  }
  const workspace =
    step.workspace === undefined || path.relative(site.cwd, step.workspace) === ""
      ? []
      : ["--workspace", quoted(typedPath(step.workspace, site.cwd), site.platform)];
  return [...words, ...tokens, ...workspace].join(" ");
};

/**
 * The lines of a list of steps: `next:`, then per step its call and, two spaces behind the longest call,
 * the title of its command.
 */
export const nextLines = (steps: readonly NextStep[], site: CallSite, heading = "next:"): string[] => {
  const rows = steps.map((step) => ({
    call: callOf(step, site),
    title: site.commands.find((entry) => entry.name === step.command)?.title ?? "",
  }));
  const width = Math.max(...rows.map((row) => row.call.length));
  return [
    heading,
    ...rows.map((row) => `  ${row.title === "" ? row.call : `${row.call.padEnd(width)}  ${row.title}`}`),
  ];
};

/**
 * The next steps of an output by their shape, whatever the field is called: the field they are in (`keys`,
 * none without them or without a `site`) and their lines, each with its line break (`text`).
 */
export const nextPart = (
  output: Readonly<Record<string, unknown>>,
  site: CallSite | undefined,
): { readonly keys: readonly string[]; readonly text: string } => {
  const found = site === undefined ? undefined : nextStepsIn(output);
  if (site === undefined || found === undefined) {
    return { keys: [], text: "" };
  }
  return {
    keys: [found.key],
    text: nextLines(found.steps, site)
      .map((line) => `${line}\n`)
      .join(""),
  };
};
