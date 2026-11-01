// Creating and changing element files (SR-001, SR-002, SR-102; ADR-0004, ADR-0007). One Markdown
// file per element, named once from the type prefix and the UUID (D-056) and never renamed. The
// bytes come from the lossless writer (`editElementFile`), so a new file has ReqSeq's one fixed
// style and a change rewrites only the lines of the keys it changes; writing is atomic and refused
// when the file changed on disk. Statuses: a new element gets the initial status of the metamodel,
// or of its type when the type restricts the statuses (#306; none for a type without status or with
// only invalid statuses, #344); a change never touches `id`, `type` or `status` (ADR-0002 rule 6,
// D-030).
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
  bodyForText,
  createFolder,
  editElementFile,
  elementText,
  parseFileBytes,
  readElementFile,
  readElementFiles,
  resolveInRoot,
  sha256,
  writeFileAtomic,
} from "../files/index.js";
import type {
  DataExportElement,
  ElementInputValue,
  ElementValue,
  MetamodelEffectiveType,
} from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import {
  findNamed,
  findType,
  keyDefinition,
  listNamed,
  markdownKeysOf,
  metamodelState,
  originMeaning,
  requireMeaning,
  typeForNewElement,
  typeStatuses,
} from "../metamodel/index.js";
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
import { setInlineReferences, setMarkdownReferences, setRelationTargets } from "./targets.js";
import { successionsFor } from "./successors.js";
import type { TitleContext } from "./relation-titles.js";
import { withCurrentTitles } from "./relation-titles.js";
import type { ElementHints } from "./get.js";
import type { LocatableFinding } from "./locate.js";
import { elementContent, elementView, titleKeyOf } from "./view.js";

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
   * version, or no change at all (AK3, D-013). Also for an element without a version (a value
   * that counts has no normal form): what the version is computed from is compared (#276).
   */
  readonly affected: number;
  /** The SHA-256 of the element file as written, or as read when nothing changed (SR-106). */
  readonly fileSha256: string;
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
  /** Which of the elements `ref` names: the workspace name of its repository (`resolveRef`, #255). */
  readonly repository?: string;
  /** Write precondition (SR-106): the SHA-256 the element file must still have (`expectedFile`). */
  readonly expectedFileSha256?: string;
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
 * Why `key` may not be written as a property of `type` (`element.create`, `reqif.import`), or
 * undefined: properties of the type only, never the structural keys `id`, `type`, `status`
 * (D-030: a status is set by people), the title key (given as `title`) or a property of the origin
 * (`ORIGIN_MEANINGS`), which only `reqif.import` writes (SR-057 AK3). Relation kinds are no
 * properties; relations are added with `relation.add`.
 */
export const propertyKeyRefusal = (
  key: string,
  metamodel: Metamodel,
  type: MetamodelEffectiveType,
  titleKey: string,
  field: string,
): { readonly message: string; readonly details: Readonly<Record<string, string>> } | undefined => {
  if (STRUCTURAL_KEYS.includes(key)) {
    return { message: `${field} cannot hold ${key}: ReqSeq sets it`, details: { key, reason: "structural" } };
  }
  if (key === titleKey) {
    return {
      message: `${field} cannot hold the title key ${key}; give the title as title`,
      details: { key, reason: "title" },
    };
  }
  if (metamodel.relations.some((r) => r.key === key)) {
    return {
      message: `${key} is a relation kind, not a property; add relations with relation.add`,
      details: { key, reason: "relation" },
    };
  }
  const origin = originMeaning(keyDefinition(metamodel, key)?.definition);
  if (origin !== undefined) {
    return {
      message: `${field} cannot hold ${key}: it holds the origin (${origin}), which only reqif.import writes`,
      details: { key, reason: "origin" },
    };
  }
  return type.properties.includes(key)
    ? undefined
    : {
        message: `Type ${type.key} has no property ${key}`,
        details: { key, type: type.key, reason: "not-a-property" },
      };
};

/** Refuses the first of `keys` that `propertyKeyRefusal` refuses, with `input.invalid`. */
const checkPropertyKeys = (
  keys: readonly string[],
  metamodel: Metamodel,
  type: MetamodelEffectiveType,
  titleKey: string,
  field: string,
): void => {
  for (const key of keys) {
    const refusal = propertyKeyRefusal(key, metamodel, type, titleKey, field);
    if (refusal !== undefined) {
      throw invalid(refusal.message, refusal.details);
    }
  }
};

/**
 * The given values with each value of a choice property as its key (#309, spec question #316): a
 * value (or each item of a list) is the key or the display name of a choice, in any case, and the file
 * gets the key (SR-012 AK3). A value that names no choice, or more than one, is refused with
 * `input.invalid` (`reason: unknown-choice`, `ambiguous-choice`) and the choices as `key (Name)`, so
 * a command never writes a choice value that is no key; a hand-written file is still read as it is
 * (SR-085 AK2). Values of the other kinds are kept as given (a wrong kind gives the hint of SR-085).
 */
export const withChoiceKeys = (
  metamodel: Metamodel,
  entries: readonly (readonly [string, ElementInputValue])[],
  field: string,
): [string, ElementInputValue][] =>
  entries.map(([key, value]): [string, ElementInputValue] => {
    const definition = keyDefinition(metamodel, key);
    if (definition?.kind !== "property" || definition.definition.kind !== "choice") {
      return [key, value];
    }
    const property = definition.definition;
    const choices = property.choices ?? [];
    const keyOf = (item: unknown): unknown => {
      const match = typeof item === "string" ? findNamed(choices, item) : ({ kind: "unknown" } as const);
      if (match.kind === "found") {
        return match.key;
      }
      const shown = typeof item === "string" ? item : JSON.stringify(item);
      throw invalid(
        match.kind === "ambiguous"
          ? `${field}.${key}: ${shown} names more than one value of ${property.name} (${match.keys.join(", ")}); give the key. The values are: ${listNamed(choices)}`
          : `${field}.${key}: ${shown} is not a value of ${property.name}; the values are: ${listNamed(choices)}`,
        {
          key,
          value: item,
          reason: match.kind === "ambiguous" ? "ambiguous-choice" : "unknown-choice",
          allowed: choices.map((c) => c.key),
          ...(match.kind === "ambiguous" ? { candidates: [...match.keys] } : {}),
        },
      );
    };
    return [
      key,
      (Array.isArray(value) ? value.map(keyOf) : value === null ? null : keyOf(value)) as ElementInputValue,
    ];
  });

/**
 * The status of a new element of `type` (D-030, #306): the one status with `initial: true` when the
 * type has it and it is not marked invalid (#350), else the type's first status in metamodel order
 * that is not marked invalid, which the metamodel sets by the order of its statuses. A new element
 * never gets an invalid status, which would supersede it at once (D-044). Undefined (no `status`
 * line) for a type without a status that is not invalid: a type without status, or one whose
 * statuses are all invalid, whose elements without status are current (#344, option 1). The tool
 * never picks one beyond this rule.
 */
const initialStatus = (metamodel: Metamodel, type: MetamodelEffectiveType): string | undefined => {
  const [working] = typeStatuses(metamodel, type).filter((s) => s.invalid !== true);
  if (working === undefined) {
    return undefined;
  }
  const initial = metamodel.statuses.filter((s) => s.initial === true);
  const [first, ...others] = initial;
  if (first === undefined || others.length > 0) {
    throw invalid(
      `The metamodel must mark exactly one status as initial (initial: true) for new elements; it marks ${String(initial.length)}`,
      { reason: "initial-status", initial: initial.map((s) => s.key) },
    );
  }
  return first.invalid !== true && type.statuses.includes(first.key) ? first.key : working.key;
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
export const workspacePath = (
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  file: string,
): string => {
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
  return read.kind === "parsed" ? asElement(repository.name, read.file) : undefined;
};

/** A parsed file with the element it is; undefined when it is no element. */
const asElement = (repository: string, file: ParsedFile): ReadElement | undefined => {
  const classified = classifyFile(repository, file);
  return classified.kind === "element" ? { file, record: classified.element } : undefined;
};

/**
 * The element of bytes ReqSeq has just written, with the snapshot of the write, so the result shows
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

/**
 * A check of a block above the model on the elements a write is about to write, passed by the
 * command (the variants block refuses a variant with validity entries, SR-039 AK2; the block layers keep
 * that rule above the model). `findings` gives why an element as it would be written may not be
 * written, before their lines are known (none: it may); `refusal` the error thrown for them before
 * anything is written. Only elements of `types` are asked, so the others are not parsed for it.
 */
export interface WriteCheck {
  readonly types: ReadonlySet<string>;
  readonly findings: (record: ElementRecord) => Promise<readonly LocatableFinding[]>;
  readonly refusal: (findings: readonly LocatableFinding[]) => CommandError;
}

/**
 * The element the bytes of a planned write read back as, with the findings of `check` on it;
 * undefined without a check or for a type it does not ask for.
 */
export const checkedBefore = async (
  check: WriteCheck | undefined,
  repository: string,
  bytes: Uint8Array,
  snapshot: FileSnapshot,
  type: string,
): Promise<{ readonly element: ReadElement; readonly findings: readonly LocatableFinding[] } | undefined> => {
  // Only the types the check asks for are parsed (N-036).
  if (check?.types.has(type) !== true) {
    return undefined;
  }
  const element = writtenElement(repository, bytes, snapshot);
  return { element, findings: await check.findings(element.record) };
};

/** Throws the refusal of `check` when it has findings on the element `bytes` would be. */
const refuseByCheck = async (
  check: WriteCheck | undefined,
  repository: string,
  bytes: Uint8Array,
  snapshot: FileSnapshot,
  type: string,
): Promise<void> => {
  if (check === undefined) {
    return;
  }
  const findings = (await checkedBefore(check, repository, bytes, snapshot, type))?.findings ?? [];
  if (findings.length > 0) {
    throw check.refusal(findings);
  }
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
 * The given property values with their relation targets (SR-021 AK1, `setRelationTargets`) and the
 * inline references in properties marked `markdown` (SR-127, `setMarkdownReferences`) as stored,
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
        : markdownKeysOf(context.metamodel).has(key)
          ? // Only the properties the input sets are handled, so a save never changes the links of others (SR-127).
            await setMarkdownReferences(context, key, sourceRepository, value, stored[key])
          : // Any other value is stored as given.
            (value as ElementValue),
    ]),
  );

/** The element as it was before a save, to tell whether the save changed its content (SR-024 AK2, AK3). */
interface Before {
  /** Its record in the store the save started from. */
  readonly record: ElementRecord;
  /**
   * What its version is computed from (`elementContent`); undefined when an embedded image cannot
   * be read.
   */
  readonly content: string | undefined;
}

/**
 * What the version of an element as read is computed from (`elementContent`), with the images its
 * text embeds, also when a value that counts has no normal form (`.inf`, `.nan`, ADR-0005) and it
 * has no version (#276); undefined when an embedded image or a folder above it cannot be read
 * (`file.faulty`, as the current versions call it, #259). A save of such an element counts as a
 * change, so a save that removes a broken image link still works. Any other error is a bug and
 * passed on.
 */
const contentBefore = async (
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
  return elementContent(read.record, read.file.body, context.metamodel, images);
};

/** What `finish` needs besides the workspace, the written element and the context. */
interface FinishOptions {
  readonly shortIds: ShortIds;
  readonly titleKey: string;
  /** Written files relative to the workspace root; none when nothing was written. */
  readonly files: readonly string[];
  /** Hints of blocks that import the model (`ElementHints`), asked for the written element. */
  readonly extraFindings: ElementHints | undefined;
  /** The snapshot the write replaced; none for a new file. */
  readonly replaced?: FileSnapshot;
  /** The element before a save that wrote it (`element.update`): `affected` is counted. */
  readonly before?: Before;
}

/**
 * The result of a write; with `files` written, the element store gets the file as written
 * (`replaced`; `recordWrites`, #166). With `before` (a save of an existing element), `affected` is
 * the number of directly affected elements when the content the version is computed from changed
 * (`elementContent`), else 0 (SR-024 AK2, AK3). The content is compared, not the version, so a save
 * of an element without a version (a value that counts has no normal form, #276) that changes only
 * its title or status also affects nothing; an embedded image that could not be read before the
 * save counts as a change (`contentBefore`). Counted on the incoming index of the store before the
 * write: the links of other elements did not change, and the index is built before
 * `recordWrites`, so the carry of the index (#273) takes it over.
 */
const finish = async (
  workspace: Workspace,
  written: ReadElement,
  context: Context,
  options: FinishOptions,
): Promise<ElementWriteResult & { readonly affected?: number }> => {
  const { shortIds, titleKey, files, extraFindings, replaced, before } = options;
  const repository = targetRepository(context.layout, written.record.repository);
  const images = await embeddedImages(
    { repository, ignored: ignoredBy(context.layout) },
    written.record.file,
    written.file.body,
    context.images,
  );
  const { layout, metamodel, store } = context;
  // Asked only while the metamodel is valid, as the view asks its own (#208, #220 option 1).
  const hints =
    extraFindings === undefined || !metamodel.valid
      ? []
      : await extraFindings({ workspace, layout, metamodel, store, shortIds }, written.record, false);
  const element = elementView({
    ...written,
    images,
    metamodel: context.metamodel,
    store: context.store,
    shortIds,
    titleKey,
    layout: context.layout,
    successionsOf: (element) => successionsFor(workspace, context.store, context.metamodel, element),
    extraFindings: hints,
  });
  const affected =
    before === undefined
      ? {}
      : {
          affected:
            before.content !== undefined &&
            before.content === elementContent(written.record, written.file.body, context.metamodel, images)
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
    "is named .git or node_modules (or a spelling Windows or macOS take for it), which ReqSeq never reads or writes",
  ignored: "matches an ignore glob of the workspace file",
  "nested-repository": "is the folder of another repository of the workspace; give that repository instead",
  "git-entry": "holds a .git entry, so it is a repository of its own",
  link: "is a link, which ReqSeq does not follow",
  unreadable: "cannot be opened",
  "not-a-folder": "is not a folder",
  spelling: "is spelled differently on disk",
  "not-portable":
    'is a name Windows changes or refuses (a trailing dot or space, <>:"|?*, a control character, a device name such as CON or NUL, or a short name such as GIT~1)',
  invisible:
    "holds an invisible format character (such as a zero-width or direction mark), which ReqSeq does not put into the name of a new folder",
};

/** Rules for a name that is refused wherever the repository is checked out (`reason: "not-portable"`). */
const NOT_PORTABLE: ReadonlySet<NewFileRule> = new Set(["not-portable", "invisible"]);

/**
 * Refuses `file` (relative to `repository`) with `input.invalid` when the element walk would not
 * list it once created (`reason: "not-listed"`) or a name is not portable (`"not-portable"`), so
 * ReqSeq never writes below `.git` (D-036, #183) and never creates an element nobody sees.
 * `details.rule` says which rule, `details.path` which part of the path, and with `rule: "spelling"`
 * `details.existing` the folder as it is spelled on disk. Returns the path to write: `file`, or
 * `file` with its existing folders spelled as on disk where only the Unicode normal form differs
 * (`newFileTarget`, #194). With `ignored: false` the `ignore` globs do not count, only the safety
 * rules: for a file the walk never reads, such as the data file of `data.store` (SR-062), which may
 * go into an ignored build folder.
 */
export const refuseUnlisted = async (
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  file: string,
  options: { readonly ignored?: false } = {},
): Promise<string> => {
  const target = await newFileTarget(
    repository,
    options.ignored === false ? () => false : ignoredBy(layout),
    file,
  );
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

/** What a new element of a type gets from the metamodel: its type, title key and initial status. */
export interface NewElementBase {
  readonly type: MetamodelEffectiveType;
  readonly titleKey: string;
  /** Undefined for a type without status (#344). */
  readonly status: string | undefined;
}

/**
 * The base of a new element of type `key` (`element.create`, `reqif.import`): refused like
 * `element.create` refuses an unknown or abstract type (`typeForNewElement`), a type without the
 * title property and a metamodel without exactly one initial status.
 */
export const newElementBase = (metamodel: Metamodel, key: string, command: CommandName): NewElementBase => {
  const type = typeForNewElement(metamodel, key);
  return { type, titleKey: titleKeyFor(metamodel, type, command), status: initialStatus(metamodel, type) };
};

/**
 * The bytes of a new element file: `id`, type, initial status, title, `properties` (already as
 * stored: choice keys, relation items with versions) in the type's order, then `text`. A new file
 * has a blank line after the frontmatter, LF line endings and ends with a line break (ADR-0004
 * "Stable writing"), as element.update writes a text (#308).
 */
export const newElementBytes = (
  base: NewElementBase,
  id: string,
  title: string,
  text: string,
  properties: readonly (readonly [string, PropertyValue])[],
): Uint8Array => {
  const { type, titleKey, status } = base;
  const edits: FrontmatterEdit[] = [
    { kind: "set", key: "id", value: id },
    { kind: "set", key: "type", value: type.key },
    ...(status === undefined ? [] : [{ kind: "set", key: "status", value: status } as const]),
    { kind: "set", key: titleKey, value: title },
    ...properties.map(([key, value]): FrontmatterEdit => ({ kind: "set", key, value })),
  ];
  return editElementFile(EMPTY_FILE, {
    edits,
    body: bodyForText(EMPTY_FILE.body, text),
    keyOrder: [...STRUCTURAL_KEYS, titleKey, ...type.properties],
  }).bytes;
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
  extraFindings?: ElementHints,
  check?: WriteCheck,
): Promise<ElementWriteResult> => {
  const context = await contextOf(workspace);
  const { layout, metamodel, store } = context;
  const base = newElementBase(metamodel, input.type, "element.create");
  const { type, titleKey } = base;
  // Every given key is checked, also one with an empty value (`status: null` is refused).
  checkPropertyKeys(Object.keys(input.properties ?? {}), metamodel, type, titleKey, "properties");
  const repository = targetRepository(layout, input.repository);
  const properties = await withTargets(
    context,
    repository.name,
    withChoiceKeys(
      metamodel,
      Object.entries(input.properties ?? {}).filter(([, value]) => !isEmpty(value)),
      "properties",
    ),
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
  const text = await setInlineReferences(context, input.text ?? "", "", repository.name);
  const bytes = newElementBytes(
    base,
    id,
    input.title,
    text,
    properties.map(([key, value]) => [key, toPropertyValue(value)] as const),
  );
  await refuseByCheck(
    check,
    repository.name,
    bytes,
    { path: file, size: bytes.length, mtimeMs: 0, sha256: sha256(bytes) },
    type.key,
  );
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
      `The metamodel has no type ${record.type}, so ReqSeq only reads ${record.file}`,
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
  return unchanged(workspace, record, repository, await readElement(repository, record.file));
};

/** `file.changed-on-disk` for the file of `record`: nothing was written. */
const changedOnDisk = (record: ElementRecord): CommandError =>
  new CommandError(
    "file.changed-on-disk",
    `Not written: ${record.file} changed on disk since it was read. Read it again first.`,
    { file: record.file, repository: record.repository },
  );

/** `current` (the file of `record` as read now) when it is unchanged; see `readUnchanged`. */
const unchanged = async (
  workspace: Workspace,
  record: ElementRecord,
  repository: RepositoryLocation,
  current: ReadElement | undefined,
): Promise<UnchangedElement> => {
  if (current?.file.snapshot.sha256 !== record.snapshot.sha256) {
    await workspace.reset(elementStoreState);
    throw changedOnDisk(record);
  }
  return { repository, current };
};

/**
 * The write precondition of the caller (SR-106, `element.update` input `expectedFileSha256`): throws
 * `file.changed-on-disk`, with the same message and details as `readUnchanged`, when the file as read
 * for the write (`current`, which `readUnchanged` found equal to the store) no longer has the
 * SHA-256 the caller's change was made on. The element store is not reset: it already holds the file
 * as it is, only the caller's hash is old (N-036). A precondition on the bytes, not the version
 * (ADR-0005): a change of the title, the status or a property that does not count to the version is
 * caught too.
 */
const expectedFile = (record: ElementRecord, current: ReadElement, expected: string | undefined): void => {
  if (expected !== undefined && expected !== current.file.snapshot.sha256) {
    throw changedOnDisk(record);
  }
};

/**
 * `readUnchanged` for the records of many items at once, in their order, for a command that changes many
 * elements (`element.bulkUpdate`): the files of each repository are read `readElementFiles` style,
 * several at a time, and then checked one by one, so the first file that changed on disk throws
 * `file.changed-on-disk` (and resets the element store) as `readUnchanged` does.
 */
export const readAllUnchanged = async <T extends { readonly record: ElementRecord }>(
  workspace: Workspace,
  layout: WorkspaceLayout,
  items: readonly T[],
): Promise<(T & UnchangedElement)[]> => {
  const records = items.map((item) => item.record);
  const placeOf = (repository: string, file: string): string => JSON.stringify([repository, file]);
  const read = new Map<string, ParsedFile>();
  for (const name of new Set(records.map((r) => r.repository))) {
    const repository = targetRepository(layout, name);
    const files = await readElementFiles(
      repository.folder,
      records.filter((r) => r.repository === name).map((r) => r.file),
    );
    for (const file of files.files) {
      read.set(placeOf(name, file.path), file);
    }
  }
  const out: (T & UnchangedElement)[] = [];
  for (const item of items) {
    const { record } = item;
    const repository = targetRepository(layout, record.repository);
    // Gone, faulty or no longer an element: changed on disk.
    const file = read.get(placeOf(record.repository, record.file));
    const current = file === undefined ? undefined : asElement(record.repository, file);
    out.push({ ...item, ...(await unchanged(workspace, record, repository, current)) });
  }
  return out;
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
 * Restores files `writeElementFiles` wrote, for a command whose later step failed (`reqif.import`,
 * ADR-0013 "Import"): each is written back with its bytes as read, only while it still holds what
 * the call wrote, newest first. Returns the files (relative to the workspace root) it could not
 * restore. The caller resets the element store afterwards.
 */
export const restoreElementFiles = async (
  writes: readonly (readonly [ElementFileWrite, WrittenElementFile])[],
): Promise<string[]> => {
  const kept: string[] = [];
  for (const [write, { written, file }] of [...writes].reverse()) {
    if (!(await restore({ write, snapshot: written.file.snapshot, file }))) {
      kept.unshift(file);
    }
  }
  return kept;
};

export interface WriteFilesOptions {
  /**
   * The metamodel and the element store the command read and checked its writes against: the
   * stored titles of relation targets are refreshed from them (`withCurrentTitles`).
   */
  readonly titles: TitleContext;
  /**
   * Files written at the same time; default 1, one after the other. Each write syncs the file and
   * its folder to disk (`writeFileAtomic`), so a command that writes many files (`element.bulkUpdate`)
   * writes several at once; the rollback is the same.
   */
  readonly concurrency?: number;
}

/**
 * Writes several existing element files, for commands that change more than one element
 * (`element.setStatus`, `element.supersede`, `element.bulkUpdate`), one at a time or, with
 * `options.concurrency`, several at a time; after the first failure no further write starts and
 * the writes in flight end before the rollback. Every check must be done before. Each planned
 * file that changes also gets the current titles of its same-repository relation targets
 * (`withCurrentTitles`, decision on #307): only those title values change. A write can still be
 * refused (`file.read-only`, a file changed in the meantime, a disk error), or written bytes may
 * not read back as an element (`internal`); then every file this call has written is written back
 * with its bytes as read (best effort; nothing is deleted) and the error is thrown again with its
 * code. `details.written` lists the files not restored
 * (relative to the workspace root); it is absent when every file was restored. After the writes
 * the element store gets all written files in place (`recordWrites`, #166); after a failure it is
 * reset, so the next read finds the files as they are.
 */
export const writeElementFiles = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  writes: readonly ElementFileWrite[],
  options: WriteFilesOptions,
): Promise<WrittenElementFile[]> => {
  const done: DoneWrite[] = [];
  const results: WrittenElementFile[] = [];
  // The first failure; once there is one, no further write starts.
  let failure: { readonly error: unknown } | undefined;
  // The stored titles of same-repository targets follow their targets (decision on #307).
  const titled = withCurrentTitles(options.titles, writes);
  const queue = titled.entries();
  const worker = async (): Promise<void> => {
    for (const [index, write] of queue) {
      if (failure !== undefined) {
        return;
      }
      try {
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
        results[index] = {
          written: writtenElement(repository.name, bytes, snapshot),
          replaced: current.file.snapshot,
          file,
        };
      } catch (error) {
        // Several writes can fail at once; the first is reported.
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 1, titled.length) }, worker));
  if (failure !== undefined) {
    const { error } = failure;
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
 * changed since the element store read it; the store is then read again on the next call. Also
 * refused, before anything is planned and without reading the store again, when the caller gives
 * `expectedFileSha256` and the file no longer has it (SR-106, `expectedFile`), even when the input
 * would change nothing. `repository` picks one copy of a duplicate as in `element.get` (`resolveRef`,
 * #255). `fileSha256` is the SHA-256 of the file as written, or as read when nothing changed. A save
 * that writes the file also sets the stored titles of its same-repository relation targets to their
 * current titles (`withCurrentTitles`, decision on #307); a save that changes nothing writes nothing.
 * `affected`: the number of directly affected elements when the version changed (SR-024 AK2, AK3).
 */
export const updateElement = async (
  workspace: Workspace,
  input: UpdateElementInput,
  extraFindings?: ElementHints,
  check?: WriteCheck,
): Promise<UpdateElementResult> => {
  const context = await contextOf(workspace);
  const { layout, metamodel, store } = context;
  const shortIds = await workspace.get(shortIdState);
  const record = resolveRef(store, shortIds, input.ref, { repository: input.repository });
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
  // Before the file is read: a choice value that is no choice is refused at once.
  const given = withChoiceKeys(metamodel, Object.entries(input.set ?? {}), "set");
  const { repository, current } = await readUnchanged(workspace, layout, record);
  expectedFile(record, current, input.expectedFileSha256);
  const set = await withTargets(context, record.repository, given, current.record.data);
  const text =
    input.text === undefined
      ? undefined
      : await setInlineReferences(context, input.text, elementText(current.file.body), record.repository);
  const edited = editElementFile(current.file, {
    edits: updateEdits(input, set, titleKey),
    ...(text === undefined ? {} : { body: bodyForText(current.file.body, text) }),
    keyOrder: type.properties,
  });
  let result: ElementWriteResult & { readonly affected?: number };
  let fileSha256 = current.file.snapshot.sha256;
  if (edited.changed) {
    // The stored titles of same-repository targets follow their targets (decision on #307).
    let { bytes } = edited;
    for (const titled of withCurrentTitles(context, [{ repository, current, bytes }])) {
      ({ bytes } = titled);
    }
    await refuseByCheck(check, repository.name, bytes, current.file.snapshot, record.type);
    const before: Before = {
      // The record of the store: its own relations to itself are no affected element.
      record,
      content: await contentBefore(context, repository, current),
    };
    const written = writtenElement(
      repository.name,
      bytes,
      await writeFileAtomic(repository.folder, record.file, decode(bytes), record.snapshot),
    );
    fileSha256 = written.file.snapshot.sha256;
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
  return { ...result, affected: result.affected ?? 0, fileSha256 };
};
