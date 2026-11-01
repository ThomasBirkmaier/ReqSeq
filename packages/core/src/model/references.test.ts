import { describe, expect, it } from "vitest";
import { parseFileBytes } from "../files/index.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import type { Metamodel } from "../metamodel/index.js";
import {
  inlineReferences,
  placeOfReference,
  referenceTargetState,
  referencesOf,
  resolveReference,
  elementLinks,
  unresolvedLinks,
} from "./references.js";
import type { ElementStore } from "./store.js";
import type { RepositoryLocation } from "../workspace/index.js";

const A = "0c8a3e5f-2d1b-4f6e-8a9c-7b3d5e1f2a4c";
const B = "a7f3c1e9-5b2d-4e8f-b6a4-0e9d7c5b3a21";
const V = "n1:1111111111111111";

const record = (id: string, repository: string, file = "x.md"): ElementRecord => ({
  id,
  type: "need",
  repository,
  file,
  data: { id, type: "need" },
  eol: "\n",
  closingEol: "\n",
  bom: false,
  snapshot: { path: file, size: 0, mtimeMs: 0, sha256: "" },
});

const storeOf = (...elements: ElementRecord[]): ElementStore => {
  const byId = new Map<string, ElementRecord[]>();
  for (const e of elements) {
    byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  }
  return { elements, byId, nonElements: [], problems: [] };
};

const repository = (name: string, available: boolean): RepositoryLocation => ({
  name,
  url: "u",
  main: name === "system",
  path: name === "system" ? "." : `../${name}`,
  folder: `/work/${name}`,
  available,
  excludes: [],
});

const layout = (sensorAvailable: boolean): { readonly repositories: readonly RepositoryLocation[] } => ({
  repositories: [repository("system", true), repository("sensor", sensorAvailable)],
});

describe("inline references with repository (D-058, decision on #177 (c))", () => {
  it("reads the version and the first repository parameter as written (an empty one as none), and the line of each link", () => {
    const text = [
      `a [b](reqseq:${A}?version=${V}&repository=sensor&repository=other)`,
      "",
      `[c](reqseq:${B}) [d](reqseq:${B}?repository=)`,
      `[e](reqseq:${A}?x=1)`,
    ].join("\n");
    expect(
      inlineReferences(text).map(({ id, version, repository, line }) => [id, version, repository, line]),
    ).toEqual([
      [A, V, "sensor", 1],
      [B, undefined, undefined, 3],
      [B, undefined, undefined, 3],
      [A, undefined, undefined, 4],
    ]);
  });

  it("gives the references of a text with their lines in the file, and none for a text without reqseq links", () => {
    const textReferences = (frontmatter: string, body: string): unknown =>
      elementLinks(frontmatter, body, {}, () => undefined).references;
    expect(
      textReferences("id: x\ntype: y\n", `\nSee [a](reqseq:${A}?version=${V}&repository=sensor).\n`),
    ).toEqual([{ id: A, version: V, repository: "sensor", line: 6 }]);
    expect(textReferences("", `[a](reqseq:${A})`)).toEqual([{ id: A, line: 3 }]);
    expect(textReferences("id: x\n", "[a](https://example.com) and `reqseq:` in code")).toEqual([]);
  });

  it("keeps the references of an element in its record, and none for a text without them", () => {
    const parse = (text: string): ElementRecord => {
      const parsed = parseFileBytes("n.md", new TextEncoder().encode(text));
      if (parsed.kind !== "parsed") {
        throw new Error("not parsed");
      }
      const classified = classifyFile("system", {
        ...parsed.content,
        path: "n.md",
        snapshot: { path: "n.md", size: 0, mtimeMs: 0, sha256: "" },
      });
      if (classified.kind !== "element") {
        throw new Error("no element");
      }
      return classified.element;
    };
    expect(
      parse(`---\nid: ${A}\ntype: need\n---\n\n[b](reqseq:${B}?version=${V}&repository=sensor)\n`).references,
    ).toEqual([{ id: B, version: V, repository: "sensor", line: 6 }]);
    expect(Object.hasOwn(parse(`---\nid: ${A}\ntype: need\n---\nNo references.\n`), "references")).toBe(
      false,
    );
  });

  it("looks a target up in the repository the reference names, as a relation target", () => {
    const store = storeOf(record(A, "system"), record(B, "sensor"));
    expect(referenceTargetState(layout(true), store, "system", { id: B, repository: "sensor" }).kind).toBe(
      "available",
    );
    expect(referenceTargetState(layout(true), store, "system", { id: B, repository: "system" })).toEqual({
      kind: "missing",
      repository: "system",
    });
    expect(referenceTargetState(layout(false), store, "system", { id: B, repository: "sensor" })).toEqual({
      kind: "inaccessible",
      repository: "sensor",
    });
    expect(referenceTargetState(layout(true), store, "system", { id: B, repository: "elsewhere" })).toEqual({
      kind: "unknown-repository",
      repository: "elsewhere",
    });
  });

  it("looks a target without repository up in the source's own repository, then in the one other repository that has it", () => {
    // In its own repository first, even when another repository has the UUID too.
    const both = storeOf(record(B, "sensor"), record(B, "system", "copy.md"));
    expect(referenceTargetState(layout(true), both, "system", { id: B })).toEqual({
      kind: "available",
      element: record(B, "system", "copy.md"),
    });
    // Not there: the one record elsewhere (a link written before references named their repository).
    expect(referenceTargetState(layout(true), storeOf(record(B, "sensor")), "system", { id: B })).toEqual({
      kind: "available",
      element: record(B, "sensor"),
    });
    const twice = storeOf(record(B, "sensor"), record(B, "display"), record(A, "system"));
    expect(referenceTargetState(layout(true), twice, "system", { id: B })).toEqual({
      kind: "ambiguous",
      elements: [record(B, "sensor"), record(B, "display")],
    });
    const own = storeOf(record(B, "system", "a.md"), record(B, "system", "b.md"));
    expect(referenceTargetState(layout(true), own, "system", { id: B })).toMatchObject({
      kind: "ambiguous",
      repository: "system",
    });
    // Missing from the source's own repository, which is here, also while another one is not.
    const gone = "11111111-2222-4333-8444-555555555555";
    for (const available of [true, false]) {
      expect(referenceTargetState(layout(available), twice, "system", { id: gone })).toEqual({
        kind: "missing",
        repository: "system",
      });
    }
    expect(resolveReference(twice, "system", { id: gone })).toEqual({ kind: "unknown" });
    expect(resolveReference(twice, "system", { id: B, repository: "sensor" })).toEqual({
      kind: "found",
      element: record(B, "sensor"),
    });
  });
});

describe("references in the properties of the frontmatter (SR-127)", () => {
  const element = (frontmatter: string, body = ""): ElementRecord => {
    const parsed = parseFileBytes(
      "n.md",
      new TextEncoder().encode(`---\nid: ${A}\ntype: need\n${frontmatter}---\n${body}`),
    );
    if (parsed.kind !== "parsed") {
      throw new Error("not parsed");
    }
    const classified = classifyFile("system", {
      ...parsed.content,
      path: "n.md",
      snapshot: { path: "n.md", size: 0, mtimeMs: 0, sha256: "" },
    });
    if (classified.kind !== "element") {
      throw new Error("no element");
    }
    return classified.element;
  };
  const link = `[b](reqseq:${B}?version=${V})`;
  const marked = (...keys: string[]): Metamodel =>
    ({
      valid: true,
      properties: keys.map((key) => ({ key, name: key, kind: "text", markdown: true })),
    }) as unknown as Metamodel;

  it("records a link in any string value of the frontmatter, in a list or alone, with its line, and none for a file without reqseq: in it", () => {
    const record = element(
      [
        `title: See ${link}`,
        "items:",
        "  - Plain.",
        `  - "Then ${link}."`,
        "  - 5",
        "single: |",
        `  one ${link}`,
        `  two [c](reqseq:${A})`,
        `folded: Alone ${link}`,
        "number: 1",
        "",
      ].join("\n"),
      `Text with [c](reqseq:${A}).\n`,
    );
    expect(record.propertyReferences).toEqual([
      { id: B, version: V, line: 4, key: "title" },
      { id: B, version: V, line: 7, key: "items", item: 1 },
      { id: B, version: V, line: 10, key: "single" },
      { id: A, line: 11, key: "single" },
      { id: B, version: V, line: 12, key: "folded" },
    ]);
    expect(record.references).toEqual([{ id: A, line: 15 }]);
    expect(
      Object.hasOwn(element('a: "[x](https://example.com)"\n', `[c](reqseq:${A})`), "propertyReferences"),
    ).toBe(false);
    expect(Object.hasOwn(element("a: 'reqseq: no link'\n"), "propertyReferences")).toBe(false);
  });

  it("keeps the reqseq: links whose target is no UUID apart, properties first, then the text, with their lines (#176)", () => {
    const record = element(
      [
        "title: See [x](reqseq:N-1f2a4c?repository=sensor)",
        "items:",
        "  - Plain.",
        '  - "[y](reqseq:D-031) and [z](reqseq:' + A + ')"',
        "single: |",
        "  one",
        "  two [w](reqseq:SR-036)",
        "number: 1",
        "",
      ].join("\n"),
      "Text [a](reqseq:D-030), `[code](reqseq:D-1)`, ![img](reqseq:D-2), [empty](reqseq:?x=1).\n",
    );
    expect(record.unresolvedLinks).toEqual([
      { target: "N-1f2a4c", repository: "sensor", line: 4, key: "title" },
      { target: "D-031", line: 7, key: "items", item: 1 },
      { target: "SR-036", line: 10, key: "single" },
      { target: "D-030", line: 13 },
    ]);
    expect(record.propertyReferences).toEqual([{ id: A, line: 7, key: "items", item: 1 }]);
    expect(
      unresolvedLinks("[a](reqseq:D-030?repository=)\n[b](reqseq:D-031?repository=sensor)"),
    ).toMatchObject([
      { target: "D-030", destination: "reqseq:D-030?repository=", line: 1 },
      { target: "D-031", repository: "sensor", line: 2 },
    ]);
    expect(Object.hasOwn(element(`a: "[x](reqseq:${A})"\n`, `[c](reqseq:${A})`), "unresolvedLinks")).toBe(
      false,
    );
    expect(element('kk: &k other\n*k : "[x](reqseq:D-1)"\n').unresolvedLinks).toEqual([
      { target: "D-1", line: 1, key: "other" },
    ]);
  });

  it("keeps the reqseq: references of the text outside links and code apart, with their lines, and none of the properties (#633)", () => {
    const record = element(
      "notes: Like reqseq:N-1f2a4c.\n",
      [
        "- reqseq:N-6010df.",
        `- (reqseq:${A}) and reqseq:D-031, reqseq:SR-036-`,
        "- `reqseq:N-1` and [x](reqseq:N-2) and [y](https://e.org/?q=reqseq:N-3)",
        "- myreqseq:N-4, reqseq: alone, reqseq:-x, reqseq:",
        "",
      ].join("\n"),
    );
    expect(record.bareReferences).toEqual([
      { target: "N-6010df", line: 6 },
      { target: A, line: 7 },
      { target: "D-031", line: 7 },
      { target: "SR-036", line: 7 },
    ]);
    expect(Object.hasOwn(element("", "[x](reqseq:N-2)\n"), "bareReferences")).toBe(false);
  });

  it("puts a link in a value whose key is written as an alias on line 1, as the line cannot be found", () => {
    expect(element(`kk: &k other\n*k : "Then ${link}"\n`).propertyReferences).toEqual([
      { id: B, version: V, line: 1, key: "other" },
    ]);
  });

  it("gives the references of the properties marked markdown, then those of the text, and the record's own list when no marked property holds a link", () => {
    const record = element(`title: "${link}"\nnotes: "${link}"\nmore:\n  - "${link}"\n`, `[c](reqseq:${A})`);
    expect(referencesOf(record, marked("notes", "more")).map((r) => [r.key, r.item, r.id])).toEqual([
      ["notes", undefined, B],
      ["more", 0, B],
      [undefined, undefined, A],
    ]);
    expect(referencesOf(record, marked("other"))).toBe(record.references);
    expect(referencesOf(element("a: 1\n"), marked("notes"))).toEqual([]);
    const none = element(`title: "${link}"\n`);
    expect(referencesOf(none, marked("title"))).toHaveLength(1);
    expect(referencesOf(none, marked())).toEqual([]);
  });

  it("names the place of a reference for messages", () => {
    expect(placeOfReference({})).toBe("the text");
    expect(placeOfReference({ key: "rationale" })).toBe("rationale");
    expect(placeOfReference({ key: "acceptance-criteria", item: 1 })).toBe("acceptance-criteria (item 2)");
  });
});
