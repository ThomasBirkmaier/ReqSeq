import js from "@eslint/js";
import tseslint from "typescript-eslint";

// ADR-0002: only core holds program logic; access packages must not reach into core internals.
const coreInternals = {
  group: ["@logreq/core/src/*", "**/core/src/**", "../../core/*"],
  message: "Import from @logreq/core only.",
};
// Test tooling (git, temp folders) never ends up in product code (ADR-0001, ADR-0011).
const testkitInProduct = {
  group: ["@logreq/testkit", "@logreq/testkit/*", "**/testkit/src/**"],
  message: "@logreq/testkit is for tests only.",
};
// `defineTestCommand` builds commands for test-only catalogs; product commands use `defineCommand`.
const testCommandInProduct = {
  group: ["@logreq/core", "**/catalog", "**/catalog.js"],
  importNames: ["defineTestCommand"],
  message: "defineTestCommand is for tests only; use defineCommand.",
};
const productFiles = ["packages/**/*.ts", "packages/**/*.tsx"];
const testFiles = ["**/*.test.ts", "**/*.test.tsx"];

// ADR-0016: strictest rule sets with type information; any warning fails the run (--max-warnings 0).
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/coverage/**",
      "spec/**",
      "scripts/spec-export/raw/**",
      ".claude/worktrees/**",
      // The staged packages and the built delivery (scripts/package/stage.mjs, ADR-0014).
      "build/**",
      "delivery/**",
      "toolchain/packaging/node_modules/**",
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
    ignores: [...testFiles, "packages/core/**", "packages/testkit/**"],
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
    // The public entry point re-exports everything of the catalog module, including defineTestCommand,
    // which the tests of the access packages import from @logreq/core.
    files: ["packages/core/src/index.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [testkitInProduct] }],
    },
  },
  {
    // Tests outside core and the testkit itself: the testkit is fine, core internals are not.
    files: [...testFiles, "packages/testkit/**/*.ts", "packages/testkit/**/*.tsx"],
    ignores: ["packages/core/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [coreInternals] }],
    },
  },
);
