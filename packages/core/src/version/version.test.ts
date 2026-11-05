import { describe, expect, it } from "vitest";
import {
  MISSING_FILE,
  NORMAL_FORM,
  canonicalContent,
  comparableContent,
  computeVersion,
  formOf,
  normalizeText,
  sameVersion,
  sha256Hex,
  type VersionInput,
  type VersionPropertyDefinition,
} from "./version.js";

// Definitions of the standard-model type system-requirement (schemas/examples/metamodel/standard-model.yaml).
const definitions: readonly VersionPropertyDefinition[] = [
  { key: "title", kind: "text" },
  { key: "rationale", kind: "text" },
  { key: "requirement-type", kind: "choice", content: true },
  { key: "acceptance-criteria", kind: "text", content: true },
  { key: "validity", kind: "relation", content: true },
  { key: "packages", kind: "relation" },
  { key: "emergent", kind: "choice", content: true },
  { key: "verification-method", kind: "choice", content: true },
  { key: "statement", kind: "text" },
];

const pro = "ca0dd4a9-0f6b-4c38-9d1f-2b6b0b1e8a11";
const lite = "5d2c1a0e-7b3f-4e6a-8c9d-0e1f2a3b4c5d";
const image = sha256Hex(new Uint8Array([1, 2, 3]));

const base: VersionInput = {
  text: "The display shows the wind speed.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n",
  properties: {
    id: "102ee39b-773f-4cd0-b414-825b7146fb54",
    type: "system-requirement",
    status: "draft",
    title: "Show wind speed",
    rationale: "Sailors decide fast.",
    "requirement-type": "functional",
    "acceptance-criteria": ["Given A, when B, then C.", "Given D, when E, then F."],
    validity: [{ id: pro, version: "n1:2c26b46b68ffc68f", title: "Pro" }],
    packages: [{ id: lite, version: "n1:4be0643f1d98573b", title: "Release 1.0" }],
    "derives-from": [{ id: lite, version: "n1:7d865e959b2466f0", title: "Parent" }],
    "customer-id": "WS-0815",
  },
  definitions,
  files: [{ path: "SR-825b7146fb54/layout.png", sha256: image }],
};

const v = (patch: Partial<VersionInput>): string => computeVersion({ ...base, ...patch }, "n1");
const withProps = (props: VersionInput["properties"]): string =>
  v({ properties: { ...base.properties, ...props } });

describe("version (ADR-0005, normal form n1)", () => {
  it("has the form n1:<16 hex> and is the SHA-256 prefix of the canonical bytes", () => {
    const version = computeVersion(base, "n1");
    expect(version).toMatch(/^n1:[0-9a-f]{16}$/);
    expect(version).toBe(`n1:${sha256Hex(canonicalContent(base, "n1")).slice(0, 16)}`);
  });

  it("writes the canonical form with sorted prop and file sections", () => {
    const input: VersionInput = {
      text: "Text",
      properties: { b: "two", a: 1, c: true },
      definitions: [
        { key: "b", kind: "text", content: true },
        { key: "c", kind: "choice", content: true },
        { key: "a", kind: "number", content: true },
      ],
      files: [
        { path: "E/z.png", sha256: "b".repeat(64) },
        { path: "E/a.png", sha256: "a".repeat(64) },
      ],
    };
    expect(canonicalContent(input, "n1")).toBe(
      'reqseq-version n1\ntext\n"Text"\nprop a\n1\nprop b\n"two"\nprop c\ntrue\n' +
        `file E/a.png\n${"a".repeat(64)}\nfile E/z.png\n${"b".repeat(64)}\n`,
    );
  });

  it("writes an empty text section for an element without text", () => {
    expect(canonicalContent({ text: "\n\n", properties: {}, definitions: [], files: [] }, "n1")).toBe(
      'reqseq-version n1\ntext\n""\n',
    );
  });

  it("sorts keys and paths by code point, not by UTF-16 unit", () => {
    // U+1F600 (a surrogate pair, 0xD83D...) sorts before U+FF5E by UTF-16 unit but after it by code point.
    const input: VersionInput = {
      text: "",
      properties: {},
      definitions: [],
      files: [
        { path: "E/\u{1F600}.png", sha256: "1".repeat(64) },
        { path: "E/～.png", sha256: "2".repeat(64) },
      ],
    };
    const c = canonicalContent(input, "n1");
    expect(c.indexOf("～")).toBeLessThan(c.indexOf("\u{1F600}"));
  });

  it("writes nested objects as canonical JSON with sorted keys and normalised strings", () => {
    const input: VersionInput = {
      text: "",
      properties: { x: [{ z: "a  \r\n\r\n\r\nb ", y: null, w: [1, false] }] },
      definitions: [{ key: "x", kind: "text", content: true }],
      files: [],
    };
    expect(canonicalContent(input, "n1")).toBe(
      'reqseq-version n1\ntext\n""\nprop x\n[{"w":[1,false],"y":null,"z":"a\\n\\nb"}]\n',
    );
  });

  it("treats an absent property, null and an empty list alike and leaves them out", () => {
    const absent = withProps({ validity: undefined });
    expect(withProps({ validity: null })).toBe(absent);
    expect(withProps({ validity: [] })).toBe(absent);
    expect(canonicalContent({ ...base, properties: { validity: [] } }, "n1")).not.toContain("prop validity");
  });

  it("writes the text as one JSON string, so text cannot forge a prop or file section", () => {
    const definition: VersionPropertyDefinition = { key: "requirement-type", kind: "choice", content: true };
    const forged = {
      text: 'A\nprop requirement-type\n"functional"',
      properties: {},
      definitions: [definition],
    };
    const real = { text: "A", properties: { "requirement-type": "functional" }, definitions: [definition] };
    expect(computeVersion({ ...forged, files: [] }, "n1")).not.toBe(
      computeVersion({ ...real, files: [] }, "n1"),
    );
    expect(canonicalContent({ ...forged, files: [] }, "n1")).toBe(
      'reqseq-version n1\ntext\n"A\\nprop requirement-type\\n\\"functional\\""\n',
    );
    const file = { path: "x.png", sha256: "a".repeat(64) };
    expect(computeVersion({ ...real, text: `A\nfile x.png\n${file.sha256}`, files: [] }, "n1")).not.toBe(
      computeVersion({ ...real, files: [file] }, "n1"),
    );
  });

  it("writes a fixed marker for a linked file that does not exist", () => {
    const input: VersionInput = {
      text: "",
      properties: {},
      definitions: [],
      files: [{ path: "a.png", sha256: null }],
    };
    expect(MISSING_FILE).toBe("missing");
    expect(canonicalContent(input, "n1")).toBe('reqseq-version n1\ntext\n""\nfile a.png\nmissing\n');
    expect(computeVersion({ ...input, files: [{ path: "a.png", sha256: image }] }, "n1")).not.toBe(
      computeVersion(input, "n1"),
    );
  });

  it("rejects a file path given twice", () => {
    const files = [
      { path: "a.png", sha256: image },
      { path: "a.png", sha256: image },
    ];
    expect(() => computeVersion({ text: "", properties: {}, definitions: [], files }, "n1")).toThrow(
      "version: file a.png given twice",
    );
  });

  it("writes numbers like ECMAScript and rejects non-finite numbers", () => {
    const definition: VersionPropertyDefinition = { key: "n", kind: "number", content: true };
    const canon = (n: number): string =>
      canonicalContent({ text: "", properties: { n: [n] }, definitions: [definition], files: [] }, "n1");
    expect(canon(1.0)).toContain("prop n\n[1]\n");
    expect(canon(1e21)).toContain("prop n\n[1e+21]\n");
    expect(canon(0.1)).toContain("prop n\n[0.1]\n");
    expect(canon(-0)).toContain("prop n\n[0]\n");
    expect(() => canon(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => canon(Number.NaN)).toThrow("version: NaN is not a valid number");
  });

  it("compares content with non-finite numbers without a version (#276)", () => {
    const definition: VersionPropertyDefinition = { key: "n", kind: "number", content: true };
    const input = (n: number, text = ""): VersionInput => ({
      text,
      properties: { n: { at: [n] } },
      definitions: [definition],
      files: [],
    });
    expect(comparableContent(input(Number.NEGATIVE_INFINITY), "n1")).toBe(
      'reqseq-version n1\ntext\n""\nprop n\n{"at":[-Infinity]}\n',
    );
    expect(comparableContent(input(Number.NaN), "n1")).toContain("[NaN]");
    expect(comparableContent(input(Number.NaN, "a"), "n1")).not.toBe(
      comparableContent(input(Number.NaN, "b"), "n1"),
    );
    // A finite value gives the canonical content of the version.
    expect(comparableContent(input(1), "n1")).toBe(canonicalContent(input(1), "n1"));
  });

  it("reads only own property keys, also for keys like constructor", () => {
    const def: VersionPropertyDefinition = { key: "constructor", kind: "text", content: true };
    const empty = canonicalContent({ text: "", properties: {}, definitions: [def], files: [] }, "n1");
    expect(empty).toBe('reqseq-version n1\ntext\n""\n');
    const set = canonicalContent(
      {
        text: "",
        properties: { constructor: "x" },
        definitions: [def],
        files: [],
      },
      "n1",
    );
    expect(set).toBe('reqseq-version n1\ntext\n""\nprop constructor\n"x"\n');
  });

  it("uses only the id of a single relation target and keeps other values unchanged", () => {
    const input: VersionInput = {
      text: "",
      properties: { one: { id: pro, version: "n1:0000000000000000" }, odd: ["plain", { title: "x" }] },
      definitions: [
        { key: "one", kind: "relation", content: true },
        { key: "odd", kind: "relation", content: true },
      ],
      files: [],
    };
    expect(canonicalContent(input, "n1")).toBe(
      `reqseq-version n1\ntext\n""\nprop odd\n["plain",{"title":"x"}]\nprop one\n"${pro}"\n`,
    );
  });

  describe("normalizeText", () => {
    it("unifies line endings, strips trailing spaces and tabs, collapses blank lines", () => {
      expect(normalizeText("\r\n \n# A  \r\rB\t\n\n \n\t\nC\r\n\r\n")).toBe("# A\n\nB\n\nC");
    });

    it("keeps leading spaces, inner spaces and Unicode unchanged", () => {
      expect(normalizeText("  - a  b\né")).toBe("  - a  b\né");
      expect(normalizeText("é")).not.toBe(normalizeText("é"));
    });
  });

  describe.each(["n1", "n2"] as const)("in normal form %s", (form) => {
    const vIn = (patch: Partial<VersionInput>): string => computeVersion({ ...base, ...patch }, form);
    const propsIn = (props: VersionInput["properties"]): string =>
      vIn({ properties: { ...base.properties, ...props } });

    it("[SR-091/AK1] is equal for the same content with other line endings or trailing spaces", () => {
      const lf = computeVersion(base, form);
      const crlf = base.text.replace(/\n/g, "\r\n");
      const cr = base.text.replace(/\n/g, "\r");
      const spaced = base.text.replace(/\n/g, "  \t\n");
      const blank = `\n\n${base.text.replace("\n\n", "\n\n\n \n")}\n\n\n`;
      expect(vIn({ text: crlf })).toBe(lf);
      expect(vIn({ text: cr })).toBe(lf);
      expect(vIn({ text: spaced })).toBe(lf);
      expect(vIn({ text: blank })).toBe(lf);
      expect(
        propsIn({ "acceptance-criteria": ["Given A, when B, then C.  ", "Given D, when E, then F.\r\n"] }),
      ).toBe(lf);
    });

    it("[SR-091/AK2] stays equal when only properties that do not count change", () => {
      const before = computeVersion(base, form);
      expect(propsIn({ status: "approved" })).toBe(before);
      expect(propsIn({ title: "Show wind speed in large digits" })).toBe(before);
      expect(propsIn({ rationale: "Other reason." })).toBe(before);
      expect(propsIn({ packages: [] })).toBe(before);
      expect(propsIn({ "derives-from": [] })).toBe(before);
      expect(propsIn({ "customer-id": "WS-0816" })).toBe(before);
      expect(propsIn({ statement: "Agreed." })).toBe(before);
      // A content-flagged property the element's type does not have is not passed as definition.
      expect(propsIn({ "unknown-content": "x" })).toBe(before);
      // Only the id of a validity target counts, not its version or title (no cascade).
      expect(propsIn({ validity: [{ id: pro, version: "n1:ffffffffffffffff", title: "Pro 2" }] })).toBe(
        before,
      );
    });

    it("[SR-091/AK3] changes when text, an acceptance criterion or a content property changes", () => {
      const before = computeVersion(base, form);
      expect(vIn({ text: `${base.text}More.\n` })).not.toBe(before);
      expect(vIn({ text: base.text.replace("|---|---|", "| --- | --- |") })).not.toBe(before);
      expect(vIn({ text: base.text.replace("wind speed", "*wind speed*") })).not.toBe(before);
      expect(
        propsIn({ "acceptance-criteria": ["Given A, when B, then C!", "Given D, when E, then F."] }),
      ).not.toBe(before);
      expect(
        propsIn({ "acceptance-criteria": ["Given D, when E, then F.", "Given A, when B, then C."] }),
      ).not.toBe(before);
      expect(propsIn({ "requirement-type": "quality" })).not.toBe(before);
      expect(propsIn({ validity: [{ id: lite, version: "n1:2c26b46b68ffc68f", title: "Pro" }] })).not.toBe(
        before,
      );
      expect(propsIn({ emergent: "yes" })).not.toBe(before);
    });

    it("[SR-091/AK4] changes when an embedded image changes", () => {
      const before = computeVersion(base, form);
      const changed = sha256Hex(new Uint8Array([1, 2, 4]));
      expect(vIn({ files: [{ path: "SR-825b7146fb54/layout.png", sha256: changed }] })).not.toBe(before);
      expect(vIn({ files: [...base.files, { path: "SR-825b7146fb54/b.png", sha256: image }] })).not.toBe(
        before,
      );
      expect(v({ files: [{ path: "SR-825b7146fb54/renamed.png", sha256: image }] })).not.toBe(before);
      expect(v({ files: [] })).not.toBe(before);
    });
  });

  it("hashes strings as UTF-8", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(sha256Hex("abc"));
  });
});

describe("normal form n2 (ADR-0005, #166, #688)", () => {
  it("writes the header n2 and the prefix n2, and computes n2 by default, the form the tool writes", () => {
    expect(NORMAL_FORM).toBe("n2");
    expect(canonicalContent(base, "n2").startsWith("reqseq-version n2\n")).toBe(true);
    expect(computeVersion(base, "n2")).toMatch(/^n2:[0-9a-f]{16}$/);
    expect(computeVersion(base, "n1")).toMatch(/^n1:[0-9a-f]{16}$/);
    expect(comparableContent(base, "n2")).toBe(canonicalContent(base, "n2"));
  });

  it("[SR-091/AK5] gives the same n2 for reordered and duplicated relation targets, and one target equals a list of one", () => {
    const of = (validity: VersionInput["properties"][string]): string =>
      computeVersion({ ...base, properties: { ...base.properties, validity } }, "n2");
    const ordered = of([{ id: lite }, { id: pro }]);
    expect(of([{ id: pro }, { id: lite }, { id: pro, version: "n1:1111111111111111" }])).toBe(ordered);
    expect(of({ id: pro })).toBe(of([{ id: pro }]));
    // n1 keeps order, duplicates and the single form.
    const n1 = (validity: VersionInput["properties"][string]): string =>
      computeVersion({ ...base, properties: { ...base.properties, validity } }, "n1");
    expect(n1([{ id: pro }, { id: lite }])).not.toBe(n1([{ id: lite }, { id: pro }]));
    expect(n1({ id: pro })).not.toBe(n1([{ id: pro }]));
  });

  it("[SR-091/AK3] gives another n2 for an added relation target", () => {
    const of = (validity: VersionInput["properties"][string]): string =>
      computeVersion({ ...base, properties: { ...base.properties, validity } }, "n2");
    expect(of([{ id: pro }, { id: lite }])).not.toBe(of([{ id: pro }]));
  });

  it("writes malformed relation entries after the sorted ids, in file order", () => {
    const content = canonicalContent(
      {
        ...base,
        properties: { ...base.properties, validity: [{ id: pro }, { title: "x" }, 3, { id: lite }] },
      },
      "n2",
    );
    expect(content).toContain(`prop validity\n["${lite}","${pro}",{"title":"x"},3]\n`);
  });
});

describe("sameVersion (ADR-0005 normal form 2)", () => {
  const forms = { n1: "n1:1111111111111111", n2: "n2:2222222222222222" };
  it("compares a stored version in its own form and knows no other form", () => {
    expect(formOf("n1:1111111111111111")).toBe("n1");
    expect(formOf("n2:1111111111111111")).toBe("n2");
    expect(formOf("n3:1111111111111111")).toBeUndefined();
    expect(sameVersion("n1:1111111111111111", forms)).toBe(true);
    expect(sameVersion("n2:2222222222222222", forms)).toBe(true);
    expect(sameVersion("n2:1111111111111111", forms)).toBe(false);
    expect(sameVersion("n1:2222222222222222", forms)).toBe(false);
    expect(sameVersion("n3:1111111111111111", { ...forms, n3: "n3:1111111111111111" } as typeof forms)).toBe(
      false,
    );
  });
});
