// Browser storage holds preferences only, each with a default (ADR-0020, Front end): when storage is blocked,
// the default applies and the choice lasts for this page.

const PREFIX = "reqseq.";
const kept = new Map<string, string>();

/** The preference `name`, or `fallback` when none is stored. */
export function preference(name: string, fallback: string): string {
  try {
    return window.localStorage.getItem(PREFIX + name) ?? kept.get(name) ?? fallback;
  } catch {
    return kept.get(name) ?? fallback;
  }
}

export function setPreference(name: string, value: string): void {
  kept.set(name, value);
  try {
    window.localStorage.setItem(PREFIX + name, value);
  } catch {
    // Not stored; it still applies to this page.
  }
}
