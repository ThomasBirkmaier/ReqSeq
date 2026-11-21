// ADR-0019 Consequences: one neighbourhood model, built from the shared fixture `fixtures/displays/neighbourhood.json`,
// and the app shows each of its rows and groups. The HTML export's test of the same fixture is
// `packages/core/src/html-export/neighbourhood-render.test.ts`, so a drift between the two renderers fails one of them.
import fs from "node:fs";
import path from "node:path";
import type { MetamodelGetOutput, TraceNeighbourhoodOutput } from "@reqseq/core";
import { NO_NAMES, neighbourhoodDisplay } from "@reqseq/core/displays";
import { describe, expect, it } from "vitest";
import { incomingGroups, parentLevels, treeRows } from "./neighbourhood.js";

type Answer = Omit<TraceNeighbourhoodOutput, "answer" | "root" | "incomplete">;

interface Shared {
  readonly metamodel: Pick<MetamodelGetOutput, "statuses">;
  readonly root: string;
  readonly neighbourhood: Record<"parents" | "children" | "incoming", Answer>;
}

const SHARED = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/displays/neighbourhood.json"), "utf8"),
) as Shared;

/** The model as the app builds it: without the names of the metamodel for now, so it heads the groups by their keys. */
const APP_METAMODEL = { ...NO_NAMES, statuses: SHARED.metamodel.statuses };

/** An answer of `trace.neighbourhood` as the app gets it. */
const answered = (answer: Answer): TraceNeighbourhoodOutput => ({
  ...answer,
  answer: "",
  root: SHARED.root,
  incomplete: false,
});

describe("the app renders the shared neighbourhood model", () => {
  it("shows every parent, child and incoming group of the model, the element's reference to itself too", () => {
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
    expect(groups.find((group) => group.heading === "← inline reference")?.entries).toHaveLength(2);
  });
});
