// What the element buffer does around a save, as pure functions (autosave, #401, uses them too). The
// saved text is exactly the editor document; the input of `element.update` is built in `property-edit.ts`.

/** Whether the document differs from the text last loaded or saved. */
export const dirty = (doc: string, baseline: string): boolean => doc !== baseline;

/**
 * After a save: the text `element.update` gives back is the new baseline. When the document is still what
 * was sent and the answer differs (core added the final line break, ADR-0004), `replace` is the answer, so
 * the editor shows what the file holds.
 */
export const afterSave = (
  sent: string,
  answer: string,
  doc: string,
): { readonly baseline: string; readonly replace?: string } => ({
  baseline: answer,
  ...(doc === sent && answer !== sent ? { replace: answer } : {}),
});
