// The baseline and variant parts of the HTML export (SR-232 AK7, SR-234 AK1, AK3, AK4) for what the fixture of
// commands/html/export-baselines.test.ts does not show: a version without date, an entry in a repository that is not
// here, the acceptance criteria of a field difference, a relation target the workspace does not have, no difference
// at all, and degrees of one requirement or of none.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { DataExportElement } from "../generated/types.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementContent, ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import { fieldDifference } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import type { ExportBaseline } from "./baselines.js";
import { baselinePageBody, rowElementOf } from "./baselines.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { pageLinks } from "./links.js";
import type { NeighbourhoodSource } from "./section-neighbourhood.js";
import { baselinesSection } from "./section-baselines.js";
import { degreeSentence, named, variantSection, variantsPageBody } from "./variants.js";

const A = "23400000-0000-4000-8000-0000000000a1";
const B = "23400000-0000-4000-8000-0000000000b1";
const C = "23400000-0000-4000-8000-0000000000c1";

const record = (id: string, data: Record<string, unknown>, repository = "system"): ElementRecord =>
  ({ id, type: "system-requirement", repository, file: "a.md", data }) as unknown as ElementRecord;

const CHANGED: ExportBaseline["elements"][number] = {
  id: B,
  repository: "system",
  state: "changed",
  version: "n2:0000000000000001",
  versionDate: null,
};

const BASELINE: ExportBaseline = {
  name: "R",
  file: "baselines/R.yaml",
  repository: "system",
  date: "2026-11-02T13:00:00Z",
  selectionKnown: true,
  repositories: [{ name: "system", commit: "c".repeat(40) }],
  elements: [CHANGED, { id: A, repository: "remote", state: "inaccessible", version: "n2:0000000000000002" }],
  counts: { unchanged: 0, changed: 1, superseded: 0, removed: 0, added: 0, missing: 0, inaccessible: 1 },
  total: 2,
};

const context = async (records: readonly ElementRecord[]): Promise<ElementPageContext> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return {
    metamodel: await workspace.get(metamodelState),
    store: { byId: new Map(records.map((r) => [r.id, [r]])) } as unknown as ElementStore,
    shortIds: {
      of: (r: ElementRecord) => `SR-${r.id.slice(-2)}`,
      identifierOf: (r: ElementRecord) => r.data["spec-id"],
    } as unknown as ShortIds,
    layout: { repositories: [] },
    links: pageLinks(new Set([B])),
    neighbourhood: {} as NeighbourhoodSource,
    members: new Map(),
  };
};

const page = (shown: ElementRecord, text: string): ElementPage => ({
  record: shown,
  data: { record: shown, element: {} as DataExportElement },
  text,
  markdown: (source) => Promise.resolve(source),
});

const plain = (html: string): string =>
  html
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

describe("baseline page (SR-234 AK1)", () => {
  it("[SR-234/AK-vjfq] sorts each group by identifier with digit runs as numbers, counts it, and sums the baseline up", () => {
    const names = new Map([
      ["u10", "SR-10"],
      ["u9", "sr-9"],
      ["u2", "N-2"],
      ["u9b", "SR-9"],
      ["u9c", "SR-9"],
    ]);
    const rows = ["u10", "u9", "u2", "u9b", "u9c"].map((id) => ({ ...CHANGED, id }));
    const body = plain(
      baselinePageBody(
        {
          ...BASELINE,
          selectionKnown: false,
          elements: rows,
          counts: { ...BASELINE.counts, changed: 5, superseded: 1, inaccessible: 0 },
          total: 5,
        },
        (row) => ({ name: String(names.get(row.id)), title: "", status: "–", href: undefined }),
      ),
    );
    expect(body).toMatch(
      /^5 elements in the baseline\. Since then 5 changed, 1 superseded\. .* Changed \(5\) Identifier Title Status Version in the baseline N-2 – .* SR-9 – .* SR-9 – .* sr-9 – .* SR-10 – /u,
    );
    expect(
      plain(
        baselinePageBody({ ...BASELINE, elements: [], total: 1 }, () => ({
          name: "",
          title: "",
          status: "",
          href: undefined,
        })),
      ),
    ).toMatch(/^1 element in the baseline\. Since then 1 changed, 0 added, 0 removed, 0 superseded\./u);
  });

  it("[SR-234/AK-vjfq] shows a version without date, and an entry in a repository that is not here", () => {
    const body = plain(
      baselinePageBody(BASELINE, () => ({ name: "SR-b1", title: "T", status: "draft", href: undefined })),
    );
    expect(body).toContain(
      "Changed (1) Identifier Title Status Version in the baseline SR-b1 T draft n2:0000000000000001 Added (0)",
    );
    expect(body).toContain(
      `Not in the workspace (1) UUID Repository Why ${A} remote repository not on this machine`,
    );
    // A row whose copy the store does not hold, and an element without status, by its UUID and "–".
    const named = rowElementOf({
      store: { byId: new Map([[B, [record(B, { title: 1 })]]]) },
      shortIds: { of: () => "SR-b1", identifierOf: () => undefined } as unknown as ShortIds,
      titleKey: "title",
      withPage: new Set(),
    });
    expect(named(CHANGED)).toEqual({ name: "SR-b1", title: "", status: "–", href: undefined });
    expect(named({ ...CHANGED, repository: "other" })).toEqual({
      name: B,
      title: "",
      status: "–",
      href: undefined,
    });
    expect(named({ ...CHANGED, id: A })).toMatchObject({ name: A });
  });
});

describe("change since a baseline on the element page (SR-232 AK7)", () => {
  it("[SR-232/AK-dywy] names changed, added and removed criteria, targets as they are now or by UUID, and no change", async () => {
    const now = record(B, {
      "spec-id": "SR-7",
      title: "B now",
      "acceptance-criteria": [
        { key: "k1aa", text: "New." },
        { key: "k3cc", text: "Added with key." },
        "Added without key.",
      ],
      refines: [{ id: A, version: "n2:1" }],
      "derives-from": [
        { id: B, repository: "system", title: "Stored title" },
        { id: C, title: "Twin elsewhere" },
      ],
    });
    // C is only in another repository: a relation without repository does not reach it.
    const ctx = await context([now, record(C, { title: "C now" }, "other")]);
    const old: ElementContent = {
      type: "system-requirement",
      data: {
        "acceptance-criteria": [
          { key: "k1aa", text: "Old." },
          { key: "k2bb", text: "Gone." },
        ],
        refines: [{ id: B }],
      },
      text: "Same.",
    };
    const since = (before: ElementContent) => () => [
      {
        baseline: BASELINE,
        row: CHANGED,
        difference: fieldDifference(ctx.metamodel, before, { type: now.type, data: now.data, text: "Same." }),
      },
    ];
    const html = plain(baselinesSection({ ...ctx, since: since(old) }, page(now, "Same.")));
    expect(html).toContain("R of 2026-11-02: changed; version in the baseline n2:0000000000000001");
    // One row per changed criterion, old and new wording as one word-level difference; the newest baseline open.
    const raw = baselinesSection({ ...ctx, since: since(old) }, page(now, "Same."));
    expect(raw).toContain('<p class="rq-since-line"><a href="../baselines/');
    expect(raw).toContain(
      '</p><details class="rq-since-baseline" open><summary>Difference since R</summary>',
    );
    expect(raw).toContain(
      '<dl class="rq-diff"><dt>Acceptance criterion AK1 (k1aa)</dt><dd><div class="rq-diff-text"><del>Old.</del><ins>New.</ins></div></dd>' +
        '<dt>Acceptance criterion AK2 (k2bb), removed</dt><dd><div class="rq-diff-text"><del>Gone.</del></div></dd>' +
        '<dt>Acceptance criterion AK2 (k3cc), added</dt><dd><div class="rq-diff-text"><ins>Added with key.</ins></div></dd>' +
        '<dt>Acceptance criterion AK3, added</dt><dd><div class="rq-diff-text"><ins>Added without key.</ins></div></dd>',
    );
    // A target the workspace does not have (or not in the element's repository) by its UUID; one it has by identifier
    // and title now (not the stored title), as a link to its page.
    expect(html).toContain("Relations removed Refines: SR-7 B now");
    expect(html).toContain(`Relations added Refines: ${A} Derives from: SR-7 B now Derives from: ${C}`);
    expect(html).not.toContain("Stored title");
    expect(baselinesSection(ctx, page(now, "Same."))).toBe("");
    expect(baselinesSection({ ...ctx, since: since(old) }, page(now, "Same."))).toContain(
      `<a href="../elements/${B}.html">SR-7 B now</a>`,
    );
    const same = { ...old, data: now.data };
    expect(plain(baselinesSection({ ...ctx, since: since(same) }, page(now, "Same.")))).toContain(
      "No change of text, acceptance criteria, properties or relations.",
    );
  });
});

describe("variants (SR-234 AK3, AK4)", () => {
  const one = { share: 1, total: 1, counts: { open: 0, verified: 1, indirect: 0, failed: 0, outdated: 0 } };
  const none = { total: 0, counts: { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 } };

  it("[SR-234/AK-k5g4] words a degree of one requirement and of none, and says when no status differs", () => {
    expect(degreeSentence(one)).toBe("1 of 1 requirement is verified or indirectly verified (100 %).");
    expect(degreeSentence(none)).toBe("0 of 0 requirements are verified or indirectly verified.");
    expect(plain(variantsPageBody(none, [], []))).toContain(
      "Requirements whose verification status differs None.",
    );
  });

  it("agrees the verb with the requirements, not with the verified ones (#2270)", () => {
    const third = {
      share: 1 / 3,
      total: 3,
      counts: { open: 2, verified: 0, indirect: 1, failed: 0, outdated: 0 },
    };
    expect(degreeSentence(third)).toBe("1 of 3 requirements are verified or indirectly verified (33.3 %).");
  });

  it("[SR-234/AK-gzpr] names an element without title by its short ID", async () => {
    const variant = record(A, {});
    const untitled = record(B, { title: 3 });
    const ctx = await context([variant, untitled]);
    const html = variantSection(
      {
        ...ctx,
        variants: new Map([[variant, { added: [untitled], replaced: [], excluded: [], degree: none }]]),
      },
      page(variant, ""),
    );
    expect(plain(html)).toContain("Adds SR-b1 Replaces None. Excludes None.");
  });

  it("names a package by its title once, and one without title by its identifier", async () => {
    const ctx = await context([]);
    const pkg = (title?: string): ElementRecord => ({
      ...record(C, { "spec-id": "Wind", ...(title === undefined ? {} : { title }) }),
      type: "package",
    });
    expect(named(ctx, pkg("Wind and weather"))).toBe("Wind and weather");
    expect(named(ctx, pkg())).toBe("Wind");
  });
});
