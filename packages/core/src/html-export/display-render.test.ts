// ADR-0019 Consequences: one display model, built once from the shared fixture `fixtures/displays/element-page.json`,
// and the HTML export shows each of its groups and labels. The app's test of the same fixture is
// `packages/app/src/renderer/display-render.test.ts`, so a drift between the two renderers fails one of them.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { elementPageDisplay, verificationLabel } from "../displays/index.js";
import type { DataExportElement, MetamodelGetOutput } from "../generated/types.js";
import type { ElementPageContext } from "./element-page.js";
import { hintsSection } from "./section-hints.js";
import { relationsSection } from "./section-relations.js";

interface Shared {
  readonly metamodel: Pick<MetamodelGetOutput, "relations" | "properties" | "statuses">;
  readonly element: DataExportElement;
}

const SHARED = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/displays/element-page.json"), "utf8"),
) as Shared;

const context = {
  links: { href: (id: string) => `../elements/${id}.html` },
} as unknown as ElementPageContext;

describe("the HTML export renders the shared display model", () => {
  it("shows every relation group, relation and hint of the element page model", () => {
    const display = elementPageDisplay(
      { element: SHARED.element, metamodel: SHARED.metamodel },
      { relations: "outgoing" },
    );
    const html = relationsSection(context, display) + hintsSection(display);
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
});
