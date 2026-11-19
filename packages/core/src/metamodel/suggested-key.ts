// The key and the prefix of a new definition made from its name (SR-236 AK6, D-043), without a file or a
// workspace, so the command prompt of the app shows them as it asks (`@reqseq/core/suggested-key`).
//
// The key: letters in lower case, digits as they are, ä, ö, ü and ß as ae, oe, ue and ss, other letters
// with a diacritic as the letter without it (é as e, ç as c), every run of other characters one hyphen,
// none at the start or end. The name is taken in Unicode normal form NFD, so an umlaut is its base letter
// and the combining diaeresis however it is written (also with a further mark, ǘ); after the umlauts,
// the combining marks are dropped. A letter that has no such decomposition (ø, ł, đ) counts as another
// character, since a key holds only a–z, 0–9 and hyphens. The prefix: the first character of each word of
// the name in upper case.

/** A key as the schema takes it: only such a key names its definition in a message (#840 review). */
const NAMING_KEY = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_KEY_LENGTH = 64;

/** A prefix as the schema takes it (`metamodel.schema.json#/$defs/prefix`, D-017). */
const PREFIX = /^[A-Z][A-Z0-9]*$/;

/** Whether `key` has the form of a metamodel key (`common.schema.json#/$defs/key`). */
export const isKeyForm = (key: unknown): key is string =>
  typeof key === "string" && key.length <= MAX_KEY_LENGTH && NAMING_KEY.test(key);

/** The key made from `name`, and whether it can be a key (it starts with a letter, at most 64 characters). */
export const keyFromName = (name: string): { readonly key: string; readonly usable: boolean } => {
  const key = name
    .normalize("NFD")
    // An umlaut is its base letter followed by the diaeresis, also when another mark follows (ǘ).
    .replace(/([AOUaou])\u0308/g, "$1e")
    .replace(/[ßẞ]/g, "ss")
    .replace(/\p{M}+/gu, "")
    // A letter still outside A–Z and a–z (ø, ł, đ have no decomposition) is another character.
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  return { key, usable: isKeyForm(key) };
};

/**
 * The prefix suggested for a new type named `name` (SR-236 AK6): the first characters of the words of the
 * name in upper case ("System Requirement": SR); none when that is no valid prefix (a letter A to Z, then
 * letters A to Z or digits) or another type has it (`taken`).
 */
export const prefixFromName = (name: string, taken: readonly string[]): string | undefined => {
  const prefix = name
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.charAt(0))
    .join("")
    .toUpperCase();
  return PREFIX.test(prefix) && !taken.includes(prefix) ? prefix : undefined;
};
