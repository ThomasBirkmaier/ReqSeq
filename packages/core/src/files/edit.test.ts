import { describe, expect, it } from "vitest";
import type { CommandError } from "../catalog.js";
import type { EditableFile, FileEditRequest, FrontmatterEdit } from "./edit.js";
import { editElementFile, zip } from "./edit.js";
import type { ParsedContent } from "./parse.js";
import { parseFileBytes } from "./parse.js";
import type { PropertyValue } from "./yaml-text.js";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

const fileOf = (text: string): ParsedContent => {
  const outcome = parseFileBytes("a.md", encode(text));
  if (outcome.kind !== "parsed") {
    throw new Error(`fixture does not parse: ${outcome.kind}`);
  }
  return outcome.content;
};

const edit = (text: string, request: FileEditRequest): string =>
  decode(editElementFile(fileOf(text), request).bytes);
const set = (key: string, value: PropertyValue): FrontmatterEdit => ({
  kind: "set",
  key,
  value,
});

const errorOf = (fn: () => unknown): CommandError => {
  try {
    fn();
  } catch (e) {
    return e as CommandError;
  }
  throw new Error("expected an error");
};

/** Lines of `before` that differ from `after`, found by the common start and end (as `git diff` shows them). */
const changedRegion = (
  before: string,
  after: string,
): { removed: string[]; added: string[]; from: number } => {
  const a = before.split("\n");
  const b = after.split("\n");
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) {
    p++;
  }
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) {
    s++;
  }
  return { removed: a.slice(p, a.length - s), added: b.slice(p, b.length - s), from: p + 1 };
};

const U1 = "878e339e-773f-4cd0-b414-825b7146fb54";
const U2 = "fe5fce30-7a0c-4c6e-9a51-0d2b8a1e6c11";
const U3 = "19fd3f5e-2b8c-4b0a-8f7e-3c1d2e4f5a6b";

// ADR-0004 example, hand-aligned trailing comments.
const TYPICAL = `---
id: 102ee39b-773f-4cd0-b414-825b7146fb54     # UUID v4, never changes (D-017)
type: system-requirement                      # type key (D-043)
status: draft                                 # status key (D-030)
title: Show wind speed in large digits        # property with meaning \`title\`
requirement-type: functional
acceptance-criteria:
  - Given ..., when ..., then ...
derives-from:                                 # relation kind key
  - { id: ${U1}, version: n1:7d865e959b2466f0, title: Wind speed visible at a glance }
  - { id: ${U2}, version: n1:e3b0c44298fc1c14, repository: subsystem-sensor }
customer-id: WS-0815                          # external ID is an ordinary property (D-017)
---
# Text

Body stays.
`;

// Hand-written: own key order, odd quoting and spacing, leading zeros, flow lists without spaces,
// long lines, a block scalar, comments everywhere, a sequence at indent 0.
const ODD = `---
# Written by hand.
title:    'Single quoted, with spacing'
id: 102ee39b-773f-4cd0-b414-825b7146fb54
legacy-number: 00815
tags: [x,y]
note: "double \\"quoted\\""   # trailing comment
long: ${"a very long plain value ".repeat(5).trim()}
derives-from:
# first parent
- {id: ${U1}, version: n1:7d865e959b2466f0, title: A title that makes this line much longer than eighty characters}
- { id: ${U2},   version: n1:e3b0c44298fc1c14 }   # second
text: |
  Keep this
    block scalar.
type: system-requirement

# closing comment
---
Body
`;

const FIXTURES = { TYPICAL, ODD };

describe("SR-102 AK1: only the lines of a changed property change", () => {
  it("[SR-102/AK1] changes only the title line and keeps its trailing comment", () => {
    const out = edit(TYPICAL, { edits: [set("title", "Show wind speed in digits")] });
    expect(out).toBe(
      TYPICAL.replace(
        "title: Show wind speed in large digits        #",
        "title: Show wind speed in digits        #",
      ),
    );
    expect(changedRegion(TYPICAL, out)).toMatchObject({
      removed: [expect.stringMatching(/^title:/)],
      added: [expect.stringMatching(/^title:/)],
    });
  });

  it("[SR-102/AK1] for every fixture and key, a new value changes only that key's lines", () => {
    for (const [name, text] of Object.entries(FIXTURES)) {
      const file = fileOf(text);
      const lines = text.split("\n");
      for (const key of Object.keys(file.data as object)) {
        for (const value of ["new value", 7, ["one", "two"], [{ id: U3, version: "n1:0000000000000000" }]]) {
          const out = edit(text, { edits: [set(key, value)] });
          const { removed, from } = changedRegion(text, out);
          // The changed lines all lie in the block of this key: from its line up to the next top-level key.
          const keyLine = lines.findIndex((l) => l.startsWith(`${key}:`)) + 1;
          const nextKey = lines.findIndex((l, i) => i >= keyLine && /^([a-z-]+:|---$)/.test(l)) + 1;
          expect(from, `${name} ${key}`).toBeGreaterThanOrEqual(keyLine);
          expect(from + removed.length, `${name} ${key}`).toBeLessThanOrEqual(nextKey);
          expect(fileOf(out).data, `${name} ${key}`).toEqual({ ...(file.data as object), [key]: value });
        }
      }
    }
  });

  it("[SR-102/AK1] setting the current value changes no byte", () => {
    for (const text of Object.values(FIXTURES)) {
      const file = fileOf(text);
      const edits = Object.entries(file.data as object).map(([key, value]) =>
        set(key, value as PropertyValue),
      );
      const result = editElementFile(file, { edits, body: file.body });
      expect(result.changed).toBe(false);
      expect(decode(result.bytes)).toBe(text);
    }
    // 00815 reads as the number 815: writing 815 keeps the file as it is.
    expect(edit(ODD, { edits: [set("legacy-number", 815)] })).toBe(ODD);
  });

  it("[SR-102/AK1] keeps leading zeros, flow lists, long lines and comments of untouched keys", () => {
    const out = edit(ODD, { edits: [set("id", "6adc7b13-3db0-4895-8087-1d4550912ce5")] });
    expect(out).toBe(
      ODD.replace("id: 102ee39b-773f-4cd0-b414-825b7146fb54", "id: 6adc7b13-3db0-4895-8087-1d4550912ce5"),
    );
  });

  it("[SR-102/AK1] confirming a hint changes only that relation line", () => {
    const out = edit(TYPICAL, {
      edits: [
        {
          kind: "replace-item",
          key: "derives-from",
          index: 0,
          value: { id: U1, version: "n1:1111111111111111", title: "Wind speed visible at a glance" },
        },
      ],
    });
    expect(changedRegion(TYPICAL, out)).toEqual({
      removed: [`  - { id: ${U1}, version: n1:7d865e959b2466f0, title: Wind speed visible at a glance }`],
      added: [`  - { id: ${U1}, version: n1:1111111111111111, title: Wind speed visible at a glance }`],
      from: 10,
    });
  });

  it("[SR-102/AK1] replaces one hand-written item and keeps the others byte for byte", () => {
    const out = edit(ODD, {
      edits: [
        {
          kind: "replace-item",
          key: "derives-from",
          index: 1,
          value: { id: U2, version: "n1:2222222222222222" },
        },
      ],
    });
    expect(changedRegion(ODD, out)).toEqual({
      removed: [`- { id: ${U2},   version: n1:e3b0c44298fc1c14 }   # second`],
      added: [`- { id: ${U2}, version: n1:2222222222222222 }   # second`],
      from: 12,
    });
  });

  it("[SR-102/AK1] adding a relation adds one line; two branches add different lines", () => {
    const add = (id: string): string =>
      edit(TYPICAL, {
        edits: [
          {
            kind: "append-item",
            key: "derives-from",
            value: { id, version: "n1:3333333333333333", title: "New" },
          },
        ],
      });
    const ours = changedRegion(TYPICAL, add(U3));
    expect(ours).toEqual({
      removed: [],
      added: [`  - { id: ${U3}, version: n1:3333333333333333, title: New }`],
      from: 12,
    });
    const theirs = changedRegion(TYPICAL, add("0a0b0c0d-1e2f-4a5b-8c6d-7e8f9a0b1c2d"));
    expect(theirs.added).toHaveLength(1);
    expect(theirs.added).not.toEqual(ours.added);
  });
});

describe("SR-102 AK2: a hand-written key order is kept", () => {
  it("[SR-102/AK2] keeps the own key order and appends new keys in metamodel order", () => {
    const out = edit(ODD, {
      edits: [
        set("title", "New"),
        set("zeta", "z"),
        set("status", "draft"),
        set("acceptance-criteria", ["A"]),
      ],
      keyOrder: ["id", "type", "status", "title", "acceptance-criteria"],
    });
    expect(Object.keys(fileOf(out).data as object)).toEqual([
      "title",
      "id",
      "legacy-number",
      "tags",
      "note",
      "long",
      "derives-from",
      "text",
      "type",
      "status",
      "acceptance-criteria",
      "zeta",
    ]);
    expect(out).toContain(
      "\n# closing comment\nstatus: draft\nacceptance-criteria:\n  - A\nzeta: z\n---\nBody\n",
    );
    expect(out).toContain("\ntitle:    New\n");
  });
});

describe("editElementFile: values", () => {
  it("writes one relation target as a flow mapping on the key line and replaces it", () => {
    const target = { id: U1, version: "n1:7d865e959b2466f0", title: "Wind" };
    const once = edit("---\nid: x\n---\n", { edits: [set("parent", target)] });
    expect(once).toBe(`---\nid: x\nparent: { id: ${U1}, version: n1:7d865e959b2466f0, title: Wind }\n---\n`);
    expect(edit(once, { edits: [set("parent", { ...target, version: "n1:0000000000000000" })] })).toBe(
      `---\nid: x\nparent: { id: ${U1}, version: n1:0000000000000000, title: Wind }\n---\n`,
    );
    expect(edit(once, { edits: [set("parent", target)] })).toBe(once);
  });

  it("turns a scalar into a list and a list into a scalar", () => {
    expect(edit("---\na: x # c\nb: 1\n---\n", { edits: [set("a", ["p", "q"])] })).toBe(
      "---\na:\n  - p\n  - q # c\nb: 1\n---\n",
    );
    expect(edit("---\na: # c\n  - p\n  - q\nb: 1\n---\n", { edits: [set("a", "x")] })).toBe(
      "---\na: x\nb: 1\n---\n",
    );
  });

  it("rewrites a flow sequence as a block sequence and an emptied list as []", () => {
    expect(
      edit("---\ntags: [x,w]\n---\n", { edits: [{ kind: "append-item", key: "tags", value: "z" }] }),
    ).toBe("---\ntags:\n  - x\n  - w\n  - z\n---\n");
    expect(edit("---\ntags: [x]\n---\n", { edits: [{ kind: "remove-item", key: "tags", index: 0 }] })).toBe(
      "---\ntags: []\n---\n",
    );
    expect(edit("---\nl:\n  - x\n# after\nn: 1\n---\n", { edits: [set("l", [])] })).toBe(
      "---\nl: []\n# after\nn: 1\n---\n",
    );
  });

  it("refuses to rewrite a flow sequence with nested values", () => {
    expect(() =>
      editElementFile(fileOf("---\nl: [[a], b]\n---\n"), {
        edits: [{ kind: "append-item", key: "l", value: "c" }],
      }),
    ).toThrow(expect.objectContaining({ code: "input.invalid" }));
    expect(() =>
      editElementFile(fileOf("---\nl: [{ a: [1] }]\n---\n"), {
        edits: [{ kind: "append-item", key: "l", value: "c" }],
      }),
    ).toThrow(expect.objectContaining({ code: "input.invalid" }));
    expect(
      edit("---\nl: [{ a: 1 }]\n---\n", { edits: [{ kind: "append-item", key: "l", value: "c" }] }),
    ).toBe("---\nl:\n  - { a: 1 }\n  - c\n---\n");
  });

  it("fills empty values and keeps their comments", () => {
    expect(edit("---\na:\nb: # note\nc: 1\n---\n", { edits: [set("a", "x"), set("b", ["v"])] })).toBe(
      "---\na: x\nb:\n  - v # note\nc: 1\n---\n",
    );
    expect(edit("---\na:\n---\n", { edits: [{ kind: "append-item", key: "a", value: "x" }] })).toBe(
      "---\na:\n  - x\n---\n",
    );
  });

  it("drops tags and anchors of a replaced value", () => {
    expect(edit("---\na: !custom   x\nb: &n 1\n---\n", { edits: [set("a", "v"), set("b", 2)] })).toBe(
      "---\na: v\nb: 2\n---\n",
    );
  });

  it("writes a cleared value as null and quotes keys and values where needed", () => {
    expect(edit("---\na: x\n---\n", { edits: [set("a", null), set("null", "00815")] })).toBe(
      '---\na: null\n"null": "00815"\n---\n',
    );
  });

  it("replaces a block scalar up to its end", () => {
    expect(edit("---\ntext: |+\n  keep\n\nnext: 1\n---\n", { edits: [set("text", "short")] })).toBe(
      "---\ntext: short\n\nnext: 1\n---\n",
    );
  });

  it("keeps common items at start and end when a whole list is set", () => {
    const text = "---\nl:\n  - a   # first\n  # about b\n  - b\n  - c\n  - d # last\nn: 1\n---\n";
    expect(edit(text, { edits: [set("l", ["a", "B", "c", "d"])] })).toBe(
      "---\nl:\n  - a   # first\n  # about b\n  - B\n  - c\n  - d # last\nn: 1\n---\n",
    );
    expect(edit(text, { edits: [set("l", ["a", "d"])] })).toBe(
      "---\nl:\n  - a   # first\n  # about b\n  - d # last\nn: 1\n---\n",
    );
    expect(edit(text, { edits: [set("l", ["x", "v"])] })).toBe("---\nl:\n  - x\n  - v\nn: 1\n---\n");
  });

  it("handles items that are block mappings, empty or block scalars", () => {
    const text = "---\nl:\n- id: a\n  v: 1\n-\n- |\n  text\nn: 1\n---\n";
    expect(edit(text, { edits: [{ kind: "replace-item", key: "l", index: 1, value: "x" }] })).toBe(
      "---\nl:\n- id: a\n  v: 1\n- x\n- |\n  text\nn: 1\n---\n",
    );
    expect(edit(text, { edits: [{ kind: "append-item", key: "l", value: { id: "b" } }] })).toBe(
      "---\nl:\n- id: a\n  v: 1\n-\n- |\n  text\n- { id: b }\nn: 1\n---\n",
    );
    expect(edit(text, { edits: [{ kind: "remove-item", key: "l", index: 0 }] })).toBe(
      "---\nl:\n-\n- |\n  text\nn: 1\n---\n",
    );
  });
});

describe("editElementFile: list edits", () => {
  const text = "---\nl:\n  - a\n  - b\n  - c\n---\n";

  it("applies several item edits in order", () => {
    expect(
      edit(text, {
        edits: [
          { kind: "remove-item", key: "l", index: 0 },
          { kind: "replace-item", key: "l", index: 1, value: "C" },
          { kind: "append-item", key: "l", value: "d" },
        ],
      }),
    ).toBe("---\nl:\n  - b\n  - C\n  - d\n---\n");
  });

  it("changes nothing when an item gets its own value or an edit is undone", () => {
    const same = editElementFile(fileOf(text), {
      edits: [{ kind: "replace-item", key: "l", index: 1, value: "b" }],
    });
    expect(same.changed).toBe(false);
    const undone = editElementFile(fileOf(text), {
      edits: [
        { kind: "append-item", key: "l", value: "x" },
        { kind: "remove-item", key: "l", index: 3 },
      ],
    });
    expect(undone.changed).toBe(false);
  });

  it("creates a missing list", () => {
    expect(edit(text, { edits: [{ kind: "append-item", key: "m", value: "x" }] })).toBe(
      `${text.slice(0, -4)}m:\n  - x\n---\n`,
    );
  });

  it("refuses item edits that do not fit", () => {
    const bad: FrontmatterEdit[] = [
      { kind: "replace-item", key: "l", index: 3, value: "x" },
      { kind: "remove-item", key: "l", index: -1 },
      { kind: "remove-item", key: "l", index: 0.5 },
      { kind: "replace-item", key: "missing", index: 0, value: "x" },
    ];
    for (const e of bad) {
      expect(() => editElementFile(fileOf(text), { edits: [e] })).toThrow(
        expect.objectContaining({ code: "input.invalid" }),
      );
    }
    expect(
      errorOf(() =>
        editElementFile(fileOf("---\ns: x\n---\n"), {
          edits: [{ kind: "append-item", key: "s", value: "y" }],
        }),
      ),
    ).toMatchObject({ code: "input.invalid", message: "Cannot change an item of s: it is not a list" });
  });
});

describe("editElementFile: keys", () => {
  it("removes a key with its value lines and keeps comments around it", () => {
    const text = "---\na: 1\n# about l\nl:\n  - x # c\n  # end of l\nb: 2 # b\nc:\n---\n";
    expect(edit(text, { edits: [{ kind: "remove", key: "l" }] })).toBe(
      "---\na: 1\n# about l\n  # end of l\nb: 2 # b\nc:\n---\n",
    );
    expect(edit(text, { edits: [{ kind: "remove", key: "b" }] })).toBe(
      "---\na: 1\n# about l\nl:\n  - x # c\n  # end of l\nc:\n---\n",
    );
    expect(edit(text, { edits: [{ kind: "remove", key: "c" }] })).toBe(
      "---\na: 1\n# about l\nl:\n  - x # c\n  # end of l\nb: 2 # b\n---\n",
    );
    expect(edit(text, { edits: [{ kind: "remove", key: "missing" }] })).toBe(text);
  });

  it("removes and sets a key again in its old place", () => {
    expect(edit("---\na: 1\nb: 2\n---\n", { edits: [{ kind: "remove", key: "a" }, set("a", 3)] })).toBe(
      "---\na: 3\nb: 2\n---\n",
    );
  });

  it("removes every key", () => {
    expect(edit("---\na: 1\n---\nText\n", { edits: [{ kind: "remove", key: "a" }] })).toBe(
      "---\n---\nText\n",
    );
  });

  it("works with explicit keys", () => {
    expect(edit("---\n? a\n: 1\nb: 2\n---\n", { edits: [set("a", 3)] })).toBe("---\n? a\n: 3\nb: 2\n---\n");
    expect(edit("---\n? a\n: 1\nb: 2\n---\n", { edits: [{ kind: "remove", key: "a" }] })).toBe(
      "---\nb: 2\n---\n",
    );
    expect(() => editElementFile(fileOf("---\n? a\nb: 2\n---\n"), { edits: [set("a", 3)] })).toThrow(
      expect.objectContaining({ code: "input.invalid" }),
    );
  });

  it("leaves keys that are not strings alone", () => {
    expect(edit("---\n1: one\na: x\n---\n", { edits: [set("a", "v")] })).toBe("---\n1: one\na: v\n---\n");
    expect(
      errorOf(() => editElementFile(fileOf("---\n1: one\n---\n"), { edits: [set("1", "two")] })),
    ).toMatchObject({
      code: "input.invalid",
    });
  });

  it("appends new keys at the indent of an indented mapping", () => {
    expect(edit("---\n  a: 1\n---\n", { edits: [set("l", ["x"])] })).toBe(
      "---\n  a: 1\n  l:\n    - x\n---\n",
    );
  });

  it("writes into empty and comment-only frontmatter", () => {
    expect(edit("---\n---\n", { edits: [set("id", "a"), set("type", "t")] })).toBe(
      "---\nid: a\ntype: t\n---\n",
    );
    expect(edit("---\n# only a comment\n---\n", { edits: [set("id", "a")] })).toBe(
      "---\n# only a comment\nid: a\n---\n",
    );
  });
});

describe("editElementFile: file form", () => {
  it("keeps CRLF and the byte order mark and writes new lines with CRLF", () => {
    const text = `\ufeff${TYPICAL.replaceAll("\n", "\r\n")}`;
    const result = editElementFile(fileOf(text), {
      edits: [
        set("title", "T"),
        { kind: "append-item", key: "derives-from", value: { id: U3, version: "n1:3333333333333333" } },
        set("x", ["a"]),
      ],
    });
    const out = decode(result.bytes);
    expect(out.startsWith("\ufeff---\r\n")).toBe(true);
    expect(out.replaceAll("\r\n", "")).not.toContain("\n");
    expect(out).toContain("\r\ntitle: T        # property");
    expect(out).toContain(`\r\n  - { id: ${U3}, version: n1:3333333333333333 }\r\ncustomer-id:`);
    expect(out).toContain("\r\nx:\r\n  - a\r\n---\r\n# Text\r\n");
  });

  it("replaces the text only when it differs", () => {
    const file = fileOf(TYPICAL);
    expect(editElementFile(file, { body: file.body }).changed).toBe(false);
    expect(editElementFile(file, {}).changed).toBe(false);
    const result = editElementFile(file, { body: "New text\n" });
    expect(result.changed).toBe(true);
    expect(decode(result.bytes)).toBe(TYPICAL.replace("# Text\n\nBody stays.\n", "New text\n"));
  });

  it("keeps a file that ends at the closing line, and adds a line break once it gets a text", () => {
    const text = "---\r\nid: a\r\n---";
    expect(edit(text, { edits: [set("id", "b")] })).toBe("---\r\nid: b\r\n---");
    expect(edit(text, { body: "Text" })).toBe("---\r\nid: a\r\n---\r\nText");
  });

  it("replaces the text of a file with empty frontmatter", () => {
    expect(edit("---\n---\nOld\n", { body: "New\n" })).toBe("---\n---\nNew\n");
  });

  it("refuses a text with a whole Git conflict", () => {
    expect(() => editElementFile(fileOf(TYPICAL), { body: "<<<<<<< a\nx\n=======\ny\n>>>>>>> b\n" })).toThrow(
      expect.objectContaining({ code: "input.invalid" }),
    );
  });
});

describe("editElementFile: refusals", () => {
  it("refuses frontmatter that is not a block mapping", () => {
    for (const text of ["---\n{ id: a, type: t }\n---\n", "---\njust text\n---\n", "---\n- a\n---\n"]) {
      expect(() => editElementFile(fileOf(text), { edits: [set("id", "b")] })).toThrow(
        expect.objectContaining({ code: "file.faulty" }),
      );
    }
  });

  it("refuses frontmatter text without a final line break", () => {
    const file = { ...fileOf("---\nid: a\n---\n"), frontmatter: "id: a" };
    expect(() => editElementFile(file, { edits: [set("id", "b")] })).toThrow(
      expect.objectContaining({ code: "input.invalid" }),
    );
  });

  it("refuses an edit that would break an alias", () => {
    expect(
      errorOf(() => editElementFile(fileOf("---\na: &x 1\nb: *x\n---\n"), { edits: [set("a", 2)] })),
    ).toMatchObject({
      code: "internal",
      message: "Not written: the edit would make the frontmatter unreadable",
    });
  });

  it("refuses an edit that would change another value through an alias", () => {
    const error = errorOf(() =>
      editElementFile(fileOf("---\nl: &x\n  - a\nm: *x\n---\n"), {
        edits: [{ kind: "append-item", key: "l", value: "b" }],
      }),
    );
    expect(error).toMatchObject({ code: "internal" });
    expect(error.message).toMatch(/other values too/);
  });

  it("refuses numbers a file cannot hold", () => {
    expect(() => editElementFile(fileOf("---\na: 1\n---\n"), { edits: [set("a", Number.NaN)] })).toThrow(
      expect.objectContaining({ code: "input.invalid" }),
    );
  });
});

describe("zip", () => {
  it("pairs items and stops at the shorter list", () => {
    expect(zip([1, 2, 3], ["a", "b"])).toEqual([
      [1, "a"],
      [2, "b"],
    ]);
    expect(zip([1], ["a", "b"])).toEqual([[1, "a"]]);
  });
});

describe("editElementFile: review round 1", () => {
  it("replace-item keeps the dash spacing and a trailing comment", () => {
    const text = "---\nl:\n  -   { id: a, version: v1 } # reviewed\n  - b # keep\n---\n";
    const out = edit(text, {
      edits: [{ kind: "replace-item", key: "l", index: 0, value: { id: "a", version: "v2" } }],
    });
    expect(out).toBe("---\nl:\n  -   { id: a, version: v2 } # reviewed\n  - b # keep\n---\n");
    // A replaced new item (appended before) has nothing to keep.
    expect(
      edit(text, {
        edits: [
          { kind: "append-item", key: "l", value: "c" },
          { kind: "replace-item", key: "l", index: 2, value: "d" },
          { kind: "replace-item", key: "l", index: 1, value: "e" },
          { kind: "replace-item", key: "l", index: 1, value: "f" },
        ],
      }),
    ).toBe("---\nl:\n  -   { id: a, version: v1 } # reviewed\n  - f # keep\n  - d\n---\n");
  });

  it("replace-item on an empty item rewrites the line", () => {
    expect(
      edit("---\nl:\n  -\n  - b\n---\n", {
        edits: [{ kind: "replace-item", key: "l", index: 0, value: "a" }],
      }),
    ).toBe("---\nl:\n  - a\n  - b\n---\n");
  });

  it("converts a new text sent with LF to the line ending of the file", () => {
    const file = fileOf("---\r\nid: a\r\n---\r\n# T\r\n\r\nText\r\n");
    expect(editElementFile(file, { body: "# T\n\nText\n" }).changed).toBe(false);
    const out = editElementFile(file, { body: "# T\n\nNew\n" });
    expect(out.changed).toBe(true);
    expect(decode(out.bytes)).toBe("---\r\nid: a\r\n---\r\n# T\r\n\r\nNew\r\n");
    const lf = fileOf("---\nid: a\n---\nA\nB\n");
    expect(decode(editElementFile(lf, { body: "A\r\nC\r\n" }).bytes)).toBe("---\nid: a\n---\nA\nC\n");
  });

  it("writes -0 as 0", () => {
    const file = fileOf("---\na: 1\n---\n");
    expect(
      decode(
        editElementFile(file, {
          edits: [set("a", -0), set("b", [-0]), { kind: "append-item", key: "c", value: { num: -0 } }],
        }).bytes,
      ),
    ).toBe("---\na: 0\nb:\n  - 0\nc:\n  - { num: 0 }\n---\n");
  });

  it("new lines use the line ending of the first frontmatter line", () => {
    const mixed: EditableFile = {
      frontmatter: "id: a\r\n",
      body: "",
      eol: "\n",
      closingEol: "\n",
      bom: false,
    };
    expect(decode(editElementFile(mixed, { edits: [set("x", "z")] }).bytes)).toBe(
      "---\nid: a\r\nx: z\r\n---\n",
    );
    const lfInCrlf: EditableFile = { ...mixed, frontmatter: "id: a\n", eol: "\r\n" };
    expect(decode(editElementFile(lfInCrlf, { edits: [set("x", "z")] }).bytes)).toBe(
      "---\r\nid: a\nx: z\n---\n",
    );
    const empty: EditableFile = { ...mixed, frontmatter: "", eol: "\r\n" };
    expect(decode(editElementFile(empty, { edits: [set("x", "z")] }).bytes)).toBe("---\r\nx: z\r\n---\n");
  });

  it("refuses frontmatter text that is not valid YAML", () => {
    const bad: EditableFile = { frontmatter: "a: [\n", body: "", eol: "\n", closingEol: "\n", bom: false };
    expect(errorOf(() => editElementFile(bad, { edits: [set("a", 1)] }))).toMatchObject({
      code: "file.faulty",
    });
  });
});

describe("set-scalar: one scalar replaced in place (SR-027 AK1, SR-102 AK1)", () => {
  const scalar = (key: string, path: readonly (string | number)[], value: string): FrontmatterEdit => ({
    kind: "set-scalar",
    key,
    path,
    value,
  });
  const OLD = "n1:0000000000000000";
  const NEW = "n1:1111111111111111";

  it("replaces only the text of the scalar, in its own quoting, and keeps every other byte", () => {
    const text = [
      "---",
      "a:   # by hand",
      `  - { id: ${U1}, version: ${OLD}, title: 'One' }   # first`,
      `  - id: ${U2}`,
      `    version: '${OLD}'  # old`,
      `    title: "Two"`,
      `  - {id: ${U3}, version: "${OLD}"}`,
      `b: { id: ${U1}, version: ${OLD} }`,
      `c: ${OLD}`,
      "---",
      "Text",
      "",
    ].join("\n");
    const edits = [
      scalar("a", [0, "version"], NEW),
      scalar("a", [1, "version"], NEW),
      scalar("a", [2, "version"], NEW),
      scalar("b", ["version"], NEW),
      scalar("c", [], NEW),
    ];
    expect(edit(text, { edits })).toBe(text.replaceAll(OLD, NEW));
  });

  it("quotes a value that cannot stay plain or single-quoted", () => {
    const text = `---\na: { v: x }\nb: 'y'\nc: "z"\n---\n`;
    const edits = [scalar("a", ["v"], "x, y"), scalar("b", [], "it's\ttab"), scalar("c", [], "it's")];
    expect(edit(text, { edits })).toBe(`---\na: { v: "x, y" }\nb: "it's\\ttab"\nc: "it's"\n---\n`);
    expect(edit(text, { edits: [scalar("b", [], "it's")] })).toBe(
      `---\na: { v: x }\nb: 'it''s'\nc: "z"\n---\n`,
    );
  });

  it("changes nothing when the scalar holds the value already", () => {
    const text = `---\na: { v: ${OLD} }\n---\n`;
    const result = editElementFile(fileOf(text), { edits: [scalar("a", ["v"], OLD)] });
    expect([decode(result.bytes), result.changed]).toEqual([text, false]);
  });

  it("refuses a path that names no text on one line, and a key that is edited as a whole too", () => {
    const text = `---\na: { v: 1, w: [x] }\nb: |\n  block\nc: plain\n---\n`;
    for (const bad of [
      scalar("a", ["v"], NEW),
      scalar("a", ["w"], NEW),
      scalar("a", ["nope"], NEW),
      scalar("b", [], NEW),
      scalar("c", ["v"], NEW),
      scalar("d", [], NEW),
    ]) {
      expect(errorOf(() => edit(text, { edits: [bad] }))).toMatchObject({
        code: "input.invalid",
        message: expect.stringContaining("it is no text on one line") as unknown,
      });
    }
    expect(errorOf(() => edit(text, { edits: [set("c", "x"), scalar("c", [], NEW)] }))).toMatchObject({
      code: "input.invalid",
      message: "Cannot change c: a scalar in it and the whole key in one write",
    });
  });

  it("with ifPlain leaves a value it cannot change in place, also an anchored one, and changes the others in one pass", () => {
    const text = `---\na: { v: 1, w: &w x, y: *w, z: old }\nb: |\n  block\nc: plain\n---\n`;
    const plain = (key: string, path: readonly (string | number)[]): FrontmatterEdit => ({
      kind: "set-scalar",
      key,
      path,
      value: "new",
      ifPlain: true,
    });
    const edits = [
      plain("a", ["v"]),
      plain("a", ["w"]),
      plain("a", ["y"]),
      plain("a", ["nope"]),
      plain("a", ["z"]),
      plain("b", []),
      plain("c", ["v"]),
      plain("d", []),
      plain("c", []),
    ];
    expect(edit(text, { edits })).toBe(text.replace("z: old", "z: new").replace("c: plain", "c: new"));
  });
});
