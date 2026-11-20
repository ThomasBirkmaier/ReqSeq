// The badges of the HTML export in the docs' look (SR-233 AK3, AK4).
import { describe, expect, it } from "vitest";
import { verificationBadge } from "./badge.js";
import { DOCS_BADGE_SCOPE } from "./docs-theme.generated.js";

describe("verificationBadge", () => {
  it("gives each verification status Starlight's variant, an unknown one the default, and escapes the label", () => {
    expect(verificationBadge("verified")).toBe(
      `<span class="sl-badge success small ${DOCS_BADGE_SCOPE}">verified</span>`,
    );
    expect(
      ["indirect", "open", "failed", "outdated", "not in the core"].map(
        (s) => /sl-badge (\w+)/u.exec(verificationBadge(s))?.[1],
      ),
    ).toEqual(["note", "caution", "danger", "danger", "default"]);
    expect(verificationBadge("open", "<2>")).toContain(">&lt;2&gt;</span>");
  });
});
