// Start of the page: the token first (before the router reads the address), then the event stream, the store
// and the route. Each area registers its routes and rail sections when it is imported.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./css/base.css";
import { applyTheme } from "./theme.js";
import { ReqSeqError, TOKEN_REFUSED, WORKSPACE_CHANGED, setGeneration, useToken } from "./api.js";
import { announce, h } from "./dom.js";
import type { ServerEvent } from "./events.js";
import { listen } from "./events.js";
import { VIEW_CHANGED, errorBox, messagePage, setMenu } from "./layout.js";
import { reveal } from "./motion.js";
import { HOME, parseHash, renderOf } from "./router.js";
import { load } from "./store.js";
import { forgetToken, pagePlace, takeToken } from "./token.js";
// The areas.
import "./areas/overview.js";
import "./areas/element.js";
import "./areas/edit.js";
import "./areas/evidence.js";
import "./areas/trace.js";
import "./areas/matrix.js";
import "./areas/variants.js";
import "./areas/changes.js";
import { WORKSPACES, WORKSPACE_OPENED, isWorkspaceOpen, setWorkspaceOpen } from "./areas/workspace.js";

applyTheme();

const root = document.getElementById("app") ?? document.body;
let stopped = false;
/** Whether a page of its own was shown; a function, since it changes while a render waits. */
const isStopped = (): boolean => stopped;
let rendering = 0;

/** Shows a page of its own and stops: no further call is made. */
function stop(title: string, text: string): void {
  stopped = true;
  root.replaceChildren(messagePage(title, h("p", null, text)));
  root.setAttribute("aria-busy", "false");
  document.title = `${title} · ReqSeq`;
}

const noToken = (): void => {
  stop(
    "Open the address reqseq ui printed",
    "This page has no valid key to the server. Open the address that reqseq ui printed when it started, with everything after the # sign; after a restart of reqseq ui, the new address it printed.",
  );
};

/** Draws the page of the current address. A render that a newer one overtook leaves the page alone. */
async function route({ keepFocus = false } = {}): Promise<void> {
  if (stopped) {
    return;
  }
  const mine = ++rendering;
  const current = parseHash(location.hash);
  const render = renderOf(current);
  if (!isWorkspaceOpen() && current.hash !== WORKSPACES) {
    location.replace(`#${WORKSPACES}`);
    return;
  }
  if (render === undefined) {
    location.replace(`#${HOME}`);
    return;
  }
  root.setAttribute("aria-busy", "true");
  try {
    await render(root, current);
  } catch (error) {
    if (mine === rendering && !isStopped()) {
      root.replaceChildren(
        messagePage(
          "Something went wrong",
          errorBox(error),
          h("p", null, h("a", { class: "btn", href: `#${HOME}` }, "Back to overview")),
        ),
      );
    }
  }
  if (mine !== rendering || isStopped()) {
    return;
  }
  root.setAttribute("aria-busy", "false");
  root.dataset["route"] = current.hash;
  if (!keepFocus) {
    const heading = root.querySelector<HTMLElement>("h1");
    if (heading !== null) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }
}

/** No workspace is open: the page to open or create one (area `workspace`) is the only one drawn. */
function noWorkspace(): void {
  setWorkspaceOpen(false);
  if (parseHash(location.hash).hash === WORKSPACES) {
    void route();
  } else {
    location.replace(`#${WORKSPACES}`);
  }
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** After a change of the workspace: read again and draw the page again, keeping focus and scroll. */
async function refresh(ids: readonly string[]): Promise<void> {
  try {
    await load();
  } catch (error) {
    if (error instanceof ReqSeqError && error.code === "workspace.not-found") {
      noWorkspace();
    }
    return;
  }
  const scrolls = [...root.querySelectorAll(".lscroll, .trace-wrap, .mscroll, .gscroll")].map((x) => [
    x.scrollTop,
    x.scrollLeft,
  ]);
  setWorkspaceOpen(true);
  await route({ keepFocus: true });
  root.querySelectorAll(".lscroll, .trace-wrap, .mscroll, .gscroll").forEach((x, at) => {
    x.scrollTop = scrolls[at]?.[0] ?? 0;
    x.scrollLeft = scrolls[at]?.[1] ?? 0;
  });
  reveal(root, ids);
  announce("The workspace changed. The page is up to date.");
}

const later = (ids: readonly string[]): void => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refresh(ids), 300);
};

let generation: number | undefined;
let started = false;

async function start(): Promise<void> {
  try {
    await load();
  } catch (error) {
    if (error instanceof ReqSeqError && error.code === "workspace.not-found") {
      noWorkspace();
      return;
    }
    if (!stopped) {
      root.replaceChildren(messagePage("The workspace could not be read", errorBox(error)));
      root.setAttribute("aria-busy", "false");
    }
    return;
  }
  await route();
}

/** The page may miss changes (a lost stream, a refused command): it reads again on the next `workspace` event. */
let stale = false;

function onEvent(event: ServerEvent): void {
  switch (event.type) {
    case "workspace": {
      const changed = generation !== event.generation;
      const first = generation === undefined;
      generation = event.generation;
      setGeneration(event.generation);
      if (first && !started) {
        started = true;
        void start();
      } else if (changed || stale || event.connected === true) {
        stale = false;
        later([]);
      }
      return;
    }
    case "change":
      later(event.elements);
      return;
    case "refused":
      refused();
      return;
    case "lost":
      stale = true;
      announce("The server of this page does not answer. The page shows what it read last.");
      return;
  }
}

const place = pagePlace();

/** The server refused the token: it is forgotten, so a reload does not send it again. */
function refused(): void {
  forgetToken(place);
  noToken();
}

function boot(): void {
  const token = takeToken(place);
  if (token === undefined) {
    noToken();
    return;
  }
  useToken(token);
  window.addEventListener(TOKEN_REFUSED, refused);
  // A command refused because another workspace was opened: the page reads again when the `workspace` event of
  // that workspace comes, not at once, which the server would refuse again.
  window.addEventListener(WORKSPACE_CHANGED, () => {
    stale = true;
  });
  window.addEventListener(VIEW_CHANGED, () => {
    void (async () => {
      await load();
      await route({ keepFocus: true });
      root.querySelector<HTMLElement>("[data-view]")?.focus();
    })();
  });
  // The page opened a workspace and read it: its overview is drawn.
  window.addEventListener(WORKSPACE_OPENED, () => {
    setWorkspaceOpen(true);
    if (parseHash(location.hash).hash === HOME) {
      void route();
    } else {
      location.hash = `#${HOME}`;
    }
  });
  window.addEventListener("hashchange", () => void route());
  listen(token, onEvent);
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  // The skip link moves focus; it must not change the route.
  if (target?.closest(".skip") !== null && target !== null) {
    event.preventDefault();
    const main = document.getElementById("main");
    const focus =
      main !== null && getComputedStyle(main).display === "contents" ? main.querySelector("h1") : main;
    if (focus instanceof HTMLElement) {
      focus.tabIndex = -1;
      focus.focus();
    }
    return;
  }
  const menu = target?.closest("[data-menu]") ?? null;
  if (menu !== null || (target?.closest("[data-menu-close], .menu-backdrop") ?? null) !== null) {
    setMenu(root, menu !== null && root.querySelector(".app.menu-open") === null);
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && root.querySelector(".app.menu-open") !== null) {
    setMenu(root, false);
  }
});

boot();
