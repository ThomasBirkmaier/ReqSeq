// Writes the model of `model.ts` as a ReqIF 1.2 file (ADR-0013): UTF-8 without BOM, LF, a fixed
// order, no indentation, no dependency. The writer invents nothing: a field the standard makes
// mandatory and the model leaves out, a character XML 1.0 cannot carry, an IDENTIFIER that is no
// NCName, a STRING longer than its MAX-LENGTH and content outside XHTML refuse the file with every
// problem named. Nesting (XHTML, SPEC-HIERARCHY) is walked without recursion, and the output is a
// list of chunks the caller writes one after the other, never one string of the whole file.
// Details in packages/core/docs/reqif.md.
import type {
  ReqifAttributeDefinition,
  ReqifDatatype,
  ReqifFile,
  ReqifHierarchy,
  ReqifIdentifiable,
  ReqifSpecType,
  ReqifValue,
  XhtmlNode,
} from "./model.js";
import { REQIF_NAMESPACE, XHTML_NAMESPACE } from "./model.js";

/** A type without the reader's line numbers, at every depth. */
type Unlined<T> = T extends string | number | boolean
  ? T
  : T extends readonly (infer U)[]
    ? readonly Unlined<U>[]
    : { readonly [K in keyof T as K extends "line" ? never : K]: Unlined<T[K]> };

/** What the writer takes: the model without line numbers and without the reader's `unread`. */
export type ReqifWritable = Unlined<Omit<ReqifFile, "unread">>;

/**
 * Every problem names the IDENTIFIER it belongs to and its `field`: the IDENTIFIER of the attribute
 * definition for a value, else the ReqIF attribute or element (`LONG-NAME`, `TITLE`, `ENUM-VALUE-REF`).
 * `at` says where inside the field: `THE-VALUE`, or the XHTML element, attribute or text node.
 */
export type ReqifWriteProblem =
  /** A field the standard makes mandatory (ReqIF 1.2 §9.2.3, §10.8.3, §10.8.25, §10.8.26, §10.8.28, §10.8.30, §10.8.31, §10.8.32). */
  | { readonly kind: "missing-field"; readonly identifier: string; readonly field: string }
  /** A character XML 1.0 has no form for, not even a reference; `offset` counts UTF-16 units of that string from 0. */
  | {
      readonly kind: "invalid-character";
      readonly identifier: string;
      readonly field: string;
      readonly at: string;
      readonly codePoint: number;
      readonly offset: number;
    }
  /** An IDENTIFIER that is no NCName (§10.8.32), or a STRING value longer than its MAX-LENGTH (§10.8.28). */
  | {
      readonly kind: "invalid-value";
      readonly identifier: string;
      readonly field: string;
      readonly reason: string;
    }
  /**
   * In a value: THE-VALUE that is not one `div` or `p`, an element outside the XHTML namespace, `img`,
   * a prefix other than `xml:`, or a name that is no XML name.
   */
  | {
      readonly kind: "unsupported-content";
      readonly identifier: string;
      readonly field: string;
      readonly name: string;
    };

export type ReqifWriteOutcome =
  /** The file as chunks of text, to be written (UTF-8) in order. */
  | { readonly kind: "written"; readonly chunks: readonly string[] }
  | { readonly kind: "refused"; readonly problems: readonly ReqifWriteProblem[] };

/** REQ-IF-VERSION has this fixed value (ReqIF 1.2 §9.2.3). */
const REQIF_VERSION = "1.0";
/** Pieces joined into one chunk; a chunk stays far below V8's string limit. */
const CHUNK = 4096;
// C0 controls but TAB, LF and CR, U+FFFE, U+FFFF and, with the `u` flag, lone surrogates only.
// eslint-disable-next-line no-control-regex -- these control characters are exactly what XML 1.0 cannot carry
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/gu;
/** An NCName, the type of every IDENTIFIER (`xsd:ID`). */
const NC_NAME = /^[\p{L}_][\p{L}\p{N}\p{Mn}\p{Mc}_.·-]*$/u;
/** An XML name without prefix, as an XHTML element or attribute local name. */
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;
const LOCAL_NAME = /^[A-Za-z_][\w.-]*$/;
const escapeText = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\r", "&#13;");
const escapeAttribute = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");

/** `[name, value, name, value, …]` as pairs. */
const pairs = (list: readonly string[]): [string, string][] => {
  const found: [string, string][] = [];
  let name: string | undefined;
  for (const item of list) {
    if (name === undefined) {
      name = item;
    } else {
      found.push([name, item]);
      name = undefined;
    }
  }
  return found;
};
type Datatype = Unlined<ReqifDatatype>;
type SpecType = Unlined<ReqifSpecType>;
type Definition = Unlined<ReqifAttributeDefinition>;
type Value = Unlined<ReqifValue>;
type Hierarchy = Unlined<ReqifHierarchy>;
type Identifiable = Unlined<ReqifIdentifiable>;
type Node = Unlined<XhtmlNode>;

const SPEC_TYPE_NAMES: Readonly<Record<SpecType["category"], string>> = {
  "spec-object": "SPEC-OBJECT-TYPE",
  "spec-relation": "SPEC-RELATION-TYPE",
  specification: "SPECIFICATION-TYPE",
  "relation-group": "RELATION-GROUP-TYPE",
};
/** The facets each datatype kind must have, as model field and attribute name. */
const FACETS: Readonly<
  Record<Datatype["kind"], readonly (readonly ["maxLength" | "min" | "max" | "accuracy", string])[]>
> = {
  string: [["maxLength", "MAX-LENGTH"]],
  integer: [
    ["min", "MIN"],
    ["max", "MAX"],
  ],
  real: [
    ["min", "MIN"],
    ["max", "MAX"],
    ["accuracy", "ACCURACY"],
  ],
  xhtml: [],
  date: [],
  boolean: [],
  enumeration: [],
};

class Writer {
  private readonly out: string[] = [];
  readonly chunks: string[] = [];
  readonly problems: ReqifWriteProblem[] = [];
  /** The IDENTIFIER the problems of what is written now belong to. */
  private owner = "";
  /** MAX-LENGTH of each STRING attribute definition, by its IDENTIFIER. */
  private readonly maxLengths = new Map<string, number>();

  file(file: ReqifWritable): void {
    this.measure(file);
    this.push('<?xml version="1.0" encoding="UTF-8"?>\n');
    this.open("REQ-IF", ["xmlns", REQIF_NAMESPACE, "xmlns:xhtml", XHTML_NAMESPACE]);
    this.header(file.header);
    this.open("CORE-CONTENT");
    this.open("REQ-IF-CONTENT");
    this.part("DATATYPES", file.datatypes, (datatype) => {
      this.datatype(datatype);
    });
    this.part("SPEC-TYPES", file.specTypes, (type) => {
      this.specType(type);
    });
    this.part("SPEC-OBJECTS", file.specObjects, (object) => {
      this.item("SPEC-OBJECT", object, [], () => {
        this.values(object.values);
        this.reference("TYPE", "SPEC-OBJECT-TYPE-REF", object.type);
      });
    });
    this.part("SPEC-RELATIONS", file.specRelations, (relation) => {
      this.item("SPEC-RELATION", relation, [], () => {
        this.values(relation.values);
        this.reference("SOURCE", "SPEC-OBJECT-REF", relation.source);
        this.reference("TARGET", "SPEC-OBJECT-REF", relation.target);
        this.reference("TYPE", "SPEC-RELATION-TYPE-REF", relation.type);
      });
    });
    this.part("SPECIFICATIONS", file.specifications, (specification) => {
      this.item("SPECIFICATION", specification, [], () => {
        this.values(specification.values);
        this.hierarchy(specification.children);
        this.reference("TYPE", "SPECIFICATION-TYPE-REF", specification.type);
      });
    });
    this.close("REQ-IF-CONTENT");
    this.close("CORE-CONTENT");
    this.close("REQ-IF");
    this.push("\n");
    this.chunks.push(this.out.join(""));
  }

  /** The MAX-LENGTH of every STRING attribute definition, to check the values against. */
  private measure(file: ReqifWritable): void {
    const limits = new Map<string, number>();
    for (const datatype of file.datatypes) {
      if (datatype.maxLength !== undefined && /^\d+$/.test(datatype.maxLength)) {
        limits.set(datatype.identifier, Number(datatype.maxLength));
      }
    }
    for (const definition of file.specTypes.flatMap((type) => type.attributes)) {
      const limit = limits.get(definition.datatype);
      if (limit !== undefined) {
        this.maxLengths.set(definition.identifier, limit);
      }
    }
  }

  private header(header: ReqifWritable["header"]): void {
    this.owner = header.identifier;
    this.open("THE-HEADER");
    this.open("REQ-IF-HEADER", ["IDENTIFIER", this.identifier(header.identifier)]);
    // The schema's sequence (ReqIF 1.2 §9.2.3).
    const fields: readonly [string, string | undefined, boolean][] = [
      ["COMMENT", header.comment, false],
      ["CREATION-TIME", header.creationTime, true],
      ["REPOSITORY-ID", header.repositoryId, false],
      ["REQ-IF-TOOL-ID", header.toolId, true],
      ["REQ-IF-VERSION", REQIF_VERSION, true],
      ["SOURCE-TOOL-ID", header.sourceToolId, true],
      ["TITLE", header.title, true],
    ];
    for (const [name, value, mandatory] of fields) {
      if (value === undefined) {
        this.missing(mandatory, name);
      } else {
        this.push(`<${name}>${this.text(value, name, name)}</${name}>`);
      }
    }
    this.close("REQ-IF-HEADER");
    this.close("THE-HEADER");
  }

  private part<T>(name: string, items: readonly T[], write: (item: T) => void): void {
    this.open(name);
    for (const item of items) {
      write(item);
    }
    this.close(name);
  }

  private datatype(datatype: Datatype): void {
    this.owner = datatype.identifier;
    const facets: string[] = [];
    for (const [field, name] of FACETS[datatype.kind]) {
      const value = datatype[field];
      if (value === undefined) {
        this.missing(true, name);
      } else {
        facets.push(name, value);
      }
    }
    this.item(`DATATYPE-DEFINITION-${datatype.kind.toUpperCase()}`, datatype, facets, () => {
      if (datatype.values.length > 0) {
        this.part("SPECIFIED-VALUES", datatype.values, (value) => {
          this.item("ENUM-VALUE", value, [], () => {
            this.needsLongName(value);
            this.open("PROPERTIES");
            const attributes: string[] = [];
            for (const [name, field] of [
              ["KEY", value.key],
              ["OTHER-CONTENT", value.otherContent],
            ] as const) {
              if (field === undefined) {
                this.missing(true, name);
              } else {
                attributes.push(name, field);
              }
            }
            this.push(`<EMBEDDED-VALUE${this.attributes(attributes)}/>`);
            this.close("PROPERTIES");
          });
        });
      }
    });
  }

  private specType(type: SpecType): void {
    this.item(SPEC_TYPE_NAMES[type.category], type, [], () => {
      if (type.attributes.length > 0) {
        this.part("SPEC-ATTRIBUTES", type.attributes, (definition) => {
          this.definition(definition);
        });
      }
    });
  }

  private definition(definition: Definition): void {
    const kind = definition.kind.toUpperCase();
    const multiValued =
      definition.kind === "enumeration" ? ["MULTI-VALUED", String(definition.multiValued)] : [];
    this.item(`ATTRIBUTE-DEFINITION-${kind}`, definition, multiValued, () => {
      this.needsLongName(definition);
      if (definition.defaultValue !== undefined) {
        this.open("DEFAULT-VALUE");
        this.value({ ...definition.defaultValue, definition: definition.identifier });
        this.close("DEFAULT-VALUE");
      }
      this.reference("TYPE", `DATATYPE-DEFINITION-${kind}-REF`, definition.datatype);
    });
  }

  /** LONG-NAME is mandatory for an attribute definition (§10.8.3) and an enumeration value (§10.8.31). */
  private needsLongName(item: Identifiable): void {
    this.missing(item.longName === undefined, "LONG-NAME");
  }

  private values(values: readonly Value[]): void {
    if (values.length > 0) {
      this.part("VALUES", values, (value) => {
        this.value(value);
      });
    }
  }

  private value(value: Value): void {
    const kind = value.kind.toUpperCase();
    const name = `ATTRIBUTE-VALUE-${kind}`;
    const field = value.definition;
    const definition = (): void => {
      this.reference("DEFINITION", `ATTRIBUTE-DEFINITION-${kind}-REF`, value.definition);
    };
    if (value.kind === "xhtml") {
      this.open(name);
      this.push("<THE-VALUE>");
      this.xhtml(value.value, field);
      this.push("</THE-VALUE>");
      definition();
      this.close(name);
    } else if (value.kind === "enumeration") {
      this.open(name);
      definition();
      this.open("VALUES");
      for (const reference of value.values) {
        this.push(`<ENUM-VALUE-REF>${this.text(reference, field, "ENUM-VALUE-REF")}</ENUM-VALUE-REF>`);
      }
      this.close("VALUES");
      this.close(name);
    } else {
      const limit = value.kind === "string" ? this.maxLengths.get(field) : undefined;
      // Code points: a surrogate pair is one character.
      const length = limit === undefined ? 0 : value.value.replaceAll(SURROGATE_PAIR, "_").length;
      if (limit !== undefined && length > limit) {
        this.invalid(field, `${String(length)} characters, more than MAX-LENGTH ${String(limit)}`);
      }
      this.push(`<${name} THE-VALUE="${this.attribute(value.value, field, "THE-VALUE")}">`);
      definition();
      this.close(name);
    }
  }

  /** The hierarchy below a SPECIFICATION, walked without recursion. */
  private hierarchy(children: readonly Hierarchy[]): void {
    if (children.length === 0) {
      return;
    }
    const owner = this.owner;
    // An entry is a hierarchy to open, or one to close after its children.
    const pending: (Hierarchy | { readonly closes: Hierarchy })[] = [];
    const push = (list: readonly Hierarchy[]): void => {
      for (const item of [...list].reverse()) {
        pending.push(item);
      }
    };
    this.open("CHILDREN");
    push(children);
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if ("closes" in next) {
        this.owner = next.closes.identifier;
        if (next.closes.children.length > 0) {
          this.close("CHILDREN");
        }
        this.reference("OBJECT", "SPEC-OBJECT-REF", next.closes.object);
        this.close("SPEC-HIERARCHY");
      } else {
        this.open("SPEC-HIERARCHY", this.identifying(next));
        pending.push({ closes: next });
        if (next.children.length > 0) {
          this.open("CHILDREN");
          push(next.children);
        }
      }
    }
    this.owner = owner;
    this.close("CHILDREN");
  }

  /**
   * XHTML nodes as `xhtml:` elements, walked without recursion. A refused element's content is still
   * walked, so every problem inside it is named too (the file is refused anyway).
   */
  private xhtml(nodes: readonly Node[], field: string): void {
    // A node to write with the name of its parent element, or the name of an element to close.
    const pending: ({ readonly node: Node; readonly parent: string } | { readonly closes: string })[] = [];
    const push = (list: readonly Node[], parent: string): void => {
      for (const node of [...list].reverse()) {
        pending.push({ node, parent });
      }
    };
    const [first] = nodes;
    // THE-VALUE holds exactly one block element (ReqIF 1.2 §10.8.45).
    if (nodes.length !== 1 || typeof first !== "object" || !["div", "p"].includes(first.name)) {
      this.unsupported(field, "THE-VALUE without exactly one <div> or <p>");
    }
    push(nodes, "THE-VALUE");
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if ("closes" in next) {
        this.push(`</xhtml:${next.closes}>`);
        continue;
      }
      const { node, parent } = next;
      if (typeof node === "string") {
        this.push(this.text(node, field, `text in ${parent}`));
      } else if (node.namespace !== XHTML_NAMESPACE || !LOCAL_NAME.test(node.name)) {
        this.unsupported(field, `<${node.name}> in ${node.namespace || "no namespace"}`);
        push(node.children, parent);
      } else if (node.name === "img") {
        // ADR-0013: images are written as <object>; <img> is read on import only.
        this.unsupported(field, "<img>, written as <object>");
        push(node.children, parent);
      } else {
        const element = `<xhtml:${node.name}>`;
        this.push(`<xhtml:${node.name}${this.xhtmlAttributes(node.attributes, field, element)}>`);
        pending.push({ closes: node.name });
        push(node.children, element);
      }
    }
  }

  private xhtmlAttributes(attributes: readonly string[], field: string, element: string): string {
    let written = "";
    for (const [name, value] of pairs(attributes)) {
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        // A declaration, not content: the writer declares the namespaces it uses.
        continue;
      }
      const local = name.startsWith("xml:") ? name.slice(4) : name;
      if (!LOCAL_NAME.test(local)) {
        this.unsupported(field, name);
        continue;
      }
      written += ` ${name}="${this.attribute(value, field, `${name} of ${element}`)}"`;
    }
    return written;
  }

  /** An identifiable element with its own `attributes` after the common ones, and its `content`. */
  private item(name: string, item: Identifiable, attributes: readonly string[], content: () => void): void {
    this.open(name, [...this.identifying(item), ...attributes]);
    content();
    this.close(name);
  }

  /** IDENTIFIER, LAST-CHANGE, LONG-NAME and DESC (ReqIF 1.2 §10.8.32); sets the owner of the problems. */
  private identifying(item: Identifiable): string[] {
    this.owner = item.identifier;
    const attributes = ["IDENTIFIER", this.identifier(item.identifier)];
    if (item.lastChange === undefined) {
      this.missing(true, "LAST-CHANGE");
    } else {
      attributes.push("LAST-CHANGE", item.lastChange);
    }
    for (const [name, value] of [
      ["LONG-NAME", item.longName],
      ["DESC", item.desc],
    ] as const) {
      if (value !== undefined) {
        attributes.push(name, value);
      }
    }
    return attributes;
  }

  /** An IDENTIFIER must be an NCName (`xsd:ID`, §10.8.32). */
  private identifier(identifier: string): string {
    if (!NC_NAME.test(identifier)) {
      this.invalid("IDENTIFIER", "not an NCName (xsd:ID)");
    }
    return identifier;
  }

  private reference(wrapper: string, name: string, identifier: string): void {
    this.push(`<${wrapper}><${name}>${this.text(identifier, name, name)}</${name}></${wrapper}>`);
  }

  private open(name: string, attributes: readonly string[] = []): void {
    this.push(`<${name}${this.attributes(attributes)}>`);
  }

  private close(name: string): void {
    this.push(`</${name}>`);
  }

  private push(piece: string): void {
    this.out.push(piece);
    if (this.out.length >= CHUNK) {
      this.chunks.push(this.out.join(""));
      this.out.length = 0;
    }
  }

  private attributes(attributes: readonly string[]): string {
    let written = "";
    for (const [name, value] of pairs(attributes)) {
      written += name.startsWith("xmlns")
        ? ` ${name}="${value}"`
        : ` ${name}="${this.attribute(value, name, name)}"`;
    }
    return written;
  }

  private text(text: string, field: string, at: string): string {
    this.check(text, field, at);
    return escapeText(text);
  }

  private attribute(text: string, field: string, at: string): string {
    this.check(text, field, at);
    return escapeAttribute(text);
  }

  private check(text: string, field: string, at: string): void {
    for (const match of text.matchAll(NOT_XML)) {
      this.problems.push({
        kind: "invalid-character",
        identifier: this.owner,
        field,
        at,
        codePoint: match[0].charCodeAt(0),
        offset: match.index,
      });
    }
  }

  private missing(missing: boolean, field: string): void {
    if (missing) {
      this.problems.push({ kind: "missing-field", identifier: this.owner, field });
    }
  }

  private invalid(field: string, reason: string): void {
    this.problems.push({ kind: "invalid-value", identifier: this.owner, field, reason });
  }

  private unsupported(field: string, name: string): void {
    this.problems.push({ kind: "unsupported-content", identifier: this.owner, field, name });
  }
}

/** `problem` as a sentence, for a refusal. */
export const problemText = (problem: ReqifWriteProblem): string => {
  switch (problem.kind) {
    case "missing-field":
      return `${problem.identifier}: ${problem.field} is missing`;
    case "invalid-character":
      return `${problem.identifier}: ${problem.field} holds U+${problem.codePoint.toString(16).toUpperCase().padStart(4, "0")} at ${String(problem.offset)} (${problem.at}), which XML 1.0 cannot carry`;
    case "invalid-value":
      return `${problem.identifier}: ${problem.field}: ${problem.reason}`;
    case "unsupported-content":
      return `${problem.identifier}: ${problem.field}: ${problem.name} cannot be written`;
  }
};

/** The ReqIF 1.2 file of `file` as chunks, or every reason it cannot be written. */
export const writeReqif = (file: ReqifWritable): ReqifWriteOutcome => {
  const writer = new Writer();
  writer.file(file);
  return writer.problems.length === 0
    ? { kind: "written", chunks: writer.chunks }
    : { kind: "refused", problems: writer.problems };
};
