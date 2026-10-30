// Reading baseline files, read-only (D-039 "Baseline als Datei", `baseline.schema.json`), so that
// SR-032 AK2 can name the baselines that contain the version of an evidence record in stage 4
// (assumption of spec question #530 Q1, plan F8). Creating and comparing baselines is stage 5
// (SR-050, SR-051); this file never writes.
//
// - Where: the `baselines` location of the workspace file, by default the folder `baselines` in the
//   main repository (`settingLocation`). A baseline is a `*.yaml` file directly in that folder that
//   matches `baseline.schema.json`, as saved filters are read (query/saved.ts); a `.yml` file is
//   reported and not read, a folder that does not exist holds no baseline.
// - Read (ADR-0018 "Reading"): a file in the layout ReqSeq writes by the line scanner of scan.ts,
//   any other parsed with YAML and checked against the schema; both give the same baseline.
// - A file that is no valid baseline is a problem (`baseline.invalid` with the line of the value, or
//   the problem of reading the YAML) and names no baseline; at most `MAX_VIOLATIONS` violations of
//   one file are listed, so a file that breaks one rule in each of its 50,000 entries gives a short
//   answer (N-036).
// - Contains: a baseline contains the version of an element when its `elements` list the element's
//   UUID with that version, in any repository (`elements[].repository` names a copy, SR-088).
// - Selects (`data.export` with `selection.baseline`, SR-061 AK2, assumption A1 of #530 Q2/Q4): a
//   baseline selects an element, whatever its version now, when its `elements` list the element's
//   UUID: an entry with `repository` the copy in that repository, one without every copy (as
//   `contains`). One index per file read, kept with the file, so a large baseline is indexed once.
// - Found (`findBaseline`): by `name` first (ignoring case and Unicode normal form, as saved
//   filters), then by its file name in the folder, with or without `.yaml`. A name two valid files
//   share is ambiguous; a text that names only a faulty file by its file name names that file.
// - Read on every call, kept by file: `baselineFilesState` keeps what each file gave with its
//   `changeStamp` (size, modification time, inode, change time; the model cache's rule, ADR-0008),
//   and a call lists the folder and reads again only a file that is new, whose stamp changed, or
//   that had changed less than `RACY_MS` before it was read (a same-size edit within the
//   resolution of the time stamp, or a restored modification time, is never missed). So a
//   baseline committed by another person counts as soon as the working copy has it, also in a
//   running server or the app, and a large baseline is parsed once.
import path from "node:path";
import type { BigIntStats } from "node:fs";
import fs from "node:fs/promises";
import type { Problem, WorkspaceLocation } from "../generated/types.js";
import type { YamlFile } from "../files/index.js";
import { listFolderFiles, readYamlFile, readYamlFileFast, yamlPointerLine } from "../files/index.js";
import { changeStamp } from "../model/index.js";
import { contractsBundle, fileSchemaValidator } from "../runtime/contracts.js";
import { inputViolations } from "../runtime/input-errors.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE, locate, settingLocation, workspaceLayoutState } from "../workspace/index.js";
import type { BaselineFile } from "../generated/types.js";
import { scanBaseline } from "./scan.js";

/** Baseline files end in `.yaml` (D-056). */
export const BASELINE_FILE_EXTENSION = ".yaml";

/** Violations of one file listed at most. */
export const MAX_VIOLATIONS = 10;

/** One valid baseline file. */
export interface Baseline {
  /** Its `name`. */
  readonly name: string;
  /** Workspace name of the repository of the file. */
  readonly repository: string;
  /** The file relative to its repository, `/` as separator. */
  readonly file: string;
  /** Whether it lists the element `id` with `version`. */
  readonly contains: (id: string, version: string) => boolean;
  /** Whether it lists the element, in any version (see the file comment). */
  readonly selects: (element: { readonly id: string; readonly repository: string }) => boolean;
}

/** The baselines folder of a workspace and what it holds. */
export interface Baselines {
  /** The `baselines` location of the workspace file, or its default. */
  readonly location: WorkspaceLocation;
  /** The valid baselines, in file order (code units). */
  readonly baselines: readonly Baseline[];
  /** Faulty files and a folder that cannot be read, in file order. */
  readonly problems: readonly Problem[];
  /** The files that are no valid baseline, relative to their repository, in file order. */
  readonly faulty: readonly string[];
  /** The repository of the folder is not on this machine: its baselines are not seen (SR-006 AK2). */
  readonly incomplete: boolean;
}

/** What one file gave. */
type FileRead =
  | { readonly kind: "valid"; readonly baseline: Baseline; readonly problems: readonly Problem[] }
  | { readonly kind: "faulty"; readonly problems: readonly Problem[] };

/** A file as read, with what it was read at. */
interface KeptFile {
  /** `changeStamp` of the file before it was read; undefined when it is to be read again. */
  readonly stamp: string | undefined;
  readonly read: FileRead;
}

/** What `readBaselines` keeps between calls: each file read, by repository and file. */
export type BaselineFiles = Map<string, KeptFile>;

const problemIn = (repository: string, file: string, message: string, line?: number): Problem => ({
  code: "baseline.invalid",
  severity: "error",
  message,
  repository,
  file,
  ...(line === undefined ? {} : { line }),
});

/** The key of an element version in `Baseline.contains`. */
const versionKey = (id: string, version: string): string => `${id}\n${version}`;

/** A valid baseline of `data`. */
const baselineOf = (data: BaselineFile, repository: string, file: string): Baseline => {
  const versions = new Set(data.elements.map((e) => versionKey(e.id, e.version)));
  // By UUID: the repositories its entries name, or `true` when an entry names none (every copy).
  const listed = new Map<string, Set<string> | true>();
  for (const entry of data.elements) {
    const before = listed.get(entry.id);
    if (entry.repository === undefined) {
      listed.set(entry.id, true);
    } else if (before === undefined) {
      listed.set(entry.id, new Set([entry.repository]));
    } else if (before !== true) {
      before.add(entry.repository);
    }
  }
  return {
    name: data.name,
    repository,
    file,
    contains: (id, version) => versions.has(versionKey(id, version)),
    selects: (element) => {
      const copies = listed.get(element.id);
      return copies === true || (copies?.has(element.repository) ?? false);
    },
  };
};

/** The violations of `yaml` against `baseline.schema.json`, at most `MAX_VIOLATIONS` of them. */
const violationsOf = (yaml: YamlFile, repository: string, file: string): Problem[] => {
  const validate = fileSchemaValidator("baseline.schema.json");
  if (validate(yaml.data)) {
    return [];
  }
  const violations = inputViolations(validate.errors, { input: yaml.data, schemas: contractsBundle.schemas });
  const shown = violations.slice(0, MAX_VIOLATIONS).map((violation) => {
    const message =
      violation.field === "" ? violation.message.replace(/^The input /, "the file ") : violation.message;
    return problemIn(
      repository,
      file,
      `Invalid baseline ${file}: ${message}`,
      yamlPointerLine(yaml, violation.path),
    );
  });
  const more = violations.length - shown.length;
  return more > 0
    ? [...shown, problemIn(repository, file, `Invalid baseline ${file}: ${String(more)} more violations`)]
    : shown;
};

/**
 * The JSON Pointer of the first repository name or element copy that `data` lists twice, or
 * undefined (ADR-0018): an entry without `repository` is the copy in `repository`, the file's.
 */
const repeatedIn = (data: BaselineFile, repository: string): string | undefined => {
  const names = new Set<string>();
  for (const [at, entry] of data.repositories.entries()) {
    if (names.has(entry.name)) {
      return `/repositories/${String(at)}`;
    }
    names.add(entry.name);
  }
  const copies = new Set<string>();
  for (const [at, entry] of data.elements.entries()) {
    const key = `${entry.id}\n${entry.repository ?? repository}`;
    if (copies.has(key)) {
      return `/elements/${String(at)}`;
    }
    copies.add(key);
  }
  return undefined;
};

/**
 * Reads one baseline file: in the layout ReqSeq writes with the line scanner (`scanBaseline`), else
 * parsed with YAML and checked against `baseline.schema.json` (ADR-0018 "Reading"). A file that
 * lists a repository or an element copy twice is faulty; the scanned one is parsed again for the line.
 */
const readBaselineFile = async (repository: RepositoryLocation, file: string): Promise<FileRead> => {
  const fast = await readYamlFileFast(repository.folder, file, scanBaseline);
  if (fast.kind === "fast" && repeatedIn(fast.value, repository.name) === undefined) {
    return { kind: "valid", baseline: baselineOf(fast.value, repository.name, file), problems: [] };
  }
  const read = fast.kind === "fast" ? await readYamlFile(repository.folder, file) : fast;
  if (read.kind === "problem") {
    return { kind: "faulty", problems: [{ ...read.problem, repository: repository.name }] };
  }
  const yaml = read.file;
  const warnings: Problem[] = yaml.warnings.map((w) => ({ ...w, repository: repository.name }));
  const violations = violationsOf(yaml, repository.name, file);
  const repeated =
    violations.length === 0 ? repeatedIn(yaml.data as BaselineFile, repository.name) : undefined;
  if (repeated !== undefined) {
    const what = repeated.startsWith("/elements/") ? "an element copy" : "a repository";
    const message = `Invalid baseline ${file}: it lists ${what} twice`;
    violations.push(problemIn(repository.name, file, message, yamlPointerLine(yaml, repeated)));
  }
  return violations.length === 0
    ? {
        kind: "valid",
        baseline: baselineOf(yaml.data as BaselineFile, repository.name, file),
        problems: warnings,
      }
    : { kind: "faulty", problems: [...warnings, ...violations] };
};

/** The `bigint` `lstat` of `absolute`; undefined when it is gone, null when it cannot be looked at. */
const stampStat = async (absolute: string): Promise<BigIntStats | null | undefined> =>
  fs
    .lstat(absolute, { bigint: true })
    .catch((error: unknown) => ((error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null));

/**
 * What the baseline file `file` (at `absolute`) gives now: as kept when its `changeStamp` (size,
 * modification time, inode, change time) is that of the last read and was not racy then, else read
 * again; undefined when it is gone since the folder was listed. A file that cannot be looked at is
 * read, so its problem is reported, and not kept. Its key goes into `seen`.
 */
const readKeptFile = async (
  repository: RepositoryLocation,
  absolute: string,
  file: string,
  kept: BaselineFiles,
  seen: Set<string>,
): Promise<FileRead | undefined> => {
  const readAt = Date.now();
  const stat = await stampStat(absolute);
  if (stat === undefined) {
    return undefined;
  }
  const key = `${repository.name}\n${file}`;
  seen.add(key);
  const stamp = stat === null ? undefined : changeStamp(stat, readAt);
  const before = kept.get(key);
  const read =
    stamp !== undefined && before?.stamp === stamp ? before.read : await readBaselineFile(repository, file);
  kept.set(key, { stamp, read });
  return read;
};

/**
 * The baselines of `layout` (see the file comment). `kept` holds what earlier calls read and is
 * updated: files that are gone are dropped from it.
 */
export const readBaselines = async (
  layout: WorkspaceLayout,
  kept: BaselineFiles = new Map(),
): Promise<Baselines> => {
  const location = settingLocation(layout, "baselines");
  const { repository, folder: absolute } = locate(layout, location);
  const none = { location, baselines: [], problems: [], faulty: [] };
  if (repository === undefined || absolute === undefined) {
    kept.clear();
    return { ...none, incomplete: repository !== undefined };
  }
  const folder = path.relative(repository.folder, absolute).split(path.sep).join("/");
  const shown = folder === "" ? "." : folder;
  const listing = await listFolderFiles(absolute);
  if (listing.kind !== "names") {
    kept.clear();
    const problems: Problem[] =
      listing.kind === "missing"
        ? []
        : [
            {
              code: "file.unreadable",
              severity: "error",
              repository: repository.name,
              file: shown,
              message: `Cannot read the baselines folder ${shown}: ${listing.reason}`,
            },
          ];
    return { ...none, problems, incomplete: false };
  }
  const baselines: Baseline[] = [];
  const problems: Problem[] = [];
  const faulty: string[] = [];
  const seen = new Set<string>();
  const names = listing.names.filter(
    (name) => !(repository.main && folder === "" && name === WORKSPACE_FILE),
  );
  for (const name of names) {
    const file = path.posix.join(folder, name);
    if (name.endsWith(".yml")) {
      problems.push({
        code: "baseline.invalid",
        severity: "warning",
        repository: repository.name,
        file,
        message: `${file} is not read: baseline files end in ${BASELINE_FILE_EXTENSION}`,
      });
      continue;
    }
    if (!name.endsWith(BASELINE_FILE_EXTENSION)) {
      continue;
    }
    const read = await readKeptFile(repository, path.join(absolute, name), file, kept, seen);
    if (read === undefined) {
      continue;
    }
    problems.push(...read.problems);
    if (read.kind === "valid") {
      baselines.push(read.baseline);
    } else {
      faulty.push(file);
    }
  }
  for (const key of [...kept.keys()].filter((k) => !seen.has(k))) {
    kept.delete(key);
  }
  return { location, baselines, problems, faulty, incomplete: false };
};

/** The `name` of every baseline that contains `version` of the element `id`, in file order, each once (SR-032 AK2). */
export const baselinesContaining = (baselines: Baselines, id: string, version: string): string[] => [
  ...new Set(baselines.baselines.filter((b) => b.contains(id, version)).map((b) => b.name)),
];

/** What `findBaseline` found for a text. */
export type FoundBaseline =
  | { readonly kind: "found"; readonly baseline: Baseline }
  /** Several valid files have the name: each file, relative to its repository. */
  | { readonly kind: "ambiguous"; readonly files: readonly string[] }
  /** The text names only a faulty file, by its file name: that file, relative to its repository. */
  | { readonly kind: "faulty"; readonly file: string }
  | { readonly kind: "none" };

/** A name as names compare (ignoring case and Unicode normal form), as saved filters compare theirs. */
const fold = (text: string): string => text.normalize("NFC").toLowerCase();

/** Whether `text` names the file `file` in the baselines folder, with or without `.yaml`. */
const namesFile = (file: string, text: string): boolean => {
  const name = path.posix.basename(file);
  return name === text || name === `${text}${BASELINE_FILE_EXTENSION}`;
};

/** The baseline `text` names in `baselines` (see the file comment). */
export const findBaseline = (baselines: Baselines, text: string): FoundBaseline => {
  const key = fold(text);
  const named = baselines.baselines.filter((b) => fold(b.name) === key);
  const [first, ...others] =
    named.length > 0 ? named : baselines.baselines.filter((b) => namesFile(b.file, text));
  if (first !== undefined) {
    return others.length === 0
      ? { kind: "found", baseline: first }
      : { kind: "ambiguous", files: [first, ...others].map((b) => b.file) };
  }
  const file = baselines.faulty.find((f) => namesFile(f, text));
  return file === undefined ? { kind: "none" } : { kind: "faulty", file };
};

/** What `readBaselines` read in this workspace, by file (see the file comment). Reset with the layout. */
export const baselineFilesState = defineWorkspaceState("baseline-files", (): BaselineFiles => new Map(), {
  dependsOn: [workspaceLayoutState],
});

/** The baselines of the workspace now, reading again only the files that changed. */
export const workspaceBaselines = async (workspace: Workspace): Promise<Baselines> =>
  readBaselines(await workspace.get(workspaceLayoutState), workspace.get(baselineFilesState));
