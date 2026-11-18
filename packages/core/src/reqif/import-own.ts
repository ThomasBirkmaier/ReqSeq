// A file of ReqSeq (SR-052 AK3): the round-trip channels of an object (`ownChannels`,
// `planOwnValues`), the check of their relations (`checkOwnRelations`) and the types that take them
// (`oneToOneTypes`). Part of import.ts, whose file comment says what the plan does; "the file
// comment" here means that one.
import { acceptanceCriteriaKeyOf, passedKeys } from "../model/acceptance-criteria.js";
import type { FlowMappingValue, ItemValue, PropertyValue, ScalarValue } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { allowsType, findType } from "../metamodel/index.js";
import { hasId, imageLink, isUuid, markdownLinks, titleKeyOrEmpty } from "../model/index.js";
import type {
  ReqifAttributeDefinition,
  ReqifFile,
  ReqifSpecObject,
  ReqifSpecType,
  ReqifValue,
} from "./model.js";
import type { OriginKeys } from "./origin.js";
import { ownAttributes, ownId, ownMapping, ownRelationKeys, readableValues } from "./own.js";
import type { XhtmlImage } from "./xhtml-markdown.js";
import { prepareMarkdown } from "./xhtml-markdown.js";
import { allowed, invalidFile, itemsOf, nameOf } from "./import-context.js";
import type { AttributeEntry, Context, Coverage, Draft, Loss } from "./import-context.js";

/**
 * Whether `a` of type `t` of a file of ReqSeq holds nothing the one-to-one mapping maps: the
 * round-trip attributes, the status (D-030) and a relation-valued property, whose targets are its
 * SPEC-RELATIONs; its omission is no loss.
 */
export const ownOnly = (metamodel: Metamodel, t: ReqifSpecType, a: ReqifAttributeDefinition): boolean => {
  const key = t.identifier.slice("_ot-".length);
  return (
    a.identifier === ownId.markdown(key) ||
    a.identifier === ownId.values(key) ||
    a.identifier === ownId.attribute(key, "status") ||
    metamodel.properties.some((p) => p.kind === "relation" && a.identifier === ownId.attribute(key, p.key))
  );
};

/** What `reqseq-markdown` and `reqseq-values` of an object hold, and the images of its text. */
interface Channels {
  readonly data: Readonly<Record<string, unknown>>;
  readonly text: string;
  /** Each image link of the text (its URL) with the `object` the file has for it, in order. */
  readonly images: readonly { readonly url: string; readonly image: XhtmlImage }[];
}

/** The value of attribute `definition` as a STRING, if the object has one. */
const stringValue = (object: ReqifSpecObject, definition: string): string | undefined => {
  const value = object.values.find((v) => v.definition === definition);
  return value?.kind === "string" ? value.value : undefined;
};

/** The JSON object of `text`, or undefined when it is none. */
const jsonObject = (text: string): Readonly<Record<string, unknown>> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The deepest nesting of arrays and objects (an XHTML element counts two: itself and its children)
 * the round-trip check of an object takes; far beyond a real text or value, and far within the
 * stack of the recursive steps after it (`comparable`, the frontmatter edit), so a hostile file
 * cannot exhaust the stack (ADR-0013).
 */
const MAX_NESTING = 1000;

/** True when `root` nests arrays and objects deeper than `MAX_NESTING`; walked without recursion. */
const tooDeep = (root: unknown): boolean => {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value: root, depth: 0 }];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { value, depth } = next;
    if (typeof value === "object" && value !== null) {
      if (depth === MAX_NESTING) {
        return true;
      }
      for (const child of Object.values(value)) {
        pending.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return false;
};

const isScalarShape = (value: unknown): boolean =>
  value === null ||
  ["string", "boolean"].includes(typeof value) ||
  (typeof value === "number" && Number.isFinite(value));

/** True for a scalar or a mapping of scalars (a relation target), the items an element file holds. */
const isItemShape = (value: unknown): boolean =>
  isScalarShape(value) ||
  (value instanceof Object && !Array.isArray(value) && Object.values(value).every(isScalarShape));

/**
 * The first of `keys` whose value in `data` has a shape no element file holds (`PropertyValue`: a
 * scalar, a relation target or a list of those, a number finite), so the import cannot write it (#716).
 */
const misshapenKey = (keys: readonly string[], data: Readonly<Record<string, unknown>>): string | undefined =>
  keys.find((key) => {
    const value = data[key];
    return value !== undefined && !isItemShape(value) && !(Array.isArray(value) && value.every(isItemShape));
  });

/** Values in a form two sets compare by, ordered by attribute. */
const comparable = (values: readonly ReqifValue[]): string =>
  JSON.stringify([...values].sort((a, b) => (a.definition < b.definition ? -1 : 1)));

/** The SPEC-RELATIONs `data` gives an object, as `<type>|<target>` (export.ts: items with a UUID). */
const storedRelations = (metamodel: Metamodel, data: Readonly<Record<string, unknown>>): Set<string> =>
  new Set(
    ownRelationKeys(metamodel).flatMap((key) =>
      [data[key]]
        .flat()
        .flatMap((item) =>
          hasId(item) && isUuid(item.id) ? [`${ownId.relationType(key)}|${ownId.element(item.id)}`] : [],
        ),
    ),
  );

/**
 * Of the SPEC-RELATIONs `relations` (`<type>|<target>`), those of a kind `metamodel` knows: one it
 * does not know is a loss `omitted-type`, not a change by another tool (#695).
 */
const knownRelations = (metamodel: Metamodel, relations: ReadonlySet<string> | undefined): Set<string> => {
  const kinds = new Set(ownRelationKeys(metamodel).map((key) => ownId.relationType(key)));
  return new Set([...(relations ?? [])].filter((r) => kinds.has(r.slice(0, r.indexOf("|")))));
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((x) => b.has(x));

/**
 * The round-trip channels of `object` of a file of ReqSeq, when the readable values written again
 * from them equal the file's and its SPEC-RELATIONs of a kind the metamodel knows those
 * `reqseq-values` names (see the file comment); else undefined, with the warning.
 */
export const ownChannels = (
  context: Context,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  ownType: string,
): Channels | undefined => {
  const { metamodel } = context;
  const key = t.identifier.slice("_ot-".length);
  const markdownId = ownId.markdown(key);
  const valuesId = ownId.values(key);
  const text = stringValue(object, markdownId);
  const data = jsonObject(stringValue(object, valuesId) ?? "");
  if (tooDeep(object.values) || tooDeep(data)) {
    throw invalidFile(
      `SPEC-OBJECT ${object.identifier} nests its values deeper than ${String(MAX_NESTING)} levels`,
      object.line,
    );
  }
  const titleKey = titleKeyOrEmpty(metamodel);
  const attributes = ownAttributes(metamodel, key, findType(metamodel, ownType), titleKey);
  // Compared: the readable attributes this metamodel knows (one it does not know is not imported),
  // but not those of relation-valued properties, whose SPEC-RELATIONs are compared below.
  const compared = new Set(
    attributes
      .filter((a) => a.property?.kind !== "relation" && a.role !== "markdown" && a.role !== "values")
      .map((a) => a.identifier),
  );
  const known = (v: ReqifValue): boolean => compared.has(v.definition);
  // The images of the text in the order `markdownToXhtml` writes them, paired with its links.
  const textValue = object.values.find((v) => v.definition === ownId.attribute(key, "text"));
  const objects = textValue?.kind === "xhtml" ? prepareMarkdown(textValue.value).images : [];
  const images: { url: string; image: XhtmlImage }[] = [];
  const image = (url: string): string => {
    const found = objects[images.length];
    images.push({ url, image: found ?? { data: url } });
    return found?.data ?? url;
  };
  const same =
    text !== undefined &&
    data !== undefined &&
    comparable(
      readableValues(
        metamodel,
        attributes,
        { data, text },
        titleKey,
        { shortId: () => "", image },
        false,
      ).filter(known),
    ) === comparable(object.values.filter(known)) &&
    images.length === objects.length &&
    sameSet(
      storedRelations(metamodel, data),
      knownRelations(metamodel, context.ownRelationsOf.get(object.identifier)),
    );
  if (same) {
    // The values the import takes from the channels (`planOwnValues`) must be ones it can write.
    const origin = new Set<string>(Object.values(context.keys));
    const taken = [
      ...attributes.flatMap((a) =>
        a.property === undefined || origin.has(a.property.key) ? [] : [a.property.key],
      ),
      ...metamodel.relations.map((r) => r.key),
    ];
    const misshapen = misshapenKey(taken, data);
    if (misshapen !== undefined) {
      throw invalidFile(
        `SPEC-OBJECT ${object.identifier} holds a value of ${misshapen} in reqseq-values that ReqSeq cannot write`,
        object.line,
      );
    }
    checkOwnCriterionKeys(metamodel, taken, data, object);
    return { data, text, images };
  }
  if (data !== undefined) {
    context.stored.set(object.identifier, data);
  }
  context.problems.push({
    code: "reqif.edited-elsewhere",
    severity: "warning",
    message: `${object.identifier}: its attributes or relations differ from reqseq-markdown and reqseq-values, so another tool changed it; its readable attributes and SPEC-RELATIONs are imported`,
  });
  return undefined;
};

/** `value` with each relation item that names an object of this call pointed at its element. */
const ownTargets = (context: Context, value: unknown): PropertyValue => {
  const mapped = (item: unknown): unknown => {
    if (!hasId(item)) {
      return item;
    }
    const id = context.ids.get(ownId.element(item.id));
    if (id === undefined) {
      return item;
    }
    // The element lies in the repository of this call, so a stored repository no longer applies.
    const { repository: _repository, ...rest } = item;
    const pointed: Record<string, ScalarValue> = { ...(rest as FlowMappingValue), id, version: "" };
    context.pending.set(id, [...(context.pending.get(id) ?? []), pointed]);
    return pointed;
  };
  return (Array.isArray(value) ? value.map(mapped) : mapped(value)) as PropertyValue;
};

/** The folder `imageLink` resolves the links of a text against when only their paths are compared. */
const ANY_ELEMENT = "a/b/c/d/e/f/g/h/element.md";

/**
 * `text` with each image link of `images` that the file has an image for pointed at its copy in the
 * image folder of `draft` (SR-095 AK2); an image that cannot be copied is a loss and keeps its link.
 * Reference-style images keep their links.
 */
const ownImages = async (
  context: Context,
  draft: Draft,
  text: string,
  images: Channels["images"],
  loss: Loss,
): Promise<string> => {
  const copies = new Map<string, string>();
  for (const { url, image } of images) {
    const link = imageLink(ANY_ELEMENT, url, () => false);
    if (link === undefined || copies.has(link.path)) {
      continue;
    }
    const read = await context.images(image);
    if (read.kind === "found") {
      const copy = `${draft.stem}/${draft.images.nameOf(read.file)}`;
      copies.set(link.path, copy);
      draft.textImages.set(copy, read.file.sha256);
    } else {
      loss(read.kind, read.reason);
    }
  }
  let out = text;
  for (const { image, destination, start, end } of markdownLinks(text).reverse()) {
    const copy = image ? copies.get(imageLink(ANY_ELEMENT, destination, () => false)?.path ?? "") : undefined;
    if (copy !== undefined) {
      out = `${out.slice(0, start)}${copy}${out.slice(end)}`;
    }
  }
  return out;
};

/**
 * The acceptance criteria `reqseq-values` passes with their keys, checked as on any save (SR-204
 * AK5): a key not in its form, or on two criteria, is `reqif.invalid` naming the SPEC-OBJECT.
 */
const checkOwnCriterionKeys = (
  metamodel: Metamodel,
  taken: readonly string[],
  data: Record<string, unknown>,
  object: ReqifSpecObject,
): void => {
  const criteria = acceptanceCriteriaKeyOf(metamodel);
  const items = criteria !== undefined && taken.includes(criteria) ? data[criteria] : undefined;
  if (criteria === undefined || !Array.isArray(items)) {
    return;
  }
  try {
    passedKeys(criteria, items);
  } catch (error) {
    throw invalidFile(`SPEC-OBJECT ${object.identifier}: ${(error as Error).message}`, object.line);
  }
};

/** A stored scalar as text, as the export writes the title; anything else is none. */
const scalarTitle = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";

/** Takes the title, text, properties and relations of `draft` from the channels (see the file comment). */
export const planOwnValues = async (
  context: Context,
  channels: Channels,
  object: ReqifSpecObject,
  t: ReqifSpecType,
  draft: Draft,
): Promise<void> => {
  const { metamodel, keys } = context;
  const { data } = channels;
  const origin = new Set<string>(Object.values(keys));
  const loss: Loss = (code, reason) => {
    context.losses.push({ identifier: object.identifier, kind: "spec-object", id: draft.id, code, reason });
  };
  // A value of an attribute the mapping omits (this metamodel does not know it) is a loss, as on
  // the readable path; `reqseq-values` holds it too, but only the type's properties are taken.
  const given = new Set(object.values.map((v) => v.definition));
  for (const a of t.attributes) {
    const omitted = context.coverage.attributes.get(a.identifier)?.entry.property === undefined;
    if (given.has(a.identifier) && omitted && !ownOnly(metamodel, t, a)) {
      loss("omitted-attribute", `the mapping omits its attribute ${nameOf(a)}`);
    }
  }
  draft.title = scalarTitle(data[draft.base.titleKey]);
  draft.text = await ownImages(context, draft, channels.text, channels.images, loss);
  for (const key of draft.base.type.properties) {
    const value = data[key];
    if (key === draft.base.titleKey || origin.has(key) || value === undefined || value === null) {
      continue;
    }
    const relation = metamodel.properties.find((p) => p.key === key)?.kind === "relation";
    draft.properties.set(key, relation ? ownTargets(context, value) : (value as PropertyValue));
  }
  draft.ownRelations = new Map(
    metamodel.relations.flatMap((r) =>
      data[r.key] === undefined ? [] : [[r.key, ownTargets(context, data[r.key])] as const],
    ),
  );
};

/**
 * Removes each relation item of a draft planned from its channels that names an element of this
 * call the metamodel does not allow from its type (a loss `relation-not-allowed`), as `planRelation`
 * does for a SPEC-RELATION.
 */
export const checkOwnRelations = (context: Context, drafts: ReadonlyMap<string, Draft>): void => {
  const { metamodel } = context;
  const byId = new Map([...drafts.values()].map((d) => [d.id, d]));
  for (const source of drafts.values()) {
    const { ownRelations } = source;
    if (ownRelations === undefined) {
      continue;
    }
    /** Whether `item` may stay: it names no element of this call, or one `target` allows. */
    const keep = (key: string, item: unknown, target: (to: Draft) => boolean): boolean => {
      const to = hasId(item) ? byId.get(item.id) : undefined;
      if (to === undefined || target(to)) {
        return true;
      }
      context.losses.push({
        identifier: source.identifier,
        kind: "spec-object",
        id: source.id,
        code: "relation-not-allowed",
        reason: `the metamodel does not allow ${key} from ${source.base.type.key} to ${to.base.type.key}`,
      });
      return false;
    };
    for (const [key, value] of ownRelations) {
      if (Array.isArray(value)) {
        ownRelations.set(
          key,
          value.filter((item) => keep(key, item, (to) => allowed(metamodel, key, source, to))),
        );
      }
    }
    for (const property of metamodel.properties.filter((p) => p.kind === "relation")) {
      const value = source.properties.get(property.key);
      const allows = (to: Draft): boolean =>
        allowsType(property["target-types"], to.base.type.key, metamodel);
      const items = itemsOf(value);
      const rest = items.filter((item) => keep(property.key, item, allows));
      if (rest.length < items.length) {
        // A removed target of a relation-valued property changes what counts to the version (D-057).
        source.relationProperties = true;
        if (rest.length > 0) {
          source.properties.set(property.key, rest as ItemValue[]);
        } else {
          source.properties.delete(property.key);
        }
      }
    }
  }
};

/** The SPEC-RELATIONs of `file` by source, as `<type>|<target>`. */
export const relationsBySource = (file: ReqifFile): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const r of file.specRelations) {
    out.set(r.source, new Set([...(out.get(r.source) ?? []), `${r.type}|${r.target}`]));
  }
  return out;
};

/** An attribute or relation entry in a form two entries compare by. */
const entryForm = (entry: AttributeEntry | undefined): string =>
  JSON.stringify([
    entry?.omit === true || entry === undefined ? null : entry.property,
    Object.entries(entry?.values ?? {}).sort(),
    [...(entry?.["omit-values"] ?? [])].sort(),
  ]);

/**
 * The object types of a file of ReqSeq that `coverage` maps as `ownMapping` does, attribute for
 * attribute, while it also maps every relation type so: only their objects take the round-trip
 * channels, so a mapping that omits or maps otherwise is never bypassed (see the file comment).
 */
export const oneToOneTypes = (
  file: ReqifFile,
  coverage: Coverage,
  metamodel: Metamodel,
  name: string,
  keys: OriginKeys,
): Set<string> => {
  const one = ownMapping(
    file,
    metamodel,
    name,
    new Set([titleKeyOrEmpty(metamodel), ...Object.values(keys)]),
  );
  const relationsAgree = one.relations.every((e) => coverage.relations.get(e.source) === e.kind);
  const attributes = new Map(one.attributes.map((e) => [e.source, e]));
  return new Set(
    file.specTypes
      .filter(
        (t) =>
          relationsAgree &&
          t.category === "spec-object" &&
          coverage.types.get(t.identifier) === one.types.find((e) => e.source === t.identifier)?.type &&
          t.attributes.every(
            (a) =>
              entryForm(coverage.attributes.get(a.identifier)?.entry) ===
              entryForm(attributes.get(a.identifier)),
          ),
      )
      .map((t) => t.identifier),
  );
};
