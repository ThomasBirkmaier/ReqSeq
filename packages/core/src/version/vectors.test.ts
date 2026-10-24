// Recomputes the published test vectors (schemas/examples/version/vectors.yaml, ADR-0005) from the element files.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  canonicalContent,
  computeVersion,
  sha256Hex,
  type VersionInput,
  type VersionPropertyKind,
  type VersionValue,
} from "./version.js";

interface Vectors {
  metamodel: string;
  vectors: { element: string; files: string[]; missing: string[]; canonical: string; version: string }[];
}
interface Metamodel {
  types: { key: string; properties: string[] }[];
  properties: { key: string; kind: VersionPropertyKind; content?: boolean }[];
}

const dir = path.resolve(import.meta.dirname, "../../../../schemas/examples/version");
const parse = (text: string): unknown => YAML.parse(text, { version: "1.2", schema: "core" });
const index = parse(fs.readFileSync(path.join(dir, "vectors.yaml"), "utf8")) as Vectors;
const metamodel = parse(fs.readFileSync(path.join(dir, index.metamodel), "utf8")) as Metamodel;

// Minimal frontmatter split for the vectors only; the files module (SR-008) owns real parsing.
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

describe("version test vectors (ADR-0005)", () => {
  it.each(index.vectors)(
    "[SR-091/AK1] $element gives the published canonical bytes and version",
    (vector) => {
      const input = inputFor(vector.element, vector.files, vector.missing);
      expect(Buffer.from(canonicalContent(input), "utf8")).toEqual(
        fs.readFileSync(path.join(dir, vector.canonical)),
      );
      expect(computeVersion(input)).toBe(vector.version);
    },
  );

  it("[SR-091/AK1] the CRLF vector has the same version as its LF form", () => {
    const vector = index.vectors.find((v) => v.element === "N-42cdd0f51ca7.md");
    expect(vector).toBeDefined();
    const crlf = inputFor("N-42cdd0f51ca7.md", [], []);
    expect(crlf.text).toContain("\r\n");
    expect(computeVersion({ ...crlf, text: crlf.text.replace(/\r\n/g, "\n") })).toBe(vector?.version);
  });

  it("[SR-091/AK1] the CR-only vector has the same version as its LF form", () => {
    const vector = index.vectors.find((v) => v.element === "SR-9f0a1b2c3d4e.md");
    expect(vector).toBeDefined();
    const cr = inputFor("SR-9f0a1b2c3d4e.md", vector?.files ?? [], vector?.missing ?? []);
    expect(cr.text).toMatch(/\r(?!\n)/);
    expect(cr.text).not.toContain("\n");
    expect(computeVersion({ ...cr, text: cr.text.replace(/\r/g, "\n") })).toBe(vector?.version);
  });
});
