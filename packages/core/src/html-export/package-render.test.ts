// ADR-0019 Consequences: one package page model, and the HTML export shows each of its columns, rows and cells. The
// app does not render package pages from the model yet, so this is the export's side only. The pages as a whole are
// tested in commands/html/export-lists.test.ts (SR-233 AK4).
import { describe, expect, it } from "vitest";
import { NO_MEMBERS, packageDisplay, targetKey } from "../displays/index.js";
import type { DataExportElement } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import type { ListEntry } from "./list-page.js";
import { listMetamodelOf, listRowOf } from "./list-page.js";
import { packageSection } from "./section-package.js";

const metamodel = {
  effectiveTypes: [{ key: "pkg", name: "Package", meaning: "package", properties: [] }],
  properties: [],
  statuses: [{ key: "draft", name: "Draft" }],
} as unknown as Metamodel;

const PACKAGE = { id: "p1", repository: "r" };

const entry = (id: string, element: Partial<DataExportElement>): ListEntry => ({
  record: {} as ElementRecord,
  element: {
    id,
    shortId: `SR-${id}`,
    type: "req",
    title: `Title <${id}>`,
    repository: "r",
    file: `${id}.md`,
    relations: [],
    properties: {},
    ...element,
  },
  hints: 0,
});

const section = (members: ReadonlyMap<string, readonly ListEntry[]>, record = PACKAGE): string =>
  packageSection(
    { metamodel, members } as unknown as ElementPageContext,
    {
      record: record as unknown as ElementRecord,
    } as unknown as ElementPage,
  );

describe("the HTML export renders the package page model", () => {
  it("shows every column, row and cell of the model", () => {
    const entries = [
      entry("1", {
        identifier: "REQ-1",
        status: "draft",
        verification: [{ view: "core", status: "failed", criteria: { verified: 0, total: 1 } }],
      }),
      entry("2", {}),
    ];
    const model = packageDisplay(
      { package: PACKAGE, rows: entries.map(listRowOf), metamodel: listMetamodelOf(metamodel) },
      { id: "identifier", invalid: "omit" },
    );
    const html = section(new Map([[targetKey(PACKAGE), entries]]));
    for (const column of model.columns) {
      expect(html).toContain(`<th scope="col">${column.label}</th>`);
    }
    expect(html).toMatch(
      new RegExp(
        [
          '^<section class="rq-package"><h2 id="elements">Elements</h2><table tabindex="0"><thead><tr>',
          '<th scope="col">Identifier</th><th scope="col">Title</th><th scope="col">Status</th>',
          '<th scope="col">Verification status in the core</th></tr></thead><tbody>',
          '<tr><td class="rq-nowrap"><a href="../elements/1.html">REQ-1</a></td><td class="rq-title">Title &lt;1&gt;</td>',
          '<td class="rq-nowrap">draft</td><td class="rq-nowrap"><span class="sl-badge danger small [^"]*">failed</span></td></tr>',
          '<tr><td class="rq-nowrap"><a href="../elements/2.html">SR-2</a></td><td class="rq-title">Title &lt;2&gt;</td>',
          '<td class="rq-nowrap">–</td><td class="rq-nowrap">–</td></tr></tbody></table></section>$',
        ].join(""),
        "u",
      ),
    );
  });

  it("says that no element names a package without members, and shows nothing for an element that is no package", () => {
    expect(section(new Map([[targetKey(PACKAGE), []]]))).toBe(
      `<section class="rq-package"><h2 id="elements">Elements</h2><p>${NO_MEMBERS}</p></section>`,
    );
    expect(section(new Map())).toBe("");
  });
});
