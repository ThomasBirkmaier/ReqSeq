// Building the page: every string goes into the DOM as text (ADR-0020, Element content), never as markup.
// `h` makes an element with attributes and children; a string child becomes a text node.

/** A child of an element: a node, a text, or nothing; arrays are flattened. */
export type Child = Node | string | number | false | null | undefined | readonly Child[];

/** Attributes by name: a string or number is set, `true` sets an empty attribute, false and nothing leave it out. */
export type Attrs = Readonly<Record<string, string | number | boolean | null | undefined>>;

const append = (parent: Node, child: Child): void => {
  if (child === null || child === undefined || child === false) {
    return;
  }
  if (Array.isArray(child)) {
    for (const each of child as readonly Child[]) {
      append(parent, each);
    }
    return;
  }
  parent.appendChild(
    typeof child === "string" || typeof child === "number"
      ? document.createTextNode(String(child))
      : (child as Node),
  );
};

const setAttrs = (element: Element, attrs: Attrs | null | undefined): void => {
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === true) {
      element.setAttribute(name, "");
    } else if (typeof value === "string" || typeof value === "number") {
      element.setAttribute(name, String(value));
    }
  }
};

/** An HTML element `tag` with `attrs` and `children`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  setAttrs(element, attrs);
  append(element, children);
  return element;
}

const SVG = "http://www.w3.org/2000/svg";

/** An SVG element `tag` with `attrs` and `children`. */
export function s(tag: string, attrs?: Attrs | null, ...children: Child[]): SVGElement {
  const element = document.createElementNS(SVG, tag);
  setAttrs(element, attrs);
  append(element, children);
  return element;
}

/** Tells assistive technology what just happened, once. */
export function announce(text: string): void {
  const live = document.getElementById("live");
  if (live === null) {
    return;
  }
  live.textContent = "";
  setTimeout(() => {
    live.textContent = text;
  }, 30);
}

/** The icons the pages use, drawn with `s`. */
export const icon = {
  back: (): SVGElement =>
    s(
      "svg",
      { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": "true" },
      s("path", {
        d: "M10 3 5 8l5 5",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": 1.6,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
  menu: (): SVGElement =>
    s(
      "svg",
      { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" },
      s("path", {
        d: "M3 5h12M3 9h12M3 13h12",
        stroke: "currentColor",
        "stroke-width": 1.6,
        "stroke-linecap": "round",
      }),
    ),
  logo: (): SVGElement =>
    s(
      "svg",
      { width: 22, height: 22, viewBox: "0 0 32 32", "aria-hidden": "true" },
      s("rect", { class: "logo-bg", width: 32, height: 32, rx: 8 }),
      s("path", {
        class: "logo-fg",
        d: "M10 9h7a5 5 0 0 1 0 10h-7zM10 19v4M17 19l5 4",
        "stroke-width": 2.4,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      }),
    ),
};
