// jsonChunks and jsonByteLength (#277): the joined chunks are exactly JSON.stringify's text, for
// indent 0 and 2, on command outputs of the fixtures and on seeded random values; the pieces stay
// near the chunk length on any shape (review B3); toJSON gets the key at walked levels (N1).
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it } from "vitest";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { JSON_CHUNK_LENGTH, jsonByteLength, jsonChunks } from "./json-text.js";

const joined = (value: unknown, indent: 0 | 2, chunkLength?: number): string =>
  [...jsonChunks(value, chunkLength === undefined ? { indent } : { indent, chunkLength })].join("");

/** No lone surrogate: a chunk edge never splits a pair. */
const wellFormed = (text: string): boolean =>
  !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

const native = (value: unknown, indent: 0 | 2): string | undefined =>
  indent === 0 ? JSON.stringify(value) : JSON.stringify(value, null, 2);

/** mulberry32: the same values on every run. */
const randomOf = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const CHARACTERS = [
  "a",
  "Z",
  " ",
  '"',
  "\\",
  "/",
  "\n",
  "\t",
  "\u0000",
  "\u001f",
  "\u007f",
  "ä",
  "€",
  " ",
  "😀",
  "𝄞",
  "\ud800",
  "\udfff",
];
const NUMBERS = [
  0,
  -0,
  1,
  -1,
  1.5,
  1e21,
  1e-7,
  -1e-7,
  2 ** 53,
  Number.MAX_VALUE,
  Number.NaN,
  Infinity,
  -Infinity,
];

/** A random JSON-ish value with the cases JSON.stringify treats specially. */
const randomValue = (random: () => number, depth: number): unknown => {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const text = (): string =>
    Array.from({ length: Math.floor(random() * 12) }, () => pick(CHARACTERS)).join("");
  const kind = Math.floor(random() * (depth > 0 ? 14 : 9));
  switch (kind) {
    case 0:
      return text();
    case 1:
      return pick(NUMBERS);
    case 2:
      return random() < 0.5;
    case 3:
      return null;
    case 4:
      return undefined;
    case 5:
      return pick([() => 1, Symbol("s")]);
    case 6:
      return new Date(Date.UTC(2026, 9, 29, 7, Math.floor(random() * 60)));
    case 7:
      return pick([new Number(2), new String("w"), new Boolean(false)]);
    case 8:
      return pick([[], {}]);
    case 9:
    case 10:
      return Array.from({ length: Math.floor(random() * 8) }, () => randomValue(random, depth - 1));
    case 11: {
      const inner = randomValue(random, depth - 1);
      return { toJSON: (key: string) => ({ key, inner }) };
    }
    default:
      return Object.fromEntries(
        Array.from({ length: Math.floor(random() * 8) }, () => [text(), randomValue(random, depth - 1)]),
      );
  }
};

describe("jsonChunks: the text of JSON.stringify in pieces (#277)", () => {
  it("joins to JSON.stringify for indent 0 and 2 on seeded random values and every chunk length", () => {
    const random = randomOf(697);
    for (let run = 0; run < 400; run += 1) {
      const value = randomValue(random, 5);
      for (const indent of [0, 2] as const) {
        const expected = native(value, indent) ?? "";
        for (const chunkLength of [1, 7, 64, 4096, undefined]) {
          expect(joined(value, indent, chunkLength)).toBe(expected);
        }
      }
    }
  });

  it("joins to JSON.stringify on command outputs of the fixtures", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-061/export", git: ["system", "sensor"] });
    const workspace = new Workspace(fixture.path("system"));
    try {
      for (const [command, input] of [
        ["data.export", {}],
        ["element.list", {}],
        ["workspace.check", {}],
        ["trace.matrix", {}],
        ["evidence.status", {}],
        ["metamodel.get", {}],
      ] as const) {
        const output = await invoke(command, input, { workspace });
        for (const indent of [0, 2] as const) {
          for (const chunkLength of [16, 512]) {
            expect([command, joined(output, indent, chunkLength)]).toEqual([command, native(output, indent)]);
          }
        }
      }
    } finally {
      await workspace.close();
      await fixture.cleanup();
    }
  });

  it("follows JSON.stringify's rules for the top-level value and for edge values", () => {
    for (const value of [undefined, () => 1, Symbol("top")]) {
      expect([...jsonChunks(value, { indent: 2 })]).toEqual([]);
    }
    for (const value of [
      null,
      "x",
      -0,
      1e21,
      Number.NaN,
      new Date(0),
      new Number(3),
      new String("s"),
      new Boolean(true),
      [undefined, () => 1, Symbol("s")],
      { a: undefined, b: () => 1, c: Symbol("c") },
      { a: [], b: {}, c: [{}], d: { e: [] } },
      // eslint-disable-next-line no-sparse-arrays -- a hole is written as null, like undefined
      [1, , 3],
      { toJSON: () => ({ toJSON: () => "not called", a: 1 }) },
      { toJSON: () => undefined },
    ]) {
      for (const indent of [0, 2] as const) {
        for (const chunkLength of [1, JSON_CHUNK_LENGTH]) {
          expect(joined(value, indent, chunkLength)).toBe(native(value, indent) ?? "");
        }
      }
    }
  });

  it("throws JSON.stringify's TypeError for a BigInt and a circular structure", () => {
    expect(() => [...jsonChunks({ a: [1n] }, { indent: 0, chunkLength: 1 })]).toThrow(TypeError);
    expect(() => [...jsonChunks({ a: [1n] }, { indent: 0 })]).toThrow(TypeError);
    const loop: Record<string, unknown> = { a: [1, 2, 3] };
    (loop["a"] as unknown[]).push({ back: loop });
    expect(() => [...jsonChunks(loop, { indent: 2, chunkLength: 1 })]).toThrow(TypeError);
    expect(() => [...jsonChunks(loop, { indent: 2 })]).toThrow(TypeError);
    const own: Record<string, unknown> = { a: 1 };
    own["toJSON"] = () => own;
    own["self"] = own;
    expect(() => JSON.stringify(own)).toThrow(TypeError);
    for (const chunkLength of [1, JSON_CHUNK_LENGTH]) {
      expect(() => [...jsonChunks(own, { indent: 0, chunkLength })]).toThrow(TypeError);
    }
  });

  it("calls toJSON with the key at the levels it walks (review N1)", () => {
    const keys: string[] = [];
    const item = (n: number): unknown => ({
      toJSON: (key: string) => {
        keys.push(key);
        return { n, key };
      },
    });
    const value = { list: [item(1), item(2)], one: item(3) };
    expect(joined(value, 2, 1)).toBe(JSON.stringify(value, null, 2));
    expect(keys).toEqual(["0", "1", "one", "0", "1", "one"]);
    const top = { toJSON: (key: string) => ({ key }) };
    expect(joined(top, 0, 1)).toBe('{"key":""}');
  });

  it("streams any shape: the MCP message and nested arrays in pieces near the chunk length (review B3)", () => {
    const elements = Array.from({ length: 2000 }, (_, i) => ({
      id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
      title: `Element ${String(i)} 😀`,
      verification: [{ view: "core", status: "open", missingChildren: ["a", "b", "c"] }],
    }));
    const message = {
      jsonrpc: "2.0",
      id: 7,
      result: { content: [{ type: "text", text: "..." }], structuredContent: { elements } },
    };
    const nested = { a: { b: { c: [[elements], { d: elements }] } } };
    const chunkLength = 4096;
    const largestElement = Math.max(...elements.map((e) => JSON.stringify(e, null, 2).length));
    for (const value of [message, nested, elements]) {
      for (const indent of [0, 2] as const) {
        const chunks = [...jsonChunks(value, { indent, chunkLength })];
        expect(chunks.join("")).toBe(native(value, indent));
        expect(chunks.length).toBeGreaterThan(40);
        // A chunk is cut once it reaches the length: at most one more piece (a native subtree of
        // at most one chunk, re-indented, or one element) and the key before it.
        const largest = Math.max(...chunks.map((c) => c.length));
        expect(largest).toBeLessThan(chunkLength + 2 * Math.max(largestElement, chunkLength));
        expect(chunks.every(wellFormed)).toBe(true);
      }
    }
  });

  it("measures indented native pieces with their padding: deep subtrees stay within one chunk", () => {
    // About 1 KB compact, at depth 7: re-indented it is several times that.
    const leaf = { list: Array.from({ length: 40 }, (_, i) => ({ n: i, tags: ["a", "b"] })) };
    let deep: unknown = Array.from({ length: 30 }, () => leaf);
    for (let level = 0; level < 7; level += 1) {
      deep = { level, items: [deep] };
    }
    for (const chunkLength of [2000, 20_000]) {
      const chunks = [...jsonChunks(deep, { indent: 2, chunkLength })];
      expect(chunks.join("")).toBe(JSON.stringify(deep, null, 2));
      // A chunk is at most the length before the last cut, one key and one native piece of one chunk.
      expect(Math.max(...chunks.map((c) => c.length))).toBeLessThan(2 * chunkLength + 20);
    }
  });

  it("never splits a surrogate pair at a chunk edge", () => {
    const value = Array.from({ length: 300 }, (_, i) => ["😀".repeat(i % 7), "𝄞", i]);
    for (const chunkLength of [1, 2, 3, 5]) {
      const chunks = [...jsonChunks(value, { indent: 0, chunkLength })];
      expect(chunks.join("")).toBe(JSON.stringify(value));
      expect(chunks.every(wellFormed)).toBe(true);
    }
  });
});

describe("jsonByteLength: UTF-8 bytes of JSON.stringify, counted (#277)", () => {
  it("equals Buffer.byteLength of JSON.stringify on seeded random values", () => {
    const random = randomOf(36);
    for (let run = 0; run < 400; run += 1) {
      const value = randomValue(random, 5);
      expect(jsonByteLength(value)).toBe(Buffer.byteLength(native(value, 0) ?? ""));
    }
    expect(jsonByteLength(undefined)).toBe(0);
    expect(jsonByteLength({ a: [undefined, 1], b: undefined, c: "ä" })).toBe(
      Buffer.byteLength('{"a":[null,1],"c":"ä"}'),
    );
  });

  it("stops early above atMost, reading only the start of a large value", () => {
    let read = 0;
    const counted = {
      toJSON: () => {
        read += 1;
        return 1;
      },
    };
    const items = Array.from({ length: 10_000 }, () => counted);
    const size = jsonByteLength({ items, more: { items } }, 100);
    expect(size).toBeGreaterThan(100);
    expect(read).toBeLessThan(60);
    expect(jsonByteLength(items, 10 ** 9)).toBe(Buffer.byteLength(JSON.stringify(items)));
    expect(jsonByteLength({ items }, 100)).toBeGreaterThan(100);
  });

  it("throws JSON.stringify's TypeError for a BigInt and a circular structure", () => {
    expect(() => jsonByteLength([1n])).toThrow(TypeError);
    const loop: unknown[] = [];
    loop.push({ loop });
    expect(() => jsonByteLength(loop)).toThrow(TypeError);
  });
});
