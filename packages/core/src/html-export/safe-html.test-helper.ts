// The check the tests of the HTML export run on written HTML (SR-235 AK4): every tag on the writer's
// list, of an error the export writes (`span`) or of the element page's own sections (the list of fields, `dl`, and
// its copy buttons with their icon), no event attribute, and no address outside the export. It reads the HTML independently of the writer.
import { expect } from "vitest";

const TAGS = new Set(
  "p h1 h2 h3 h4 h5 h6 em strong del code pre blockquote ul ol li table thead tbody tr th td a img br hr input sup section aside div span dl dt dd button svg rect path".split(
    " ",
  ),
);

/** The content of a written page: what its content slot holds (`page.ts`), without the docs' frame. */
export const contentOf = (page: string): string =>
  page.slice(page.indexOf('<div class="sl-markdown-content">') + 33, page.indexOf("</div><footer"));

/** Fails unless every tag of `html` is on the list, with no event attribute and no address outside the export. */
export const expectSafe = (html: string): void => {
  for (const match of html.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)([^>]*)>/g)) {
    expect(TAGS.has(String(match[1]))).toBe(true);
    for (const attribute of String(match[2]).matchAll(/([a-z-]+)(?:="([^"]*)")?/g)) {
      const name = String(attribute[1]);
      const value = String(attribute[2]);
      expect(name.startsWith("on")).toBe(false);
      if (name === "href") {
        expect(value).toMatch(/^(https?:|mailto:|#)/);
      }
      if (name === "src") {
        expect(value).toMatch(/^\.\.\/images\//);
      }
    }
  }
};
