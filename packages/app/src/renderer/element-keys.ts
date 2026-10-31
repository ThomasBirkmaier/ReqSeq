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

/**
 * The keys of the element buffer for the keyboard reference (SR-139 AK5): those `fieldKey` takes, and the keys of
 * `boxNavigation` (`editor/box-navigation.ts`), which on macOS also moves with the physical Ctrl+N and Ctrl+P.
 */
export const ELEMENT_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("Enter") }],
    does: "Put the cursor into the text, or into the property box that has the focus; on a choice or relation box, open the prompt for its value",
  },
  {
    keys: [{ press: press("ArrowDown") }, { press: press("n", true), only: "mac" }],
    does: "To the next field; in the text or a box, from its last line to the next box",
  },
  {
    keys: [{ press: press("ArrowUp") }, { press: press("p", true), only: "mac" }],
    does: "To the field before; in the text or a box, from its first line to the box before",
  },
  {
    keys: [{ press: press("Escape") }],
    does: "From the text or a box back to its field, and from a field back to the element",
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
 * The keys of the block "On disk" (`onDiskKey`), of the links to parents and variants (`ParentsLine`,
 * `VariantLines`), and the click on a value (`isModClick`, in `ElementView`).
 */
export const ELEMENT_MORE_KEYS: readonly KeyRow[] = [
  {
    keys: [{ press: press("Enter") }],
    does: "On the block “On disk” of a field changed on disk: ask which version holds, as “Resolve change on disk” does",
  },
  { keys: [{ press: press("Escape") }], does: "On the block “On disk”: back to the buffer" },
  {
    keys: [{ press: press("Enter") }],
    does: "On a link to a parent or a variant: open that element",
  },
  {
    keys: [{ shortcut: MOD_CLICK }],
    does: "Click on a value in a property box: list the elements with that value",
  },
];
