// Which key presses on the element buffer are its own (SR-104, SR-122, SR-128), as small functions over the
// event target: the field a key is for, whether the buffer takes it, the keys it handles on a field, and the
// keys that take back an "Edit text" still waiting for its editor. `ElementView` routes the keys with them.
import type { KeyPress, KeyRow } from "./keys.js";
import { MOD_CLICK, press } from "./keys.js";

/** The field a key press is for: none on the buffer itself. */
export const fieldLabel = (target: EventTarget, buffer: EventTarget): string | undefined =>
  target === buffer
    ? undefined
    : (target as HTMLElement).closest<HTMLElement>("[data-field]")?.dataset["field"];

/** A key press is for the buffer when its target is the buffer, or a field that has the focus itself (SR-128). */
export const forBuffer = (target: EventTarget, buffer: EventTarget): boolean =>
  target === buffer || (target instanceof HTMLElement && target.matches(".field[tabindex]"));

/**
 * A key the buffer handles: Enter, Down (on the element to its first field or the elements of a package, on a
 * field to the next one), and Escape and Up on a field (on the buffer itself they are not for it).
 */
export const fieldKey = (key: string, label: string | undefined): boolean =>
  key === "Enter" || key === "ArrowDown" || (label !== undefined && (key === "Escape" || key === "ArrowUp"));

/** Keys that only modify another key: pressed on their own they are no key of the buffer. */
export const MODIFIER_KEYS: ReadonlySet<string> = new Set(["Shift", "Control", "Alt", "Meta"]);

/** A key on the buffer after Enter that takes back an "Edit text" still waiting for the editor. */
export const takesBackEdit = (key: string): boolean => key !== "Enter" && !MODIFIER_KEYS.has(key);

/** The keys `fieldKey` takes on a field of the element buffer, all without a modifier (SR-139 AK5). */
export const FIELD_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("Enter") }],
    does: "On the element: put the cursor into the text (“Edit text”); on the title: into the title (“Edit title”); on a box: into the box, or on a choice or relation box the prompt for its value",
  },
  {
    keys: [{ press: press("ArrowDown") }],
    does: "On the element: to its first field (SR-155), on a package page into its elements; on a field: to the next field; from the last field into the elements of a package page",
  },
  { keys: [{ press: press("ArrowUp") }], does: "On a field: to the field before" },
  {
    keys: [{ press: press("Escape") }],
    does: "In the text or a box: back to its field; on a field: back to the element",
  },
];

/**
 * The keys of a package page's elements (SR-122 AK4): `ctrlStep` on the page (`ElementView`) and `leavesPart` in
 * its list (`ListView`).
 */
export const PACKAGE_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("n", true) }],
    does: "On a package page: select its first element (the physical Ctrl key, also on macOS)",
  },
  {
    keys: [{ press: press("Escape") }, { press: press("ArrowUp") }, { press: press("p", true) }],
    does: "In the elements of a package page: back to the page (Up and Ctrl+P on the first row)",
  },
];

/**
 * Enter in the title and in a box with one value (`TitleBox`, `TextBox`): it leaves for the field, before the
 * Markdown keymap; in a box with several values it adds a line.
 */
export const LEAVE_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("Enter") }, { press: { ...press("Enter"), shiftKey: true } }],
    does: "In the title or a box with one value: back to its field; in a box with several values, Enter starts the next value",
  },
];

/** What a key does on the block "On disk" (SR-106, `OnDisk.tsx`): Enter resolves, Escape leaves; only without modifiers. */
export const onDiskKey = (event: KeyPress): "resolve" | "leave" | undefined => {
  const plain = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  return !plain
    ? undefined
    : event.key === "Enter"
      ? "resolve"
      : event.key === "Escape"
        ? "leave"
        : undefined;
};

/**
 * The keys of the block "On disk" (`onDiskKey`), of the links to parents, variants and relation targets
 * (`ParentsLine`, `VariantLines`, `RelationLink`), and the click on a value (`isModClick`, in `ElementView`).
 */
export const ELEMENT_MORE_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("Enter") }],
    does: "On the block “On disk” of a field changed on disk: ask which version holds, as “Resolve change on disk” does",
  },
  { keys: [{ press: press("Escape") }], does: "On the block “On disk”: back to the buffer" },
  {
    keys: [{ press: press("Enter") }],
    does: "On a link to a parent, a variant or the target in a relation box: open that element",
  },
  {
    keys: [{ shortcut: MOD_CLICK }],
    does: "Click on a value in a property box: list the elements with that value",
  },
];
