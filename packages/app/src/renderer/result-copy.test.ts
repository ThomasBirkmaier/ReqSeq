import { describe, expect, it } from "vitest";
import { NO_ROW } from "./buffers.js";
import type { ResultLine } from "./result.js";
import { keptCursor, linesOf, outputJson } from "./result-copy.js";

describe("outputJson", () => {
  it("writes the output as the command line does with --json: two spaces, a line break, null for none", () => {
    expect(outputJson({ answer: "Done", ids: [1, 2] })).toBe(
      '{\n  "answer": "Done",\n  "ids": [\n    1,\n    2\n  ]\n}\n',
    );
    expect(outputJson(undefined)).toBe("null\n");
  });
});

describe("linesOf", () => {
  it("lays out a chain as its view does", () => {
    expect(linesOf({ command: "trace.chain", output: undefined })).toEqual([]);
    expect(linesOf({ command: "tool.info", output: { a: "b" } })).toEqual([
      { kind: "text", depth: 0, label: "a", text: "b", field: "a" },
    ]);
  });

  it("shows the details while the buffer has them on (SR-223 AK2)", () => {
    const fields = [{ path: "id", title: "Element", technical: true as const }];
    const output = { id: "6adc6d8e-8c79-41b2-aed5-e21f745581ec" };
    expect(linesOf({ command: "tool.info", output }, fields)).toEqual([]);
    expect(linesOf({ command: "tool.info", output, details: true }, fields)).toEqual([
      { kind: "text", depth: 0, label: "Element", text: output.id, field: "id", detail: true },
    ]);
  });
});

describe("keptCursor", () => {
  const line = (label: string, extra: Partial<ResultLine> = {}): ResultLine => ({
    kind: "text",
    depth: 0,
    label,
    text: "x",
    ...extra,
  });

  it("finds the same occurrence of the same line, whatever its kind of a problem or detail mark", () => {
    const before = [line("a"), line("b"), line("b")];
    const after = [line("a"), line("c", { detail: true }), line("b"), line("b", { status: "kind" })];
    expect(keptCursor(before, after, 2)).toBe(3);
    expect(keptCursor(before, after, 0)).toBe(0);
    expect(keptCursor(after, before, 1)).toBe(NO_ROW);
    expect(keptCursor(before, after, NO_ROW)).toBe(NO_ROW);
  });
});
