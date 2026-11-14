// What is under the pointer for a swipe (SR-211, `buffer-swipe.ts`): content that scrolls sideways first (AK5),
// the element a held-back vertical distance scrolls, and a wheel event's deltas in px.

const SCROLLS = new Set(["auto", "scroll", "overlay"]);

const scrollsX = (element: Element): boolean =>
  element.scrollWidth > element.clientWidth + 1 && SCROLLS.has(getComputedStyle(element).overflowX);

const scrollsY = (element: Element): boolean =>
  element.scrollHeight > element.clientHeight + 1 && SCROLLS.has(getComputedStyle(element).overflowY);

/** `element` and its ancestors up to `stop`, `stop` included when it is one of them. */
const upTo = function* (element: Element | null, stop: Element): Generator<Element> {
  for (let at = element; at !== null; at = at.parentElement) {
    yield at;
    if (at === stop) {
      return;
    }
  }
};

/**
 * Whether `under`, or an ancestor of it up to `stop`, scrolls sideways and is not at its edge in the direction
 * of `sign`: -1 for dX < 0, which scrolls toward the start, 1 toward the end (AK5).
 */
export const scrollsFirst = (under: Element, stop: Element, sign: -1 | 1): boolean => {
  for (const element of upTo(under, stop)) {
    if (!scrollsX(element)) {
      continue;
    }
    const left = element.scrollLeft;
    if (sign < 0 ? left > 0.5 : left + element.clientWidth < element.scrollWidth - 1) {
      return true;
    }
  }
  return false;
};

/** The nearest element from `under` up to `stop` that scrolls vertically, if any. */
export const verticalScroller = (under: Element, stop: Element): Element | undefined => {
  for (const element of upTo(under, stop)) {
    if (scrollsY(element)) {
      return element;
    }
  }
  return undefined;
};

/** The px of a line of a wheel that counts in lines (`deltaMode` 1). */
export const LINE_PX = 16;

/** The deltas of `event` in px; a page (`deltaMode` 2) is `page` px wide. */
export const wheelPixels = (
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
  page: number,
): { readonly dx: number; readonly dy: number } => {
  const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? page : 1;
  return { dx: event.deltaX * unit, dy: event.deltaY * unit };
};
