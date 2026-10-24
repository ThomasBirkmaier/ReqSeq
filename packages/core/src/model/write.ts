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
  writeFileAtomic,
} from "../files/index.js";
import type { DataExportElement, ElementValue, MetamodelEffectiveType } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState, requireMeaning, typeForNewElement } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS, classifyFile } from "./elements.js";
import { fileNameFor } from "./file-name.js";
import { resolveRef } from "./resolve.js";
import { buildShortIds, shortIdState } from "./short-id.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import { elementView, titleKeyOf } from "./view.js";

/** What `element.create` and `element.update` return. */
export interface ElementWriteResult {
  readonly element: DataExportElement;
  /** Written files relative to the workspace root, `/` as separator; empty when nothing changed. */
  readonly files: readonly string[];
  readonly problems: readonly Problem[];
}

export interface CreateElementInput {
  readonly type: string;
  readonly title: string;
  readonly text?: string;
  readonly properties?: Readonly<Record<string, ElementValue>>;
  readonly repository?: string;
  readonly folder?: string;
}

export interface UpdateElementInput {
  readonly ref: string;
  readonly title?: string;
  readonly text?: string;
  readonly set?: Readonly<Record<string, ElementValue>>;
  readonly unset?: readonly string[];
}

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * A value of the input as the writer takes it. Relation targets are plain string records; the
 * generated interface `RelationTarget` has no index signature, so it is converted here once.
 */
const toPropertyValue = (value: ElementValue): PropertyValue => value as PropertyValue;

const isEmpty = (value: ElementValue): boolean =>
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
}

const contextOf = async (workspace: Workspace): Promise<Context> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  return { layout, metamodel, store };
};

/** The store with `record` added, for the short IDs of a new element without reading every file again. */
const withRecord = (store: ElementStore, record: ElementRecord): ElementStore => {
  const byId = new Map(store.byId);
  byId.set(record.id, [...(store.byId.get(record.id) ?? []), record]);
  return { ...store, elements: [...store.elements, record], byId };
};

/** The result of a write; the element store is reset, so the next read finds the file as written. */
const finish = async (
  workspace: Workspace,
  written: ReadElement,
  context: Context,
  shortIds: ShortIds,
  titleKey: string,
  files: readonly string[],
): Promise<ElementWriteResult> => {
  const element = elementView({
    ...written,
    metamodel: context.metamodel,
    store: context.store,
    shortIds,
    titleKey,
  });
  if (files.length > 0) {
    await workspace.reset(elementStoreState);
  }
  return { element, files, problems: element.problems };
};

const EMPTY_FILE: EditableFile = { frontmatter: "", body: "", eol: "\n", closingEol: "\n", bom: false };

/** A folder relative to the repository with `/`; `""` for the repository folder itself. */
const folderOf = (folder: string): string => {
  const normalized = path.posix.normalize(folder.replaceAll("\\", "/"));
  return normalized === "." || normalized === "./" ? "" : normalized.replace(/\/$/, "");
};

/**
 * `element.create` (SR-001, SR-002): a new element of `input.type` with a new random UUID (v4,
 * D-017) and the initial status of the metamodel, in one new file `<prefix>-<12 hex>.md` in
 * `input.folder` (default: the type key, created when missing) of `input.repository` (default: the
 * main repository). Never replaces a file.
 */
export const createElement = async (
  workspace: Workspace,
  input: CreateElementInput,
): Promise<ElementWriteResult> => {
  const context = await contextOf(workspace);
  const { layout, metamodel, store } = context;
  const type = typeForNewElement(metamodel, input.type);
  const titleKey = titleKeyFor(metamodel, type, "element.create");
  const status = initialStatus(metamodel);
  // Every given key is checked, also one with an empty value (`status: null` is refused).
  checkPropertyKeys(Object.keys(input.properties ?? {}), metamodel, type, titleKey, "properties");
  const properties = Object.entries(input.properties ?? {}).filter(([, value]) => !isEmpty(value));
  const repository = targetRepository(layout, input.repository);
  const folder = folderOf(input.folder ?? type.key);
  const id = randomUUID();
  const file =
    folder === ""
      ? fileNameFor({ prefix: type.prefix, id })
      : `${folder}/${fileNameFor({ prefix: type.prefix, id })}`;
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
  const text = (input.text ?? "").replace(/\r\n?/g, "\n");
  const body = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  const { bytes } = editElementFile(EMPTY_FILE, {
    edits,
    body,
    keyOrder: [...STRUCTURAL_KEYS, titleKey, ...type.properties],
  });
  // Every check is done and the bytes are verified before the folder is created, so only a failing
  // write itself (a clash with an existing file, a disk error) can leave a new, empty folder.
  if (folder !== "") {
    await createFolder(repository.folder, folder);
  }
  const written = writtenElement(
    repository.name,
    bytes,
    await writeFileAtomic(repository.folder, file, decode(bytes), null),
  );
  const shortIds = buildShortIds(withRecord(store, written.record).byId, metamodel);
  return finish(workspace, written, context, shortIds, titleKey, [
    workspacePath(layout, repository, written.record.file),
  ]);
};

const updateEdits = (input: UpdateElementInput, titleKey: string): FrontmatterEdit[] => [
  ...(input.title === undefined ? [] : [{ kind: "set", key: titleKey, value: input.title } as const]),
  ...Object.entries(input.set ?? {}).map(([key, value]): FrontmatterEdit => ({
    kind: "set",
    key,
    value: toPropertyValue(value),
  })),
  ...(input.unset ?? []).map((key): FrontmatterEdit => ({ kind: "remove", key })),
];

/** The type of an element that may be changed; an unknown type makes it read-only (SR-016 AK3). */
const writableType = (metamodel: Metamodel, record: ElementRecord): MetamodelEffectiveType => {
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

/**
 * `element.update` (SR-001, SR-102): changes title, text and properties of one element. Only the
 * lines of changed keys and the text are rewritten; unknown keys, comments, quoting, key order,
 * line endings and the file name stay (SR-001 AK2, SR-016 AK2). The UUID, the type and the status
 * are never touched (SR-002 AK2, ADR-0002 rule 6). Refused with `file.changed-on-disk` when the file
 * changed since the element store read it; the store is then read again on the next call.
 */
export const updateElement = async (
  workspace: Workspace,
  input: UpdateElementInput,
): Promise<ElementWriteResult> => {
  const context = await contextOf(workspace);
  const { layout, metamodel, store } = context;
  const shortIds = await workspace.get(shortIdState);
  const record = resolveRef(store, shortIds, input.ref);
  const type = writableType(metamodel, record);
  const titleKey = titleKeyFor(metamodel, type, "element.update");
  const setKeys = Object.keys(input.set ?? {});
  const unsetKeys = input.unset ?? [];
  checkPropertyKeys(setKeys, metamodel, type, titleKey, "set");
  checkPropertyKeys(unsetKeys, metamodel, type, titleKey, "unset");
  const both = setKeys.find((key) => unsetKeys.includes(key));
  if (both !== undefined) {
    throw invalid(`${both} is in both set and unset`, { key: both, reason: "set-and-unset" });
  }
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
  const { bytes, changed } = editElementFile(current.file, {
    edits: updateEdits(input, titleKey),
    ...(input.text === undefined ? {} : { body: input.text }),
    keyOrder: type.properties,
  });
  if (!changed) {
    return finish(workspace, current, context, shortIds, titleKey, []);
  }
  const written = writtenElement(
    repository.name,
    bytes,
    await writeFileAtomic(repository.folder, record.file, decode(bytes), record.snapshot),
  );
  return finish(workspace, written, context, shortIds, titleKey, [
    workspacePath(layout, repository, record.file),
  ]);
};
