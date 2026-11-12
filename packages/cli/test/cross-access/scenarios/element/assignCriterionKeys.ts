// Cross-access scenarios of element.assignCriterionKeys (SR-204 AK3), in addition to the default one
// (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { changedFiles } from "../../fixtures.js";

/** A requirement with `criteria` as the lines of its acceptance criteria. */
const requirement = (tail: string, title: string, criteria: readonly string[]): string =>
  [
    "---",
    `id: 20420420-0000-4000-8000-${tail}`,
    "type: system-requirement",
    "status: draft",
    `title: ${title}`,
    "acceptance-criteria:",
    ...criteria,
    "---",
    "",
  ].join("\n");

/** One requirement without keys, one with a key and a criterion without, one with keys only. */
const UNKEYED = {
  fixture: "SR-004/one-repository",
  git: true,
  files: {
    "requirements/SR-000000000a01.md": requirement("000000000a01", "Peaks", [
      "  - Given a peak, then it is shown.",
      "  - Given a peak, then it is shown.",
    ]),
    "requirements/SR-000000000a02.md": requirement("000000000a02", "Calm", [
      "  - key: calm1",
      "    text: Given calm, then it is shown.",
      "  - Given a breeze, then it is shown.",
    ]),
    "requirements/SR-000000000a03.md": requirement("000000000a03", "Fog", [
      "  - key: fog01",
      "    text: Given fog, then it is shown.",
    ]),
  },
} as const;

scenariosOf("element.assignCriterionKeys", [
  {
    name: "every criterion of the selection gets a key, the tool names the changed elements",
    fixture: UNKEYED,
    input: { selection: {} },
    tag: "[SR-204/AK-jfrc]",
    expect: "output",
    check: (results) => {
      const { core } = results;
      expect(changedFiles(core)).toEqual([
        "requirements/SR-000000000a01.md",
        "requirements/SR-000000000a02.md",
      ]);
      expect((core?.outcome as { output: { count: number } }).output.count).toBe(2);
    },
  },
  {
    name: "only the elements of the selection change",
    fixture: UNKEYED,
    input: { selection: { ids: ["SR-000a02", "SR-000a03"] } },
    tag: "[SR-204/AK-jfrc]",
    expect: "output",
  },
  {
    name: "a baseline that does not exist is refused, nothing is written",
    fixture: UNKEYED,
    input: { selection: { baseline: "nope" } },
    expect: "error",
  },
]);
