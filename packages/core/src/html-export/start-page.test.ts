// The start page of the HTML export (SR-233 AK3): the cases the export of the fixtures does not reach.
import { describe, expect, it } from "vitest";
import type { DataExportElement } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import type { ListEntry } from "./list-page.js";
import type { StartPageInput } from "./start-page.js";
import { startPageBody } from "./start-page.js";

const entry = (element: Partial<DataExportElement>, hints = 0): ListEntry => ({
  record: {} as ElementRecord,
  element: {
    id: "u1",
    shortId: "SR-aaaaaa",
    type: "sr",
    title: "One",
    repository: "r",
    ...element,
  } as DataExportElement,
  hints,
});

const input = (over: Partial<StartPageInput> = {}): StartPageInput => ({
  made: "no commit · exported 2026-11-20 with ReqSeq 1.0.0",
  missing: [],
  degree: { total: 0, counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 } },
  entries: [],
  overview: { types: [] },
  lists: [],
  baseline: undefined,
  ...over,
});

describe("start page (SR-233 AK3)", () => {
  it("[SR-233/AK-hqc9] names an empty workspace without degree share, lists or baseline", () => {
    const html = startPageBody(input());
    expect(html).toContain("<p>0 of 0 requirements in the core are verified or indirectly verified.</p>");
    expect(html).toContain('<h2 id="not-verified">Failed, outdated or open requirements</h2><p>None.</p>');
    expect(html).toContain('<h2 id="open-hints">Elements with open hints</h2><p>None.</p>');
    expect(html).toContain("<p>The workspace has no baseline.</p>");
    expect(html).toContain('<h2 id="types">Elements by type</h2><p>No elements.</p>');
    expect(html).not.toContain("rq-incomplete");
  });

  it("[SR-233/AK-hqc9] names several missing repositories, one verified requirement and a baseline without selection", () => {
    const html = startPageBody(
      input({
        missing: ["sensor", "display"],
        degree: { total: 1, share: 1, counts: { open: 0, verified: 1, indirect: 0, failed: 0, outdated: 0 } },
        entries: [
          entry({ identifier: "SR-1", verification: [{ view: "core", status: "verified" }] }, 2),
          entry({ id: "u2", title: "Two", verification: [{ view: "variant-1", status: "failed" }] }),
        ],
        baseline: {
          name: "R1",
          page: "baselines/r1.html",
          date: "2026-11-02T13:00:00Z",
          changed: 3,
          added: 0,
          selectionKnown: false,
        },
      }),
    );
    expect(html).toContain(
      "repository sensor, display are not on this machine, so their elements are missing.",
    );
    expect(html).toContain(
      "<p>1 of 1 requirement in the core is verified or indirectly verified (100 %).</p>",
    );
    // A requirement not in the core is not among those needing attention there.
    expect(html).toContain('<h2 id="not-verified">Failed, outdated or open requirements</h2><p>None.</p>');
    expect(html).toContain('<a href="elements/u1.html">SR-1</a></td><td>One</td><td>2</td>');
    expect(html).toContain(
      '<p>Since baseline <a href="baselines/r1.html">R1</a> of 2026-11-02: 3 changed, 0 added. The baseline stores no selection, so no element counts as added.</p>',
    );
  });
});
