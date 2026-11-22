// The pages of one element: the element page (`#/e/<ref>`) and the pages other areas add for the same element,
// such as its evidence or its trace graph. Each is a tab in the top bar, and every tab keeps the way back the
// element page was opened with (`?from=<route>`). An area adds a tab with `addElementTab`.
import "./css/sub.css";
import type { Child } from "./dom.js";
import { h, icon } from "./dom.js";
import type { ElementPart } from "./store.js";
import { el, refOf } from "./store.js";
import { queueOf } from "./queues.js";
import type { Route } from "./router.js";
import { HOME, hashOf, parseHash } from "./router.js";

/** What the tabs and the way back need of an element. */
export interface ElementHead {
  readonly identifier?: string;
  readonly shortId: string;
  readonly type?: string;
}

export interface ElementTab {
  /** The first part of the tab's route: `#/<route>/<ref>`. */
  readonly route: string;
  readonly name: string;
  /** Tabs stand in this order; the element page is 0. */
  readonly order: number;
  /** Whether the tab is there for an element of `type`; default every element. */
  readonly applies?: (type: string | undefined) => boolean;
}

const tabs: ElementTab[] = [{ route: "e", name: "Element", order: 0 }];

export function addElementTab(tab: ElementTab): void {
  tabs.push(tab);
  tabs.sort((a, b) => a.order - b.order);
}

/** The route of the tab `route` of the element `e`, with the way back `from` (an encoded route, or none). */
export const tabHref = (
  route: string,
  e: Pick<ElementPart, "identifier" | "shortId">,
  from: string | null,
  params: Readonly<Record<string, string>> = {},
): string => {
  const query = new URLSearchParams(params);
  if (from !== null) {
    query.set("from", from);
  }
  const text = query.toString();
  return `${hashOf(route, refOf(e))}${text === "" ? "" : `?${text}`}`;
};

/** The tabs of the element `e`; `current` is the route of the page shown. */
export function elementTabs(e: ElementHead, current: string, from: string | null): HTMLElement | null {
  const shown = tabs.filter((tab) => tab.applies?.(e.type) ?? true);
  if (shown.length < 2) {
    return null;
  }
  return h(
    "nav",
    { class: "etabs", "aria-label": "Pages of this element" },
    shown.map((tab) =>
      h(
        "a",
        { href: tabHref(tab.route, e, from), "aria-current": tab.route === current ? "page" : null },
        tab.name,
      ),
    ),
  );
}

/** The name of a page as the way back to it names it, by the first part of its route. */
const places = new Map<string, (route: Route) => string | undefined>([
  ["q", (route) => (route.parts[1] === undefined ? undefined : queueOf(route.parts[1])?.title())],
]);

/** Names the pages whose route starts with `first` for the way back to them ("Back to <name>"). */
export function addPlace(first: string, name: (route: Route) => string | undefined): void {
  places.set(first, name);
}

/**
 * The way back to the page `from` (an encoded route): its name as its area gives it, else the element its
 * route names (the element page and its tabs), else the overview.
 */
export function backOf(from: string | null): { readonly href: string; readonly title: string } {
  const route = parseHash(from ?? HOME);
  const [area, part] = route.parts;
  const e = part === undefined ? undefined : el(part);
  const title =
    (area === undefined ? undefined : places.get(area)?.(route)) ??
    (e === undefined ? undefined : (e.identifier ?? e.title ?? part)) ??
    (area === "e" ? part : undefined) ??
    "Overview";
  return { href: `#${route.hash}`, title };
}

/** The top bar of a page of one element: the way back and the element's tabs. */
export const elementTopbar = (e: ElementHead | undefined, current: string, route: Route): HTMLElement => {
  const from = route.params.get("from");
  const back = backOf(from);
  return h(
    "header",
    { class: "topbar" },
    h("a", { class: "back", href: back.href }, icon.back(), h("span", null, `Back to ${back.title}`)),
    e === undefined ? null : elementTabs(e, current, from),
  );
};

/** A page of one element other than the element page: top bar, then `main` with `body`. */
export const elementPage = (
  e: ElementHead | undefined,
  current: string,
  route: Route,
  ...body: Child[]
): HTMLElement =>
  h(
    "div",
    { class: "page-bg" },
    elementTopbar(e, current, route),
    h("main", { id: "main", class: "sub-wrap", tabindex: -1 }, h("div", { class: "sub" }, body)),
  );
