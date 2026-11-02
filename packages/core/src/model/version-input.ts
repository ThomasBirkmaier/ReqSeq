// The input of normal form n2 (ADR-0005 "Normal form 2", D-027, #166): the text and the string values
// of the properties that count, with the `version=` parameters of their inline references removed.
// `version.ts` stays pure and below the model, so the reference scanner runs here.
import type { VersionInput, VersionValue } from "../version/version.js";
import { inlineReferences } from "./references.js";

/**
 * A reference destination without its `version=` parameters: its other non-empty parameters in their
 * order, joined by `&`, and no `?` when none is left. A destination without such a parameter stays
 * byte for byte; a value runs to the next `&` as written, a fragment or a backslash included.
 */
export function withoutVersionParam(destination: string): string {
  const query = destination.indexOf("?");
  if (query < 0) {
    return destination;
  }
  const params = destination.slice(query + 1).split("&");
  if (!params.some((p) => p.startsWith("version="))) {
    return destination;
  }
  const kept = params.filter((p) => p !== "" && !p.startsWith("version="));
  return destination.slice(0, query) + (kept.length > 0 ? `?${kept.join("&")}` : "");
}

/** A Markdown text with the `version=` parameters of its inline references removed (`inlineReferences`). */
export function withoutReferenceVersions(text: string): string {
  let out = text;
  // From the end, so the offsets of the earlier references stay valid.
  for (const ref of inlineReferences(text).reverse()) {
    out = out.slice(0, ref.start) + withoutVersionParam(out.slice(ref.start, ref.end)) + out.slice(ref.end);
  }
  return out;
}

/** Every string inside a value with the `version=` parameters of its inline references removed. */
const stripped = (value: VersionValue): VersionValue => {
  if (typeof value === "string") {
    return withoutReferenceVersions(value);
  }
  if (Array.isArray(value)) {
    return value.map(stripped);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripped(v)]));
  }
  return value;
};

/**
 * The input of normal form n2 for an n1 input: the text and every string value of a property that
 * counts (whatever its `markdown` flag) without the `version=` parameters of their inline references.
 * Relation-valued properties count only their target ids, so they are kept as they are.
 */
export function n2Input(input: VersionInput): VersionInput {
  const properties: Record<string, VersionValue | undefined> = { ...input.properties };
  for (const def of input.definitions) {
    const value = Object.hasOwn(input.properties, def.key) ? input.properties[def.key] : undefined;
    if (def.content === true && def.kind !== "relation" && value !== undefined) {
      properties[def.key] = stripped(value);
    }
  }
  return { ...input, text: withoutReferenceVersions(input.text), properties };
}
