// The title in its heading (#621): what the heading shows while the title is not edited, and where a click
// on it puts the caret, as pure functions (`TitleBox.tsx` is the component).

/** What the closed heading shows: the title, or for an empty title (blank only too) the identifier or short ID, muted. */
export interface TitleHeading {
  readonly text: string;
  readonly untitled: boolean;
}

/** The heading of a title; `id` is what the element is named by when it has none. */
export const titleHeading = (title: string, id: string): TitleHeading =>
  title.trim() === "" ? { text: id, untitled: true } : { text: title, untitled: false };

/**
 * Where a click on the closed heading puts the caret in the title: at the offset the click hit in the
 * heading's text (`hit`, from the browser), within the title; at the end when it hit no text of the title
 * (the heading of an empty title shows the ID).
 */
export const clickOffset = (heading: TitleHeading, title: string, hit: number | undefined): number | "end" =>
  heading.untitled || hit === undefined ? "end" : Math.min(Math.max(hit, 0), title.length);
