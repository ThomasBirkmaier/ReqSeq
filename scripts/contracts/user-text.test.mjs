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
