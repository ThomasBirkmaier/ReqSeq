// #635: the blocks of packages/core/src import each other only downward, as docs/architecture/README.md
// section 5 states. This test reads the relative imports of every product module (test files left out)
// and fails on an import that goes to the same or a higher layer or that the README's block table does
// not list. A new block or runtime module, or a new allowed import, is added to the README and here.
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** A block of the README table; `runtime` is split into its entry and its state modules. */
type Unit =
  | "runtime entry"
  | "commands"
  | "data"
  | "query"
  | "hints"
  | "evidence"
  | "trace"
  | "variants"
  | "baselines"
  | "model"
  | "metamodel"
  | "workspace"
  | "files"
  | "version"
  | "git"
  | "runtime state";

/** Modules every block may import, and the public entry point, which sits above all blocks. */
type Shared = "catalog" | "product" | "generated" | "index";

/** The layers from the bottom (README section 5). Every import points to a lower layer. */
const LAYERS: readonly (readonly Unit[])[] = [
  ["files", "version", "git", "runtime state"],
  ["workspace"],
  ["metamodel"],
  ["model"],
  ["trace", "variants", "baselines"],
  ["evidence"],
  ["hints", "query"],
  ["data"],
  ["commands"],
  ["runtime entry"],
];

interface Allowed {
  readonly values: readonly (Unit | Shared)[];
  readonly types?: readonly (Unit | Shared)[];
}

/**
 * The block table of README section 5: the blocks each block may import values from, and those it may
 * import only types from (`import type`, `export type`). `catalog`, `product` and `generated` may be
 * imported by every block; their own imports and those of `index.ts` are listed here too.
 */
const TABLE: Readonly<Record<Unit | Shared, Allowed>> = {
  index: {
    values: [
      "runtime entry",
      "catalog",
      "product",
      "generated",
      "runtime state",
      "workspace",
      "model",
      "files",
      "query",
      "evidence",
      "version",
    ],
  },
  "runtime entry": { values: ["commands", "metamodel", "model", "query", "runtime state"] },
  commands: {
    values: [
      "baselines",
      "data",
      "evidence",
      "files",
      "hints",
      "metamodel",
      "model",
      "query",
      "runtime state",
      "trace",
      "variants",
      "version",
      "workspace",
    ],
  },
  data: {
    values: ["evidence", "files", "metamodel", "model", "variants", "workspace"],
    types: ["git", "query", "runtime state"],
  },
  query: {
    values: [
      "baselines",
      "evidence",
      "files",
      "metamodel",
      "model",
      "runtime state",
      "trace",
      "variants",
      "workspace",
    ],
  },
  hints: {
    values: [
      "baselines",
      "evidence",
      "files",
      "metamodel",
      "model",
      "runtime state",
      "trace",
      "variants",
      "workspace",
    ],
  },
  evidence: { values: ["files", "metamodel", "model", "runtime state", "trace", "variants", "workspace"] },
  trace: { values: ["metamodel", "model", "runtime state", "workspace"] },
  variants: { values: ["metamodel", "model", "runtime state", "workspace"] },
  baselines: { values: ["files", "model", "runtime state", "workspace"] },
  model: { values: ["files", "git", "metamodel", "runtime state", "version", "workspace"] },
  metamodel: { values: ["files", "runtime state", "workspace"] },
  workspace: { values: ["files", "runtime state"] },
  files: { values: [] },
  version: { values: [] },
  git: { values: [] },
  "runtime state": { values: [] },
  catalog: { values: ["generated"], types: ["runtime state"] },
  product: { values: ["generated"] },
  generated: { values: [] },
};

const EVERY_BLOCK_MAY_IMPORT: ReadonlySet<Unit | Shared> = new Set(["catalog", "product", "generated"]);
const RUNTIME_ENTRY = new Set(["invoke", "warm", "instructions", "element-short-ids"]);
const RUNTIME_STATE = new Set(["workspace", "settled", "contracts", "input-errors"]);
const BLOCK_FOLDERS: ReadonlySet<string> = new Set(
  LAYERS.flat().filter((unit) => unit !== "runtime entry" && unit !== "runtime state"),
);

const SRC = import.meta.dirname;

/** The unit of a module, from its path relative to `src` with `/`; a string is an error. */
function unitOf(module: string): { readonly unit: Unit | Shared } | { readonly error: string } {
  const [first = "", second] = module.split("/");
  if (second === undefined) {
    const name = first.replace(/\.(?:ts|js)$/, "");
    return name === "index" || name === "catalog" || name === "product"
      ? { unit: name }
      : { error: "unknown root module" };
  }
  if (first === "generated") {
    return { unit: "generated" };
  }
  if (first === "runtime") {
    const name = second.replace(/\.(?:ts|js)$/, "");
    if (RUNTIME_ENTRY.has(name)) {
      return { unit: "runtime entry" };
    }
    return RUNTIME_STATE.has(name)
      ? { unit: "runtime state" }
      : { error: "runtime module that is neither entry nor state" };
  }
  return BLOCK_FOLDERS.has(first) ? { unit: first as Unit } : { error: "unknown block folder" };
}

function layerOf(unit: Unit | Shared): number {
  return unit === "index"
    ? LAYERS.length
    : LAYERS.findIndex((layer) => (layer as readonly string[]).includes(unit));
}

interface Import {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly line: number;
}

/**
 * The relative module references of one file: static imports and re-exports (also over several lines),
 * side-effect imports, dynamic `import()`, `import("...")` types and `new URL("./x.js", import.meta.url)`
 * (worker entries).
 */
function importsOf(fileName: string, text: string): Import[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found: Import[] = [];
  const visit = (node: ts.Node): void => {
    const reference = referenceOf(node, source);
    if (
      reference !== undefined &&
      ts.isStringLiteralLike(reference.literal) &&
      reference.literal.text.startsWith(".")
    ) {
      const line = source.getLineAndCharacterOfPosition(reference.literal.getStart(source)).line + 1;
      found.push({ specifier: reference.literal.text, typeOnly: reference.typeOnly, line });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The module literal a node refers to, if it is an import, a re-export or a worker URL. */
function referenceOf(
  node: ts.Node,
  source: ts.SourceFile,
): { readonly literal: ts.Node; readonly typeOnly: boolean } | undefined {
  if (ts.isImportDeclaration(node)) {
    return {
      literal: node.moduleSpecifier,
      typeOnly: node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
    };
  }
  if (ts.isExportDeclaration(node)) {
    return node.moduleSpecifier === undefined
      ? undefined
      : { literal: node.moduleSpecifier, typeOnly: node.isTypeOnly };
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return { literal: node.argument.literal, typeOnly: true };
  }
  return loadOf(node, source);
}

/** The module literal of a dynamic `import()` or of a worker entry `new URL("./x.js", import.meta.url)`. */
function loadOf(
  node: ts.Node,
  source: ts.SourceFile,
): { readonly literal: ts.Node; readonly typeOnly: boolean } | undefined {
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    const [target] = node.arguments;
    return target === undefined ? undefined : { literal: target, typeOnly: false };
  }
  if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== "URL") {
    return undefined;
  }
  const [target, base] = node.arguments ?? [];
  const worker =
    target !== undefined &&
    base?.getText(source) === "import.meta.url" &&
    ts.isStringLiteralLike(target) &&
    /\.[cm]?js$/.test(target.text);
  return worker ? { literal: target, typeOnly: false } : undefined;
}

/** A unit with its layer; `catalog`, `product` and `generated` have none. */
function label(unit: Unit | Shared): string {
  const layer = layerOf(unit);
  return layer < 0 ? unit : `${unit} (layer ${String(layer)})`;
}

/** The violations of one module (path relative to `src` with `/`), each naming file, import and rule. */
function problemsOf(module: string, text: string): string[] {
  const from = unitOf(module);
  if ("error" in from) {
    return [`${module}: ${from.error}; add it to docs/architecture/README.md section 5 and to this test`];
  }
  // The shared modules sit outside the layers; only their own row of the table limits their imports.
  const layered = !EVERY_BLOCK_MAY_IMPORT.has(from.unit);
  const problems: string[] = [];
  for (const { specifier, typeOnly, line } of importsOf(module, text)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(module), specifier));
    const at = `${module}:${String(line)} imports ${typeOnly ? "types of " : ""}"${specifier}"`;
    const to = unitOf(target);
    if ("error" in to) {
      problems.push(`${at}: target ${target} is an ${to.error}`);
      continue;
    }
    if (to.unit === from.unit || (layered && EVERY_BLOCK_MAY_IMPORT.has(to.unit))) {
      continue;
    }
    const where = `${label(from.unit)} -> ${label(to.unit)}`;
    if (layered && layerOf(to.unit) >= layerOf(from.unit)) {
      problems.push(`${at}: ${where} does not point to a lower layer`);
      continue;
    }
    const allowed = TABLE[from.unit];
    const listed = typeOnly ? [...allowed.values, ...(allowed.types ?? [])] : allowed.values;
    if (!listed.includes(to.unit)) {
      const kind = typeOnly ? "values or types" : "values";
      const list = listed.length === 0 ? "no other block" : listed.join(", ");
      problems.push(
        `${at}: ${where} is not in the README block table (${from.unit} imports ${kind} of ${list})`,
      );
    }
  }
  return problems;
}

/** Every non-test `.ts` module of `src`, relative with `/`. */
function productModules(): string[] {
  return fs
    .readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .map((entry) => entry.split(path.sep).join("/"))
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts"))
    .sort();
}

describe("core block layers (#635, docs/architecture/README.md section 5)", () => {
  it("every relative import of the product code points to a lower layer and is in the block table", () => {
    const modules = productModules().map((module) => ({
      module,
      text: fs.readFileSync(path.join(SRC, module), "utf8"),
    }));
    // The scan sees the code: the modules of every block and their imports.
    expect(modules.length).toBeGreaterThan(100);
    expect(modules.flatMap(({ module, text }) => importsOf(module, text)).length).toBeGreaterThan(500);
    expect(modules.flatMap(({ module, text }) => problemsOf(module, text))).toEqual([]);
  });

  it("the block table lists only lower layers and type-only imports apart from value imports", () => {
    for (const [unit, allowed] of Object.entries(TABLE) as [Unit | Shared, Allowed][]) {
      for (const target of [...allowed.values, ...(allowed.types ?? [])]) {
        if (!EVERY_BLOCK_MAY_IMPORT.has(target) && !EVERY_BLOCK_MAY_IMPORT.has(unit)) {
          expect(layerOf(target), `${unit} -> ${target}`).toBeLessThan(layerOf(unit));
        }
      }
      for (const target of allowed.types ?? []) {
        expect(allowed.values, `${unit} -> ${target}`).not.toContain(target);
      }
    }
    expect(LAYERS.flat().sort()).toEqual(
      Object.keys(TABLE)
        .filter((unit) => unit !== "index" && !EVERY_BLOCK_MAY_IMPORT.has(unit as Shared))
        .sort(),
    );
  });

  it("finds imports over several lines, with either quote, type-only, re-exported, dynamic and as worker URL", () => {
    const text = [
      'import {\n  a,\n  b,\n} from "../model/store.js";',
      "import type { C } from '../git/reader.js';",
      'export { d } from "./other.js";',
      'export type { E } from "../query/filter.js";',
      'import "../files/index.js";',
      'const f = await import("../trace/chain.js");',
      'type G = import("../runtime/workspace.js").Workspace;',
      'const w = new URL("./read-worker.js", import.meta.url);',
      'const folder = new URL("../", import.meta.url);',
      'import fs from "node:fs";',
    ].join("\n");
    expect(importsOf("data/x.ts", text)).toEqual([
      { specifier: "../model/store.js", typeOnly: false, line: 4 },
      { specifier: "../git/reader.js", typeOnly: true, line: 5 },
      { specifier: "./other.js", typeOnly: false, line: 6 },
      { specifier: "../query/filter.js", typeOnly: true, line: 7 },
      { specifier: "../files/index.js", typeOnly: false, line: 8 },
      { specifier: "../trace/chain.js", typeOnly: false, line: 9 },
      { specifier: "../runtime/workspace.js", typeOnly: true, line: 10 },
      { specifier: "./read-worker.js", typeOnly: false, line: 11 },
    ]);
  });

  it("names file, import and rule of each violation", () => {
    expect(problemsOf("model/x.ts", 'import { a } from "../trace/chain.js";')).toEqual([
      'model/x.ts:1 imports "../trace/chain.js": model (layer 3) -> trace (layer 4) does not point to a lower layer',
    ]);
    expect(problemsOf("trace/x.ts", 'import { a } from "../variants/view.js";')).toEqual([
      'trace/x.ts:1 imports "../variants/view.js": trace (layer 4) -> variants (layer 4) does not point to a lower layer',
    ]);
    expect(problemsOf("trace/x.ts", 'import { a } from "../git/reader.js";')).toEqual([
      'trace/x.ts:1 imports "../git/reader.js": trace (layer 4) -> git (layer 0) is not in the README block table (trace imports values of metamodel, model, runtime state, workspace)',
    ]);
    expect(problemsOf("data/x.ts", 'import { a } from "../git/reader.js";')).toEqual([
      'data/x.ts:1 imports "../git/reader.js": data (layer 7) -> git (layer 0) is not in the README block table (data imports values of evidence, files, metamodel, model, variants, workspace)',
    ]);
    expect(problemsOf("files/x.ts", 'import { a } from "../commands/index.js";')).toEqual([
      'files/x.ts:1 imports "../commands/index.js": files (layer 0) -> commands (layer 8) does not point to a lower layer',
    ]);
    expect(problemsOf("model/x.ts", 'import { a } from "../reqif/x.js";')).toEqual([
      'model/x.ts:1 imports "../reqif/x.js": target reqif/x.js is an unknown block folder',
    ]);
    expect(problemsOf("reqif/x.ts", "")).toEqual([
      "reqif/x.ts: unknown block folder; add it to docs/architecture/README.md section 5 and to this test",
    ]);
    expect(problemsOf("catalog.ts", 'import { Workspace } from "./runtime/workspace.js";')).toEqual([
      'catalog.ts:1 imports "./runtime/workspace.js": catalog -> runtime state (layer 0) is not in the README block table (catalog imports values of generated)',
    ]);
    expect(problemsOf("generated/types.ts", 'import { a } from "../catalog.js";')).toEqual([
      'generated/types.ts:1 imports "../catalog.js": generated -> catalog is not in the README block table (generated imports values of no other block)',
    ]);
    expect(problemsOf("runtime/new.ts", "")[0]).toContain("neither entry nor state");
    expect(problemsOf("helpers.ts", "")[0]).toContain("unknown root module");
  });

  it("allows the same block, the shared modules, listed type-only imports and the public entry point", () => {
    expect(problemsOf("data/x.ts", 'import type { A } from "../git/reader.js";')).toEqual([]);
    expect(problemsOf("model/a/x.ts", 'import { b } from "../store.js";')).toEqual([]);
    expect(
      problemsOf(
        "files/x.ts",
        'import { c } from "../catalog.js";\nimport d from "../generated/product.json";',
      ),
    ).toEqual([]);
    expect(
      problemsOf(
        "runtime/invoke.ts",
        'import { e } from "./element-short-ids.js";\nimport { f } from "../commands/index.js";',
      ),
    ).toEqual([]);
    expect(problemsOf("index.ts", 'export { g } from "./runtime/invoke.js";')).toEqual([]);
  });
});
