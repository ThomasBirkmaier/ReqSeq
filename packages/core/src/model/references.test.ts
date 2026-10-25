import { describe, expect, it } from "vitest";
import { parseFileBytes } from "../files/index.js";
import type { ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import { inlineReferences, referenceTargetState, resolveReference, textReferences } from "./references.js";
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
      `a [b](logreq:${A}?version=${V}&repository=sensor&repository=other)`,
      "",
      `[c](logreq:${B}) [d](logreq:${B}?repository=)`,
      `[e](logreq:${A}?x=1)`,
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

  it("gives the references of a text with their lines in the file, and none for a text without logreq links", () => {
    expect(
      textReferences("id: x\ntype: y\n", `\nSee [a](logreq:${A}?version=${V}&repository=sensor).\n`),
    ).toEqual([{ id: A, version: V, repository: "sensor", line: 6 }]);
    expect(textReferences("", `[a](logreq:${A})`)).toEqual([{ id: A, line: 3 }]);
    expect(textReferences("id: x\n", "[a](https://example.com) and `logreq:` in code")).toEqual([]);
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
      parse(`---\nid: ${A}\ntype: need\n---\n\n[b](logreq:${B}?version=${V}&repository=sensor)\n`).references,
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
