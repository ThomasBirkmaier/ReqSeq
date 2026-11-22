// Purposeful motion. Every effect explains a change: where a title went, which number moved, what changed
// elsewhere. 150-300 ms, never awaited by input, none under reduced motion.

const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Puts `next` in place of the content of `root`. When the title named `shared` is on screen before and after
 * (a list row and the element page), it travels between the two places as a shared element.
 */
export async function swap(root: Element, next: Node, shared?: string): Promise<void> {
  const apply = (): void => {
    root.replaceChildren(next);
    if (shared !== undefined) {
      root
        .querySelector<HTMLElement>(`[data-vt="${CSS.escape(shared)}"]`)
        ?.style.setProperty("view-transition-name", "vt-title");
    }
  };
  const from =
    shared === undefined ? null : document.querySelector<HTMLElement>(`[data-vt="${CSS.escape(shared)}"]`);
  if (reduced() || typeof document.startViewTransition !== "function" || from === null) {
    apply();
    return;
  }
  from.style.setProperty("view-transition-name", "vt-title");
  const transition = document.startViewTransition(apply);
  transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .finally(() => {
      root
        .querySelectorAll<HTMLElement>("[data-vt]")
        .forEach((x) => x.style.removeProperty("view-transition-name"));
    });
  await transition.updateCallbackDone.catch(() => {
    if (!root.contains(next)) {
      apply();
    }
  });
}

/** Plays the animation of `cls` on `element` again, also when it has the class already. */
const restart = (element: Element, cls: string): void => {
  element.classList.remove(cls);
  requestAnimationFrame(() => {
    element.classList.add(cls);
  });
};

const last = new Map<string, number | string>();

/** Numbers (`data-num`) and bars (`data-bar`) remember their last value and move to the new one. */
export function animateValues(root: Element): void {
  root.querySelectorAll<HTMLElement>("[data-num]").forEach((element) => {
    const key = element.dataset["num"] ?? "";
    const to = Number(element.textContent);
    const from = last.get(key);
    last.set(key, to);
    if (typeof from !== "number" || from === to || Number.isNaN(to)) {
      return;
    }
    restart(element, "bump");
    if (reduced()) {
      return;
    }
    const start = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - start) / 280);
      element.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) {
        requestAnimationFrame(step);
      }
    };
    element.textContent = String(from);
    requestAnimationFrame(step);
  });
  root.querySelectorAll<HTMLElement>("[data-bar]").forEach((element) => {
    const key = `bar:${element.dataset["bar"] ?? ""}`;
    const prop = element.dataset["prop"] ?? "width";
    const to = element.style.getPropertyValue(prop);
    const from = last.get(key);
    last.set(key, to);
    if (typeof from !== "string" || from === to || reduced()) {
      return;
    }
    element.style.setProperty(prop, from);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        element.style.setProperty(prop, to);
      }),
    );
  });
}

/** After a change outside the page: the rows and cards of the changed elements light up briefly. */
export function reveal(root: Element, ids: readonly string[]): void {
  for (const id of ids) {
    root.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach((x) => {
      restart(x, "fresh");
    });
  }
}
