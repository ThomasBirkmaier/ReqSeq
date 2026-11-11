import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getCommandRuntime } from "@reqseq/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkCitations,
  citationProblems,
  citations,
  readSchemaTexts,
  readSpecIndex,
  schemaTexts,
} from "./citations.js";

const SPEC = fileURLToPath(new URL("../../../spec/", import.meta.url));

const spec = new Map([
  ["SR-018", { invalid: false, criteria: 3 }],
  ["D-045", { invalid: false, criteria: 0 }],
  ["D-052", { invalid: true, criteria: 0 }],
]);

describe("citations", () => {
  it("finds SR, need and decision IDs with the AKs named after them, not short IDs or ADRs", () => {
    expect(
      citations("(D-045, SR-018 AK2, AK3; N-001) SR-018/AK1 and AK2, SR-c67baa, N-7fe707, ADR-0002, SR-0180"),
    ).toEqual([
      { id: "D-045", criteria: [] },
      { id: "SR-018", criteria: [2, 3] },
      { id: "N-001", criteria: [] },
      { id: "SR-018", criteria: [1, 2] },
    ]);
  });
});

describe("citationProblems", () => {
  it("names each cited ID that is missing, invalid, or lacks the AK, once per file", () => {
    const texts = [
      { source: "docs/guide/a.md", text: "As D-045 and sr-018 AK3 say; see N-404 and N-404." },
      { source: "schemas/x.json", text: "(D-052, SR-018 AK4, SR-018 AK0)" },
    ];
    expect(citationProblems(texts, spec)).toEqual([
      "docs/guide/a.md: N-404 is not in spec/",
      "schemas/x.json: D-052 is obsolete or superseded",
      "schemas/x.json: SR-018 has no AK4 (it has 3)",
      "schemas/x.json: SR-018 has no AK0 (it has 3)",
    ]);
  });

  it("checkCitations passes valid citations and throws with every problem", () => {
    expect(() => {
      checkCitations([{ source: "a.md", text: "SR-018 AK1 and D-045." }], spec);
    }).not.toThrow();
    expect(() => {
      checkCitations([{ source: "a.md", text: "D-052" }], spec);
    }).toThrow(
      "docs: cite only spec IDs that are in spec/ and valid, with AKs they have:\na.md: D-052 is obsolete or superseded",
    );
  });
});

describe("schemaTexts", () => {
  it("takes the strings under the text keys at any depth, not other strings", () => {
    expect(
      schemaTexts({
        description: "One (SR-018).",
        examples: ["SR-999"],
        properties: { a: { title: "A", cause: "C", remedy: "R", const: "D-999" } },
        list: [{ summary: "S" }, { details: "T" }, 3, null],
        description2: "x",
      }),
    ).toEqual(["One (SR-018).", "A", "C", "R", "S", "T"]);
  });
});

describe("readSchemaTexts", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reads the JSON and YAML files of schemas/ without generated/ and examples/", async () => {
    root = await mkdtemp(join(tmpdir(), "reqseq-citations-"));
    await mkdir(join(root, "schemas", "commands"), { recursive: true });
    await mkdir(join(root, "schemas", "generated"), { recursive: true });
    await mkdir(join(root, "schemas", "examples"), { recursive: true });
    await writeFile(join(root, "schemas", "a.schema.json"), '{ "description": "A (D-045)." }');
    await writeFile(join(root, "schemas", "commands", "b.json"), '{ "summary": "B" }');
    await writeFile(join(root, "schemas", "codes.yaml"), "problems:\n  x:\n    cause: C\n");
    await writeFile(join(root, "schemas", "notes.md"), "description: N");
    await writeFile(join(root, "schemas", "generated", "g.json"), '{ "description": "G" }');
    await writeFile(join(root, "schemas", "examples", "e.yaml"), "description: E\n");
    expect(await readSchemaTexts(root)).toEqual([
      { source: "schemas/a.schema.json", text: "A (D-045)." },
      { source: "schemas/codes.yaml", text: "C" },
      { source: "schemas/commands/b.json", text: "B" },
    ]);
  });
});

describe("readSpecIndex", () => {
  it("reads every element of spec/ by spec ID with its AK count and whether its status is invalid, page by page", async () => {
    const runtime = getCommandRuntime();
    const whole = await readSpecIndex(runtime, SPEC);
    expect(whole.get("SR-018")).toEqual({ invalid: false, criteria: 3 });
    expect(whole.get("D-052")).toEqual({ invalid: true, criteria: 0 });
    expect(whole.get("N-025")?.invalid).toBe(false);
    const paged = await readSpecIndex(runtime, SPEC, 150);
    expect(paged).toEqual(whole);
  });
});
