// Reads a ReqIF 1.2 file into the model of `model.ts` (ADR-0013) through core's own XML scanner, so
// a file can never make ReqSeq open a connection or read another file. Names are resolved by their
// namespace declarations, not by their prefix; what makes the file unusable refuses it with reason
// and line (packages/core/docs/reqif.md).
import type { XmlElement } from "../files/xml-scan.js";
import { scanXml, shown } from "../files/xml-scan.js";
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
  XhtmlNode,
} from "./model.js";
import { REQIF_NAMESPACE } from "./model.js";

/** Larger files are refused: a delivery of 50,000 objects is about 100 MB (N-036). */
export const MAX_REQIF_BYTES = 256 * 1024 * 1024;
/** Deeper nesting is refused, so that the recursive reading below cannot overflow the stack. */
export const MAX_REQIF_DEPTH = 256;

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

/** An element with its namespace resolved and its children and text runs in order. */
interface Node {
  readonly namespace: string;
  readonly name: string;
  /** Attributes by name as written, without the namespace declarations. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly content: readonly (Node | string)[];
  readonly line: number;
}

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

const resolve = (element: XmlElement, scope: ReadonlyMap<string, string>, depth: number): Node => {
  if (depth > MAX_REQIF_DEPTH) {
    throw new Invalid(`The file nests elements deeper than ${String(MAX_REQIF_DEPTH)} levels`, element.line);
  }
  // A new scope only for an element that declares a namespace: most declare none (50,000 objects).
  let declared = scope;
  const attributes: Record<string, string> = {};
  for (const { name, value } of element.attributes) {
    if (name === "xmlns" || name.startsWith("xmlns:")) {
      const own = declared === scope ? new Map(scope) : (declared as Map<string, string>);
      own.set(name === "xmlns" ? "" : name.slice(6), value);
      declared = own;
    } else {
      attributes[name] = value;
    }
  }
  const colon = element.name.indexOf(":");
  const prefix = colon === -1 ? "" : element.name.slice(0, colon);
  const namespace = declared.get(prefix);
  if (namespace === undefined) {
    throw new Invalid(`Element <${shown(element.name)}> has an undeclared prefix`, element.line);
  }
  return {
    namespace,
    name: element.name.slice(colon + 1),
    attributes,
    content: element.content.map((child) =>
      typeof child === "string" ? child : resolve(child, declared, depth + 1),
    ),
    line: element.line,
  };
};

const elements = (node: Node): Node[] =>
  node.content.filter((child): child is Node => typeof child !== "string");
const reqifChildren = (node: Node, name: string): Node[] =>
  elements(node).filter((child) => child.namespace === REQIF_NAMESPACE && child.name === name);
const reqifChild = (node: Node, name: string): Node | undefined => reqifChildren(node, name)[0];
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

const xhtml = (node: Node): XhtmlNode => ({
  name: node.name,
  namespace: node.namespace,
  attributes: node.attributes,
  children: node.content.map((child) => (typeof child === "string" ? child : xhtml(child))),
});

/** The parts of one file; `unread` collects what the model leaves out. */
class Reader {
  readonly unread: ReqifUnread[] = [];

  /** Every element child of `node` that `read` gives a value for; the others are unread. */
  each<T>(node: Node | undefined, read: (child: Node) => T | undefined): T[] {
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

  datatype(node: Node): ReqifDatatype | undefined {
    const kind = kindOf(node, "DATATYPE-DEFINITION-");
    if (kind === undefined) {
      return undefined;
    }
    const values = this.each(reqifChild(node, "SPECIFIED-VALUES"), (value) => {
      if (value.namespace !== REQIF_NAMESPACE || value.name !== "ENUM-VALUE") {
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

  specType(node: Node): ReqifSpecType | undefined {
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
              multiValued: attribute.attributes["MULTI-VALUED"] === "true",
            };
      },
    );
    return { ...identifiable(node), category, attributes };
  }

  values(node: Node): ReqifValue[] {
    return this.each(reqifChild(node, "VALUES"), (value): ReqifValue | undefined => {
      const kind = kindOf(value, "ATTRIBUTE-VALUE-");
      if (kind === undefined) {
        return undefined;
      }
      const definition = refIn(value, "DEFINITION", `${value.name.replace("VALUE", "DEFINITION")}-REF`);
      if (kind === "xhtml") {
        return {
          kind,
          definition,
          value: required(value, "THE-VALUE").content.map((c) => (typeof c === "string" ? c : xhtml(c))),
        };
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

  hierarchy(node: Node): ReqifHierarchy | undefined {
    return node.namespace === REQIF_NAMESPACE && node.name === "SPEC-HIERARCHY"
      ? {
          ...identifiable(node),
          object: refIn(node, "OBJECT", "SPEC-OBJECT-REF"),
          children: this.each(reqifChild(node, "CHILDREN"), (child) => this.hierarchy(child)),
        }
      : undefined;
  }
}

const header = (root: Node): ReqifHeader => {
  const node = required(required(root, "THE-HEADER"), "REQ-IF-HEADER");
  const fields = Object.entries({
    title: "TITLE",
    comment: "COMMENT",
    creationTime: "CREATION-TIME",
    repositoryId: "REPOSITORY-ID",
    toolId: "REQ-IF-TOOL-ID",
    sourceToolId: "SOURCE-TOOL-ID",
    version: "REQ-IF-VERSION",
  }).flatMap(([field, name]): [string, string][] => {
    const child = reqifChild(node, name);
    return child === undefined ? [] : [[field, textOf(child)]];
  });
  return { identifier: identifiable(node).identifier, ...Object.fromEntries(fields) };
};

const named = (name: string) => (node: Node) => node.namespace === REQIF_NAMESPACE && node.name === name;

const readFile = (root: Node): ReqifFile => {
  if (root.namespace !== REQIF_NAMESPACE || root.name !== "REQ-IF") {
    throw new Invalid(
      `The root element is <${shown(root.name)}> in ${shown(root.namespace || "no namespace")}, not <REQ-IF> of ReqIF 1.2`,
      root.line,
    );
  }
  const reader = new Reader();
  const content = required(required(root, "CORE-CONTENT"), "REQ-IF-CONTENT");
  const part = (name: string): Node | undefined => reqifChild(content, name);
  const isObject = named("SPEC-OBJECT");
  const isRelation = named("SPEC-RELATION");
  const isSpecification = named("SPECIFICATION");
  const file: ReqifFile = {
    header: header(root),
    datatypes: reader.each(part("DATATYPES"), (node) => reader.datatype(node)),
    specTypes: reader.each(part("SPEC-TYPES"), (node) => reader.specType(node)),
    specObjects: reader.each(part("SPEC-OBJECTS"), (node): ReqifSpecObject | undefined =>
      isObject(node)
        ? {
            ...identifiable(node),
            type: refIn(node, "TYPE", "SPEC-OBJECT-TYPE-REF"),
            values: reader.values(node),
          }
        : undefined,
    ),
    specRelations: reader.each(part("SPEC-RELATIONS"), (node): ReqifSpecRelation | undefined =>
      isRelation(node)
        ? {
            ...identifiable(node),
            type: refIn(node, "TYPE", "SPEC-RELATION-TYPE-REF"),
            source: refIn(node, "SOURCE", "SPEC-OBJECT-REF"),
            target: refIn(node, "TARGET", "SPEC-OBJECT-REF"),
            values: reader.values(node),
          }
        : undefined,
    ),
    specifications: reader.each(part("SPECIFICATIONS"), (node): ReqifSpecification | undefined =>
      isSpecification(node)
        ? {
            ...identifiable(node),
            type: refIn(node, "TYPE", "SPECIFICATION-TYPE-REF"),
            values: reader.values(node),
            children: reader.each(reqifChild(node, "CHILDREN"), (child) => reader.hierarchy(child)),
          }
        : undefined,
    ),
    unread: reader.unread,
  };
  const known = new Set(["DATATYPES", "SPEC-TYPES", "SPEC-OBJECTS", "SPEC-RELATIONS", "SPECIFICATIONS"]);
  for (const node of elements(content).filter((child) => !known.has(child.name))) {
    for (const group of elements(node)) {
      reader.unread.push({ name: group.name, line: group.line });
    }
  }
  const extensions = reqifChild(root, "TOOL-EXTENSIONS");
  for (const node of extensions === undefined ? [] : elements(extensions)) {
    reader.unread.push({ name: node.name, line: node.line });
  }
  return file;
};

/** Reads the bytes of a ReqIF 1.2 file (`.reqif`; a `.reqifz` archive is not read, SR-053). */
export const parseReqif = (bytes: Uint8Array): ReqifParseOutcome => {
  if (bytes.length > MAX_REQIF_BYTES) {
    return {
      kind: "refused",
      message: `The file has ${String(bytes.length)} bytes; ReqSeq reads ReqIF files up to ${String(MAX_REQIF_BYTES)} bytes`,
      line: 1,
    };
  }
  try {
    const scanned = scanXml(bytes);
    if (scanned.kind === "refused") {
      return { kind: "refused", message: scanned.message, line: scanned.line };
    }
    const scope = new Map([
      ["", ""],
      ["xml", XML_NAMESPACE],
    ]);
    return { kind: "parsed", file: readFile(resolve(scanned.document.root, scope, 1)) };
  } catch (error) {
    if (error instanceof Invalid) {
      return { kind: "refused", message: error.message, line: error.line };
    }
    throw error;
  }
};
