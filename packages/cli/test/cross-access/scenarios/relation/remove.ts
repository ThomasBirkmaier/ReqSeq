// Cross-access scenarios of relation.remove, in addition to the default one (cross-access.test.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import type { FixtureOptions } from "@reqseq/testkit";
import { defaultFixturesDir } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { changedFiles, replaceOnce } from "../../fixtures.js";

/** Requirements A, B, C in a cycle, C deriving from A (SR-090). */
const CYCLE: FixtureOptions = { fixture: "SR-090/cycle", git: true };
const C_FILE = "requirements/SR-0b0000000003.md";
const C_TEXT = readFileSync(path.join(defaultFixturesDir, "SR-090/cycle", C_FILE), "utf8");

scenariosOf("relation.remove", [
  {
    name: "a relation that closed a cycle is gone from the source file, and nothing else changes",
    tag: "[SR-067/AK5]",
    fixture: CYCLE,
    input: { source: "SR-b0000000003", kind: "derives-from", target: "SR-b0000000001" },
    expect: "output",
    check: (results) => {
      expect(changedFiles(results["core"])).toEqual([C_FILE]);
      // The key goes with its last item; the rest of the file stays as it was.
      expect(results["core"]?.files[C_FILE]).toBe(replaceOnce(C_TEXT, /derives-from:\n {2}- .*\n/, ""));
    },
  },
  {
    name: "only relations into the repository given",
    fixture: { fixture: "SR-090/cycle", git: true },
    input: {
      source: "SR-b0000000003",
      kind: "derives-from",
      target: "5e9c0a7d-2b4f-4c61-9d08-0b0000000001",
      repository: "system",
    },
    expect: "output",
  },
  {
    name: "no relation kind",
    fixture: { fixture: "SR-090/cycle", git: true },
    input: { source: "SR-b0000000003", kind: "nope", target: "SR-b0000000001" },
    expect: "error",
  },
]);
