// The app's main process imports `@reqseq/api/docs-server` (SR-141, ADR-0010): its module graph must load no part
// of the catalog runtime (handler, API server, schema validator, contracts). The runtime imports of each module,
// followed within this package, may name only `node:*` and core's light subpaths.
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The specifiers a module imports at runtime (`import type` is erased). */
const runtimeImports = (source: string): string[] =>
  [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gms)].map((match) => String(match[1]));

describe("@reqseq/api/docs-server", () => {
  it("loads only node:*, core's command-error and docs-site, and its own listen and loopback modules", async () => {
    const seen = new Set<string>();
    const outside = new Set<string>();
    const visit = async (file: string): Promise<void> => {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      for (const specifier of runtimeImports(await fs.readFile(file, "utf8"))) {
        if (specifier.startsWith("./")) {
          await visit(path.join(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
        } else if (!specifier.startsWith("node:")) {
          outside.add(specifier);
        }
      }
    };
    await visit(path.join(import.meta.dirname, "docs-server.ts"));
    expect([...seen].map((file) => path.basename(file)).sort()).toEqual([
      "docs-server.ts",
      "listen.ts",
      "loopback.ts",
    ]);
    expect([...outside].sort()).toEqual(["@reqseq/core/command-error", "@reqseq/core/docs-site"]);
    // Core's `command-error` subpath is `catalog.ts`, which imports only types.
    const catalog = await fs.readFile(
      path.join(import.meta.dirname, "..", "..", "core", "src", "catalog.ts"),
      "utf8",
    );
    expect(runtimeImports(catalog)).toEqual([]);
  });
});
