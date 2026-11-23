// How names and texts compare ignoring case and Unicode normal form. The display models import it
// (ADR-0019), so this module imports nothing.

/** A text as conditions and sorting compare it ignoring case: NFC, lower case. */
export const fold = (text: string): string => text.normalize("NFC").toLowerCase();
