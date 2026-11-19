// Line-wise list edits (SR-236 AK3): every other line stays byte for byte.
import { describe, expect, it } from "vitest";
import { CommandError } from "../catalog.js";
import { parseYamlFileBytes } from "./parse.js";
import type { YamlPath } from "./yaml-list.js";
import { appendListItem } from "./yaml-list.js";

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

/** The file as `readYamlFile` gives it: text without the byte order mark. */
const fileOf = (text: string): { readonly text: string; readonly bom: boolean } => {
  const outcome = parseYamlFileBytes("m.yaml", new TextEncoder().encode(text));
  if (outcome.kind !== "parsed") {
    throw new Error("fixture does not parse");
  }
  return outcome.content;
};

const append = (text: string, item: unknown, at: YamlPath = ["types"]): string =>
  decode(appendListItem(fileOf(text), "m.yaml", at, item).bytes);

const errorOf = (fn: () => unknown): CommandError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("no error");
};

const TYPE = { key: "risk", name: "Risk", prefix: "RI", required: ["title"] };
const RENDERED = "- key: risk\n  name: Risk\n  prefix: RI\n  required: [title]\n";
const indent = (text: string, n: number): string => text.replace(/^(?=.)/gm, " ".repeat(n));

describe("appendListItem", () => {
  it("adds the item after the last line of a block list and keeps every other line", () => {
    const text = [
      "# head",
      "reqseq-metamodel: 1",
      "types:",
      "  - key: need   # the need",
      "    name: Need",
      "    prefix: N",
      "  # a comment after the list",
      "",
      "statuses: []",
      "",
    ].join("\n");
    const lines = text.split("\n");
    expect(append(text, TYPE)).toBe(
      [...lines.slice(0, 6), indent(RENDERED, 2).trimEnd(), ...lines.slice(6)].join("\n"),
    );
  });

  it("puts the dash in the column of the list's first dash, also at column 0", () => {
    expect(append("types:\n- key: a\n  name: A\n", { key: "b" })).toBe(
      "types:\n- key: a\n  name: A\n- key: b\n",
    );
  });

  it("adds a plain value to a block list of plain values as a block item, also nested", () => {
    expect(append("statuses:\n  - draft\n  - approved\nx: 1\n", "obsolete", ["statuses"])).toBe(
      "statuses:\n  - draft\n  - approved\n  - obsolete\nx: 1\n",
    );
    expect(
      append("types:\n  - key: a\n    required:\n      - title\n", "spec-id", ["types", 0, "required"]),
    ).toBe("types:\n  - key: a\n    required:\n      - title\n      - spec-id\n");
  });

  it("keeps CRLF line endings and the byte order mark", () => {
    const bytes = appendListItem(fileOf("﻿types:\r\n  - key: a\r\nother: 1\n"), "m.yaml", ["types"], {
      key: "b",
      name: "B",
    }).bytes;
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      "﻿types:\r\n  - key: a\r\n  - key: b\r\n    name: B\r\nother: 1\n",
    );
  });

  it("puts the item on a line of its own when the list ends the file without a line break", () => {
    expect(append("types:\r\n  - key: a", { key: "b" })).toBe("types:\r\n  - key: a\r\n  - key: b\r\n");
  });

  it("adds after a block scalar that keeps its trailing lines (|+) as the last field", () => {
    const text = "types:\n  - key: a\n    description: |+\n      x\n\nother: 1\n";
    expect(append(text, { key: "b" })).toBe(
      "types:\n  - key: a\n    description: |+\n      x\n\n  - key: b\nother: 1\n",
    );
  });

  it("adds a flow item to a flow list, also an empty, a multi-line one and one with a trailing comma", () => {
    expect(append("types: []  # none yet\n", TYPE)).toBe(
      "types: [{key: risk, name: Risk, prefix: RI, required: [title]}]  # none yet\n",
    );
    expect(append("types: [ {key: a}, ]\n", { key: "b" })).toBe("types: [ {key: a}, {key: b}, ]\n");
    expect(append("types: [\n  {key: a},\n  {key: c}\n]\n", { key: "b" })).toBe(
      "types: [\n  {key: a},\n  {key: c}, {key: b}\n]\n",
    );
  });

  it("creates a missing top-level list at the end of the file, after a missing final line break", () => {
    expect(append("reqseq-metamodel: 1\nstatuses: []\n# end\n", TYPE)).toBe(
      `reqseq-metamodel: 1\nstatuses: []\n# end\ntypes:\n${indent(RENDERED, 2)}`,
    );
    expect(append("reqseq-metamodel: 1", { key: "a" })).toBe("reqseq-metamodel: 1\ntypes:\n  - key: a\n");
    expect(append("", { key: "a" })).toBe("types:\n  - key: a\n");
  });

  it("adds to and creates nested lists by path", () => {
    const text = "types:\n  - key: a\n    required: [title]\n  - key: b\n    name: B\nend: 1\n";
    expect(append(text, "spec-id", ["types", 0, "required"])).toBe(
      "types:\n  - key: a\n    required: [title, spec-id]\n  - key: b\n    name: B\nend: 1\n",
    );
    expect(append(text, "title", ["types", 1, "required"])).toBe(
      "types:\n  - key: a\n    required: [title]\n  - key: b\n    name: B\n    required: [title]\nend: 1\n",
    );
  });

  it("refuses an alias or an anchor on the list or on the way to it, with file and line", () => {
    for (const [text, at, line] of [
      ["a: &x\n  - k\ntypes: *x\n", ["types"], 3],
      ["types: &t\n  - key: a\n", ["types"], 1],
      ["types:\n  - &i\n    key: a\n", ["types", 0, "required"], 2],
    ] as const) {
      const error = errorOf(() => appendListItem(fileOf(text), "m.yaml", at, "x"));
      expect([error.code, error.details]).toEqual(["file.faulty", { file: "m.yaml", line }]);
      expect(error.message).toContain(`m.yaml:${String(line)}`);
    }
  });

  it("refuses a document that is not a block mapping, a value that is no list and a path to nothing", () => {
    for (const [text, at] of [
      ["- a\n", ["types"]],
      ["{types: []}\n", ["types"]],
      ["types: 1\n", ["types"]],
      ["types:\n  - {key: a}\n", ["types", 0, "required"]],
      ["types:\n  - key: a\n", ["types", 3, "required"]],
      ["", ["types", 0, "required"]],
    ] as const) {
      const error = errorOf(() => appendListItem(fileOf(text), "m.yaml", at, "x"));
      expect([text, error.code]).toEqual([text, "file.faulty"]);
    }
    expect(errorOf(() => appendListItem({ text: "a: [\n", bom: false }, "m.yaml", ["a"], "x")).code).toBe(
      "file.faulty",
    );
  });

  it("refuses with internal when the result would not hold exactly the intended data", () => {
    // A field without a value is not written, so the file would not hold the item as given.
    const error = errorOf(() => append("types:\n  - key: a\n", { key: "b", name: undefined }));
    expect(error.code).toBe("internal");
  });
});
