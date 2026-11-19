// Line-wise list edits (SR-236 AK3): every other line stays byte for byte.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { CommandError } from "../catalog.js";
import { parseYamlFileBytes } from "./parse.js";
import type { YamlPath } from "./yaml-list.js";
import { appendListItem, removeListItem, setMapValue } from "./yaml-list.js";

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
      "# a comment after the list, in a column left of its dash",
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

  it("adds after the comments that belong to the list, before the blank line and the next key's comment", () => {
    const head = "types:\n  - key: a\n    name: A\n    prefix: A # same line\n    # note\n";
    const tail = "\n# Properties\nproperties: []\n";
    expect(append(`${head}${tail}`, TYPE)).toBe(`${head}${indent(RENDERED, 2)}${tail}`);
    const nested = "a:\n  b: 1\n  # of a\n# top\nc: 2\n";
    expect(append(nested, 3, ["a", "list"])).toBe("a:\n  b: 1\n  # of a\n  list: [3]\n# top\nc: 2\n");
    expect(append("a:\n  ? b\n# top\n", 3, ["a", "list"])).toBe("a:\n  ? b\n  list: [3]\n# top\n");
  });

  it("keeps a line separator inside a value (U+2028) as text", () => {
    const out = append("types: []\n", { key: "x", name: "A\u2028B" });
    expect(fileOf(out).text).toContain("A\u2028B");
  });

  it("creates a missing top-level list before a document end marker", () => {
    expect(append("properties: []\n...\n", TYPE)).toBe(`properties: []\ntypes:\n${indent(RENDERED, 2)}...\n`);
  });

  it("adds a flow item to a flow list, also an empty, a multi-line one and one with a trailing comma", () => {
    expect(append("types: []\n", TYPE)).toBe(
      "types: [{key: risk, name: Risk, prefix: RI, required: [title]}]\n",
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

  it("adds a missing list to a flow mapping as its last entry, on its line, whose end comment goes (SR-236 AK3)", () => {
    const added = (text: string): string =>
      decode(appendListItem(fileOf(text), "m.yaml", ["types", 0, "required"], "x").bytes);
    expect(added("types:\n  - {key: a}   # goes\n# stays\n")).toBe(
      "types:\n  - {key: a, required: [x]}\n# stays\n",
    );
    expect(added("types:\n  - {key: a, }\n")).toBe("types:\n  - {key: a, required: [x], }\n");
    // Over several lines: the line of the last entry changes, the others keep their comments.
    expect(added("types:\n  - {   # stays\n      key: a,   # goes\n    }\n")).toBe(
      "types:\n  - {   # stays\n      key: a, required: [x],\n    }\n",
    );
    expect(added("types:\n  - {}   # goes\n")).toBe("types:\n  - { required: [x] }\n");
    // The last entry is a key without a value.
    expect(added("types:\n  - {key: a, b}   # goes\n")).toBe("types:\n  - {key: a, b, required: [x]}\n");
  });

  it("refuses with internal when the result would not hold exactly the intended data", () => {
    // A field without a value is not written, so the file would not hold the item as given.
    const error = errorOf(() => append("types:\n  - key: a\n", { key: "b", name: undefined }));
    expect(error.code).toBe("internal");
  });
});

const set = (text: string, at: YamlPath, key: string, value: unknown): string =>
  decode(setMapValue(fileOf(text), "m.yaml", at, key, value).bytes);

const remove = (text: string, at: YamlPath, index: number): string =>
  decode(removeListItem(fileOf(text), "m.yaml", at, index).bytes);

describe("setMapValue", () => {
  const TYPES = [
    "# head",
    "types:",
    "  - key: need   # the need",
    "    name: Need # its name",
    "    prefix: N",
    "    # about need",
    "  - key: sr",
    "    name: SR",
    "    prefix: SR",
    "",
  ].join("\n");

  it("replaces the key's line in place, drops the comment at its end and keeps every other line", () => {
    expect(set(TYPES, ["types", 0], "name", "Wish")).toBe(
      TYPES.replace("name: Need # its name", "name: Wish"),
    );
  });

  it("changes the first key on the dash line", () => {
    expect(set("types:\n  - name: A\n    prefix: A\n", ["types", 0], "name", "B")).toBe(
      "types:\n  - name: B\n    prefix: A\n",
    );
  });

  it("replaces a value over several lines and quotes a text that needs it", () => {
    const text = "types:\n  - key: a\n    description: |\n      two\n      lines\n    prefix: A\n";
    expect(set(text, ["types", 0], "description", "a: b\nc")).toBe(
      'types:\n  - key: a\n    description: "a: b\\nc"\n    prefix: A\n',
    );
  });

  it("adds a missing key after the item's last line, before the comment of the next item", () => {
    expect(set(TYPES, ["types", 0], "abstract", true)).toBe(
      TYPES.replace("    # about need\n", "    # about need\n    abstract: true\n"),
    );
    expect(set("types:\n  - key: a\n", ["types", 0], "extends", "b")).toBe(
      "types:\n  - key: a\n    extends: b\n",
    );
  });

  it("removes a key with its lines; the first key of an item gives the dash to the next one", () => {
    expect(set(TYPES, ["types", 1], "name", undefined)).toBe(TYPES.replace("    name: SR\n", ""));
    expect(set("types:\n  - abstract: true\n    key: a\n", ["types", 0], "abstract", undefined)).toBe(
      "types:\n  - key: a\n",
    );
    expect(set(TYPES, ["types", 1], "extends", undefined)).toBe(TYPES);
    // A comment line between the first key and the next one stays; the dash keeps its line.
    expect(
      set("types:\n  - abstract: true\n    # the key\n    key: a\n", ["types", 0], "abstract", undefined),
    ).toBe("types:\n  -\n    # the key\n    key: a\n");
  });

  it("changes the last line of a file without a line break, and a key without a value", () => {
    expect(set("types:\n  - key: a\n    name: A", ["types", 0], "name", "B")).toBe(
      "types:\n  - key: a\n    name: B",
    );
    expect(set("types:\n  - key: a\n    name:\n", ["types", 0], "name", "B")).toBe(
      "types:\n  - key: a\n    name: B\n",
    );
  });

  it("keeps CRLF line endings", () => {
    const text = "types:\r\n  - key: a\r\n    name: A\r\n";
    expect(set(text, ["types", 0], "name", "B")).toBe("types:\r\n  - key: a\r\n    name: B\r\n");
    expect(set(text, ["types", 0], "prefix", "P")).toBe(
      "types:\r\n  - key: a\r\n    name: A\r\n    prefix: P\r\n",
    );
  });

  it("changes only the entry of a flow mapping", () => {
    const text = "values:\n  - { key: a, name: A }\n  - {}\n";
    expect(set(text, ["values", 0], "name", "B C")).toBe("values:\n  - { key: a, name: B C }\n  - {}\n");
    expect(set(text, ["values", 0], "description", "d")).toBe(
      "values:\n  - { key: a, name: A, description: d }\n  - {}\n",
    );
    expect(set(text, ["values", 1], "key", "b")).toBe("values:\n  - { key: a, name: A }\n  - { key: b }\n");
    expect(set(text, ["values", 0], "key", undefined)).toBe("values:\n  - { name: A }\n  - {}\n");
    expect(set(text, ["values", 0], "name", undefined)).toBe("values:\n  - { key: a }\n  - {}\n");
    expect(set("values:\n  - { key: a }\n", ["values", 0], "key", undefined)).toBe("values:\n  - {  }\n");
    expect(set(text, ["values", 0], "other", undefined)).toBe(text);
    // A key without a value in a flow mapping.
    expect(set("values:\n  - { key: a, name }\n", ["values", 0], "description", "d")).toBe(
      "values:\n  - { key: a, name, description: d }\n",
    );
  });

  it("refuses an anchor or alias and a path to no mapping", () => {
    const anchored = "types:\n  - &a\n    key: a\n    name: A\n";
    expect(errorOf(() => set(anchored, ["types", 0], "name", "B")).details).toEqual({
      file: "m.yaml",
      line: 2,
    });
    const alias = "x: &n Name\ntypes:\n  - key: a\n    name: *n\n";
    expect(errorOf(() => set(alias, ["types", 0], "name", "B")).details).toEqual({ file: "m.yaml", line: 4 });
    expect(errorOf(() => set("types: [a]\n", ["types", 0], "name", "B")).code).toBe("file.faulty");
    expect(errorOf(() => set("- a\n", ["types", 0], "name", "B")).code).toBe("file.faulty");
  });
});

describe("anchors and aliases inside a definition (SR-236 AK5)", () => {
  const ANCHORED = "types:\n  - key: a\n    name: &n Scratch\n  - key: b\n    name: *n\n";
  it("refuses to change or remove a definition that holds an anchor or an alias, with file and line", () => {
    expect(errorOf(() => set(ANCHORED, ["types", 0], "prefix", "S")).details).toEqual({
      file: "m.yaml",
      line: 3,
    });
    expect(errorOf(() => set(ANCHORED, ["types", 1], "prefix", "S")).details).toEqual({
      file: "m.yaml",
      line: 5,
    });
    expect(errorOf(() => remove(ANCHORED, ["types"], 0)).details).toEqual({ file: "m.yaml", line: 3 });
    expect(errorOf(() => remove(ANCHORED, ["types"], 1)).code).toBe("file.faulty");
  });
});

describe("removeListItem", () => {
  it("removes a block item with the comment lines directly above it and keeps the rest", () => {
    const text = [
      "types:",
      "  - key: a",
      "    name: A",
      "",
      "  # about b",
      "  # more about b",
      "  - key: b   # b",
      "    name: B",
      "    # below b",
      "  - key: c",
      "",
    ].join("\n");
    expect(remove(text, ["types"], 1)).toBe(
      // The comment below b in the column of its keys goes with it.
      ["types:", "  - key: a", "    name: A", "", "  - key: c", ""].join("\n"),
    );
    // A comment above the item in another column than its dash belongs to the item before: it stays.
    expect(remove(text, ["types"], 2)).toBe(text.replace("  - key: c\n", ""));
  });

  it("removes a plain item and an item of a nested list, also at the end of a file without a line break", () => {
    expect(
      remove("types:\n  - key: a\n    statuses:\n      - x\n      - y", ["types", 0, "statuses"], 1),
    ).toBe("types:\n  - key: a\n    statuses:\n      - x\n");
  });

  it("removes a line of a flow list written over several lines and leaves no blank line", () => {
    const text = "properties: [\n    title,\n    rationale, # why\n    packages\n  ]\n";
    expect(remove(text, ["properties"], 0)).toBe("properties: [\n    rationale, # why\n    packages\n  ]\n");
    expect(remove(text, ["properties"], 1)).toBe("properties: [\n    title,\n    packages\n  ]\n");
    expect(remove(text, ["properties"], 2)).toBe("properties: [\n    title,\n    rationale\n  ]\n");
  });

  it("removes the comment lines below a block item in the column of its keys, not those of the next item", () => {
    expect(
      remove("types:\n  - key: a\n    name: A\n    # about a\n  # about b\n  - key: b\n", ["types"], 0),
    ).toBe("types:\n  # about b\n  - key: b\n");
  });

  it("finds the dash of an item that starts below it, past a dash in a comment", () => {
    expect(remove("types:\n  - # the a-type\n    # a - b\n    key: a\n  - key: b\n", ["types"], 0)).toBe(
      "types:\n  - key: b\n",
    );
  });

  it("removes comment lines up to the start of the file", () => {
    expect(remove("types:\n- key: a\n- key: b\n", ["types"], 0)).toBe("types:\n- key: b\n");
    expect(remove("types:\n  # x\n  - a\n  - b\n", ["types"], 0)).toBe("types:\n  - b\n");
  });

  it("leaves an empty flow list when the last item goes", () => {
    expect(remove("types:\n  # the one\n  - key: a\nstatuses: []\n", ["types"], 0)).toBe(
      "types: []\nstatuses: []\n",
    );
    expect(remove("t:\n  types:\n    - key: a\n", ["t", "types"], 0)).toBe("t:\n  types: []\n");
  });

  it("removes a flow item with its separator", () => {
    expect(remove("statuses: [a, b, c]\n", ["statuses"], 1)).toBe("statuses: [a, c]\n");
    expect(remove("statuses: [a, b, c]\n", ["statuses"], 2)).toBe("statuses: [a, b]\n");
    expect(remove("statuses: [a]\n", ["statuses"], 0)).toBe("statuses: []\n");
  });

  it("refuses an anchored item and a missing item", () => {
    const anchored = "types:\n  - &a\n    key: a\n  - *a\n";
    expect(errorOf(() => remove(anchored, ["types"], 0)).details).toEqual({ file: "m.yaml", line: 2 });
    expect(errorOf(() => remove(anchored, ["types"], 1)).details).toEqual({ file: "m.yaml", line: 4 });
    expect(errorOf(() => remove("types: []\n", ["types"], 0)).code).toBe("file.faulty");
    expect(errorOf(() => remove("types: x\n", ["types"], 0)).code).toBe("file.faulty");
  });
});

describe("a comment at the end of a line changed within the line (SR-236 AK3, #1988)", () => {
  it("[SR-236/AK-k2s3] drops it when an item is added to a flow list, and keeps every other line", () => {
    expect(append("statuses: [draft, noted] # comment\nx: 1 # stays\n", "open", ["statuses"])).toBe(
      "statuses: [draft, noted, open]\nx: 1 # stays\n",
    );
    expect(append("statuses: []   #c\n", "open", ["statuses"])).toBe("statuses: [open]\n");
    expect(append("statuses: [ # stays\n  draft,\n  noted # goes\n] # stays\n", "open", ["statuses"])).toBe(
      "statuses: [ # stays\n  draft,\n  noted, open\n] # stays\n",
    );
    // CRLF: the line keeps its line ending.
    expect(append("statuses: [a] # c\r\nx: 1\r\n", "b", ["statuses"])).toBe("statuses: [a, b]\r\nx: 1\r\n");
  });

  it("[SR-236/AK-k2s3] drops it when an entry of a flow mapping is changed, added or removed", () => {
    const text =
      "statuses:\n  - { key: draft, name: Draft, initial: true }  # first\n  - { key: open, name: Open }   # c\n";
    const first = "statuses:\n  - { key: draft, name: Draft, initial: true }  # first\n";
    expect(set(text, ["statuses", 1], "name", "Opened")).toBe(`${first}  - { key: open, name: Opened }\n`);
    expect(set(text, ["statuses", 1], "description", "d")).toBe(
      `${first}  - { key: open, name: Open, description: d }\n`,
    );
    expect(set(text, ["statuses", 1], "key", undefined)).toBe(`${first}  - { name: Open }\n`);
    expect(set(text, ["statuses", 1], "name", undefined)).toBe(`${first}  - { key: open }\n`);
    expect(set("s:\n  - { key: a } #c\n", ["s", 0], "key", undefined)).toBe("s:\n  - {  }\n");
    expect(set("s:\n  - {} #c\n", ["s", 0], "key", "a")).toBe("s:\n  - { key: a }\n");
    // A new list of a flow mapping (appendListItem) goes the same way.
    expect(append("types:\n  - { key: a } # c\n", "x", ["types", 0, "required"])).toBe(
      "types:\n  - { key: a, required: [x] }\n",
    );
  });

  it("[SR-236/AK-k2s3] drops it when an item of a flow list is removed, and keeps a line that reads as before", () => {
    expect(remove("statuses: [a, b]   # c\n", ["statuses"], 1)).toBe("statuses: [a]\n");
    expect(remove("statuses: [a, b] #c\n", ["statuses"], 0)).toBe("statuses: [b]\n");
    expect(remove("statuses: [a] # c\n", ["statuses"], 0)).toBe("statuses: []\n");
    // The removed item had a line of its own: the next line reads as before and keeps its comment.
    expect(remove("s: [\n  a,\n  b, # stays\n  c\n]\n", ["s"], 0)).toBe("s: [\n  b, # stays\n  c\n]\n");
    // The only item on a line of its own: the line goes, with or without its comment.
    expect(remove("k: [\n  a # x\n]\n", ["k"], 0)).toBe("k: [\n]\n");
    expect(remove("k: [\n  a\n]\n", ["k"], 0)).toBe("k: [\n]\n");
    expect(set("s:\n  - {\n      key: a # x\n    }\n", ["s", 0], "key", undefined)).toBe(
      "s:\n  - {\n    }\n",
    );
    // The key line of a block list that loses its only item changes to `[]`.
    expect(remove("types: # all\n  - key: a\nx: 1 # stays\n", ["types"], 0)).toBe(
      "types: []\nx: 1 # stays\n",
    );
  });

  it("[SR-236/AK-k2s3] does not take a # in a value for a comment, and keeps the comment of a line that does not change", () => {
    expect(set('s:\n  - { key: a, name: "A #1", note: n }  # c\n', ["s", 0], "note", "m")).toBe(
      's:\n  - { key: a, name: "A #1", note: m }\n',
    );
    expect(set("s:\n  - { key: a, name: 'it''s #2', note: n }\n", ["s", 0], "note", "m")).toBe(
      "s:\n  - { key: a, name: 'it''s #2', note: m }\n",
    );
    expect(append("s: [a#b, 'c #d']\n", "e", ["s"])).toBe("s: [a#b, 'c #d', e]\n");
    // The same value again: the line reads as before.
    expect(set("s:\n  - { key: a } # c\n", ["s", 0], "key", "a")).toBe("s:\n  - { key: a } # c\n");
  });
});

describe("line edits on the metamodel files of this repository", () => {
  const FILES = ["spec/metamodel/spec-model.yaml", "schemas/examples/metamodel/standard-model.yaml"];
  const read = (file: string): string =>
    fs.readFileSync(new URL(`../../../../${file}`, import.meta.url), "utf8");

  /** Whether `after` is `before` without one run of whole lines. */
  const linesRemoved = (before: string, after: string): boolean => {
    const a = before.split("\n");
    const b = after.split("\n");
    let head = 0;
    while (head < b.length && a[head] === b[head]) {
      head += 1;
    }
    let tail = 0;
    while (tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
      tail += 1;
    }
    return head + tail === b.length && b.length < a.length;
  };

  it.each(FILES)("removing any definition of %s removes only its lines (SR-236 AK3)", (file) => {
    const text = read(file);
    const data = fileOf(text);
    const lists = ["types", "properties", "relations", "statuses"] as const;
    let removed = 0;
    for (const list of lists) {
      const items = (
        parseYamlFileBytes(file, new TextEncoder().encode(text)) as {
          content: { data: Record<string, unknown[]> };
        }
      ).content.data[list];
      for (let index = 0; index < (items?.length ?? 0); index += 1) {
        const out = decode(removeListItem(data, file, [list], index).bytes);
        expect(linesRemoved(text, out), `${list}[${String(index)}]`).toBe(true);
        removed += 1;
      }
    }
    expect(removed).toBeGreaterThan(10);
  });

  it.each(FILES)("changing the name of any type of %s changes only its name line (SR-236 AK3)", (file) => {
    const text = read(file);
    const types = (
      parseYamlFileBytes(file, new TextEncoder().encode(text)) as { content: { data: { types: unknown[] } } }
    ).content.data.types;
    types.forEach((_, index) => {
      const out = set(text, ["types", index], "name", "Changed name");
      const a = text.split("\n");
      const b = out.split("\n");
      expect(b.length).toBe(a.length);
      expect(a.filter((line, i) => line !== b[i])).toHaveLength(1);
    });
  });

  it("applies several edits to one file, each on the text the one before gave", () => {
    let yaml = fileOf("types:\n  - key: a\n    name: A\n  - key: b\n    name: B\nproperties:\n  - key: p\n");
    const step = (result: { readonly bytes: Uint8Array }): void => {
      yaml = { text: decode(result.bytes), bom: false };
    };
    step(setMapValue(yaml, "m.yaml", ["types", 0], "name", "Z"));
    step(removeListItem(yaml, "m.yaml", ["types"], 1));
    step(removeListItem(yaml, "m.yaml", ["properties"], 0));
    expect(yaml.text).toBe("types:\n  - key: a\n    name: Z\nproperties: []\n");
  });
});
