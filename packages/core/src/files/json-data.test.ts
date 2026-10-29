// jsonDataKind (#277, review B1, N3, S9; code review S2): parsed whole up to the bound, above it the frame of a
// LogReq data file. The unit tests take a small bound; the 64 MiB constant is tested once.
import { describe, expect, it } from "vitest";
import { JSON_FULL_PARSE_BYTES, jsonDataKind } from "./json-data.js";

const MIB = 1024 * 1024;
const bytes = (text: string): Buffer => Buffer.from(text, "utf8");
/** A framed file of `size` bytes: the frame around a string of `fill` (one byte each). */
const framed = (size: number, fill = "a"): Buffer => {
  const head = '{"logreq-data":1,"x":"';
  const tail = '"}\n';
  return bytes(`${head}${fill.repeat(size - head.length - tail.length)}${tail}`);
};
/** `buffer` with `insert` written at `offset`. */
const withBytes = (buffer: Buffer, offset: number, insert: readonly number[]): Buffer => {
  const copy = Buffer.from(buffer);
  copy.set(insert, offset);
  return copy;
};
/** 😀 in UTF-8. */
const EMOJI = [0xf0, 0x9f, 0x98, 0x80];

describe("jsonDataKind: whether a JSON file is a LogReq data file", () => {
  it("parses a file up to the bound whole: data, other JSON or faulty", () => {
    expect(jsonDataKind(bytes('{"logreq-data":1}\n'))).toBe("data");
    expect(jsonDataKind(bytes('{"logreq-data":1,"x":[1]}'), 100)).toBe("data");
    for (const text of ['{"logreq-data":2}', "[1]", "null", "1", '"logreq-data"', "﻿{}"]) {
      expect([text, jsonDataKind(bytes(text))]).toEqual([text, "json"]);
    }
    for (const text of ["not json", "{", '{"logreq-data":1,']) {
      expect([text, jsonDataKind(bytes(text))]).toEqual([text, "faulty"]);
    }
    expect(jsonDataKind(Buffer.from([0x7b, 0xff, 0x7d]))).toBe("faulty");
  });

  it("checks only the frame above the bound: start, end and the UTF-8 of the first and last MiB", () => {
    const large = framed(3 * MIB);
    // Not JSON at all between the frame, yet framed: the assumption of #277.
    const notJson = withBytes(large, MIB + 10, [0x22, 0x7b]);
    expect(jsonDataKind(large, 1000)).toBe("data");
    expect(jsonDataKind(notJson, 1000)).toBe("data");
    expect(jsonDataKind(notJson, 4 * MIB)).toBe("faulty");
    expect(jsonDataKind(withBytes(large, 0, [0x5b]), 1000)).toBe("unchecked");
    expect(jsonDataKind(withBytes(large, large.length - 1, [0x78]), 1000)).toBe("unchecked");
    expect(jsonDataKind(withBytes(large, large.length - 2, [0x5d]), 1000)).toBe("unchecked");
    expect(jsonDataKind(bytes('{"logreq-data":1}\n'), 10)).toBe("unchecked");
    // Invalid UTF-8 in the first and in the last MiB; in the middle it is not read.
    expect(jsonDataKind(withBytes(large, 100, [0xff]), 1000)).toBe("unchecked");
    expect(jsonDataKind(withBytes(large, large.length - 100, [0xc3]), 1000)).toBe("unchecked");
    expect(jsonDataKind(withBytes(large, MIB + MIB / 2, [0xff]), 1000)).toBe("data");
    // A file shorter than two edges is read once from each end.
    expect(jsonDataKind(framed(100), 50)).toBe("data");
    expect(jsonDataKind(withBytes(framed(100), 50, [0xff]), 50)).toBe("unchecked");
  });

  it("accepts a byte order mark and JSON whitespace in the frame, as the parse below the bound does (code review S2)", () => {
    const body = (start: string, end: string): Buffer => bytes(`${start}"x":"${"a".repeat(2 * MIB)}"${end}`);
    const layouts: readonly (readonly [string, string, string])[] = [
      ["CRLF (a checkout with autocrlf)", '{"logreq-data":1,\r\n', "}\r\n"],
      ["indent 2 (data export --json)", '{\n  "logreq-data": 1,\n  ', "\n}\n"],
      ["byte order mark", '\ufeff{"logreq-data":1,', "}\n"],
      ["spaces and tabs between every token, no final line break", ' \t{ "logreq-data" \t:\r\n 1 , ', " }"],
    ];
    for (const [name, start, end] of layouts) {
      const file = body(start, end);
      expect([name, jsonDataKind(file, 1000)]).toEqual([name, "data"]);
      expect([name, jsonDataKind(file, 4 * MIB)]).toEqual([name, "data"]);
    }
    for (const [name, start] of [
      ["another value", '{"logreq-data":10,'],
      ["no comma", '{"logreq-data":1 "x":1,'],
      ["two byte order marks", '\ufeff\ufeff{"logreq-data":1,'],
      ["another key first", '{"x":1,"logreq-data":1,'],
    ] as const) {
      expect([name, jsonDataKind(body(start, "}\n"), 1000)]).toEqual([name, "unchecked"]);
    }
    expect(jsonDataKind(body('{"logreq-data":1,', "}\n,"), 1000)).toBe("unchecked");
  });

  it("cuts the edges at a code-point boundary: a character across a MiB edge is valid (review N3)", () => {
    const large = framed(3 * MIB);
    for (const shift of [1, 2, 3]) {
      const head = withBytes(large, MIB - shift, EMOJI);
      const tail = withBytes(large, large.length - MIB - shift, EMOJI);
      expect([shift, jsonDataKind(head, 1000), jsonDataKind(tail, 1000)]).toEqual([shift, "data", "data"]);
    }
    // Four continuation bytes at the edge are no character: the cut stops after three, so the
    // decoder sees the faulty byte.
    expect(jsonDataKind(withBytes(large, large.length - MIB, [0x80, 0x80, 0x80, 0x80]), 1000)).toBe(
      "unchecked",
    );
  });

  it("parses a file of exactly 64 MiB whole and checks the frame of one byte more", () => {
    expect(JSON_FULL_PARSE_BYTES).toBe(64 * MIB);
    const atBound = withBytes(framed(JSON_FULL_PARSE_BYTES), MIB * 2, [0x22, 0x7b]);
    expect(jsonDataKind(atBound)).toBe("faulty");
    const above = withBytes(framed(JSON_FULL_PARSE_BYTES + 1), MIB * 2, [0x22, 0x7b]);
    expect(jsonDataKind(above)).toBe("data");
  });
});
