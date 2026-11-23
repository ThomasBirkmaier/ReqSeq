// ADR-0019 Consequences: one display model, built once from a shared fixture of `fixtures/displays/`, and the HTML
// export shows each of its rows, groups and labels. The Electron app's test of the same fixture
// went with the app (#2310).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OverviewInput } from "../displays/index.js";
import { elementPageDisplay, overviewDisplay, verificationLabel } from "../displays/index.js";
import type { DataExportElement, MetamodelGetOutput } from "../generated/types.js";
import type { ElementPageContext } from "./element-page.js";
import { hintsSection } from "./section-hints.js";
import { relationsSection } from "./section-relations.js";
import type { ListPage } from "./list-page.js";
import { startPageBody } from "./start-page.js";

interface Shared {
  readonly metamodel: Pick<MetamodelGetOutput, "relations" | "properties" | "statuses">;
  readonly element: DataExportElement;
}

const SHARED = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/displays/element-page.json"), "utf8"),
) as Shared;

const OVERVIEW = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/displays/overview.json"), "utf8"),
) as OverviewInput;

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

  it("shows every type line of the overview model on the start page, linked to its list where it has one", () => {
    const display = overviewDisplay(OVERVIEW);
    const lists = display.types
      .filter(({ key }) => key !== "package")
      .map(({ target }): ListPage => ({
        type: target.list,
        path: `lists/${target.list}.html`,
        title: "",
        count: 0,
        body: "",
      }));
    const html = startPageBody({
      made: "",
      missing: [],
      degree: { total: 0, counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 } },
      entries: [],
      overview: display,
      lists,
      baseline: undefined,
    });
    expect(display.types.length).toBeGreaterThan(1);
    for (const { key, name, count, target } of display.types) {
      const label = key === "package" ? name : `<a href="lists/${target.list}.html">${name}</a>`;
      expect(html).toContain(`<tr><td>${label}</td><td>${String(count)}</td></tr>`);
    }
  });
});
