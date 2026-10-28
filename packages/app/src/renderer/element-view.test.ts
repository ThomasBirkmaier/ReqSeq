import type { DataExportElement, DataExportRelation } from "@logreq/core";
import { describe, expect, it } from "vitest";
import type { ElementLoad } from "./element-view.js";
import {
  isPropertyTarget,
  isReadOnly,
  outdatedParent,
  outdatedReferences,
  outdatedRelation,
  outdatedWord,
  propertyBoxes,
  propertyLines,
  propertyModel,
  relationGroups,
  relationLabel,
  rowOfRelation,
  shownElement,
  undatedHints,
  withHintDates,
} from "./element-view.js";

/** The mark of an outdated reference whose dates the buffer does not have yet. */
const undatedMark = (message: string) => ({ message, word: "outdated" });

const relation = (extra: Partial<DataExportRelation>): DataExportRelation => ({
  kind: "derives-from",
  direction: "out",
  id: "u",
  accessible: true,
  targetState: "available",
  ...extra,
});

describe("propertyLines", () => {
  it("gives one line per item, a title for an object, and nothing for an empty value", () => {
    expect(propertyLines("quality")).toEqual(["quality"]);
    expect(propertyLines(["a", "b"])).toEqual(["a", "b"]);
    expect(propertyLines(3)).toEqual(["3"]);
    expect(propertyLines(false)).toEqual(["false"]);
    expect(propertyLines([{ id: "x", title: "Stufe 3" }, { id: "y", title: "" }, [], "  ", ""])).toEqual([
      "Stufe 3",
      '{"id":"y","title":""}',
    ]);
    expect(propertyLines({ a: 1 })).toEqual(['{"a":1}']);
    expect(propertyLines({})).toEqual([]);
    expect(propertyLines(null)).toEqual([]);
    expect(propertyLines(undefined)).toEqual([]);
  });
});

describe("propertyBoxes", () => {
  it("[SR-104/AK1] leaves out empty properties and has a box with its targets for a relation property", () => {
    const stage = relation({ kind: "packages", property: true, id: "p", shortId: "PKG-1", title: "Stufe 3" });
    const element = {
      properties: {
        topic: "Wind",
        empty: "",
        list: [],
        packages: [{ id: "p", title: "Stufe 3" }],
        validity: [],
        n: 2,
      },
      relations: [stage, relation({ kind: "topic" })],
    } as unknown as DataExportElement;
    expect(propertyBoxes(element)).toEqual([
      { key: "topic", lines: ["Wind"] },
      { key: "packages", lines: ["PKG-1 Stufe 3"], relations: [stage] },
      { key: "n", lines: ["2"] },
    ]);
  });

  it("takes only outgoing property targets as the targets of a box", () => {
    const incoming = relation({ kind: "packages", property: true, direction: "in", id: "m" });
    const element = {
      properties: { packages: [] },
      relations: [incoming],
    } as unknown as DataExportElement;
    expect(propertyBoxes(element)).toEqual([]);
    expect(isPropertyTarget(incoming)).toBe(false);
    expect(isPropertyTarget(relation({ property: true }))).toBe(true);
    expect(isPropertyTarget(relation({}))).toBe(false);
  });
});

describe("relationGroups", () => {
  it("groups by kind and direction in the order of first appearance", () => {
    const groups = relationGroups([
      relation({ id: "1" }),
      relation({ id: "2", direction: "in" }),
      relation({ id: "3" }),
      relation({ id: "4", kind: "references" }),
    ]);
    expect(groups.map((group) => [group.heading, group.relations.map((r) => r.id)])).toEqual([
      ["derives-from", ["1", "3"]],
      ["← derives-from", ["2"]],
      ["references", ["4"]],
    ]);
    expect(relationGroups([])).toEqual([]);
  });

  it("[SR-104/AK1] leaves out the targets of a relation property, which are boxes, and keeps the incoming ones", () => {
    const groups = relationGroups([
      relation({ id: "1", kind: "packages", property: true }),
      relation({ id: "2", kind: "packages", property: true, direction: "in" }),
      relation({ id: "3" }),
    ]);
    expect(groups.map((group) => [group.heading, group.relations.map((r) => r.id)])).toEqual([
      ["← packages", ["2"]],
      ["derives-from", ["3"]],
    ]);
  });
});

describe("outdatedReferences", () => {
  const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
  const hint = (extra: object) => ({
    code: "relation.outdated",
    severity: "warning",
    message: "points to an older version",
    targetId: TARGET,
    storedVersion: "n1:aa",
    hintId: `relation.outdated/spec/f.md/src/@text/${TARGET}?version=n1:aa&n=1`,
    ...extra,
  });
  const of = (problems: object[] | undefined) =>
    outdatedReferences({ problems } as unknown as DataExportElement);

  it("keeps the outdated inline references by target, stored version and repository, with their message", () => {
    expect(
      of([
        hint({}),
        hint({
          hintId: `relation.outdated/spec/f.md/src/@text/${TARGET}?version=n1:aa&repository=other%20repo&n=1`,
          message: "other",
        }),
      ]),
    ).toEqual(
      new Map([
        [`${TARGET} n1:aa `, undatedMark("points to an older version")],
        [`${TARGET} n1:aa other%20repo`, undatedMark("other")],
      ]),
    );
  });

  it("the first message of a reference wins", () => {
    expect(
      of([
        hint({}),
        hint({
          message: "second",
          hintId: `relation.outdated/spec/f.md/src/@text/${TARGET}?version=n1:aa&n=2`,
        }),
      ]),
    ).toEqual(new Map([[`${TARGET} n1:aa `, undatedMark("points to an older version")]]));
  });

  it("leaves out other hints, relation hints, hints without target or version, and elements without hints", () => {
    expect(
      of([
        hint({ code: "relation.missing" }),
        hint({ hintId: `relation.outdated/spec/f.md/src/derives-from/${TARGET}?version=n1:aa` }),
        hint({ hintId: undefined }),
        hint({ targetId: undefined }),
        hint({ storedVersion: undefined }),
      ]).size,
    ).toBe(0);
    expect(of(undefined).size).toBe(0);
  });
});

describe("relationLabel", () => {
  it("is the identifier, else the short ID, else the UUID, then the title when there is one", () => {
    expect(relationLabel(relation({ identifier: "N-1", shortId: "N-000001", title: "Need" }))).toBe(
      "N-1 Need",
    );
    expect(relationLabel(relation({ shortId: "N-000001", title: "Need" }))).toBe("N-000001 Need");
    expect(relationLabel(relation({ shortId: "N-000001" }))).toBe("N-000001");
    expect(relationLabel(relation({ id: "uuid-9" }))).toBe("uuid-9");
  });
});

describe("rowOfRelation", () => {
  const plain = { repository: "spec", problems: [] };
  it("is the label, the target and the state of a relation as the buffer shows it", () => {
    expect(
      rowOfRelation(relation({ id: "n1", repository: "spec", shortId: "N-1", title: "Need" }), plain),
    ).toEqual({ id: "n1", repository: "spec", label: "N-1 Need", state: "available", outdated: undefined });
    expect(rowOfRelation(relation({ id: "n2", targetState: "missing" }), plain)).toEqual({
      id: "n2",
      repository: "",
      label: "n2",
      state: "missing",
      outdated: undefined,
    });
  });
});

describe("propertyModel", () => {
  const property = (key: string, extra: object = {}) => ({ key, name: key, kind: "text", ...extra });

  it("[SR-127/AK5] gives, per type, kind, list and markdown of each property of the type, as the metamodel says", () => {
    const model = propertyModel({
      properties: [
        property("title", { meaning: "title" }),
        property("acceptance-criteria", { markdown: true, many: true }),
        property("rationale", { markdown: true }),
        property("topic", { markdown: false }),
        property("effort", { kind: "number" }),
        property("note"),
      ],
      types: [
        { key: "requirement", properties: ["title", "acceptance-criteria", "topic", "effort", "gone"] },
        { key: "system-requirement", properties: ["title", "acceptance-criteria", "rationale", "note"] },
        { key: "glossary-term", properties: [] },
      ],
    } as unknown as Parameters<typeof propertyModel>[0]);
    expect(model).toEqual(
      new Map([
        [
          "requirement",
          new Map([
            ["title", { name: "title", kind: "text", many: false, markdown: false, meaning: "title" }],
            [
              "acceptance-criteria",
              { name: "acceptance-criteria", kind: "text", many: true, markdown: true },
            ],
            ["topic", { name: "topic", kind: "text", many: false, markdown: false }],
            ["effort", { name: "effort", kind: "number", many: false, markdown: false }],
          ]),
        ],
        [
          "system-requirement",
          new Map([
            ["title", { name: "title", kind: "text", many: false, markdown: false, meaning: "title" }],
            [
              "acceptance-criteria",
              { name: "acceptance-criteria", kind: "text", many: true, markdown: true },
            ],
            ["rationale", { name: "rationale", kind: "text", many: false, markdown: true }],
            ["note", { name: "note", kind: "text", many: false, markdown: false }],
          ]),
        ],
        ["glossary-term", new Map()],
      ]),
    );
  });
});

describe("propertyModel for choices and relations (SR-104)", () => {
  it("[SR-104/AK3] gives the choices in the order of the metamodel, the target types and the display name", () => {
    const model = propertyModel({
      properties: [
        {
          key: "verification-method",
          name: "Verification Method",
          kind: "choice",
          choices: [
            { key: "test", name: "Test", description: "x" },
            { key: "analysis", name: "Analysis" },
          ],
          meaning: "verification-method",
        },
        { key: "packages", name: "Package", kind: "relation", many: true, "target-types": ["package"] },
      ],
      types: [{ key: "sr", properties: ["verification-method", "packages"] }],
    } as unknown as Parameters<typeof propertyModel>[0]);
    expect(model.get("sr")).toEqual(
      new Map([
        [
          "verification-method",
          {
            name: "Verification Method",
            kind: "choice",
            many: false,
            markdown: false,
            choices: [
              { key: "test", name: "Test" },
              { key: "analysis", name: "Analysis" },
            ],
            meaning: "verification-method",
          },
        ],
        [
          "packages",
          { name: "Package", kind: "relation", many: true, markdown: false, targetTypes: ["package"] },
        ],
      ]),
    );
  });
});

describe("outdatedReferences in a property (SR-127)", () => {
  const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
  const hint = (place: string, message: string) => ({
    code: "relation.outdated",
    severity: "warning",
    message,
    targetId: TARGET,
    storedVersion: "n1:aa",
    hintId: `relation.outdated/spec/f.md/src/${place}/${TARGET}?version=n1:aa&n=1`,
  });
  const element = {
    problems: [
      hint("@text", "in the text"),
      hint("@text:acceptance-criteria", "in the criteria"),
      hint("@text:rationale", "in the rationale"),
    ],
  } as unknown as DataExportElement;

  it("[SR-127/AK3] keeps the hints of the text and of each property apart", () => {
    const key = `${TARGET} n1:aa `;
    expect(outdatedReferences(element)).toEqual(new Map([[key, undatedMark("in the text")]]));
    expect(outdatedReferences(element, "acceptance-criteria")).toEqual(
      new Map([[key, undatedMark("in the criteria")]]),
    );
    expect(outdatedReferences(element, "rationale")).toEqual(
      new Map([[key, undatedMark("in the rationale")]]),
    );
    expect(outdatedReferences(element, "topic").size).toBe(0);
  });
});

describe("the version at an outdated reference (#702, #665)", () => {
  const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
  const SOURCE = "relation.outdated/spec/f.md/26a0b000-0000-4000-8000-0000000000b1";
  const STORED = "stored version from 2026-03-04T10:00:00Z, current version from 2026-05-06T08:00:00Z";
  const hint = (place: string, extra: object = {}) => ({
    code: "relation.outdated" as const,
    severity: "warning" as const,
    message: `${place} points to an older version`,
    targetId: TARGET,
    storedVersion: "n1:aa",
    currentVersion: "n1:bb",
    hintId: `${SOURCE}/${place}/${TARGET}?version=n1:aa`,
    ...extra,
  });
  const dated = (
    undatedHint: ReturnType<typeof hint>,
    storedDate: string | null = "2026-03-04T10:00:00Z",
  ) => ({
    ...undatedHint,
    message: `${undatedHint.message}: ${STORED}`,
    storedDate,
    currentDate: "2026-05-06T08:00:00Z",
  });
  const elementOf = (problems: object[], relations: DataExportRelation[] = []): DataExportElement =>
    ({ repository: "spec", problems, relations }) as unknown as DataExportElement;

  it("[SR-110/AK2] the word names the date of the version the reference stores once the hint has it (D-013)", () => {
    const text = hint("@text", { hintId: `${SOURCE}/@text/${TARGET}?version=n1:aa&n=1` });
    expect(outdatedWord(text)).toBe("outdated");
    expect(outdatedWord(dated(text))).toBe("outdated · version of 2026-03-04");
    // No commit has the version, or Git cannot tell: as "Show element ID and version" says it.
    expect(outdatedWord(dated(text, null))).toBe("outdated · version of unknown date");
  });

  it("[SR-110/AK2] an inline reference in the text and in a Markdown property carries the dated hint", () => {
    const text = hint("@text", { hintId: `${SOURCE}/@text/${TARGET}?version=n1:aa&n=1` });
    const criterion = hint("@text:acceptance-criteria", {
      hintId: `${SOURCE}/@text:acceptance-criteria/${TARGET}?version=n1:aa&n=1`,
    });
    const element = withHintDates(elementOf([text, criterion]), [dated(text), dated(criterion)]);
    expect(outdatedReferences(element)).toEqual(
      new Map([
        [
          `${TARGET} n1:aa `,
          { message: `${text.message}: ${STORED}`, word: "outdated · version of 2026-03-04" },
        ],
      ]),
    );
    expect(outdatedReferences(element, "acceptance-criteria").get(`${TARGET} n1:aa `)?.word).toBe(
      "outdated · version of 2026-03-04",
    );
  });

  it("knows which outdated hints still lack their dates, and none for an element without", () => {
    const text = hint("@text", { hintId: `${SOURCE}/@text/${TARGET}?version=n1:aa&n=1` });
    const other = { code: "relation.missing", severity: "warning", message: "missing" };
    expect(undatedHints(elementOf([]))).toBe("");
    expect(undatedHints({ repository: "spec" } as unknown as DataExportElement)).toBe("");
    expect(undatedHints(elementOf([other, dated(text)]))).toBe("");
    expect(undatedHints(elementOf([text, hint("derives-from")]))).toBe(
      `${text.hintId} n1:bb\n${SOURCE}/derives-from/${TARGET}?version=n1:aa n1:bb`,
    );
    expect(undatedHints(elementOf([{ ...text, hintId: undefined, currentVersion: undefined }]))).toBe(" ");
  });

  it("takes a dated hint only for the same hint ID and current version, and leaves the rest as it is", () => {
    const relationHint = hint("derives-from");
    const other = { code: "relation.missing", severity: "warning", message: "missing" };
    const element = elementOf([relationHint, other]);
    expect(withHintDates(element, [])).toBe(element);
    expect(withHintDates(element, [relationHint])).toBe(element);
    expect(
      withHintDates({ repository: "spec" } as unknown as DataExportElement, [dated(relationHint)]),
    ).toEqual({
      repository: "spec",
    });
    // The target changed again since the dates were asked: the hint keeps its undated form.
    expect(withHintDates(element, [dated({ ...relationHint, currentVersion: "n1:cc" })]).problems).toEqual([
      relationHint,
      other,
    ]);
    expect(withHintDates(element, [dated(relationHint)]).problems).toEqual([dated(relationHint), other]);
    // A hint that has its dates already stays.
    const done = elementOf([dated(relationHint, null)]);
    expect(withHintDates(done, [dated(relationHint)]).problems).toEqual([dated(relationHint, null)]);
  });

  it("[SR-110/AK2] marks an outgoing relation item that a hint names, with the date of its stored version", () => {
    const stored = relation({ kind: "derives-from", id: TARGET, storedVersion: "n1:aa", repository: "spec" });
    const element = elementOf([dated(hint("derives-from"))]);
    expect(outdatedRelation(element, stored)).toEqual({
      message: `derives-from points to an older version: ${STORED}`,
      word: "outdated · version of 2026-03-04",
    });
    expect(rowOfRelation(stored, element).outdated?.word).toBe("outdated · version of 2026-03-04");
    // Without a repository on the relation it is the element's own.
    const { repository: _named, ...unnamed } = stored;
    expect(outdatedRelation(element, unnamed)).toBeDefined();
  });

  it("marks no relation that the hint does not name: kind, target, stored version, repository, direction", () => {
    const stored = relation({ kind: "derives-from", id: TARGET, storedVersion: "n1:aa", repository: "spec" });
    const element = elementOf([
      hint("derives-from"),
      hint("@text", { hintId: `${SOURCE}/@text/${TARGET}?version=n1:aa&n=1` }),
      hint("derives-from", { hintId: undefined }),
      { code: "relation.missing", severity: "warning", message: "missing" },
    ]);
    expect(outdatedRelation(element, stored)?.word).toBe("outdated");
    expect(outdatedRelation(element, { ...stored, kind: "refines" })).toBeUndefined();
    expect(outdatedRelation(element, { ...stored, id: "other" })).toBeUndefined();
    expect(outdatedRelation(element, { ...stored, storedVersion: "n1:cc" })).toBeUndefined();
    expect(outdatedRelation(element, { ...stored, repository: "sensor" })).toBeUndefined();
    expect(outdatedRelation(element, { ...stored, direction: "in" })).toBeUndefined();
    expect(outdatedRelation({ repository: "spec" }, stored)).toBeUndefined();
    // A hint that names the repository of its target (D-058).
    const across = elementOf([
      hint("derives-from", {
        hintId: `${SOURCE}/derives-from/${TARGET}?version=n1:aa&repository=sensor%20one`,
      }),
    ]);
    expect(outdatedRelation(across, { ...stored, repository: "sensor one" })?.word).toBe("outdated");
    expect(outdatedRelation(across, stored)).toBeUndefined();
  });

  it("[SR-110/AK2] the parents line takes the mark of the element's own derivation to the parent", () => {
    const derivation = relation({
      kind: "derives-from",
      meaning: "derivation",
      id: TARGET,
      storedVersion: "n1:aa",
    });
    const element = elementOf(
      [dated(hint("derives-from"))],
      [relation({ kind: "refines", meaning: "derivation", id: TARGET, storedVersion: "n1:zz" }), derivation],
    );
    expect(outdatedParent(element, TARGET, "spec")?.word).toBe("outdated · version of 2026-03-04");
    expect(outdatedParent(element, TARGET, "sensor")).toBeUndefined();
    expect(outdatedParent(element, "other", "spec")).toBeUndefined();
    expect(
      outdatedParent(
        elementOf([dated(hint("derives-from"))], [{ ...derivation, meaning: null }]),
        TARGET,
        "spec",
      ),
    ).toBeUndefined();
  });
});

describe("the load of an element buffer", () => {
  const element = { shortId: "SR-036", readOnly: true } as unknown as DataExportElement;
  const loaded: ElementLoad = { status: "ok", element };

  it("shows the element once it is loaded and its parents line has answered", () => {
    expect(shownElement(loaded, true)).toBe(element);
    expect(shownElement(loaded, false)).toBeUndefined();
    expect(shownElement({ status: "loading" }, true)).toBeUndefined();
  });

  it("is read-only when the loaded element is", () => {
    expect(isReadOnly(loaded)).toBe(true);
    expect(isReadOnly({ status: "ok", element: { ...element, readOnly: false } })).toBe(false);
    expect(isReadOnly({ status: "ok", element: { shortId: "SR-036" } as unknown as DataExportElement })).toBe(
      false,
    );
    expect(isReadOnly({ status: "error", message: "gone" })).toBe(false);
  });
});
