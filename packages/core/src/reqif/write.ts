// Writes the model of `model.ts` as a ReqIF 1.2 file (ADR-0013): UTF-8 without BOM, LF, a fixed
// order, no dependency. The writer invents nothing: a field the schema makes mandatory and the model
// leaves out, a character XML 1.0 cannot carry, and content outside XHTML refuse the file with every
// problem named. Nesting (XHTML, SPEC-HIERARCHY) is walked without recursion, and the output is one
// array of strings joined once. Details in packages/core/docs/reqif.md.
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

export type ReqifWriteProblem =
  /** A field the schema makes mandatory (ReqIF 1.2 §9.2.3, §10.8.25, §10.8.26, §10.8.28, §10.8.30, §10.8.32). */
  | { readonly kind: "missing-field"; readonly identifier: string; readonly field: string }
  /** A character XML 1.0 has no form for, not even a reference; `offset` counts UTF-16 units from 0. */
  | {
      readonly kind: "invalid-character";
      readonly identifier: string;
      readonly field: string;
      readonly codePoint: number;
      readonly offset: number;
    }
  /** An element outside the XHTML namespace or an attribute with a prefix other than `xml:` in a value. */
  | {
      readonly kind: "unsupported-content";
      readonly identifier: string;
      readonly field: string;
      readonly name: string;
    };

export type ReqifWriteOutcome =
  | { readonly kind: "written"; readonly xml: string }
  | { readonly kind: "refused"; readonly problems: readonly ReqifWriteProblem[] };

/** REQ-IF-VERSION has this fixed value (ReqIF 1.2 §9.2.3). */
const REQIF_VERSION = "1.0";
/** Indentation stops here, so a deep hierarchy does not grow the file quadratically. */
const MAX_INDENT = 16;
/** A line break and the indentation of the deepest level; a line takes its start. */
const INDENT = `\n${"  ".repeat(MAX_INDENT)}`;
/** Strings collected before they are joined into one chunk, which keeps the array of a large file small. */
const CHUNK = 4096;
// C0 controls but TAB, LF and CR, U+FFFE, U+FFFF and, with the `u` flag, lone surrogates only.
// eslint-disable-next-line no-control-regex -- these control characters are exactly what XML 1.0 cannot carry
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;
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

type Writable<T> = Unlined<T>;

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
type Datatype = Writable<ReqifDatatype>;
type SpecType = Writable<ReqifSpecType>;
type Definition = Writable<ReqifAttributeDefinition>;
type Value = Writable<ReqifValue>;
type Hierarchy = Writable<ReqifHierarchy>;
type Identifiable = Writable<ReqifIdentifiable>;

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
  private readonly chunks: string[] = [];
  readonly problems: ReqifWriteProblem[] = [];
  /** The IDENTIFIER the problems of what is written now belong to. */
  private owner = "";
  private depth = 0;

  xml(): string {
    this.chunks.push(this.out.join(""));
    return this.chunks.join("");
  }

  file(file: ReqifWritable): void {
    this.out.push('<?xml version="1.0" encoding="UTF-8"?>');
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
    this.out.push("\n");
  }

  private header(header: ReqifWritable["header"]): void {
    this.owner = header.identifier;
    this.open("THE-HEADER");
    this.open("REQ-IF-HEADER", ["IDENTIFIER", header.identifier]);
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
        this.line();
        this.out.push(`<${name}>${this.text(value, name)}</${name}>`);
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
    const facets: string[] = [];
    for (const [field, name] of FACETS[datatype.kind]) {
      const value = datatype[field];
      if (value === undefined) {
        this.problems.push({ kind: "missing-field", identifier: datatype.identifier, field: name });
      } else {
        facets.push(name, value);
      }
    }
    this.item(`DATATYPE-DEFINITION-${datatype.kind.toUpperCase()}`, datatype, facets, () => {
      if (datatype.values.length > 0) {
        this.part("SPECIFIED-VALUES", datatype.values, (value) => {
          this.item("ENUM-VALUE", value, [], () => {
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
            this.empty("EMBEDDED-VALUE", attributes);
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
      if (definition.defaultValue !== undefined) {
        this.open("DEFAULT-VALUE");
        this.value({ ...definition.defaultValue, definition: definition.identifier });
        this.close("DEFAULT-VALUE");
      }
      this.reference("TYPE", `DATATYPE-DEFINITION-${kind}-REF`, definition.datatype);
    });
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
    const definition = (): void => {
      this.reference("DEFINITION", `ATTRIBUTE-DEFINITION-${kind}-REF`, value.definition);
    };
    if (value.kind === "xhtml") {
      this.open(name);
      this.line();
      this.out.push("<THE-VALUE>");
      this.xhtml(value.value, value.definition);
      this.out.push("</THE-VALUE>");
      definition();
      this.close(name);
    } else if (value.kind === "enumeration") {
      this.open(name);
      definition();
      this.open("VALUES");
      for (const reference of value.values) {
        this.line();
        this.out.push(`<ENUM-VALUE-REF>${this.text(reference, "ENUM-VALUE-REF")}</ENUM-VALUE-REF>`);
      }
      this.close("VALUES");
      this.close(name);
    } else {
      this.open(name, ["THE-VALUE", value.value]);
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
    // An entry is a hierarchy to open, or the IDENTIFIER of one to close after its children.
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

  /** XHTML nodes as `xhtml:` elements, walked without recursion. */
  private xhtml(nodes: readonly Writable<XhtmlNode>[], field: string): void {
    // A node to write, or the name of an element to close.
    const pending: (Writable<XhtmlNode> | { readonly closes: string })[] = [];
    const push = (list: readonly Writable<XhtmlNode>[]): void => {
      for (const item of [...list].reverse()) {
        pending.push(item);
      }
    };
    push(nodes);
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (typeof next === "string") {
        this.out.push(this.text(next, field));
      } else if ("closes" in next) {
        this.out.push(`</xhtml:${next.closes}>`);
      } else if (next.namespace !== XHTML_NAMESPACE) {
        this.unsupported(field, `<${next.name}> in ${next.namespace || "no namespace"}`);
      } else {
        this.out.push(`<xhtml:${next.name}${this.xhtmlAttributes(next.attributes, field)}>`);
        pending.push({ closes: next.name });
        push(next.children);
      }
    }
  }

  private xhtmlAttributes(attributes: readonly string[], field: string): string {
    let written = "";
    for (const [name, value] of pairs(attributes)) {
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        // A declaration, not content: the writer declares the namespaces it uses.
        continue;
      }
      if (name.includes(":") && !name.startsWith("xml:")) {
        this.unsupported(field, name);
        continue;
      }
      written += ` ${name}="${this.attribute(value, name)}"`;
    }
    return written;
  }

  /** An identifiable element with its own `attributes` after the common ones, and its `content`. */
  private item(name: string, item: Identifiable, attributes: readonly string[], content: () => void): void {
    this.owner = item.identifier;
    this.open(name, [...this.identifying(item), ...attributes]);
    content();
    this.close(name);
  }

  /** IDENTIFIER, LAST-CHANGE, LONG-NAME and DESC (ReqIF 1.2 §10.8.32); LAST-CHANGE is mandatory. */
  private identifying(item: Identifiable): string[] {
    this.owner = item.identifier;
    const attributes = ["IDENTIFIER", item.identifier];
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

  private reference(wrapper: string, name: string, identifier: string): void {
    this.open(wrapper);
    this.line();
    this.out.push(`<${name}>${this.text(identifier, name)}</${name}>`);
    this.close(wrapper);
  }

  private open(name: string, attributes: readonly string[] = []): void {
    this.line();
    this.out.push(`<${name}${this.attributes(attributes)}>`);
    this.depth += 1;
  }

  private empty(name: string, attributes: readonly string[]): void {
    this.line();
    this.out.push(`<${name}${this.attributes(attributes)}/>`);
  }

  private close(name: string): void {
    this.depth -= 1;
    this.line();
    this.out.push(`</${name}>`);
  }

  private line(): void {
    if (this.out.length >= CHUNK) {
      this.chunks.push(this.out.join(""));
      this.out.length = 0;
    }
    this.out.push(INDENT.slice(0, 1 + 2 * Math.min(this.depth, MAX_INDENT)));
  }

  private attributes(attributes: readonly string[]): string {
    let written = "";
    for (const [name, value] of pairs(attributes)) {
      written += name.startsWith("xmlns")
        ? ` ${name}="${value}"`
        : ` ${name}="${this.attribute(value, name)}"`;
    }
    return written;
  }

  private text(text: string, field: string): string {
    this.check(text, field);
    return escapeText(text);
  }

  private attribute(text: string, field: string): string {
    this.check(text, field);
    return escapeAttribute(text);
  }

  private check(text: string, field: string): void {
    for (const match of text.matchAll(NOT_XML)) {
      this.problems.push({
        kind: "invalid-character",
        identifier: this.owner,
        field,
        codePoint: match[0].charCodeAt(0),
        offset: match.index,
      });
    }
  }

  private missing(mandatory: boolean, field: string): void {
    if (mandatory) {
      this.problems.push({ kind: "missing-field", identifier: this.owner, field });
    }
  }

  private unsupported(field: string, name: string): void {
    this.problems.push({ kind: "unsupported-content", identifier: this.owner, field, name });
  }
}

/** The ReqIF 1.2 file of `file`, or every reason it cannot be written. */
export const writeReqif = (file: ReqifWritable): ReqifWriteOutcome => {
  const writer = new Writer();
  writer.file(file);
  return writer.problems.length === 0
    ? { kind: "written", xml: writer.xml() }
    : { kind: "refused", problems: writer.problems };
};
