// The key of a new definition made from its name, or the one given (SR-236 AK6, D-043); how the key is
// made is in `suggested-key.ts`.
import { CommandError } from "../catalog.js";
import { keyFromName } from "./suggested-key.js";

export { keyFromName };

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
