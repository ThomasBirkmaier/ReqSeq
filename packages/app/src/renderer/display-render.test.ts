// @vitest-environment happy-dom
// ADR-0019 Consequences: one display model, built from the shared fixture `fixtures/displays/element-page.json`, and
// the app shows each of its rows, groups and labels. The HTML export's test of the same fixture is
// `packages/core/src/html-export/display-render.test.ts`, so a drift between the two renderers fails one of them.
import fs from "node:fs";
import path from "node:path";
import type { DataExportElement, MetamodelGetOutput, TraceNeighbourhoodOutput } from "@reqseq/core";
import { NO_NAMES, elementPageDisplay, neighbourhoodDisplay, verificationLabel } from "@reqseq/core/displays";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { elementBuffer } from "./buffers.js";
import { container, render } from "./components.test-helper.js";
import { bufferView } from "./modeline.js";
import { incomingGroups, parentLevels, treeRows } from "./neighbourhood.js";
import { RelationGroups } from "./RelationLink.js";
import { variantLines } from "./variant-lines.js";

type Answer = Omit<TraceNeighbourhoodOutput, "answer" | "root" | "incomplete">;

interface Shared {
  readonly metamodel: Pick<MetamodelGetOutput, "relations" | "properties" | "statuses">;
  readonly element: DataExportElement;
  readonly neighbourhood: Record<"parents" | "children" | "incoming", Answer>;
}

const SHARED = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/displays/element-page.json"), "utf8"),
) as Shared;

/**
 * The model as the app builds it: without the names of the metamodel for now, so it heads the groups by their keys
 * and orders them as they first appear.
 */
const APP_METAMODEL = { ...NO_NAMES, statuses: SHARED.metamodel.statuses };

/** An answer of `trace.neighbourhood` as the app gets it. */
const answered = (answer: Answer): TraceNeighbourhoodOutput => ({
  ...answer,
  answer: "",
  root: SHARED.element.id,
  incomplete: false,
});

describe("the app renders the shared display models", () => {
  it("shows every relation group and relation, the verification badge and the count of hints of the element page model", async () => {
    const display = elementPageDisplay(
      { element: SHARED.element, metamodel: APP_METAMODEL },
      { relations: "all" },
    );
    await render(
      createElement(RelationGroups, {
        element: SHARED.element,
        onCopy: () => undefined,
        marked: new Set<string>(),
        onOpenRelation: () => undefined,
      }),
    );
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual(
      display.relationGroups.map((group) => group.label),
    );
    for (const relation of display.relationGroups.flatMap((group) => group.relations)) {
      expect(container.textContent).toContain(relation.title);
    }
    const badges = variantLines({ element: SHARED.element }).verification ?? [];
    expect(badges.map((badge) => badge.parts.map((part) => part.text).join(""))).toEqual(
      display.verification?.map((cell) => verificationLabel(cell, "long")),
    );
    // The status line counts the model's hints: one outdated relation, one other hint (SR-114 AK2).
    expect(display.hints).toHaveLength(2);
    expect(
      bufferView(elementBuffer(SHARED.element.id, "spec", "SR-000001"), {
        kind: "element",
        element: SHARED.element,
      }),
    ).toEqual(expect.arrayContaining(["1 outdated", "1 hint"]));
  });

  it("shows every parent, child and incoming group of the neighbourhood model", () => {
    const { parents, children, incoming } = SHARED.neighbourhood;
    const display = neighbourhoodDisplay(
      { ...SHARED.neighbourhood, metamodel: APP_METAMODEL },
      { bound: { parents: 200, children: 5000, incoming: 5000 }, open: [] },
    );
    const levels = parentLevels(answered(parents)).levels;
    expect(levels.map((level) => level.map((parent) => [parent.name, parent.outdated]))).toEqual(
      display.parents.rows.map((level) => level.map((parent) => [parent.ref.title, parent.outdated])),
    );
    expect(treeRows(answered(children), []).rows.map((row) => [row.row.title, row.level])).toEqual(
      display.children.rows.map((row) => [row.ref.title, row.level]),
    );
    const groups = incomingGroups(answered(incoming)).groups;
    expect(groups.map((group) => [group.heading, group.entries.map((entry) => entry.row.title)])).toEqual(
      display.incoming.rows.map((group) => [group.label, group.entries.map((entry) => entry.ref.title)]),
    );
  });
});
