import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CATALOG_HEADER, loadCatalog, schemasDir } from "./load.mjs";

let dir;
afterEach(() => {
  if (dir) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  dir = undefined;
});

/** A commands folder with the given files: an object is written as JSON, a string as it is. */
const folder = (files) => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-catalog-"));
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
};
const header = (order, more = {}) => ({ "reqseq-catalog": 1, description: "Test.", ...more, order });
const problems = (files) => {
  try {
    loadCatalog(folder(files), "cmds");
  } catch (e) {
    return e.message.split("\n").slice(1);
  }
  throw new Error("no error");
};

describe("loadCatalog (#528)", () => {
  it("assembles the catalog in the order of the header, with every header key except order", () => {
    const commands = folder({
      [CATALOG_HEADER]: header(["b.one", "a.two"], { extra: true }),
      "a.two.json": { name: "a.two" },
      "b.one.json": '\r\n{ "name": "b.one" }\r\n',
      "catalog.meta.schema.json": {},
      "notes.txt": "not a command",
    });
    // A folder is no command file, whatever its name.
    fs.mkdirSync(path.join(commands, "folder.json"));
    const catalog = loadCatalog(commands);
    expect(catalog).toEqual({
      $schema: "./catalog.meta.schema.json",
      "reqseq-catalog": 1,
      description: "Test.",
      extra: true,
      commands: [{ name: "b.one" }, { name: "a.two" }],
    });
    expect(Object.keys(catalog)).toEqual(["$schema", "reqseq-catalog", "description", "extra", "commands"]);
  });

  it("assembles the catalog of this repository", () => {
    const { order } = JSON.parse(fs.readFileSync(path.join(schemasDir, "commands", CATALOG_HEADER), "utf8"));
    expect(loadCatalog().commands.map((c) => c.name)).toEqual(order);
  });

  it("fails without a header", () => {
    expect(() => loadCatalog(folder({ "a.one.json": { name: "a.one" } }), "cmds")).toThrow(
      "cmds/catalog.header.json is missing",
    );
  });

  it("names the file of a JSON syntax error", () => {
    expect(problems({ [CATALOG_HEADER]: "{" })).toEqual([
      expect.stringMatching(/^cmds\/catalog\.header\.json: /),
      'cmds/catalog.header.json: "order" must be a list of command names',
    ]);
    expect(problems({ [CATALOG_HEADER]: header(["a.one"]), "a.one.json": "{ name" })).toEqual([
      expect.stringMatching(/^cmds\/a\.one\.json: /),
    ]);
  });

  it("requires order to be a list of names", () => {
    expect(problems({ [CATALOG_HEADER]: header("a.one"), "a.one.json": { name: "a.one" } })).toEqual([
      'cmds/catalog.header.json: "order" must be a list of command names',
      'cmds/a.one.json is not listed in cmds/catalog.header.json; add its name to "order", at the end of its group',
    ]);
    expect(problems({ [CATALOG_HEADER]: header(["a.one", 2]), "a.one.json": { name: "a.one" } })).toEqual([
      'cmds/catalog.header.json: "order" must be a list of command names',
    ]);
  });

  it("reports every problem of the folder at once", () => {
    expect(
      problems({
        [CATALOG_HEADER]: header(["a.one", "a.one", "A.One", "a.two", "a.three", "x.schema", "a.four"]),
        "a.one.json": { name: "a.one" },
        "A.Two.json": { name: "a.two" },
        "a.three.json": { name: "a.Three" },
        "a.four.json": "null",
        "a.five.json": { name: "a.five" },
        "catalog.json": { commands: [] },
      }),
    ).toEqual([
      "cmds/catalog.header.json: a.one is listed twice",
      "cmds/catalog.header.json: A.One and a.one differ only in case",
      "cmds/catalog.header.json: a.two is listed, but cmds/a.two.json does not exist",
      'cmds/a.three.json: "name" must be "a.three", as the file name',
      'cmds/catalog.header.json: x.schema: a command name must not end in ".schema"',
      'cmds/a.four.json: "name" must be "a.four", as the file name',
      'cmds/A.Two.json is not listed in cmds/catalog.header.json; add its name to "order", at the end of its group',
      'cmds/a.five.json is not listed in cmds/catalog.header.json; add its name to "order", at the end of its group',
      "cmds/catalog.json is no longer read; move the entries you changed into cmds/<name>.json and list new names in cmds/catalog.header.json (#528)",
    ]);
  });
});
