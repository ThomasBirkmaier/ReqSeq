import { describe, expect, it } from "vitest";
import type { ResultLine } from "./result.js";
import { linesOf, resultText } from "./result-copy.js";

describe("resultText", () => {
  it("writes one line per shown line, indented, keys with a colon, element rows with their status", () => {
    const lines: ResultLine[] = [
      { kind: "text", depth: 0, label: "workspace", text: "" },
      { kind: "text", depth: 1, label: "name", text: "Weather station" },
      { kind: "text", depth: 1, label: "", text: "plain" },
      { kind: "element", depth: 1, label: "SR-1", text: "Wind", status: "draft" },
      { kind: "problem", depth: 2, label: "warning", text: "too few" },
    ];
    expect(resultText(lines)).toBe(
      "workspace:\n  name: Weather station\n  plain\n  SR-1 Wind  draft\n    warning too few",
    );
  });

  it("lays out a chain as its view does", () => {
    expect(linesOf({ command: "trace.chain", output: undefined })).toEqual([]);
    expect(linesOf({ command: "tool.info", output: { a: "b" } })).toEqual([
      { kind: "text", depth: 0, label: "a", text: "b" },
    ]);
  });
});
