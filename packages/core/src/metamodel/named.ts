// Finding a status or choice value by what a person types (#309, spec question #316): its key, or its
// display name, in any case. The file always gets the key (SR-012 AK3, D-043), so renaming a value
// changes no file. Only commands use this; reading files stays exact and lenient (SR-085 AK2).

/** What a status or choice value has: its key and its display name. */
export interface Named {
  readonly key: string;
  readonly name: string;
}

/** What a given text names among the values of the metamodel. */
export type NamedMatch =
  | { readonly kind: "found"; readonly key: string }
  | { readonly kind: "unknown" }
  | { readonly kind: "ambiguous"; readonly keys: readonly string[] };

const fold = (text: string): string => text.normalize("NFC").toLowerCase();

/**
 * The value `given` names: the one whose key is exactly `given`; else the one whose key or display
 * name equals `given` ignoring case (and Unicode normal form); several such values are ambiguous.
 */
export const findNamed = (values: readonly Named[], given: string): NamedMatch => {
  if (values.some((v) => v.key === given)) {
    return { kind: "found", key: given };
  }
  const wanted = fold(given);
  const keys = [
    ...new Set(values.filter((v) => fold(v.key) === wanted || fold(v.name) === wanted).map((v) => v.key)),
  ];
  const [first, ...others] = keys;
  if (first === undefined) {
    return { kind: "unknown" };
  }
  return others.length === 0 ? { kind: "found", key: first } : { kind: "ambiguous", keys };
};

/** Values listed in a message; a longer list is cut. */
const LISTED = 20;

/** `draft (Draft), approved (Approved)`, the first 20 and `…` for more; `none` for an empty list. */
export const listNamed = (values: readonly Named[]): string =>
  values.length === 0
    ? "none"
    : `${values
        .slice(0, LISTED)
        .map((v) => `${v.key} (${v.name})`)
        .join(", ")}${values.length > LISTED ? ", …" : ""}`;
