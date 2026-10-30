// The text and the file name of a new baseline file (text.ts, ADR-0018): the layout the line scanner
// reads, the same data through the scanner and through YAML, and portable file names.
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { BaselineFile } from "../generated/types.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import { scanBaseline } from "./scan.js";
import { baselineStem, baselineText } from "./text.js";

const ID = "61061061-0000-4000-8000-0000000000";
const COMMIT = "a".repeat(40);

describe("baselineText", () => {
  it("writes the layout of ADR-0018, which the scanner and YAML read as the same valid data", () => {
    const data: BaselineFile = {
      "reqseq-baseline": 1,
      name: "Release 1: Größe, {x}",
      date: "2026-11-02T13:00:00Z",
      selection: {
        ids: [`${ID}b1`, { id: `${ID}e1`, repository: "sensor" }],
        where: { all: [{ property: "requirement-type", op: "in", value: ["functional", "quality"] }] },
        package: { id: `${ID}d1`, title: "Display, new" },
        view: { id: `${ID}c1`, title: "Coast" },
      },
      repositories: [
        { name: "system", commit: COMMIT },
        { name: "sensor", commit: "b".repeat(40) },
      ],
      elements: [
        { id: `${ID}b1`, version: "n1:697a2ad17ed49170" },
        { id: `${ID}e1`, version: "n1:31d60ac7c791e279", repository: "sensor" },
      ],
    };
    const text = baselineText(data);
    expect(text).toBe(
      [
        "reqseq-baseline: 1",
        'name: "Release 1: Größe, {x}"',
        "date: 2026-11-02T13:00:00Z",
        "selection:",
        "  ids:",
        `    - ${ID}b1`,
        `    - { id: ${ID}e1, repository: sensor }`,
        "  where:",
        "    all:",
        "      - property: requirement-type",
        "        op: in",
        "        value: [ functional, quality ]",
        `  package: { id: ${ID}d1, title: "Display, new" }`,
        `  view: { id: ${ID}c1, title: Coast }`,
        "repositories:",
        `  - { name: system, commit: ${COMMIT} }`,
        `  - { name: sensor, commit: ${"b".repeat(40)} }`,
        "elements:",
        `  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }`,
        `  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: sensor }`,
        "",
      ].join("\n"),
    );
    expect(scanBaseline(text)).toEqual(data);
    expect(parse(text)).toEqual(data);
    expect(fileSchemaValidator("baseline.schema.json")(data)).toBe(true);
  });

  it("writes an empty element list, `view: core`, and quotes names YAML would read as no string", () => {
    const data: BaselineFile = {
      "reqseq-baseline": 1,
      name: "true",
      date: "2026-11-02T13:00:00Z",
      selection: { view: "core" },
      repositories: [{ name: "123", commit: COMMIT }],
      elements: [],
    };
    const text = baselineText(data);
    expect(text).toBe(
      [
        "reqseq-baseline: 1",
        'name: "true"',
        "date: 2026-11-02T13:00:00Z",
        "selection:",
        "  view: core",
        "repositories:",
        `  - { name: "123", commit: ${COMMIT} }`,
        "elements: []",
        "",
      ].join("\n"),
    );
    expect(parse(text)).toEqual(data);
    const quoted = baselineText({
      ...data,
      elements: [{ id: `${ID}e1`, version: "n1:31d60ac7c791e279", repository: "true" }],
    });
    expect(quoted).toContain(`  - { id: ${ID}e1, version: n1:31d60ac7c791e279, repository: "true" }\n`);
  });
});

describe("baselineStem", () => {
  it("is the name made portable, case kept; `baseline` when nothing is left; a Windows device name suffixed", () => {
    expect(["Release 1", "Größe", "基线一", "CON", "  "].map(baselineStem)).toEqual([
      "Release-1",
      "Gro-e",
      "baseline",
      "CON-baseline",
      "baseline",
    ]);
  });
});
