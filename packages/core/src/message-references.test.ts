// #2199: a text a user reads names no element of ReqSeq's own specification and no issue of its
// repository, since a user takes "(D-012)" for an element of their own workspace. This test reads every
// string and template literal of the product code (comments are no literals, so they keep their
// references) and fails on such an ID. Example values that show the form of an identifier stay allowed.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;

/** An ID of ReqSeq's spec, or an issue number; `&#13;` and Mermaid's `#35;` are character references. */
const REFERENCE = /\b(?:D|SR|N)-\d{3}\b|(?<![&\w])#\d+(?![\d;])/;

/** Example values in messages that show how an identifier is written, not what the spec says. */
const EXAMPLES: readonly string[] = [
  "an identifier such as SR-036",
  "such as [SR-036/AK-k7f3]",
  '{"derives-from": ["N-073", "N-030"], "based-on": "D-062"}',
];

/** Every `.ts` module of `src` that is neither a test, a test helper nor generated, relative with `/`. */
const productModules = (): string[] =>
  fs
    .readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(path.sep).join("/"))
    .filter(
      (entry) =>
        entry.endsWith(".ts") &&
        !/\.(test|test-helper|generated|d)\.ts$/.test(entry) &&
        !entry.startsWith("generated/"),
    )
    .sort();

/** The text of every string literal and every literal part of a template in `text`. */
const literalTexts = (fileName: string, text: string): string[] => {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      found.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

/** The literals of `text` that name a spec ID or an issue, after the examples are taken out. */
const referencing = (fileName: string, text: string): string[] =>
  literalTexts(fileName, text).filter((literal) =>
    REFERENCE.test(EXAMPLES.reduce((rest, example) => rest.replaceAll(example, ""), literal)),
  );

describe("message texts name no spec ID and no issue (#2199)", () => {
  it("finds a spec ID or an issue number in a literal, but not in a comment, an example or a character reference", () => {
    const text = [
      "// (D-012) in a comment",
      'const a = "a field every element has (D-012)";',
      "const b = `kept ${x} (SR-047)`;",
      'const c = "spec question #583";',
      'const d = "an identifier such as SR-036";',
      'const e = "&#13;" + "#35;" + "N-0a1b2c";',
    ].join("\n");
    expect(referencing("sample.ts", text)).toEqual([
      "a field every element has (D-012)",
      " (SR-047)",
      "spec question #583",
    ]);
  });

  it("no literal of the product code names a spec ID or an issue", () => {
    const found = productModules().flatMap((module) =>
      referencing(module, fs.readFileSync(path.join(SRC, module), "utf8")).map(
        (literal) => `${module}: ${literal}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
