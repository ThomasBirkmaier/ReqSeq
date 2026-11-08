// The slash menu in motion (SR-129 AK5): it looks and moves like the card of the command line (SR-182).
// When the menu of @codemirror/autocomplete appears, a seam as wide as its shadow is put around its list
// and a backdrop that dims the whole window behind it; the menu, the seam and the backdrop show by one
// progress, the menu grows from the caret. When the menu goes, a copy of it runs the motion back, shorter,
// with the backdrop. The times are the `--card-*` tokens of styles.css; without motion everything stands at
// once and goes at once. The backdrop takes no click: the menu stays no dialog (D-062).
import { ViewPlugin } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";

/** The class the slash menu's tooltip carries (`tooltipClass` in `slash-menu.ts`). */
export const SLASH_CLASS = "cm-lr-slash";

/** The class of the copy that runs back, and of the backdrop on its way out. */
export const LEAVING_CLASS = "cm-lr-slash-leaving";

/** How long a copy may stay when no animation ends, such as in a hidden window (ms). */
const GONE_MS = 1000;

const isMenu = (node: Node): node is HTMLElement =>
  node instanceof HTMLElement &&
  node.classList.contains(SLASH_CLASS) &&
  !node.classList.contains(LEAVING_CLASS);

/** Runs `node`'s way out, and removes it when its animation ends; at once without one. */
const goOut = (node: HTMLElement): void => {
  node.classList.add(LEAVING_CLASS);
  node.dataset["motion"] = "out";
  const { animationName } = getComputedStyle(node);
  if (animationName === "" || animationName === "none") {
    node.remove();
    return;
  }
  const gone = (): void => {
    node.remove();
  };
  node.addEventListener("animationend", (event) => {
    if (event.target === node) {
      gone();
    }
  });
  setTimeout(gone, GONE_MS);
};

/** A copy of the menu that says nothing to a screen reader, takes no key and no click, and shows the rows it showed. */
const copyOf = (menu: HTMLElement): HTMLElement => {
  const copy = menu.cloneNode(true) as HTMLElement;
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    for (const name of [
      "id",
      "role",
      "aria-label",
      "aria-selected",
      "aria-controls",
      "aria-activedescendant",
    ]) {
      element.removeAttribute(name);
    }
  }
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  return copy;
};

class SlashMotion {
  private readonly view: EditorView;
  private readonly observer: MutationObserver;
  private backdrop: HTMLElement | undefined;
  private menu: HTMLElement | undefined;

  constructor(view: EditorView) {
    this.view = view;
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (this.menu !== undefined && node === this.menu) {
            this.leave(this.menu, record.target);
          }
        }
        for (const node of record.addedNodes) {
          if (isMenu(node)) {
            this.appear(node);
          }
        }
      }
    });
    this.observer.observe(view.dom, { childList: true });
  }

  private appear(menu: HTMLElement): void {
    for (const old of this.view.dom.querySelectorAll(`.${LEAVING_CLASS}`)) {
      old.remove();
    }
    this.backdrop?.remove();
    const seam = document.createElement("div");
    seam.className = "slash-seam";
    seam.setAttribute("aria-hidden", "true");
    menu.prepend(seam);
    const backdrop = document.createElement("div");
    backdrop.className = "slash-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    for (const node of [menu, backdrop]) {
      node.dataset["motion"] = "in";
    }
    menu.before(backdrop);
    this.menu = menu;
    this.backdrop = backdrop;
  }

  private leave(menu: HTMLElement, parent: Node): void {
    const copy = copyOf(menu);
    parent.appendChild(copy);
    const list = menu.querySelector("ul");
    const shown = copy.querySelector("ul");
    if (list !== null && shown !== null) {
      shown.scrollTop = list.scrollTop;
    }
    goOut(copy);
    if (this.backdrop !== undefined) {
      // A copy as well: the same animation name on the same node would not start again.
      const backdrop = this.backdrop.cloneNode() as HTMLElement;
      this.backdrop.replaceWith(backdrop);
      goOut(backdrop);
    }
    this.menu = undefined;
    this.backdrop = undefined;
  }

  destroy(): void {
    this.observer.disconnect();
    this.backdrop?.remove();
    for (const old of this.view.dom.querySelectorAll(`.${LEAVING_CLASS}`)) {
      old.remove();
    }
  }
}

/** The motion and the backdrop of the slash menu, as an editor extension. */
export const slashMotion = ViewPlugin.fromClass(SlashMotion);
