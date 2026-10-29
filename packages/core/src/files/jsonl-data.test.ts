// What counts as a LogReq data file (#319, SR-062 AK1, review PS3): the signature at the start of the
// first line, valid UTF-8, and nothing else; read in pieces with the hash of the whole file.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { DATA_HEAD_BYTES, JsonlDataCheck, isJsonlDataFile, readJsonlFile } from "./jsonl-data.js";

const bytes = (text: string): Uint8Array => Buffer.from(text, "utf8");
const LINE = '{"logreq-data":2,"commit":"0123456789abcdef0123456789abcdef01234567","dirty":false,"id":"a"}\n';

describe("isJsonlDataFile (#319)", () => {
  it("takes a file whose first line starts with logreq-data 2 or later, whatever follows", () => {
    for (const text of [
      LINE,
      LINE + LINE,
      `${LINE}{"x": "Größe"}\n`,
      '{ "logreq-data" : 3 }\r\n',
      '{"logreq-data":2}',
      // Later lines are not scanned: a file cut in the middle stays LogReq's.
      `${LINE}{"logreq-data":2,"id":"b","title":"Grö`,
      `${LINE}not json at all\n`,
      "",
    ]) {
      expect([text, isJsonlDataFile(bytes(text))]).toEqual([text, true]);
    }
  });

  it("allows a UTF-8 sequence cut at the very end, but not a broken one before", () => {
    const cut = Buffer.concat([bytes(`${LINE}{"t":"`), Buffer.from([0xc3])]);
    expect(isJsonlDataFile(cut)).toBe(true);
    const broken = Buffer.concat([bytes(`${LINE}{"t":"`), Buffer.from([0xc3, 0x28]), bytes('"}\n')]);
    expect(isJsonlDataFile(broken)).toBe(false);
    expect(isJsonlDataFile(Buffer.concat([Buffer.from([0xff]), bytes(LINE)]))).toBe(false);
    // Pieces after a broken one are not decoded again.
    const check = new JsonlDataCheck();
    for (const piece of [bytes(LINE), Buffer.from([0xff]), bytes(LINE)]) {
      check.update(piece);
    }
    expect(check.finish().dataFile).toBe(false);
  });

  it("refuses any other first line", () => {
    for (const text of [
      '{"logreq-data":1}\n',
      '{"logreq-data":2.5}\n',
      '{"logreq-data":"2"}\n',
      '{"x":1,"logreq-data":2}\n',
      '["logreq-data",2]\n',
      "﻿" + LINE,
      `\n${LINE}`,
      '{"logreq-data":02}\n',
      '{"logreq-data":-2}\n',
      '{"logreq-data":2e1}\n',
      '{"logreq-data":2',
      "plain text\n",
      // The JSON form, as `data export --json` writes it.
      '{\n  "logreq-data": 2,\n',
    ]) {
      expect([text, isJsonlDataFile(bytes(text))]).toEqual([text, false]);
    }
  });

  it("takes a first line longer than one MiB by its signature, also when it comes in pieces (review of #331)", () => {
    const long = `{"logreq-data":2,"x":"${"a".repeat(DATA_HEAD_BYTES)}"}\n`;
    expect(isJsonlDataFile(bytes(long))).toBe(true);
    const check = new JsonlDataCheck();
    for (let at = 0; at < long.length; at += 4096) {
      check.update(bytes(long.slice(at, at + 4096)));
    }
    expect(check.finish().dataFile).toBe(true);
  });

  it("refuses a signature that does not lie within the first MiB", () => {
    const late = `{${" ".repeat(DATA_HEAD_BYTES)}"logreq-data":2}\n`;
    expect(isJsonlDataFile(bytes(late))).toBe(false);
  });

  it("finds the first line across pieces, with a character across an edge", () => {
    const text = Buffer.from(`{"logreq-data":2,"t":"Größe"}\n${LINE}`, "utf8");
    for (const size of [1, 3, 7]) {
      const check = new JsonlDataCheck();
      for (let at = 0; at < text.byteLength; at += size) {
        check.update(text.subarray(at, at + size));
      }
      expect([size, check.finish().dataFile]).toEqual([size, true]);
    }
  });

  it("reads a file in pieces with its size and hash, and finds the first line across pieces", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-jsonl-"));
    onTestFinished(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, "a.jsonl");
    // More than one piece of the reader, with a character across a piece edge.
    const head = `{"logreq-data":2,"x":"${"ü".repeat(300_000)}"}\n`;
    const text = head + `{"x":"${"ü".repeat(400_000)}"}\n` + LINE.repeat(1000);
    await fs.writeFile(file, text);
    const read = await readJsonlFile(file);
    const content = Buffer.from(text, "utf8");
    expect(read).toEqual({
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
      dataFile: true,
    });
    await fs.writeFile(file, `x${text}`);
    expect((await readJsonlFile(file)).dataFile).toBe(false);
    await expect(readJsonlFile(path.join(dir, "none.jsonl"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
