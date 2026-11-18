// The card above the command prompt (SR-182): the hits of a prompt or the next keys rise on it from the line.
import { useLayoutEffect, useRef } from "react";

/** The copy of a card that runs the motion back after the card closed, by the node it was made of. */
const leaving = new WeakMap<HTMLElement, HTMLElement>();

/**
 * How long after a card that stood closed a new card stands at once too: the next argument of a command
 * and the hits of Go to come after a call to core, which can outlast the motion back (ms).
 */
const TAKES_PLACE_MS = 300;

/** When a card that stood still last closed, by the command prompt it was in (`performance.now()`). */
const closedAt = new WeakMap<HTMLElement, number>();

/**
 * A copy of `node` in `parent` that runs the motion back (SR-182 AK6); it says nothing to a screen reader,
 * is no hit to a test and has no control, and it goes when its animation ends. Without motion it goes at once (AK7).
 */
const leave = (node: HTMLElement, parent: HTMLElement): HTMLElement | undefined => {
  // Whether the card had stood still, or was still on its way in.
  const risen = node.getAnimations().length === 0;
  const copy = node.cloneNode(true) as HTMLElement;
  for (const element of [copy, ...copy.querySelectorAll("*")]) {
    for (const name of ["id", "role", "aria-label", "aria-controls"]) {
      element.removeAttribute(name);
    }
    element.classList.remove("candidates");
  }
  // A control of the card ("help" of the explanation line, SR-210 AK4) is only its look in the copy: no button
  // stays in the window once the prompt closed (SR-100).
  for (const button of copy.querySelectorAll("button")) {
    const look = document.createElement("span");
    look.className = button.className;
    look.append(...button.childNodes);
    button.replaceWith(look);
  }
  copy.classList.add("card-leaving");
  copy.dataset["motion"] = "out";
  copy.dataset["risen"] = String(risen);
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  parent.append(copy);
  // The copy shows the rows the card showed, not its first ones.
  const list = node.querySelector(".card-list");
  const shown = copy.querySelector(".card-list");
  if (list !== null && shown !== null) {
    shown.scrollTop = list.scrollTop;
  }
  const { animationName } = getComputedStyle(copy);
  if (animationName === "" || animationName === "none") {
    copy.remove();
    return undefined;
  }
  const gone = (): void => {
    copy.remove();
  };
  copy.addEventListener("animationend", (event) => {
    if (event.target === copy) {
      gone();
    }
  });
  // Also when no animation ends, such as in a hidden window.
  setTimeout(gone, 1000);
  return copy;
};

/**
 * The card above the command prompt (SR-182): the hits of a prompt or the next keys (SR-109). When it appears
 * it rises from the command prompt while the backdrop dims and blurs in a seam as wide as its shadow, all
 * by the same progress (AK1, AK2, AK5); new hits, or a card that comes within `TAKES_PLACE_MS` of one
 * that stood and closed, move nothing (AK4); on close a copy runs the motion back, shorter (AK6). The input keeps the focus
 * throughout (AK3). The times and amounts are the `--card-*` tokens of styles.css; without motion the
 * card stands at once (AK7). The backdrop takes no click: the card stays no dialog (D-062).
 */
export const Card = ({ children }: { readonly children: React.ReactNode }): React.JSX.Element => {
  const backdrop = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const own = card.current;
    const nodes = [backdrop.current, own].filter((node) => node !== null);
    const parent = own?.parentElement;
    if (parent === null || parent === undefined) {
      return undefined;
    }
    for (const node of nodes) {
      // Mounted again at once (React's StrictMode): the card never left.
      leaving.get(node)?.remove();
      leaving.delete(node);
    }
    if (own?.dataset["motion"] === undefined) {
      // A card that takes the place of one still leaving (the next argument of a command, Ctrl+Shift+P
      // over Ctrl+P, new hits after a moment without any) stands at once, unless that one was itself
      // still on its way in (Ctrl+P and a key at once).
      const before = [...parent.children].filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.classList.contains("card-leaving"),
      );
      const recent = performance.now() - (closedAt.get(parent) ?? -Infinity) < TAKES_PLACE_MS;
      const stood = recent || before.some((child) => child.dataset["risen"] === "true");
      for (const child of before) {
        child.remove();
      }
      for (const node of nodes) {
        node.dataset["motion"] = stood ? "still" : "in";
      }
    }
    return () => {
      // A card that stood: a card that comes soon after it takes its place.
      if (own?.getAnimations().length === 0) {
        closedAt.set(parent, performance.now());
      }
      for (const node of nodes) {
        const copy = leave(node, parent);
        if (copy !== undefined) {
          leaving.set(node, copy);
        }
      }
    };
  }, []);
  return (
    <>
      <div className="card-backdrop" aria-hidden="true" ref={backdrop} />
      <div className="card" ref={card}>
        <div className="card-seam" aria-hidden="true" />
        {children}
      </div>
    </>
  );
};
