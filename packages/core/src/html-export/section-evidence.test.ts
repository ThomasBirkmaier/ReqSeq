// The lines of the evidence records at a criterion (SR-232 AK3) for what the workspace tests of
// commands/html/export-evidence.test.ts do not show: a JUnit test case named by class name and name, and two records
// of one execution in one view when another view's result differs.
import { describe, expect, it } from "vitest";
import type { EvidenceRecord } from "../evidence/index.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { pageLinks } from "./links.js";
import type { NeighbourhoodSource } from "./section-neighbourhood.js";
import { criterionEvidence } from "./section-evidence.js";

const context: ElementPageContext = {
  metamodel: {} as Metamodel,
  store: { byId: new Map() } as unknown as ElementStore,
  shortIds: {} as ShortIds,
  layout: { repositories: [] },
  links: pageLinks(new Set()),
  neighbourhood: {} as NeighbourhoodSource,
  members: new Map(),
};

const at = (result: EvidenceRecord["result"], variant?: string): EvidenceRecord => ({
  element: "e",
  version: "n2:0000000000000000",
  kind: "verification",
  method: "test",
  item: "build",
  result,
  date: "2026-11-02",
  testCase: "shows wind",
  className: "station",
  ...(variant === undefined ? {} : { variant }),
});

const page = (records: EvidenceRecord[], views: string[]): ElementPage => ({
  record: {} as ElementRecord,
  text: "",
  markdown: () => Promise.resolve(""),
  data: {
    record: {} as ElementRecord,
    element: {} as ElementPage["data"]["element"],
    evidence: {
      records,
      rows: [
        {
          kind: "verification",
          criterion: 1,
          status: "failed",
          views: [],
          cases: [
            {
              testCase: "shows wind",
              className: "station",
              result: "failed",
              views,
              records: records.map((_, i) => i),
            },
          ],
        },
      ],
    },
  },
});

describe("evidence records at a criterion (SR-232 AK3)", () => {
  it("[SR-232/AK-z2fm] names a JUnit test case by class name and name, and gives one line per view and execution when results differ, the core first", () => {
    // One other result in a variant, listed first, then two records of one execution in the core (two result files):
    // the core's line comes first.
    const html = criterionEvidence(
      context,
      page([at("failed", "v"), at("passed"), at("passed")], ["core", "v"]),
      1,
    );
    expect(html).toBe(
      '<details class="rq-evidence"><summary>Evidence records (2)</summary><ul>' +
        '<li><code dir="auto">station &gt; shows wind</code> <span class="rq-legend">test · passed · 2026-11-02 · core</span></li>' +
        '<li><code dir="auto">station &gt; shows wind</code> <span class="rq-legend">test · failed · 2026-11-02 · v</span></li></ul></details>',
    );
  });
});
