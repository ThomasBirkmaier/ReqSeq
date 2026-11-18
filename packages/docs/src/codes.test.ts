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

  it("[SR-224/AK-rxbd] heads each problem kind with its title, the code below it", () => {
    const page = codesPage({
      problems: { "relation.outdated": { title: "Outdated relation", cause: "Changed.", remedy: "Check." } },
      errors: { "input.invalid": { cause: "Wrong.", remedy: "Fix." } },
    });
    expect(page).toContain(
      '<a id="relation-outdated"></a>\n\n### Outdated relation\n\nCode: `relation.outdated`\n',
    );
    expect(page).toContain('<a id="error-input-invalid"></a>\n\n### `input.invalid`\n');
  });
});
