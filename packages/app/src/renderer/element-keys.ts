// Which key presses on the element buffer are its own (SR-104, SR-122, SR-128), as small functions over the
// event target: the field a key is for, whether the buffer takes it, the keys it handles on a field, and the
// keys that take back an "Edit text" still waiting for its editor. `ElementView` routes the keys with them.

/** The field a key press is for: none on the buffer itself. */
export const fieldLabel = (target: EventTarget, buffer: EventTarget): string | undefined =>
  target === buffer
    ? undefined
    : (target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset["field"];

/** A key press is for the buffer when its target is the buffer, or a field that has the focus itself (SR-128). */
export const forBuffer = (target: EventTarget, buffer: EventTarget): boolean =>
  target === buffer || (target instanceof HTMLElement && target.matches(".field[tabindex]"));

/**
 * A key the buffer handles: Enter, Down when there is a field or the elements of a package to go to, and
 * Escape and Up on a field (on the buffer itself they are not for it).
 */
export const fieldKey = (key: string, label: string | undefined, hasMembers: boolean): boolean =>
  key === "Enter" ||
  (key === "ArrowDown" && (label !== undefined || hasMembers)) ||
  (label !== undefined && (key === "Escape" || key === "ArrowUp"));

/** Keys that only modify another key: pressed on their own they are no key of the buffer. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta"]);

/** A key on the buffer after Enter that takes back an "Edit text" still waiting for the editor. */
export const takesBackEdit = (key: string): boolean => key !== "Enter" && !MODIFIER_KEYS.has(key);
