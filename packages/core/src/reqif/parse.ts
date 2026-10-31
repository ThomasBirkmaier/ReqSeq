// Reads a ReqIF 1.2 file into the model of `model.ts` (ADR-0013). The bytes stream through core's
// own XML scanner (`streamXml`), so a file can never make ReqSeq open a connection or read another
// file, and no element tree of the whole file is built: every SPEC-OBJECT, SPEC-RELATION, datatype,
// spec type and SPECIFICATION is read when it ends and its elements are dropped (N-036). The walk is
// the scanner's iteration, so deep nesting cannot overflow the stack. Names are resolved by their
// namespace declarations, not by their prefix. Details in packages/core/docs/reqif.md.
import type { XmlAttribute, XmlEvents } from "../files/xml-scan.js";
import { shown, streamXml } from "../files/xml-scan.js";
import type {
  ReqifAttributeDefinition,
  ReqifDatatype,
  ReqifDatatypeKind,
  ReqifFile,
  ReqifHeader,
  ReqifHierarchy,
  ReqifIdentifiable,
  ReqifSpecification,
  ReqifSpecObject,
  ReqifSpecRelation,
  ReqifSpecType,
  ReqifSpecTypeCategory,
  ReqifUnread,
  ReqifValue,
  XhtmlElement,
  XhtmlNode,
} from "./model.js";
import { REQIF_NAMESPACE } from "./model.js";

/** Larger files are refused: a delivery of 50,000 objects is about 100 to 160 MB (N-036). */
export const MAX_REQIF_BYTES = 256 * 1024 * 1024;
/**
 * More elements are refused, so that memory stays bounded for a hostile file of tiny elements: the
 * model keeps at most about 100 bytes per element. A delivery at N-036 has about 3 to 4 million.
 */
export const MAX_REQIF_ELEMENTS = 8_000_000;

export type ReqifParseOutcome =
  | { readonly kind: "parsed"; readonly file: ReqifFile }
  | { readonly kind: "refused"; readonly message: string; readonly line: number };

class Invalid extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}

/** An element while it is read, with its namespace resolved and its children and text runs in order. */
interface Node {
  readonly namespace: string;
  readonly name: string;
  /** Attributes by name as written, without the namespace declarations. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly line: number;
  /** Inside an XHTML value, the XHTML elements are read at their end and kept as such. */
  readonly content: (Node | XhtmlElement | string)[];
  /** Set at its end for a SPEC-HIERARCHY; its content is then dropped. */
  hierarchy?: ReqifHierarchy;
}

interface Frame {
  readonly node: Node;
  readonly scope: ReadonlyMap<string, string>;
}

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const ROOT_SCOPE: ReadonlyMap<string, string> = new Map([
  ["", ""],
  ["xml", XML_NAMESPACE],
]);
const NO_ATTRIBUTES: Readonly<Record<string, string>> = Object.freeze(
  Object.create(null) as Record<string, string>,
);
/** Stands for the document around the root element. */
const HOLDER: Node = { namespace: "", name: "", attributes: NO_ATTRIBUTES, line: 1, content: [] };
const NO_CHILDREN: readonly XhtmlNode[] = Object.freeze([]);

const isReqif = (node: Node, name: string): boolean =>
  node.namespace === REQIF_NAMESPACE && node.name === name;
const elements = (node: Node): Node[] =>
  node.content.filter((child): child is Node => typeof child !== "string" && "content" in child);
const reqifChildren = (node: Node, name: string): Node[] =>
  elements(node).filter((child) => isReqif(child, name));
const reqifChild = (node: Node, name: string): Node | undefined =>
  elements(node).find((child) => isReqif(child, name));
const required = (node: Node, name: string): Node => {
  const child = reqifChild(node, name);
  if (child === undefined) {
    throw new Invalid(`<${node.name}> has no <${name}>`, node.line);
  }
  return child;
};
const textOf = (node: Node): string =>
  node.content.filter((child): child is string => typeof child === "string").join("");

/** The text of the reference `<refName>` inside the child `wrapper` of `node`. */
const refIn = (node: Node, wrapper: string, refName: string): string =>
  textOf(required(required(node, wrapper), refName)).trim();

const identifiable = (node: Node): ReqifIdentifiable => {
  const {
    IDENTIFIER: identifier,
    "LONG-NAME": longName,
    "LAST-CHANGE": lastChange,
    DESC: desc,
  } = node.attributes;
  if (identifier === undefined || identifier === "") {
    throw new Invalid(`<${node.name}> has no IDENTIFIER`, node.line);
  }
  return {
    identifier,
    ...(longName === undefined ? {} : { longName }),
    ...(lastChange === undefined ? {} : { lastChange }),
    ...(desc === undefined ? {} : { desc }),
    line: node.line,
  };
};

const KINDS: ReadonlyMap<string, ReqifDatatypeKind> = new Map([
  ["STRING", "string"],
  ["XHTML", "xhtml"],
  ["INTEGER", "integer"],
  ["REAL", "real"],
  ["DATE", "date"],
  ["BOOLEAN", "boolean"],
  ["ENUMERATION", "enumeration"],
]);

/** The kind of a ReqIF name `<prefix><KIND>`, e.g. `ATTRIBUTE-VALUE-STRING`; undefined for others. */
const kindOf = (node: Node, prefix: string): ReqifDatatypeKind | undefined =>
  node.namespace === REQIF_NAMESPACE && node.name.startsWith(prefix)
    ? KINDS.get(node.name.slice(prefix.length))
    : undefined;

const SPEC_TYPES: ReadonlyMap<string, ReqifSpecTypeCategory> = new Map([
  ["SPEC-OBJECT-TYPE", "spec-object"],
  ["SPEC-RELATION-TYPE", "spec-relation"],
  ["SPECIFICATION-TYPE", "specification"],
  ["RELATION-GROUP-TYPE", "relation-group"],
]);

/** The element `name` with its namespace resolved in `outer` and its own declarations. */
const resolve = (
  name: string,
  attributes: readonly XmlAttribute[],
  line: number,
  outer: ReadonlyMap<string, string>,
): Frame => {
  // A new scope only for an element that declares a namespace: most declare none.
  let scope = outer;
  for (const { name: attribute, value } of attributes) {
    if (attribute === "xmlns" || attribute.startsWith("xmlns:")) {
      scope = new Map(scope).set(attribute === "xmlns" ? "" : attribute.slice(6), value);
    }
  }
  // An unprefixed attribute is in no namespace; an unprefixed element in the default one.
  const resolved = (qualified: string, element: boolean): string => {
    const colon = qualified.indexOf(":");
    const namespace = colon === -1 && !element ? "" : scope.get(qualified.slice(0, Math.max(colon, 0)));
    if (namespace === undefined) {
      throw new Invalid(`${shown(qualified)} in <${shown(name)}> has an undeclared prefix`, line);
    }
    return namespace;
  };
  let own: Record<string, string> | undefined;
  for (const { name: attribute, value } of attributes) {
    if (attribute !== "xmlns" && !attribute.startsWith("xmlns:")) {
      resolved(attribute, false);
      own ??= Object.create(null) as Record<string, string>;
      own[attribute] = value;
    }
  }
  return {
    node: {
      namespace: resolved(name, true),
      name: name.slice(name.indexOf(":") + 1),
      attributes: own ?? NO_ATTRIBUTES,
      line,
      content: [],
    },
    scope,
  };
};

/** THE-VALUE or THE-ORIGINAL-VALUE: elements inside are XHTML (of ATTRIBUTE-VALUE-XHTML). */
const isXhtmlValue = (node: Node): boolean =>
  isReqif(node, "THE-VALUE") || isReqif(node, "THE-ORIGINAL-VALUE");

/** `xsd:boolean` true: `true` or `1`, whitespace around allowed. */
const isTrue = (value: string | undefined): boolean => ["true", "1"].includes(value?.trim() ?? "");

const HEADER_FIELDS = {
  title: "TITLE",
  comment: "COMMENT",
  creationTime: "CREATION-TIME",
  repositoryId: "REPOSITORY-ID",
  toolId: "REQ-IF-TOOL-ID",
  sourceToolId: "SOURCE-TOOL-ID",
  version: "REQ-IF-VERSION",
} as const;

/** The events of one file; `unread` collects what the model leaves out. */
class Reader implements XmlEvents {
  /** The element open last; at first a holder for the root. */
  private top: Frame = { node: HOLDER, scope: ROOT_SCOPE };
  /** The open elements around `top`, from the holder on. */
  private readonly stack: Frame[] = [];
  private count = 0;
  /** How many THE-VALUE (or THE-ORIGINAL-VALUE) elements are open: inside one, elements are XHTML. */
  private xhtml = 0;
  /** The root, once the file is read. */
  root: Node = HOLDER;
  readonly unread: ReqifUnread[] = [];
  readonly datatypes: ReqifDatatype[] = [];
  readonly specTypes: ReqifSpecType[] = [];
  readonly specObjects: ReqifSpecObject[] = [];
  readonly specRelations: ReqifSpecRelation[] = [];
  readonly specifications: ReqifSpecification[] = [];
  private readonly maxElements: number;

  constructor(maxElements: number) {
    this.maxElements = maxElements;
  }

  open(name: string, attributes: readonly XmlAttribute[], line: number): void {
    if (++this.count > this.maxElements) {
      throw new Invalid(`The file has more than ${String(this.maxElements)} elements`, line);
    }
    const { node, scope } = resolve(name, attributes, line, this.top.scope);
    if (this.top.node === HOLDER && !isReqif(node, "REQ-IF")) {
      throw new Invalid(
        `The root element is <${shown(name)}> in ${shown(node.namespace || "no namespace")}, not <REQ-IF> of ReqIF 1.2`,
        line,
      );
    }
    if (this.xhtml > 0 && node.namespace === REQIF_NAMESPACE) {
      throw new Invalid(`ReqIF element <${node.name}> inside XHTML`, line);
    }
    if (isXhtmlValue(node)) {
      this.xhtml++;
    }
    this.stack.push(this.top);
    this.top = { node, scope };
  }

  text(text: string): void {
    const { content } = this.top.node;
    const last = content.length - 1;
    const before = content[last];
    if (typeof before === "string") {
      content[last] = before + text;
    } else {
      content.push(text);
    }
  }

  close(): void {
    const { node } = this.top;
    // One frame: the holder at least, as every close follows its open.
    for (const frame of this.stack.splice(-1)) {
      this.top = frame;
    }
    const parent = this.top.node;
    if (this.xhtml > 0 && node.namespace !== REQIF_NAMESPACE) {
      // Only strings and XHTML elements are inside an XHTML value (ReqIF ones are refused at open).
      const children = node.content as XhtmlNode[];
      parent.content.push({
        name: node.name,
        namespace: node.namespace,
        attributes: node.attributes,
        // A copy of exact length: the array grown by pushes keeps spare slots.
        children: children.length === 0 ? NO_CHILDREN : children.slice(),
      });
      return;
    }
    if (isXhtmlValue(node)) {
      this.xhtml--;
    } else if (isReqif(node, "SPEC-HIERARCHY")) {
      node.hierarchy = {
        ...identifiable(node),
        object: refIn(node, "OBJECT", "SPEC-OBJECT-REF"),
        children: this.each(reqifChild(node, "CHILDREN"), (child) => child.hierarchy),
      };
      node.content.length = 0;
    }
    if (parent === HOLDER) {
      this.root = node;
    } else {
      this.place(parent, node);
    }
  }

  /** Reads or keeps `node`, a child of `parent`, at its end. */
  private place(parent: Node, node: Node): void {
    // By the number of elements around `parent`, the holder included.
    if (this.stack.length === 4 && this.inContent()) {
      this.item(parent, node);
    } else if (
      this.stack.length === 1 &&
      !(isReqif(node, "THE-HEADER") || isReqif(node, "CORE-CONTENT") || isReqif(node, "TOOL-EXTENSIONS"))
    ) {
      this.unread.push({ name: node.name, line: node.line });
    } else if (this.stack.length === 2 && isReqif(parent, "TOOL-EXTENSIONS")) {
      this.unread.push({ name: node.name, line: node.line });
    } else {
      parent.content.push(node);
    }
  }

  /** Around `top` are REQ-IF, CORE-CONTENT and REQ-IF-CONTENT (and maybe more). */
  private inContent(): boolean {
    const [, , core, content] = this.stack;
    return (
      core !== undefined &&
      content !== undefined &&
      isReqif(core.node, "CORE-CONTENT") &&
      isReqif(content.node, "REQ-IF-CONTENT")
    );
  }

  /** A child of a part of REQ-IF-CONTENT, read at its end and not kept as an element. */
  private item(part: Node, node: Node): void {
    if (part.namespace !== REQIF_NAMESPACE || !this.itemIn(part.name, node)) {
      this.unread.push({ name: node.name, line: node.line });
    }
  }

  /** Reads `node` as an item of the part `part`; false when it is none. */
  private itemIn(part: string, node: Node): boolean {
    switch (part) {
      case "DATATYPES":
        return this.add(this.datatypes, this.datatype(node));
      case "SPEC-TYPES":
        return this.add(this.specTypes, this.specType(node));
      case "SPEC-OBJECTS":
        return (
          isReqif(node, "SPEC-OBJECT") &&
          this.add(this.specObjects, {
            ...identifiable(node),
            type: refIn(node, "TYPE", "SPEC-OBJECT-TYPE-REF"),
            values: this.values(node),
          })
        );
      case "SPEC-RELATIONS":
        return (
          isReqif(node, "SPEC-RELATION") &&
          this.add(this.specRelations, {
            ...identifiable(node),
            type: refIn(node, "TYPE", "SPEC-RELATION-TYPE-REF"),
            source: refIn(node, "SOURCE", "SPEC-OBJECT-REF"),
            target: refIn(node, "TARGET", "SPEC-OBJECT-REF"),
            values: this.values(node),
          })
        );
      case "SPECIFICATIONS":
        return (
          isReqif(node, "SPECIFICATION") &&
          this.add(this.specifications, {
            ...identifiable(node),
            type: refIn(node, "TYPE", "SPECIFICATION-TYPE-REF"),
            values: this.values(node),
            children: this.each(reqifChild(node, "CHILDREN"), (child) => child.hierarchy),
          })
        );
      default:
        return false;
    }
  }

  private add<T>(list: T[], value: T | undefined): boolean {
    if (value !== undefined) {
      list.push(value);
    }
    return value !== undefined;
  }

  /** Every element child of `node` that `read` gives a value for; the others are unread. */
  private each<T>(node: Node | undefined, read: (child: Node) => T | undefined): T[] {
    const found: T[] = [];
    for (const child of node === undefined ? [] : elements(node)) {
      const value = read(child);
      if (value === undefined) {
        this.unread.push({ name: child.name, line: child.line });
      } else {
        found.push(value);
      }
    }
    return found;
  }

  private datatype(node: Node): ReqifDatatype | undefined {
    const kind = kindOf(node, "DATATYPE-DEFINITION-");
    if (kind === undefined) {
      return undefined;
    }
    const values = this.each(reqifChild(node, "SPECIFIED-VALUES"), (value) => {
      if (!isReqif(value, "ENUM-VALUE")) {
        return undefined;
      }
      const embedded = reqifChild(required(value, "PROPERTIES"), "EMBEDDED-VALUE")?.attributes ?? {};
      const { KEY: key, "OTHER-CONTENT": otherContent } = embedded;
      return {
        ...identifiable(value),
        ...(key === undefined ? {} : { key }),
        ...(otherContent === undefined ? {} : { otherContent }),
      };
    });
    return { ...identifiable(node), kind, values };
  }

  private specType(node: Node): ReqifSpecType | undefined {
    const category = node.namespace === REQIF_NAMESPACE ? SPEC_TYPES.get(node.name) : undefined;
    if (category === undefined) {
      return undefined;
    }
    const attributes = this.each(
      reqifChild(node, "SPEC-ATTRIBUTES"),
      (attribute): ReqifAttributeDefinition | undefined => {
        const kind = kindOf(attribute, "ATTRIBUTE-DEFINITION-");
        return kind === undefined
          ? undefined
          : {
              ...identifiable(attribute),
              kind,
              datatype: refIn(attribute, "TYPE", `${attribute.name.replace("ATTRIBUTE", "DATATYPE")}-REF`),
              multiValued: isTrue(attribute.attributes["MULTI-VALUED"]),
            };
      },
    );
    return { ...identifiable(node), category, attributes };
  }

  private values(node: Node): ReqifValue[] {
    return this.each(reqifChild(node, "VALUES"), (value): ReqifValue | undefined => {
      const kind = kindOf(value, "ATTRIBUTE-VALUE-");
      if (kind === undefined) {
        return undefined;
      }
      const definition = refIn(value, "DEFINITION", `${value.name.replace("VALUE", "DEFINITION")}-REF`);
      if (kind === "xhtml") {
        // Only strings and XHTML elements are inside THE-VALUE (`open` refuses ReqIF ones).
        return { kind, definition, value: (required(value, "THE-VALUE").content as XhtmlNode[]).slice() };
      }
      if (kind === "enumeration") {
        const refs = reqifChildren(reqifChild(value, "VALUES") ?? value, "ENUM-VALUE-REF");
        return { kind, definition, values: refs.map((ref) => textOf(ref).trim()) };
      }
      const theValue = value.attributes["THE-VALUE"];
      if (theValue === undefined) {
        throw new Invalid(`<${value.name}> has no THE-VALUE`, value.line);
      }
      return { kind, definition, value: theValue };
    });
  }

  header(root: Node): ReqifHeader {
    const node = required(required(root, "THE-HEADER"), "REQ-IF-HEADER");
    const fields = Object.entries(HEADER_FIELDS).flatMap(([field, name]): [string, string][] => {
      const child = reqifChild(node, name);
      return child === undefined ? [] : [[field, textOf(child)]];
    });
    return { identifier: identifiable(node).identifier, ...Object.fromEntries(fields) };
  }
}

/**
 * Reads the bytes of a ReqIF 1.2 file (`.reqif`; a `.reqifz` archive is not read, SR-053). `maxElements`
 * lowers the element guard, for tests.
 */
export const parseReqif = (bytes: Uint8Array, maxElements = MAX_REQIF_ELEMENTS): ReqifParseOutcome => {
  if (bytes.length > MAX_REQIF_BYTES) {
    return {
      kind: "refused",
      message: `The file has ${String(bytes.length)} bytes; ReqSeq reads ReqIF files up to ${String(MAX_REQIF_BYTES)} bytes`,
      line: 1,
    };
  }
  const reader = new Reader(maxElements);
  try {
    const streamed = streamXml(bytes, reader);
    if (streamed.kind === "refused") {
      return { kind: "refused", message: streamed.message, line: streamed.line };
    }
    const { root } = reader;
    required(required(root, "CORE-CONTENT"), "REQ-IF-CONTENT");
    const { datatypes, specTypes, specObjects, specRelations, specifications, unread } = reader;
    const file = {
      header: reader.header(root),
      datatypes,
      specTypes,
      specObjects,
      specRelations,
      specifications,
    };
    return { kind: "parsed", file: { ...file, unread } };
  } catch (error) {
    if (error instanceof Invalid) {
      return { kind: "refused", message: error.message, line: error.line };
    }
    throw error;
  }
};
