// Cross-access scenarios of html.export, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { ONE_REPOSITORY } from "../../fixtures.js";

scenariosOf("html.export", [
  {
    tag: "[SR-231/AK-vm0n]",
    name: "a folder of HTML pages, one per element, a start page and the marker file",
    fixture: ONE_REPOSITORY,
    input: { output: "site" },
    expect: "output",
    check: (results) => {
      for (const { files } of Object.values(results)) {
        expect(files["site/index.html"]).toContain("<!doctype html>");
        expect(files["site/reqseq-html-export.yaml"]).toContain("reqseq-html-export: 1");
        expect(Object.keys(files).some((f) => /^site\/elements\/[0-9a-f-]{36}\.html$/.test(f))).toBe(true);
      }
    },
  },
  {
    tag: "[SR-235/AK-zh58]",
    name: "a folder that is not empty and holds no marker file is refused, and nothing is written",
    fixture: { ...ONE_REPOSITORY, files: { "site/mine.txt": "mine\n" } },
    input: { output: "site" },
    expect: "error",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.changed).toEqual([]);
      }
    },
  },
  {
    tag: "[SR-235/AK-m01q]",
    name: "a target in a .git folder is refused",
    fixture: ONE_REPOSITORY,
    input: { output: ".git/site" },
    expect: "error",
    check: (results) => {
      for (const result of Object.values(results)) {
        expect(result.changed).toEqual([]);
      }
    },
  },
]);
