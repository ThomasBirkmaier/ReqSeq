// Creating and changing element files (SR-001, SR-002, SR-102; ADR-0004, ADR-0007). One Markdown
// file per element, named once from the type prefix and the UUID (D-056) and never renamed. The
// bytes come from the lossless writer (`editElementFile`), so a new file has LogReq's one fixed
// style and a change rewrites only the lines of the keys it changes; writing is atomic and refused
// when the file changed on disk. Statuses: a new element gets the initial status of the metamodel;
// a change never touches `id`, `type` or `status` (ADR-0002 rule 6, D-030).
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CommandName, Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type {
  EditableFile,
  FileSnapshot,
  FrontmatterEdit,
  ParsedFile,
  PropertyValue,
} from "../files/index.js";
import {
  createFolder,
  editElementFile,
  parseFileBytes,
  readElementFile,
  resolveInRoot,
  writeFileAtomic,
} from "../files/index.js";
import type {
  DataExportElement,
  ElementInputValue,
  ElementValue,
  MetamodelEffectiveType,
} from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState, requireMeaning, typeForNewElement } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { directlyAffectedCount } from "./affected.js";
import type { NewFileRule } from "./discover.js";
import { newFileTarget } from "./discover.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS, classifyFile } from "./elements.js";
import { fileNameFor } from "./file-name.js";
import type { ImageMemo } from "./images.js";
import { embeddedImages, imageMemo } from "./images.js";
import { incomingFor } from "./incoming.js";
import { resolveRef } from "./resolve.js";
import { buildShortIds, shortIdState } from "./short-id.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState, ignoredBy, recordWrites } from "./store.js";
import type { TargetContext } from "./targets.js";
import { setInlineReferences, setRelationTargets } from "./targets.js";
import { successionsFor } from "./successors.js";
import type { ExtraFindings } from "./view.js";
import { elementVersion, elementView, titleKeyOf, versionOrRangeError } from "./view.js";

/** What `element.create` and `element.update` return. */
export interface ElementWriteResult {
  readonly element: DataExportElement;
  /** Written files relative to the workspace root, `/` as separator; empty when nothing changed. */
  readonly files: readonly string[];
  readonly problems: readonly Problem[];
}

/** What `element.update` returns. */
export interface UpdateElementResult extends ElementWriteResult {
  /**
   * The number of directly affected elements when the save changed the version (SR-024 AK2,
   * `directlyAffectedCount`); 0 when it did not: a title, a property that does not count to the
   * version, or no change at all (AK3, D-013).
   */
  readonly affected: number;
}

export interface CreateElementInput {
  readonly type: string;
  readonly title: string;
  readonly text?: string;
  readonly properties?: Readonly<Record<string, ElementInputValue>>;
  readonly repository?: string;
  readonly folder?: string;
}

export interface UpdateElementInput {
  readonly ref: string;
  readonly title?: string;
  readonly text?: string;
  readonly set?: Readonly<Record<string, ElementInputValue>>;
  readonly unset?: readonly string[];
}

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * A value of the input as the writer takes it. Relation targets are plain string records; the
 * generated interface `RelationTarget` has no index signature, so it is converted here once.
 */
const toPropertyValue = (value: ElementValue): PropertyValue => value as PropertyValue;

const isEmpty = (value: ElementInputValue): boolean =>
  value === null || (Array.isArray(value) && value.length === 0);

/** The title key, which the type must have (D-059: the meaning `title`). */
const titleKeyFor = (metamodel: Metamodel, type: MetamodelEffectiveType, command: CommandName): string => {
  const key = titleKeyOf(metamodel);
  if (key === undefined) {
    // No property has the meaning: `metamodel.meaning-unassigned` (SR-013 AK3).
    requireMeaning(metamodel, "title", command);
  }
  if (key === undefined || !type.properties.includes(key)) {
    throw invalid(`Type ${type.key} has no property ${String(key)}, which holds the title`, {
      type: type.key,
      key,
      reason: "no-title-property",
    });
  }
  return key;
};

/**
 * Checks that `keys` may be written for `type`: properties of the type only, never the structural
 * keys or the title key (given as `title`). Relation kinds are no properties; relations are added
 * with `relation.add`.
 */
const checkPropertyKeys = (
  keys: readonly string[],
  metamodel: Metamodel,
  type: MetamodelEffectiveType,
  titleKey: string,
  field: string,
): void => {
  for (const key of keys) {
    if (STRUCTURAL_KEYS.includes(key)) {
      throw invalid(`${field} cannot hold ${key}: LogReq sets it`, { key, reason: "structural" });
    }
    if (key === titleKey) {
      throw invalid(`${field} cannot hold the title key ${key}; give the title as title`, {
        key,
        reason: "title",
      });
    }
    if (metamodel.relations.some((r) => r.key === key)) {
      throw invalid(`${key} is a relation kind, not a property; add relations with relation.add`, {
        key,
        reason: "relation",
      });
    }
    if (!type.properties.includes(key)) {
      throw invalid(`Type ${type.key} has no property ${key}`, {
        key,
        type: type.key,
        reason: "not-a-property",
      });
    }
  }
};

/** The one status with `initial: true` (D-030); the tool never picks one itself. */
const initialStatus = (metamodel: Metamodel): string => {
  const initial = metamodel.statuses.filter((s) => s.initial === true);
  const [first, ...others] = initial;
  if (first === undefined || others.length > 0) {
    throw invalid(
      `The metamodel must mark exactly one status as initial (initial: true) for new elements; it marks ${String(initial.length)}`,
      { reason: "initial-status", initial: initial.map((s) => s.key) },
    );
  }
  return first.key;
};

const targetRepository = (layout: WorkspaceLayout, name: string | undefined): RepositoryLocation => {
  const wanted = name ?? layout.main;
  const repository = layout.repositories.find((r) => r.name === wanted);
  if (repository === undefined) {
    throw invalid(`The workspace has no repository ${wanted}`, { repository: wanted, reason: "unknown" });
  }
  if (!repository.available) {
    throw invalid(`Repository ${wanted} is not available on this machine`, {
      repository: wanted,
      reason: "not-available",
    });
  }
  return repository;
};

/** A written file relative to the workspace root (the main repository's folder), with `/`. */
const workspacePath = (layout: WorkspaceLayout, repository: RepositoryLocation, file: string): string => {
  // The main repository is always kept and available: it holds the workspace file.
  const main = targetRepository(layout, layout.main);
  return path.relative(main.folder, path.join(repository.folder, file)).split(path.sep).join("/");
};

/** An element file as read: the parsed file and the element it is. */
export interface ReadElement {
  readonly file: ParsedFile;
  readonly record: ElementRecord;
}

/** The file as it is now, classified; undefined when it is gone, faulty or no element. */
const readElement = async (
  repository: RepositoryLocation,
  file: string,
): Promise<ReadElement | undefined> => {
  const read = await readElementFile(repository.folder, file);
  if (read.kind !== "parsed") {
    return undefined;
  }
  const classified = classifyFile(repository.name, read.file);
  return classified.kind === "element" ? { file: read.file, record: classified.element } : undefined;
};

/**
 * The element of bytes LogReq has just written, with the snapshot of the write, so the result shows
 * what was written without reading the file again. The writer checked the bytes, so anything but an
 * element is a bug (`internal`).
 */
export const writtenElement = (
  repository: string,
  bytes: Uint8Array,
  snapshot: FileSnapshot,
): ReadElement => {
  const notAnElement = (): CommandError =>
    new CommandError("internal", `${snapshot.path} was written, but it does not read back as an element`);
  const parsed = parseFileBytes(snapshot.path, bytes);
  if (parsed.kind !== "parsed") {
    throw notAnElement();
  }
  const file: ParsedFile = { ...parsed.content, path: snapshot.path, snapshot };
  const classified = classifyFile(repository, file);
  if (classified.kind !== "element") {
    throw notAnElement();
  }
  return { file, record: classified.element };
};

/** Keeps a byte order mark as a character, so that writing the string writes it again (ADR-0007). */
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

interface Context {
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  /** One memo of image lookups for the whole command (ADR-0005 "Files"). */
  readonly images: ImageMemo;
}

const contextOf = async (workspace: Workspace): Promise<Context> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  return { layout, metamodel, store, images: imageMemo() };
};

/** The store with `record` added, for the short IDs of a new element without reading every file again. */
const withRecord = (store: ElementStore, record: ElementRecord): ElementStore => {
  const byId = new Map(store.byId);
  byId.set(record.id, [...(store.byId.get(record.id) ?? []), record]);
  return { ...store, elements: [...store.elements, record], byId };
};

/** Whether `key` is a relation-valued property (validity, packages, ...), whose targets carry a version. */
const isRelationProperty = (metamodel: Metamodel, key: string): boolean =>
  metamodel.properties.some((p) => p.key === key && p.kind === "relation");

/**
 * The given property values with their relation targets as stored (SR-021 AK1, `setRelationTargets`),
 * compared with the values `stored` in the source file now.
 */
const withTargets = async (
  context: TargetContext,
  sourceRepository: string,
  values: readonly (readonly [string, ElementInputValue])[],
  stored: Readonly<Record<string, unknown>>,
): Promise<[string, ElementValue][]> =>
  Promise.all(
    values.map(async ([key, value]): Promise<[string, ElementValue]> => [
      key,
      isRelationProperty(context.metamodel, key)
        ? await setRelationTargets(context, sourceRepository, value, stored[key])
        : // Only relation-valued properties hold targets; any other value is stored as given.
          (value as ElementValue),
    ]),
  );

/** The element as it was before a save, to tell whether the save changed its version (SR-024 AK2). */
interface Before {
  /** Its record in the store the save started from. */
  readonly record: ElementRecord;
  /** Undefined when it had none (a value that counts without a normal form, ADR-0005). */
  readonly version: string | undefined;
}

/**
 * The version of an element as read (`elementVersion`), with the images its text embeds; undefined
 * when it has none (as the current versions call it, #259): an embedded image or a folder above it
 * cannot be read (`file.faulty`), or a value that counts has no normal form (`.inf`, `.nan`,
 * ADR-0005). A save of such an element counts as a change of its version, so a save that removes a
 * broken image link or the value still works. Any other error is a bug and passed on.
 */
const versionBefore = async (
  context: Context,
  repository: RepositoryLocation,
  read: ReadElement,
): Promise<string | undefined> => {
  let images: Awaited<ReturnType<typeof embeddedImages>>;
  try {
    images = await embeddedImages(
      { repository, ignored: ignoredBy(context.layout) },
      read.record.file,
      read.file.body,
      context.images,
    );
  } catch (error) {
    // `file.faulty`; anything else is a bug.
    if (!(error instanceof CommandError)) {
      throw error;
    }
    return undefined;
  }
  const version = versionOrRangeError(() =>
    elementVersion(read.record, read.file.body, context.metamodel, images),
  );
  return version instanceof RangeError ? undefined : version;
};

/** What `finish` needs besides the workspace, the written element and the context. */
interface FinishOptions {
  readonly shortIds: ShortIds;
  readonly titleKey: string;
  /** Written files relative to the workspace root; none when nothing was written. */
  readonly files: readonly string[];
  readonly extraFindings: ExtraFindings | undefined;
  /** The snapshot the write replaced; none for a new file. */
  readonly replaced?: FileSnapshot;
  /** The element before a save that wrote it (`element.update`): `affected` is counted. */
  readonly before?: Before;
}

/**
 * The result of a write; with `files` written, the element store gets the file as written
 * (`replaced`; `recordWrites`, #166). With `before` (a save of an existing element), `affected` is
 * the number of directly affected elements when the version changed, else 0 (SR-024 AK2, AK3), on
 * the incoming index of the store before the write: the links of other elements did not change,
 * and the index is built before `recordWrites`, so the carry of the index (#273) takes it over.
 */
const finish = async (
  workspace: Workspace,
  written: ReadElement,
  context: Context,
  options: FinishOptions,
): Promise<ElementWriteResult & { readonly affected?: number }> => {
  const { shortIds, titleKey, files, extraFindings, replaced, before } = options;
  const repository = targetRepository(context.layout, written.record.repository);
  const element = elementView({
    ...written,
    images: await embeddedImages(
      { repository, ignored: ignoredBy(context.layout) },
      written.record.file,
      written.file.body,
      context.images,
    ),
    metamodel: context.metamodel,
    store: context.store,
    shortIds,
    titleKey,
    layout: context.layout,
    successionsOf: (element) => successionsFor(workspace, context.store, context.metamodel, element),
    ...(extraFindings === undefined ? {} : { extraFindings }),
  });
  const affected =
    before === undefined
      ? {}
      : {
          affected:
            before.version === element.version
              ? 0
              : directlyAffectedCount(
                  incomingFor(workspace, context.store, context.metamodel),
                  before.record,
                ),
        };
  if (files.length > 0) {
    await recordWrites(workspace, context.layout, [
      { repository: written.record.repository, file: written.file, replaced },
    ]);
  }
  return { element, files, problems: element.problems, ...affected };
};

const EMPTY_FILE: EditableFile = { frontmatter: "", body: "", eol: "\n", closingEol: "\n", bom: false };

/** What `refuseUnlisted` tells the caller to change, per rule; `{path}` is the path the rule names. */
const NOT_LISTED: Readonly<Record<NewFileRule, string>> = {
  "skipped-name":
    "is named .git or node_modules (or a spelling Windows or macOS take for it), which LogReq never reads or writes",
  ignored: "matches an ignore glob of the workspace file",
  "nested-repository": "is the folder of another repository of the workspace; give that repository instead",
  "git-entry": "holds a .git entry, so it is a repository of its own",
  link: "is a link, which LogReq does not follow",
  unreadable: "cannot be opened",
  "not-a-folder": "is not a folder",
  spelling: "is spelled differently on disk",
  "not-portable":
    'is a name Windows changes or refuses (a trailing dot or space, <>:"|?*, a control character, a device name such as CON or NUL, or a short name such as GIT~1)',
  invisible:
    "holds an invisible format character (such as a zero-width or direction mark), which LogReq does not put into the name of a new folder",
};

/** Rules for a name that is refused wherever the repository is checked out (`reason: "not-portable"`). */
const NOT_PORTABLE: ReadonlySet<NewFileRule> = new Set(["not-portable", "invisible"]);

/**
 * Refuses `file` (relative to `repository`) with `input.invalid` when the element walk would not
 * list it once created (`reason: "not-listed"`) or a name is not portable (`"not-portable"`), so
 * LogReq never writes below `.git` (D-036, #183) and never creates an element nobody sees.
 * `details.rule` says which rule, `details.path` which part of the path, and with `rule: "spelling"`
 * `details.existing` the folder as it is spelled on disk. Returns the path to write: `file`, or
 * `file` with its existing folders spelled as on disk where only the Unicode normal form differs
 * (`newFileTarget`, #194).
 */
const refuseUnlisted = async (
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  file: string,
): Promise<string> => {
  const target = await newFileTarget(repository, ignoredBy(layout), file);
  if (target.kind === "listed") {
    return target.file;
  }
  const { rule, path: part, existing, character } = target.problem;
  const spelled = existing === undefined ? "" : ` (on disk: ${existing})`;
  const shown = character === undefined ? "" : ` (${character})`;
  throw invalid(
    `Not created: ${file} in repository ${repository.name}: ${part} ${NOT_LISTED[rule]}${spelled}${shown}`,
    {
      repository: repository.name,
      file,
      reason: NOT_PORTABLE.has(rule) ? "not-portable" : "not-listed",
      rule,
      path: part,
      ...(existing === undefined ? {} : { existing }),
      ...(character === undefined ? {} : { character }),
    },
  );
};

/** A folder relative to the repository with `/`; `""` for the repository folder itself. */
const folderOf = (folder: string): string => {
  const normalized = path.posix.normalize(folder.replaceAll("\\", "/"));
  return normalized === "." || normalized === "./" ? "" : normalized.replace(/\/$/, "");
};

/**
 * `element.create` (SR-001, SR-002): a new element of `input.type` with a new random UUID (v4,
 * D-017) and the initial status of the metamodel, in one new file `<prefix>-<12 hex>.md` in
 * `input.folder` (default: the type key, created when missing) of `input.repository` (default: the
 * main repository). Never replaces a file. Before anything is written, the target (also the
 * default type folder) is refused when the element walk would not list it or a name is not
 * portable (`refuseUnlisted`).
 */
export const createElement = async (
  workspace: Workspace,
  input: CreateElementInput,
  extraFindings?: ExtraFindings,
): Promise<ElementWriteResult> => {
  const context = await contextOf(workspace);
  const { layout, metamodel, store } = context;
  const type = typeForNewElement(metamodel, input.type);
  const titleKey = titleKeyFor(metamodel, type, "element.create");
  const status = initialStatus(metamodel);
  // Every given key is checked, also one with an empty value (`status: null` is refused).
  checkPropertyKeys(Object.keys(input.properties ?? {}), metamodel, type, titleKey, "properties");
  const repository = targetRepository(layout, input.repository);
  const properties = await withTargets(
    context,
    repository.name,
    Object.entries(input.properties ?? {}).filter(([, value]) => !isEmpty(value)),
    {},
  );
  const given = folderOf(input.folder ?? type.key);
  const id = randomUUID();
  const name = fileNameFor({ prefix: type.prefix, id });
  // A folder that leaves the repository (`..`, `/x`) is refused with the error `createFolder` gives.
  // Any other folder is judged by its names first, so `a:b` (on Windows a path relative to drive
  // A:) is refused as not portable on every OS. The check gives the folder as spelled on disk where
  // only the Unicode normal form differs (#194).
  const leaves = given === ".." || given.startsWith("../") || given.startsWith("/");
  const asGiven = given === "" ? name : `${given}/${name}`;
  let file = leaves ? asGiven : await refuseUnlisted(layout, repository, asGiven);
  const folder = given === "" ? "" : file.slice(0, -name.length - 1);
  if (folder !== "") {
    resolveInRoot(repository.folder, folder);
  }
  const edits: FrontmatterEdit[] = [
    { kind: "set", key: "id", value: id },
    { kind: "set", key: "type", value: type.key },
    { kind: "set", key: "status", value: status },
    { kind: "set", key: titleKey, value: input.title },
    ...properties.map(([key, value]): FrontmatterEdit => ({
      kind: "set",
      key,
      value: toPropertyValue(value),
    })),
  ];
  // A new file has LF line endings and ends with a line break (ADR-0004 "Stable writing").
  const text = await setInlineReferences(
    context,
    (input.text ?? "").replace(/\r\n?/g, "\n"),
    "",
    repository.name,
  );
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  const { bytes } = editElementFile(EMPTY_FILE, {
    edits,
    body,
    keyOrder: [...STRUCTURAL_KEYS, titleKey, ...type.properties],
  });
  // Every check is done and the bytes are verified before the folder is created, so only a failing
  // write itself (a clash with an existing file, a disk error) or a folder changed by someone else
  // meanwhile can leave a new, empty folder. With every folder there now, the rules of the walk are
  // checked on all of them again, so a link or `.git` entry put there meanwhile is not written into.
  // The file goes under the spelling this check finds on disk: a file system may store a new name
  // in another normal form (HFS+ stores NFD), and the walk lists the file under that spelling.
  if (folder !== "") {
    await createFolder(repository.folder, folder);
    file = await refuseUnlisted(layout, repository, file);
  }
  const written = writtenElement(
    repository.name,
    bytes,
    await writeFileAtomic(repository.folder, file, decode(bytes), null),
  );
  const shortIds = buildShortIds(withRecord(store, written.record).byId, metamodel);
  return finish(workspace, written, context, {
    shortIds,
    titleKey,
    files: [workspacePath(layout, repository, written.record.file)],
    extraFindings,
  });
};

/** The edits of `element.update`; `set` holds the values of `input.set` as they are stored. */
const updateEdits = (
  input: UpdateElementInput,
  set: readonly (readonly [string, ElementValue])[],
  titleKey: string,
): FrontmatterEdit[] => [
  ...(input.title === undefined ? [] : [{ kind: "set", key: titleKey, value: input.title } as const]),
  ...set.map(([key, value]): FrontmatterEdit => ({
    kind: "set",
    key,
    value: toPropertyValue(value),
  })),
  ...(input.unset ?? []).map((key): FrontmatterEdit => ({ kind: "remove", key })),
];

/**
 * The type of an element that may be changed. An element whose type the metamodel does not know is
 * only read (SR-016 AK3): throws `element.read-only` with `reason: unknown-type`. Every command that
 * writes an existing element file (update, status, supersede, bulk update, attachments, relation
 * writes) must call this before it writes.
 */
export const assertElementWritable = (
  metamodel: Metamodel,
  record: ElementRecord,
): MetamodelEffectiveType => {
  const type = findType(metamodel, record.type);
  if (type === undefined) {
    throw new CommandError(
      "element.read-only",
      `The metamodel has no type ${record.type}, so LogReq only reads ${record.file}`,
      { id: record.id, type: record.type, reason: "unknown-type" },
    );
  }
  return type;
};

/** An element file read again for a write, with the repository it lies in. */
export interface UnchangedElement {
  readonly repository: RepositoryLocation;
  readonly current: ReadElement;
}

/**
 * The file of `record` as it is now, for a write. Throws `file.changed-on-disk` (and resets the
 * element store, so the next call works on the new content) when the file is gone, faulty, no
 * element, or its SHA-256 is not the one the store read.
 */
export const readUnchanged = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  record: ElementRecord,
): Promise<UnchangedElement> => {
  // The store found the element there, so the repository is known and available.
  const repository = targetRepository(layout, record.repository);
  const current = await readElement(repository, record.file);
  if (current?.file.snapshot.sha256 !== record.snapshot.sha256) {
    await workspace.reset(elementStoreState);
    throw new CommandError(
      "file.changed-on-disk",
      `Not written: ${record.file} changed on disk since it was read. Read it again first.`,
      { file: record.file, repository: record.repository },
    );
  }
  return { repository, current };
};

/** One planned change of an existing element file: the file as read with `readUnchanged`, and its new bytes. */
export interface ElementFileWrite extends UnchangedElement {
  readonly bytes: Uint8Array;
}

/** One written file: the element as written (with the snapshot of the write) and the snapshot it replaced. */
export interface WrittenElementFile {
  readonly written: ReadElement;
  readonly replaced: FileSnapshot;
  /** Relative to the workspace root, `/` as separator. */
  readonly file: string;
}

/** A file this call has written: the planned write, the snapshot of the write and the path to report. */
interface DoneWrite {
  readonly write: ElementFileWrite;
  readonly snapshot: FileSnapshot;
  /** Relative to the workspace root, `/` as separator. */
  readonly file: string;
}

/**
 * Restores a file written by this call with its bytes as read; only while it still holds what this
 * call wrote. Returns false when that is not possible.
 */
const restore = async ({ write, snapshot }: DoneWrite): Promise<boolean> => {
  // The writer is lossless: no edit gives the bytes of the file as read (ADR-0007).
  const original = editElementFile(write.current.file, {}).bytes;
  try {
    const restored = await writeFileAtomic(
      write.repository.folder,
      snapshot.path,
      decode(original),
      snapshot,
    );
    return restored.sha256 === write.current.file.snapshot.sha256;
  } catch {
    return false;
  }
};

/**
 * Writes several existing element files, for commands that change more than one element
 * (`element.setStatus`; later `element.supersede` and `element.bulkUpdate`). Every check must be
 * done before. A write can still be refused (`file.read-only`, a file changed in the meantime, a
 * disk error), or written bytes may not read back as an element (`internal`); then every file
 * this call has written is written back with its bytes as read (best effort; nothing is deleted)
 * and the error is thrown again with its code. `details.written` lists the files not restored
 * (relative to the workspace root); it is absent when every file was restored. After the writes
 * the element store gets all written files in place (`recordWrites`, #166); after a failure it is
 * reset, so the next read finds the files as they are.
 */
export const writeElementFiles = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  writes: readonly ElementFileWrite[],
): Promise<WrittenElementFile[]> => {
  const done: DoneWrite[] = [];
  const results: WrittenElementFile[] = [];
  try {
    for (const write of writes) {
      const { repository, current, bytes } = write;
      const snapshot = await writeFileAtomic(
        repository.folder,
        current.record.file,
        decode(bytes),
        current.file.snapshot,
      );
      const file = workspacePath(layout, repository, current.record.file);
      // Recorded before the bytes are checked, so a file that does not read back is restored too.
      done.push({ write, snapshot, file });
      results.push({
        written: writtenElement(repository.name, bytes, snapshot),
        replaced: current.file.snapshot,
        file,
      });
    }
  } catch (error) {
    const kept: string[] = [];
    for (const written of done.reverse()) {
      if (!(await restore(written))) {
        kept.unshift(written.file);
      }
    }
    await workspace.reset(elementStoreState);
    if (kept.length === 0 || !(error instanceof CommandError)) {
      throw error;
    }
    throw new CommandError(error.code, error.message, { ...error.details, written: kept }, { cause: error });
  }
  // The store gets every written file at once, without reading a file again (#166).
  if (results.length > 0) {
    await recordWrites(
      workspace,
      layout,
      results.map((result) => ({
        repository: result.written.record.repository,
        file: result.written.file,
        replaced: result.replaced,
      })),
    );
  }
  return results;
};

/**
 * `element.update` (SR-001, SR-102): changes title, text and properties of one element. Only the
 * lines of changed keys and the text are rewritten; unknown keys, comments, quoting, key order,
 * line endings and the file name stay (SR-001 AK2, SR-016 AK2). The UUID, the type and the status
 * are never touched (SR-002 AK2, ADR-0002 rule 6). Refused with `file.changed-on-disk` when the file
 * changed since the element store read it; the store is then read again on the next call.
 * `affected`: the number of directly affected elements when the version changed (SR-024 AK2, AK3).
 */
export const updateElement = async (
  workspace: Workspace,
  input: UpdateElementInput,
  extraFindings?: ExtraFindings,
): Promise<UpdateElementResult> => {
  const context = await contextOf(workspace);
  const { layout, metamodel, store } = context;
  const shortIds = await workspace.get(shortIdState);
  const record = resolveRef(store, shortIds, input.ref);
  const type = assertElementWritable(metamodel, record);
  const titleKey = titleKeyFor(metamodel, type, "element.update");
  const setKeys = Object.keys(input.set ?? {});
  const unsetKeys = input.unset ?? [];
  checkPropertyKeys(setKeys, metamodel, type, titleKey, "set");
  checkPropertyKeys(unsetKeys, metamodel, type, titleKey, "unset");
  const both = setKeys.find((key) => unsetKeys.includes(key));
  if (both !== undefined) {
    throw invalid(`${both} is in both set and unset`, { key: both, reason: "set-and-unset" });
  }
  const { repository, current } = await readUnchanged(workspace, layout, record);
  const set = await withTargets(
    context,
    record.repository,
    Object.entries(input.set ?? {}),
    current.record.data,
  );
  const text =
    input.text === undefined
      ? undefined
      : await setInlineReferences(context, input.text, current.file.body, record.repository);
  const { bytes, changed } = editElementFile(current.file, {
    edits: updateEdits(input, set, titleKey),
    ...(text === undefined ? {} : { body: text }),
    keyOrder: type.properties,
  });
  let result: ElementWriteResult & { readonly affected?: number };
  if (changed) {
    const before: Before = {
      // The record of the store: its own relations to itself are no affected element.
      record,
      version: await versionBefore(context, repository, current),
    };
    const written = writtenElement(
      repository.name,
      bytes,
      await writeFileAtomic(repository.folder, record.file, decode(bytes), record.snapshot),
    );
    result = await finish(workspace, written, context, {
      shortIds,
      titleKey,
      files: [workspacePath(layout, repository, record.file)],
      extraFindings,
      replaced: record.snapshot,
      before,
    });
  } else {
    result = await finish(workspace, current, context, { shortIds, titleKey, files: [], extraFindings });
  }
  // Nothing written: nothing affected (AK3).
  return { ...result, affected: result.affected ?? 0 };
};
