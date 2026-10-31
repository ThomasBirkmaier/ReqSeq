// The fixed keys of the most frequent commands (SR-121 AK3) and the prefix key (SR-109 AK3): Ctrl+K, or
// Cmd+K on macOS, then one letter. The set, the letters and the prefix are the assumption of the open spec
// question #472, kept in this one table; the window wires them up in `use-prefix.ts`.
import type { Choice } from "./actions.js";
import type { KeyPress, KeyRow, Shortcut } from "./keys.js";
import { matches, press, pressLabel, shortcutLabel } from "./keys.js";

/** The prefix key: Ctrl+K, or Cmd+K on macOS (#472; not Ctrl+X or Ctrl+C, the cut and copy of every field). */
export const PREFIX: Shortcut = { mod: true, shift: false, key: "k" };

/** How long the prefix waits for the next key before it shows the possible next keys (SR-109 AK3). */
export const PREFIX_DELAY_MS = 500;

/** A letter after the prefix and the entry of the command prompt it runs (its `id`). */
export interface PrefixBinding {
  /** Lower case. */
  readonly key: string;
  readonly id: string;
}

/**
 * The letters after the prefix, in the order #472 lists them (the order of the list of next keys). A row
 * is shown only where the command prompt offers its entry, so the write commands drop out in a read-only
 * workspace (`whileReadOnly`, `catalogItems`).
 */
export const PREFIX_BINDINGS: readonly PrefixBinding[] = [
  { key: "e", id: "command:element.create" },
  { key: "r", id: "command:relation.add" },
  { key: "t", id: "command:element.setStatus" },
  { key: "h", id: "command:hint.confirm" },
  { key: "l", id: "list-all" },
  { key: "o", id: "overview" },
  { key: "f", id: "filter-type" },
  { key: "s", id: "sort" },
  { key: "b", id: "close" },
];

/** The keys while the prefix waits, besides the letters (`prefixStep`), for the keyboard reference (SR-139 AK5). */
export const PREFIX_KEYS: readonly KeyRow[] = [
  { keys: [{ shortcut: PREFIX }], does: "Pressed again: show the possible next keys at once" },
  { keys: [{ press: press("Escape") }], does: "End the prefix" },
];

/** The actions of #472 that keep a single shortcut of their own (`actions.ts`). */
export const SINGLE_KEY_IDS: readonly string[] = [
  "go-to",
  "search",
  "save",
  "neighbourhood",
  "matrix",
  "copy-field",
  "follow-reference",
];

/** „Die häufigsten Befehle“ of SR-121 AK3 (#472): the single shortcuts and the letters after the prefix. */
export const MOST_FREQUENT: readonly string[] = [
  ...SINGLE_KEY_IDS,
  ...PREFIX_BINDINGS.map((binding) => binding.id),
];

/** "Ctrl+K L", or "⌘K L" on macOS. */
export const prefixLabel = (key: string, mac: boolean): string =>
  `${shortcutLabel(PREFIX, mac)} ${key.toUpperCase()}`;

/** What the echo shows while the prefix waits: "Ctrl+K-", or "⌘K-" (Emacs writes "C-x-"). */
export const prefixWaiting = (mac: boolean): string => `${shortcutLabel(PREFIX, mac)}-`;

/** The label of the letter bound to the entry `id`, when one is. */
export const bindingLabel = (id: string, mac: boolean): string | undefined => {
  const binding = PREFIX_BINDINGS.find((row) => row.id === id);
  return binding === undefined ? undefined : prefixLabel(binding.key, mac);
};

/** A key press while the prefix waits; `repeat` is true for a key held down. */
export interface PrefixPress extends KeyPress {
  readonly repeat?: boolean;
}

/** What a key does while the prefix waits. */
export type PrefixStep =
  /** Nothing: the prefix keeps waiting (a modifier alone, a composing input method, a held K). */
  | { readonly kind: "ignore" }
  /** A second Ctrl/Cmd+K: the next keys are shown at once, and the prefix keeps waiting. */
  | { readonly kind: "show" }
  /** Escape: the prefix ends, quietly. */
  | { readonly kind: "cancel" }
  /** A letter: the command bound to it, if any; `label` writes the two keys ("Ctrl+K X"). */
  | { readonly kind: "letter"; readonly letter: string; readonly label: string }
  /** Any other key: it is not bound; `label` writes the two keys ("Ctrl+K Alt+N"). */
  | { readonly kind: "unbound"; readonly label: string };

const MODIFIERS: ReadonlySet<string> = new Set([
  "Control",
  "Meta",
  "Shift",
  "Alt",
  "AltGraph",
  "CapsLock",
  "OS",
]);

const LATIN = /^[a-z]$/i;
const LETTER_CODE = /^Key[A-Z]$/;

/**
 * The Latin letter of the key, lower case: by the key, or, when the key is no Latin letter (a non-Latin
 * layout, or Option on macOS), by its place (`KeyL`), as `keys.ts` does for Alt (`prefixStep` ignores a
 * key while an input method composes).
 */
const letterOf = (event: PrefixPress): string | undefined => {
  if (LATIN.test(event.key)) {
    return event.key.toLowerCase();
  }
  const place = event.code ?? "";
  return LETTER_CODE.test(place) ? place.slice(3).toLowerCase() : undefined;
};

/**
 * The key with the modifiers held, as `pressLabel` writes it ("Alt+N", or "⌥N" on macOS), its letter read as
 * `letterOf` reads it.
 */
const pressedLabel = (event: PrefixPress, mac: boolean): string =>
  pressLabel({ ...event, key: letterOf(event) ?? event.key }, mac);

/**
 * Whether the modifiers of `event` allow a letter after the prefix: none, or the prefix modifier held
 * (Emacs „C-k C-l“): Ctrl or Cmd off macOS, Cmd only on macOS, where the physical Ctrl key with a letter
 * is never a shortcut (#547). Shift and Alt make it another key.
 */
const plainOrPrefixed = (event: PrefixPress, mac: boolean): boolean =>
  !event.shiftKey && !event.altKey && !(mac && event.ctrlKey);

/** The rule for a key while the prefix waits (SR-109 AK3). */
export const prefixStep = (event: PrefixPress, mac: boolean): PrefixStep => {
  if (MODIFIERS.has(event.key) || event.isComposing === true) {
    return { kind: "ignore" };
  }
  if (matches(event, PREFIX, mac)) {
    return event.repeat === true ? { kind: "ignore" } : { kind: "show" };
  }
  if (event.key === "Escape") {
    return { kind: "cancel" };
  }
  const label = `${shortcutLabel(PREFIX, mac)} ${pressedLabel(event, mac)}`;
  const letter = letterOf(event);
  return letter !== undefined && plainOrPrefixed(event, mac)
    ? { kind: "letter", letter, label: prefixLabel(letter, mac) }
    : { kind: "unbound", label };
};

/** A row of the list of next keys: the letter, upper case, and the entry it runs. */
export interface NextKey {
  readonly key: string;
  readonly name: string;
  readonly run: () => void;
}

/**
 * The possible next keys after the prefix: the rows whose entry the command prompt offers now (`items`),
 * so only what applies to the shown buffer (SR-133), in the order of the table.
 */
export const nextKeys = (items: readonly Choice[]): NextKey[] =>
  PREFIX_BINDINGS.flatMap((binding) => {
    const item = items.find((candidate) => candidate.id === binding.id);
    return item === undefined ? [] : [{ key: binding.key.toUpperCase(), name: item.name, run: item.run }];
  });
