// Choosing an element while writing: a search field whose hits are an ARIA listbox. ReqSeq finds the hits
// (`element.search`, limited to the target types); a typed identifier or short ID that names an element of those
// types comes first. Used for relation targets and for the links typed into a text.
import { call } from "../api.js";
import { h } from "../dom.js";
import { isInvalid, statusName, typeName } from "../meaning.js";
import { el, refOf, store } from "../store.js";

/** An element as a form holds it: its UUID and what the page shows of it. */
export interface Target {
  readonly id: string;
  /** Identifier, else short ID: the reference written into a text. */
  readonly ref: string;
  readonly shown: string;
  readonly title: string;
  readonly type: string;
  readonly status?: string | undefined;
}

/** The target of the element `id` as the store knows it; `fallback` names one the store does not have. */
export function targetOf(
  id: string,
  fallback?: { title?: string | undefined; identifier?: string | undefined },
): Target {
  const e = el(id);
  return {
    id,
    ref: e === undefined ? (fallback?.identifier ?? id) : refOf(e),
    shown: e?.identifier ?? fallback?.identifier ?? "",
    title: e?.title ?? fallback?.title ?? id,
    type: e?.type ?? "",
    status: e?.status,
  };
}

/** The most hits a picker shows. */
const HITS = 8;

/** The elements of `types` that `query` finds, best first. */
async function find(query: string, types: readonly string[] | undefined): Promise<Target[]> {
  const words = query.trim();
  if (words === "") {
    return [];
  }
  const allowed = (type: string | undefined): boolean =>
    types === undefined || (type !== undefined && types.includes(type));
  const exact = el(words);
  const { hits } = await call("element.search", {
    query: words,
    limit: HITS,
    offset: 0,
    ...(types === undefined ? {} : { selection: { where: { type: [...types] } } }),
  });
  const found = [
    ...(exact !== undefined && allowed(exact.type) ? [targetOf(exact.id)] : []),
    ...hits.map((hit) =>
      targetOf(hit.id, {
        title: hit.title,
        ...(hit.identifier === undefined ? {} : { identifier: hit.identifier }),
      }),
    ),
  ];
  return found.filter((t, at) => found.findIndex((x) => x.id === t.id) === at).slice(0, HITS);
}

let pickers = 0;

export interface Picker {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  /** Searches for `query` and shows the hits. */
  search(query: string): void;
  close(): void;
}

export interface PickerOptions {
  /** The label of the search field. */
  readonly label: string;
  /** Only elements of these types; every type when left out. */
  readonly types?: readonly string[] | undefined;
  /** Elements that are already chosen: shown, but not offered again. */
  readonly taken?: () => readonly string[];
  readonly onPick: (target: Target) => void;
  /** The search field is the text itself (a link typed into a text): no field of its own. */
  readonly field?: HTMLTextAreaElement;
  readonly onClose?: () => void;
}

/** A search field with its listbox of hits. */
export function picker(options: PickerOptions): Picker {
  const id = `pick-${String(++pickers)}`;
  const list = h("ul", { class: "pick-list", role: "listbox", id: `${id}-list`, hidden: true });
  const status = h("p", { class: "pick-status", "aria-live": "polite" });
  const input =
    options.field === undefined
      ? h("input", {
          type: "search",
          class: "pick-input",
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": "false",
          "aria-controls": `${id}-list`,
          "aria-label": options.label,
          placeholder: "Search by ID or words",
          autocomplete: "off",
        })
      : null;
  let hits: Target[] = [];
  let active = -1;
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // One of the two is given: the field of its own, or the text it searches in.
  const owner: HTMLElement = input ?? options.field ?? h("textarea");

  const close = (): void => {
    clearTimeout(timer);
    asked += 1;
    hits = [];
    active = -1;
    list.hidden = true;
    list.replaceChildren();
    status.textContent = "";
    owner.setAttribute("aria-expanded", "false");
    owner.removeAttribute("aria-activedescendant");
  };
  const mark = (): void => {
    list.querySelectorAll("[role=option]").forEach((x, at) => {
      x.setAttribute("aria-selected", String(at === active));
    });
    if (active >= 0) {
      owner.setAttribute("aria-activedescendant", `${id}-${String(active)}`);
    } else {
      owner.removeAttribute("aria-activedescendant");
    }
  };
  const pick = (target: Target): void => {
    close();
    options.onPick(target);
  };
  const show = (): void => {
    const taken = new Set(options.taken?.() ?? []);
    hits = hits.filter((t) => !taken.has(t.id));
    active = hits.length > 0 ? 0 : -1;
    list.replaceChildren(
      ...hits.map((t, at) =>
        h(
          "li",
          { role: "option", id: `${id}-${String(at)}`, "data-id": t.id, "aria-selected": "false" },
          h("span", { class: "pick-id" }, `${t.shown} ${typeName(store.mm, t.type)}`.trim()),
          h("span", { class: "pick-title" }, t.title),
          isInvalid(store.mm, t.status)
            ? h("span", { class: "pick-obs" }, statusName(store.mm, t.status))
            : null,
        ),
      ),
    );
    for (const [at, item] of [...list.children].entries()) {
      // Mouse down, not click: the field keeps its focus.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const target = hits[at];
        if (target !== undefined) {
          pick(target);
        }
      });
    }
    list.hidden = hits.length === 0;
    owner.setAttribute("aria-expanded", String(hits.length > 0));
    status.textContent = hits.length === 0 ? "Nothing found." : "";
    mark();
  };
  const search = (query: string): void => {
    clearTimeout(timer);
    const mine = ++asked;
    if (query.trim() === "") {
      close();
      return;
    }
    timer = setTimeout(() => {
      void find(query, options.types)
        .then((found) => {
          if (mine === asked) {
            hits = found;
            show();
          }
        })
        .catch(() => {
          if (mine === asked) {
            hits = [];
            show();
            status.textContent = "The search did not answer. Try again.";
          }
        });
    }, 150);
  };

  owner.addEventListener("keydown", (event) => {
    // Enter in a search field of its own picks a hit or does nothing; it never submits the form.
    if (event.key === "Enter" && input !== null && (list.hidden === true || active < 0)) {
      event.preventDefault();
      return;
    }
    if (list.hidden === true) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      mark();
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      const target = hits[active];
      if (target !== undefined) {
        pick(target);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      options.onClose?.();
    }
  });
  owner.addEventListener("blur", () => {
    close();
  });
  if (input !== null) {
    input.addEventListener("input", () => {
      search(input.value);
    });
  }
  return {
    root: h("div", { class: "pick" }, input, list, status),
    input: input ?? h("input"),
    search,
    close,
  };
}
