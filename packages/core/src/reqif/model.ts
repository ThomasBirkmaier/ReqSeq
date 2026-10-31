// The ReqIF 1.2 model of ReqSeq (ADR-0013), read by `parse.ts`: references stay IDENTIFIERs as
// written, values the text of the file, XHTML the namespace-resolved node tree (docs/reqif.md).

/** The ReqIF namespace of version 1.2 (it kept the URI of 1.0). */
export const REQIF_NAMESPACE = "http://www.omg.org/spec/ReqIF/20110401/reqif.xsd";
/** The XHTML namespace of `ATTRIBUTE-VALUE-XHTML` content. */
export const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

/** IDENTIFIER, `LONG-NAME`, `LAST-CHANGE` and `DESC` of every identifiable. */
export interface ReqifIdentifiable {
  readonly identifier: string;
  readonly longName?: string;
  readonly lastChange?: string;
  readonly desc?: string;
  /** Line of its start tag, from 1. */
  readonly line: number;
}

export type ReqifDatatypeKind = "string" | "xhtml" | "integer" | "real" | "date" | "boolean" | "enumeration";

export interface ReqifEnumValue extends ReqifIdentifiable {
  /** `KEY` and `OTHER-CONTENT` of its `EMBEDDED-VALUE`. */
  readonly key?: string;
  readonly otherContent?: string;
}

export interface ReqifDatatype extends ReqifIdentifiable {
  readonly kind: ReqifDatatypeKind;
  /** The facets as written: `MAX-LENGTH` of a STRING, `MIN` and `MAX` of an INTEGER or REAL, `ACCURACY` of a REAL. */
  readonly maxLength?: string;
  readonly min?: string;
  readonly max?: string;
  readonly accuracy?: string;
  /** `SPECIFIED-VALUES` of an enumeration; empty for the other kinds. */
  readonly values: readonly ReqifEnumValue[];
}

export interface ReqifAttributeDefinition extends ReqifIdentifiable {
  readonly kind: ReqifDatatypeKind;
  /** IDENTIFIER of its datatype. */
  readonly datatype: string;
  /** `MULTI-VALUED` of an enumeration attribute. */
  readonly multiValued: boolean;
  /**
   * Its `DEFAULT-VALUE` (ReqIF 1.2 §10.8.3), the value of an object that has none of its own;
   * `definition` is this attribute's IDENTIFIER.
   */
  readonly defaultValue?: ReqifValue;
}

export type ReqifSpecTypeCategory = "spec-object" | "spec-relation" | "specification" | "relation-group";

export interface ReqifSpecType extends ReqifIdentifiable {
  readonly category: ReqifSpecTypeCategory;
  readonly attributes: readonly ReqifAttributeDefinition[];
}

/** An XHTML element: its local name and `namespace` as declared in scope. */
export interface XhtmlElement {
  readonly name: string;
  readonly namespace: string;
  /** Names (as written) and values in turn, in document order: `[name, value, name, value, …]`. */
  readonly attributes: readonly string[];
  readonly children: readonly XhtmlNode[];
}

export type XhtmlNode = XhtmlElement | string;

/** One value of an object, relation or specification, by the IDENTIFIER of its attribute definition. */
export type ReqifValue =
  | {
      readonly kind: "string" | "integer" | "real" | "date" | "boolean";
      readonly definition: string;
      readonly value: string;
    }
  | { readonly kind: "xhtml"; readonly definition: string; readonly value: readonly XhtmlNode[] }
  | { readonly kind: "enumeration"; readonly definition: string; readonly values: readonly string[] };

export interface ReqifSpecObject extends ReqifIdentifiable {
  readonly type: string;
  readonly values: readonly ReqifValue[];
}

export interface ReqifSpecRelation extends ReqifIdentifiable {
  readonly type: string;
  readonly source: string;
  readonly target: string;
  readonly values: readonly ReqifValue[];
}

export interface ReqifHierarchy extends ReqifIdentifiable {
  /** IDENTIFIER of the SPEC-OBJECT it places. */
  readonly object: string;
  readonly children: readonly ReqifHierarchy[];
}

export interface ReqifSpecification extends ReqifIdentifiable {
  readonly type: string;
  readonly values: readonly ReqifValue[];
  readonly children: readonly ReqifHierarchy[];
}

export interface ReqifHeader {
  readonly identifier: string;
  readonly title?: string;
  readonly comment?: string;
  readonly creationTime?: string;
  readonly repositoryId?: string;
  readonly toolId?: string;
  readonly sourceToolId?: string;
  readonly version?: string;
}

/** The SPEC-OBJECT, SPEC-RELATION or SPECIFICATION an unread part belongs to. */
export interface ReqifOwner {
  readonly kind: "spec-object" | "spec-relation" | "specification";
  readonly identifier: string;
}

/**
 * An element of the file the model does not read, with what is inside it, by its local name and
 * namespace. With an `owner` it is a loss of that object for the import's loss list (`reqifLoss`,
 * SR-053 AK2); without, it belongs to no object (a type, a datatype, a part of the file).
 */
export interface ReqifUnread {
  readonly name: string;
  readonly namespace: string;
  readonly line: number;
  readonly owner?: ReqifOwner;
}

export interface ReqifFile {
  readonly header: ReqifHeader;
  readonly datatypes: readonly ReqifDatatype[];
  readonly specTypes: readonly ReqifSpecType[];
  readonly specObjects: readonly ReqifSpecObject[];
  readonly specRelations: readonly ReqifSpecRelation[];
  readonly specifications: readonly ReqifSpecification[];
  readonly unread: readonly ReqifUnread[];
}
