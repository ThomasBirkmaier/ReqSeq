// ADR-0019 Consequences: one display model, built once from the shared fixture `fixtures/displays/element-page.json`,
// and the HTML export shows each of its rows, groups and labels. The app's test of the same fixture is
// `packages/app/src/renderer/display-render.test.ts`, so a drift between the two renderers fails one of them.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NeighbourhoodAnswer } from "../displays/index.js";
import { elementPageDisplay, neighbourhoodDisplay, shownId, verificationLabel } from "../displays/index.js";
import type { DataExportElement, MetamodelGetOutput } from "../generated/types.js";
import type { ElementPageContext } from "./element-page.js";
import { hintsSection } from "./section-hints.js";
import { neighbourhoodHtml } from "./section-neighbourhood.js";
import { relationsSection } from "./section-relations.js";

interface Shared {
  readonly metamodel: Pick<MetamodelGetOutput, "relations" | "properties" | "statuses">;
  readonly element: DataExportElement;
  readonly neighbourhood: Record<"parents" | "children" | "incoming", NeighbourhoodAnswer>;
}

const SHARED = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/displays/element-page.json"), "utf8"),
) as Shared;

const context = {
  links: { href: (id: string) => `../elements/${id}.html` },
  layout: { repositories: [] },
  shortIds: {},
} as unknown as Pick<ElementPageContext, "links" | "layout" | "shortIds">;

describe("the HTML export renders the shared display models", () => {
  it("shows every relation group, relation and hint of the element page model", () => {
    const display = elementPageDisplay(
      { element: SHARED.element, metamodel: SHARED.metamodel },
      { relations: "outgoing" },
    );
    const html = relationsSection(context as ElementPageContext, display) + hintsSection(display);
    expect(display.relationGroups.length).toBeGreaterThan(1);
    for (const group of display.relationGroups) {
      expect(html).toContain(`<dt>${group.label}</dt>`);
      for (const relation of group.relations) {
        expect(html).toContain(relation.title ?? "");
      }
    }
    for (const hint of display.hints) {
      expect(html).toContain(`<li>${hint.message}</li>`);
    }
    // The fields section words the cells with the long form.
    expect(display.verification?.map((cell) => verificationLabel(cell, "long"))).toEqual([
      "open, 1 of 2 criteria, AK2 (k7f3) not verified",
    ]);
  });

  it("shows every parent, child and incoming group of the neighbourhood model", () => {
    const display = neighbourhoodDisplay(
      { ...SHARED.neighbourhood, metamodel: SHARED.metamodel },
      { bound: { parents: 100, children: 100, incoming: Number.POSITIVE_INFINITY }, open: "all" },
    );
    const html = neighbourhoodHtml(context, display, []);
    const refs = [
      ...display.parents.rows.flat(),
      ...display.children.rows,
      ...display.incoming.rows.flatMap((group) => group.entries),
    ];
    expect(refs).toHaveLength(4);
    for (const { ref } of refs) {
      expect(html).toContain(`<span>${shownId(ref.shortId, ref.identifier)}</span><span>${ref.title}`);
    }
    for (const group of display.incoming.rows) {
      expect(html).toContain(`<h3>${group.label}</h3>`);
    }
    expect(html).toContain("link outdated");
  });
});
