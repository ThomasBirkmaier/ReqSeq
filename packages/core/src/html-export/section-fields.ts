// The list of fields at the top of an element's page (SR-232 AK1): type, identifier, short ID, status (without one
// "–") and packages; the repository when the workspace has more than one; for a requirement its verification status in
// the core and in each variant it applies in ("not in the core" when the core does not hold it), and for a need its
// validation status. Each row has a button that copies its value (`copyButton`), the text the row shows.
import type { DataExportElement } from "../generated/types.js";
import { findType, propertyWithMeaning } from "../metamodel/index.js";
import { copyButton } from "./copy-script.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { relationLink, relationText } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** One row: its label, its value as HTML, and the text the copy button copies. */
interface Row {
  readonly label: string;
  readonly html: string;
  readonly copy: string;
}

const NONE = "–";

const plain = (label: string, value: string): Row => ({ label, html: escapeHtml(value), copy: value });

type Verification = NonNullable<DataExportElement["verification"]>[number];

/** A verification status as the row shows it: the status, and the criteria counted from own records. */
const verificationText = (entry: Verification): string =>
  entry.criteria === undefined
    ? entry.status
    : `${entry.status}, ${String(entry.criteria.verified)} of ${String(entry.criteria.total)} criteria`;

/** The name of the view `view` (`core` or a variant's UUID), as rows and criteria name it. */
export const viewName = (context: ElementPageContext, view: string): string => {
  if (view === "core") {
    return "core";
  }
  const variant = context.store.byId.get(view)?.[0];
  if (variant === undefined) {
    return view;
  }
  const identifier = context.shortIds.identifierOf(variant);
  const shortId = context.shortIds.of(variant);
  return identifier === undefined ? shortId : `${shortId} (${identifier})`;
};

/** The rows of the verification status (see the file comment); none for an element that is no requirement. */
const verificationRows = (context: ElementPageContext, element: DataExportElement): Row[] => {
  if (element.verification === undefined) {
    return [];
  }
  const core = element.verification.find((entry) => entry.view === "core");
  return [
    plain("Verification status in the core", core === undefined ? "not in the core" : verificationText(core)),
    ...element.verification
      .filter((entry) => entry.view !== "core")
      .map((entry) =>
        plain(`Verification status in ${viewName(context, entry.view)}`, verificationText(entry)),
      ),
  ];
};

/** The packages of the element, each as a link to its page. */
const packagesRow = (context: ElementPageContext, element: DataExportElement): Row => {
  const key = propertyWithMeaning(context.metamodel, "packages")?.key;
  const packages = element.relations.filter((r) => r.property === true && r.kind === key);
  return packages.length === 0
    ? plain("Packages", NONE)
    : {
        label: "Packages",
        html: packages.map((r) => relationLink(context.links, r)).join(", "),
        copy: packages.map(relationText).join(", "),
      };
};

/** The list of fields (see the file comment). */
export const fieldsSection = (context: ElementPageContext, page: ElementPage): string => {
  const { element } = page.data;
  const rows: Row[] = [
    plain("Type", findType(context.metamodel, element.type)?.name ?? element.type),
    plain("Identifier", element.identifier ?? NONE),
    plain("Short ID", element.shortId),
    plain("Status", element.status ?? NONE),
    packagesRow(context, element),
    ...(context.layout.repositories.length > 1 ? [plain("Repository", element.repository)] : []),
    ...verificationRows(context, element),
    ...(element.validation === undefined ? [] : [plain("Validation status", element.validation)]),
  ];
  const html = rows
    .map(
      ({ label, html: value, copy }) =>
        `<dt>${escapeHtml(label)}</dt><dd class="rq-copyable"><span class="rq-value">${value}</span>${copyButton(copy, `Copy ${label}`)}</dd>`,
    )
    .join("");
  return `<dl class="rq-fields">${html}</dl>`;
};

/** The styles of the list of fields. */
export const FIELDS_CSS = [
  ".rq-fields { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 0.3rem 1.25rem; font-size: var(--sl-text-sm); align-items: center; }",
  ".sl-markdown-content .rq-fields dt { color: var(--sl-color-gray-3); margin: 0; font-weight: normal; }",
  ".sl-markdown-content .rq-fields dd { display: flex; align-items: center; gap: 0.4rem; margin: 0; min-height: 1.6rem; }",
];
