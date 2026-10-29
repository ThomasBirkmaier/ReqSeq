import path from "node:path";
import { Readable } from "node:stream";
import { CommandError } from "@logreq/core";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InputField } from "./fields.js";
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
      "sub/list.json": "[1]",
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
  options: { array?: boolean; localPath?: boolean } = {},
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
      message: "Unexpected argument b: --input or a flag already gives kind, target",
      details: { argument: "b" },
    });
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
});
