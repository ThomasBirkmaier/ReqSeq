// The Vitest config of `pnpm mutate` (scripts/mutate/mutate.mjs, #1335): the base config with the unit tests of the
// mutated packages only, the dot reporter and no coverage. The tests it leaves out, and why, are in mutate.mjs.
import { mergeConfig } from "vitest/config";
import base from "../../vitest.config.ts";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const excluded = JSON.parse(process.env.REQSEQ_MUTATE_EXCLUDE ?? '["linear time", "N-036"]');

const merged = mergeConfig(base, {
  test: {
    testNamePattern: new RegExp(`^(?!.*(${excluded.map(escape).join("|")})).*$`),
    coverage: { enabled: false },
  },
});
// mergeConfig appends arrays, so these two are replaced after it.
merged.test.include = JSON.parse(process.env.REQSEQ_MUTATE_INCLUDE ?? '["packages/core/src/**/*.test.ts"]');
merged.test.reporters = ["dot"];
export default merged;
