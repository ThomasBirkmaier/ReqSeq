// Reads a ReqIF 1.2 file into the model of `model.ts` (ADR-0013). The bytes stream through core's
// own XML scanner (`streamXml`), so a file can never make ReqSeq open a connection or read another
// file, and no element tree of the whole file is built: every datatype, spec type, SPEC-OBJECT,
// SPEC-RELATION and SPECIFICATION is read when it ends and its elements are dropped, and a part the
// model does not read is skipped without building anything. The walk is the scanner's iteration, so
// deep nesting cannot overflow the stack, and an estimate of the memory kept bounds every hostile
// file. Names are resolved by their namespace declarations, not by their prefix. Details in
// packages/core/docs/reqif.md.
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
  ReqifOwner,
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

export interface ReqifLimits {
  /** Larger files are refused before reading. */
  readonly bytes: number;
  /**
   * Estimated bytes the reader may keep at once (open elements, the model so far, the unread list);
   * a file that needs more is refused. The estimate is at or above what Node 22 keeps.
   */
  readonly retained: number;
}

/** A delivery at N-036 (50,000 objects, 200,000 relations, 114 to 161 MB) needs about 0.4 GB. */
export const REQIF_LIMITS: ReqifLimits = { bytes: 256 * 1024 * 1024, retained: 1024 * 1024 * 1024 };

/** The estimate per kept object (element, frame, model node, string header), from measurements. */
const OBJECT = 64;
/** Bytes per character of a kept string (two-byte strings, the upper bound), and per string. */
const CHAR = 2;
const STRING = 24;

/** A reference to an IDENTIFIER the file does not define; the model keeps it as written. */
export interface ReqifWarning {
  readonly message: string;
  readonly line: number;
  /** IDENTIFIER of the element that holds the reference. */
  readonly identifier: string;
}

export type ReqifParseOutcome =
  | { readonly kind: "parsed"; readonly file: ReqifFile; readonly warnings: readonly ReqifWarning[] }
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
  /** Names (as written, no namespace declarations) and values in turn. */
  readonly attributes: readonly string[];
  readonly line: number;
  /** Inside an XHTML value, the XHTML elements are read at their end and kept as such. */
  readonly content: (Node | XhtmlElement | string)[];
  /** Set at its end for a SPEC-HIERARCHY; its content is then dropped. */
  hierarchy?: ReqifHierarchy;
  /** Set when the reader looked at it; what it never looked at is unread. */
  read?: boolean;
}

/**
 * Where an element sits: `document` holds the root; `skip` is every element of a part the model
 * does not read; `inner` is inside an item or the header; `value` is THE-VALUE (or
 * THE-ORIGINAL-VALUE) of an item; `xhtml` is inside one.
 */
type Role =
  | "document"
  | "root"
  | "header"
  | "core"
  | "content"
  | "part"
  | "item"
  | "inner"
  | "value"
  | "xhtml"
  | "skip";

interface Frame {
  readonly role: Role;
  readonly node: Node;
  /** The content of the parent element, where a kept element goes at its end. */
  readonly into: (Node | XhtmlElement | string)[];
  /** The namespace stacks this element pushed a declaration on, popped at its end. */
  readonly declared: readonly string[][];
}

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const NO_STRINGS: readonly string[] = Object.freeze([]);
const NO_DECLARED: readonly string[][] = Object.freeze([]);
const NO_CHILDREN: readonly XhtmlNode[] = Object.freeze([]);
const EMPTY_NODE: Node = { namespace: "", name: "", attributes: NO_STRINGS, line: 1, content: [] };
const DOCUMENT: Frame = { role: "document", node: EMPTY_NODE, into: [], declared: NO_DECLARED };
const SKIP: Frame = { role: "skip", node: EMPTY_NODE, into: [], declared: NO_DECLARED };
/** Roles whose text runs are read; the others drop them. */
const WITH_TEXT: ReadonlySet<Role> = new Set(["inner", "value", "xhtml"]);

const isReqif = (node: Node, name: string): boolean =>
  node.namespace === REQIF_NAMESPACE && node.name === name;
const attribute = (node: Node, name: string): string | undefined => {
  const { attributes } = node;
  for (let i = 0; i < attributes.length; i += 2) {
    if (attributes[i] === name) {
      return attributes[i + 1];
    }
  }
  return undefined;
};
const elements = (node: Node): Node[] =>
  node.content.filter((child): child is Node => typeof child !== "string" && "content" in child);
const reqifChildren = (node: Node, name: string): Node[] =>
  elements(node).filter((child) => isReqif(child, name) && (child.read = true));
/** The first child `name`; a second one is unread. */
const reqifChild = (node: Node, name: string): Node | undefined => {
  const child = elements(node).find((element) => isReqif(element, name));
  if (child !== undefined) {
    child.read = true;
  }
  return child;
};
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
  const identifier = attribute(node, "IDENTIFIER");
  if (identifier === undefined || identifier === "") {
    throw new Invalid(`<${node.name}> has no IDENTIFIER`, node.line);
  }
  const longName = attribute(node, "LONG-NAME");
  const lastChange = attribute(node, "LAST-CHANGE");
  const desc = attribute(node, "DESC");
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

const SPEC_TYPES: ReadonlySet<string> = new Set([
  "SPEC-OBJECT-TYPE",
  "SPEC-RELATION-TYPE",
  "SPECIFICATION-TYPE",
  "RELATION-GROUP-TYPE",
]);

/** The category of a spec type, one of `SPEC_TYPES`. */
const categoryOf = (name: string): ReqifSpecTypeCategory => {
  switch (name) {
    case "SPEC-OBJECT-TYPE":
      return "spec-object";
    case "SPEC-RELATION-TYPE":
      return "spec-relation";
    case "SPECIFICATION-TYPE":
      return "specification";
    default:
      return "relation-group";
  }
};

/** The parts of REQ-IF-CONTENT the model reads. */
const PARTS: ReadonlySet<string> = new Set([
  "DATATYPES",
  "SPEC-TYPES",
  "SPEC-OBJECTS",
  "SPEC-RELATIONS",
  "SPECIFICATIONS",
]);

/** Whether `node` is an item the model reads of the part `part` (one of `PARTS`). */
const isItem = (part: string, node: Node): boolean => {
  switch (part) {
    case "DATATYPES":
      return kindOf(node, "DATATYPE-DEFINITION-") !== undefined;
    case "SPEC-TYPES":
      return node.namespace === REQIF_NAMESPACE && SPEC_TYPES.has(node.name);
    case "SPEC-OBJECTS":
      return isReqif(node, "SPEC-OBJECT");
    case "SPEC-RELATIONS":
      return isReqif(node, "SPEC-RELATION");
    default:
      return isReqif(node, "SPECIFICATION");
  }
};

/** The objects whose unread parts are losses of an element (SR-053 AK2). */
const OWNERS: ReadonlyMap<string, ReqifOwner["kind"]> = new Map([
  ["SPEC-OBJECT", "spec-object"],
  ["SPEC-RELATION", "spec-relation"],
  ["SPECIFICATION", "specification"],
]);

/** `xsd:boolean` true: `true` or `1`, whitespace around allowed. */
const isTrue = (value: string | undefined): boolean => ["true", "1"].includes(value?.trim() ?? "");

/** THE-VALUE or THE-ORIGINAL-VALUE: elements inside are XHTML (of ATTRIBUTE-VALUE-XHTML). */
const isXhtmlValue = (node: Node): boolean =>
  isReqif(node, "THE-VALUE") || isReqif(node, "THE-ORIGINAL-VALUE");

const HEADER_FIELDS = {
  title: "TITLE",
  comment: "COMMENT",
  creationTime: "CREATION-TIME",
  repositoryId: "REPOSITORY-ID",
  toolId: "REQ-IF-TOOL-ID",
  sourceToolId: "SOURCE-TOOL-ID",
  version: "REQ-IF-VERSION",
} as const;

/** The role of `node`, a child of an element in `parent`; `skip` for what the model does not read. */
const roleOf = (parent: Role, node: Node): Role => {
  if (parent === "root") {
    return isReqif(node, "THE-HEADER") ? "header" : isReqif(node, "CORE-CONTENT") ? "core" : "skip";
  }
  if (parent === "core") {
    return isReqif(node, "REQ-IF-CONTENT") ? "content" : "skip";
  }
  if (parent === "content") {
    return node.namespace === REQIF_NAMESPACE && PARTS.has(node.name) ? "part" : "skip";
  }
  if (parent === "value" || parent === "xhtml") {
    if (node.namespace === REQIF_NAMESPACE) {
      throw new Invalid(`ReqIF element <${node.name}> inside XHTML`, node.line);
    }
    return "xhtml";
  }
  // `part` (its items, chosen by `isItem` in `open`), `item`, `inner` and `header`.
  return parent === "part" ? "item" : isXhtmlValue(node) ? "value" : "inner";
};

/** The events of one file; `unread` collects what the model leaves out. */
class Reader implements XmlEvents<Frame> {
  /** Per prefix, the namespaces declared for it, innermost last. */
  private readonly namespaces = new Map<string, string[]>([
    ["", [""]],
    ["xml", [XML_NAMESPACE]],
  ]);
  private kept = 0;
  private readonly limit: number;
  /** The roles met, and the parts met by `<parent role> <name>`. */
  readonly seen = new Set<string>();
  /** The object being read, for its unread parts. */
  private owner: ReqifOwner | undefined;
  header: ReqifHeader | undefined;
  readonly unread: ReqifUnread[] = [];
  readonly datatypes: ReqifDatatype[] = [];
  readonly specTypes: ReqifSpecType[] = [];
  readonly specObjects: ReqifSpecObject[] = [];
  readonly specRelations: ReqifSpecRelation[] = [];
  readonly specifications: ReqifSpecification[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  open(
    name: string,
    attributes: readonly XmlAttribute[],
    line: number,
    _start: number,
    _contentStart: number,
    _selfClosing: boolean,
    above: Frame | undefined,
  ): Frame {
    const parent = above ?? DOCUMENT;
    if (parent.role === "skip") {
      // The scanner keeps an entry per open element.
      this.charge(OBJECT, line);
      return SKIP;
    }
    const declared = this.declare(attributes, line);
    const node = this.node(name, attributes, line);
    const role: Role =
      parent.role === "document"
        ? "root"
        : parent.role === "part" && !isItem(parent.node.name, node)
          ? "skip"
          : roleOf(parent.role, node);
    if (role === "root" && !isReqif(node, "REQ-IF")) {
      throw new Invalid(
        `The root element is <${shown(name)}> in ${shown(node.namespace || "no namespace")}, not <REQ-IF> of ReqIF 1.2`,
        line,
      );
    }
    if (role === "skip") {
      for (const stack of declared) {
        stack.pop();
      }
      this.record(node);
      this.charge(OBJECT, line);
      return SKIP;
    }
    this.enter(parent.role, role, node);
    let bytes = 3 * OBJECT;
    for (const text of node.attributes) {
      bytes += STRING + CHAR * text.length;
    }
    this.charge(bytes, line);
    return { role, node, into: parent.node.content, declared };
  }

  text(frame: Frame, text: string): void {
    // Outside XHTML only references and header fields have text: whitespace between elements goes.
    if (!WITH_TEXT.has(frame.role) || (frame.role === "inner" && text.trim() === "")) {
      return;
    }
    this.charge(OBJECT + CHAR * text.length, frame.node.line);
    const { content } = frame.node;
    const last = content.length - 1;
    const before = content[last];
    if (typeof before === "string") {
      content[last] = before + text;
    } else {
      content.push(text);
    }
  }

  close(frame: Frame): void {
    const { role, node, into } = frame;
    for (const stack of frame.declared) {
      stack.pop();
    }
    // The scanner entry and the frame go; the node, its strings and the model stay counted.
    this.kept -= role === "skip" ? OBJECT : 2 * OBJECT;
    if (role === "xhtml") {
      // Only strings and XHTML elements are inside an XHTML value (`roleOf` refuses ReqIF ones).
      const children = node.content as XhtmlNode[];
      into.push({
        name: node.name,
        namespace: node.namespace,
        attributes: node.attributes,
        // A copy of exact length: the array grown by pushes keeps spare slots.
        children: children.length === 0 ? NO_CHILDREN : children.slice(),
      });
    } else if (role === "inner" || role === "value") {
      if (isReqif(node, "SPEC-HIERARCHY")) {
        node.hierarchy = {
          ...identifiable(node),
          object: refIn(node, "OBJECT", "SPEC-OBJECT-REF"),
          children: this.each(reqifChild(node, "CHILDREN"), (child) => child.hierarchy),
        };
        this.leftovers(node);
        node.content.length = 0;
      }
      into.push(node);
    } else if (role === "item") {
      this.item(node);
      this.leftovers(node);
      this.owner = undefined;
    } else if (role === "header") {
      this.header = this.headerOf(node);
      this.leftovers(node);
    }
  }

  /** Notes a kept element: refuses a part met twice, and starts the owner of an item. */
  private enter(parent: Role, role: Role, node: Node): void {
    const part = `${parent} ${node.name}`;
    if ((parent === "root" || parent === "content") && node.namespace === REQIF_NAMESPACE) {
      if (this.seen.has(part)) {
        throw new Invalid(`<${node.name}> appears twice`, node.line);
      }
      this.seen.add(part);
    }
    if (role === "item") {
      const kind = OWNERS.get(node.name);
      this.owner = kind === undefined ? undefined : { kind, identifier: attribute(node, "IDENTIFIER") ?? "" };
    }
    this.seen.add(role);
  }

  private charge(bytes: number, line: number): void {
    this.kept += bytes;
    if (this.kept > this.limit) {
      throw new Invalid(`Reading the file would keep more than ${String(this.limit)} bytes in memory`, line);
    }
  }

  /** Pushes the namespace declarations of a start tag; gives the stacks to pop at its end. */
  private declare(attributes: readonly XmlAttribute[], line: number): readonly string[][] {
    let declared: string[][] | undefined;
    for (const { name, value } of attributes) {
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        const prefix = name === "xmlns" ? "" : name.slice(6);
        if (prefix !== "" && value === "") {
          throw new Invalid(`${shown(name)} has an empty namespace (Namespaces in XML 1.0)`, line);
        }
        let stack = this.namespaces.get(prefix);
        if (stack === undefined) {
          stack = [];
          this.namespaces.set(prefix, stack);
        }
        stack.push(value);
        (declared ??= []).push(stack);
      }
    }
    return declared ?? NO_DECLARED;
  }

  /** The element `name` with its namespace and the namespaces of its attribute prefixes checked. */
  private node(name: string, attributes: readonly XmlAttribute[], line: number): Node {
    // An unprefixed attribute is in no namespace; an unprefixed element in the default one.
    const namespaceOf = (qualified: string, element: boolean): string => {
      const colon = qualified.indexOf(":");
      if (colon === 0 || qualified.includes(":", colon + 1)) {
        throw new Invalid(`${shown(qualified)} in <${shown(name)}> is not a qualified name`, line);
      }
      const namespace =
        colon === -1 && !element ? "" : this.namespaces.get(qualified.slice(0, Math.max(colon, 0)))?.at(-1);
      if (namespace === undefined) {
        throw new Invalid(`${shown(qualified)} in <${shown(name)}> has an undeclared prefix`, line);
      }
      return namespace;
    };
    let own: string[] | undefined;
    for (const { name: qualified, value } of attributes) {
      if (qualified !== "xmlns" && !qualified.startsWith("xmlns:")) {
        namespaceOf(qualified, false);
        (own ??= []).push(qualified, value);
      }
    }
    return {
      namespace: namespaceOf(name, true),
      name: name.slice(name.indexOf(":") + 1),
      attributes: own ?? NO_STRINGS,
      line,
      content: [],
    };
  }

  private record(node: Node): void {
    this.charge(2 * OBJECT + CHAR * node.name.length, node.line);
    const { name, namespace, line } = node;
    this.unread.push({ name, namespace, line, ...(this.owner === undefined ? {} : { owner: this.owner }) });
  }

  /** Records every element below `node` the reader did not look at (the topmost of each). */
  private leftovers(node: Node): void {
    const pending = [node];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      for (const child of elements(next)) {
        if (child.read === true) {
          pending.push(child);
        } else {
          this.record(child);
        }
      }
    }
  }

  /** Reads an item; `isItem` chose it. */
  private item(node: Node): void {
    switch (node.name) {
      case "SPEC-OBJECT":
        this.specObjects.push({
          ...identifiable(node),
          type: refIn(node, "TYPE", "SPEC-OBJECT-TYPE-REF"),
          values: this.values(node),
        });
        return;
      case "SPEC-RELATION":
        this.specRelations.push({
          ...identifiable(node),
          type: refIn(node, "TYPE", "SPEC-RELATION-TYPE-REF"),
          source: refIn(node, "SOURCE", "SPEC-OBJECT-REF"),
          target: refIn(node, "TARGET", "SPEC-OBJECT-REF"),
          values: this.values(node),
        });
        return;
      case "SPECIFICATION":
        this.specifications.push({
          ...identifiable(node),
          type: refIn(node, "TYPE", "SPECIFICATION-TYPE-REF"),
          values: this.values(node),
          children: this.each(reqifChild(node, "CHILDREN"), (child) => child.hierarchy),
        });
        return;
      default: {
        const kind = kindOf(node, "DATATYPE-DEFINITION-");
        if (kind === undefined) {
          this.specTypes.push(this.specType(node, categoryOf(node.name)));
        } else {
          this.datatypes.push(this.datatype(node, kind));
        }
      }
    }
  }

  /** Every element child of `node` that `read` gives a value for; the others are unread. */
  private each<T>(node: Node | undefined, read: (child: Node) => T | undefined): T[] {
    const found: T[] = [];
    for (const child of node === undefined ? [] : elements(node)) {
      child.read = true;
      const value = read(child);
      if (value === undefined) {
        this.record(child);
      } else {
        found.push(value);
      }
    }
    return found;
  }

  private datatype(node: Node, kind: ReqifDatatypeKind): ReqifDatatype {
    const values = this.each(reqifChild(node, "SPECIFIED-VALUES"), (value) => {
      if (!isReqif(value, "ENUM-VALUE")) {
        return undefined;
      }
      const embedded = reqifChild(required(value, "PROPERTIES"), "EMBEDDED-VALUE") ?? EMPTY_NODE;
      const key = attribute(embedded, "KEY");
      const otherContent = attribute(embedded, "OTHER-CONTENT");
      return {
        ...identifiable(value),
        ...(key === undefined ? {} : { key }),
        ...(otherContent === undefined ? {} : { otherContent }),
      };
    });
    return { ...identifiable(node), kind, values };
  }

  private specType(node: Node, category: ReqifSpecTypeCategory): ReqifSpecType {
    const attributes = this.each(
      reqifChild(node, "SPEC-ATTRIBUTES"),
      (definition): ReqifAttributeDefinition | undefined => {
        const kind = kindOf(definition, "ATTRIBUTE-DEFINITION-");
        if (kind === undefined) {
          return undefined;
        }
        const own = identifiable(definition);
        // One value; anything else inside DEFAULT-VALUE is unread.
        let taken = 0;
        const [defaultValue] = this.each(reqifChild(definition, "DEFAULT-VALUE"), (value) => {
          const read = taken === 0 ? this.value(value, own.identifier) : undefined;
          taken += read === undefined ? 0 : 1;
          return read;
        });
        return {
          ...own,
          kind,
          datatype: refIn(definition, "TYPE", `${definition.name.replace("ATTRIBUTE", "DATATYPE")}-REF`),
          multiValued: isTrue(attribute(definition, "MULTI-VALUED")),
          ...(defaultValue === undefined ? {} : { defaultValue }),
        };
      },
    );
    return { ...identifiable(node), category, attributes };
  }

  private values(node: Node): ReqifValue[] {
    return this.each(reqifChild(node, "VALUES"), (value) => this.value(value));
  }

  /**
   * One ATTRIBUTE-VALUE-…, or undefined for another element. A default value (`own`: the IDENTIFIER
   * of its attribute definition) belongs to that definition and may leave out its DEFINITION.
   */
  private value(value: Node, own?: string): ReqifValue | undefined {
    const kind = kindOf(value, "ATTRIBUTE-VALUE-");
    if (kind === undefined) {
      return undefined;
    }
    const written =
      own === undefined || reqifChild(value, "DEFINITION") !== undefined
        ? refIn(value, "DEFINITION", `${value.name.replace("VALUE", "DEFINITION")}-REF`)
        : own;
    const definition = own ?? written;
    if (kind === "xhtml") {
      // Only strings and XHTML elements are inside THE-VALUE (`roleOf` refuses ReqIF ones).
      return { kind, definition, value: (required(value, "THE-VALUE").content as XhtmlNode[]).slice() };
    }
    if (kind === "enumeration") {
      const refs = reqifChildren(reqifChild(value, "VALUES") ?? value, "ENUM-VALUE-REF");
      return { kind, definition, values: refs.map((ref) => textOf(ref).trim()) };
    }
    const theValue = attribute(value, "THE-VALUE");
    if (theValue === undefined) {
      throw new Invalid(`<${value.name}> has no THE-VALUE`, value.line);
    }
    return { kind, definition, value: theValue };
  }

  private headerOf(theHeader: Node): ReqifHeader {
    const node = required(theHeader, "REQ-IF-HEADER");
    const fields = Object.entries(HEADER_FIELDS).flatMap(([field, name]): [string, string][] => {
      const child = reqifChild(node, name);
      return child === undefined ? [] : [[field, textOf(child)]];
    });
    return { identifier: identifiable(node).identifier, ...Object.fromEntries(fields) };
  }
}

/** Every identifiable of the file, the nested SPEC-HIERARCHY included (walked without recursion). */
const identifiables = (file: ReqifFile): ReqifIdentifiable[] => {
  const hierarchies: ReqifIdentifiable[] = [];
  const pending = file.specifications.flatMap((specification) => specification.children);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    hierarchies.push(next);
    pending.push(...next.children);
  }
  return [
    ...file.datatypes.flatMap((datatype) => [datatype, ...datatype.values]),
    ...file.specTypes.flatMap((type) => [type, ...type.attributes]),
    ...file.specObjects,
    ...file.specRelations,
    ...file.specifications,
    ...hierarchies,
  ];
};

/** The IDENTIFIERs of the file; one used twice makes references ambiguous and refuses the file. */
const definedIdentifiers = (file: ReqifFile): ReadonlySet<string> => {
  const defined = new Set<string>([file.header.identifier]);
  for (const item of identifiables(file)) {
    if (defined.has(item.identifier)) {
      throw new Invalid(`IDENTIFIER ${shown(item.identifier)} is used twice`, item.line);
    }
    defined.add(item.identifier);
  }
  return defined;
};

/** A warning for every reference to an IDENTIFIER the file does not define. */
const danglingReferences = (file: ReqifFile, defined: ReadonlySet<string>): ReqifWarning[] => {
  const warnings: ReqifWarning[] = [];
  const check = (owner: ReqifIdentifiable, what: string, reference: string): void => {
    if (!defined.has(reference)) {
      const { identifier, line } = owner;
      warnings.push({
        message: `${what} ${shown(reference)} of ${shown(identifier)} is not in the file`,
        line,
        identifier,
      });
    }
  };
  const checkValues = (owner: ReqifIdentifiable, values: readonly ReqifValue[]): void => {
    for (const value of values) {
      check(owner, "Attribute definition", value.definition);
      for (const reference of value.kind === "enumeration" ? value.values : []) {
        check(owner, "Enumeration value", reference);
      }
    }
  };
  for (const definition of file.specTypes.flatMap((type) => type.attributes)) {
    check(definition, "Datatype", definition.datatype);
    const { defaultValue } = definition;
    for (const reference of defaultValue?.kind === "enumeration" ? defaultValue.values : []) {
      check(definition, "Enumeration value", reference);
    }
  }
  for (const object of file.specObjects) {
    check(object, "SPEC-OBJECT-TYPE", object.type);
    checkValues(object, object.values);
  }
  for (const relation of file.specRelations) {
    check(relation, "SPEC-RELATION-TYPE", relation.type);
    check(relation, "Source", relation.source);
    check(relation, "Target", relation.target);
    checkValues(relation, relation.values);
  }
  for (const specification of file.specifications) {
    check(specification, "SPECIFICATION-TYPE", specification.type);
    checkValues(specification, specification.values);
  }
  for (const hierarchy of identifiables(file).filter((item): item is ReqifHierarchy => "object" in item)) {
    check(hierarchy, "SPEC-OBJECT", hierarchy.object);
  }
  return warnings;
};

/** Reads the bytes of a ReqIF 1.2 file (`.reqif`; a `.reqifz` archive is not read, SR-053). */
export const parseReqif = (bytes: Uint8Array, limits: ReqifLimits = REQIF_LIMITS): ReqifParseOutcome => {
  if (bytes.length > limits.bytes) {
    return {
      kind: "refused",
      message: `The file has ${String(bytes.length)} bytes; ReqSeq reads ReqIF files up to ${String(limits.bytes)} bytes`,
      line: 1,
    };
  }
  const reader = new Reader(limits.retained);
  try {
    const streamed = streamXml(bytes, reader);
    if (streamed.kind === "refused") {
      return { kind: "refused", message: streamed.message, line: streamed.line };
    }
    const { line } = streamed.root.node;
    if (!reader.seen.has("core")) {
      throw new Invalid("<REQ-IF> has no <CORE-CONTENT>", line);
    }
    if (!reader.seen.has("content")) {
      throw new Invalid("<CORE-CONTENT> has no <REQ-IF-CONTENT>", line);
    }
    if (reader.header === undefined) {
      throw new Invalid("<REQ-IF> has no <THE-HEADER>", line);
    }
    const { header, datatypes, specTypes, specObjects, specRelations, specifications, unread } = reader;
    const file = { header, datatypes, specTypes, specObjects, specRelations, specifications, unread };
    return { kind: "parsed", file, warnings: danglingReferences(file, definedIdentifiers(file)) };
  } catch (error) {
    if (error instanceof Invalid) {
      return { kind: "refused", message: error.message, line: error.line };
    }
    throw error;
  }
};
