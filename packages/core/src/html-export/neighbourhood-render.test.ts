// ADR-0019 Consequences: one neighbourhood model, built from the shared fixture `fixtures/displays/neighbourhood.json`,
// and the HTML export shows each of its rows, groups and labels. The app's test of the same fixture is
// `packages/app/src/renderer/neighbourhood-render.test.ts`, so a drift between the two renderers fails one of them.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NeighbourhoodAnswer } from "../displays/index.js";
import { neighbourhoodDisplay, shownId } from "../displays/index.js";
import type { MetamodelGetOutput } from "../generated/types.js";
import type { ElementPageContext } from "./element-page.js";
import { neighbourhoodHtml } from "./section-neighbourhood.js";

interface Shared {
  readonly metamodel: Pick<MetamodelGetOutput, "relations" | "properties" | "statuses">;
  readonly neighbourhood: Record<"parents" | "children" | "incoming", NeighbourhoodAnswer>;
}

const SHARED = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/displays/neighbourhood.json"), "utf8"),
) as Shared;

const context = {
  links: { href: (id: string) => `../elements/${id}.html` },
  layout: { repositories: [] },
  shortIds: {},
} as unknown as Pick<ElementPageContext, "links" | "layout" | "shortIds">;

describe("the HTML export renders the shared neighbourhood model", () => {
  it("shows every parent, child and incoming group of the model, the element's reference to itself too", () => {
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
    expect(refs).toHaveLength(5);
    for (const { ref } of refs) {
      expect(html).toContain(`<span>${shownId(ref.shortId, ref.identifier)}</span><span>${ref.title}`);
    }
    for (const group of display.incoming.rows) {
      expect(html).toContain(`<h3>${group.label}</h3>`);
    }
    expect(html).toContain("link outdated");
  });
});
