// The input of normal form n2 (ADR-0005, #166) and the n2 entries of the published test vectors.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  canonicalContent,
  computeVersion,
  computeVersions,
  sha256Hex,
  type VersionInput,
  type VersionPropertyKind,
  type VersionValue,
} from "../version/version.js";
import { n2Input, versionIn, withoutReferenceVersions, withoutVersionParam } from "./version-input.js";

const U = "878e339e-1f73-4746-abab-42cdd0f51ca7";

describe("withoutVersionParam", () => {
  it.each([
    [`reqseq:${U}?version=n1:aa`, `reqseq:${U}`],
    [`reqseq:${U}?version=n1:aa&repository=r`, `reqseq:${U}?repository=r`],
    [`reqseq:${U}?repository=r&version=n1:aa`, `reqseq:${U}?repository=r`],
    [`reqseq:${U}?version=a&&repository=x`, `reqseq:${U}?repository=x`],
    [`reqseq:${U}?version=n1:aa#f`, `reqseq:${U}`],
    [`reqseq:${U}?version=n1:aa\\&x=1`, `reqseq:${U}?x=1`],
    [`reqseq:${U}`, `reqseq:${U}`],
    [`reqseq:${U}?repository=r&&`, `reqseq:${U}?repository=r&&`],
    [`reqseq:${U}?Version=x&version`, `reqseq:${U}?Version=x&version`],
  ])("%s becomes %s", (destination, expected) => {
    expect(withoutVersionParam(destination)).toBe(expected);
  });
});

describe("withoutReferenceVersions", () => {
  it("[SR-091/AK-g044] removes the stored version of every inline reference and nothing else", () => {
    const text = `See [a](reqseq:${U}?version=n1:aa) and [b](<reqseq:${U}?version=n1:bb> "t"), ![i](reqseq:${U}?version=x), \`[c](reqseq:${U}?version=y)\`.`;
    expect(withoutReferenceVersions(text)).toBe(
      `See [a](reqseq:${U}) and [b](<reqseq:${U}> "t"), ![i](reqseq:${U}?version=x), \`[c](reqseq:${U}?version=y)\`.`,
    );
  });
});

describe("n2Input", () => {
  it("[SR-091/AK-g044] strips the text and every string of a property that counts, whatever its kind but relation", () => {
    const link = `[w](reqseq:${U}?version=n1:aa)`;
    const input: VersionInput = {
      text: `Text ${link}.`,
      properties: {
        "acceptance-criteria": [`Given ${link}.`],
        rationale: `Not counted ${link}.`,
        detail: { note: link, n: 1 },
        validity: [{ id: U, version: "n1:aa" }],
        empty: null,
      },
      definitions: [
        { key: "acceptance-criteria", kind: "text", content: true },
        { key: "rationale", kind: "text" },
        { key: "detail", kind: "text", content: true },
        { key: "validity", kind: "relation", content: true },
        { key: "empty", kind: "text", content: true },
        { key: "absent", kind: "text", content: true },
      ],
      files: [],
    };
    const bare = `[w](reqseq:${U})`;
    expect(n2Input(input)).toEqual({
      ...input,
      text: `Text ${bare}.`,
      properties: {
        ...input.properties,
        "acceptance-criteria": [`Given ${bare}.`],
        detail: { note: bare, n: 1 },
      },
    });
  });

  it("[SR-091/AK-q8pb] keeps a text change outside a version parameter visible in n2", () => {
    const of = (text: string): string =>
      computeVersion(n2Input({ text, properties: {}, definitions: [], files: [] }), "n2");
    expect(of(`[w](reqseq:${U}?version=n1:aa)`)).toBe(of(`[w](reqseq:${U}?version=n1:bb)`));
    expect(of(`[w](reqseq:${U}?version=n1:aa)`)).not.toBe(of(`[x](reqseq:${U}?version=n1:aa)`));
  });
});

interface Vectors {
  metamodel: string;
  vectors: {
    element: string;
    files: string[];
    missing: string[];
    version: string;
    n2: { canonical: string; version: string };
  }[];
}
interface Metamodel {
  types: { key: string; properties: string[] }[];
  properties: { key: string; kind: VersionPropertyKind; content?: boolean }[];
}

const dir = path.resolve(import.meta.dirname, "../../../../schemas/examples/version");
const parse = (text: string): unknown => YAML.parse(text, { version: "1.2", schema: "core" });
const index = parse(fs.readFileSync(path.join(dir, "vectors.yaml"), "utf8")) as Vectors;
const metamodel = parse(fs.readFileSync(path.join(dir, index.metamodel), "utf8")) as Metamodel;

// Minimal frontmatter split for the vectors only, as in `version/vectors.test.ts`.
function inputFor(element: string, files: readonly string[], missing: readonly string[]): VersionInput {
  const raw = fs.readFileSync(path.join(dir, element), "utf8");
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (m?.[1] === undefined) {
    throw new Error(`${element}: no frontmatter`);
  }
  const properties = parse(m[1]) as Record<string, VersionValue>;
  const type = metamodel.types.find((t) => t.key === properties["type"]);
  return {
    text: raw.slice(m[0].length),
    properties,
    definitions: metamodel.properties.filter((p) => type?.properties.includes(p.key) === true),
    files: [
      ...files.map((f) => ({ path: f, sha256: sha256Hex(fs.readFileSync(path.join(dir, f))) })),
      ...missing.map((f) => ({ path: f, sha256: null })),
    ],
  };
}

describe("version test vectors, normal form n2 (ADR-0005)", () => {
  it.each(index.vectors)(
    "[SR-091/AK-g044] $element gives the published n2 canonical bytes and version",
    (vector) => {
      const input = n2Input(inputFor(vector.element, vector.files, vector.missing));
      expect(Buffer.from(canonicalContent(input, "n2"), "utf8")).toEqual(
        fs.readFileSync(path.join(dir, vector.n2.canonical)),
      );
      expect(computeVersion(input, "n2")).toBe(vector.n2.version);
    },
  );
});

describe("computeVersions", () => {
  it.each(index.vectors)("gives for $element the versions each form computes alone", (vector) => {
    const input = inputFor(vector.element, vector.files, vector.missing);
    expect(computeVersions(input, n2Input(input))).toEqual({
      n1: vector.version,
      n2: vector.n2.version,
    });
  });

  it("gives one form alone as versionIn", () => {
    const input = inputFor(
      index.vectors[0]?.element ?? "",
      index.vectors[0]?.files ?? [],
      index.vectors[0]?.missing ?? [],
    );
    expect(versionIn(input, "n1")).toBe(computeVersions(input, n2Input(input)).n1);
    expect(versionIn(input, "n2")).toBe(computeVersions(input, n2Input(input)).n2);
  });

  it("writes a section again where the forms differ: a value with a reference, a relation, the text", () => {
    const ref = `[a](reqseq:${U}?version=n1:0000000000000000)`;
    const input: VersionInput = {
      text: `See ${ref}.`,
      properties: {
        note: `Also ${ref}`,
        list: [ref, "plain"],
        map: { k: ref },
        plain: "x",
        rel: [{ id: "b" }, { id: "a" }],
      },
      definitions: [
        { key: "note", kind: "text", content: true },
        { key: "list", kind: "text", content: true },
        { key: "map", kind: "text", content: true },
        { key: "plain", kind: "text", content: true },
        { key: "rel", kind: "relation", content: true },
      ],
      files: [{ path: "a.png", sha256: null }],
    };
    const n2 = n2Input(input);
    expect(n2.properties["plain"]).toBe(input.properties["plain"]);
    expect(computeVersions(input, n2)).toEqual({
      n1: computeVersion(input, "n1"),
      n2: computeVersion(n2, "n2"),
    });
    // Without any `version=` the n2 input keeps every value as it is.
    const bare: VersionInput = { ...input, text: "t", properties: { list: ["p"], map: { k: "v" } } };
    expect(n2Input(bare).properties["list"]).toBe(bare.properties["list"]);
    expect(n2Input(bare).properties["map"]).toBe(bare.properties["map"]);
    expect(n2Input(bare).text).toBe("t");
  });
});
