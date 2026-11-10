// The Vitest config of `pnpm mutate` (scripts/mutate/mutate.mjs, #1335): the base config with the unit tests of the
// mutated packages only, the dot reporter, no coverage and no timing tests.
import { mergeConfig } from "vitest/config";
import base from "../../vitest.config.ts";

const merged = mergeConfig(base, {
  // Timing tests miss their bound under instrumentation (markdown-links.test.ts: 16 s against 10 s).
  test: {
    testNamePattern: /^(?!.*(linear time|N-036|has no address option)).*$/,
    coverage: { enabled: false },
  },
});
// mergeConfig appends arrays, so these two are replaced after it.
merged.test.include = JSON.parse(process.env.REQSEQ_MUTATE_INCLUDE ?? '["packages/core/src/**/*.test.ts"]');
merged.test.reporters = ["dot"];
export default merged;
