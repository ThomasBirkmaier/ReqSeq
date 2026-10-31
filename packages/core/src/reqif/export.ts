// The plan of `reqif.export` (SR-052, ADR-0013 "Export"): the ReqIF model of a list of elements, in
// memory, for `writeReqif`. Pure: the command reads the elements and their texts and writes the file.
//
// - Header: IDENTIFIER `_hd-<uuid>`, TITLE the workspace name, REQ-IF-TOOL-ID `reqseq`,
//   SOURCE-TOOL-ID `ReqSeq <version>`; CREATION-TIME and every LAST-CHANGE the one export time.
// - Datatypes: those the attributes use. `_dt-string` has MAX-LENGTH the longest STRING value in
//   characters (code points), at least 1; `_dt-real` the finite extremes of a double and ACCURACY
//   15; an enumeration `_dt-enum.<property>` its choices (status: the statuses) in metamodel order,
//   KEY the 0-based index, OTHER-CONTENT empty, LONG-NAME the key.
// - Spec types: `_ot-<type>` for the type of each exported element with its attributes (own.ts),
//   in metamodel order, then the types of stubs without attributes (`_ot.missing` last), then
//   `_rt-<key>` for each relation kind and relation-valued property used, in metamodel order (kinds
//   first), then `_st-specification`.
// - SPEC-OBJECTs: each element `_<uuid>` in the order of the list (SR-052 AK1, AK2), LONG-NAME its
//   title, with its readable values and both round-trip attributes; then a stub per relation target
//   outside the export (IDENTIFIER and type, no values), in the order first named.
// - SPEC-RELATIONs (SR-052 AK2): each item with a UUID of a relation kind or a relation-valued
//   property (validity, packages; also a readable STRING of short IDs) of an exported element, in the
//   order of the elements and of `ownRelationKeys`, as `_sr-<hash of source, key, target>`; a
//   relation named twice is written once.
// - One flat SPECIFICATION `_sp-<hash of the list>` with a SPEC-HIERARCHY `_sh-<uuid>` per element.
import { createHash } from "node:crypto";
import type { Metamodel } from "../metamodel/index.js";
import { findType } from "../metamodel/index.js";
import type { ElementRecord, TargetItem } from "../model/index.js";
import { hasId, isUuid, relationItems, titleKeyOrEmpty } from "../model/index.js";
import type { OwnAttribute } from "./own.js";
import {
  MISSING_TYPE,
  OWN_DATATYPES,
  OWN_TOOL_ID,
  ownAttributes,
  ownDefinitions,
  ownId,
  readableValues,
} from "./own.js";
import type { ReqifWritable } from "./write.js";

/** One element to export: its record, the text of its file and the `data` of each image copy by link path. */
export interface ExportedElement {
  readonly record: ElementRecord;
  readonly text: string;
  readonly images: ReadonlyMap<string, string>;
}

export interface ExportInput {
  readonly metamodel: Metamodel;
  /** The workspace name, the header TITLE. */
  readonly title: string;
  /** The export time, `YYYY-MM-DDThh:mm:ssZ`. */
  readonly time: string;
  /** A new UUID for the header IDENTIFIER. */
  readonly header: string;
  /** SOURCE-TOOL-ID, `ReqSeq <version>`. */
  readonly sourceToolId: string;
  /** In the order of the list. */
  readonly elements: readonly ExportedElement[];
  /** The type of a relation target outside the export; undefined when its element is missing. */
  readonly targetType: (source: ElementRecord, item: TargetItem) => string | undefined;
  /** The short ID of a target of a relation-valued property. */
  readonly shortId: (source: ElementRecord, item: TargetItem) => string;
  /** The `data` of the `object` of an image link of the text of `element`, relative to the output. */
  readonly image: (element: ExportedElement, url: string) => string;
}

export interface ExportPlan {
  readonly file: ReqifWritable;
  /** The SPEC-RELATIONs written. */
  readonly relations: number;
}

type Writable = ReqifWritable;
type SpecObject = Writable["specObjects"][number];
type SpecRelation = Writable["specRelations"][number];

/** The first 128 bits of the SHA-256 of `parts`, one per line, as hex. */
const hash = (...parts: readonly string[]): string =>
  createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32);

/** Code points: a surrogate pair is one character, as MAX-LENGTH counts. */
const characters = (text: string): number => text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;

/** The datatypes the attributes of `types` use, in a fixed order (see the file comment). */
const datatypesOf = (
  metamodel: Metamodel,
  used: ReadonlySet<string>,
  longest: number,
  lastChange: string,
): Writable["datatypes"] => {
  const enumerations = [
    ...metamodel.properties
      .filter((p) => p.kind === "choice")
      .map((p) => ({ key: p.key, choices: (p.choices ?? []).map((c) => c.key) })),
    { key: "status", choices: metamodel.statuses.map((s) => s.key) },
  ];
  return [
    ...(used.has(OWN_DATATYPES.string)
      ? [
          {
            identifier: OWN_DATATYPES.string,
            lastChange,
            kind: "string" as const,
            maxLength: String(Math.max(1, longest)),
            values: [],
          },
        ]
      : []),
    ...(used.has(OWN_DATATYPES.xhtml)
      ? [{ identifier: OWN_DATATYPES.xhtml, lastChange, kind: "xhtml" as const, values: [] }]
      : []),
    ...(used.has(OWN_DATATYPES.real)
      ? [
          {
            identifier: OWN_DATATYPES.real,
            lastChange,
            kind: "real" as const,
            min: "-1.7976931348623157E308",
            max: "1.7976931348623157E308",
            accuracy: "15",
            values: [],
          },
        ]
      : []),
    ...(used.has(OWN_DATATYPES.date)
      ? [{ identifier: OWN_DATATYPES.date, lastChange, kind: "date" as const, values: [] }]
      : []),
    ...enumerations
      .filter(({ key }) => used.has(ownId.enumeration(key)))
      .map(({ key, choices }) => ({
        identifier: ownId.enumeration(key),
        lastChange,
        kind: "enumeration" as const,
        values: choices.map((choice, i) => ({
          identifier: ownId.enumValue(key, choice),
          lastChange,
          longName: choice,
          key: String(i),
          otherContent: "",
        })),
      })),
  ];
};

/** A key whose items are SPEC-RELATIONs (`ownRelationKeys`): a relation kind is always a list. */
interface RelationKind {
  readonly key: string;
  readonly name: string;
  readonly many: boolean;
}

/** The SPEC-RELATIONs found so far, their IDENTIFIERs and kinds, and the stubs of their targets. */
interface Found {
  readonly relations: SpecRelation[];
  readonly identifiers: Set<string>;
  readonly kinds: Set<string>;
  /** The type IDENTIFIER of each stub, by its IDENTIFIER. */
  readonly stubs: Map<string, string>;
}

/** Adds the relations of `record` of each of `kinds` to `found` (see the file comment). */
const addRelations = (
  input: ExportInput,
  record: ElementRecord,
  kinds: readonly RelationKind[],
  exported: ReadonlySet<string>,
  found: Found,
): void => {
  const source = ownId.element(record.id);
  for (const { key, many } of kinds) {
    for (const [, item] of relationItems(key, { many }, record.data[key])) {
      // An entry without a UUID is the element check's (SR-085), not a relation.
      if (!hasId(item) || !isUuid(item.id)) {
        continue;
      }
      const target = ownId.element(item.id);
      const identifier = `_sr-${hash(source, key, target)}`;
      if (found.identifiers.has(identifier)) {
        continue;
      }
      found.identifiers.add(identifier);
      found.kinds.add(key);
      found.relations.push({
        identifier,
        lastChange: input.time,
        type: ownId.relationType(key),
        source,
        target,
        values: [],
      });
      if (!exported.has(item.id) && !found.stubs.has(target)) {
        const targetType = input.targetType(record, item);
        found.stubs.set(target, targetType === undefined ? MISSING_TYPE : ownId.objectType(targetType));
      }
    }
  }
};

/** The ReqIF model of the export of `input.elements` (see the file comment). */
export const planExport = (input: ExportInput): ExportPlan => {
  const { metamodel, time: lastChange } = input;
  const titleKey = titleKeyOrEmpty(metamodel);
  // A key is never both a property's and a relation kind's (the metamodel check, ADR-0004).
  const kinds: RelationKind[] = [
    ...metamodel.relations.map((r) => ({ key: r.key, name: r.name, many: true })),
    ...metamodel.properties
      .filter((p) => p.kind === "relation")
      .map((p) => ({ key: p.key, name: p.name, many: p.many === true })),
  ];
  const exported = new Set(input.elements.map((e) => e.record.id));
  const attributesOf = new Map<string, OwnAttribute[]>();
  const objects: SpecObject[] = [];
  const found: Found = { relations: [], identifiers: new Set(), kinds: new Set(), stubs: new Map() };
  const { relations, kinds: usedKinds, stubs } = found;
  let longest = 0;
  for (const element of input.elements) {
    const { record, text } = element;
    const type = findType(metamodel, record.type);
    let attributes = attributesOf.get(record.type);
    if (attributes === undefined) {
      attributes = ownAttributes(metamodel, record.type, type, titleKey);
      attributesOf.set(record.type, attributes);
    }
    const values = readableValues(metamodel, attributes, { data: record.data, text }, titleKey, {
      shortId: (item) => input.shortId(record, item),
      image: (url) => input.image(element, url),
    });
    for (const value of values) {
      if (value.kind === "string") {
        longest = Math.max(longest, characters(value.value));
      }
    }
    const title = record.data[titleKey];
    objects.push({
      identifier: ownId.element(record.id),
      lastChange,
      ...(typeof title === "string" ? { longName: title } : {}),
      type: ownId.objectType(record.type),
      values,
    });
    addRelations(input, record, kinds, exported, found);
  }
  for (const [identifier, type] of stubs) {
    objects.push({ identifier, lastChange, type, values: [] });
  }
  const used = new Set([...attributesOf.values()].flat().map((a) => a.datatype));
  const stubTypes = new Set(stubs.values());
  const ownTypes = new Set([...attributesOf.keys()].map((key) => ownId.objectType(key)));
  const typeOrder = (key: string): number => {
    const at = metamodel.effectiveTypes.findIndex((t) => t.key === key);
    return at === -1 ? metamodel.effectiveTypes.length : at;
  };
  const objectTypes = [
    ...[...attributesOf]
      .sort(([a], [b]) => typeOrder(a) - typeOrder(b))
      .map(([key, attributes]) => ({
        identifier: ownId.objectType(key),
        lastChange,
        longName: findType(metamodel, key)?.name ?? key,
        category: "spec-object" as const,
        attributes: ownDefinitions(attributes, lastChange),
      })),
    ...[...stubTypes]
      .filter((t) => t !== MISSING_TYPE && !ownTypes.has(t))
      .sort()
      .map((identifier) => ({
        identifier,
        lastChange,
        longName: identifier.slice("_ot-".length),
        category: "spec-object" as const,
        attributes: [],
      })),
    ...(stubTypes.has(MISSING_TYPE)
      ? [
          {
            identifier: MISSING_TYPE,
            lastChange,
            longName: "missing",
            category: "spec-object" as const,
            attributes: [],
          },
        ]
      : []),
  ];
  const ids = input.elements.map((e) => e.record.id);
  return {
    file: {
      header: {
        identifier: `_hd-${input.header}`,
        title: input.title,
        creationTime: lastChange,
        toolId: OWN_TOOL_ID,
        sourceToolId: input.sourceToolId,
        version: "1.0",
      },
      datatypes: datatypesOf(metamodel, used, longest, lastChange),
      specTypes: [
        ...objectTypes,
        ...kinds
          .filter(({ key }) => usedKinds.has(key))
          .map(({ key, name }) => ({
            identifier: ownId.relationType(key),
            lastChange,
            longName: name,
            category: "spec-relation" as const,
            attributes: [],
          })),
        {
          identifier: "_st-specification",
          lastChange,
          longName: "specification",
          category: "specification" as const,
          attributes: [],
        },
      ],
      specObjects: objects,
      specRelations: relations,
      specifications: [
        {
          identifier: `_sp-${hash(...ids)}`,
          lastChange,
          longName: input.title,
          type: "_st-specification",
          values: [],
          children: ids.map((id) => ({
            identifier: `_sh-${id}`,
            lastChange,
            object: ownId.element(id),
            children: [],
          })),
        },
      ],
    },
    relations: relations.length,
  };
};
