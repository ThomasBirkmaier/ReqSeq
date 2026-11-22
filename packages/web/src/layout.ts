// The frame of every workspace page: the rail with the workspace, the view and the sections the areas add, the
// phone bar with its menu, and the main area. An area adds a rail section with `addRailSection`.
import { explain } from "./api.js";
import type { Child } from "./dom.js";
import { h, icon } from "./dom.js";
import { hasVariants, setView, store, variantName } from "./store.js";
import { namesOf, typesWith } from "./meaning.js";

/** A link of the rail: where it leads, the key of the page it marks as current, its name and its count. */
export interface RailLink {
  readonly href: string;
  readonly key: string;
  readonly name: string;
  readonly count?: number | undefined;
  /** The count means something is broken. */
  readonly warn?: boolean;
}

export interface RailSection {
  /** Sections stand in this order. */
  readonly order: number;
  readonly title: string;
  /** Reads what `links` needs; every page with the rail awaits it first (`prepareRail`). */
  readonly prepare?: () => Promise<void>;
  readonly links: () => readonly RailLink[];
}

const sections: RailSection[] = [];

export function addRailSection(section: RailSection): void {
  sections.push(section);
  sections.sort((a, b) => a.order - b.order);
}

/** Reads what the rail sections need, before a page with the rail is drawn. */
export async function prepareRail(): Promise<void> {
  await Promise.all(sections.map(async (section) => section.prepare?.()));
}

export const railLink = (link: RailLink, current: string): HTMLAnchorElement =>
  h(
    "a",
    {
      href: link.href,
      class: `q${link.warn === true && link.count !== undefined && link.count > 0 ? " warn" : ""}`,
      "aria-current": current === link.key ? "page" : null,
    },
    h("span", { class: "qn" }, link.name),
    link.count === undefined ? null : h("b", { "data-num": `q:${link.key}` }, link.count),
  );

/** Raised on the window when the person chose another view. */
export const VIEW_CHANGED = "reqseq:view-changed";

const viewPicker = (): Child => {
  if (!hasVariants() || store.variants.length === 0) {
    return null;
  }
  const select = h(
    "select",
    { "data-view": true, "aria-describedby": "view-help" },
    h("option", { value: "core", selected: store.view === "core" }, "Core"),
    store.variants.map((v) =>
      h("option", { value: v.id, selected: store.view === v.id }, v.title ?? v.shortId),
    ),
  );
  select.addEventListener("change", () => {
    setView(select.value);
    window.dispatchEvent(new Event(VIEW_CHANGED));
  });
  return [
    h("label", { class: "viewpick" }, h("span", null, "View"), select),
    h(
      "p",
      { class: "viewhelp", id: "view-help" },
      `Core is what all ${namesOf(store.mm, typesWith(store.mm, "variant"), "variants")} share.`,
    ),
  ];
};

/** The rail; `current` is the key of the page shown. */
export function rail(current: string): HTMLElement {
  return h(
    "nav",
    { class: "rail", "aria-label": "Workspace" },
    h("button", { class: "btn sm menu-close", type: "button", "data-menu-close": true }, "Close menu"),
    h("div", { class: "ws" }, icon.logo(), h("span", { class: "wsn" }, store.workspaceName)),
    viewPicker(),
    h(
      "div",
      { class: "rail-scroll" },
      sections.map((section, at) => {
        const links = section.links();
        if (links.length === 0) {
          return null;
        }
        const id = `rs-${String(at)}`;
        return [
          h("h2", { class: "rs", id }, section.title),
          h(
            "div",
            { role: "group", "aria-labelledby": id },
            links.map((link) => railLink(link, current)),
          ),
        ];
      }),
      store.view === "core"
        ? null
        : h("p", { class: "viewnote" }, `Verification shown for ${variantName(store.view)}.`),
    ),
  );
}

/** The phone bar: which workspace is open, and the menu. */
const mobileNav = (): HTMLElement =>
  h(
    "div",
    { class: "mobile-nav" },
    h("span", { class: "mn-ws" }, store.workspaceName),
    h(
      "button",
      {
        class: "iconbtn mn-b",
        type: "button",
        "data-menu": true,
        "aria-expanded": "false",
        "aria-label": "Menu",
      },
      icon.menu(),
    ),
  );

/** A workspace page: rail, phone bar and `main`. `wide` gives the main area the room of the list and the panel. */
export function frame(current: string, main: Child, { wide = false } = {}): HTMLElement {
  return h(
    "div",
    { class: `app${wide ? " wide" : ""}` },
    mobileNav(),
    rail(current),
    h("div", { class: "menu-backdrop", "aria-hidden": "true" }),
    h("main", { id: "main", tabindex: -1, class: "mainarea" }, main),
  );
}

/** The phone menu: the rail over the page; the page behind is inert until it closes. */
export function setMenu(root: Element, open: boolean): void {
  const app = root.querySelector(".app");
  if (app === null) {
    return;
  }
  app.classList.toggle("menu-open", open);
  const main = root.querySelector<HTMLElement>("#main");
  const bar = root.querySelector<HTMLElement>(".mobile-nav");
  if (main !== null) {
    main.inert = open;
  }
  if (bar !== null) {
    bar.inert = open;
  }
  const button = root.querySelector<HTMLElement>("[data-menu]");
  button?.setAttribute("aria-expanded", String(open));
  (open ? root.querySelector<HTMLElement>("[data-menu-close]") : button)?.focus();
}

/** What went wrong, in plain words, with ReqSeq's own text under "Details from ReqSeq". */
export function errorBox(error: unknown): HTMLElement {
  const x = explain(error);
  return h(
    "div",
    { class: "notice bad", role: "alert" },
    h("strong", null, x.what),
    " ",
    x.todo,
    h("details", null, h("summary", null, "Details from ReqSeq"), h("pre", null, x.detail)),
  );
}

/**
 * Shows, until it is closed, the reason the server gave for not marking the workspace it opened as opened
 * (SR-247 AK12): the workspace is open, it is only not first in the recent workspaces. Outside the page's
 * root, so a redraw keeps it. Another opening replaces it: with its reason, or without one removes it.
 */
export function showNotMarked(reason: string | undefined): void {
  document.getElementById("not-marked")?.remove();
  if (reason === undefined) {
    return;
  }
  const box = h(
    "div",
    { id: "not-marked", class: "notice bad not-marked", role: "status" },
    h("strong", null, "This workspace is open but not first in the recent workspaces."),
    " ",
    reason,
    " ",
  );
  const close = h("button", { type: "button", class: "btn sm" }, "Close");
  close.addEventListener("click", () => {
    box.remove();
  });
  box.append(close);
  document.body.append(box);
}

/** A page of its own for a message: no workspace, no token, an error. */
export function messagePage(title: string, ...body: Child[]): HTMLElement {
  return h(
    "main",
    { id: "main", class: "nows", tabindex: -1 },
    h("div", { class: "nows-card" }, h("h1", null, title), body),
  );
}
