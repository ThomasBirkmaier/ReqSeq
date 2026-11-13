// The switch to the previous or next buffer in motion (SR-212): the buffer that is left slides out to one
// side and the new one comes in from the other, in at most 200 ms (AK1). Display state only (ADR-0002 rule
// 3): no catalog command, no React.
//
// An area of the window (`BufferArea.tsx`) is a track of two layers, each `position: absolute` over the whole
// area and moved by its own `translateX` in % of the area: `main` holds the live view, `side` what stands
// beside it during a motion. For a switch, `side` holds a picture of the view that is left: a deep copy of its
// DOM taken in the keydown, before React unmounts that view (`takePicture`). The view that is left so takes no
// input, and the new one is live at once and has the focus (AK2). The swipe (SR-211) moves the same layers
// from any offset (`slideKeyframes`, `from`).
//
// The motion starts once the new view is drawn (`drawn`; a view that cannot draw its buffer says so too), and
// then always runs. By the rationale of SR-212 the 200 ms bound only the motion: it starts once the new buffer is
// fully drawn, without a placeholder, and the time until then has no limit in SR-212. A key, a press of a mouse button, a swipe macOS
// reports to the window (`interrupt`, SR-163 AK4), or any other change of the area's buffer ends it at once in
// its end state (AK2, AK3). Without motion in the system ("Bewegung reduzieren", AK4) nothing is taken and
// nothing moves.

/** The way of the switch: `back` (Previous buffer) moves out to the right, `forward` (Next buffer) to the left. */
export type SlideDirection = "back" | "forward";

/** The id of every animation of a slide, by which tests and the end of a slide find them. */
export const SLIDE_ID = "buffer-slide";

/** The time of a whole slide (AK1: at most 200 ms). */
export const SLIDE_MS = 160;

/**
 * A guard for a view that never reports that it is drawn: after it, the motion starts anyway. Every view reports,
 * also when its read fails, so a switch that reaches it is a bug.
 */
export const DRAW_DEADLINE_MS = 1000;

/** The curve where the page has no `--card-ease` (the token of the card of the command line, SR-182). */
export const SLIDE_EASE = "cubic-bezier(0.2, 0, 0, 1)";

/** The curve of a slide: the card's (`--card-ease` in `styles.css`), so both move alike. */
export const slideEase = (view: Window): string =>
  view.getComputedStyle(view.document.documentElement).getPropertyValue("--card-ease").trim() || SLIDE_EASE;

/** The prefix of every id in a picture, so no id of the live view is in the window twice. */
export const PICTURE_PREFIX = "slide-";

/** The step `cycleKey` takes as the way of the switch: 1 is Previous buffer. */
export const directionOf = (step: 1 | -1): SlideDirection => (step === 1 ? "back" : "forward");

/**
 * The `translateX` of the two layers, in % of the area, when the slide has gone `progress` of its way
 * (0 the start, 1 the end): the layer that leaves (`side` for a switch) and the one that comes.
 */
export const offsets = (
  direction: SlideDirection,
  progress: number,
): { readonly leaving: number; readonly coming: number } => {
  const sign = direction === "back" ? 1 : -1;
  return { leaving: sign * progress * 100, coming: sign * (progress - 1) * 100 };
};

const translate = (percent: number): string => `translateX(${String(percent)}%)`;

/** The keyframes of the leaving and the coming layer from `from` (a swipe released part of the way) to the end. */
export const slideKeyframes = (
  direction: SlideDirection,
  from = 0,
): { readonly leaving: Keyframe[]; readonly coming: Keyframe[] } => {
  const start = offsets(direction, from);
  const end = offsets(direction, 1);
  return {
    leaving: [{ transform: translate(start.leaving) }, { transform: translate(end.leaving) }],
    coming: [{ transform: translate(start.coming) }, { transform: translate(end.coming) }],
  };
};

/** The time of the rest of a slide that has gone `from` of its way already. */
export const slideDuration = (from = 0): number =>
  Math.round(SLIDE_MS * (1 - Math.min(Math.max(from, 0), 1)));

/** The system lets the app move things: the window can animate, and "Bewegung reduzieren" is off (AK4). */
export const motionAllowed = (view: Window): boolean =>
  typeof view.document.documentElement.animate === "function" &&
  !view.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Attributes by which focus, assistive technology or a locator would find a node of the picture. */
const STRIPPED = [
  "data-buffer",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-controls",
  "aria-activedescendant",
  "aria-owns",
  "tabindex",
  "contenteditable",
  "role",
  "autofocus",
  "for",
  "name",
];

/** What does not belong in a picture: popups of the editor, the slash menu, a card. */
const LEFT_OUT = ".cm-tooltip, .slash-backdrop, .card, .card-backdrop, dialog, [popover]";

const prefixRefs = (value: string, prefix: string): string =>
  value.replace(/url\(\s*(["']?)#/g, (_match, quote: string) => `url(${quote}#${prefix}`);

/** The elements of `root` and its copy, in the same order (a copy before anything is changed in it). */
const pairs = (root: Element, copy: Element): [Element, Element][] => {
  const to = [copy, ...copy.querySelectorAll("*")];
  return [root, ...root.querySelectorAll("*")].map((element, at) => [element, to[at] ?? copy]);
};

const isField = (element: Element): element is HTMLInputElement | HTMLTextAreaElement =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;

/** A copy of `child` with the values of its fields as typed; its scroll offsets go into `scrolled`. */
const copyOf = (child: Element, scrolled: [Element, number, number][]): Element => {
  const copy = child.cloneNode(true) as Element;
  for (const [source, target] of pairs(child, copy)) {
    if (source.scrollTop !== 0 || source.scrollLeft !== 0) {
      scrolled.push([target, source.scrollTop, source.scrollLeft]);
    }
    if (isField(source) && isField(target)) {
      target.value = source.value;
    }
  }
  return copy;
};

/** `element` without what would let anything find it, its ids and references prefixed. */
const neutralize = (element: Element, prefix: string): void => {
  for (const name of STRIPPED) {
    element.removeAttribute(name);
  }
  for (const { name, value } of [...element.attributes]) {
    if (name === "id") {
      element.id = `${prefix}${value}`;
    } else if ((name === "href" || name === "xlink:href") && value.startsWith("#")) {
      element.setAttribute(name, `#${prefix}${value.slice(1)}`);
    } else if (value.includes("url(")) {
      element.setAttribute(name, prefixRefs(value, prefix));
    }
  }
};

/** A picture of a view: the node to show beside the live view, and `placed`, to call once it is in the page. */
export interface Picture {
  readonly node: HTMLElement;
  /** Scrolls the copied scroll containers where the view stood (only a node in the page can scroll). */
  readonly placed: () => void;
}

/**
 * A copy of `layer`'s content, as it is shown now, that no focus, input, assistive technology or locator of the
 * live view can reach: inert and hidden from assistive technology, without the attributes `STRIPPED` names,
 * every id and every `url(#…)` and `href="#…"` prefixed with `prefix` (so SVG markers still draw), the values of
 * fields as typed, and the scroll offsets of its scroll containers.
 */
export const takePicture = (layer: Element, prefix = PICTURE_PREFIX): Picture => {
  const node = layer.ownerDocument.createElement("div");
  node.className = "slide-picture";
  node.setAttribute("aria-hidden", "true");
  node.inert = true;
  const scrolled: [Element, number, number][] = [];
  node.append(...[...layer.children].map((child) => copyOf(child, scrolled)));
  for (const gone of node.querySelectorAll(LEFT_OUT)) {
    gone.remove();
  }
  for (const element of node.querySelectorAll("*")) {
    neutralize(element, prefix);
  }
  return {
    node,
    placed: () => {
      for (const [element, top, left] of scrolled) {
        element.scrollTop = top;
        element.scrollLeft = left;
      }
    },
  };
};

/**
 * The layer of an area that holds the shown buffer, as a selector from the area. Buffers drawn in advance stand
 * hidden beside it (SR-212 AK5), so a lookup of the shown view through its area goes through this layer, never
 * to the first match in the area.
 */
export const SHOWN_LAYER = ':scope > [data-layer="main"]';

/** The shown layer of `area`, or null when there is none. */
export const shownLayer = (area: ParentNode | null | undefined): HTMLElement | null =>
  area?.querySelector<HTMLElement>(SHOWN_LAYER) ?? null;

/**
 * The view of the shown buffer of the active area in `root`, or null when there is none: where the focus goes
 * back to when nothing else holds it, never to a buffer drawn hidden beside it.
 */
export const shownBuffer = (root: ParentNode = document): HTMLElement | null =>
  shownLayer(root.querySelector("[data-area][data-active]"))?.querySelector<HTMLElement>("[data-buffer]") ??
  null;

/** The two layers of an area's track (`BufferArea.tsx`). */
export interface Track {
  readonly main: HTMLElement;
  readonly side: HTMLElement;
}

/** The layers of the area on `side` in `root`, or undefined when there is no such area. */
export const trackOf = (root: ParentNode | null | undefined, side: string): Track | undefined => {
  const area = root?.querySelector(`[data-area="${side}"]`);
  const main = shownLayer(area);
  const layer = area?.querySelector<HTMLElement>(':scope > [data-layer="side"]');
  return main === null || layer === null || layer === undefined ? undefined : { main, side: layer };
};

/** One switch: the area, the buffer left, the buffer shown, and the way. */
export interface SlideSpec {
  readonly side: string;
  readonly from: string;
  readonly to: string;
  readonly direction: SlideDirection;
}

/** What a controller needs of the page: the window, and the root that holds the areas. */
export interface SlideHost {
  readonly view: Window;
  readonly root: () => ParentNode | null | undefined;
}

type Phase =
  | { readonly kind: "idle" }
  // Taken in the keydown; the commit that shows `to` has not come yet.
  | { readonly kind: "armed"; readonly spec: SlideSpec; readonly picture: Picture; readonly drawn: boolean }
  // The picture covers the area, the new view stands beside it, and its draw is awaited.
  | {
      readonly kind: "waiting";
      readonly spec: SlideSpec;
      readonly picture: Picture;
      readonly track: Track;
      readonly deadline: ReturnType<typeof setTimeout>;
      readonly drawn: boolean;
    }
  | {
      readonly kind: "running";
      readonly spec: SlideSpec;
      readonly picture: Picture;
      readonly track: Track;
      readonly animations: readonly Animation[];
    };

/**
 * The input that ends a slide at once (AK2): a key, a press of any mouse button, the buttons Back and Forward. A
 * swipe macOS reports to the window has no DOM event and ends it through `interrupt`.
 */
const ENDING = ["keydown", "pointerdown", "mousedown", "mouseup"] as const;

/**
 * The slides of a window, one at a time. `prepare` in the keydown (before the dispatch), `settle` after every
 * commit with the active area and its buffer, `drawn` when a view reports its first drawing. Each switch is
 * used once: a commit that does not show its `to` in its area drops it, and any later change ends it.
 */
export class SlideController {
  private phase: Phase = { kind: "idle" };
  private readonly host: SlideHost;
  // The picture of a switch that an input ended before it moved, while the view it switched to has not
  // drawn: what the reader still sees of that area, so a switch on from there takes it again. It goes once
  // that view drew, at the next commit, or after `DRAW_DEADLINE_MS`.
  private spare: { readonly key: string; readonly picture: Picture } | undefined;
  private spareExpiry: ReturnType<typeof setTimeout> | undefined;
  private readonly end = (): void => {
    const { phase } = this;
    if ((phase.kind === "armed" || phase.kind === "waiting") && !phase.drawn) {
      this.keepSpare({ key: phase.spec.to, picture: phase.picture });
    }
    this.finish();
  };

  constructor(host: SlideHost) {
    this.host = host;
  }

  /**
   * Ends a taken, waiting or running slide at once in its end state, as a key does (AK2): for input without a
   * DOM event, a swipe macOS reports to the window (SR-163 AK4). A switch made after it calls `prepare`.
   */
  interrupt(): void {
    this.end();
  }

  /** A slide is taken, waits for its draw or runs. */
  get busy(): boolean {
    return this.phase.kind !== "idle";
  }

  /** Takes the picture of the area `spec.side` for a switch; nothing without motion (AK4). */
  prepare(spec: SlideSpec): void {
    const { phase } = this;
    if (!motionAllowed(this.host.view)) {
      this.finish();
      return;
    }
    // A second switch before the first one moved: its picture is still what the reader saw last.
    const spare = this.spare?.key === spec.from ? this.spare.picture : undefined;
    this.dropSpare();
    const kept = phase.kind === "armed" || phase.kind === "waiting" ? phase.picture : spare;
    this.finish();
    const track = trackOf(this.host.root(), spec.side);
    const picture = kept ?? (track === undefined ? undefined : takePicture(track.main));
    if (picture === undefined) {
      return;
    }
    this.phase = { kind: "armed", spec, picture, drawn: false };
    this.listen(true);
  }

  /** After a commit: the active area and its buffer. Starts the switch it was taken for, or ends the slide. */
  settle(side: string, key: string | undefined): void {
    this.dropSpare();
    const { phase } = this;
    if (phase.kind === "idle") {
      return;
    }
    if (side !== phase.spec.side || key !== phase.spec.to) {
      this.finish();
      return;
    }
    if (phase.kind !== "armed") {
      return;
    }
    const track = trackOf(this.host.root(), side);
    if (track === undefined) {
      this.finish();
      return;
    }
    const { leaving, coming } = offsets(phase.spec.direction, 0);
    track.side.replaceChildren(phase.picture.node);
    track.side.hidden = false;
    track.side.style.transform = translate(leaving);
    track.main.style.transform = translate(coming);
    phase.picture.placed();
    const deadline = setTimeout(() => {
      this.start();
    }, DRAW_DEADLINE_MS);
    this.phase = { ...phase, kind: "waiting", track, deadline };
    if (phase.drawn) {
      this.afterPaint();
    }
  }

  /** A view reports its first drawing (or that it cannot draw): the motion of a switch to it starts. */
  drawn(key: string): void {
    const { phase } = this;
    if (this.spare?.key === key) {
      this.dropSpare();
    }
    if (phase.kind === "armed" && phase.spec.to === key) {
      this.phase = { ...phase, drawn: true };
    } else if (phase.kind === "waiting" && phase.spec.to === key && !phase.drawn) {
      this.phase = { ...phase, drawn: true };
      this.afterPaint();
    }
  }

  /** Ends the slide at once in its end state: the new view in its place, no picture (AK2). */
  finish(): void {
    if (this.phase.kind === "running") {
      for (const animation of this.phase.animations) {
        animation.finish();
      }
    }
    this.clear();
  }

  private keepSpare(spare: { readonly key: string; readonly picture: Picture }): void {
    this.dropSpare();
    this.spare = spare;
    this.spareExpiry = setTimeout(() => {
      this.dropSpare();
    }, DRAW_DEADLINE_MS);
  }

  private dropSpare(): void {
    clearTimeout(this.spareExpiry);
    this.spare = undefined;
    this.spareExpiry = undefined;
  }

  // Two frames: the first runs before the paint of the drawn view, the second after it.
  private afterPaint(): void {
    const { view } = this.host;
    const spec = this.phase.kind === "waiting" ? this.phase.spec : undefined;
    view.requestAnimationFrame(() => {
      view.requestAnimationFrame(() => {
        if (this.phase.kind === "waiting" && this.phase.spec === spec) {
          this.start();
        }
      });
    });
  }

  private start(): void {
    const { phase } = this;
    if (phase.kind !== "waiting") {
      return;
    }
    clearTimeout(phase.deadline);
    const frames = slideKeyframes(phase.spec.direction);
    const timing: KeyframeAnimationOptions = {
      id: SLIDE_ID,
      duration: slideDuration(),
      easing: slideEase(this.host.view),
      fill: "forwards",
    };
    const animations = [
      phase.track.side.animate(frames.leaving, timing),
      phase.track.main.animate(frames.coming, timing),
    ];
    // Also where `animate` leaves out the id of its options.
    for (const animation of animations) {
      animation.id = SLIDE_ID;
    }
    phase.track.side.style.removeProperty("transform");
    phase.track.main.style.removeProperty("transform");
    this.phase = {
      kind: "running",
      spec: phase.spec,
      picture: phase.picture,
      track: phase.track,
      animations,
    };
    const [first] = animations;
    first?.finished.then(
      () => {
        if (this.phase.kind === "running" && this.phase.animations === animations) {
          this.clear();
        }
      },
      // Cancelled: `clear` ended it.
      () => undefined,
    );
  }

  private clear(): void {
    const { phase } = this;
    if (phase.kind === "waiting") {
      clearTimeout(phase.deadline);
    }
    if (phase.kind === "waiting" || phase.kind === "running") {
      if (phase.kind === "running") {
        for (const animation of phase.animations) {
          animation.cancel();
        }
      }
      phase.track.main.style.removeProperty("transform");
      phase.track.side.style.removeProperty("transform");
      phase.track.side.replaceChildren();
      phase.track.side.hidden = true;
    }
    this.listen(false);
    this.phase = { kind: "idle" };
  }

  private listen(on: boolean): void {
    for (const type of ENDING) {
      if (on) {
        this.host.view.addEventListener(type, this.end, { capture: true });
      } else {
        this.host.view.removeEventListener(type, this.end, { capture: true });
      }
    }
  }
}
