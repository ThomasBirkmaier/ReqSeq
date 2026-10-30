import { describe, expect, it } from "vitest";
import { codeAnchor, codesPage } from "./codes.js";

describe("codesPage", () => {
  it("gives each code an anchor, problems without and errors with a prefix", () => {
    expect(codeAnchor("relation.outdated", "problem")).toBe("relation-outdated");
    expect(codeAnchor("relation.not-allowed", "error")).toBe("error-relation-not-allowed");
  });

  it("lists problems before errors and escapes the texts", () => {
    const page = codesPage({
      problems: { "a.one": { cause: "Lines <<<<<<< in it.", remedy: "Fix *it*." } },
      errors: { "a.one": { cause: "Failed.", remedy: "Retry." } },
    });
    expect(page.indexOf('<a id="a-one"></a>')).toBeLessThan(page.indexOf('<a id="error-a-one"></a>'));
    expect(page).toContain("**Cause:** Lines \\<\\<\\<\\<\\<\\<\\< in it.\n\n**Remedy:** Fix \\*it\\*.\n");
  });
});
