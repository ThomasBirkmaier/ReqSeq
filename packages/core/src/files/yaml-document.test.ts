import { describe, expect, it } from "vitest";
import { CommandError } from "../catalog.js";
import { parseYamlFileBytes } from "./parse.js";
import type { YamlKeyEdit } from "./yaml-document.js";
import { editYamlDocument, renderYamlDocument } from "./yaml-document.js";

const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

/** The file as `readYamlFile` gives it: text without the byte order mark. */
const fileOf = (text: string): { readonly text: string; readonly bom: boolean } => {
  const outcome = parseYamlFileBytes("f.yaml", new TextEncoder().encode(text));
  if (outcome.kind !== "parsed") {
    throw new Error("fixture does not parse");
  }
  return outcome.content;
};

const edit = (text: string, edits: readonly YamlKeyEdit[]): string =>
  decode(editYamlDocument(fileOf(text), edits).bytes);

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

const FILE = [
  "# Drafts of the team",
  "logreq-filter: 1",
  "name: Drafts   # shown in the app",
  "",
  "where:",
  "  # only drafts",
  "  status: [draft]",
  "# sorted",
  "sort:",
  "  - { by: title }",
  "",
].join("\n");

describe("renderYamlDocument", () => {
  it("writes block mappings, plain values as flow lists and quoted texts only where needed", () => {
    expect(
      renderYamlDocument({
        "logreq-filter": 1,
        name: "Open: drafts #1",
        description: "two\nlines",
        where: {
          all: [
            { type: ["need", "system-requirement"] },
            { any: [] },
            { property: "p", op: "in", value: [1, "2"] },
          ],
        },
        sort: [{ by: "title", order: "asc" }],
      }),
    ).toBe(
      [
        "logreq-filter: 1",
        'name: "Open: drafts #1"',
        'description: "two\\nlines"',
        "where:",
        "  all:",
        "    - type: [need, system-requirement]",
        "    - any: []",
        "    - property: p",
        "      op: in",
        '      value: [1, "2"]',
        "sort:",
        "  - by: title",
        "    order: asc",
        "",
      ].join("\n"),
    );
  });
});

describe("editYamlDocument", () => {
  it("rewrites only the lines of a changed key and keeps every other byte", () => {
    expect(edit(FILE, [{ key: "where", value: { status: ["draft", "review"] } }])).toBe(
      FILE.replace("where:\n  # only drafts\n  status: [draft]\n", "where:\n  status: [draft, review]\n"),
    );
    expect(edit(FILE, [{ key: "name", value: "My drafts" }])).toBe(
      FILE.replace("name: Drafts   # shown in the app\n", "name: My drafts\n"),
    );
  });

  it("removes a key with its lines and appends a new one at the end", () => {
    expect(edit(FILE, [{ key: "sort" }, { key: "view", value: "core" }])).toBe(
      FILE.replace("sort:\n  - { by: title }\n", "") + "view: core\n",
    );
    expect(edit("name: a", [{ key: "view", value: "core" }])).toBe("name: a\nview: core\n");
    expect(edit("", [{ key: "name", value: "a" }])).toBe("name: a\n");
  });

  it("keeps the line breaks, the byte order mark and a missing final line break", () => {
    const crlf = "﻿name: a\r\nwhere: {}\r\n";
    const out = editYamlDocument(fileOf(crlf), [{ key: "where", value: { status: ["draft"] } }]);
    expect(decode(out.bytes)).toBe("﻿name: a\r\nwhere:\r\n  status: [draft]\r\n");
    expect(edit("name: a\nwhere: {}", [{ key: "where", value: { all: [] } }])).toBe(
      "name: a\nwhere:\n  all: []",
    );
  });

  it("replaces a key without a value, removes the last key, and ignores the removal of a missing key", () => {
    expect(edit("name: a\ndescription:\nview: core\n", [{ key: "description", value: "Why" }])).toBe(
      "name: a\ndescription: Why\nview: core\n",
    );
    expect(edit("? description\nname: a\n", [{ key: "description", value: "Why" }])).toBe(
      "description: Why\nname: a\n",
    );
    expect(edit("name: a\n", [{ key: "name" }])).toBe("");
    expect(editYamlDocument(fileOf("name: a\n"), [{ key: "view" }]).changed).toBe(false);
  });

  it("keeps the indent of an indented mapping", () => {
    expect(edit("  name: a\n  view: core\n", [{ key: "name", value: "b" }])).toBe(
      "  name: b\n  view: core\n",
    );
  });

  it("changes nothing when no edit is given or a value is set again as it is written", () => {
    const same = editYamlDocument(fileOf(FILE), []);
    expect(same.changed).toBe(false);
    expect(decode(same.bytes)).toBe(FILE);
    expect(editYamlDocument(fileOf("name: a\n"), [{ key: "name", value: "a" }]).changed).toBe(false);
  });

  it("refuses files that are not a block mapping, and edits that would change other values", () => {
    expect(errorOf(() => editYamlDocument({ text: "{ name: a }\n", bom: false }, [])).code).toBe(
      "file.faulty",
    );
    expect(errorOf(() => editYamlDocument({ text: "- a\n", bom: false }, [])).code).toBe("file.faulty");
    expect(errorOf(() => editYamlDocument({ text: "name: [a\n", bom: false }, [])).code).toBe("file.faulty");
    // An alias names the anchored value of the changed key: changing it would change the alias too,
    // or leave it unresolved.
    const aliased = "name: &n a\ndescription: *n\n";
    expect(errorOf(() => editYamlDocument(fileOf(aliased), [{ key: "name", value: "b" }])).code).toBe(
      "internal",
    );
    expect(
      errorOf(() => editYamlDocument(fileOf("view: &v core\nname: *v\n"), [{ key: "view", value: "core" }]))
        .code,
    ).toBe("internal");
  });
});
