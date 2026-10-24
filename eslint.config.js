import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/out/**", "**/coverage/**", "spec/**", "scripts/spec-export/raw/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }] } },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: { process: "readonly", console: "readonly", fetch: "readonly" } },
  },
  {
    files: ["packages/**/*.ts", "packages/**/*.tsx"],
    rules: {
      // ADR-0002: only core holds program logic; access packages must not reach into core internals.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@logreq/core/src/*", "../../core/*"], message: "Import from @logreq/core only." },
          ],
        },
      ],
    },
  },
);
