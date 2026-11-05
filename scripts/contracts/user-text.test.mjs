import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { root } from "./load.mjs";
import { internalReferences, userText, userTexts } from "./user-text.mjs";

/** The references that are examples of a user's own identifiers in the texts, not ReqSeq's. */
const EXAMPLES = new Set(["SR-036", "SR-001", "N-073", "N-030", "D-062"]);

/** The internal references of every string under `description`, `summary` or `title` in `node`. */
const referencesIn = (node, key = "") => {
  if (typeof node === "string") {
    return ["description", "summary", "title"].includes(key) ? internalReferences(node) : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item) => referencesIn(item, key));
  }
  return node !== null && typeof node === "object"
    ? Object.entries(node).flatMap(([k, value]) => referencesIn(value, k))
    : [];
};

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("texts for users without internal references (#642)", () => {
  it("drops references that stand alone in parentheses, as items of them, or as a lead", () => {
    expect(userText("No command changes a status on its own (D-030, SR-087).")).toBe(
      "No command changes a status on its own.",
    );
    expect(userText("Only one (`statuses` of the type in metamodel.get, #306); null removes it (#343)")).toBe(
      "Only one (`statuses` of the type in metamodel.get); null removes it",
    );
    expect(userText("SR-153 AK1: only on the `out` column")).toBe("Only on the `out` column");
    expect(userText("Marked (AK2; spec questions #528 Q1, Q2 and #593 Q2), the first")).toBe(
      "Marked, the first",
    );
    expect(userText("Left out (#141 c). Run it (ADR-0002 rule 5) now (as SR-152)")).toBe(
      "Left out. Run it now",
    );
    expect(userText("The date (D-013: shown instead of the hash)")).toBe(
      "The date (shown instead of the hash)",
    );
    expect(userText("A record (assumption #534) and one (see #12) of two (follow-up of #3)")).toBe(
      "A record and one of two",
    );
  });

  it("drops the origin of a rule and the mark of an assumption whose question went", () => {
    expect(userText("`not-in-view` (#674, product owner decision, 2026-11-02).")).toBe("`not-in-view`.");
    expect(userText("Emergent (assumption, spec question #591).")).toBe("Emergent.");
    expect(userText("(D-030) Run it")).toBe("Run it");
  });

  it("leaves code spans as they are", () => {
    expect(userText("Pick (`--fields id,title`, SR-036)")).toBe("Pick (`--fields id,title`)");
    expect(userText("Split (`a;b`, #3)")).toBe("Split (`a;b`)");
    expect(userText("Call ( `x(#5)` )")).toBe("Call ( `x(#5)` )");
    expect(userText("See (#3 A) here")).toBe("See (#3 A) here");
  });

  it("keeps a reference in running text and a group without one, spacing and all", () => {
    expect(userText("an identifier (e.g. SR-036), any case")).toBe("an identifier (e.g. SR-036), any case");
    expect(userText("a pair (`a`,`b`) and SR-036")).toBe("a pair (`a`,`b`) and SR-036");
    expect(internalReferences("see #12 and D-030, not SR-0000b1")).toEqual(["#12", "D-030"]);
  });

  it("applies to description, summary and title only, at any depth", () => {
    expect(
      userTexts({
        title: "Title (#1)",
        list: [{ summary: "Summary (D-001)" }, "text (#2)"],
        nested: { description: "Description (SR-002)", sr: "SR-002", count: 3, none: null },
      }),
    ).toEqual({
      title: "Title",
      list: [{ summary: "Summary" }, "text (#2)"],
      nested: { description: "Description", sr: "SR-002", count: 3, none: null },
    });
  });

  it("leaves none in the generated contracts that the CLI help, MCP, the API and the documentation show", () => {
    for (const file of [
      "packages/core/src/generated/contracts.json",
      "schemas/generated/openapi.json",
      "schemas/generated/mcp-tools.json",
    ]) {
      const found = referencesIn(JSON.parse(read(file))).filter((reference) => !EXAMPLES.has(reference));
      expect([file, found]).toEqual([file, []]);
    }
  });

  it("leaves none in the causes and remedies of the problem codes and in the comments of the standard model and the examples", () => {
    const codes = read("schemas/problem-codes.yaml")
      .split("\n")
      .filter((line) => /^\s+(?:cause|remedy): /.test(line));
    const comments = [
      "schemas/examples/metamodel/standard-model.yaml",
      "schemas/examples/data-export/export-package.yaml",
      "schemas/examples/data-export/station-core.yaml",
    ].flatMap((file) =>
      read(file)
        .split("\n")
        .filter((line) => line.includes("#")),
    );
    const found = [...codes, ...comments].flatMap(internalReferences).filter((r) => !EXAMPLES.has(r));
    expect(found).toEqual([]);
  });
});

/**
 * German in a text for users (SR-074 AK1, #81): a letter of German only, or a term of the German
 * glossary of the spec that the English texts once named beside their own word.
 */
const GERMAN =
  /[äöüÄÖÜß]|\b(?:Beleg\w*|Prüfling|Durchführung\w*|Begründung|Nachweis\w*|\w*[Ff]assung\w*|Datens[aä]tz\w*|Validierung|Gültigkeit|Anforderung\w*|Abdeckung|Stand|Hinweis\w*|Stellungnahme|Pflichtfeld\w*|Wertart|Beziehungsart|nicht|beurteilbar|und|oder)\b/u;

/** The keys whose strings users read; `examples` and `default` hold user content, which may be German. */
const TEXT_KEYS = ["description", "summary", "title", "whileReadOnlyReason"];

/** The strings under `description`, `summary` or `title` in `node` that hold German. */
const germanIn = (node, key = "") => {
  if (typeof node === "string") {
    return TEXT_KEYS.includes(key) && GERMAN.test(node) ? [node] : [];
  }
  if (Array.isArray(node)) {
    return node.flatMap((item) => germanIn(item, key));
  }
  return node !== null && typeof node === "object"
    ? Object.entries(node)
        .filter(([k]) => k !== "examples" && k !== "default")
        .flatMap(([k, value]) => germanIn(value, k))
    : [];
};

describe("texts for users in English (SR-074 AK1, #81)", () => {
  it("finds German letters and the German glossary terms, not English words", () => {
    expect(germanIn({ description: "The item under test (Prüfling)" })).toHaveLength(1);
    expect(germanIn({ summary: "Where the Beleg is" })).toHaveLength(1);
    expect(germanIn({ description: "`inconclusive` (nicht beurteilbar)" })).toHaveLength(1);
    expect(germanIn({ examples: [{ title: "Übersicht" }], default: { title: "Grüße" } })).toEqual([]);
    expect(
      germanIn({ title: "Evidence record", description: "Coverage of a selection", other: "Fassung" }),
    ).toEqual([]);
  });

  it("leaves none in the generated contracts, the file formats and the causes and remedies of the problem codes", () => {
    const formats = fs
      .readdirSync(path.join(root, "schemas"))
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => `schemas/${name}`);
    for (const file of [
      "packages/core/src/generated/contracts.json",
      "schemas/generated/openapi.json",
      "schemas/generated/mcp-tools.json",
      ...formats,
    ]) {
      expect([file, germanIn(JSON.parse(read(file)))]).toEqual([file, []]);
    }
    const codes = read("schemas/problem-codes.yaml")
      .split("\n")
      .filter((line) => /^\s+(?:cause|remedy): /.test(line) && GERMAN.test(line));
    expect(codes).toEqual([]);
  });
});
