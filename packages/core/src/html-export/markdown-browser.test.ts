// The Markdown renderer is the subpath `@reqseq/core/markdown`, which the web UI loads in a browser (ADR-0020):
// neither its own modules nor the packages they import may reach a `node:*` module or another module only Node has.
import { builtinModules } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { Window } from "happy-dom";
import { rolldown } from "rolldown";
import { describe, expect, it } from "vitest";
import type { RenderedText, TextContext } from "./markdown.js";
import { renderMarkdown } from "./markdown.js";

const ENTRY = path.join(import.meta.dirname, "markdown.ts");
const BUILTINS: ReadonlySet<string> = new Set(builtinModules);
const isNodeOnly = (specifier: string): boolean =>
  specifier.startsWith("node:") || BUILTINS.has(specifier.split("/")[0] ?? "");

/**
 * The specifiers a module imports at runtime (`import type` is erased): `import … from`, `export … from`, a
 * side-effect `import "x"` and a dynamic `import("x")`.
 */
const runtimeImports = (source: string): string[] =>
  [
    ...source.matchAll(
      /^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)";|^import\s+"([^"]+)";|\bimport\(\s*"([^"]+)"\s*\)/gms,
    ),
  ].map((match) => String(match[1] ?? match[2] ?? match[3]));

const context: TextContext = {
  elementFile: "requirements/SR-1.md",
  ignored: () => false,
  image: (link) => Promise.resolve({ code: "html.image-not-copied", reason: `${link.path} is not shown` }),
  reference: ({ id }) => ({ href: `#/element/${id}` }),
};

const TEXT = [
  "# Title",
  "",
  "**Bold**, $x^2$ and [a reference](reqseq:3f2a8c1e-5b7d-4e9f-8a6c-1d2e3f4a5b6c?repository=other).",
  "",
  "![a picture](images/a.png) <b>raw</b>",
  "",
  "> [!NOTE]",
  "> An aside.",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
].join("\n");

describe("@reqseq/core/markdown", () => {
  it("imports, through its own modules, no node:* module and only the Markdown and formula packages", async () => {
    const seen = new Set<string>();
    const outside = new Set<string>();
    const visit = async (file: string): Promise<void> => {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      for (const specifier of runtimeImports(await fs.readFile(file, "utf8"))) {
        if (specifier.startsWith(".")) {
          await visit(path.join(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
        } else {
          outside.add(specifier);
        }
      }
    };
    await visit(ENTRY);
    const src = path.join(import.meta.dirname, "..");
    expect([...seen].map((file) => path.relative(src, file).split(path.sep).join("/")).sort()).toEqual([
      "files/posix-path.ts",
      "files/system-form.ts",
      "html-export/formula.ts",
      "html-export/markdown.ts",
      "html-export/math-syntax.ts",
      "html-export/render-options.ts",
      "html-export/word-diff.ts",
      "model/image-link.ts",
      "model/portable-names.ts",
      "model/reference-query.ts",
      "model/uuid.ts",
    ]);
    expect([...outside].sort()).toEqual([
      "katex",
      "mdast-util-from-markdown",
      "mdast-util-gfm",
      "mdast-util-to-hast",
      "micromark-extension-gfm",
    ]);
  });

  it("bundles for the browser without a Node module and renders there as in Node", async () => {
    const nodeOnly = new Set<string>();
    const bundle = await rolldown({
      input: ENTRY,
      platform: "browser",
      logLevel: "silent",
      resolve: { extensionAlias: { ".js": [".ts", ".js"] } },
      plugins: [
        {
          name: "node-only",
          resolveId: (specifier) => {
            if (isNodeOnly(specifier)) {
              nodeOnly.add(specifier);
            }
            return null;
          },
        },
      ],
    });
    const { output } = await bundle.generate({ format: "iife", name: "markdown", codeSplitting: false });
    await bundle.close();
    expect([...nodeOnly]).toEqual([]);
    const [chunk] = output.filter((o) => o.type === "chunk");
    // A browser's globals and no Node ones: no `process`, `require`, `Buffer` or `module`.
    const window = new Window();
    const sandbox = vm.createContext({ document: window.document });
    vm.runInContext(String(chunk?.code), sandbox);
    const inBrowser = (sandbox as { markdown: { renderMarkdown: typeof renderMarkdown } }).markdown;
    const rendered: RenderedText = await inBrowser.renderMarkdown(TEXT, context);
    expect(JSON.parse(JSON.stringify(rendered))).toEqual(await renderMarkdown(TEXT, context));
    expect(rendered.formulas && rendered.diagrams).toBe(true);
    expect(rendered.html).toContain('href="#/element/3f2a8c1e-5b7d-4e9f-8a6c-1d2e3f4a5b6c"');
    await window.happyDOM.close();
  });
});
