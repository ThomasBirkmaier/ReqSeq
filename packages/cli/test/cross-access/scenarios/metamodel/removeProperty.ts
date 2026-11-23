// Cross-access scenarios of metamodel.removeProperty, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file and one system
// requirement.
import { expect } from "vitest";
import { KEPT_DEFINITIONS, UNREADABLE_ELEMENT } from "../../fixtures.js";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.removeProperty", [
  {
    name: "removes a property from a type and writes the same bytes and output through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "decision", property: "rationale" },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a property an element holds is refused with the same use through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "system-requirement", property: "title" },
    expect: "error",
  },
  {
    name: "keeps a property definition an element of another type still holds and names their number through every access (SR-238 AK5, SR-236)",
    tag: "[SR-238/AK-pbyq]",
    fixture: KEPT_DEFINITIONS,
    input: { type: "note", property: "remark" },
    expect: "output",
    check: (results) => {
      for (const { outcome, changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
        const { kept } = (outcome as { output: { kept: readonly { key: string; count: number }[] } }).output;
        expect(kept.map(({ key, count }) => [key, count])).toEqual([["remark", 1]]);
      }
    },
  },
  {
    name: "refuses while an element file cannot be read and names it through every access (SR-236 AK7)",
    tag: "[SR-236/AK-bm7r]",
    fixture: UNREADABLE_ELEMENT,
    input: { type: "note", property: "remark" },
    expect: "error",
    check: (results) => {
      for (const [access, { outcome, changed }] of Object.entries(results)) {
        expect(changed, access).toEqual([]);
        expect((outcome as { error: { code: string; details: unknown } }).error, access).toMatchObject({
          code: "file.faulty",
          details: { count: 1, files: [{ file: "elements/NO-broken.md" }] },
        });
      }
    },
  },
]);
