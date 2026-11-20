// The sections of an element's page and the names of linked elements (SR-232 AK1, AK2, SR-231 AK8) for what a
// workspace seldom shows: every state of a relation's other end, an unknown variant, a requirement in no view, values
// that are no text, and a short page without identifier, title or successor. The pages as a whole are tested in
// commands/html/export-element.test.ts.
import { describe, expect, it } from "vitest";
import type { DataExportElement, DataExportRelation } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { ElementData } from "./element-data.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { nameOf, pageLinks, relationLink, relationText } from "./links.js";
import { criteriaSection } from "./section-criteria.js";
import { viewName } from "./section-fields.js";
import type { NeighbourhoodSource } from "./section-neighbourhood.js";
import { propertiesSection } from "./section-properties.js";
import { stubPageBody } from "./stub-page.js";

const ID = "aaaa1111-1111-4111-8111-000000000001";

const relation = (more: Partial<DataExportRelation>): DataExportRelation => ({
  kind: "based-on",
  direction: "out",
  id: ID,
  accessible: false,
  targetState: "available",
  ...more,
});

const element = (more: Partial<DataExportElement> = {}): DataExportElement =>
  ({
    id: ID,
    shortId: "SR-000001",
    type: "system-requirement",
    version: "n2:0000000000000000",
    repository: "system",
    file: "a.md",
    properties: {},
    relations: [],
    problems: [],
    ...more,
  }) as DataExportElement;

const context = (metamodel: Partial<Metamodel> = {}): ElementPageContext => ({
  metamodel: { valid: true, properties: [], relations: [], ...metamodel } as unknown as Metamodel,
  store: { byId: new Map() } as unknown as ElementStore,
  shortIds: {} as ShortIds,
  layout: { repositories: [] },
  links: pageLinks(new Set([ID])),
  neighbourhood: {} as NeighbourhoodSource,
  members: new Map(),
});

const page = (data: Omit<ElementData, "record">): ElementPage => ({
  record: {} as ElementRecord,
  data: { record: {} as ElementRecord, ...data },
  text: "",
  markdown: (source) => Promise.resolve(`<p>md:${source}</p>`),
});

describe("links between pages (SR-231 AK3, SR-006 AK1)", () => {
  it("names the other end of a relation in each of its states and links it only when it has a page", () => {
    expect(relationLink(pageLinks(new Set([ID])), relation({ shortId: "SR-000001", title: "Wind" }))).toBe(
      `<a href="../elements/${ID}.html">SR-000001 Wind</a>`,
    );
    expect(relationLink(pageLinks(new Set()), relation({ identifier: "SR-1", shortId: "SR-000001" }))).toBe(
      "SR-1",
    );
    expect(relationText(relation({}))).toBe(ID);
    expect(
      relationText(relation({ targetState: "inaccessible", shortId: "UNKNOWN-000001", repository: "vault" })),
    ).toBe("UNKNOWN-000001, repository vault, not accessible");
    expect(relationText(relation({ targetState: "inaccessible" }))).toBe(
      `${ID}, repository , not accessible`,
    );
    expect(relationText(relation({ targetState: "missing" }))).toBe(`${ID}, not found`);
    expect(relationText(relation({ targetState: "ambiguous" }))).toBe(`${ID}, in several files`);
    expect(relationText(relation({ targetState: "unknown-repository", repository: "far" }))).toBe(
      `${ID}, repository far not in the workspace`,
    );
    expect(relationLink(pageLinks(new Set([ID])), relation({ targetState: "missing" }))).toBe(
      `${ID}, not found`,
    );
    expect(nameOf({ shortId: "SR-000001", title: "" })).toBe("SR-000001");
  });
});

describe("element page sections (SR-232 AK1, AK2)", () => {
  it("[SR-232/AK-cj5d] names a variant the store does not hold by its UUID, and shows values that are no text", async () => {
    expect(viewName(context(), "core")).toBe("core");
    expect(viewName(context(), ID)).toBe(ID);
    const variant = { id: ID } as ElementRecord;
    const named = (identifier?: string): ElementPageContext => ({
      ...context(),
      store: { byId: new Map([[ID, [variant]]]) } as unknown as ElementStore,
      shortIds: { of: () => "VAR-000001", identifierOf: () => identifier } as unknown as ShortIds,
    });
    expect(viewName(named(), ID)).toBe("VAR-000001");
    expect(viewName(named("VAR-1"), ID)).toBe("VAR-000001 (VAR-1)");
    const html = await propertiesSection(
      context({
        properties: [
          { key: "notes", name: "Notes", kind: "text", many: true },
          { key: "rationale", name: "Rationale", kind: "text", markdown: true },
        ] as unknown as Metamodel["properties"],
      }),
      page({
        element: element({
          properties: {
            notes: [{ key: "abcd", text: "A mapping." }, 3, true, { other: 1 }],
            rationale: [{ text: "Item." }],
            empty: [],
            none: null,
          },
        }),
      }),
    );
    expect(html).toBe(
      '<section class="rq-properties"><h2 id="properties">Properties</h2><dl><dt>Notes</dt><dd><ul><li><p>A mapping.</p></li><li><p>3</p></li><li><p>true</p></li><li><p>{&quot;other&quot;:1}</p></li></ul></dd><dt>Rationale</dt><dd><ul><li><p>md:Item.</p></li></ul></dd></dl></section>',
    );
    expect(await propertiesSection(context(), page({ element: element() }))).toBe("");
  });

  it("[SR-232/AK-zr5v] shows a criterion without status when the requirement is in no view", async () => {
    const criteria = { property: "ak", criteria: [{ criterion: 1, text: "Given." }] };
    const expected =
      '<section class="rq-criteria"><h2 id="acceptance-criteria">Acceptance criteria</h2><ol class="rq-criteria-list"><li><p class="rq-criterion rq-copyable"><strong>AK1</strong></p><p>md:Given.</p></li></ol></section>';
    const markdown = context({
      properties: [
        { key: "ak", name: "AK", kind: "text", many: true, markdown: true },
      ] as unknown as Metamodel["properties"],
    });
    expect(await criteriaSection(markdown, page({ element: element(), criteria }))).toBe(expected);
    expect(
      await criteriaSection(markdown, page({ element: element(), criteria, criterionStatuses: [] })),
    ).toBe(expected);
  });

  it("[SR-232/AK-zr5v] shows the core's status as a badge and names only the views whose status differs", async () => {
    const criteria = {
      property: "ak",
      criteria: [
        { criterion: 1, text: "Given." },
        { criterion: 2, text: "When." },
      ],
    };
    const criterionStatuses = [
      { view: "core", statuses: ["verified", "unknown"] },
      { view: ID, statuses: ["failed", "unknown"] },
    ] as unknown as NonNullable<ElementData["criterionStatuses"]>;
    const html = await criteriaSection(context(), page({ element: element(), criteria, criterionStatuses }));
    expect(html).toContain(
      `<strong>AK1</strong> <span class="rq-criterion-status" title="core: verified · ${ID}: failed"><span class="sl-badge success small astro-qnj5uuvn">verified</span> <span class="rq-legend">${ID}</span> <span class="sl-badge danger small astro-qnj5uuvn">failed</span></span>`,
    );
    // A status the export has no colour for: the default badge; the same in every view: the core's badge only.
    expect(html).toContain(
      `<strong>AK2</strong> <span class="rq-criterion-status" title="core: unknown · ${ID}: unknown"><span class="sl-badge default small astro-qnj5uuvn">unknown</span></span>`,
    );
  });

  it("[SR-232/AK-zr5v] shows a criterion as written when the property is no Markdown, and no section without criteria", async () => {
    const plain = context({
      properties: [{ key: "ak", name: "AK", kind: "text", many: true }] as unknown as Metamodel["properties"],
    });
    const criteria = { property: "ak", criteria: [{ criterion: 1, text: "Given *x* <b>." }] };
    expect(await criteriaSection(plain, page({ element: element(), criteria }))).toContain(
      "<strong>AK1</strong></p><p>Given *x* &lt;b&gt;.</p></li>",
    );
    expect(
      await criteriaSection(plain, page({ element: element(), criteria: { property: "ak", criteria: [] } })),
    ).toBe("");
  });
});

describe("short page (SR-231 AK8)", () => {
  it("[SR-231/AK-q4mj] gives – for an identifier and a title the element does not have", () => {
    expect(
      stubPageBody(context(), { record: {} as ElementRecord, element: element({ status: "obsolete" }) }),
    ).toBe(
      '<p class="rq-invalid">This element has an invalid status and no page of its own any more.</p><dl class="rq-fields"><dt>Identifier</dt><dd>–</dd><dt>Short ID</dt><dd>SR-000001</dd><dt>Title</dt><dd>–</dd><dt>Status</dt><dd>obsolete</dd></dl><p>It has no successor.</p>',
    );
  });
});
