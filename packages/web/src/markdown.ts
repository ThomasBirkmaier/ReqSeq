// Rendered Markdown (ADR-0020, Element content): the element text and the properties the metamodel marks
// `markdown` go through the renderer of the HTML export (`@reqseq/core/markdown`), whose allowlist writer escapes
// every text and attribute. Its HTML is the only markup a page inserts; every other string goes in as text.
// - A `reqseq:` reference becomes a hash route to its element, with the way back to the element shown.
// - Links (http, https and mailto only, as the renderer keeps them) open on a click in a new browsing context
//   without opener, and in the desktop shell through its opener of the operating system (`shell.ts`).
// - An image of the repository is read with `element.readImage` and shown from a `blob:` URL the page makes of its
//   bytes (the page CSP allows `blob:` images), revoked once the image has loaded; an image that cannot be read stays
//   its Markdown text. A diagram stays its source; a formula is set by KaTeX, whose style sheet and fonts are files
//   of the build.
import "katex/dist/katex.min.css";
import type { ImageOutcome, TextContext } from "@reqseq/core/markdown";
import { renderMarkdown } from "@reqseq/core/markdown";
import { call } from "./api.js";
import { h } from "./dom.js";
import { hashOf } from "./router.js";
import { opensOutside } from "./shell.js";
import { el, refOf } from "./store.js";

/** An image of the repository, as the renderer names it. */
type ImageLink = Parameters<TextContext["image"]>[0];

/** The element whose texts are shown; no `id` while it is not created yet. */
export interface TextOwner {
  readonly id?: string | undefined;
  readonly repository?: string | undefined;
  readonly file: string;
}

/** Image bytes from `element.readImage` as a `blob:` URL, or why the image is not shown. */
async function imageOf(owner: TextOwner, link: ImageLink, made: Set<string>): Promise<ImageOutcome> {
  const notShown = { code: "html.image-not-copied", reason: "is not shown" } as const;
  if (owner.id === undefined || link.missing) {
    return notShown;
  }
  try {
    const { content, mediaType } = await call("element.readImage", {
      ref: owner.id,
      // The command decodes the destination again, so each name goes in encoded.
      destination: link.path.split("/").map(encodeURIComponent).join("/"),
      ...(owner.repository === undefined ? {} : { repository: owner.repository }),
      file: owner.file,
    });
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const src = URL.createObjectURL(new Blob([bytes], { type: mediaType }));
    made.add(src);
    return { src };
  } catch {
    return notShown;
  }
}

/**
 * The context of the texts of `owner`, shown on the page of `from` (an encoded route, see `fromOf`); `made` collects
 * the `blob:` URLs it makes.
 */
const contextOf = (owner: TextOwner, from: string, made: Set<string>): TextContext => ({
  elementFile: owner.file,
  ignored: () => false,
  image: (link) => imageOf(owner, link, made),
  reference: ({ id }) => {
    const target = el(id);
    return {
      href: `${hashOf("e", target === undefined ? id : refOf(target))}?from=${encodeURIComponent(from)}`,
    };
  },
});

/** `text` of `owner` rendered as Markdown into a block of class `cls`. */
export async function markdown(
  text: string | undefined,
  owner: TextOwner,
  from: string,
  cls: string,
): Promise<HTMLElement> {
  const block = h("div", { class: cls });
  if (text === undefined || text.trim() === "") {
    return block;
  }
  const made = new Set<string>();
  const { html } = await renderMarkdown(text, contextOf(owner, from, made));
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const link of template.content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (/^(?:https?|mailto):/i.test(link.getAttribute("href") ?? "")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      opensOutside(link);
    }
  }
  for (const image of template.content.querySelectorAll<HTMLImageElement>("img[src^='blob:']")) {
    made.delete(image.src);
    const revoke = (): void => {
      URL.revokeObjectURL(image.src);
    };
    image.addEventListener("load", revoke, { once: true });
    image.addEventListener("error", revoke, { once: true });
  }
  // An image the renderer read but left out of the page.
  for (const src of made) {
    URL.revokeObjectURL(src);
  }
  block.append(template.content);
  return block;
}
