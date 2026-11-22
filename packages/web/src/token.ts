// The token of the UI server (ADR-0020, Token): the printed and opened address carries it once, in the fragment
// (`#token=<token>`). The page reads it before the hash router runs, keeps it in sessionStorage and removes it from
// the address, so it is in no later history entry, bookmark or copied link.

const KEY = "reqseq.token";
const FRAGMENT = /^#token=([A-Za-z0-9_-]+)$/;

/** What the token is read from and kept in: the page's own objects, or a test's. */
export interface TokenPlace {
  readonly location: Pick<Location, "hash" | "pathname" | "search">;
  readonly history: Pick<History, "replaceState">;
  /** Undefined where the browser refuses storage: the token is then kept for this page only. */
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined;
}

let held: string | undefined;

const stored = (place: TokenPlace): string | undefined => {
  try {
    return place.storage?.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * The token of this tab: from the fragment, which is then removed from the address, else the one kept before;
 * undefined when there is none.
 */
export function takeToken(place: TokenPlace): string | undefined {
  const found = FRAGMENT.exec(place.location.hash)?.[1];
  if (found !== undefined) {
    held = found;
    try {
      place.storage?.setItem(KEY, found);
    } catch {
      // Storage refused: the token stays for this page only.
    }
    place.history.replaceState(null, "", `${place.location.pathname}${place.location.search}`);
    return found;
  }
  return held ?? stored(place);
}

/** Forgets the token after the server refused it, so a reload does not send it again. */
export function forgetToken(place: TokenPlace): void {
  held = undefined;
  try {
    place.storage?.removeItem(KEY);
  } catch {
    // Nothing was kept.
  }
}

/** The place of this page. */
export const pagePlace = (): TokenPlace => {
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = undefined;
  }
  return { location: window.location, history: window.history, storage };
};
