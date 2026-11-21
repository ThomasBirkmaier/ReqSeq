// The plan of `reqif.import` (SR-053, ADR-0013 "Import"): what a parsed ReqIF file gives through a
// mapping, in memory, before any file is written.
//
// - Mapping: a type, attribute or relation type of the file is matched by LONG-NAME or IDENTIFIER;
//   an attribute entry with `source-type` wins over one without. Every SPEC-OBJECT-TYPE, every
//   attribute of a mapped type, every SPEC-RELATION-TYPE and every enumeration value of an attribute
//   mapped to a choice must be mapped or omitted, else `reqif.unmapped` with the list (SR-055). An
//   attribute whose datatype the property cannot hold is `input.invalid` at its mapping entry.
// - Elements: one per SPEC-OBJECT whose type is mapped, with a new UUID (D-056), the initial status
//   of its type (D-030), the title from the attribute mapped to `title` (else LONG-NAME, else
//   IDENTIFIER), the text from the attribute mapped to `text` (XHTML as Markdown, `xhtmlToMarkdown`, SR-095) and the
//   mapped properties: INTEGER and REAL as number, DATE as its date, ENUMERATION as the choice keys
//   of `values`, and every datatype as text in `title`, `text` and a text property (enumeration
//   values by name).
// - Relations: one entry per SPEC-RELATION of a mapped type whose two ends are imported, on the
//   element of its SOURCE, with the planned version of its TARGET (`plannedVersions`; relation kinds
//   do not count to a version, ADR-0005).
// - Losses (SR-053 AK2), with the codes of `common.schema.json#/$defs/reqifLoss`: an object of an
//   omitted type, a value of an omitted attribute or an omitted enumeration value, a number or date
//   not in its lexical form, a date whose time is not midnight, XHTML elements without plain form,
//   a relation whose type is omitted or whose other end is not imported, values of relations and
//   specifications, a duplicate relation, a relation the metamodel does not allow, the SPEC-
//   HIERARCHY (once per SPECIFICATION that has one), a relation in a RELATION-GROUP (the group is not
//   imported) and every part of an imported object the parser
//   did not read. A DEFAULT-VALUE is the value of an object without its own (ReqIF 1.2 §10.8.3).
//   A reference the import does not need that the file does not define (the type or an end of a
//   SPEC-RELATION, an attribute of a value of a relation or specification) is such a loss whose
//   reason says "not in the file"; one it needs (the type of a SPEC-OBJECT, an attribute of its
//   values, the datatype of a mapped attribute) is `reqif.invalid`.
// - Origin (SR-057 AK1): each element gets the source name of the mapping, the object's IDENTIFIER,
//   the import date, the delivery and the import version: the element's planned version as written
//   (D-059; `import-version` never counts to it). A mapping that maps a SPEC-OBJECT-TYPE to a type
//   without all five origin properties is refused with `input.invalid` at that entry.
// - Never from the delivery: `id`, `type`, `status`, the title key (D-030) and the origin
//   properties (SR-057 AK3; `propertyKeyRefusal`).
// - Files go into the mapping's `target`, else a folder named after the source in the main
//   repository (SR-053 AK1). The own metamodel is only read (SR-054 AK3).
// - A file of ReqSeq (`own`, SR-052 AK3; ADR-0013 "Import"): a SPEC-OBJECT without values is a stub
//   and never an element. For a type whose mapping, relation types included, is the one-to-one one
//   (`oneToOneTypes`), an object whose readable values `readableValues` (own.ts) writes again from
//   `reqseq-markdown` and `reqseq-values` equal to the file's (relation-valued properties, whose
//   short IDs depend on the workspace, aside), whose SPEC-RELATIONs of the kinds the metamodel
//   knows are those of `reqseq-values` (one of another kind is an `omitted-type` loss) and whose
//   text has as many images takes the title, the text byte for byte (its image links
//   pointed at the copies), the properties of its type and the relations from those two; the status
//   and the origin stored there are not taken, and a relation the metamodel does not allow is a
//   loss (`checkOwnRelations`). The acceptance criteria keep the criterion keys stored there
//   (SR-204 AK12); a key there not in its form, or on two criteria, is `reqif.invalid` naming
//   the SPEC-OBJECT (AK5). Otherwise another tool changed it, or a mapping differs: the
//   readable attributes and SPEC-RELATIONs are imported through the mapping, with a warning
//   `reqif.edited-elsewhere` for a changed object. A target of a relation or relation-valued
//   property that is imported in this call becomes that element with its planned version (so the
//   version of a relation-valued property naming it is new, spec question #565); any other target
//   stays as stored, a missing target with its stored version (N-041, D-045, D-058). Not yet: a
//   target of an earlier delivery or of the workspace (ADR-0013 steps 2 and 3); the links of
//   reference-style images.
// - A repeated delivery (SR-056, `repeat.ts`): an object whose element an earlier delivery made
//   (same source and source IDENTIFIER) keeps that element, its UUID and its file. Its planned
//   version P (the file with the delivery's fields, `editElementFile`) is compared with the stored
//   import version I and the current version C: *changed* when P differs from I, a *conflict* when
//   C differs from both; changed only locally (P = I, C differs) leaves it as it is (#575/1), and
//   with neither changed it is written only when its mapped fields or relations differ from the
//   file, with a `reqif.replaces-local` warning (#575/3, #575/4). A conflict needs `take` or `keep`
//   (`reqif.conflict` otherwise); `keep` writes only the origin with P as import version (#575/6).
//   Relations to such an element carry P when the delivery is written into it, else C.
import { randomUUID } from "node:crypto";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { WorkspaceLocation } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { NewElementBase, VersionForms } from "../model/index.js";
import { NORMAL_FORM, fileNameFor, newElementBase, plannedVersions, portableName } from "../model/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { locate } from "../workspace/index.js";
import type { AnyMapping } from "./mapping.js";
import type { ExistingElement } from "./repeat.js";
import { NO_EXISTING } from "./repeat.js";
import type { ReqifFile, ReqifSpecObject, ReqifSpecType } from "./model.js";
import { originKeys } from "./origin.js";
import { STATEMENT_TYPE } from "./statements.js";
import type { ImageReader } from "./images.js";
import { ImageNames } from "./images.js";
import { fileOf, indexOf, invalidFile, nameOf, targetVersion, updatedFile } from "./import-context.js";
import type { Context, Draft, ImportOrigin, ImportPlan, RepeatOptions } from "./import-context.js";
import { checkCoverage } from "./import-coverage.js";
import { planValues } from "./import-values.js";
import {
  checkOwnRelations,
  oneToOneTypes,
  ownChannels,
  planOwnValues,
  relationsBySource,
} from "./import-own.js";
import { planRelation, relationGroupLosses, specificationLosses, unreadLosses } from "./import-relations.js";
import { classify, matchedElement, planUpdates } from "./import-updates.js";

export type {
  PlannedImage,
  ImportPlan,
  PlannedUpdate,
  PlannedUpdateImage,
  ConflictChoices,
  RepeatOptions,
  ImportOrigin,
} from "./import-context.js";

/** The empty draft of `object`: a new element, or the element of an earlier delivery with its UUID, file name and images. */
const draftOf = (
  context: Context,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  base: NewElementBase,
  id: string,
  existing: ExistingElement | undefined,
  repository: RepositoryLocation,
): Draft => {
  const images = new ImageNames();
  for (const { name, sha256 } of existing?.images ?? []) {
    images.reserve(name, sha256);
  }
  // The property each attribute of the type is mapped to, when it is one (not title, text or omitted).
  const mapped = t.attributes.flatMap((a) => {
    const definition = context.coverage.attributes.get(a.identifier)?.definition;
    return definition === undefined ? [] : [definition];
  });
  const file =
    existing === undefined
      ? fileNameFor({ prefix: base.type.prefix, id })
      : path.posix.basename(existing.record.file);
  return {
    identifier: object.identifier,
    id,
    base,
    title: nameOf(object),
    text: "",
    properties: new Map(),
    relations: new Map(),
    version: "",
    planned: { n1: "", n2: "" },
    stem: file.slice(0, -".md".length),
    images,
    textImages: new Map(),
    repository: existing?.record.repository ?? repository.name,
    ...(existing === undefined ? {} : { existing }),
    current: existing === undefined ? "" : String(existing.version),
    mapped: mapped.map((d) => d.key),
    uncounted: mapped.filter((d) => d.content !== true).map((d) => d.key),
    case: "new",
    deliveryWins: true,
  };
};

/**
 * The planned version of `draft` (`plannedVersions`): of its new file in `folder`, or of the file of
 * its existing element with the delivery's fields.
 */
const versionOf = async (
  context: Context,
  draft: Draft,
  repository: RepositoryLocation,
  folder: string,
): Promise<VersionForms> => {
  const { existing } = draft;
  return plannedVersions(
    context.metamodel,
    context.layout,
    existing?.repository ?? repository,
    existing === undefined
      ? fileOf(context.metamodel, draft, folder, false)
      : { file: existing.record.file, bytes: updatedFile(context.metamodel, draft, existing, []).bytes },
    draft.textImages,
  );
};

/**
 * Sets the planned version of `draft` and its import version, the version as written (D-059; it
 * never counts to it).
 */
const setPlanned = (draft: Draft, planned: VersionForms, key: string): void => {
  draft.planned = planned;
  draft.version = planned[NORMAL_FORM];
  draft.properties.set(key, draft.version);
};

/** The draft of `object`, or undefined when its type is omitted (a loss). */
const planObject = async (
  context: Context,
  repository: RepositoryLocation,
  folder: string,
  object: ReqifSpecObject,
): Promise<Draft | undefined> => {
  const t = context.index.types.get(object.type);
  if (t?.category !== "spec-object") {
    throw invalidFile(
      `SPEC-OBJECT ${object.identifier} refers to type ${object.type}, which the file does not define`,
      object.line,
    );
  }
  if (context.own && object.values.length === 0) {
    // A stub of a file of ReqSeq: a target outside its export, never an element.
    return undefined;
  }
  const ownType = context.coverage.types.get(t.identifier);
  // Every object of a mapped type that is no stub has its UUID.
  const id = context.ids.get(object.identifier);
  if (ownType === undefined || id === undefined) {
    context.losses.push({
      identifier: object.identifier,
      kind: "spec-object",
      code: "omitted-type",
      reason:
        context.own && t.identifier === STATEMENT_TYPE
          ? "a statement of a statements export of ReqSeq is not imported: the import takes no statement back into the element it answers"
          : `the mapping omits its type ${nameOf(t)}`,
    });
    return undefined;
  }
  const base = newElementBase(context.metamodel, ownType, "reqif.import");
  const { keys } = context;
  const existing = matchedElement(context, object, t, ownType);
  const draft = draftOf(context, object, t, base, id, existing, repository);
  const channels =
    context.own && context.oneToOne.has(t.identifier) ? ownChannels(context, object, t, ownType) : undefined;
  if (channels === undefined) {
    await planValues(context, object, t, draft);
  } else {
    await planOwnValues(context, channels, object, t, draft);
  }
  draft.properties.set(keys.source, context.source);
  draft.properties.set(keys["source-identifier"], object.identifier);
  draft.properties.set(keys["import-date"], context.origin.date);
  draft.properties.set(keys.delivery, context.origin.delivery);
  setPlanned(draft, await versionOf(context, draft, repository, folder), keys["import-version"]);
  return draft;
};

/**
 * The versions once every relation is planned: again for a draft whose relation-valued properties
 * changed (`replanVersions`), then, once the existing elements are sorted (`classify`), in every
 * relation item that names a draft of this call (`pending`, `settleVersions`).
 */
const replanVersions = async (
  context: Context,
  drafts: ReadonlyMap<string, Draft>,
  repository: RepositoryLocation,
  relative: string,
): Promise<void> => {
  for (const draft of drafts.values()) {
    if (draft.relationProperties === true) {
      setPlanned(
        draft,
        await versionOf(context, draft, repository, relative),
        context.keys["import-version"],
      );
    }
  }
};

/** Sets the version of each relation item that names a draft of this call (`targetVersion`). */
const settleVersions = (context: Context, drafts: ReadonlyMap<string, Draft>): void => {
  for (const draft of drafts.values()) {
    for (const item of context.pending.get(draft.id) ?? []) {
      item["version"] = targetVersion(draft);
    }
  }
};

/**
 * The plan of importing `file` through `mapping` as delivery `origin`, reading the images it embeds
 * with `images` (see the file comment).
 */
export const planImport = async (
  file: ReqifFile,
  mapping: AnyMapping,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  origin: ImportOrigin,
  images: ImageReader,
  own = false,
  repeat: RepeatOptions = { existing: NO_EXISTING },
): Promise<ImportPlan> => {
  const keys = originKeys(metamodel);
  const index = indexOf(file);
  const coverage = checkCoverage(file, index, mapping, metamodel, keys);
  const location: WorkspaceLocation = mapping.target ?? {
    repository: layout.main,
    path: portableName(mapping.source.name, "source"),
  };
  const { repository, folder } = locate(layout, location);
  if (repository === undefined || folder === undefined) {
    throw new CommandError(
      "file.folder-missing",
      `Not imported: the target folder is in repository ${location.repository}, which is not available on this machine`,
      { repository: location.repository },
    );
  }
  const relative = path.relative(repository.folder, folder).split(path.sep).join("/");
  const ids = new Map(
    file.specObjects.flatMap((o) => {
      const mapped = coverage.types.get(o.type) !== undefined;
      // An element of an earlier delivery keeps its UUID (SR-056).
      const id = repeat.existing.matched.get(o.identifier)?.record.id ?? randomUUID();
      return mapped && !(own && o.values.length === 0) ? [[o.identifier, id] as const] : [];
    }),
  );
  const context: Context = {
    index,
    coverage,
    metamodel,
    losses: [],
    keys,
    source: mapping.source.name,
    origin,
    ids,
    own,
    problems: [],
    pending: new Map(),
    ownRelationsOf: own ? relationsBySource(file) : new Map(),
    stored: new Map(),
    oneToOne: own ? oneToOneTypes(file, coverage, metamodel, mapping.source.name, keys) : new Set(),
    images,
    layout,
    mapping,
    existing: repeat.existing,
  };
  const drafts = new Map<string, Draft>();
  for (const object of file.specObjects) {
    const draft = await planObject(context, repository, relative, object);
    if (draft !== undefined) {
      drafts.set(object.identifier, draft);
    }
  }
  checkOwnRelations(context, drafts);
  for (const relation of file.specRelations) {
    planRelation(context, drafts, relation);
  }
  await replanVersions(context, drafts, repository, relative);
  const { changed, conflicts, choices } = classify(context, drafts, repeat);
  settleVersions(context, drafts);
  specificationLosses(context, file);
  relationGroupLosses(context, file, drafts);
  unreadLosses(file, drafts, context.losses);
  const all = [...drafts.values()].filter((d) => d.existing === undefined);
  const updates = planUpdates(context, drafts, choices);
  return {
    repository,
    folder: relative,
    files: all.map((d) => fileOf(context.metamodel, d, relative, true)),
    images: all.flatMap((d) => d.images.files.map(({ name, file }) => ({ stem: d.stem, name, file }))),
    created: all.map((d) => ({ identifier: d.identifier, id: d.id })),
    losses: context.losses,
    ...updates,
    changed,
    conflicts,
    dropped: repeat.existing.dropped,
    problems: context.problems,
  };
};
