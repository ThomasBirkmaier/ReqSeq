// The types and helpers the steps of the plan of `reqif.import` share: the plan, a draft of one
// element, the context of a planning step, the file's index and the mapping's coverage. Part of
// import.ts, whose file comment says what the plan does; "the file comment" here means that one.
import { withCriterionKeys } from "../model/acceptance-criteria.js";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { Problem } from "../catalog.js";
import type { FileEditResult, FrontmatterEdit, PropertyValue, ScalarValue } from "../files/index.js";
import { bodyForText, editElementFile } from "../files/index.js";
import type { MetamodelProperty, ReqifLoss, ReqifObject, ReqifUnmapped } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { allowsType } from "../metamodel/index.js";
import type { NewElementBase, NewElementFile, VersionForms } from "../model/index.js";
import { fileNameFor, newElementBytes } from "../model/index.js";
import type { ElementFileWrite } from "../model/write.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import type { AnyMapping } from "./mapping.js";
import type { ExistingElement, ExistingElements } from "./repeat.js";
import type {
  ReqifAttributeDefinition,
  ReqifDatatype,
  ReqifFile,
  ReqifIdentifiable,
  ReqifSpecType,
} from "./model.js";
import type { OriginKeys } from "./origin.js";
import type { ImageFile, ImageNames, ImageReader } from "./images.js";

/** A copy of an image in the image folder of an element. */
export interface PlannedImage {
  /** The element file name without `.md`. */
  readonly stem: string;
  readonly name: string;
  readonly file: ImageFile;
}

/** What `planImport` gives: the files to write and what the output lists. */
export interface ImportPlan {
  readonly repository: RepositoryLocation;
  /** The target folder relative to the repository, `/` as separator. */
  readonly folder: string;
  readonly files: readonly NewElementFile[];
  /** The copies of the images the texts embed: `name` in the image folder `stem` of an element (SR-095 AK2). */
  readonly images: readonly PlannedImage[];
  readonly created: readonly ReqifObject[];
  readonly losses: readonly ReqifLoss[];
  /** The writes into elements of an earlier delivery (SR-056): from the delivery (update, take) or only the origin (keep). */
  readonly updates: readonly PlannedUpdate[];
  /** The copies of the images the texts of updated elements embed, into each one's image folder. */
  readonly updateImages: readonly PlannedUpdateImage[];
  /** Every element the delivery changes (SR-056 AK1), conflicts included. */
  readonly changed: readonly ReqifObject[];
  /** The changed elements that were also changed locally (SR-056 AK4). */
  readonly conflicts: readonly ReqifObject[];
  /** The elements of the source the delivery no longer has (SR-056 AK3). */
  readonly dropped: readonly ReqifObject[];
  /**
   * Warnings: `reqif.edited-elsewhere` for an object of a file of ReqSeq another tool changed,
   * `reqif.replaces-local` and `reqif.choice-unused`.
   */
  readonly problems: readonly Problem[];
}

/** A write into an element of an earlier delivery. */
export interface PlannedUpdate {
  readonly identifier: string;
  readonly id: string;
  readonly kind: "updated" | "kept";
  readonly write: ElementFileWrite;
}

/** A copy of an image into the image folder of an updated element. */
export interface PlannedUpdateImage {
  readonly repository: RepositoryLocation;
  /** Relative to the repository, `/` as separator. */
  readonly file: string;
  readonly name: string;
  readonly image: ImageFile;
}

/** `take` or `keep` for each conflict, by source IDENTIFIER. */
export type ConflictChoices = ReadonlyMap<string, "take" | "keep">;

/** What a repeated delivery adds to the plan: the elements of the source and, for an import, the choices. */
export interface RepeatOptions {
  readonly existing: ExistingElements;
  /**
   * The choice for each conflict, with the warnings for entries that name none; undefined for a
   * preview (`reqif.analyze`), which lists the conflicts instead of refusing.
   */
  readonly choose?: (conflicts: readonly ReqifObject[]) => {
    readonly choices: ConflictChoices;
    readonly problems: readonly Problem[];
  };
}

/** What the import itself writes into the origin of each element besides the source and IDENTIFIER. */
export interface ImportOrigin {
  /** The name of the delivery (input `delivery`). */
  readonly delivery: string;
  /** The import date, `YYYY-MM-DD` (`importDate`). */
  readonly date: string;
}

export type AttributeEntry = NonNullable<AnyMapping["attributes"]>[number];

export const nameOf = (item: ReqifIdentifiable): string => item.longName ?? item.identifier;
export const matches = (source: string | undefined, item: ReqifIdentifiable): boolean =>
  source === item.identifier || source === item.longName;

export const invalidFile = (message: string, line: number): CommandError =>
  new CommandError("reqif.invalid", `file: ${message}`, { fields: ["file"], line });

/** The file's definitions by IDENTIFIER. */
export interface Index {
  readonly types: ReadonlyMap<string, ReqifSpecType>;
  readonly attributes: ReadonlyMap<
    string,
    { readonly type: ReqifSpecType; readonly a: ReqifAttributeDefinition }
  >;
  readonly datatypes: ReadonlyMap<string, ReqifDatatype>;
  /** The IDENTIFIERs of the SPEC-OBJECTs. */
  readonly objects: ReadonlySet<string>;
}

/** The file's definitions; the parser refused an IDENTIFIER used twice (ReqIF 1.2 §10.8.32). */
export const indexOf = (file: ReqifFile): Index => {
  const attributes = new Map<
    string,
    { readonly type: ReqifSpecType; readonly a: ReqifAttributeDefinition }
  >();
  for (const type of file.specTypes) {
    for (const a of type.attributes) {
      attributes.set(a.identifier, { type, a });
    }
  }
  return {
    types: new Map(file.specTypes.map((t) => [t.identifier, t])),
    attributes,
    datatypes: new Map(file.datatypes.map((d) => [d.identifier, d])),
    objects: new Set(file.specObjects.map((o) => o.identifier)),
  };
};

/** The datatype of `a`, which the file must define. */
export const datatypeOf = (index: Index, a: ReqifAttributeDefinition): ReqifDatatype => {
  const datatype = index.datatypes.get(a.datatype);
  if (datatype === undefined) {
    throw invalidFile(
      `attribute ${a.identifier} refers to datatype ${a.datatype}, which the file does not define`,
      a.line,
    );
  }
  return datatype;
};

/** What the mapping makes of the file's types and attributes, by IDENTIFIER; undefined: omitted. */
export interface Coverage {
  /** Each attribute's entry, with the definition of its property (undefined: `title`, `text`, omitted). */
  readonly attributes: Map<
    string,
    { readonly entry: AttributeEntry; definition?: MetamodelProperty | undefined }
  >;
  /** The own type of each SPEC-OBJECT-TYPE. */
  readonly types: Map<string, string | undefined>;
  /** The index of the mapping entry of each mapped SPEC-OBJECT-TYPE. */
  readonly typeEntries: Map<string, number>;
  /** The relation kind of each SPEC-RELATION-TYPE. */
  readonly relations: Map<string, string | undefined>;
  readonly unmapped: ReqifUnmapped[];
  /** Attribute entries whose property cannot hold the attribute. */
  readonly wrong: { readonly field: string; readonly message: string }[];
}

/** One element being planned. */
export interface Draft {
  readonly identifier: string;
  readonly id: string;
  readonly base: NewElementBase;
  title: string;
  text: string;
  readonly properties: Map<string, PropertyValue>;
  readonly relations: Map<string, Record<string, ScalarValue>[]>;
  /** Of a file of ReqSeq: the relation kinds as `reqseq-values` holds them; set: its SPEC-RELATIONs are not read. */
  ownRelations?: Map<string, PropertyValue>;
  /** A relation-valued property took a target from a SPEC-RELATION, so the version is planned again. */
  relationProperties?: true;
  /** The planned version (`plannedVersions`) as written, set once the values are planned. */
  version: string;
  /** The planned version in both normal forms (P), set with `version`. */
  planned: VersionForms;
  /** The workspace name of its repository. */
  readonly repository: string;
  /** The element of an earlier delivery it updates (SR-056). */
  readonly existing?: ExistingElement;
  /** Its current version (C) when it is such an element, else empty. */
  readonly current: string;
  /** The property keys the mapping maps for its type (removed when the delivery has no value). */
  readonly mapped: readonly string[];
  /** Those of them that do not count to the version (D-057). */
  readonly uncounted: readonly string[];
  /** What the repeated delivery does with an existing element; `new` for a new one. */
  case: "new" | "update" | "conflict" | "local" | "same";
  /** Whether the delivery's content is written (new, update, take, same); else relations get its current version. */
  deliveryWins: boolean;
  /** The file name without `.md`, which is also the name of its image folder. */
  readonly stem: string;
  /** The images copied next to it. */
  readonly images: ImageNames;
  /** The images the text embeds, which count to the version (D-057). */
  readonly textImages: Map<string, string>;
}

export type Loss = (code: ReqifLoss["code"], reason: string) => void;

/**
 * The file of a draft, with its relations or without them (for its planned version); each
 * acceptance criterion with its criterion key (SR-204 AK1).
 */
export const fileOf = (
  metamodel: Metamodel,
  draft: Draft,
  folder: string,
  withRelations: boolean,
): NewElementFile => ({
  file: path.posix.join(folder, fileNameFor({ prefix: draft.base.type.prefix, id: draft.id })),
  bytes: newElementBytes(draft.base, draft.id, draft.title, draft.text, [
    ...[...draft.properties].map(
      ([key, value]) => [key, withCriterionKeys(metamodel, key, undefined, value)] as const,
    ),
    ...(withRelations ? [...draft.relations, ...(draft.ownRelations ?? [])] : []),
  ]),
});

/** What one planning step needs. */
export interface Context {
  readonly index: Index;
  readonly coverage: Coverage;
  readonly metamodel: Metamodel;
  readonly losses: ReqifLoss[];
  readonly keys: OriginKeys;
  readonly source: string;
  readonly origin: ImportOrigin;
  /** The new UUID of each object that becomes an element, by IDENTIFIER. */
  readonly ids: ReadonlyMap<string, string>;
  /** A file of ReqSeq (see the file comment). */
  readonly own: boolean;
  readonly problems: Problem[];
  /** Relation items that name an object of this call, whose version is set once all are planned. */
  readonly pending: Map<string, Record<string, ScalarValue>[]>;
  /** Of a file of ReqSeq: the targets of the SPEC-RELATIONs of each object, as `<type>|<target>`. */
  readonly ownRelationsOf: ReadonlyMap<string, ReadonlySet<string>>;
  /** Of a file of ReqSeq: the `reqseq-values` of each object whose channels are not taken, if JSON. */
  readonly stored: Map<string, Readonly<Record<string, unknown>>>;
  /** Of a file of ReqSeq: the types whose mapping (with the relation types) is the one-to-one one. */
  readonly oneToOne: ReadonlySet<string>;
  readonly images: ImageReader;
  readonly layout: WorkspaceLayout;
  readonly mapping: AnyMapping;
  readonly existing: ExistingElements;
}
/** The version a relation to `draft` carries: P when the delivery is written into it, else its current one (C). */
export const targetVersion = (draft: Draft): string => (draft.deliveryWins ? draft.version : draft.current);

/**
 * The file of an existing element with the delivery's title, text, mapped properties and origin
 * (`omit`: origin keys left as they are), plus `extra` edits; only changed keys are rewritten. The
 * acceptance criteria keep their criterion keys by text, and unchanged texts change nothing
 * (`reconcileCriteria`, SR-204 AK4).
 */
export const updatedFile = (
  metamodel: Metamodel,
  draft: Draft,
  existing: ExistingElement,
  extra: readonly FrontmatterEdit[],
  omit: readonly string[] = [],
): FileEditResult => {
  const { file } = existing.current;
  const removed = draft.mapped.filter((key) => !draft.properties.has(key));
  return editElementFile(file, {
    edits: [
      { kind: "set", key: draft.base.titleKey, value: draft.title },
      ...[...draft.properties]
        .filter(([key]) => !omit.includes(key))
        .map(([key, value]): FrontmatterEdit => ({
          kind: "set",
          key,
          value: withCriterionKeys(metamodel, key, existing.record.data[key], value),
        })),
      ...removed
        .filter((key) => existing.record.data[key] !== undefined)
        .map((key): FrontmatterEdit => ({ kind: "remove", key })),
      ...extra,
    ],
    body: bodyForText(file.body, draft.text),
    keyOrder: draft.base.type.properties,
  });
};

/** A value as its items: a list as it is, one value as one item, none as none. */
export const itemsOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

/** Whether the relation kind `kind` may lead from the type of `source` to that of `target`. */
export const allowed = (metamodel: Metamodel, kind: string, source: Draft, target: Draft): boolean => {
  const rule = metamodel.relations.find((r) => r.key === kind);
  return (
    allowsType(rule?.["source-types"], source.base.type.key, metamodel) &&
    allowsType(rule?.["target-types"], target.base.type.key, metamodel)
  );
};
