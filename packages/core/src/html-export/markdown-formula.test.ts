// A formula KaTeX sets to HTML outside the grammar of `formula.ts` is shown as its source (SR-235 AK4).
import { describe, expect, it, vi } from "vitest";
import type * as Formula from "./formula.js";
import { renderMarkdown } from "./markdown.js";

vi.mock("./formula.js", async (original) => ({
  ...(await original<typeof Formula>()),
  isFormulaHtml: () => false,
}));

describe("renderMarkdown with a formula outside the grammar (SR-235 AK4)", () => {
  it("shows the formula as text and reports it", async () => {
    const { html, findings, formulas } = await renderMarkdown("$x^2$", {
      elementFile: "requirements/SR-1.md",
      ignored: () => false,
      image: () => Promise.resolve({ src: "../images/x.png" }),
      reference: () => ({ text: true }),
    });
    expect(html).toBe("<p>$x^2$</p>");
    expect(formulas).toBe(false);
    expect(findings.map((f) => f.code)).toEqual(["html.unsafe-content"]);
  });
});
