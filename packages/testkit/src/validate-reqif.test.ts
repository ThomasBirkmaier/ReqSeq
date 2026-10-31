import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQIF_XSD_PINS,
  REQIF_XSD_SKIP_REASON,
  loadXsdDir,
  localSchemas,
  readPins,
  reqifXsdDir,
  validateReqif,
  validateXml,
} from "./validate-reqif.js";

// A tiny schema pair of our own: the root imports the part by an absolute http location, as the ReqIF
// XSDs do, which the validator must point to the loaded file.
const PART = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:part">
  <xs:element name="ITEM"><xs:complexType><xs:attribute name="IDENTIFIER" type="xs:ID" use="required"/></xs:complexType></xs:element>
</xs:schema>`;
const ROOT = (location: string): string => `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:p="urn:part" targetNamespace="urn:root" xmlns="urn:root" elementFormDefault="qualified">
  <xs:import namespace="urn:part" schemaLocation='${location}'/>
  <xs:element name="ROOT"><xs:complexType><xs:sequence>
    <xs:element ref="p:ITEM" maxOccurs="unbounded"/>
    <xs:element name="ITEM-REF" type="xs:string" minOccurs="0" maxOccurs="unbounded"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
const schemas = (location = "http://example.org/schema/part.xsd"): { name: string; contents: string }[] => [
  { name: "root.xsd", contents: ROOT(location) },
  { name: "part.xsd", contents: PART },
];
const file = (items: string, refs = ""): string =>
  `<ROOT xmlns="urn:root" xmlns:p="urn:part">${items}${refs}</ROOT>`;
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const tempDir = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reqif-xsd-"));
  roots.push(root);
  return root;
};
const skipping = {
  skip: (note?: string): never => {
    throw new Error(`skip: ${String(note)}`);
  },
};

describe("localSchemas", () => {
  it("points every schemaLocation to the loaded file of the same base name, and throws for an unknown one", () => {
    expect(localSchemas(schemas())[0]?.contents).toContain("schemaLocation='part.xsd'");
    expect(() => localSchemas(schemas("http://example.org/other.xsd"))).toThrow(
      "root.xsd names the schema http://example.org/other.xsd, which is not loaded",
    );
  });
});

describe("validateXml", () => {
  it("accepts a valid file and gives libxml2's messages for an invalid one", async () => {
    expect(
      await validateXml(file('<p:ITEM IDENTIFIER="a"/>', "<ITEM-REF> a </ITEM-REF>"), schemas(), "root.xsd"),
    ).toEqual({
      valid: true,
      errors: [],
    });
    const invalid = await validateXml(
      file('<p:ITEM IDENTIFIER="1"/><p:ITEM IDENTIFIER="b"/><p:ITEM IDENTIFIER="b"/>'),
      schemas(),
      "root.xsd",
    );
    expect(invalid.valid).toBe(false);
    expect(invalid.errors).toEqual([
      expect.stringContaining("'1' is not a valid value of the atomic type 'xs:ID'"),
      expect.stringContaining("'b' is not a valid value of the atomic type 'xs:ID'"),
    ]);
  });

  it("names every *-REF that resolves to no IDENTIFIER, which libxml2 does not check", async () => {
    expect(
      await validateXml(
        file('<p:ITEM IDENTIFIER="a"/>', "<ITEM-REF>nowhere</ITEM-REF>"),
        schemas(),
        "root.xsd",
      ),
    ).toEqual({
      valid: false,
      errors: ["<ITEM-REF> nowhere names no IDENTIFIER of the file"],
    });
  });

  it("gives the messages of a schema that does not compile, and refuses an unknown root", async () => {
    const broken = [
      { name: "root.xsd", contents: ROOT("part.xsd").replace('ref="p:ITEM"', 'ref="p:NONE"') },
      { name: "part.xsd", contents: PART },
    ];
    const result = await validateXml(file('<p:ITEM IDENTIFIER="a"/>'), broken, "root.xsd");
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("does not resolve to a(n) element declaration");
    await expect(validateXml("<x/>", schemas(), "none.xsd")).rejects.toThrow(
      "The schema none.xsd is not loaded",
    );
  });

  it("counts a schema warning as an error", async () => {
    // An import whose namespace the root never uses still compiles; libxml2 only warns that it cannot read it.
    const warned = [
      {
        name: "root.xsd",
        contents: ROOT("part.xsd").replace(
          '<xs:element name="ROOT">',
          '<xs:import namespace="urn:unused" schemaLocation="empty.xsd"/><xs:element name="ROOT">',
        ),
      },
      { name: "part.xsd", contents: PART },
      { name: "empty.xsd", contents: "not a schema" },
    ];
    const result = await validateXml(file('<p:ITEM IDENTIFIER="a"/>'), warned, "root.xsd");
    expect(result.valid).toBe(false);
  });
});

describe("loadXsdDir and readPins", () => {
  it("loads the pinned files once, and refuses a missing file, another hash and a bad pin line", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "part.xsd"), PART);
    const pins = readPins(`# confirmed\n${sha(PART)}  part.xsd\n`);
    expect(pins).toEqual([{ name: "part.xsd", sha256: sha(PART) }]);
    const first = loadXsdDir(dir, pins);
    expect(first).toEqual([{ name: "part.xsd", contents: PART }]);
    expect(loadXsdDir(dir, pins)).toBe(first);
    expect(() => loadXsdDir(dir, [{ name: "root.xsd", sha256: sha("x") }])).toThrow(
      `root.xsd is missing in ${dir}`,
    );
    expect(() => loadXsdDir(dir, [{ name: "part.xsd", sha256: sha("x") }])).toThrow(
      `part.xsd in ${dir} has SHA-256 ${sha(PART)}, not the pinned ${sha("x")}`,
    );
    expect(() => readPins("PENDING\n")).toThrow('Not a pinned SHA-256: "PENDING"');
  });

  it("validateReqif checks against reqif.xsd of the pinned folder", async () => {
    const dir = tempDir();
    const reqif = ROOT("part.xsd");
    fs.writeFileSync(path.join(dir, "reqif.xsd"), reqif);
    fs.writeFileSync(path.join(dir, "part.xsd"), PART);
    const result = await validateReqif(
      file('<p:ITEM IDENTIFIER="a"/>'),
      dir,
      `${sha(reqif)}  reqif.xsd\n${sha(PART)}  part.xsd\n`,
    );
    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe("reqifXsdDir", () => {
  it("gives the folder when it exists, throws in CI without it, and skips with the reason elsewhere", () => {
    const dir = tempDir();
    expect(reqifXsdDir(skipping, { REQSEQ_REQIF_XSD_DIR: dir })).toBe(dir);
    expect(() => reqifXsdDir(skipping, { CI: "true", REQSEQ_REQIF_XSD_DIR: path.join(dir, "none") })).toThrow(
      "The ReqIF XSDs are missing in CI",
    );
    expect(() => reqifXsdDir(skipping, { CI: "", REQSEQ_REQIF_XSD_DIR: "" })).toThrow(
      `skip: ${REQIF_XSD_SKIP_REASON}`,
    );
    expect(() => reqifXsdDir(skipping, {})).toThrow("skip: the ReqIF XSDs are not in the repository");
    expect(REQIF_XSD_PINS.endsWith(path.join("toolchain", "reqif", "xsd.sha256"))).toBe(true);
  });
});
