// The key of a new definition made from its name (SR-236 AK6, D-043): letters in lower case,
// digits as they are, ä, ö, ü and ß as ae, oe, ue and ss, every run of other characters one hyphen,
// none at the start or end. A letter is one of a–z (#1958: other letters such as é count as other
// characters, since a key holds only a–z, 0–9 and hyphens). The name is taken in Unicode normal form
// NFC first, so an umlaut written as a base letter and a combining mark counts as the umlaut.
import { CommandError } from "../catalog.js";
import { isKeyForm } from "./load.js";

/** The key made from `name`, and whether it can be a key (it starts with a letter, at most 64 characters). */
export const keyFromName = (name: string): { readonly key: string; readonly usable: boolean } => {
  const key = name
    .normalize("NFC")
    .replace(/[Ää]/g, "ae")
    .replace(/[Öö]/g, "oe")
    .replace(/[Üü]/g, "ue")
    .replace(/[ßẞ]/g, "ss")
    // Only A–Z and a–z are letters here: a letter outside them that lower-cases to one (İ) is
    // another character too (#1958).
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-+|-+$/g, "");
  return { key, usable: isKeyForm(key) };
};

/**
 * The key of a new definition: `key` when given, else the key made from `name` (SR-236 AK6). Refuses
 * with `input.invalid`, reason `key-required`, a made key that cannot be a key or that `taken` says
 * is in use, which `owner` names (`a type`, `a property or relation kind`).
 */
export const keyOrMade = (
  name: string,
  key: string | undefined,
  taken: (key: string) => boolean,
  owner: string,
): string => {
  if (key !== undefined) {
    return key;
  }
  const made = keyFromName(name);
  const used = taken(made.key);
  if (made.usable && !used) {
    return made.key;
  }
  const why = used
    ? `is already the key of ${owner}`
    : made.key === ""
      ? "is empty"
      : made.key.length > 64
        ? "is longer than 64 characters"
        : "does not start with a letter";
  throw new CommandError(
    "input.invalid",
    `Give a key: the key made from the name${made.key === "" ? "" : `, ${made.key},`} ${why}`,
    { reason: "key-required", key: made.key },
  );
};
