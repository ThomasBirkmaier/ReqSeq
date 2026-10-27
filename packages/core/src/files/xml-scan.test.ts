import { describe, expect, it } from "vitest";
import type { XmlElement, XmlScanOutcome } from "./xml-scan.js";
import { scanXml, xmlAttribute } from "./xml-scan.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const BOM = Uint8Array.of(0xef, 0xbb, 0xbf);
const withBom = (text: string): Uint8Array => Uint8Array.from([...BOM, ...utf8(text)]);

const rootOf = (outcome: XmlScanOutcome): XmlElement => {
  if (outcome.kind !== "scanned") {
    throw new Error(`refused: ${outcome.message}`);
  }
  return outcome.document.root;
};

const scan = (text: string): XmlElement => rootOf(scanXml(utf8(text)));

/** The bytes from `start` to `end`, as text. */
const slice = (bytes: Uint8Array, start: number, end: number): string =>
  new TextDecoder().decode(bytes.subarray(start, end));

/** The bytes from `from` to `to`, as text; nothing when either is missing. */
const bytesOf = (bytes: Uint8Array, from: number | undefined, to: number | undefined): string =>
  slice(bytes, from ?? -1, to ?? -1);

const refusal = (text: string | Uint8Array) => {
  const outcome = scanXml(typeof text === "string" ? utf8(text) : text);
  if (outcome.kind !== "refused") {
    throw new Error("scanned");
  }
  return { reason: outcome.reason, message: outcome.message, line: outcome.line, offset: outcome.offset };
};

describe("scanXml", () => {
  it("xml-scan reads elements, attributes, CDATA and comments with their offsets and lines", () => {
    const text = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<!-- a comment -->",
      "<?pi data?>",
      '<suite name="s">',
      "  <case a=\"1\"   b = 'two'/>",
      "  <out><![CDATA[x < y & z]]> more</out>",
      "</suite>",
      "",
    ].join("\n");
    const bytes = utf8(text);
    const outcome = scanXml(bytes);
    expect(outcome).toMatchObject({ kind: "scanned", document: { bom: false } });
    const root = rootOf(outcome);
    expect(root).toMatchObject({ name: "suite", line: 4, selfClosing: false, text: "\n  \n  \n" });
    expect(slice(bytes, root.start, root.contentStart)).toBe('<suite name="s">');
    expect(slice(bytes, root.contentEnd, root.end)).toBe("</suite>");
    expect(root.end).toBe(bytes.length - 1);

    expect(root.children[0]).toMatchObject({ name: "case", line: 5, selfClosing: true });
    expect(root.children[1]).toMatchObject({ name: "out", line: 6, text: "x < y & z more" });
  });

  it("gives the offsets of a self-closing element and of its attributes", () => {
    const bytes = utf8("<suite>\n  <case a=\"1\"   b = 'two'/>\n</suite>");
    const testCase = rootOf(scanXml(bytes)).children[0];
    if (testCase === undefined) {
      throw new Error("no child");
    }
    expect(testCase).toMatchObject({ name: "case", line: 2, selfClosing: true, children: [], text: "" });
    expect(testCase.contentStart).toBe(testCase.contentEnd);
    expect(slice(bytes, testCase.contentEnd, testCase.end)).toBe("/>");
    const b = xmlAttribute(testCase, "b");
    expect(b).toMatchObject({ name: "b", value: "two", raw: "two", quote: "'" });
    expect(xmlAttribute(testCase, "a")?.quote).toBe('"');
    expect(bytesOf(bytes, b?.start, b?.end)).toBe("b = 'two'");
    expect(bytesOf(bytes, b?.valueStart, b?.valueEnd)).toBe("two");
    expect(xmlAttribute(testCase, "missing")).toBeUndefined();
  });

  it("gives byte offsets, not string indexes, after non-ASCII text", () => {
    const bytes = utf8('<a t="Prüfling ✓">ä<b/></a>');
    const root = rootOf(scanXml(bytes));
    const child = root.children[0];
    expect(root.attributes[0]?.value).toBe("Prüfling ✓");
    expect(child?.start).toBe(bytes.indexOf(0x3c, 1));
    expect(bytesOf(bytes, child?.start, child?.end)).toBe("<b/>");
    expect(root.text).toBe("ä");
  });

  it("resolves the predefined entities and character references in text and attributes", () => {
    const root = scan(
      '<a v="&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&#9;&#10;&#13;&#xE000;&#x1F600;">&lt;x&gt; &amp; &#x41;</a>',
    );
    expect(root.attributes[0]?.value).toBe("<>&\"'AB\t\n\r😀");
    expect(root.attributes[0]?.raw).toBe(
      "&lt;&gt;&amp;&quot;&apos;&#65;&#x42;&#9;&#10;&#13;&#xE000;&#x1F600;",
    );
    expect(root.text).toBe("<x> & A");
  });

  it("normalises literal whitespace in attribute values and line breaks in text", () => {
    const root = scan('<a v="x\ty\r\nz\nw\rv">l1\r\nl2\rl3<![CDATA[c\r\nd]]></a>');
    expect(root.attributes[0]?.value).toBe("x y z w v");
    expect(root.text).toBe("l1\nl2\nl3c\nd");
  });

  it("xml-scan accepts a UTF-8 BOM and CRLF", () => {
    const bytes = withBom('<?xml version="1.0"?>\r\n<a>\r\n  <b/>\r\n</a>\r\n');
    const outcome = scanXml(bytes);
    expect(outcome).toMatchObject({ kind: "scanned", document: { bom: true } });
    const root = rootOf(outcome);
    expect(root.line).toBe(2);
    expect(root.start).toBe(BOM.length + '<?xml version="1.0"?>\r\n'.length);
    expect(root.children[0]?.line).toBe(3);
    expect(bytesOf(bytes, root.children[0]?.start, root.children[0]?.end)).toBe("<b/>");
  });

  it("counts a lone CR as a line break", () => {
    expect(scan("<a>\r<b/>\r\r<c/></a>").children.map((child) => child.line)).toEqual([2, 4]);
  });

  it("accepts the encodings whose bytes are UTF-8 and a declaration without encoding", () => {
    for (const declaration of [
      '<?xml version="1.0" encoding="utf8"?>',
      "<?xml version='1.0' encoding='US-ASCII'?>",
      '<?xml version="1.0" standalone="yes"?>',
    ]) {
      expect(scanXml(utf8(`${declaration}<a/>`)).kind).toBe("scanned");
    }
  });

  it("reads a processing instruction named like the declaration, comments and whitespace around the root", () => {
    const root = scan(
      '<?xml-stylesheet href="s"?>\n<!-- c -->\n<a><?p?><!-- c --></a>\n<!-- after -->\n<?p x?>\n',
    );
    expect(root).toMatchObject({ name: "a", line: 3, text: "" });
  });

  it("scans deep nesting without recursion", () => {
    const depth = 100_000;
    const root = scan(`${"<a>".repeat(depth)}${"</a>".repeat(depth)}`);
    let element: XmlElement | undefined = root;
    let levels = 0;
    while (element !== undefined) {
      levels++;
      element = element.children[0];
    }
    expect(levels).toBe(depth);
  });

  it("xml-scan refuses a DOCTYPE and unknown entities", () => {
    expect(
      refusal('<?xml version="1.0"?>\n<!DOCTYPE a [<!ENTITY e SYSTEM "http://example.org/x">]>\n<a>&e;</a>'),
    ).toEqual({
      reason: "doctype",
      message: "A document type declaration (<!DOCTYPE) is not read",
      line: 2,
      offset: 22,
    });
    expect(refusal("<a>\n&nbsp;</a>")).toMatchObject({
      reason: "entity",
      message: "Unknown entity &nbsp; (only the predefined entities are read)",
      line: 2,
    });
    expect(refusal('<a v="&e;"/>')).toMatchObject({ reason: "entity", line: 1 });
  });

  it("refuses references that are not well-formed", () => {
    for (const text of [
      "<a>&#xZZ;</a>",
      "<a>&#1;</a>",
      "<a>&#x110000;</a>",
      "<a>a & b</a>",
      "<a>a &amp</a>",
      "<a>&;</a>",
    ]) {
      expect(refusal(text).reason, text).toBe("malformed");
    }
    expect(refusal("<a>& b;</a>").message).toBe("Invalid reference & b;");
  });

  it("refuses bytes that are not UTF-8 and other encodings", () => {
    expect(refusal(Uint8Array.from([...utf8("<a>\n"), 0xff, ...utf8("</a>")]))).toMatchObject({
      reason: "encoding",
      message: "The file is not UTF-8",
      line: 2,
    });
    expect(refusal('<?xml version="1.0" encoding="ISO-8859-1"?><a/>')).toMatchObject({
      reason: "encoding",
      message: "Encoding ISO-8859-1 is not read; only UTF-8",
      line: 1,
    });
    expect(refusal(Uint8Array.of(0xff, 0xfe, 0x3c, 0x00)).reason).toBe("encoding");
  });

  it("refuses XML that is not well-formed, with the line", () => {
    const cases: readonly (readonly [string, string, number])[] = [
      ["", "No root element", 1],
      ["<!-- only -->\n", "No root element", 2],
      ["<a>\n<b>\n</a>", "End tag </a> does not close <b>", 3],
      ["</a>", "End tag </a> without start tag", 1],
      ["<a>\n<b>", "Element <b> is not closed", 2],
      ["<a/><b/>", "A second root element", 1],
      ["x<a/>", "Text outside the root element", 1],
      ["<a/>\n x", "Text outside the root element", 2],
      ["<![CDATA[x]]><a/>", "CDATA outside the root element", 1],
      ["<a><![CDATA[x</a>", "A CDATA section is not closed", 1],
      ["<a><!-- x</a>", "A comment is not closed", 1],
      ["<a><?p x</a>", "A processing instruction is not closed", 1],
      ['<?xml version="1.0"', "The XML declaration is not closed", 1],
      ["<a/><?xml version='1.0'?>", "Invalid processing instruction <?xml", 1],
      ["<a><? x?></a>", "Invalid processing instruction <?", 1],
      ["<a><!ELEMENT a ANY></a>", "Invalid markup <!", 1],
      ["<a", "Start tag <a> is not closed", 1],
      ["<a x='1'", "Start tag <a> is not closed", 1],
      ["<a></a", "End tag </a> is not closed", 1],
      ["<a></a x>", "End tag </a> is not closed", 1],
      ["<a></>", "A name is missing", 1],
      ["<1a/>", "Invalid name 1a", 1],
      ["<a<b/>", "Whitespace is missing before an attribute of <a>", 1],
      ["<a x='' <b/>", "A name is missing", 1],
      ["<a / >", "A name is missing", 1],
      ["<a x='1'y='2'/>", "Whitespace is missing before an attribute of <a>", 1],
      ["<a x='1' x='2'/>", "Attribute x appears twice in <a>", 1],
      ["<a x/>", "Attribute x has no value", 1],
      ["<a x=1/>", "The value of attribute x is not quoted", 1],
      ["<a x='1/>", "The value of attribute x is not closed", 1],
      ["<a x='<'/>", "The value of attribute x contains <", 1],
    ];
    for (const [text, message, line] of cases) {
      expect(refusal(text), text).toMatchObject({ reason: "malformed", message, line });
    }
  });

  it("quotes at most 40 characters of the file in a message, with control characters escaped", () => {
    expect(refusal(`<a b\u001b[31m${"x".repeat(100_000)}/>`).message).toBe(
      `Invalid name b\\u{1b}[31m${"x".repeat(34)}…`,
    );
    expect(refusal("<a>&x\u0007\u202e;</a>").message).toBe("Invalid reference &x\\u{7}\\u{202e};");
    expect(refusal("<a>&x\u0085;</a>").message).toBe(
      "Unknown entity &x\\u{85}; (only the predefined entities are read)",
    );
    expect(refusal(`<a>&${"y".repeat(5_000_000)}</a>`).message).toBe(`Invalid reference &${"y".repeat(39)}…`);
    // Characters, not UTF-16 units, are counted.
    expect(refusal(`<a>&${"\u{1F600}".repeat(45)}</a>`).message).toBe(
      `Invalid reference &${"\u{1F600}".repeat(39)}…`,
    );
  });

  // Plan review of PR #545, B1: one start tag with many attributes, followed by a long text, used to
  // take quadratic time (a duplicate check over all earlier attributes, a search for `<` to the end
  // of the text for each value). 200,000 attributes before 10 MB of text scan in about a second when
  // linear; either quadratic path would take hours and run into the test timeout.
  it("scans one start tag with 200,000 attributes before 10 MB of text in linear time", () => {
    const count = 200_000;
    const attributes = Array.from({ length: count }, (_, i) => ` a${String(i)}="v"`).join("");
    const root = scan(`<r${attributes}>${"t".repeat(10_000_000)}</r>`);
    expect(root.attributes).toHaveLength(count);
    expect(root.text).toHaveLength(10_000_000);
    expect(refusal(`<r${attributes} a${String(count - 1)}="w"/>`).message).toBe(
      `Attribute a${String(count - 1)} appears twice in <r>`,
    );
    expect(refusal(`<r${attributes} z="<"/>`).message).toBe("The value of attribute z contains <");
  });

  it("does not catch errors that are not refusals", () => {
    // Not a byte array: the Buffer view fails with a TypeError, which is a programming error, not a refusal.
    expect(() => scanXml(undefined as unknown as Uint8Array)).toThrow(TypeError);
  });
});
