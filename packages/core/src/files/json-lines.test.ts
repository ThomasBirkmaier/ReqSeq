// jsonLines (#319, SR-061 AK4): one compact JSON object and LF per item, the state fields first in
// the order of the catalog, then the keys of the item; batched into chunks of about one chunk length.
import { describe, expect, it } from "vitest";
import { jsonLines } from "./json-lines.js";

const SPEC = { items: "elements", fields: ["logreq-data", "commit", "dirty"] } as const;

const output = {
  "logreq-data": 2,
  commit: "0123456789abcdef0123456789abcdef01234567",
  dirty: false,
  workspace: "Weather station",
  generated: "2026-10-29T08:00:00Z",
  repositories: [{ name: "system", available: true }],
  incomplete: false,
  elements: [
    { id: "a", title: "Wind", relations: [] },
    { id: "b", title: "Rain ünd Schnee", properties: { x: [1, null] } },
    {},
  ],
};

const lines = (value: unknown, chunkLength?: number): string[] =>
  [...jsonLines(value, SPEC, chunkLength)].join("").split("\n");

describe("jsonLines (#319)", () => {
  it("[SR-061/AK4] gives one line per element: the state fields in catalog order, then the element", () => {
    const text = lines(output);
    expect(text.at(-1)).toBe("");
    const picked = { "logreq-data": 2, commit: output.commit, dirty: false };
    expect(text.slice(0, -1)).toEqual(output.elements.map((e) => JSON.stringify({ ...picked, ...e })));
    expect(text.slice(0, -1).map((line) => Object.keys(JSON.parse(line) as object).slice(0, 3))).toEqual([
      ["logreq-data", "commit", "dirty"],
      ["logreq-data", "commit", "dirty"],
      ["logreq-data", "commit", "dirty"],
    ]);
  });

  it("leaves out a field the output leaves out, and gives nothing for no items", () => {
    const { commit: _commit, ...withoutCommit } = output;
    expect(lines(withoutCommit)[0]).toBe(
      '{"logreq-data":2,"dirty":false,"id":"a","title":"Wind","relations":[]}',
    );
    expect([...jsonLines({ ...output, elements: [] }, SPEC)]).toEqual([]);
    expect([...jsonLines(output, { items: "elements", fields: [] })].join("").split("\n")[0]).toBe(
      '{"id":"a","title":"Wind","relations":[]}',
    );
  });

  it("cuts chunks only between lines, at about the chunk length", () => {
    const many = { ...output, elements: Array.from({ length: 50 }, (_, i) => ({ id: String(i) })) };
    const chunks = [...jsonLines(many, SPEC, 200)];
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.endsWith("\n")).toBe(true);
      // A chunk ends with the line that reaches the length: at most one line (here under 100) more.
      expect(chunk.length).toBeLessThan(200 + 100);
    }
    expect(chunks.join("")).toBe([...jsonLines(many, SPEC)].join(""));
  });

  it("refuses an output whose items are no array of objects", () => {
    expect(() => [...jsonLines({ elements: {} }, SPEC)]).toThrow(TypeError);
    expect(() => [...jsonLines(null, SPEC)]).toThrow(TypeError);
    expect(() => [...jsonLines({ elements: [1] }, SPEC)]).toThrow(TypeError);
    expect(() => [...jsonLines({ elements: [[]] }, SPEC)]).toThrow(TypeError);
  });
});
