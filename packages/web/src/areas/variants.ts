// A variant compared with the core (`#/variant/<ref>`): what it adds, what it replaces and what it excludes,
// as `variant.diff` gives it, with a way to exclude a core requirement and to include an excluded one again
// (`variant.exclude`, with `undo`). Each variant has a link in the rail.
import "../css/variants.css";
import type { VariantDiffOutput } from "@reqseq/core";
import { call } from "../api.js";
import type { Child } from "../dom.js";
import { announce, h } from "../dom.js";
import { addPlace } from "../element-tabs.js";
import { addRailSection, errorBox, frame, prepareRail } from "../layout.js";
import { namesOf, reqWords, typeName, typesWith } from "../meaning.js";
import type { Route } from "../router.js";
import { addRoute, fromOf, hashOf, isCurrent, parseHash } from "../router.js";
import { el, hasVariants, refOf, shownId, store } from "../store.js";

const VARIANT = "variant";

/** What the last exclusion or inclusion did, shown once on the page of its variant. */
let done: { readonly hash: string; readonly text: string } | undefined;

interface Named {
  readonly id: string;
  readonly shortId: string;
  readonly identifier?: string;
  readonly title?: string;
}

const nameOf = (names: ReadonlyMap<string, Named>, id: string): Named =>
  el(id) ?? names.get(id) ?? { id, shortId: id, title: id };

/** A row: the element and its type. */
const row = (
  names: ReadonlyMap<string, Named>,
  id: string,
  from: string,
  extra?: Child,
  item = true,
): HTMLElement => {
  const e = nameOf(names, id);
  const stored = el(id);
  return h(
    "div",
    { role: item ? "listitem" : null, class: "vrow", "data-id": id },
    h(
      "a",
      {
        class: "it",
        href: `${hashOf("e", stored === undefined ? e.shortId : refOf(stored))}?from=${encodeURIComponent(from)}`,
      },
      h("span", { class: "id" }, shownId(e)),
      h("span", { class: "t" }, e.title === undefined || e.title === "" ? e.shortId : e.title),
      h("span", null),
      h("span", { class: "m" }, typeName(store.mm, stored?.type)),
    ),
    extra,
  );
};

const group = (title: string, count: number, sub: string, rows: Child): HTMLElement =>
  h(
    "section",
    { class: "vgroup" },
    h("h2", { class: "group" }, title, h("b", null, count)),
    h("p", { class: "gsub" }, sub),
    count === 0 ? h("p", { class: "none" }, "None.") : h("div", { role: "list" }, rows),
  );

/** Runs `variant.exclude` and draws the page again with what it did. */
async function exclude(
  variant: string,
  name: string,
  refs: readonly string[],
  undo: boolean,
  status: HTMLElement,
  redraw: () => void,
  button: Element | null,
): Promise<void> {
  status.replaceChildren();
  // One call at a time: a second click while it runs would send the command again.
  button?.setAttribute("disabled", "");
  try {
    const out = await call("variant.exclude", { variant, refs: [...refs], ...(undo ? { undo: true } : {}) });
    const notes = (out.problems ?? []).map((p) => p.message);
    const what = refs.map((r) => el(r)?.identifier ?? el(r)?.title ?? r).join(", ");
    done = {
      hash: parseHash(location.hash).hash,
      text: [undo ? `${what} applies in ${name} again.` : `${what} is excluded from ${name}.`, ...notes].join(
        " ",
      ),
    };
    announce(done.text);
    redraw();
  } catch (error) {
    status.replaceChildren(errorBox(error));
  } finally {
    button?.removeAttribute("disabled");
  }
}

/** The core requirements a person may exclude: every requirement of the store; ReqSeq refuses the others. */
const candidates = (): readonly { value: string; label: string }[] => {
  const types = typesWith(store.mm, "requirement");
  return [...store.byId.values()]
    .filter((e) => types.includes(e.type ?? ""))
    .map((e) => ({ value: refOf(e), label: `${shownId(e)} ${e.title ?? ""}`.trim() }));
};

function excludeForm(variant: string, name: string, redraw: () => void): HTMLElement {
  const input = h("input", {
    type: "text",
    name: "ref",
    list: "core-reqs",
    autocomplete: "off",
    required: true,
    "aria-labelledby": "ex-h",
    "aria-describedby": "ex-help",
  });
  const status = h("div", { role: "status" });
  const form = h(
    "form",
    { class: "exform", "aria-labelledby": "ex-h" },
    h("h2", { class: "sect", id: "ex-h" }, "Exclude a core requirement"),
    h(
      "p",
      { class: "fh", id: "ex-help" },
      `The ID of a core requirement that ${name} does not need. ReqSeq writes the exclusion into the file of ${name} only.`,
    ),
    h("div", { class: "row" }, input, h("button", { class: "btn primary", type: "submit" }, "Exclude")),
    h(
      "datalist",
      { id: "core-reqs" },
      candidates().map((c) => h("option", { value: c.value }, c.label)),
    ),
    status,
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const ref = input.value.trim();
    if (ref !== "") {
      void exclude(variant, name, [ref], false, status, redraw, form.querySelector("button[type=submit]"));
    }
  });
  return form;
}

function diffView(
  diff: VariantDiffOutput,
  variant: string,
  name: string,
  route: Route,
  redraw: () => void,
): Child {
  const names = new Map((diff.names ?? []).map((x) => [x.id, x]));
  const from = fromOf(...route.parts);
  const status = h("div", { role: "status" });
  const word = reqWords(store.mm);
  return [
    group(
      `Added in ${name}`,
      diff.added.length,
      `${word.charAt(0).toUpperCase()}${word.slice(1)} that apply in ${name} only.`,
      diff.added.map((id) => row(names, id, from)),
    ),
    group(
      "Replaced",
      diff.replaced.length,
      `Core ${word} that ${name} replaces with one of its own.`,
      diff.replaced.map((pair) =>
        h(
          "div",
          { role: "listitem", class: "pair" },
          row(names, pair.core, from, null, false),
          h("span", { class: "arrow" }, "replaced by"),
          row(names, pair.replacement, from, null, false),
        ),
      ),
    ),
    group(
      "Excluded",
      diff.excluded.length,
      `Core ${word} that do not apply in ${name}.`,
      diff.excluded.map((id) => {
        const button = h("button", { class: "btn sm", type: "button" }, "Include again");
        button.addEventListener("click", () => {
          void exclude(variant, name, [id], true, status, redraw, button);
        });
        return row(names, id, from, button);
      }),
    ),
    status,
    excludeForm(variant, name, redraw),
    (diff.problems ?? []).map((p) => h("p", { class: "note" }, p.message)),
    diff.incomplete === true
      ? h(
          "p",
          { class: "note" },
          "A repository of the workspace is not on this machine; replacements or exclusions stored there are missing.",
        )
      : null,
  ];
}

async function render(root: HTMLElement, route: Route): Promise<void> {
  const ref = route.parts[1] ?? "";
  const v = el(ref);
  const name = v?.title ?? ref;
  await prepareRail();
  const id = v?.id ?? ref;
  const body = await call("variant.diff", { variant: id }).then(
    (diff) =>
      diffView(diff, id, name, route, () => {
        if (isCurrent(route)) {
          void render(root, route);
        }
      }),
    (error: unknown) => errorBox(error),
  );
  if (!isCurrent(route)) {
    return;
  }
  // The notice stays while the page shows the same route; a redraw after the written file changed keeps it.
  if (done !== undefined && done.hash !== route.hash) {
    done = undefined;
  }
  const note = done?.text;
  root.replaceChildren(
    frame(
      `${VARIANT}:${id}`,
      h(
        "section",
        { class: "list vpage", "aria-labelledby": "list-h" },
        h(
          "div",
          { class: "lh" },
          h("h1", { id: "list-h" }, `${name} compared with the core`),
          h(
            "p",
            null,
            `What ${name} adds, replaces and leaves out of the ${word()} all ${namesOf(store.mm, typesWith(store.mm, "variant"), "variants")} share.`,
          ),
        ),
        h(
          "div",
          { class: "lscroll" },
          note === undefined ? null : h("div", { class: "notice ok", role: "status" }, note),
          body,
        ),
      ),
      { wide: true },
    ),
  );
  document.title = `${name} · ReqSeq`;
}

const word = (): string => reqWords(store.mm);

addRoute(VARIANT, render);
addPlace(VARIANT, (route) => (route.parts[1] === undefined ? undefined : el(route.parts[1])?.title));
addRailSection({
  order: 40,
  title: "Variants",
  links: () =>
    hasVariants()
      ? store.variants.map((v) => ({
          href: hashOf(VARIANT, refOf(v)),
          key: `${VARIANT}:${v.id}`,
          name: v.title ?? v.shortId,
        }))
      : [],
});
