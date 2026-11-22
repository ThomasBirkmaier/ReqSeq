// Hash routes (ADR-0020, Front end): `#/<area>/<part>/...?<params>`. Each area module registers the first part
// of its routes with `addRoute`, so areas can be added side by side without touching each other.

export interface Route {
  /** The hash without `#`, as the page was asked for, such as `/e/SR-036?from=/q/drafts`. */
  readonly hash: string;
  /** The parts of the path, decoded: `["e", "SR-036"]`. */
  readonly parts: readonly string[];
  readonly params: URLSearchParams;
}

/** Draws the page of `route` into `root`. */
export type Render = (root: HTMLElement, route: Route) => Promise<void>;

/** Where the page goes without a route, or with one no area knows. */
export const HOME = "/q/overview";

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
};

/** The route of `hash` (with or without `#`); an empty one is `HOME`. */
export function parseHash(hash: string): Route {
  const bare = hash.replace(/^#/, "");
  const full = bare === "" || bare === "/" ? HOME : bare;
  const at = full.indexOf("?");
  const path = at === -1 ? full : full.slice(0, at);
  const query = at === -1 ? "" : full.slice(at + 1);
  return {
    hash: full,
    parts: path
      .split("/")
      .filter((p) => p !== "")
      .map(decode),
    params: new URLSearchParams(query),
  };
}

/** Whether the page still shows `route`: a render that finishes after the person moved on draws nothing. */
export const isCurrent = (route: Route): boolean => parseHash(location.hash).hash === route.hash;

/** The hash of a route to `parts`, each encoded. */
export const hashOf = (...parts: readonly string[]): string => `#/${parts.map(encodeURIComponent).join("/")}`;

/** The route to `parts` as the `from` parameter of another route names it: encoded, without `#`. */
export const fromOf = (...parts: readonly string[]): string => hashOf(...parts).slice(1);

/** `href` with the way back to the route of `parts`. */
export const withFrom = (href: string, ...parts: readonly string[]): string =>
  `${href}?from=${encodeURIComponent(fromOf(...parts))}`;

const routes = new Map<string, Render>();

/** Registers the routes whose first part is `first`. */
export function addRoute(first: string, render: Render): void {
  routes.set(first, render);
}

/** The render of `route`, or undefined when no area has it. */
export const renderOf = (route: Route): Render | undefined => routes.get(route.parts[0] ?? "");
