// Cross-access scenarios of element.searchFields, in addition to the default one (cross-access.test.ts).
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("element.searchFields", [
  {
    tag: "[SR-216/AK-s99w]",
    name: "the fixed fields, then the properties of the elements' type, without the title",
    fixture: { fixture: "SR-216/fields" },
    input: {},
    expect: "output",
    check: (results) => {
      const [first] = Object.values(results);
      const outcome = first?.outcome;
      expect(outcome !== undefined && "output" in outcome ? outcome.output : undefined).toEqual({
        fields: [
          { key: "title", name: "Title" },
          { key: "text", name: "Text" },
          { key: "id", name: "IDs" },
          { key: "properties", name: "All properties" },
          { key: "rationale", name: "Rationale" },
          { key: "acceptance-criteria", name: "Acceptance Criteria" },
        ],
      });
    },
  },
]);
