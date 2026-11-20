// The properties on an element's page (SR-232 AK1): every filled property as the element file holds it, in the
// order of the file, also one the metamodel does not know, by its name in the metamodel (else its key). Left out
// are those another part of the page shows: the identifier and the packages (fields), the acceptance criteria of a
// requirement (their own section). A Markdown property is formatted, also each item of a list (SR-231 AK5, AK6); a
// property of kind relation lists its targets as links; a list is a list; any other value is its text, and a value
// that is neither text, number, flag nor list is its JSON.
import type { DataExportElement } from "../generated/types.js";
import { markdownKeysOf } from "../metamodel/index.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { relationLink } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** Whether `value` is filled: not missing, empty text or an empty list. */
const filled = (value: unknown): boolean =>
  value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);

/** One value that is no Markdown as text. */
const textOf = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);

/** The keys another part of the page shows (see the file comment). */
const shownElsewhere = (context: ElementPageContext, page: ElementPage): ReadonlySet<string> =>
  new Set([
    ...context.metamodel.properties
      .filter((p) => p.meaning === "identifier" || p.meaning === "packages" || p.meaning === "title")
      .map((p) => p.key),
    ...(page.data.criteria === undefined ? [] : [page.data.criteria.property]),
  ]);

/** The value of property `key` as HTML. */
const valueHtml = async (
  context: ElementPageContext,
  page: ElementPage,
  element: DataExportElement,
  key: string,
  name: string,
  value: unknown,
): Promise<string> => {
  const property = context.metamodel.properties.find((p) => p.key === key);
  if (property?.kind === "relation") {
    const targets = element.relations.filter((r) => r.property === true && r.kind === key);
    return `<ul>${targets.map((r) => `<li>${relationLink(context.links, r)}</li>`).join("")}</ul>`;
  }
  const markdown = markdownKeysOf(context.metamodel).has(key);
  const one = async (item: unknown): Promise<string> => {
    const text =
      typeof item === "object" && item !== null && "text" in item && typeof item.text === "string"
        ? item.text
        : item;
    return markdown && typeof text === "string"
      ? page.markdown(text, name)
      : `<p>${escapeHtml(textOf(text))}</p>`;
  };
  if (!Array.isArray(value)) {
    return one(value);
  }
  const items: string[] = [];
  for (const item of value) {
    items.push(`<li>${await one(item)}</li>`);
  }
  return `<ul>${items.join("")}</ul>`;
};

/** The section of properties, or nothing when the element has none to show. */
export const propertiesSection = async (context: ElementPageContext, page: ElementPage): Promise<string> => {
  const { element } = page.data;
  const skipped = shownElsewhere(context, page);
  const rows: string[] = [];
  for (const [key, value] of Object.entries(element.properties)) {
    if (skipped.has(key) || !filled(value)) {
      continue;
    }
    const name = context.metamodel.properties.find((p) => p.key === key)?.name ?? key;
    rows.push(
      `<dt>${escapeHtml(name)}</dt><dd>${await valueHtml(context, page, element, key, name, value)}</dd>`,
    );
  }
  return rows.length === 0
    ? ""
    : `<section class="rq-properties"><h2 id="properties">Properties</h2><dl>${rows.join("")}</dl></section>`;
};
