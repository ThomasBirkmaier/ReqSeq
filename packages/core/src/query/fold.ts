// How names and texts compare ignoring case and Unicode normal form, in core and in the app. The renderer
// imports it as `@reqseq/core/fold`, so this module imports nothing.

/** A text as conditions and sorting compare it ignoring case: NFC, lower case. */
export const fold = (text: string): string => text.normalize("NFC").toLowerCase();
