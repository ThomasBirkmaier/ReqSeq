// The metamodel as text (SR-130 AK5): the words of each row, from the output of `metamodel.get`.
import { describe, expect, it } from "vitest";
import { metamodelText } from "./metamodel-text.js";
import type { TextRow } from "./metamodel-text.js";
import { FIXTURE_METAMODEL, effectiveType, metamodelOutput } from "./metamodel-test-data.js";

/** A row as one line of words, a property as "name key value [required] [counts to version] [(inherited)]". */
const words = (row: TextRow): string =>
  row.kind === "relation"
    ? [`${row.key} | ${row.name} ${row.relation} | ${row.source} → ${row.target}`, ...row.limits].join(" | ")
    : [
        `${row.key} | ${row.name} ${row.prefix} ${row.type}${row.abstract ? " abstract" : ""}`,
        `extends ${row.parent ?? "-"}`,
        ...row.properties.map(
          (property) =>
            `${property.name} ${property.key} ${property.value}${property.required ? " required" : ""}${property.content ? " counts to version" : ""}${property.inherited ? " (inherited)" : ""}`,
        ),
        `statuses ${row.statuses.join(" · ")}`,
      ].join(" | ");

describe("metamodelText", () => {
  it("[SR-130/AK-y6rs] names for each type its key, name, prefix, parent, properties with value kind, required and whether they count to the version, and statuses, and for each relation kind its source and target types", () => {
    const text = metamodelText(FIXTURE_METAMODEL);
    expect(text.rows.map(words)).toEqual([
      "type:item | Item ITM item abstract | extends - | Title title text required | statuses Draft · Approved · Retired",
      "type:requirement | System Requirement SR requirement | extends Item | Title title text required (inherited) | Rationale rationale text | Package packages list of relation → Package | statuses Draft · Approved · Retired",
      "type:software-requirement | Software Requirement SWR software-requirement | extends System Requirement | Title title text required (inherited) | Rationale rationale text (inherited) | Package packages list of relation → Package (inherited) | Component component list of choice required counts to version | statuses Draft · Approved · Retired",
      "type:decision | Decision D decision | extends - | Title title text | statuses Open · Decided",
      "type:package | Package PKG package | extends - | Title title text | statuses ",
      "relation:derives-from | Derives from derives-from | Software Requirement → System Requirement, Software Requirement",
      "relation:replaces | Replaces replaces | System Requirement → System Requirement",
      "relation:delegates-to | Delegates to delegates-to | System Requirement → Software Requirement",
      "relation:based-on | Based on based-on | any type → Decision",
      "relation:concerns | Concerns concerns | any type → System Requirement, Decision",
      "relation:refines | Refines refines | any type → any type",
      "relation:traces-to | Traces to traces-to | Decision → any type",
      "relation:blocks | Blocks blocks | none → System Requirement",
    ]);
    expect(text.problems).toEqual([]);
  });

  it("names any type for an open side and none for an empty list, also of a relation property, and keys that name nothing as written", () => {
    const text = metamodelText(
      metamodelOutput({
        types: [
          { ...effectiveType("child", ["links", "single", "loose", "lost"], "gone"), statuses: ["unknown"] },
        ],
        properties: [
          { key: "links", name: "Links", kind: "relation", content: false },
          { key: "single", name: "Single", kind: "relation", "target-types": [], content: false },
          {
            key: "loose",
            name: "Loose",
            kind: "relation",
            many: true,
            "target-types": ["child", "nowhere"],
            content: false,
          },
        ],
        relations: [{ key: "free", name: "Free", "source-types": [], "target-types": ["elsewhere"] }],
      }),
    );
    expect(text.rows.map(words)).toEqual([
      "type:child | CHILD CHILD child | extends gone | Links links relation → any type | Single single relation → none | Loose loose list of relation → CHILD, nowhere | lost lost  | statuses unknown",
      "relation:free | Free free | none → elsewhere",
    ]);
  });

  it("lists the problems of the output, one line each, with where they are when known", () => {
    const text = metamodelText({
      ...metamodelOutput({}),
      problems: [
        {
          code: "metamodel.invalid",
          severity: "error",
          message: "not a metamodel file",
          file: "model/broken.yaml",
          line: 3,
        },
        { code: "metamodel.invalid", severity: "warning", message: "no line", file: "model/types.yaml" },
        { code: "metamodel.invalid", severity: "info", message: "nowhere" },
      ],
    });
    expect(text.rows).toEqual([]);
    expect(text.problems).toEqual([
      "error  metamodel.invalid  not a metamodel file  model/broken.yaml:3",
      "warning  metamodel.invalid  no line  model/types.yaml",
      "info  metamodel.invalid  nowhere",
    ]);
  });

  it("[SR-130/AK-y6rs] names the most entries of a list property and each limit of a relation kind (SR-171, SR-152)", () => {
    const text = metamodelText(
      metamodelOutput({
        types: [
          effectiveType("need", ["criteria", "single"]),
          { ...effectiveType("system-requirement", []), name: "System Requirement" },
        ],
        properties: [
          { key: "criteria", name: "Criteria", kind: "text", many: true, "max-items": 3, content: true },
          // Invalid (returned with problems): a single value with a list limit shows none.
          { key: "single", name: "Single", kind: "text", "max-items": 2, content: false },
        ],
        relations: [
          {
            key: "derives-from",
            name: "Derives from",
            limits: [
              { "target-type": "use-case", max: 1 },
              { "source-type": "system-requirement", "target-type": "need", min: 1 },
              { "target-type": "need", min: 1, max: 3 },
              { "target-type": "need", min: 2, max: 2 },
            ],
          },
        ],
      }),
    );
    expect(text.rows.map(words)).toEqual([
      "type:need | NEED NEED need | extends - | Criteria criteria list of text · at most 3 counts to version | Single single text | statuses ",
      "type:system-requirement | System Requirement SYSTEMREQUIREMENT system-requirement | extends - | statuses ",
      "relation:derives-from | Derives from derives-from | any type → any type | → use-case: at most 1 | System Requirement → NEED: at least 1 | → NEED: 1 to 3 | → NEED: exactly 2",
    ]);
  });
});
