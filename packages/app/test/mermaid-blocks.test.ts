// @vitest-environment happy-dom
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mermaid from "mermaid";
import { describe, expect, it } from "vitest";

// Every fenced Mermaid block in the repository's Markdown parses with the Mermaid the app ships, so a diagram in the
// docs never shows a parse error on GitHub (#509). Mermaid reads `;` as the end of a statement, for example.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = execFileSync("git", ["ls-files", "-z", "*.md"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const blocks = files.flatMap((file) => {
  const text = readFileSync(path.join(root, file), "utf8");
  return [...text.matchAll(/^[ \t]*```mermaid\r?\n([\s\S]*?)^[ \t]*```/gm)].map((match) => ({
    name: `${file}:${String(text.slice(0, match.index).split("\n").length)}`,
    source: match[1] ?? "",
  }));
});

describe("Mermaid blocks in the Markdown files", () => {
  it("finds the blocks", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it.each(blocks)("$name parses", async ({ source }) => {
    await expect(mermaid.parse(source)).resolves.toBeTruthy();
  });
});
