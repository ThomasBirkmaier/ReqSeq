import js from "@eslint/js";
import tseslint from "typescript-eslint";

// ADR-0002: only core holds program logic; access packages must not reach into core internals.
const coreInternals = {
  group: ["@reqseq/core/src/*", "**/core/src/**", "../../core/*"],
  message: "Import from @reqseq/core only.",
};
// Test tooling (git, temp folders) never ends up in product code (ADR-0001, ADR-0011).
const testkitInProduct = {
  group: ["@reqseq/testkit", "@reqseq/testkit/*", "**/testkit/src/**"],
  message: "@reqseq/testkit is for tests only.",
};
// `defineTestCommand` builds commands for test-only catalogs; product commands use `defineCommand`.
const testCommandInProduct = {
  group: ["@reqseq/core", "**/catalog", "**/catalog.js"],
  importNames: ["defineTestCommand"],
  message: "defineTestCommand is for tests only; use defineCommand.",
};
const productFiles = ["packages/**/*.ts", "packages/**/*.tsx"];
// The cross-access scenarios are test code in modules of their own, one per command (#527).
const testFiles = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test-helper.ts",
  "packages/cli/test/cross-access/**/*.ts",
  // The UI tests of the web UI and their starter (Playwright, ADR-0020).
  "packages/web/test/**/*.ts",
  // The e2e tests of the desktop shell and their driver (ADR-0021).
  "packages/shell/e2e/**/*.ts",
  "packages/shell/test/**/*.ts",
  "packages/shell/vitest.shell.config.ts",
];
// The app's part of the performance suite (Playwright, #147) generates its workspace with the testkit.
const appPerfFiles = ["packages/app/test/perf/**/*.ts"];

// ADR-0016: strictest rule sets with type information; any warning fails the run (--max-warnings 0).
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      // Build output of scripts/build/html-export-vendor.mjs (mermaid.js), git-ignored like dist (#2249).
      "packages/core/vendor/**",
      "spec/**",
      "scripts/spec-export/raw/**",
      ".claude/worktrees/**",
      // The sandbox of `pnpm mutate` (Stryker).
      ".stryker-tmp/**",
      // The staged packages and the built delivery (scripts/package/stage.mjs, ADR-0014).
      "build/**",
      "delivery/**",
      "toolchain/packaging/node_modules/**",
      // The documentation site's cache and its content folder, filled by `pnpm docs:generate` (ADR-0017).
      "packages/docs/site/.astro/**",
      "packages/docs/site/src/content/docs/**",
      // Cargo's build folder and what tauri-build writes next to the shell crate (ADR-0021).
      "packages/shell/target/**",
      "packages/shell/shell/gen/**",
    ],
  },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
      "no-console": "error",
      "no-param-reassign": "error",
      "prefer-const": "error",
      "no-var": "error",
      "object-shorthand": "error",
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "xxx"] }],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "vitest.config.ts",
            "vitest.e2e.config.ts",
            "vitest.perf.config.ts",
            "vitest.delivery.config.ts",
            "packages/web/vite.config.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { minimumDescriptionLength: 10 }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly" } },
    // Repository scripts report on the console.
    rules: { "no-console": "off" },
  },
  {
    // Adapters: only the public API of core, never the testkit.
    files: productFiles,
    ignores: [...testFiles, ...appPerfFiles, "packages/core/**", "packages/testkit/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [coreInternals, testkitInProduct, testCommandInProduct] },
      ],
    },
  },
  {
    // Core product code: its own modules, never the testkit.
    files: ["packages/core/**/*.ts", "packages/core/**/*.tsx"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": ["error", { patterns: [testkitInProduct, testCommandInProduct] }],
    },
  },
  {
    // ADR-0019 point 3: the display models run in the app's sandboxed renderer, so they import only types, each
    // other and the import-free modules of core. This block replaces the options of the core block, so it repeats
    // its patterns.
    files: ["packages/core/src/displays/**/*.ts"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            testkitInProduct,
            testCommandInProduct,
            {
              // Everything but another display model (`./x`, not `./../x`) and the import-free modules named here.
              regex: String.raw`^(?!\./(?!\.)|\.\./(?:graph/words|model/criterion-items|problem-titles|hint-order|query/fold|type-order)\.js$)`,
              allowTypeImports: true,
              message:
                "A display model imports only types, other displays modules and import-free modules (ADR-0019).",
            },
          ],
        },
      ],
    },
  },
  {
    // ADR-0020: the pages of the web UI hold no program logic and run in the browser. They import the command types
    // of core and its browser-safe subpaths `displays` and `markdown`, nothing of Node and no other package's code.
    // This block replaces the options of the adapter block, so it repeats its patterns.
    files: ["packages/web/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            coreInternals,
            testkitInProduct,
            {
              regex: String.raw`^@reqseq/core$`,
              allowTypeImports: true,
              message: "The web UI imports only types from @reqseq/core (ADR-0020).",
            },
            {
              regex: String.raw`^@reqseq/(?!core(?:$|/(?:displays|markdown)$))|^node:`,
              message: "The web UI imports only @reqseq/core types, displays and markdown (ADR-0020).",
            },
          ],
        },
      ],
    },
  },
  {
    // The public entry point re-exports everything of the catalog module, including defineTestCommand,
    // which the tests of the access packages import from @reqseq/core.
    files: ["packages/core/src/index.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [testkitInProduct] }],
    },
  },
  {
    // Tests outside core and the testkit itself: the testkit is fine, core internals are not.
    files: [...testFiles, ...appPerfFiles, "packages/testkit/**/*.ts", "packages/testkit/**/*.tsx"],
    ignores: ["packages/core/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [coreInternals] }],
    },
  },
);
