// A small XML scanner of our own (ADR-0012 "JUnit XML"): it reads the bytes of a file into a tree of
// elements and keeps, for every element and attribute, its byte offsets into those bytes and its
// line, so that a caller can splice new bytes in and keep every other byte as it was (the lossless
// enrich of SR-029). `streamXml` reports the same as events, without a tree, for large files
// (ReqIF, ADR-0013). It never writes.
//
// What it reads: start, end and empty tags with attributes, text, CDATA sections, comments,
// processing instructions, the five predefined entities and numeric character references. UTF-8
// only, with or without a byte order mark. A `<!DOCTYPE` and any other entity are refused: no entity
// expansion and no external reference is ever followed, so no file can make ReqSeq open a network
// connection or read another file (offline, XXE safe). The scan is iterative (an explicit stack), so
// deep nesting cannot overflow the call stack, and linear in the size of the file, also for hostile
// input (one tag with many attributes, long texts). Refusal messages quote at most a few characters
// of the file, escaped (`shown`).
//
// Lenient where it costs nothing: it accepts some input that XML forbids but that never leads to
// expansion or I/O: literal control characters in text and values, `]]>` in text, `--` in a
// comment, and any non-ASCII character in a name.

import { isUtf8 } from "node:buffer";

/** Why a file was refused. */
export type XmlRefusalReason =
  /** The bytes are not UTF-8, or the XML declaration names another encoding. */
  | "encoding"
  /** The file has a document type declaration (`<!DOCTYPE`), which is never read. */
  | "doctype"
  /** An entity reference other than the five predefined ones and numeric references. */
  | "entity"
  /** Not well-formed XML. */
  | "malformed";

/** An attribute of a start tag. Offsets are byte offsets into the scanned bytes. */
export interface XmlAttribute {
  readonly name: string;
  /** The value with entities and character references resolved and whitespace normalised (XML 3.3.3). */
  readonly value: string;
  /** The value as written between the quotes (decoded from UTF-8, entities not resolved). */
  readonly raw: string;
  /** The quote character around the value; a new value written in place must be escaped for it. */
  readonly quote: '"' | "'";
  /** Offset of the first byte of the name. */
  readonly start: number;
  /** Offset after the closing quote. */
  readonly end: number;
  /** Offset after the opening quote. */
  readonly valueStart: number;
  /** Offset of the closing quote. */
  readonly valueEnd: number;
}

/**
 * An element. Offsets are byte offsets into the scanned bytes. The nesting depth is unbounded: walk
 * the tree iteratively (a recursive walk, `JSON.stringify` or a deep equality check can overflow the
 * call stack on a hostile file).
 *
 * - `<a x="1">text</a>`: `start` is the `<` of the start tag, `contentStart` the byte after its `>`,
 *   `contentEnd` the `<` of `</a>`, `end` the byte after its `>`.
 * - `<a x="1"/>` (`selfClosing`): `contentStart` and `contentEnd` are the `/` of `/>`, `end` the byte
 *   after `>`. Replacing the bytes from `contentEnd` to `end` by `>…</a>` opens the element.
 */
export interface XmlElement {
  readonly name: string;
  /** Line of the `<` of the start tag, from 1; CRLF and a lone CR count as one line break. */
  readonly line: number;
  readonly start: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly selfClosing: boolean;
  readonly attributes: readonly XmlAttribute[];
  readonly children: readonly XmlElement[];
  /** The text directly inside the element (CDATA included, entities resolved, line breaks as LF). */
  readonly text: string;
}

export interface XmlDocument {
  readonly root: XmlElement;
  /** The bytes start with a UTF-8 byte order mark (offsets count it). */
  readonly bom: boolean;
}

export type XmlScanOutcome =
  | { readonly kind: "scanned"; readonly document: XmlDocument }
  | {
      readonly kind: "refused";
      readonly reason: XmlRefusalReason;
      readonly message: string;
      /** Line of the place that was refused, from 1. */
      readonly line: number;
      /** Byte offset of the place that was refused. */
      readonly offset: number;
    };

/**
 * What `streamXml` reports, in document order, without building a tree (ReqIF, ADR-0013): a large
 * file costs only what the receiver keeps. Offsets are as in `XmlElement`.
 */
export interface XmlEvents {
  open(
    name: string,
    attributes: readonly XmlAttribute[],
    line: number,
    start: number,
    contentStart: number,
    selfClosing: boolean,
  ): void;
  /** A text run of the element opened last (CDATA included, entities resolved, line breaks as LF), never empty. */
  text(text: string): void;
  /** The end of the element opened last; right after `open` for a self-closing one. */
  close(contentEnd: number, end: number): void;
}

/** The value of the attribute `name` of `element`, or undefined. */
export const xmlAttribute = (element: XmlElement, name: string): XmlAttribute | undefined =>
  element.attributes.find((attribute) => attribute.name === name);

const LT = 0x3c;
const GT = 0x3e;
const SLASH = 0x2f;
const QUESTION = 0x3f;
const BANG = 0x21;
const EQUALS = 0x3d;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const CR = 0x0d;
const LF = 0x0a;

const BOM = [0xef, 0xbb, 0xbf] as const;
const ascii = (text: string): Buffer => Buffer.from(text, "latin1");
const COMMENT_OPEN = ascii("<!--");
const COMMENT_CLOSE = ascii("-->");
const CDATA_OPEN = ascii("<![CDATA[");
const CDATA_CLOSE = ascii("]]>");
const DOCTYPE_OPEN = ascii("<!DOCTYPE");
const PI_CLOSE = ascii("?>");
const DECLARATION_OPEN = ascii("<?xml");

/** Name of an element or attribute (XML 2.3, simplified to ASCII rules plus any non-ASCII letter). */
const NAME = /^[A-Za-z_:\u0080-\u{10FFFF}][-A-Za-z0-9_:.\u0080-\u{10FFFF}]*$/u;
/** Encodings whose bytes are UTF-8 for every file this scanner accepts. */
const UTF8_NAMES = new Set(["utf-8", "utf8", "us-ascii", "ascii"]);
const PREDEFINED: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
]);

/** At most this many characters of the file are quoted in a refusal message. */
const SHOWN_LENGTH = 40;
/** Bidirectional controls and line separators: quoted escaped, as control characters are. */
const INVISIBLE = new Set([
  0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

/**
 * Text of the file as a refusal message quotes it: at most `SHOWN_LENGTH` characters (then `…`),
 * with control characters, bidirectional controls and line separators as `\u{…}`, so a crafted file
 * cannot flood the output or send escape sequences to the terminal that shows the message. The JUnit
 * reader quotes test case names and property values with it too.
 */
export const shown = (text: string): string => {
  // Two UTF-16 units per character at most, plus one, tell whether more than SHOWN_LENGTH follow.
  const characters = Array.from(text.slice(0, 2 * SHOWN_LENGTH + 1));
  const kept = characters.slice(0, SHOWN_LENGTH).map((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || INVISIBLE.has(code)
      ? `\\u{${code.toString(16)}}`
      : character;
  });
  return kept.join("") + (characters.length > SHOWN_LENGTH ? "…" : "");
};

class Refusal extends Error {
  readonly reason: XmlRefusalReason;
  readonly offset: number;

  constructor(reason: XmlRefusalReason, message: string, offset: number) {
    super(message);
    this.reason = reason;
    this.offset = offset;
  }
}

const isSpace = (byte: number | undefined): boolean =>
  byte === 0x20 || byte === 0x09 || byte === LF || byte === CR;

const startsWith = (bytes: Uint8Array, at: number, sequence: Uint8Array): boolean =>
  sequence.every((byte, i) => bytes[at + i] === byte);

/** Line numbers by offset; counts forward from the last offset asked for (offsets asked never go back). */
class Lines {
  private readonly bytes: Uint8Array;
  private offset = 0;
  private line = 1;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  at(offset: number): number {
    for (let i = this.offset; i < offset; i++) {
      const byte = this.bytes[i];
      if (byte === LF || (byte === CR && this.bytes[i + 1] !== LF)) {
        this.line++;
      }
    }
    this.offset = offset;
    return this.line;
  }
}

/** A character XML allows (XML 2.2 `Char`). */
const XML_CHAR = /^[\t\n\r\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]$/u;

/** The character of a numeric reference body (`#65`, `#x41`), or undefined when it is not a valid one. */
const characterReference = (body: string): string | undefined => {
  if (!/^#(?:[0-9]+|x[0-9A-Fa-f]+)$/.test(body)) {
    return undefined;
  }
  const code = Number(body.startsWith("#x") ? `0x${body.slice(2)}` : body.slice(1));
  return code <= 0x10ffff && XML_CHAR.test(String.fromCodePoint(code))
    ? String.fromCodePoint(code)
    : undefined;
};

/** The byte length of `text` in UTF-8. */
const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

/** Text with each line break (CRLF, a lone CR) as LF (XML 2.11). */
const textLiteral = (literal: string): string =>
  literal.includes("\r") ? literal.replace(/\r\n?/g, "\n") : literal;
/** An attribute value with each literal whitespace character (CRLF as one) as a space (XML 3.3.3). */
const attributeLiteral = (literal: string): string => literal.replace(/\r\n|[\t\n\r]/g, " ");

/**
 * Resolves the references in `raw`, the decoded bytes from `offset` on, and passes the text between
 * them through `literal` (so a resolved `&#13;` is not normalised). A refusal names the byte offset of
 * its reference.
 */
const resolveReferences = (raw: string, offset: number, literal: (text: string) => string): string => {
  if (!raw.includes("&")) {
    return literal(raw);
  }
  let resolved = "";
  let last = 0;
  for (const match of raw.matchAll(/&([^;&]*)(;?)/g)) {
    const [whole, body = "", semicolon] = match;
    const character = semicolon === "" ? undefined : (PREDEFINED.get(body) ?? characterReference(body));
    if (character === undefined) {
      const at = offset + byteLength(raw.slice(0, match.index));
      throw body.startsWith("#") || semicolon === "" || !NAME.test(body)
        ? new Refusal("malformed", `Invalid reference ${shown(whole)}`, at)
        : new Refusal(
            "entity",
            `Unknown entity &${shown(body)}; (only the predefined entities are read)`,
            at,
          );
    }
    resolved += literal(raw.slice(last, match.index)) + character;
    last = match.index + whole.length;
  }
  return resolved + literal(raw.slice(last));
};

/** An element while it is read; once closed it is the `XmlElement` it gives (no copy). */
interface Building extends XmlElement {
  contentEnd: number;
  end: number;
  readonly children: XmlElement[];
  text: string;
}

const building = (
  name: string,
  attributes: readonly XmlAttribute[],
  line: number,
  start: number,
  contentStart: number,
  selfClosing: boolean,
): Building => ({
  name,
  line,
  start,
  contentStart,
  // Set by `close`.
  contentEnd: contentStart,
  end: contentStart,
  selfClosing,
  attributes,
  children: [],
  text: "",
});

/** The events that build the element tree of `scanXml`. */
class Tree implements XmlEvents {
  /** The open elements around `top`; at first only a holder for the root. */
  private readonly stack: Building[] = [];
  private top = building("", [], 0, 0, 0, false);
  /** The element closed last: the root, once the scan is through. */
  root: XmlElement = this.top;

  open(...start: Parameters<XmlEvents["open"]>): void {
    this.stack.push(this.top);
    this.top = building(...start);
  }

  text(text: string): void {
    this.top.text += text;
  }

  close(contentEnd: number, end: number): void {
    const element = this.top;
    element.contentEnd = contentEnd;
    element.end = end;
    // One parent: the holder at least, as every close follows its open.
    for (const parent of this.stack.splice(-1)) {
      parent.children.push(element);
      this.top = parent;
    }
    this.root = element;
  }
}

/**
 * Where the first sequence that is not UTF-8 is: the first byte where the bytes and their lossy
 * decoding, encoded again, differ (a valid prefix encodes to the same bytes). For a sequence cut
 * short this can be up to two bytes after its start; those bytes are never a line break, so the line
 * is right.
 */
const firstNonUtf8 = (bytes: Uint8Array): number => {
  const again = new TextEncoder().encode(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes));
  return Math.max(
    0,
    bytes.findIndex((byte, i) => byte !== again[i]),
  );
};

/** One pass over the bytes. Each method reads one construct and returns the offset after it. */
class Scanner {
  private readonly bytes: Uint8Array;
  private readonly lines: Lines;
  /** The same bytes as a Buffer, for its fast search of byte sequences. */
  private readonly buffer: Buffer;
  private readonly events: XmlEvents;
  /** The open elements, by name and start offset. */
  private readonly stack: { readonly name: string; readonly start: number }[] = [];
  /** Names already checked against `NAME`; a file repeats a few names many times. */
  private readonly names = new Set<string>();
  private rooted = false;

  constructor(bytes: Uint8Array, events: XmlEvents) {
    this.events = events;
    this.bytes = bytes;
    this.lines = new Lines(bytes);
    this.buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Reads the whole file and tells whether it starts with a byte order mark. */
  scan(): boolean {
    const bom = BOM.every((byte, i) => this.bytes[i] === byte);
    let at = bom ? BOM.length : 0;
    if (startsWith(this.bytes, at, DECLARATION_OPEN) && isSpace(this.bytes[at + DECLARATION_OPEN.length])) {
      at = this.declaration(at);
    }
    if (!isUtf8(this.bytes)) {
      throw new Refusal("encoding", "The file is not UTF-8", firstNonUtf8(this.bytes));
    }
    while (at < this.bytes.length) {
      at = this.bytes[at] === LT ? this.markup(at) : this.text(at);
    }
    const open = this.stack.at(-1);
    if (open !== undefined) {
      throw new Refusal("malformed", `Element <${shown(open.name)}> is not closed`, open.start);
    }
    if (!this.rooted) {
      throw new Refusal("malformed", "No root element", at);
    }
    return bom;
  }

  /** The bytes from `start` to `end` as text; the whole file is UTF-8 (checked first). */
  private decode(start: number, end: number): string {
    return this.buffer.toString("utf8", start, end);
  }

  private closingAt(sequence: Uint8Array, from: number, what: string, start: number): number {
    const at = this.buffer.indexOf(sequence, from);
    if (at === -1) {
      throw new Refusal("malformed", `${what} is not closed`, start);
    }
    return at;
  }

  /** `<?xml version="1.0" encoding="…"?>` at the start of the file. */
  private declaration(start: number): number {
    const end = this.closingAt(PI_CLOSE, start, "The XML declaration", start);
    const name = /\sencoding\s*=\s*(["'])(.*?)\1/.exec(this.decode(start, end))?.[2];
    if (name !== undefined && !UTF8_NAMES.has(name.toLowerCase())) {
      throw new Refusal("encoding", `Encoding ${shown(name)} is not read; only UTF-8`, start);
    }
    return end + PI_CLOSE.length;
  }

  private text(start: number): number {
    const lt = this.bytes.indexOf(LT, start);
    const end = lt === -1 ? this.bytes.length : lt;
    const raw = this.decode(start, end);
    if (this.stack.length === 0) {
      const other = raw.search(/[^ \t\r\n]/);
      if (other !== -1) {
        throw new Refusal(
          "malformed",
          "Text outside the root element",
          start + byteLength(raw.slice(0, other)),
        );
      }
      return end;
    }
    this.events.text(resolveReferences(raw, start, textLiteral));
    return end;
  }

  private markup(start: number): number {
    const next = this.bytes[start + 1];
    if (next === SLASH) {
      return this.endTag(start);
    }
    if (next === QUESTION) {
      return this.processingInstruction(start);
    }
    if (next === BANG) {
      return this.declarationOrSection(start);
    }
    return this.startTag(start);
  }

  private processingInstruction(start: number): number {
    const end = this.closingAt(PI_CLOSE, start + 2, "A processing instruction", start);
    const target = this.decode(start + 2, end).replace(/\s[\s\S]*$/, "");
    if (!NAME.test(target) || target.toLowerCase() === "xml") {
      throw new Refusal("malformed", `Invalid processing instruction <?${shown(target)}`, start);
    }
    return end + PI_CLOSE.length;
  }

  private declarationOrSection(start: number): number {
    if (startsWith(this.bytes, start, COMMENT_OPEN)) {
      const end = this.closingAt(COMMENT_CLOSE, start + COMMENT_OPEN.length, "A comment", start);
      return end + COMMENT_CLOSE.length;
    }
    if (startsWith(this.bytes, start, CDATA_OPEN)) {
      return this.cdata(start);
    }
    if (startsWith(this.bytes, start, DOCTYPE_OPEN)) {
      throw new Refusal("doctype", "A document type declaration (<!DOCTYPE) is not read", start);
    }
    throw new Refusal("malformed", "Invalid markup <!", start);
  }

  private cdata(start: number): number {
    if (this.stack.length === 0) {
      throw new Refusal("malformed", "CDATA outside the root element", start);
    }
    const from = start + CDATA_OPEN.length;
    const end = this.closingAt(CDATA_CLOSE, from, "A CDATA section", start);
    if (end > from) {
      this.events.text(textLiteral(this.decode(from, end)));
    }
    return end + CDATA_CLOSE.length;
  }

  /** A name from `start` up to whitespace, `/`, `>`, `=` or `<`. */
  private name(start: number): { readonly name: string; readonly end: number } {
    let end = start;
    for (let byte = this.bytes[end]; byte !== undefined; byte = this.bytes[++end]) {
      if (isSpace(byte) || byte === SLASH || byte === GT || byte === EQUALS || byte === LT) {
        break;
      }
    }
    const name = this.decode(start, end);
    if (!this.names.has(name)) {
      if (!NAME.test(name)) {
        throw new Refusal(
          "malformed",
          name === "" ? "A name is missing" : `Invalid name ${shown(name)}`,
          start,
        );
      }
      this.names.add(name);
    }
    return { name, end };
  }

  private skipSpace(from: number): number {
    let at = from;
    while (isSpace(this.bytes[at])) {
      at++;
    }
    return at;
  }

  private endTag(start: number): number {
    const { name, end } = this.name(start + 2);
    const gt = this.skipSpace(end);
    if (this.bytes[gt] !== GT) {
      throw new Refusal("malformed", `End tag </${shown(name)}> is not closed`, start);
    }
    const open = this.stack.pop();
    if (open?.name !== name) {
      throw new Refusal(
        "malformed",
        open === undefined
          ? `End tag </${shown(name)}> without start tag`
          : `End tag </${shown(name)}> does not close <${shown(open.name)}>`,
        start,
      );
    }
    this.events.close(start, gt + 1);
    return gt + 1;
  }

  private startTag(start: number): number {
    if (this.rooted && this.stack.length === 0) {
      throw new Refusal("malformed", "A second root element", start);
    }
    const { name, end: nameEnd } = this.name(start + 1);
    const attributes: XmlAttribute[] = [];
    // A set, so that a tag with many attributes stays linear (a file may be hostile).
    const names = new Set<string>();
    let at = nameEnd;
    for (;;) {
      const spaced = isSpace(this.bytes[at]);
      at = this.skipSpace(at);
      const byte = this.bytes[at];
      if (byte === GT || (byte === SLASH && this.bytes[at + 1] === GT)) {
        break;
      }
      if (byte === undefined) {
        throw new Refusal("malformed", `Start tag <${shown(name)}> is not closed`, start);
      }
      if (!spaced) {
        throw new Refusal("malformed", `Whitespace is missing before an attribute of <${shown(name)}>`, at);
      }
      const attribute = this.attribute(at);
      if (names.has(attribute.name)) {
        throw new Refusal(
          "malformed",
          `Attribute ${shown(attribute.name)} appears twice in <${shown(name)}>`,
          at,
        );
      }
      names.add(attribute.name);
      attributes.push(attribute);
      at = attribute.end;
    }
    const selfClosing = this.bytes[at] === SLASH;
    this.rooted = true;
    // Self-closing: the content is empty at the `/` of `/>`; otherwise it starts after `>`.
    this.events.open(name, attributes, this.lines.at(start), start, selfClosing ? at : at + 1, selfClosing);
    if (selfClosing) {
      this.events.close(at, at + 2);
      return at + 2;
    }
    this.stack.push({ name, start });
    return at + 1;
  }

  private attribute(start: number): XmlAttribute {
    const { name, end: nameEnd } = this.name(start);
    const equals = this.skipSpace(nameEnd);
    if (this.bytes[equals] !== EQUALS) {
      throw new Refusal("malformed", `Attribute ${shown(name)} has no value`, start);
    }
    const quoteAt = this.skipSpace(equals + 1);
    const quote = this.bytes[quoteAt];
    if (quote !== QUOTE && quote !== APOSTROPHE) {
      throw new Refusal("malformed", `The value of attribute ${shown(name)} is not quoted`, quoteAt);
    }
    const valueStart = quoteAt + 1;
    const valueEnd = this.bytes.indexOf(quote, valueStart);
    if (valueEnd === -1) {
      throw new Refusal("malformed", `The value of attribute ${shown(name)} is not closed`, quoteAt);
    }
    // Only inside the value: a search to the next `<` of the file would make many attributes quadratic.
    const lt = this.bytes.subarray(valueStart, valueEnd).indexOf(LT);
    if (lt !== -1) {
      throw new Refusal("malformed", `The value of attribute ${shown(name)} contains <`, valueStart + lt);
    }
    const raw = this.decode(valueStart, valueEnd);
    const value = resolveReferences(raw, valueStart, attributeLiteral);
    return {
      name,
      value,
      raw,
      quote: quote === QUOTE ? '"' : "'",
      start,
      end: valueEnd + 1,
      valueStart,
      valueEnd,
    };
  }
}

export type XmlStreamOutcome =
  | { readonly kind: "streamed"; readonly bom: boolean }
  | Extract<XmlScanOutcome, { readonly kind: "refused" }>;

/**
 * Reads `bytes` as `scanXml` does and reports each start tag, text run and end to `events` instead of
 * building a tree. An error that `events` throws is not caught.
 */
export const streamXml = (bytes: Uint8Array, events: XmlEvents): XmlStreamOutcome => {
  try {
    return { kind: "streamed", bom: new Scanner(bytes, events).scan() };
  } catch (error) {
    if (!(error instanceof Refusal)) {
      throw error;
    }
    const { reason, message, offset } = error;
    return { kind: "refused", reason, message, line: new Lines(bytes).at(offset), offset };
  }
};

/**
 * Scans `bytes` as XML. Gives the element tree with byte offsets and lines, or why the file was
 * refused (not UTF-8, a `<!DOCTYPE`, an unknown entity, not well-formed) with its line.
 */
export const scanXml = (bytes: Uint8Array): XmlScanOutcome => {
  const tree = new Tree();
  const outcome = streamXml(bytes, tree);
  return outcome.kind === "refused"
    ? outcome
    : { kind: "scanned", document: { root: tree.root, bom: outcome.bom } };
};
