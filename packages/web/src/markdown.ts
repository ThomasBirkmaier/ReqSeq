// Rendered Markdown (ADR-0020, Element content): the element text and the properties the metamodel marks
// `markdown` go through the renderer of the HTML export (`@reqseq/core/markdown`), whose allowlist writer escapes
// every text and attribute. Its HTML is the only markup a page inserts; every other string goes in as text.
// - A `reqseq:` reference becomes a hash route to its element, with the way back to the element shown.
// - Links (http, https and mailto only, as the renderer keeps them) open on a click in a new browsing context
//   without opener.
// - An image of the repository stays its Markdown text until a command reads image files; a diagram stays its
//   source; a formula is set by KaTeX, whose style sheet and fonts are files of the build.
import "katex/dist/katex.min.css";
import type { TextContext } from "@reqseq/core/markdown";
import { renderMarkdown } from "@reqseq/core/markdown";
import { h } from "./dom.js";
import { hashOf } from "./router.js";
import { el, refOf } from "./store.js";

/** The context of the texts of the element in `file`, shown on the page of `from` (an encoded route, see `fromOf`). */
const contextOf = (file: string, from: string): TextContext => ({
  elementFile: file,
  ignored: () => false,
  image: (link) => Promise.resolve({ code: "html.image-not-copied", reason: `${link.path} is not shown` }),
  reference: ({ id }) => {
    const target = el(id);
    return {
      href: `${hashOf("e", target === undefined ? id : refOf(target))}?from=${encodeURIComponent(from)}`,
    };
  },
});

/** `text` rendered as Markdown into a block of class `cls`. */
export async function markdown(
  text: string | undefined,
  file: string,
  from: string,
  cls: string,
): Promise<HTMLElement> {
  const block = h("div", { class: cls });
  if (text === undefined || text.trim() === "") {
    return block;
  }
  const { html } = await renderMarkdown(text, contextOf(file, from));
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const link of template.content.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (/^(?:https?|mailto):/i.test(link.getAttribute("href") ?? "")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
  block.append(template.content);
  return block;
}
