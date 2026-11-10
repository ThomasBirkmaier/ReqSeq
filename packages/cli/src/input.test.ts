import path from "node:path";
import { Readable } from "node:stream";
import { CommandError, getCommandRuntime } from "@reqseq/core";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InputField } from "./fields.js";
import { inputFields } from "./fields.js";
import { buildInput, readInputOption } from "./input.js";
import type { Invocation } from "./program.js";

const noStdin = Readable.from([]);

const utf16 = (text: string, bigEndian: boolean): Buffer => {
  const le = Buffer.from(`\uFEFF${text}`, "utf16le");
  return bigEndian ? Buffer.from(le).swap16() : le;
};

let fixture: FixtureWorkspace;
beforeEach(async () => {
  fixture = await createFixtureWorkspace({
    files: {
      "input.json": '{"ref":"SR-46fb54","tags":["a"]}',
      "bom.json": '\uFEFF{"a":1}',
      "utf16le.json": utf16('{"title":"Größe 測試"}', false),
      "utf16be.json": utf16('{"title":"Größe 測試"}', true),
      "odd.json": Buffer.from([0xfe, 0xff, 0x00, 0x7b, 0x00]),
      "odd-le.json": Buffer.from([0xff, 0xfe, 0x7b, 0x00, 0x7d]),
      // One byte of a UTF-16 byte order mark only, first or second: UTF-8 (0xff and 0xfe are no
      // UTF-8, so U+FFFD).
      "half-le.md": Buffer.from([0xff, 0x41, 0x42, 0x43]),
      "half-be.md": Buffer.from([0xfe, 0x41, 0x42, 0x43]),
      "half-le-2.md": Buffer.from([0x41, 0xfe, 0x42, 0x43]),
      "half-be-2.md": Buffer.from([0x41, 0xff, 0x42, 0x43]),
      "sub/list.json": "[1]",
      "text.md": "Erster Absatz mit „Zitat“.\n\nZweiter Absatz.\n",
      "cond.json": '{"status":["draft"]}',
    },
  });
});
afterEach(async () => {
  await fixture.cleanup();
});

const rejection = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

describe("readInputOption", () => {
  it("reads inline JSON", async () => {
    expect(await readInputOption('{"a":[1,2]}', fixture.root, noStdin)).toEqual({ a: [1, 2] });
  });

  it("reads a file relative to the current folder, without a byte order mark", async () => {
    expect(await readInputOption("@input.json", fixture.root, noStdin)).toEqual({
      ref: "SR-46fb54",
      tags: ["a"],
    });
    expect(await readInputOption("@bom.json", fixture.root, noStdin)).toEqual({ a: 1 });
    expect(await readInputOption(`@${fixture.path("input.json")}`, "/elsewhere", noStdin)).toMatchObject({
      ref: "SR-46fb54",
    });
  });

  it("reads UTF-16 files with a byte order mark (Windows PowerShell)", async () => {
    expect(await readInputOption("@utf16le.json", fixture.root, noStdin)).toEqual({ title: "Größe 測試" });
    expect(await readInputOption("@utf16be.json", fixture.root, noStdin)).toEqual({ title: "Größe 測試" });
    const odd = await rejection(readInputOption("@odd.json", fixture.root, noStdin));
    expect(odd.message).toBe("Input from odd.json is not valid UTF-16");
    const oddLe = await rejection(readInputOption("@odd-le.json", fixture.root, noStdin));
    expect(oddLe.message).toBe("Input from odd-le.json is not valid UTF-16");
    const stdin = Readable.from([utf16('{"a":1}', false)]);
    expect(await readInputOption("-", fixture.root, stdin)).toEqual({ a: 1 });
  });

  it("reads standard input as UTF-8, in string or byte chunks", async () => {
    const bytes = Buffer.from('{"title":"Größe 測試"}', "utf8");
    // Split inside "ö": chunks are joined before they are decoded.
    const stdin = Readable.from([bytes.subarray(0, 13), bytes.subarray(13)]);
    expect(await readInputOption("-", fixture.root, stdin)).toEqual({ title: "Größe 測試" });
    expect(await readInputOption("-", fixture.root, Readable.from(['{"a":', "1}"]))).toEqual({ a: 1 });
  });

  it("refuses a missing file, invalid JSON and JSON that is not an object", async () => {
    const missing = await rejection(readInputOption("@nothing.json", fixture.root, noStdin));
    expect(missing.toJSON()).toEqual({
      code: "input.invalid",
      message: "Cannot read the input file nothing.json",
      details: { file: "nothing.json" },
    });
    const invalid = await rejection(readInputOption("{nope", fixture.root, noStdin));
    expect(invalid.toJSON()).toEqual({
      code: "input.invalid",
      message:
        "Input from --input is not valid JSON (if the shell removed the quotes, as PowerShell and cmd.exe do, use --input @file or --input -)",
    });
    const badStdin = await rejection(readInputOption("-", fixture.root, Readable.from(["{"])));
    expect(badStdin.message).toBe("Input from standard input is not valid JSON");
    const list = await rejection(readInputOption("@sub/list.json", fixture.root, noStdin));
    expect(list.message).toBe("Input from sub/list.json must be a JSON object");
    const nil = await rejection(readInputOption("-", fixture.root, Readable.from(["null"])));
    expect(nil.message).toBe("Input from standard input must be a JSON object");
    const number = await rejection(readInputOption("3", fixture.root, noStdin));
    expect(number.code).toBe("input.invalid");
  });
});

const field = (
  name: string,
  kind: InputField["kind"],
  options: { array?: boolean; localPath?: boolean; entries?: boolean; textFile?: boolean } = {},
): InputField => ({
  name,
  flag: name,
  kind,
  array: options.array ?? false,
  required: false,
  use: "flag",
  description: undefined,
  choices: undefined,
  defaultValue: undefined,
  localPath: options.localPath ?? false,
  nullable: false,
  entries: options.entries ?? false,
  textFile: options.textFile ?? false,
  parts: [],
});

const invocation = (parts: Partial<Invocation>): Invocation => ({
  entry: {
    name: "test.echo",
    title: "Echo",
    summary: "Echo (test only).",
    effect: "read",
    stage: 1,
    implements: ["SR-080"],
    arguments: [],
    input: {},
    output: { type: "object" },
  },
  fields: [],
  positionals: [],
  extraArguments: [],
  flags: [],
  json: false,
  yaml: false,
  jsonl: false,
  workspace: undefined,
  input: undefined,
  ...parts,
});

describe("buildInput", () => {
  it("converts flag values by the field kind and leaves values that do not fit", async () => {
    const input = await buildInput(
      invocation({
        positionals: [
          { field: field("ref", "string"), value: "SR-46fb54" },
          { field: field("missing", "string"), value: undefined },
        ],
        flags: [
          { field: field("count", "number"), value: "12" },
          { field: field("ratio", "number"), value: "-1.5e3" },
          { field: field("bad", "number"), value: "12abc" },
          { field: field("on", "boolean"), value: true },
          { field: field("off", "boolean"), value: false },
          { field: field("text", "string"), value: "007" },
          { field: field("sizes", "number", { array: true }), value: ["1", "x"] },
          { field: field("checks", "boolean", { array: true }), value: ["true", "false", "yes"] },
          { field: field("absent", "string"), value: undefined },
        ],
      }),
      fixture.root,
      noStdin,
    );
    expect(input).toEqual({
      ref: "SR-46fb54",
      count: 12,
      ratio: -1500,
      bad: "12abc",
      on: true,
      off: false,
      text: "007",
      sizes: [1, "x"],
      checks: [true, false, "yes"],
    });
  });

  it("lets flags override --input", async () => {
    const input = await buildInput(
      invocation({
        input: '{"title":"kept","count":1}',
        flags: [{ field: field("count", "number"), value: "2" }],
      }),
      fixture.root,
      noStdin,
    );
    expect(input).toEqual({ title: "kept", count: 2 });
  });

  it("fills the positional fields that --input does not give, in order", async () => {
    const positionals = (...values: (string | undefined)[]): Invocation["positionals"] =>
      ["source", "kind", "target"].map((name, i) => ({ field: field(name, "string"), value: values[i] }));
    const input = await buildInput(
      invocation({ input: '{"kind":"derives-from"}', positionals: positionals("SR-111111", "SR-222222") }),
      fixture.root,
      noStdin,
    );
    expect(input).toEqual({ source: "SR-111111", kind: "derives-from", target: "SR-222222" });
    const tooMany = await rejection(
      buildInput(
        invocation({ input: '{"kind":"k","target":"t"}', positionals: positionals("a", "b") }),
        fixture.root,
        noStdin,
      ),
    );
    expect(tooMany.toJSON()).toEqual({
      code: "input.invalid",
      message:
        "Unexpected argument b: --input or a flag already gives kind, target; the form is reqseq test echo <source> <kind> <target> [options] (reqseq test echo --help)",
      details: { argument: "b", usage: "reqseq test echo <source> <kind> <target> [options]" },
    });
  });

  it("names the form of the call for too many arguments, without guessing which value is meant (#449)", async () => {
    const commandOf = (name: string): Pick<Invocation, "entry" | "fields" | "positionals"> => {
      const entry = getCommandRuntime().contracts.entry(name);
      if (entry === undefined) {
        throw new Error(name);
      }
      const fields = inputFields(entry);
      const positionals = fields
        .filter((f) => f.use === "positional")
        .map((f) => ({ field: f, value: undefined }));
      return { entry, fields, positionals };
    };
    const refused = async (
      name: string,
      values: string[],
      parts: Partial<Invocation> = {},
    ): Promise<unknown> => {
      const command = commandOf(name);
      const count = command.positionals.length;
      const positionals = command.positionals.map((p, i) => ({ ...p, value: values[i] }));
      const error = await rejection(
        buildInput(
          invocation({ ...command, positionals, extraArguments: values.slice(count), ...parts }),
          fixture.root,
          noStdin,
        ),
      );
      return error.toJSON();
    };
    expect(await refused("element.setStatus", ["SR-143", "approved"])).toEqual({
      code: "input.invalid",
      message:
        "Unexpected argument approved: element set-status takes <status>; the form is reqseq element set-status <status> --refs <refs>... [options] (reqseq element set-status --help)",
      details: {
        argument: "approved",
        usage: "reqseq element set-status <status> --refs <refs>... [options]",
      },
    });
    // No guess which value is meant for which field: the form only, with the element flags of the catalog.
    expect(await refused("element.setStatus", ["approved", "SR-143"])).toMatchObject({
      details: { argument: "SR-143", usage: "reqseq element set-status <status> --refs <refs>... [options]" },
    });
    expect(await refused("hint.list", ["SR-143"])).toMatchObject({
      message:
        "Unexpected argument SR-143: hint list takes no arguments; the form is reqseq hint list [--package <package>] [--variant <variant>] [--ref <ref>] [options] (reqseq hint list --help)",
    });
    expect(await refused("evidence.record", ["SR-1", "verification", "passed", "test"])).toMatchObject({
      details: {
        argument: "test",
        usage: "reqseq evidence record <ref> <kind> <result> [--variant <variant>] [options]",
      },
    });
    const flagged = commandOf("element.setStatus").fields.find((f) => f.name === "refs");
    const given = await refused("element.setStatus", ["approved", "x"], {
      input: '{"status":"approved"}',
      flags: flagged === undefined ? [] : [{ field: flagged, value: ["SR-143"] }],
    });
    expect(JSON.stringify(given)).toContain(
      "Unexpected argument approved: --input or a flag already gives status;",
    );
  });

  it("fills only the positional fields no flag gives, so `<type> --title x` and `--type t x` both work", async () => {
    const type = field("type", "string");
    const title = field("title", "string");
    const both = (values: readonly (string | undefined)[], flags: Invocation["flags"]): Invocation =>
      invocation({
        positionals: [
          { field: type, value: values[0] },
          { field: title, value: values[1] },
        ],
        flags,
      });
    expect(
      await buildInput(both(["need", undefined], [{ field: title, value: "Wind" }]), fixture.root, noStdin),
    ).toEqual({ type: "need", title: "Wind" });
    expect(
      await buildInput(both(["Wind", undefined], [{ field: type, value: "need" }]), fixture.root, noStdin),
    ).toEqual({ type: "need", title: "Wind" });
    // A flag that is not given leaves its field to the arguments.
    expect(
      await buildInput(both(["need", "Wind"], [{ field: title, value: undefined }]), fixture.root, noStdin),
    ).toEqual({ type: "need", title: "Wind" });
  });

  it("makes local paths absolute against the current folder, from every source", async () => {
    const file = field("file", "string", { localPath: true });
    const files = field("files", "string", { array: true, localPath: true });
    const empty = field("empty", "string", { localPath: true });
    const odd = field("odd", "string", { localPath: true });
    const absent = field("absent", "string", { localPath: true });
    const input = await buildInput(
      invocation({
        fields: [file, files, empty, odd, absent, field("name", "string")],
        input: JSON.stringify({ files: ["a.xml", 3], empty: "", odd: 7, name: "plain" }),
        positionals: [{ field: file, value: "../results.xml" }],
      }),
      fixture.root,
      noStdin,
    );
    expect(input).toEqual({
      file: path.resolve(fixture.root, "../results.xml"),
      files: [path.join(fixture.root, "a.xml"), 3],
      empty: "",
      odd: 7,
      name: "plain",
    });
  });

  it("gives an entries flag as key=value, the value as JSON when it parses, key by key over --input (#171)", async () => {
    const set = field("set", "complex", { entries: true });
    const input = await buildInput(
      invocation({
        input: '{"set":{"kept":1,"over":"old"}}',
        flags: [
          {
            field: set,
            value: [
              "over=new",
              "list=[1,2]",
              "on=true",
              "id=D-064",
              "eq=a=b",
              "empty=",
              'quoted="12"',
              "n=12",
            ],
          },
        ],
      }),
      fixture.root,
      noStdin,
    );
    expect(input).toEqual({
      set: {
        kept: 1,
        over: "new",
        list: [1, 2],
        on: true,
        id: "D-064",
        eq: "a=b",
        empty: "",
        quoted: "12",
        n: 12,
      },
    });
    // A --input value that is no object is replaced, so core sees only the flag's entries.
    expect(
      await buildInput(
        invocation({ input: '{"set":3}', flags: [{ field: set, value: ["a=b"] }] }),
        fixture.root,
        noStdin,
      ),
    ).toEqual({ set: { a: "b" } });
    for (const item of ["novalue", "=x"]) {
      const error = await rejection(
        buildInput(invocation({ flags: [{ field: set, value: [item] }] }), fixture.root, noStdin),
      );
      expect(error.toJSON()).toEqual({
        code: "input.invalid",
        message: `--set expects key=value, not ${item}`,
        details: { argument: item },
      });
    }
  });

  it("reads a text flag from @file or - like --input, and takes any other value as it is (#171)", async () => {
    const text = field("text", "string", { textFile: true });
    const read = (value: string, stdin = noStdin, input?: string): Promise<Record<string, unknown>> =>
      buildInput(invocation({ input, flags: [{ field: text, value }] }), fixture.root, stdin);
    expect(await read("@text.md")).toEqual({ text: "Erster Absatz mit „Zitat“.\n\nZweiter Absatz.\n" });
    expect(await read("-", Readable.from([utf16("Größe", false)]))).toEqual({ text: "Größe" });
    expect(await read("inline @ text")).toEqual({ text: "inline @ text" });
    // A file whose first two bytes hold only one byte of a UTF-16 byte order mark is UTF-8.
    expect(await read("@half-le.md")).toEqual({ text: "\uFFFDABC" });
    expect(await read("@half-be.md")).toEqual({ text: "\uFFFDABC" });
    expect(await read("@half-le-2.md")).toEqual({ text: "A\uFFFDBC" });
    expect(await read("@half-be-2.md")).toEqual({ text: "A\uFFFDBC" });
    expect((await rejection(read("@nothing.md"))).message).toBe("Cannot read the input file nothing.md");
    const twice = await rejection(read("-", Readable.from(['{"a":1}']), "-"));
    expect(twice.toJSON()).toEqual({
      code: "input.invalid",
      message: "--text - cannot read standard input a second time",
    });
    // Without textFile, @ is part of the value.
    expect(
      await buildInput(
        invocation({ flags: [{ field: field("title", "string"), value: "@file" }] }),
        fixture.root,
        noStdin,
      ),
    ).toEqual({ title: "@file" });
  });
});

describe("buildInput with part flags (#149, #173)", () => {
  /** The flags of a catalog command, given by flag name. */
  const withFlags = (
    name: string,
    given: Record<string, unknown>,
    input?: string,
    stdin = noStdin,
  ): Promise<Record<string, unknown>> => {
    const entry = getCommandRuntime().contracts.entry(name);
    if (entry === undefined) {
      throw new Error(name);
    }
    const fields = inputFields(entry);
    const flags = fields.flatMap((field) =>
      field.parts.map((part) => ({ field, part, value: given[part.flag] })),
    );
    return buildInput(invocation({ entry, fields, flags, input }), fixture.root, stdin);
  };

  it("sets each property of the selection, a list flag the whole list, over --input", async () => {
    expect(
      await withFlags(
        "element.list",
        { ids: ["SR-1", "SR-2"], filter: "open", package: "P-1", baseline: "r1", view: "core" },
        '{"selection":{"ids":["X"],"filter":"old","where":{"invalid":true}},"limit":5}',
      ),
    ).toEqual({
      selection: {
        ids: ["SR-1", "SR-2"],
        filter: "open",
        package: "P-1",
        baseline: "r1",
        view: "core",
        where: { invalid: true },
      },
      limit: 5,
    });
  });

  it("replaces the condition with --where and adds the key flags with all", async () => {
    expect(await withFlags("element.list", { "where-type": ["SR", "N"] })).toEqual({
      selection: { where: { type: ["SR", "N"] } },
    });
    expect(
      await withFlags(
        "element.list",
        { where: '{"invalid":true}', "where-type": ["SR"], "where-status": ["draft"] },
        '{"selection":{"where":{"status":["x"]}}}',
      ),
    ).toEqual({
      selection: { where: { all: [{ invalid: true }, { type: ["SR"] }, { status: ["draft"] }] } },
    });
    expect(
      await withFlags(
        "element.list",
        { "where-status": ["draft"] },
        '{"selection":{"where":{"invalid":true}}}',
      ),
    ).toEqual({ selection: { where: { all: [{ invalid: true }, { status: ["draft"] }] } } });
    // A condition at the top level (filter.save) works the same.
    expect(await withFlags("filter.save", { where: "@cond.json", "where-type": ["SR"] })).toEqual({
      where: { all: [{ status: ["draft"] }, { type: ["SR"] }] },
    });
    expect(
      await withFlags("filter.save", { where: "-" }, undefined, Readable.from(['{"invalid":false}'])),
    ).toEqual({ where: { invalid: false } });
    // An `all` alone takes the key conditions into its list; a value that is no object stays for core.
    expect(
      await withFlags(
        "element.list",
        { "where-type": ["sr"] },
        '{"selection":{"where":{"all":[{"invalid":true}]}}}',
      ),
    ).toEqual({ selection: { where: { all: [{ invalid: true }, { type: ["sr"] }] } } });
    expect(await withFlags("element.list", { ids: ["a"] }, '{"selection":"x"}')).toEqual({
      selection: "x",
    });
    const invalid = await rejection(withFlags("element.list", { where: "{nope" }));
    expect(invalid.message).toBe(
      "--where is not valid JSON (if the shell removed the quotes, as PowerShell and cmd.exe do, use --where @file or --where -)",
    );
  });

  it("names a required selection in the form of the call by its part flags", async () => {
    const entry = getCommandRuntime().contracts.entry("element.bulkUpdate");
    if (entry === undefined) {
      throw new Error("element.bulkUpdate");
    }
    const fields = inputFields(entry);
    const positionals = fields.filter((f) => f.use === "positional").map((f) => ({ field: f, value: "v" }));
    const error = await rejection(
      buildInput(
        invocation({ entry, fields, positionals, extraArguments: ["extra"] }),
        fixture.root,
        noStdin,
      ),
    );
    expect(error.details?.["usage"]).toContain(
      "{--ids|--filter|--where|--where-type|--where-status|--package|--baseline|--view}",
    );
  });

  it("reads --sort as <by>[:asc|desc] and replaces the list of --input", async () => {
    expect(
      await withFlags(
        "element.list",
        { sort: ["status:desc", "title", "a:b:asc", "x:ascending"] },
        '{"sort":[{"by":"id"}]}',
      ),
    ).toEqual({
      sort: [
        { by: "status", order: "desc" },
        { by: "title" },
        { by: "a:b", order: "asc" },
        { by: "x:ascending" },
      ],
    });
  });
});
