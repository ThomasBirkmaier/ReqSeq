// Review since a baseline (`#/c`, `#/c/<identifier or short ID>`, `#/r`): what changed since a baseline, word by
// word, and the decisions a person takes on it. The list names each element that changed, was added, superseded or
// removed since the chosen baseline (`baseline.get`); the panel shows the difference of one of them
// (`baseline.compare`, old and new wording as ReqSeq gives them, marked word by word by the HTML export's rule).
// People set the status of one or many elements, supersede one with its successor and change a property of many
// with ReqSeq's preview; every status is written only after a confirmation that names the elements and the status
// (D-030). The check before a baseline (`#/r`) shows what `baseline.prepare` reports and creates a baseline.
import "../css/changes.css";
import type { ElementBulkUpdateInput, Problem } from "@reqseq/core";
import { wordDiff } from "@reqseq/core/markdown";
import type { OutputOf } from "../api.js";
import { ReqSeqError, call, explain } from "../api.js";
import type { Child } from "../dom.js";
import { announce, h } from "../dom.js";
import { addRailSection, errorBox, frame, prepareRail } from "../layout.js";
import { statusPill } from "../marks.js";
import type { Metamodel } from "../meaning.js";
import {
  cap,
  isInitial,
  isInvalid,
  packageWord,
  propDef,
  propsOf,
  relKind,
  reqWords,
  sentence,
  statusName,
  typeDef,
  typeName,
  typesWith,
} from "../meaning.js";
import { swap } from "../motion.js";
import { PAGE, allPages } from "../pages.js";
import type { Route } from "../router.js";
import { addRoute, hashOf, isCurrent, parseHash, withFrom } from "../router.js";
import type { ElementPart } from "../store.js";
import { el, load, refOf, shownId, store, variantName, viewSelection } from "../store.js";

type Entry = OutputOf<"baseline.get">["elements"][number];
type Changes = OutputOf<"baseline.changes">;
type Difference = OutputOf<"baseline.compare">["difference"];

const CHANGES = "changes";
const RELEASE = "release";

/** The states a review lists, in this order, with the words of their group. */
const STATES = [
  ["changed", "Changed"],
  ["added", "Added"],
  ["superseded", "Superseded"],
  ["removed", "Left the selection"],
] as const;
type Listed = (typeof STATES)[number][0];

const isListed = (state: string): state is Listed => STATES.some(([s]) => s === state);

// ---------- Reading ----------

/** Grows with each write of this area, so what it read before is read again even before the store reloads. */
let writes = 0;
const stamp = (): string => `${String(store.epoch)}:${String(writes)}`;

/** The changes since a baseline as ReqSeq gives them: its name, counts, the open hints and the listed entries. */
interface Since {
  readonly key: string;
  readonly changes: Changes;
  readonly hints: readonly Problem[];
  readonly entries: readonly Entry[];
  readonly baselines: OutputOf<"baseline.list">["baselines"];
}

let since: { readonly key: string; readonly data: Promise<Since> } | undefined;

/** The changes since the baseline `name`, or since the newest one; read once per load of the store. */
function readSince(name: string | undefined): Promise<Since> {
  const key = `${stamp()}|${name ?? ""}`;
  if (since?.key === key) {
    return since.data;
  }
  const data = (async (): Promise<Since> => {
    const [pages, list] = await Promise.all([
      // The hints come one page at a time, counted by `hintTotal`.
      allPages(
        async (offset) => {
          const page = await call("baseline.changes", {
            ...(name === undefined ? {} : { baseline: name }),
            limit: PAGE,
            offset,
          });
          return { ...page, total: page.hintTotal };
        },
        (page) => page.hints.length,
      ),
      call("baseline.list"),
    ]);
    const [changes] = pages;
    if (changes === undefined) {
      throw new Error("baseline.changes gave no page");
    }
    const chosen = changes.baseline?.name;
    const entries =
      chosen === undefined
        ? []
        : (
            await allPages(
              (offset) => call("baseline.get", { baseline: chosen, limit: PAGE, offset }),
              (page) => page.elements.length,
            )
          )
            .flatMap((page) => page.elements)
            .filter((entry) => isListed(entry.state));
    return { key, changes, hints: pages.flatMap((p) => p.hints), entries, baselines: list.baselines };
  })();
  since = { key, data };
  data.catch(() => {
    if (since?.data === data) {
      since = undefined;
    }
  });
  return data;
}

/** The newest baseline's counts for the rail, read once per load of the store. */
let railCounts:
  { readonly key: string; readonly count: number | undefined; readonly name?: string } | undefined;

const listedCount = (counts: NonNullable<Changes["baseline"]>["counts"]): number =>
  counts.changed + counts.superseded + (counts.added ?? 0) + (counts.removed ?? 0);

// ---------- Words ----------

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateText = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
};

const label = (e: Pick<ElementPart, "identifier" | "title" | "shortId"> | undefined, id: string): string => {
  if (e === undefined) {
    return id;
  }
  const shown = shownId(e);
  return `${shown === "" ? "" : `${shown} `}${e.title ?? e.shortId}`;
};

const quoted = (e: ElementPart | undefined, id: string): string => {
  if (e === undefined) {
    return id;
  }
  const shown = shownId(e);
  return `${shown === "" ? "" : `${shown} `}“${e.title ?? e.shortId}”`;
};

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** `href` with the way back to `route`, its baseline included. */
const via = (href: string, route: Route): string => `${href}?from=${encodeURIComponent(route.hash)}`;

const changesHref = (baseline: string | undefined, ref?: string): string => {
  const base = ref === undefined ? hashOf("c") : hashOf("c", ref);
  return baseline === undefined ? base : `${base}?b=${encodeURIComponent(baseline)}`;
};

// ---------- Statuses by the metamodel ----------

/** The statuses of `type`, in metamodel order. */
const statusesOf = (mm: Metamodel, type: string | undefined): readonly string[] =>
  typeDef(mm, type)?.statuses ?? [];

/**
 * The status "Approve" sets for an element of `type`: the one status of the type that is neither initial nor invalid.
 * A type with none or several has no such shortcut; its elements get their status through "Set status".
 */
export const approvalOf = (mm: Metamodel, type: string | undefined): string | undefined => {
  const settled = statusesOf(mm, type).filter((s) => !isInitial(mm, s) && !isInvalid(mm, s));
  return settled.length === 1 ? settled[0] : undefined;
};

/** The statuses every element of `types` may get through "Set status": those they all share, none invalid. */
const commonStatuses = (mm: Metamodel, types: readonly (string | undefined)[]): string[] => {
  const [first, ...rest] = types;
  return statusesOf(mm, first).filter(
    (s) => !isInvalid(mm, s) && rest.every((type) => statusesOf(mm, type).includes(s)),
  );
};

// ---------- Messages after a write ----------

/** What the last write did, shown on the page it was made from until the person goes elsewhere. */
let flash: { readonly route: string; readonly text: string; readonly notes: readonly string[] } | undefined;

const flashBox = (route: Route): HTMLElement | null => {
  if (flash?.route !== route.hash) {
    flash = undefined;
    return null;
  }
  return h(
    "div",
    { class: "notice done", role: "status", "data-flash": true },
    h("strong", null, flash.text),
    flash.notes.length === 0
      ? null
      : h(
          "ul",
          null,
          flash.notes.map((n) => h("li", null, n)),
        ),
  );
};

/** After a write: the message, the data read again, and the page drawn again. */
function written(text: string, problems: readonly Problem[] = []): void {
  writes += 1;
  flash = { route: parseHash(location.hash).hash, text, notes: problems.map((p) => p.message) };
  announce(text);
  // The store is read again first, so the page never shows the status from before the write.
  void load()
    .catch(() => undefined)
    .then(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
}

// The message of a write is shown only on the page it was made from.
window.addEventListener("hashchange", () => {
  if (flash !== undefined && flash.route !== parseHash(location.hash).hash) {
    flash = undefined;
  }
});

// ---------- Dialogs ----------

interface DialogParts {
  readonly title: string;
  readonly body: Child;
  /** The confirming button: its words name what it does; null hides it. */
  readonly confirm: HTMLButtonElement | null;
  readonly extra?: Child;
}

/** A modal dialog; the returned functions show an error in it and close it. */
function dialog(parts: DialogParts): { readonly fail: (error: unknown) => void; readonly close: () => void } {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const error = h("div", { class: "dlg-error" });
  const cancel = h("button", { class: "btn", type: "button" }, "Cancel");
  const box = h(
    "dialog",
    { class: "dlg", "aria-labelledby": "dlg-h" },
    h("h2", { id: "dlg-h" }, parts.title),
    h("div", { class: "dlg-body" }, parts.body),
    error,
    h("div", { class: "dlg-actions" }, parts.extra, cancel, parts.confirm),
  );
  const close = (): void => {
    box.close();
  };
  box.addEventListener("close", () => {
    box.remove();
    opener?.focus();
  });
  cancel.addEventListener("click", close);
  document.body.append(box);
  box.showModal();
  return {
    fail: (e) => {
      error.replaceChildren(problemBox(e));
    },
    close,
  };
}

/** A button of a dialog that runs `act` once per click, disabled while it runs. */
function actButton(words: string, act: () => Promise<void>): HTMLButtonElement {
  const button = h("button", { class: "btn primary", type: "button" }, words);
  button.addEventListener("click", () => {
    if (button.disabled) {
      return;
    }
    button.disabled = true;
    void act().finally(() => {
      button.disabled = false;
    });
  });
  return button;
}

/** Plain words for the refusals of this area, else those of every page; ReqSeq's own text under "Details". */
function problemBox(error: unknown): HTMLElement {
  if (!(error instanceof ReqSeqError)) {
    return errorBox(error);
  }
  const words = refusalWords(error);
  if (words === undefined) {
    return errorBox(error);
  }
  return h(
    "div",
    { class: "notice bad", role: "alert" },
    h("strong", null, words.what),
    " ",
    words.todo,
    words.list.length === 0
      ? null
      : h(
          "ul",
          null,
          words.list.map((x) => h("li", null, x)),
        ),
    h("details", null, h("summary", null, "Details from ReqSeq"), h("pre", null, explain(error).detail)),
  );
}

const filesOf = (details: unknown, key: string): string[] => {
  const list =
    typeof details === "object" && details !== null ? (details as Record<string, unknown>)[key] : [];
  return Array.isArray(list)
    ? list.flatMap((x: unknown) => {
        const file = typeof x === "object" && x !== null ? (x as { file?: unknown }).file : undefined;
        return typeof file === "string" ? [file] : [];
      })
    : [];
};

function refusalWords(error: ReqSeqError): { what: string; todo: string; list: string[] } | undefined {
  switch (error.code) {
    case "baseline.uncommitted-changes":
      return {
        what: "The workspace has changes that are not committed.",
        todo: "A baseline names the commit of each element, so commit these files first, then create it again.",
        list: [...filesOf(error.details, "elements"), ...filesOf(error.details, "files")],
      };
    case "baseline.exists":
      return { what: "A baseline with that name exists.", todo: "Choose another name.", list: [] };
    case "git.commit-not-found":
      return {
        what: "The commit of the baseline is not in this copy of the repository.",
        todo: "Fetch it, then open the difference again.",
        list: [],
      };
    default:
      return undefined;
  }
}

// ---------- Status ----------

interface StatusTarget {
  readonly id: string;
  readonly status: string;
}

/** The list of a confirmation: each element, its status now and the status it gets. */
function targetList(
  targets: readonly StatusTarget[],
  left: readonly { id: string; why: string }[],
): HTMLElement {
  return h(
    "div",
    null,
    h(
      "ul",
      { class: "dlg-list", "aria-label": "Elements" },
      targets.map((t) => {
        const e = el(t.id);
        return h(
          "li",
          { "data-id": t.id },
          h("span", { class: "dl-t" }, label(e, t.id)),
          h("span", { class: "dl-s" }, statusPill(e?.status), " → ", statusPill(t.status)),
        );
      }),
    ),
    left.length === 0
      ? null
      : [
          h("p", { class: "note" }, `Left out: ${plural(left.length, "element", "elements")}.`),
          h(
            "ul",
            { class: "dlg-list left" },
            left.map((x) =>
              h(
                "li",
                { "data-id": x.id },
                h("span", { class: "dl-t" }, label(el(x.id), x.id)),
                h("span", { class: "dl-s" }, x.why),
              ),
            ),
          ),
        ],
  );
}

/** Writes the statuses of `targets`: one call per status, after the confirmation. */
async function setStatuses(targets: readonly StatusTarget[]): Promise<readonly Problem[]> {
  const by = new Map<string, string[]>();
  for (const t of targets) {
    by.set(t.status, [...(by.get(t.status) ?? []), t.id]);
  }
  const problems: Problem[] = [];
  let done = 0;
  for (const [status, refs] of by) {
    try {
      const out = await call("element.setStatus", { refs, status });
      problems.push(...(out.problems ?? []));
      done += refs.length;
    } catch (error) {
      // What was written before the refusal stays written: the page says so and shows it.
      if (done > 0) {
        written(
          `Set ${String(done)} of ${plural(targets.length, "element", "elements")} before ReqSeq refused the rest.`,
          problems,
        );
      }
      throw error;
    }
  }
  return problems;
}

const statusSentence = (targets: readonly StatusTarget[]): string => {
  const names = [...new Set(targets.map((t) => statusName(store.mm, t.status)))];
  return `Set ${plural(targets.length, "element", "elements")} to ${names.join(" or ")}`;
};

/** The confirmation of "Approve": each element gets the one settled status of its type. */
function approveDialog(ids: readonly string[]): void {
  const targets: StatusTarget[] = [];
  const left: { id: string; why: string }[] = [];
  for (const id of ids) {
    const e = el(id);
    const status = approvalOf(store.mm, e?.type);
    if (e === undefined || status === undefined) {
      left.push({ id, why: "its type has no single status to approve" });
    } else if (isInvalid(store.mm, e.status)) {
      left.push({ id, why: `${statusName(store.mm, e.status)}, superseded` });
    } else if (e.status === status) {
      left.push({ id, why: `already ${statusName(store.mm, status)}` });
    } else {
      targets.push({ id, status });
    }
  }
  statusDialog("Approve", targets, left);
}

function statusDialog(
  title: string,
  targets: readonly StatusTarget[],
  left: readonly { id: string; why: string }[],
): void {
  const confirm =
    targets.length === 0
      ? null
      : actButton(statusSentence(targets), async () => {
          try {
            const problems = await setStatuses(targets);
            d.close();
            selected.clear();
            written(`${statusSentence(targets)}.`, problems);
          } catch (error) {
            d.fail(error);
          }
        });
  const d = dialog({
    title,
    body: [
      h(
        "p",
        null,
        targets.length === 0
          ? "No element gets a new status."
          : "Only people set a status. Check the elements and the status they get.",
      ),
      targetList(targets, left),
    ],
    confirm,
  });
}

/** "Set status": the person chooses a status that all the elements' types have; the list shows what each gets. */
function setStatusDialog(ids: readonly string[]): void {
  // A superseded element gets no status here: it is left out and named, as in "Approve".
  const superseded = ids
    .filter((id) => isInvalid(store.mm, el(id)?.status))
    .map((id) => ({ id, why: `${statusName(store.mm, el(id)?.status)}, superseded` }));
  const elements = ids.filter((id) => !isInvalid(store.mm, el(id)?.status)).map((id) => ({ id, e: el(id) }));
  const choices = commonStatuses(
    store.mm,
    elements.map((x) => x.e?.type),
  );
  const select = h(
    "select",
    { id: "dlg-status" },
    h("option", { value: "" }, "Choose a status"),
    choices.map((s) => h("option", { value: s }, statusName(store.mm, s))),
  );
  const list = h("div");
  const confirmSlot = h("span");
  let targets: StatusTarget[] = [];
  const confirm = actButton("Set status", async () => {
    try {
      const problems = await setStatuses(targets);
      d.close();
      selected.clear();
      written(`${statusSentence(targets)}.`, problems);
    } catch (error) {
      d.fail(error);
    }
  });
  const update = (): void => {
    const status = select.value;
    targets =
      status === "" ? [] : elements.filter((x) => x.e?.status !== status).map((x) => ({ id: x.id, status }));
    const left =
      status === ""
        ? []
        : [
            ...elements
              .filter((x) => x.e?.status === status)
              .map((x) => ({ id: x.id, why: `already ${statusName(store.mm, status)}` })),
            ...superseded,
          ];
    list.replaceChildren(status === "" ? "" : targetList(targets, left));
    confirm.textContent = targets.length === 0 ? "Set status" : statusSentence(targets);
    confirm.hidden = targets.length === 0;
  };
  select.addEventListener("change", update);
  confirmSlot.append(confirm);
  const d = dialog({
    title: "Set status",
    body:
      choices.length === 0
        ? h("p", null, "These elements have no status in common. Choose elements of fewer types.")
        : [
            h(
              "p",
              null,
              "Only people set a status. Choose it, then check the elements and the status they get.",
            ),
            h("label", { class: "field" }, h("span", null, "Status"), select),
            list,
          ],
    confirm: choices.length === 0 ? null : confirm,
  });
  update();
}

/** "Supersede": the invalid status of the element's type and, optionally, the element that follows it. */
function supersedeDialog(id: string): void {
  const e = el(id);
  const invalid = statusesOf(store.mm, e?.type).filter((s) => isInvalid(store.mm, s));
  const select = h(
    "select",
    { id: "dlg-invalid" },
    invalid.map((s) => h("option", { value: s }, statusName(store.mm, s))),
  );
  const listId = "dlg-successors";
  const successor = h("input", {
    id: "dlg-successor",
    type: "text",
    list: listId,
    autocomplete: "off",
    placeholder: "ID of the successor, optional",
  });
  const options = h(
    "datalist",
    { id: listId },
    [...store.byId.values()]
      .filter((x) => x.id !== id && x.type === e?.type && !isInvalid(store.mm, x.status))
      .map((x) => h("option", { value: refOf(x) }, x.title ?? "")),
  );
  const summary = h("p", { class: "dlg-summary", "data-summary": true });
  const confirm = actButton("Supersede", async () => {
    const next = successorOf();
    try {
      const out = await call("element.supersede", {
        ref: id,
        status: select.value,
        ...(next === undefined ? {} : { successor: next.id }),
      });
      d.close();
      selected.delete(id);
      written(`${summaryText()}.`, out.problems ?? []);
    } catch (error) {
      d.fail(error);
    }
  });
  /** The successor typed: another element that is not superseded, as the suggestions offer. */
  const successorOf = (): ElementPart | undefined => {
    const typed = successor.value.trim();
    const next = typed === "" ? undefined : el(typed);
    return next === undefined || next.id === id || isInvalid(store.mm, next.status) ? undefined : next;
  };
  const summaryText = (): string => {
    const next = successorOf();
    return `Supersede ${quoted(e, id)} as ${statusName(store.mm, select.value)}${next === undefined ? "" : `, followed by ${quoted(next, next.id)}`}`;
  };
  const update = (): void => {
    const typed = successor.value.trim();
    const unknown = typed !== "" && successorOf() === undefined;
    summary.textContent = unknown ? `${typed} is no element that can follow this one.` : `${summaryText()}.`;
    summary.classList.toggle("bad", unknown);
    confirm.hidden = unknown;
    confirm.textContent = `Supersede ${e === undefined ? id : refOf(e)}`;
  };
  select.addEventListener("change", update);
  successor.addEventListener("input", update);
  const d = dialog({
    title: "Supersede",
    body:
      invalid.length === 0
        ? h(
            "p",
            null,
            `A ${typeName(store.mm, e?.type).toLowerCase()} has no status for superseded elements.`,
          )
        : [
            h(
              "p",
              null,
              "ReqSeq never deletes an element: it gets a status for superseded elements and points to its successor.",
            ),
            invalid.length === 1 ? null : h("label", { class: "field" }, h("span", null, "Status"), select),
            h("label", { class: "field" }, h("span", null, "Successor"), successor, options),
            summary,
          ],
    confirm: invalid.length === 0 ? null : confirm,
  });
  update();
}

// ---------- Changing a property of many ----------

/** The properties a bulk change may set on elements of `types`: not the title, the ID or the acceptance criteria. */
const bulkProps = (types: readonly (string | undefined)[]): string[] => {
  const keys = new Set(types.flatMap((t) => propsOf(store.mm, t)));
  return store.mm.properties
    .filter(
      (p) =>
        keys.has(p.key) &&
        p.meaning !== "title" &&
        p.meaning !== "identifier" &&
        p.meaning !== "acceptance-criteria",
    )
    .map((p) => p.key);
};

/** The value of the bulk form as the command takes it: each line one item for a list, a number for a number. */
const bulkValue = (key: string, raw: string): unknown => {
  const d = propDef(store.mm, key);
  const one = (text: string): unknown => (d?.kind === "number" ? Number(text) : text);
  const items = raw
    .split(d?.many === true ? "\n" : /$^/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
  if (items.length === 0 || (d?.kind === "number" && items.some((x) => !Number.isFinite(Number(x))))) {
    return undefined;
  }
  return d?.many === true ? items.map(one) : one(items[0] ?? "");
};

function bulkDialog(chosen: readonly string[]): void {
  let ids = chosen;
  // A superseded element keeps its properties here, as it gets no status.
  const leftOut = ids.filter((id) => isInvalid(store.mm, el(id)?.status)).length;
  ids = ids.filter((id) => !isInvalid(store.mm, el(id)?.status));
  const keys = bulkProps(ids.map((id) => el(id)?.type));
  const prop = h(
    "select",
    { id: "dlg-prop" },
    keys.map((k) => h("option", { value: k }, sentence(propDef(store.mm, k)?.name ?? k))),
  );
  const op = h("select", { id: "dlg-op" });
  const valueSlot = h("div");
  let value: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement = h("input");
  const result = h("div", { class: "dlg-preview", "aria-live": "polite" });
  let plan: string | undefined;
  const apply = actButton("Change", async () => {
    try {
      const given = input();
      if (given === undefined) {
        return;
      }
      const out = await call("element.bulkUpdate", {
        ...given,
        confirm: true,
        ...(plan === undefined ? {} : { plan }),
      });
      d.close();
      selected.clear();
      written(
        `Changed ${sentence(propDef(store.mm, prop.value)?.name ?? prop.value).toLowerCase()} of ${plural(out.count, "element", "elements")}.`,
        out.problems,
      );
    } catch (error) {
      d.fail(error);
    }
  });
  apply.hidden = true;
  /** The input of the command, or undefined while the value it needs is missing or no number. */
  const input = (): Omit<ElementBulkUpdateInput, "confirm"> | undefined => {
    const operation = op.value as "set" | "add" | "remove";
    const many = propDef(store.mm, prop.value)?.many === true;
    const typed = bulkValue(prop.value, value.value);
    if (operation === "remove" && (!many || typed === undefined)) {
      return { selection: { ids: [...ids] }, property: prop.value, operation };
    }
    return typed === undefined
      ? undefined
      : {
          selection: { ids: [...ids] },
          property: prop.value,
          operation,
          value: typed as NonNullable<ElementBulkUpdateInput["value"]>,
        };
  };
  const reset = (): void => {
    plan = undefined;
    apply.hidden = true;
    result.replaceChildren();
  };
  const preview = h("button", { class: "btn", type: "button" }, "Preview");
  preview.addEventListener("click", () => {
    void (async () => {
      reset();
      const given = input();
      if (given === undefined) {
        result.replaceChildren(h("p", { class: "dlg-summary bad" }, "Give a value."));
        return;
      }
      try {
        const out = await call("element.bulkUpdate", given);
        plan = out.plan;
        result.replaceChildren(previewOf(out));
        apply.textContent = `Change ${plural(out.count, "element", "elements")}`;
        apply.hidden = out.count === 0;
      } catch (error) {
        d.fail(error);
      }
    })();
  });
  const fill = (): void => {
    const d0 = propDef(store.mm, prop.value);
    op.replaceChildren(
      h("option", { value: "set" }, "Set to"),
      ...(d0?.many === true ? [h("option", { value: "add" }, "Add")] : []),
      h(
        "option",
        { value: "remove" },
        d0?.many === true ? "Remove these items, or all without a value" : "Remove",
      ),
    );
    value =
      d0?.kind === "choice"
        ? h(
            "select",
            { id: "dlg-value" },
            d0.many === true ? h("option", { value: "" }, "No item (remove all)") : null,
            (d0.choices ?? []).map((c) => h("option", { value: c.key }, c.name)),
          )
        : d0?.many === true
          ? h("textarea", { id: "dlg-value", rows: 3, placeholder: "One item per line" })
          : h("input", {
              id: "dlg-value",
              type: d0?.kind === "number" ? "number" : d0?.kind === "date" ? "date" : "text",
            });
    value.addEventListener("input", reset);
    value.addEventListener("change", reset);
    valueSlot.replaceChildren(h("label", { class: "field" }, h("span", null, "Value"), value));
    shown();
  };
  /** Removing a single value needs no value: the field is hidden then. */
  const shown = (): void => {
    valueSlot.hidden = op.value === "remove" && propDef(store.mm, prop.value)?.many !== true;
    reset();
  };
  prop.addEventListener("change", fill);
  op.addEventListener("change", shown);
  const d = dialog({
    title: "Change a property",
    body:
      keys.length === 0
        ? h("p", null, "These elements have no property that can be changed together.")
        : [
            h(
              "p",
              null,
              `ReqSeq first shows what the change does to the ${plural(ids.length, "chosen element", "chosen elements")}; nothing is written before you confirm.${leftOut > 0 ? ` ${plural(leftOut, "superseded element is", "superseded elements are")} left out.` : ""}`,
            ),
            h("label", { class: "field" }, h("span", null, "Property"), prop),
            h("label", { class: "field" }, h("span", null, "Change"), op),
            valueSlot,
            result,
          ],
    confirm: keys.length === 0 ? null : apply,
    extra: keys.length === 0 ? null : preview,
  });
  if (keys.length > 0) {
    fill();
  }
}

function previewOf(out: OutputOf<"element.bulkUpdate">): HTMLElement {
  return h(
    "div",
    { "data-preview": true },
    h(
      "p",
      null,
      h(
        "strong",
        null,
        out.count === 0
          ? "Nothing would change."
          : `Would change ${plural(out.count, "element", "elements")}.`,
      ),
      out.unchanged > 0 ? ` ${plural(out.unchanged, "element has", "elements have")} the value already.` : "",
    ),
    out.affected.length === 0
      ? null
      : h(
          "ul",
          { class: "dlg-list" },
          out.affected.map((x) =>
            h("li", { "data-id": x.id }, h("span", { class: "dl-t" }, label(el(x.id), x.shortId))),
          ),
        ),
    out.skipped.length === 0
      ? null
      : [
          h("p", { class: "note" }, `Left out: ${plural(out.skipped.length, "element", "elements")}.`),
          h(
            "ul",
            { class: "dlg-list left" },
            out.skipped.map((x) =>
              h(
                "li",
                { "data-id": x.id },
                h("span", { class: "dl-t" }, label(el(x.id), x.shortId)),
                h("span", { class: "dl-s" }, x.message),
              ),
            ),
          ),
        ],
    out.problems.length === 0
      ? null
      : h(
          "ul",
          { class: "problems" },
          out.problems.map((p) => h("li", { class: p.severity }, p.message)),
        ),
  );
}

// ---------- The list ----------

/** The elements chosen in the list, kept while the person stays with one baseline. */
const selected = new Set<string>();
let selectedFor: string | undefined;

function selectionBar(entries: readonly Entry[]): HTMLElement {
  const bar = h("div", { class: "selbar", role: "region", "aria-label": "Chosen elements" });
  const draw = (): void => {
    const ids = entries.map((x) => x.id).filter((id) => selected.has(id));
    if (ids.length === 0) {
      bar.replaceChildren(h("span", { class: "selcount" }, "Choose elements to decide on several at once."));
      return;
    }
    // "Approve" where every chosen element's type has one status to approve and one of them does not have it yet.
    const approvable =
      ids.every((id) => approvalOf(store.mm, el(id)?.type) !== undefined) &&
      ids.some((id) => {
        const e = el(id);
        return !isInvalid(store.mm, e?.status) && e?.status !== approvalOf(store.mm, e?.type);
      });
    const button = (words: string, act: () => void): HTMLButtonElement => {
      const b = h("button", { class: "btn sm", type: "button" }, words);
      b.addEventListener("click", act);
      return b;
    };
    bar.replaceChildren(
      h("span", { class: "selcount", "data-count": ids.length }, `${String(ids.length)} chosen`),
      ...(approvable
        ? [
            button("Approve", () => {
              approveDialog(ids);
            }),
          ]
        : []),
      button("Set status", () => {
        setStatusDialog(ids);
      }),
      button("Change a property", () => {
        bulkDialog(ids);
      }),
      button("Clear", () => {
        selected.clear();
        refreshChecks();
      }),
    );
  };
  const refreshChecks = (): void => {
    for (const box of document.querySelectorAll<HTMLInputElement>("input[data-pick]")) {
      box.checked = selected.has(box.dataset["pick"] ?? "");
    }
    for (const all of document.querySelectorAll<HTMLInputElement>("input[data-pick-all]")) {
      const ids = entries.filter((x) => x.state === all.dataset["pickAll"]).map((x) => x.id);
      all.checked = ids.length > 0 && ids.every((id) => selected.has(id));
      all.indeterminate = !all.checked && ids.some((id) => selected.has(id));
    }
    draw();
  };
  bar.addEventListener("reqseq:picked", refreshChecks);
  draw();
  return bar;
}

const picked = (): void => {
  document.querySelector(".selbar")?.dispatchEvent(new Event("reqseq:picked"));
};

function row(entry: Entry, baseline: string, current: string | undefined): HTMLElement {
  const e = el(entry.id);
  const ref = e === undefined ? entry.id : refOf(e);
  const box = h("input", {
    type: "checkbox",
    "data-pick": entry.id,
    "aria-label": `Choose ${label(e, entry.id)}`,
  });
  box.checked = selected.has(entry.id);
  box.addEventListener("change", () => {
    if (box.checked) {
      selected.add(entry.id);
    } else {
      selected.delete(entry.id);
    }
    picked();
  });
  return h(
    "div",
    { role: "listitem", class: "crow" },
    box,
    h(
      "a",
      {
        href: changesHref(baseline, ref),
        "data-id": entry.id,
        class: "it",
        "aria-current": current === entry.id ? "true" : null,
      },
      h("span", { class: "id" }, shownId(e)),
      h("span", { class: "t" }, e?.title ?? entry.id),
      h("span", null, statusPill(e?.status)),
    ),
  );
}

function list(data: Since, baseline: string, current: string | undefined, heading: "h1" | "h2"): HTMLElement {
  const groups = STATES.map(([state, words]) => ({
    state,
    words,
    entries: data.entries.filter((x) => x.state === state),
  })).filter((g) => g.entries.length > 0);
  const noId = data.entries.every((x) => shownId(el(x.id)) === "");
  return h(
    "section",
    { class: `list${noId ? " noid" : ""}`, "aria-labelledby": "list-h" },
    h(
      "div",
      { class: "lh" },
      h(heading, { id: "list-h" }, `Changes since ${baseline}`),
      h("p", null, "What changed since the baseline, as ReqSeq compares it. Open one to see the difference."),
    ),
    selectionBar(data.entries),
    h(
      "div",
      { class: "lscroll" },
      groups.length === 0
        ? h("div", { class: "empty" }, h("strong", null, "Nothing changed since this baseline."))
        : null,
      groups.map((g) => {
        const all = h("input", {
          type: "checkbox",
          "data-pick-all": g.state,
          "aria-label": `Choose all ${g.words.toLowerCase()}`,
        });
        all.checked = g.entries.every((x) => selected.has(x.id));
        all.addEventListener("change", () => {
          for (const x of g.entries) {
            if (all.checked) {
              selected.add(x.id);
            } else {
              selected.delete(x.id);
            }
          }
          picked();
        });
        return [
          h("h2", { class: "group cgroup" }, all, h("span", null, g.words), h("b", null, g.entries.length)),
          h(
            "div",
            { role: "list" },
            g.entries.map((x) => row(x, baseline, current)),
          ),
        ];
      }),
    ),
  );
}

// ---------- The panel ----------

function baselinePicker(data: Since, chosen: string): HTMLElement {
  const select = h(
    "select",
    { id: "baseline-pick" },
    data.baselines.map((b) =>
      h("option", { value: b.name, selected: b.name === chosen }, `${b.name} · ${dateText(b.date)}`),
    ),
  );
  select.addEventListener("change", () => {
    location.hash = changesHref(select.value);
  });
  return h("label", { class: "field pick" }, h("span", null, "Compare with baseline"), select);
}

function summary(data: Since, route: Route): HTMLElement {
  const b = data.changes.baseline;
  if (b === undefined) {
    return h("div");
  }
  const c = b.counts;
  const facts: [number | undefined, string][] = [
    [c.changed, "changed"],
    [c.added, "added"],
    [c.superseded, "superseded"],
    [c.removed, "left the selection"],
    [c.unchanged, "unchanged"],
    [c.missing, "not found"],
    [c.inaccessible, "in a repository that is not on this machine"],
  ];
  return h(
    "div",
    { class: "cpanel" },
    flashBox(route),
    baselinePicker(data, b.name),
    h(
      "p",
      { class: "csent" },
      `Baseline ${b.name} of ${dateText(b.date)}${b.view === undefined ? "" : `, for ${variantName(b.view)}`}.`,
    ),
    h(
      "dl",
      { class: "ccounts" },
      facts
        .filter(([n]) => n !== undefined && n > 0)
        .map(([n, words]) => h("div", null, h("dt", null, String(n)), h("dd", null, words))),
    ),
    b.selectionKnown
      ? null
      : h(
          "p",
          { class: "note" },
          "The baseline stores no selection, so no element counts as added or removed.",
        ),
    (data.changes.problems ?? []).length === 0
      ? null
      : h(
          "ul",
          { class: "problems" },
          (data.changes.problems ?? []).map((p) => h("li", { class: p.severity }, p.message)),
        ),
    h(
      "p",
      { class: "note" },
      data.changes.hintTotal === 0
        ? "No open hints in the workspace."
        : `${plural(data.changes.hintTotal, "open hint", "open hints")} in the workspace.`,
      " ",
      h("a", { class: "link", href: hashOf("r") }, "Check and create a baseline"),
    ),
  );
}

/** A wording old and new, marked word by word; built from the marks only, every text as text. */
function wording(before: string | undefined, after: string | undefined): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = wordDiff(before ?? "", after ?? "");
  const block = h("div", { class: "wd" });
  for (const node of template.content.childNodes) {
    if (node instanceof HTMLElement && (node.tagName === "DEL" || node.tagName === "INS")) {
      block.append(h(node.tagName === "DEL" ? "del" : "ins", null, node.textContent));
    } else {
      block.append(node.textContent ?? "");
    }
  }
  return block;
}

const kindName = (key: string): string =>
  relKind(store.mm, key)?.name ?? sentence(propDef(store.mm, key)?.name ?? key);

function differenceOf(diff: Difference, route: Route): HTMLElement[] {
  const parts: HTMLElement[] = [];
  if (diff.text !== undefined) {
    parts.push(
      h("section", { class: "dsec" }, h("h3", null, "Text"), wording(diff.text.before, diff.text.after)),
    );
  }
  if (diff.criteria.length > 0) {
    parts.push(
      h(
        "section",
        { class: "dsec" },
        h("h3", null, "Acceptance criteria"),
        diff.criteria.map((c) => {
          const head =
            c.before === undefined
              ? `Criterion ${String(c.numberAfter ?? "")}, new`
              : c.after === undefined
                ? `Criterion ${String(c.numberBefore ?? "")}, removed`
                : c.numberBefore !== c.numberAfter
                  ? `Criterion ${String(c.numberAfter ?? "")}, was ${String(c.numberBefore ?? "")}`
                  : `Criterion ${String(c.numberAfter ?? "")}`;
          return h("div", { class: "dcrit" }, h("h4", null, head), wording(c.before, c.after));
        }),
      ),
    );
  }
  if (diff.properties.length > 0) {
    parts.push(
      h(
        "section",
        { class: "dsec" },
        h("h3", null, "Properties"),
        diff.properties.map((p) =>
          h(
            "div",
            { class: "dcrit" },
            h("h4", null, sentence(propDef(store.mm, p.key)?.name ?? p.key)),
            wording(p.before, p.after),
          ),
        ),
      ),
    );
  }
  const relations = [
    ...diff.addedRelations.map((r) => ({ r, added: true })),
    ...diff.removedRelations.map((r) => ({ r, added: false })),
  ];
  if (relations.length > 0) {
    parts.push(
      h(
        "section",
        { class: "dsec" },
        h("h3", null, "Relations"),
        h(
          "ul",
          { class: "drel" },
          relations.map(({ r, added }) => {
            const target = el(r.id);
            const words = label(
              target ?? (r.title === undefined ? undefined : { title: r.title, shortId: r.id }),
              r.id,
            );
            return h(
              "li",
              { class: added ? "add" : "rem" },
              h("span", { class: "dk" }, `${added ? "Added" : "Removed"} · ${kindName(r.kind)}`),
              target === undefined
                ? h("span", null, words)
                : h(
                    "a",
                    {
                      class: "link",
                      href: via(hashOf("e", refOf(target)), route),
                    },
                    words,
                  ),
            );
          }),
        ),
      ),
    );
  }
  return parts;
}

/** The open links to review about the element, and the button that marks them reviewed. */
function linksToReview(data: Since, id: string): HTMLElement | null {
  const hints = data.hints.filter((x) => x.elementId === id && x.hintId !== undefined);
  if (hints.length === 0) {
    return null;
  }
  const ids = [...new Set(hints.map((x) => x.hintId ?? ""))];
  const button = actButton(`Mark ${plural(ids.length, "link", "links")} as reviewed`, async () => {
    try {
      await call("hint.confirm", { hintIds: ids, expected: ids.length });
      written(`Marked ${plural(ids.length, "link", "links")} as reviewed.`);
    } catch (error) {
      failed.replaceChildren(problemBox(error));
    }
  });
  button.classList.remove("primary");
  const failed = h("div");
  return h(
    "section",
    { class: "dsec" },
    h("h3", null, "Links to review"),
    h("p", { class: "note" }, "These links point to an element that changed after the link was made."),
    h(
      "ul",
      { class: "problems" },
      hints.map((x) => h("li", { class: x.severity }, x.message)),
    ),
    h("p", null, button),
    failed,
  );
}

/** The difference of an entry since the baseline, as `baseline.compare` gives it. */
async function differenceBody(baseline: string, entry: Entry, route: Route): Promise<Child> {
  if (entry.state === "added") {
    return h("p", { class: "note" }, `New since ${baseline}; it has no older wording to compare with.`);
  }
  try {
    const out = await call("baseline.compare", { baseline, ref: entry.id });
    const parts = differenceOf(out.difference, route);
    return parts.length === 0
      ? h("p", { class: "note" }, "Its text, criteria, properties and relations are as in the baseline.")
      : parts;
  } catch (error) {
    return problemBox(error);
  }
}

/** The decisions on one element: approve, set its status, supersede it; none for a superseded one. */
function decisions(e: ElementPart | undefined): HTMLButtonElement[] {
  if (e === undefined || isInvalid(store.mm, e.status)) {
    return [];
  }
  const button = (words: string, act: () => void, primary = false): HTMLButtonElement => {
    const b = h("button", { class: `btn sm${primary ? " primary" : ""}`, type: "button" }, words);
    b.addEventListener("click", act);
    return b;
  };
  const approval = approvalOf(store.mm, e.type);
  return [
    ...(approval !== undefined && e.status !== approval
      ? [
          button(
            "Approve",
            () => {
              approveDialog([e.id]);
            },
            true,
          ),
        ]
      : []),
    button("Set status", () => {
      setStatusDialog([e.id]);
    }),
    ...(statusesOf(store.mm, e.type).some((s) => isInvalid(store.mm, s))
      ? [
          button("Supersede", () => {
            supersedeDialog(e.id);
          }),
        ]
      : []),
  ];
}

async function detail(data: Since, baseline: string, entry: Entry, route: Route): Promise<HTMLElement> {
  const e = el(entry.id);
  const body = await differenceBody(baseline, entry, route);
  const actions = decisions(e);
  const state = STATES.find(([s]) => s === entry.state)?.[1] ?? cap(entry.state);
  return h(
    "article",
    { class: "cpanel cdetail", "aria-labelledby": "cd-title", "data-id": entry.id },
    flashBox(route),
    h(
      "p",
      { class: "kick" },
      [shownId(e), typeName(store.mm, e?.type), `${state} since ${baseline}`]
        .filter((x) => x !== "")
        .join(" · "),
    ),
    h("a", { class: "cback link", href: changesHref(route.params.get("b") ?? undefined) }, "All changes"),
    h("h1", { id: "cd-title" }, e?.title ?? entry.id),
    h(
      "div",
      { class: "cacts" },
      statusPill(e?.status),
      actions,
      e === undefined
        ? null
        : h("a", { class: "btn sm", href: via(hashOf("e", refOf(e)), route) }, "Open element"),
    ),
    body,
    linksToReview(data, entry.id),
  );
}

// ---------- Pages ----------

const noBaseline = (): HTMLElement =>
  h(
    "div",
    { class: "cpanel" },
    h("h1", null, "No baseline yet"),
    h(
      "p",
      null,
      "A baseline records every element as it is at one moment. Create one, and this page shows what changes after it.",
    ),
    h("p", null, h("a", { class: "btn", href: hashOf("r") }, "Check and create a baseline")),
  );

/** The panel beside the list: the summary, the difference of the chosen entry, or why there is none. */
function panelOf(
  data: Since,
  baseline: string,
  ref: string | undefined,
  entry: Entry | undefined,
  route: Route,
): Promise<HTMLElement> {
  if (ref === undefined) {
    return Promise.resolve(summary(data, route));
  }
  if (entry === undefined) {
    return Promise.resolve(
      h(
        "div",
        { class: "cpanel" },
        h("h1", null, "Not changed since this baseline"),
        h("p", null, `${ref} is not among the changes since ${baseline}.`),
        h(
          "p",
          null,
          h(
            "a",
            { class: "btn", href: changesHref(route.params.get("b") ?? undefined) },
            "Back to the changes",
          ),
        ),
      ),
    );
  }
  return detail(data, baseline, entry, route);
}

async function renderChanges(root: HTMLElement, route: Route): Promise<void> {
  const wanted = route.params.get("b") ?? undefined;
  const ref = route.parts[1];
  const [data] = await Promise.all([readSince(wanted), prepareRail()]);
  if (!isCurrent(route)) {
    return;
  }
  const baseline = data.changes.baseline?.name;
  if (baseline === undefined) {
    await swap(root, frame(CHANGES, noBaseline(), { wide: true }));
    document.title = "Changes · ReqSeq";
    return;
  }
  if (selectedFor !== baseline) {
    selected.clear();
    selectedFor = baseline;
  }
  const target = ref === undefined ? undefined : el(ref);
  const entry = ref === undefined ? undefined : data.entries.find((x) => x.id === (target?.id ?? ref));
  const panel = await panelOf(data, baseline, ref, entry, route);
  if (!isCurrent(route)) {
    return;
  }
  const scroll = root.querySelector(".lscroll")?.scrollTop ?? 0;
  await swap(root, frame(CHANGES, [list(data, baseline, entry?.id, ref === undefined ? "h1" : "h2"), panel]));
  const lscroll = root.querySelector(".lscroll");
  if (lscroll !== null) {
    lscroll.scrollTop = scroll;
  }
  document.title = `${entry === undefined ? `Changes since ${baseline}` : label(el(entry.id), entry.id)} · ReqSeq`;
}

// ---------- Check before a baseline ----------

const SEVERITY = [
  ["error", "Errors"],
  ["warning", "Warnings"],
  ["info", "Notes"],
] as const;

function problemList(problems: readonly Problem[]): HTMLElement[] {
  return SEVERITY.map(([severity, words]) => ({
    words,
    severity,
    items: problems.filter((p) => p.severity === severity),
  }))
    .filter((g) => g.items.length > 0)
    .map((g) =>
      h(
        "section",
        { class: "dsec" },
        h("h3", null, `${g.words} `, h("b", null, g.items.length)),
        h(
          "ul",
          { class: "problems" },
          g.items.map((p) => {
            const e = p.elementId === undefined ? undefined : el(p.elementId);
            return h(
              "li",
              { class: p.severity },
              e === undefined
                ? null
                : h("a", { class: "link", href: withFrom(hashOf("e", refOf(e)), "r") }, label(e, e.id)),
              e === undefined ? null : " ",
              h("span", null, p.message),
            );
          }),
        ),
      ),
    );
}

function createForm(): HTMLElement {
  const name = h("input", { id: "bl-name", type: "text", autocomplete: "off", required: true });
  const packageTypes = typesWith(store.mm, "package");
  const packages = [...store.byId.values()].filter(
    (e) => packageTypes.includes(e.type ?? "") && !isInvalid(store.mm, e.status),
  );
  const scope = h(
    "select",
    { id: "bl-scope" },
    h("option", { value: "" }, "The whole workspace"),
    packages.map((p) => h("option", { value: p.id }, p.title ?? p.shortId)),
  );
  const view = viewSelection().view;
  const variant = view === undefined || view === "core" ? undefined : view;
  const scopeWords = (): string => {
    const p = scope.value === "" ? undefined : el(scope.value);
    const what =
      p === undefined
        ? "the whole workspace"
        : `${packageWord(store.mm).toLowerCase()} ${p.title ?? p.shortId}`;
    return variant === undefined ? what : `${what}, for ${variantName(variant)}`;
  };
  const start = h("button", { class: "btn primary", type: "button" }, "Create baseline");
  const hint = h("p", { class: "note", "data-name-hint": true });
  start.addEventListener("click", () => {
    const typed = name.value.trim();
    if (typed === "") {
      hint.textContent = "Give the baseline a name.";
      name.focus();
      return;
    }
    hint.textContent = "";
    const words = `Create baseline ${typed} of ${scopeWords()}`;
    const d = dialog({
      title: "Create baseline",
      body: [
        h("p", null, `${words}.`),
        h(
          "p",
          { class: "note" },
          "A baseline records the version and commit of each element. It is never changed after it is written.",
        ),
      ],
      confirm: actButton(words, async () => {
        try {
          const out = await call("baseline.create", {
            name: typed,
            selection: {
              ...(scope.value === "" ? {} : { package: scope.value }),
              ...(variant === undefined ? {} : { view: variant }),
            },
          });
          d.close();
          written(
            `Baseline ${out.baseline.name} written to ${out.baseline.file}, with ${plural(out.baseline.elements, "element", "elements")}.`,
            out.problems ?? [],
          );
        } catch (error) {
          d.fail(error);
        }
      }),
    });
  });
  return h(
    "section",
    { class: "dsec create", "aria-labelledby": "bl-h" },
    h("h2", { id: "bl-h" }, "Create a baseline"),
    h(
      "p",
      { class: "note" },
      "It records what the elements say now, so later changes can be reviewed against it.",
    ),
    h("label", { class: "field" }, h("span", null, "Name"), name),
    packages.length === 0 ? null : h("label", { class: "field" }, h("span", null, "Elements"), scope),
    variant === undefined
      ? null
      : h("p", { class: "note" }, `For ${variantName(variant)}, the view chosen in the menu.`),
    hint,
    h("p", null, start),
  );
}

async function renderRelease(root: HTMLElement, route: Route): Promise<void> {
  const selection = viewSelection();
  const [prep] = await Promise.all([
    call("baseline.prepare", selection.view === undefined ? {} : { selection }),
    prepareRail(),
  ]);
  if (!isCurrent(route)) {
    return;
  }
  const d = prep.degree;
  const b = prep.baseline;
  const problems = [...prep.problems, ...(b?.problems ?? []), ...(prep.baselineFiles?.problems ?? [])];
  const errors = problems.filter((p) => p.severity === "error").length;
  const warnings = problems.filter((p) => p.severity === "warning").length;
  const page = h(
    "div",
    { class: "release" },
    h("h1", null, "Check before a baseline"),
    h(
      "p",
      { class: "sub" },
      "What ReqSeq checks before a baseline: the problems of the workspace, how much is verified, and what changed since the newest baseline.",
    ),
    flashBox(route),
    h(
      "dl",
      { class: "ccounts big" },
      h(
        "div",
        { class: errors > 0 ? "bad" : "" },
        h("dt", null, String(errors)),
        h("dd", null, errors === 1 ? "error" : "errors"),
      ),
      h("div", null, h("dt", null, String(warnings)), h("dd", null, warnings === 1 ? "warning" : "warnings")),
      h(
        "div",
        null,
        h("dt", null, `${String(d.counts.verified + d.counts.indirect)} of ${String(d.total)}`),
        h(
          "dd",
          null,
          `${reqWords(store.mm)} verified${prep.view === "core" ? "" : ` for ${variantName(prep.view)}`}`,
        ),
      ),
      h("div", null, h("dt", null, String(prep.withoutPassedTest)), h("dd", null, "without a passed test")),
    ),
    prep.wholeWorkspace === true && selection.view !== undefined
      ? h("p", { class: "note" }, "The problems are those of the whole workspace.")
      : null,
    b === undefined
      ? h("p", { class: "note" }, "The workspace has no baseline yet.")
      : h(
          "p",
          { class: "csent" },
          `Since baseline ${b.name} of ${dateText(b.date)}: ${String(b.counts.changed)} changed, ${String(b.counts.added ?? 0)} added, ${String(b.counts.superseded)} superseded. `,
          h("a", { class: "link", href: changesHref(b.name) }, "Review the changes"),
        ),
    problemList(problems),
    createForm(),
  );
  await swap(root, frame(RELEASE, h("main", { class: "release-wrap" }, page), { wide: true }));
  document.title = "Check before a baseline · ReqSeq";
}

addRoute("c", renderChanges);
addRoute("r", renderRelease);

addRailSection({
  order: 30,
  title: "Review",
  prepare: async () => {
    const key = stamp();
    if (railCounts?.key === key) {
      return;
    }
    try {
      const out = await call("baseline.changes", { limit: 1 });
      railCounts = {
        key,
        count: out.baseline === undefined ? undefined : listedCount(out.baseline.counts),
        ...(out.baseline === undefined ? {} : { name: out.baseline.name }),
      };
    } catch {
      railCounts = { key, count: undefined };
    }
  },
  links: () => [
    {
      href: hashOf("c"),
      key: CHANGES,
      name: railCounts?.name === undefined ? "Changes since a baseline" : `Changes since ${railCounts.name}`,
      count: railCounts?.count,
    },
    { href: hashOf("r"), key: RELEASE, name: "Check before a baseline" },
  ],
});
