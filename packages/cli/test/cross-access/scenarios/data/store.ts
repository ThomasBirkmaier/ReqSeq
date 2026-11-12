// Cross-access scenarios of data.store, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

// The runner copies the template with `fs.cp`, so every tracked file is stat-dirty: the content check
// (SR-062 K2, review S2) keeps the state clean, and the file is `<commit>.jsonl`, not `-dirty`.
scenariosOf("data.store", [
  {
    name: "the whole workspace into out",
    fixture: EXPORT,
    root: "system",
    input: { folder: "out" },
    tag: "[SR-062/AK-d6t4]",
    expect: "output",
    check: (results) => {
      const written = (results["core"]?.outcome as { output?: { files?: string[] } }).output?.files ?? [];
      expect(written).toEqual([expect.stringMatching(/^out\/[0-9a-f]{40}\.jsonl$/)]);
    },
  },
]);
