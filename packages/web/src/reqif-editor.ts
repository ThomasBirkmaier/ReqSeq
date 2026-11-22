// The choices of the ReqIF mapping on the import page: one select per type, attribute, relation type and value of
// the file that `reqif.analyze` lists as unmapped, filled from the metamodel (`reqif-mapping.ts`). The page saves
// what is chosen with `reqif.saveMapping`; a part without a choice stays unmapped.
import type { Child } from "./dom.js";
import { h } from "./dom.js";
import type { Metamodel } from "./meaning.js";
import type { Choice, Choices, Mapping, Option, Unmapped } from "./reqif-mapping.js";
import {
  NONE,
  OMIT,
  attributeId,
  attributeOptions,
  choiceOf,
  chosenIn,
  groupsOf,
  guess,
  mappedProperty,
  mappedType,
  relationOptions,
  typeOptions,
  valueId,
  valueOptions,
  valueOf,
} from "./reqif-mapping.js";

let selects = 0;

/**
 * A select labelled `label` with no choice, `options` and leave out; `before` (what the mapping says already) is
 * chosen, else the guess for `source`.
 */
function select(
  label: string,
  options: readonly Option[],
  source: string,
  before?: Choice,
): { readonly box: HTMLElement; readonly input: HTMLSelectElement } {
  selects += 1;
  const id = `rm-${String(selects)}`;
  const input = h("select", { id, name: id });
  fill(
    input,
    options,
    before === undefined ? guess(options, source)?.key : "to" in before ? before.to : undefined,
  );
  if (before !== undefined && "omit" in before) {
    input.value = OMIT;
  }
  return {
    input,
    box: h("div", { class: "rmrow" }, h("label", { for: id }, label), input),
  };
}

/** Puts no choice, `options` and leave out into `input`, with `chosen` (a key) selected. */
function fill(input: HTMLSelectElement, options: readonly Option[], chosen: string | undefined): void {
  input.replaceChildren(
    h("option", { value: NONE }, "Not chosen"),
    ...options.map((o) => h("option", { value: valueOf(o.key), selected: o.key === chosen }, o.name)),
    h("option", { value: OMIT }, "Leave out"),
  );
  if (chosen === undefined) {
    input.value = NONE;
  }
}

const group = (legend: string, ...rows: Child[]): HTMLElement =>
  h("fieldset", { class: "rmgroup" }, h("legend", null, legend), rows);

/** The fields of the mapping for `unmapped`, and the choices made in them. */
export function mappingFields(
  mm: Metamodel,
  unmapped: readonly Unmapped[],
  built: Mapping | undefined,
): { readonly fields: HTMLElement[]; readonly choices: () => Choices } {
  const groups = groupsOf(unmapped);
  const chosen = chosenIn(built);
  const types = new Map<string, HTMLSelectElement>();
  const attributes = new Map<string, HTMLSelectElement>();
  const relations = new Map<string, HTMLSelectElement>();
  const values = new Map<string, HTMLSelectElement>();
  const fields: HTMLElement[] = [];

  for (const t of groups.types) {
    const typeSelect = t.unmapped
      ? select("Import as", typeOptions(mm), t.source, chosen.type(t.source))
      : undefined;
    const mapped = built === undefined ? undefined : mappedType(built, t.source);
    const targetOf = (): string | undefined => {
      const value = typeSelect?.input.value;
      const c = value === undefined ? undefined : choiceOf(value);
      return typeSelect === undefined ? mapped : c !== undefined && "to" in c ? c.to : undefined;
    };
    const rows = t.attributes.map((a) => {
      const target = targetOf();
      const row = select(
        a,
        target === undefined ? [] : attributeOptions(mm, target),
        a,
        chosen.attribute(t.source, a),
      );
      attributes.set(attributeId(t.source, a), row.input);
      return row;
    });
    const list =
      rows.length === 0
        ? null
        : h(
            "div",
            { class: "rmattrs" },
            h("p", { class: "rmsub" }, "Attributes"),
            rows.map((r) => r.box),
          );
    if (typeSelect !== undefined) {
      types.set(t.source, typeSelect.input);
      const update = (): void => {
        const target = targetOf();
        const omitted = typeSelect.input.value === OMIT;
        list?.toggleAttribute("hidden", omitted);
        for (const [i, row] of rows.entries()) {
          const options = target === undefined ? [] : attributeOptions(mm, target);
          const before = choiceOf(row.input.value);
          const kept = before !== undefined && "to" in before && options.some((o) => o.key === before.to);
          const name = t.attributes[i] ?? "";
          fill(row.input, options, kept ? before.to : guess(options, name)?.key);
          if (before !== undefined && "omit" in before) {
            row.input.value = OMIT;
          }
        }
      };
      typeSelect.input.addEventListener("change", update);
    }
    fields.push(group(`Type ${t.source}`, typeSelect?.box, list));
  }

  if (groups.relations.length > 0) {
    fields.push(
      group(
        "Relation types",
        groups.relations.map((r) => {
          const row = select(r, relationOptions(mm), r, chosen.relation(r));
          relations.set(r, row.input);
          return row.box;
        }),
      ),
    );
  }

  for (const v of groups.values) {
    const property = built === undefined ? undefined : mappedProperty(built, v.sourceType, v.attribute);
    const options = property === undefined ? [] : valueOptions(mm, property);
    fields.push(
      group(
        `Values of ${v.attribute} (${v.sourceType})`,
        v.values.map((value) => {
          const row = select(value, options, value, chosen.value(v.sourceType, v.attribute, value));
          values.set(valueId(v.sourceType, v.attribute, value), row.input);
          return row.box;
        }),
      ),
    );
  }

  const picked = (from: ReadonlyMap<string, HTMLSelectElement>): Map<string, Choice> =>
    new Map(
      [...from].flatMap(([id, input]): [string, Choice][] => {
        const c = choiceOf(input.value);
        return c === undefined || input.closest("[hidden]") !== null ? [] : [[id, c]];
      }),
    );
  return {
    fields,
    choices: () => ({
      types: picked(types),
      attributes: picked(attributes),
      relations: picked(relations),
      values: picked(values),
    }),
  };
}
