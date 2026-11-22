// The quick finder: ⌘K (Ctrl+K) on every workspace page opens a box that finds a list (a queue, a type, a
// package, a saved filter, a perspective) by its name and an element by `element.search`; Enter opens it, and the
// last entry opens the whole search.
import "../css/palette.css";
import { call } from "../api.js";
import { h } from "../dom.js";
import { typeDef, typeName, typePlural, typesWith } from "../meaning.js";
import { allQueues } from "../queues.js";
import { hashOf } from "../router.js";
import { refOf, shownId, store, viewSelection } from "../store.js";
import { savedData } from "./lists.js";

interface Entry {
  readonly label: string;
  readonly hint: string;
  readonly href: string;
}

/** How many entries of each kind show. */
const MOST = 8;

async function listEntries(): Promise<Entry[]> {
  const data = await savedData();
  const packages = typesWith(store.mm, "package")[0];
  const packageHint = packages === undefined ? "Package" : typeName(store.mm, packages);
  const packageFacet = data.facets.properties.find(
    (p) => store.mm.properties.find((d) => d.key === p.key)?.meaning === "packages",
  );
  return [
    { label: "Overview", hint: "Inbox", href: hashOf("q", "overview") },
    ...allQueues().map((q) => ({ label: q.title(), hint: "Inbox", href: hashOf("q", q.key) })),
    { label: "All elements", hint: "List", href: hashOf("l", "all") },
    ...data.facets.types.map((t) => ({
      label: typeDef(store.mm, t.key) === undefined ? t.name : typePlural(store.mm, t.key),
      hint: "List",
      href: hashOf("l", "type", t.key),
    })),
    ...(packageFacet?.values ?? []).map((v) => ({
      label: v.title ?? String(v.value),
      hint: packageHint,
      href: hashOf("l", "package", String(v.value)),
    })),
    ...data.filters.map((f) => ({
      label: f.name,
      hint: "Saved filter",
      href: hashOf("l", "filter", f.name),
    })),
    ...data.perspectives.map((p) => ({
      label: p.name,
      hint: "Perspective",
      href: hashOf("l", "perspective", p.name),
    })),
  ];
}

let openNow: HTMLDialogElement | undefined;

function openFinder(): void {
  if (openNow !== undefined) {
    return;
  }
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = h("input", {
    type: "search",
    role: "combobox",
    "aria-label": "Find a list or an element",
    "aria-controls": "finder-list",
    "aria-expanded": "true",
    "aria-autocomplete": "list",
    autocomplete: "off",
    placeholder: "Find a list or an element",
  });
  const listbox = h("ul", { id: "finder-list", role: "listbox", "aria-label": "Found" });
  const status = h("p", { class: "fhint", "aria-live": "polite" });
  const dialog = h("dialog", { class: "finder", "aria-label": "Find" }, input, listbox, status);
  let lists: Entry[] = [];
  let entries: Entry[] = [];
  let active = 0;
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let leaving = false;

  const goTo = (entry: Entry | undefined): void => {
    if (entry === undefined) {
      return;
    }
    leaving = true;
    dialog.close();
    location.hash = entry.href;
  };

  const draw = (): void => {
    listbox.replaceChildren(
      ...entries.map((entry, at) => {
        const li = h(
          "li",
          {
            id: `finder-${String(at)}`,
            role: "option",
            "aria-selected": at === active ? "true" : "false",
            class: at === active ? "on" : null,
          },
          h("span", { class: "fl" }, entry.label),
          h("span", { class: "fk" }, entry.hint),
        );
        li.addEventListener("mousedown", (event) => {
          event.preventDefault();
          goTo(entry);
        });
        return li;
      }),
    );
    input.setAttribute("aria-activedescendant", entries.length === 0 ? "" : `finder-${String(active)}`);
    listbox.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  };

  const search = (query: string): Entry => ({
    label: `Search for “${query}”`,
    hint: "Search",
    href: `${hashOf("l", "search")}?${new URLSearchParams({ q: query }).toString()}`,
  });

  const update = (): void => {
    const query = input.value.trim();
    const words = query.toLowerCase();
    const named = (words === "" ? lists : lists.filter((e) => e.label.toLowerCase().includes(words))).slice(
      0,
      MOST,
    );
    entries = query === "" ? named : [...named, search(query)];
    active = 0;
    draw();
    clearTimeout(timer);
    if (query.length < 2) {
      status.textContent = "";
      return;
    }
    const mine = ++asked;
    timer = setTimeout(() => {
      void call("element.search", { query, limit: MOST, selection: viewSelection() }).then(
        (out) => {
          if (mine !== asked) {
            return;
          }
          const found = out.hits.map((hit) => ({
            label: `${shownId(hit) === "" ? "" : `${shownId(hit)} `}${hit.title}`,
            hint: typeName(store.mm, hit.type),
            href: hashOf("e", refOf(hit)),
          }));
          entries = [...named, ...found, search(query)];
          draw();
          status.textContent = `${String(found.length)} of ${String(out.total)} elements found.`;
        },
        () => {
          if (mine === asked) {
            status.textContent = "The search did not answer.";
          }
        },
      );
    }, 150);
  };

  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (entries.length > 0) {
        active = (active + (event.key === "ArrowDown" ? 1 : entries.length - 1)) % entries.length;
        draw();
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      goTo(entries[active]);
    }
  });
  dialog.addEventListener("click", (event) => {
    // A click on the backdrop closes the finder.
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.addEventListener("close", () => {
    clearTimeout(timer);
    asked += 1;
    dialog.remove();
    openNow = undefined;
    // Going somewhere moves the focus to the new page; closing returns it.
    if (!leaving && document.contains(opener)) {
      opener?.focus();
    }
  });
  openNow = dialog;
  document.body.append(dialog);
  dialog.showModal();
  void listEntries().then(
    (got) => {
      lists = got;
      update();
    },
    () => {
      update();
    },
  );
}

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
    // Only on a workspace page: a page of its own (no token, no workspace) calls nothing.
    if (document.querySelector(".app, .page-bg") === null) {
      return;
    }
    event.preventDefault();
    openFinder();
  }
});
