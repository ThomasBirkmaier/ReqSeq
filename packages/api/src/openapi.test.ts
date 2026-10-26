// schemas/generated/openapi.json describes what the API does (ADR-0003): one path per catalog command
// and every status the server answers with.
import fs from "node:fs/promises";
import path from "node:path";
import { loadContracts } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { COMMANDS_PATH, HTTP_STATUS_BY_CLASS } from "./handler.js";

interface Operation {
  readonly responses: Readonly<Record<string, unknown>>;
}

const file = path.join(import.meta.dirname, "..", "..", "..", "schemas", "generated", "openapi.json");

/** Every `pattern` of a JSON document, for the check that external clients can compile them. */
const patternsOf = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(patternsOf);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, inner]) =>
    key === "pattern" && typeof inner === "string" ? [inner] : patternsOf(inner),
  );
};

describe("openapi.json", () => {
  it("has the catalog endpoint and one POST endpoint per catalog command, with every status", async () => {
    const openapi = JSON.parse(await fs.readFile(file, "utf8")) as {
      paths: Record<string, { get?: Operation; post?: Operation }>;
    };
    const names = loadContracts().commands.map((e) => e.name);
    expect(Object.keys(openapi.paths)).toEqual([COMMANDS_PATH, ...names.map((n) => `${COMMANDS_PATH}/${n}`)]);
    expect(Object.keys(openapi.paths[COMMANDS_PATH]?.get?.responses ?? {})).toEqual(["200", "401", "403"]);
    const statuses = [200, 401, 403, 413, ...Object.values(HTTP_STATUS_BY_CLASS)].map(String).sort();
    for (const name of names) {
      const responses = openapi.paths[`${COMMANDS_PATH}/${name}`]?.post?.responses ?? {};
      expect(Object.keys(responses).sort()).toEqual([...new Set(statuses)]);
    }
  });

  it("publishes only patterns a client compiles without the Unicode flag (D-029, #305)", async () => {
    const published = JSON.parse(await fs.readFile(file, "utf8")) as {
      components: { schemas: { common: { $defs: { elementRef: { pattern: string } } } } };
    };
    const patterns = patternsOf(published);
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      // Without the u flag, as many clients compile them: \p{...} would be literal text.
      expect(() => new RegExp(pattern)).not.toThrow();
      expect(pattern).not.toMatch(/\\[pP]\{/);
    }
    const elementRef = new RegExp(published.components.schemas.common.$defs.elementRef.pattern);
    for (const ref of ["SR-3c90b0", "SR-036", "sr-5a8b25", "Stufe 2 – Spec-ID ä"]) {
      expect(elementRef.test(ref)).toBe(true);
    }
    for (const ref of ["", " SR-036", "SR-036 ", "SR-\u0007036", "a\tb", "SR-036\u0085"]) {
      expect(elementRef.test(ref)).toBe(false);
    }
  });
});
