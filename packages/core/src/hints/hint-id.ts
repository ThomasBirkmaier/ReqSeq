// The stable ID of a confirmable hint (D-042): an outdated relation or inline reference (SR-025),
// or a changed core requirement at the `replaces` item of a variant requirement (SR-045). It is
// what `hint.confirm` (SR-027) takes to find the relation items or references whose stored version
// it writes. An ID names the place of the relation, not a line, so it stays the same while the file
// changes elsewhere, and in every access (SR-080):
//
// - an item of a relation kind or of a relation-valued property (ADR-0004: validity, packages):
//   `relation.outdated/<repository>/<file>/<source>/<key>/<target>?version=<stored>`, and
//   `&repository=<name>` when the item names the repository of its target (D-058);
// - an inline reference in the text (SR-066):
//   `relation.outdated/<repository>/<file>/<source>/@text/<target>?version=<stored>`, `&repository=<name>`
//   when the link names one, and `&n=<k>`: the link is the k-th (from 1) in the text with the same
//   target, repository and stored version. `@text` is no metamodel key (keys start with a letter);
// - an inline reference in a value of a property marked `markdown` (SR-127):
//   `relation.outdated/<repository>/<file>/<source>/@text:<key>/<target>?version=<stored>`, with the
//   same parameters; `n` counts over all values of that property (a list is one text). The key is
//   behind a colon, as a key can be `text`, so `@<key>` would clash with `@text`.
//
// - a `replaces` item onto a changed core requirement (SR-045): `variant.core-changed/<repository>/
//   <file>/<source>/<key>/<target>?version=<stored>[&repository=<name>]`, with the place rules of a
//   relation item; only relation items, so `@text` places are refused.
//
// `<repository>` and `<file>` are the workspace name of the source's repository and the source
// file relative to it, so that two files that share a UUID (SR-088) have different IDs. They and a
// target repository name are percent-encoded (`encodeURIComponent`, so `/` in the file becomes
// `%2F`); `<source>` and `<target>` are UUIDs, `<key>` a metamodel key and `<stored>` a version
// (ADR-0005), which need no escaping. The stored version is part of the ID: once the hint is
// confirmed (the current version is written), its ID names no outdated relation any more, and a
// later change of the target gives a new ID.
//
// Items of one list with the same target, repository and stored version (written twice by hand;
// ReqSeq writes a target once, ADR-0004) share one ID: confirming it confirms every such item.

import { isVersion } from "../model/is-version.js";

/** The code of the hints on outdated relations and references (`common.schema.json#/$defs/problemCode`). */
export const OUTDATED_CODE = "relation.outdated";

/** The code of the hints on a changed core requirement that a variant requirement replaces (SR-045). */
export const CORE_CHANGED_CODE = "variant.core-changed";

/** The codes of the confirmable hints, the only ones with a hint ID and the first segment of it. */
export const CONFIRMABLE_CODES = [OUTDATED_CODE, CORE_CHANGED_CODE] as const;

/** The code of a confirmable hint. */
export type ConfirmableCode = (typeof CONFIRMABLE_CODES)[number];

/** The segment that names the text of the source instead of a key. */
export const TEXT_SEGMENT = "@text";

/** The start of the segment that names a Markdown property: `@text:<key>`. */
export const PROPERTY_SEGMENT = "@text:";

/** Where the relation is stored: the source element and its file. */
interface SourcePlace {
  /** Workspace name of the source's repository. */
  readonly sourceRepository: string;
  /** The source file, relative to its repository, with `/`. */
  readonly file: string;
  /** UUID of the source element. */
  readonly source: string;
  /** UUID of the target. */
  readonly target: string;
  /** The version stored. */
  readonly version: string;
}

/** What a hint ID names: the relation items or the inline reference of a source element. */
export type HintTarget =
  | (SourcePlace & {
      readonly kind: "relation";
      /** The code of the hint. */
      readonly code: ConfirmableCode;
      /** The key of the relation kind or relation-valued property. */
      readonly key: string;
      /** The repository the items name, undefined when they name none (the source's own, D-058). */
      readonly repository?: string;
    })
  | (SourcePlace & {
      readonly kind: "reference";
      /** The code of the hint: only outdated references are named by place in a text. */
      readonly code: typeof OUTDATED_CODE;
      /** The `repository` of the link as written, undefined when it has none. */
      readonly repository?: string;
      /** The place of the link among the links of the text with the same target, repository and version, from 1. */
      readonly occurrence: number;
      /** The key of the property marked `markdown` that holds the link; undefined for the text. */
      readonly property?: string;
    });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const OCCURRENCE = /^[1-9][0-9]*$/;
const PARAMETERS = new Set(["version", "repository", "n"]);

/** The hint ID of `target` (format above). */
export const hintIdOf = (target: HintTarget): string => {
  const place =
    target.kind === "relation"
      ? target.key
      : target.property === undefined
        ? TEXT_SEGMENT
        : `${PROPERTY_SEGMENT}${target.property}`;
  const repository =
    target.repository === undefined ? "" : `&repository=${encodeURIComponent(target.repository)}`;
  const occurrence = target.kind === "reference" ? `&n=${String(target.occurrence)}` : "";
  const source = `${encodeURIComponent(target.sourceRepository)}/${encodeURIComponent(target.file)}/${target.source}`;
  return `${target.code}/${source}/${place}/${target.target}?version=${target.version}${repository}${occurrence}`;
};

/** `text` decoded, or undefined when it cannot be decoded. */
const decoded = (text: string): string | undefined => {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
};

/** The value of query parameter `name`, decoded; undefined when absent, null when it occurs twice or cannot be decoded. */
const parameter = (parameters: readonly string[], name: string): string | undefined | null => {
  const found = parameters.filter((p) => p.startsWith(`${name}=`));
  const [only] = found;
  if (only === undefined) {
    return undefined;
  }
  return found.length > 1 ? null : (decoded(only.slice(name.length + 1)) ?? null);
};

/** The segments and parameters of `id`, or undefined when it has no query or an unknown or empty-named parameter. */
const split = (id: string): { segments: string[]; parameters: string[] } | undefined => {
  const question = id.indexOf("?");
  if (question < 0) {
    return undefined;
  }
  const parameters = id.slice(question + 1).split("&");
  return parameters.every((p) => p.includes("=") && PARAMETERS.has(p.slice(0, p.indexOf("="))))
    ? { segments: id.slice(0, question).split("/"), parameters }
    : undefined;
};

/** The source, place and target of the segments, when they have the form of a hint ID. */
const placeOf = (
  segments: readonly string[],
):
  | {
      code: ConfirmableCode;
      sourceRepository: string;
      file: string;
      source: string;
      place: string;
      target: string;
    }
  | undefined => {
  const [code, repository, file, source, place, target, ...rest] = segments;
  const known = CONFIRMABLE_CODES.find((c) => c === code);
  const sourceRepository = decoded(repository ?? "");
  const sourceFile = decoded(file ?? "");
  return known !== undefined &&
    sourceRepository !== undefined &&
    sourceRepository !== "" &&
    sourceFile !== undefined &&
    sourceFile !== "" &&
    source !== undefined &&
    place !== undefined &&
    target !== undefined &&
    rest.length === 0 &&
    UUID.test(source) &&
    UUID.test(target)
    ? { code: known, sourceRepository, file: sourceFile, source, place, target }
    : undefined;
};

/** The property a place names (`@text:<key>`, none for `@text`), or undefined when `place` is no place of a reference. */
const referencePlace = (place: string): { readonly property?: string } | undefined => {
  if (place === TEXT_SEGMENT) {
    return {};
  }
  const property = place.startsWith(PROPERTY_SEGMENT) ? place.slice(PROPERTY_SEGMENT.length) : "";
  return KEY.test(property) ? { property } : undefined;
};

/**
 * What the hint ID `id` names, with its code, or undefined when `id` is not a hint ID of this format. Only the
 * form is checked: whether the source still has that relation with that stored version, and
 * whether it is still outdated, is up to the caller (`hint.confirm` reports a stale ID).
 */
export const parseHintId = (id: string): HintTarget | undefined => {
  const parts = split(id);
  const named = parts === undefined ? undefined : placeOf(parts.segments);
  if (parts === undefined || named === undefined) {
    return undefined;
  }
  const { place, code, ...where } = named;
  const version = parameter(parts.parameters, "version");
  const repository = parameter(parts.parameters, "repository");
  const occurrence = parameter(parts.parameters, "n");
  if (typeof version !== "string" || !isVersion(version) || repository === null) {
    return undefined;
  }
  const target = repository === undefined ? {} : { repository };
  const reference = referencePlace(place);
  if (reference !== undefined) {
    return code === OUTDATED_CODE && typeof occurrence === "string" && OCCURRENCE.test(occurrence)
      ? {
          kind: "reference",
          code,
          ...where,
          ...target,
          version,
          occurrence: Number(occurrence),
          ...reference,
        }
      : undefined;
  }
  return KEY.test(place) && occurrence === undefined
    ? { kind: "relation", code, ...where, key: place, ...target, version }
    : undefined;
};
