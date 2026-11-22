// Creating and editing elements (`#/new[?type=<type>]`, `#/edit/<identifier or short ID>`): a form built from
// `metamodel.get` for every type and every property kind, the relations `relation.options` offers, links to other
// elements typed into a text, and images. ReqSeq writes: `element.create` (with the next identifier, SR-245),
// `element.update` with the file's SHA-256 the form was opened on, both with a dry run to check first (SR-246),
// `element.addAttachment` for an image (its bytes, never a local path) and `element.assignCriterionKeys`. A form
// never sets a status (D-030).
//
// Typed text is held here, not in the page: a redraw after a change of the workspace draws the form again from
// what was typed, with focus and caret where they were. Leaving a form with typed text asks first.
import "../css/edit.css";
import type { ElementGetOutput, RelationOptionsOutput } from "@reqseq/core";
import type { InputOf } from "../api.js";
import { call, explain } from "../api.js";
import type { Child } from "../dom.js";
import { announce, h, icon } from "../dom.js";
import { addRailSection, errorBox } from "../layout.js";
import { statusPill } from "../marks.js";
import type { Metamodel } from "../meaning.js";
import { propDef, propKey, propOfType, relKind, sentence, typeDef, typeName, typesWith } from "../meaning.js";
import { markdown } from "../markdown.js";
import type { Route } from "../router.js";
import { HOME, addRoute, hashOf, isCurrent, parseHash } from "../router.js";
import { load, refOf, store } from "../store.js";
import type { Target } from "./edit-pick.js";
import { picker, targetOf } from "./edit-pick.js";

type Kind = RelationOptionsOutput["kinds"][number];
type Property = Metamodel["properties"][number];

/** An item of a text list as the form holds it; an acceptance criterion keeps its criterion key. */
interface Item {
  key?: string | undefined;
  text: string;
}

/**
 * A value as the form holds it: a text, a number or date as typed, a choice key (`""` for none); a list of them;
 * the items of a text list; the targets of a relation property.
 */
type Value = string | string[] | Item[] | Target[];

interface Draft {
  /** The route of the form; a draft belongs to one route. */
  readonly route: string;
  readonly mode: "create" | "edit";
  /** Where the way back leads. */
  readonly back: string;
  /** Edit: the element, its repository and file, and the SHA-256 of its file the form was opened on. */
  id?: string;
  repository?: string;
  file?: string;
  sha?: string;
  status?: string | undefined;
  type: string;
  title: string;
  text: string;
  values: Record<string, Value>;
  relations: Record<string, Target[]>;
  kinds: readonly Kind[];
  /** Create: give the next identifier of the type (SR-245), following `prefix`. */
  nextId: boolean;
  prefix: string;
  /** What the form saves, as it was when opened: unsaved changes are the difference. */
  saved: string;
  /** The file changed on disk after the form was opened. */
  elsewhere: boolean;
  /** Edit: acceptance criteria without a criterion key. */
  keyless: number;
  /** Edit: where an imported element came from, as people read it. */
  origin: readonly { readonly name: string; readonly value: string }[];
  /** Markdown fields shown as preview. */
  preview: Set<string>;
  /** The answer of the last check, save or image, kept across redraws. */
  note?: Note | undefined;
  busy: boolean;
}

/** The answer of a check, a save or an image. */
interface Note {
  readonly kind: "ok" | "bad";
  readonly body: () => Child;
}

let draft: Draft | undefined;

// ---------- The metamodel, for the form ----------

const meaningOf = (key: string): Property["meaning"] => propDef(store.mm, key)?.meaning;

/** The types elements can be made of, in metamodel order. */
const creatable = (mm: Metamodel): string[] => mm.types.filter((t) => !t.abstract).map((t) => t.key);

/** The types `keys` allows, each with its subtypes; every type when `keys` is absent. */
const allowedTypes = (mm: Metamodel, keys: readonly string[] | undefined): string[] =>
  keys === undefined
    ? creatable(mm)
    : mm.types
        .filter((t) => !t.abstract && (keys.includes(t.key) || t.ancestors.some((a) => keys.includes(a))))
        .map((t) => t.key);

/**
 * The relation kinds a new element of `type` can get, as `relation.options` gives them for an element: there is
 * no element yet to ask about, so the form reads the same source and target types of the metamodel.
 */
function kindsForType(mm: Metamodel, type: string): Kind[] {
  const self = typeDef(mm, type);
  const ancestry = [type, ...(self?.ancestors ?? [])];
  return mm.relations
    .filter((r) => r["source-types"] === undefined || r["source-types"].some((s) => ancestry.includes(s)))
    .map((r) => ({ kind: r.key, name: r.name, targetTypes: allowedTypes(mm, r["target-types"]) }))
    .filter((k) => k.targetTypes.length > 0);
}

/**
 * The kinds the form offers: superseding is a decision about the status of both elements, which the review of
 * changes takes with a confirmation (`element.supersede`), never a field of a form.
 */
const offered = (kinds: readonly Kind[]): Kind[] =>
  kinds.filter((k) => relKind(store.mm, k.kind)?.meaning !== "succession");

/** The meanings of where an imported element came from: only the ReqIF import writes them (SR-057). */
const ORIGIN: ReadonlySet<string> = new Set([
  "source",
  "source-identifier",
  "import-date",
  "delivery",
  "import-version",
]);

const isOrigin = (key: string): boolean => ORIGIN.has(meaningOf(key) ?? "");

/**
 * The properties the form has fields for: all of the type but the title, which has a field of its own, and the
 * origin of an import, which the form shows but does not change.
 */
const fieldsOf = (type: string): string[] =>
  (typeDef(store.mm, type)?.properties ?? []).filter((key) => meaningOf(key) !== "title" && !isOrigin(key));

const requiredOf = (type: string): readonly string[] => typeDef(store.mm, type)?.required ?? [];

// ---------- Values: from the element, and to the input of a command ----------

/** A scalar as text; anything else is empty. */
const textOf = (raw: unknown): string =>
  typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";

/** A field of an object value, if it is a string. */
const fieldOf = (raw: unknown, name: string): string | undefined => {
  const value = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)[name] : undefined;
  return typeof value === "string" ? value : undefined;
};

const itemOf = (raw: unknown): Item =>
  typeof raw === "object" && raw !== null
    ? { key: fieldOf(raw, "key"), text: fieldOf(raw, "text") ?? "" }
    : { text: textOf(raw) };

const listOf = (raw: unknown): readonly unknown[] =>
  Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];

/** The value of property `key` as the form holds it, from the value `element.get` gives. */
function formValue(key: string, raw: unknown): Value {
  const d = propDef(store.mm, key);
  if (d?.kind === "relation") {
    return listOf(raw).map((v) =>
      typeof v === "object" && v !== null
        ? targetOf(fieldOf(v, "id") ?? "", { title: fieldOf(v, "title") })
        : targetOf(textOf(v)),
    );
  }
  if (d?.many === true) {
    return d.kind === "text" ? listOf(raw).map(itemOf) : listOf(raw).map(textOf);
  }
  return typeof raw === "object" && raw !== null ? itemOf(raw).text : textOf(raw);
}

/** An empty value of property `key`. */
const emptyValue = (key: string): Value => {
  const d = propDef(store.mm, key);
  return d?.kind === "relation" || d?.many === true ? [] : "";
};

const scalarOf = (d: Property | undefined, text: string): string | number =>
  d?.kind === "number" && text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text;

/** The value a command takes for property `key`, or undefined when the field is empty. */
function inputValue(key: string, value: Value | undefined): unknown {
  const d = propDef(store.mm, key);
  if (value === undefined) {
    return undefined;
  }
  if (d?.kind === "relation") {
    const ids = (value as Target[]).map((t) => t.id);
    return ids.length === 0 ? undefined : d.many === true ? ids : ids[0];
  }
  if (Array.isArray(value)) {
    if (d?.kind === "text") {
      const items = (value as Item[]).filter((i) => i.text.trim() !== "");
      const criteria = d.meaning === "acceptance-criteria";
      const out = items.map((i) =>
        criteria ? (i.key === undefined ? { text: i.text } : { key: i.key, text: i.text }) : i.text,
      );
      return out.length === 0 ? undefined : out;
    }
    const out = (value as string[]).filter((v) => v.trim() !== "").map((v) => scalarOf(d, v));
    return out.length === 0 ? undefined : out;
  }
  return value.trim() === "" ? undefined : scalarOf(d, value);
}

/** Which properties have a value, as a command takes them. */
function inputValues(d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of fieldsOf(d.type)) {
    if (d.mode === "create" && d.nextId && meaningOf(key) === "identifier") {
      continue;
    }
    const value = inputValue(key, d.values[key]);
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

/** The targets by kind, for the kinds the form offers. */
function inputRelations(d: Draft): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of offered(d.kinds)) {
    const ids = (d.relations[k.kind] ?? []).map((t) => t.id);
    if (ids.length > 0) {
      out[k.kind] = ids;
    }
  }
  return out;
}

/** What a save writes, to compare with what was opened. */
const snapshot = (d: Draft): string =>
  JSON.stringify({
    type: d.type,
    title: d.title,
    text: d.text,
    values: inputValues(d),
    relations: inputRelations(d),
    nextId: d.mode === "create" && d.nextId,
    prefix: d.mode === "create" && d.nextId ? d.prefix.trim() : "",
  });

const isDirty = (d: Draft | undefined): boolean => d !== undefined && snapshot(d) !== d.saved;

// ---------- Drafts ----------

const backOf = (route: Route, fallback: string): string => {
  const from = route.params.get("from");
  return from?.startsWith("/") === true ? from : fallback;
};

/** The type a new element gets first: the one the route names, else the first requirement type, else the first. */
function firstType(route: Route): string {
  const asked = route.params.get("type");
  const types = creatable(store.mm);
  if (asked !== null && types.includes(asked)) {
    return asked;
  }
  return typesWith(store.mm, "requirement")[0] ?? types[0] ?? "";
}

function newDraft(route: Route): Draft {
  const type = firstType(route);
  const d: Draft = {
    route: route.hash,
    mode: "create",
    back: backOf(route, HOME),
    type,
    title: "",
    text: "",
    values: {},
    relations: {},
    kinds: kindsForType(store.mm, type),
    nextId: propOfType(store.mm, type, "identifier") !== undefined,
    prefix: "",
    saved: "",
    elsewhere: false,
    keyless: 0,
    origin: [],
    preview: new Set(),
    busy: false,
  };
  d.saved = snapshot(d);
  return d;
}

function editDraft(route: Route, got: ElementGetOutput, kinds: readonly Kind[]): Draft {
  const e = got.element;
  const criteria = propOfType(store.mm, e.type, "acceptance-criteria");
  const relations: Record<string, Target[]> = {};
  for (const r of e.relations) {
    if (r.direction === "out" && r.property !== true) {
      (relations[r.kind] ??= []).push(
        targetOf(r.id, { title: r.title, identifier: r.identifier ?? r.shortId }),
      );
    }
  }
  const values: Record<string, Value> = {};
  for (const key of fieldsOf(e.type)) {
    values[key] = formValue(key, e.properties[key]);
  }
  const d: Draft = {
    route: route.hash,
    mode: "edit",
    back: backOf(route, hashOf("e", refOf(e)).slice(1)),
    id: e.id,
    repository: e.repository,
    file: e.file,
    sha: got.fileSha256,
    status: e.status,
    type: e.type,
    title: e.title,
    text: e.text ?? "",
    values,
    relations,
    kinds,
    nextId: false,
    prefix: "",
    saved: "",
    elsewhere: false,
    keyless:
      criteria === undefined
        ? 0
        : listOf(e.properties[criteria]).filter((i) => itemOf(i).key === undefined).length,
    origin: (typeDef(store.mm, e.type)?.properties ?? [])
      .filter((key) => isOrigin(key) && textOf(e.properties[key]) !== "")
      .map((key) => ({
        name: sentence(propDef(store.mm, key)?.name ?? key),
        value: textOf(e.properties[key]),
      })),
    preview: new Set(),
    busy: false,
  };
  d.saved = snapshot(d);
  return d;
}

// ---------- Commands ----------

function createInput(d: Draft, dryRun: boolean): InputOf<"element.create"> {
  const relations = inputRelations(d);
  const prefix = d.prefix.trim();
  return {
    type: d.type,
    title: d.title,
    ...(d.text.trim() === "" ? {} : { text: d.text }),
    properties: inputValues(d) as NonNullable<InputOf<"element.create">["properties"]>,
    ...(Object.keys(relations).length === 0 ? {} : { relations }),
    ...(d.nextId ? { nextIdentifier: true, ...(prefix === "" ? {} : { identifierPrefix: prefix }) } : {}),
    ...(dryRun ? { dryRun: true } : {}),
  };
}

interface Opened {
  readonly title: string;
  readonly text: string;
  readonly values: Record<string, unknown>;
  readonly relations: Record<string, string[]>;
}

/** The properties to set and to remove: those that differ from what was opened. */
function changedValues(d: Draft, opened: Opened): { set: Record<string, unknown>; unset: string[] } {
  const now = inputValues(d);
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  for (const key of fieldsOf(d.type)) {
    if (JSON.stringify(now[key]) === JSON.stringify(opened.values[key])) {
      continue;
    }
    if (now[key] === undefined) {
      unset.push(key);
    } else {
      set[key] = now[key];
    }
  }
  return { set, unset };
}

/** The relations to add and to remove, by kind. */
function changedRelations(
  d: Draft,
  opened: Opened,
): { add: Record<string, string[]>; remove: Record<string, string[]> } {
  const rel = inputRelations(d);
  const add: Record<string, string[]> = {};
  const remove: Record<string, string[]> = {};
  for (const kind of new Set([...Object.keys(rel), ...Object.keys(opened.relations)])) {
    const before = opened.relations[kind] ?? [];
    const after = rel[kind] ?? [];
    const added = after.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !after.includes(id));
    if (added.length > 0) {
      add[kind] = added;
    }
    if (removed.length > 0) {
      remove[kind] = removed;
    }
  }
  return { add, remove };
}

/** `{ [name]: value }`, or nothing when `value` is empty. */
const some = (name: string, value: Record<string, unknown> | readonly unknown[]): Record<string, unknown> =>
  (Array.isArray(value) ? value.length : Object.keys(value).length) === 0 ? {} : { [name]: value };

/**
 * The change as `element.update` takes it: only what differs from what was opened, with the SHA-256 of the file
 * it was opened on, so a change made elsewhere meanwhile is refused instead of overwritten.
 */
function updateInput(d: Draft, dryRun: boolean): InputOf<"element.update"> {
  const opened = JSON.parse(d.saved) as Opened;
  const { set, unset } = changedValues(d, opened);
  const { add, remove } = changedRelations(d, opened);
  return {
    ref: d.id ?? "",
    ...(d.repository === undefined ? {} : { repository: d.repository }),
    ...(d.sha === undefined ? {} : { expectedFileSha256: d.sha }),
    ...(d.title === opened.title ? {} : { title: d.title }),
    ...(d.text === opened.text ? {} : { text: d.text }),
    ...some("set", set),
    ...some("unset", unset),
    ...some("addRelations", add),
    ...some("removeRelations", remove),
    ...(dryRun ? { dryRun: true } : {}),
  };
}

interface Problem {
  readonly severity?: string;
  readonly message: string;
}

/** The answer of a command and the problems it names. */
const answerBody =
  (answer: string, problems: readonly Problem[], more: Child = null): (() => Child) =>
  () => [
    h("strong", null, answer),
    more,
    problems.length === 0
      ? null
      : h(
          "ul",
          { class: "ed-problems" },
          problems.map((p) => h("li", { class: p.severity === "error" ? "bad" : null }, p.message)),
        ),
  ];

const failed = (error: unknown): Note => ({ kind: "bad", body: () => errorBox(error) });

/** Checks the form with a dry run: what a save would write, and the problems ReqSeq sees. */
async function check(d: Draft): Promise<void> {
  d.busy = true;
  redraw();
  try {
    if (d.mode === "create") {
      const out = await call("element.create", createInput(d, true));
      d.note = { kind: "ok", body: answerBody(out.answer, out.problems ?? out.element.problems ?? []) };
    } else {
      const out = await call("element.update", updateInput(d, true));
      const affected = out.affected;
      d.note = {
        kind: "ok",
        body: answerBody(
          out.answer,
          out.problems ?? out.element.problems ?? [],
          affected === 0
            ? null
            : h(
                "p",
                null,
                `Saving gives a new version: ${String(affected)} ${affected === 1 ? "element points" : "elements point"} to this one and will show the link as changed.`,
              ),
        ),
      };
    }
  } catch (error) {
    d.note = failed(error);
  }
  d.busy = false;
  redraw({ focus: "ed-check" });
}

/**
 * After a write of the form: the store is read again and the page drawn again. No change event follows a write the
 * server made itself (its watcher finds the element store already current), so the page asks itself. The page moves
 * on first and does not wait for the read.
 */
function reread(): void {
  void load()
    .then(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    })
    .catch(() => undefined);
}

/** Saves the form and opens the element. */
async function save(d: Draft): Promise<void> {
  d.busy = true;
  redraw();
  try {
    if (d.mode === "create") {
      const out = await call("element.create", createInput(d, false));
      draft = undefined;
      announce(out.answer);
      location.hash = hashOf("e", refOf(out.element));
      reread();
    } else {
      const out = await call("element.update", updateInput(d, false));
      draft = undefined;
      announce(out.answer);
      location.hash = d.back;
      reread();
    }
  } catch (error) {
    d.busy = false;
    d.note = failed(error);
    if (error instanceof Error && (error as { code?: unknown }).code === "file.changed-on-disk") {
      d.elsewhere = true;
    }
    redraw({ focus: "ed-save" });
  }
}

// ---------- Leaving with typed text ----------

/** Asks whether to leave and lose the typed text; resolves true to leave. */
function askLeave(): Promise<boolean> {
  return new Promise((resolve) => {
    const stay = h("button", { class: "btn", type: "button", autofocus: true }, "Keep editing");
    const leave = h("button", { class: "btn ed-danger", type: "button" }, "Leave without saving");
    const dialog = h(
      "dialog",
      { class: "ed-dialog", "aria-labelledby": "ed-leave-h", "aria-describedby": "ed-leave-p" },
      h("h2", { id: "ed-leave-h" }, "Leave without saving?"),
      h("p", { id: "ed-leave-p" }, "What you typed in this form is not saved and will be lost."),
      h("div", { class: "ed-dialog-actions" }, stay, leave),
    );
    const done = (answer: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    stay.addEventListener("click", () => {
      done(false);
    });
    leave.addEventListener("click", () => {
      done(true);
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      done(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    stay.focus();
  });
}

let asking = false;

/** Asks once whether to leave the form, and runs `go` on yes. */
function leaveWith(go: () => void): void {
  if (asking) {
    return;
  }
  asking = true;
  void askLeave().then((leave) => {
    asking = false;
    if (leave) {
      draft = undefined;
      go();
    }
  });
}

const leaveTo = (target: string): void => {
  leaveWith(() => {
    location.hash = target;
  });
};

// A link out of a form with typed text asks before the address changes, so the history stays as it was. A click
// that opens another tab or window leaves the form alone.
document.addEventListener(
  "click",
  (event) => {
    const d = draft;
    const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
    const other = event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
    if (d === undefined || other || !(link instanceof HTMLAnchorElement) || link.closest(".skip") !== null) {
      return;
    }
    const href = link.getAttribute("href") ?? "";
    if (parseHash(href).hash === d.route || !isDirty(d)) {
      return;
    }
    event.preventDefault();
    leaveTo(href);
  },
  { capture: true },
);

// The browser's way back and forward, where it asks the page first (the Navigation API): the move is cancelled,
// so the history stays as it was, and made after a yes.
const navigation = (window as { navigation?: Navigation }).navigation;
navigation?.addEventListener("navigate", (event) => {
  const d = draft;
  if (d === undefined || event.navigationType !== "traverse" || !event.cancelable || !isDirty(d)) {
    return;
  }
  if (parseHash(new URL(event.destination.url).hash).hash === d.route) {
    return;
  }
  event.preventDefault();
  const key = event.destination.key;
  const nav = event.currentTarget as Navigation;
  leaveWith(() => {
    void nav.traverseTo(key).finished?.catch(() => undefined);
  });
});

// Any other change of the address, and back and forward where the browser does not ask first: registered when the
// module loads, before the router's own listener, a form with typed text puts its address back before the router
// reads it, so the page stays, and asks. The entry left keeps the form's address then.
window.addEventListener("hashchange", () => {
  const d = draft;
  if (d === undefined) {
    return;
  }
  if (parseHash(location.hash).hash === d.route) {
    return;
  }
  if (!isDirty(d)) {
    draft = undefined;
    return;
  }
  const target = location.hash;
  history.replaceState(history.state, "", `#${d.route}`);
  leaveTo(target);
});

window.addEventListener("beforeunload", (event) => {
  if (isDirty(draft)) {
    event.preventDefault();
  }
});

// ---------- Drawing ----------

let host: HTMLElement | undefined;

const fieldId = (key: string, at?: number): string => `f-${key}${at === undefined ? "" : `-${String(at)}`}`;

/** Marks a field as changed: the save button and the note of unsaved changes follow without a redraw. */
function touch(): void {
  const d = draft;
  if (d === undefined || host === undefined) {
    return;
  }
  const dirty = isDirty(d);
  host.querySelector(".ed-dirty")?.toggleAttribute("hidden", !dirty);
  const saveButton = host.querySelector<HTMLButtonElement>("[data-save]");
  if (saveButton !== null) {
    saveButton.disabled = d.busy || (d.mode === "edit" && !dirty);
  }
  const give = host.querySelector<HTMLButtonElement>("#ed-give-keys");
  if (give !== null) {
    give.disabled = d.busy || dirty;
  }
  host.querySelector(".ed-keys-wait")?.toggleAttribute("hidden", !dirty);
}

const label = (text: string, forId: string, required: boolean): HTMLElement =>
  h(
    "label",
    { class: "ed-label", for: forId },
    text,
    required ? h("span", { class: "ed-req" }, "required") : null,
  );

const describe = (key: string): Child => {
  const description = propDef(store.mm, key)?.description;
  return description === undefined || description === ""
    ? null
    : h("p", { class: "ed-help", id: `${fieldId(key)}-help` }, description);
};

const helpOf = (key: string): string | null =>
  (propDef(store.mm, key)?.description ?? "") === "" ? null : `${fieldId(key)}-help`;

/** Puts `text` in place of the selection of `field`, and puts the caret after it. */
function insertAt(field: HTMLTextAreaElement, from: number, to: number, text: string): void {
  field.setRangeText(text, from, to, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
}

/** A Markdown link text: brackets and backslashes escaped. */
const linkText = (title: string): string => title.replace(/[[\]\\]/g, (c) => `\\${c}`).replace(/\s+/g, " ");

const IMAGES = ".avif,.bmp,.gif,.jpeg,.jpg,.png,.svg,.webp";

const base64Of = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error(`${file.name} could not be read`));
    };
    reader.readAsDataURL(file);
  });

/** Whether `file` is an image the workspace takes, by its type or name. */
const isImage = (file: File): boolean =>
  file.type.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name);

/** Copies `files` into the workspace for the element and puts their Markdown into `field` at the caret. */
async function addImages(d: Draft, field: HTMLTextAreaElement, files: readonly File[]): Promise<void> {
  const images = files.filter(isImage);
  if (images.length === 0 || d.id === undefined) {
    return;
  }
  for (const file of images) {
    try {
      const out = await call("element.addAttachment", {
        ref: d.id,
        ...(d.repository === undefined ? {} : { repository: d.repository }),
        ...(d.file === undefined ? {} : { file: d.file }),
        content: await base64Of(file),
        name: file.name,
      });
      if (draft !== d) {
        return;
      }
      const now = host?.querySelector<HTMLTextAreaElement>(`#${CSS.escape(field.id)}`) ?? field;
      insertAt(now, now.selectionStart, now.selectionEnd, out.markdown);
      d.note = {
        kind: "ok",
        body: () => [
          h("strong", null, `Image ${file.name} added.`),
          " It is copied into the workspace now, as ",
          h("code", null, out.file),
          "; the text shows it once you save.",
        ],
      };
    } catch (error) {
      d.note = failed(error);
    }
    redraw();
  }
}

/**
 * A Markdown text field with its tools: link an element (also by typing `[[`), add an image (also by pasting or
 * dropping one) and a preview.
 */
function markdownField(
  d: Draft,
  id: string,
  name: string,
  get: () => string,
  set: (text: string) => void,
  describedBy: string | null,
  rows = 6,
): HTMLElement {
  const field = h(
    "textarea",
    { id, class: "ed-text", rows, "aria-describedby": describedBy, spellcheck: "true" },
    get(),
  );
  field.value = get();
  let start = -1;
  const linking = picker({
    label: `Link an element in ${name}`,
    taken: () => (d.id === undefined ? [] : [d.id]),
    field,
    onPick: (t) => {
      const at = field.selectionStart;
      insertAt(field, start, at, `[${linkText(t.title)}](reqseq:${t.ref})`);
      start = -1;
    },
    onClose: () => {
      start = -1;
    },
  });
  field.setAttribute("aria-controls", linking.root.querySelector("[role=listbox]")?.id ?? "");
  field.addEventListener("input", () => {
    set(field.value);
    touch();
    const before = field.value.slice(0, field.selectionStart);
    const typed = /\[\[([^\]\n]{0,60})$/.exec(before);
    if (typed === null) {
      start = -1;
      linking.close();
      return;
    }
    start = typed.index;
    linking.search(typed[1] ?? "");
  });
  const linkButton = h("button", { class: "btn sm", type: "button" }, "Link element");
  linkButton.addEventListener("click", () => {
    field.focus();
    insertAt(field, field.selectionStart, field.selectionEnd, "[[");
  });
  const files = h("input", { type: "file", accept: IMAGES, multiple: true, hidden: true });
  files.addEventListener("change", () => {
    void addImages(d, field, [...(files.files ?? [])]);
  });
  const imageButton = h(
    "button",
    {
      class: "btn sm",
      type: "button",
      disabled: d.mode === "create",
      title: d.mode === "create" ? "Images can be added once the element is created." : null,
    },
    "Add image",
  );
  imageButton.addEventListener("click", () => {
    files.click();
  });
  if (d.mode === "edit") {
    field.addEventListener("paste", (event) => {
      const pasted = [...(event.clipboardData?.files ?? [])];
      if (pasted.some(isImage)) {
        event.preventDefault();
        void addImages(d, field, pasted);
      }
    });
    field.addEventListener("drop", (event) => {
      const dropped = [...(event.dataTransfer?.files ?? [])];
      if (dropped.some(isImage)) {
        event.preventDefault();
        void addImages(d, field, dropped);
      }
    });
  }
  const previewing = d.preview.has(id);
  const previewButton = h(
    "button",
    { class: "btn sm", type: "button", id: `${id}-preview`, "aria-pressed": String(previewing) },
    "Preview",
  );
  previewButton.addEventListener("click", () => {
    if (d.preview.has(id)) {
      d.preview.delete(id);
    } else {
      d.preview.add(id);
    }
    redraw();
  });
  const preview = h("div", { class: "ed-preview", hidden: !previewing, "aria-live": "polite" });
  if (previewing) {
    field.hidden = true;
    void markdown(get(), { id: d.id, repository: d.repository, file: d.file ?? "" }, d.route, "prose").then(
      (block) => {
        preview.replaceChildren(
          get().trim() === "" ? h("p", { class: "ed-help" }, "Nothing written yet.") : block,
        );
      },
    );
  }
  return h(
    "div",
    { class: "ed-md" },
    h(
      "div",
      { class: "ed-tools", role: "toolbar", "aria-label": `Tools for ${name}` },
      linkButton,
      imageButton,
      previewButton,
      files,
    ),
    field,
    preview,
    linking.root,
    d.mode === "create"
      ? null
      : h("p", { class: "ed-help" }, "Type [[ to link an element. Paste or drop an image to add it."),
  );
}

/** The chosen targets with a button to remove each, and a search to add one. */
function targetsField(
  id: string,
  name: string,
  targets: () => Target[],
  types: readonly string[],
  many: boolean,
  describedBy: string | null,
): HTMLElement {
  const chosen = targets();
  const add = picker({
    label: many ? `Add to ${name}` : name,
    types,
    // Not the element itself.
    taken: () => [...targets().map((t) => t.id), ...(draft?.id === undefined ? [] : [draft.id])],
    onPick: (t) => {
      const list = targets();
      list.push(t);
      touch();
      redraw({ focus: `${id}-search` });
    },
  });
  add.input.id = `${id}-search`;
  if (describedBy !== null) {
    add.input.setAttribute("aria-describedby", describedBy);
  }
  return h(
    "div",
    { class: "ed-targets", id },
    chosen.length === 0
      ? null
      : h(
          "ul",
          { class: "ed-chips", "aria-label": name },
          chosen.map((t, at) => {
            const remove = h(
              "button",
              {
                class: "ed-x",
                type: "button",
                "aria-label": `Remove ${t.shown === "" ? t.title : `${t.shown} ${t.title}`}`,
              },
              "×",
            );
            remove.addEventListener("click", () => {
              targets().splice(at, 1);
              touch();
              redraw({ focus: `${id}-search` });
            });
            return h(
              "li",
              { class: "ed-chip", "data-id": t.id },
              t.shown === "" ? null : h("b", null, t.shown),
              h("span", null, t.title),
              remove,
            );
          }),
        ),
    many || chosen.length === 0 ? add.root : null,
  );
}

/** A list of entries, each with buttons to move and remove it, and a button to add one. */
function listField<T>(
  id: string,
  name: string,
  items: T[],
  make: () => T,
  entry: (item: T, at: number, entryId: string) => HTMLElement,
  badge?: (item: T) => string | undefined,
): HTMLElement {
  const move = (from: number, to: number): void => {
    const [item] = items.splice(from, 1);
    if (item !== undefined) {
      items.splice(to, 0, item);
    }
    touch();
    redraw({ focus: fieldId(id.slice(2), to) });
  };
  const add = h("button", { class: "btn sm", type: "button" }, `Add to ${name.toLowerCase()}`);
  add.addEventListener("click", () => {
    items.push(make());
    touch();
    redraw({ focus: `${id}-${String(items.length - 1)}` });
  });
  return h(
    "div",
    { class: "ed-list", id },
    h(
      "ol",
      null,
      items.map((item, at) => {
        const entryId = `${id}-${String(at)}`;
        const tool = (text: string, aria: string, run: () => void, disabled = false): HTMLButtonElement => {
          const b = h("button", { class: "btn sm", type: "button", "aria-label": aria, disabled }, text);
          b.addEventListener("click", run);
          return b;
        };
        const key = badge?.(item);
        return h(
          "li",
          { class: "ed-entry" },
          h(
            "span",
            { class: "ed-n" },
            at + 1,
            key === undefined ? null : h("code", { class: "ed-key" }, key),
          ),
          entry(item, at, entryId),
          h(
            "div",
            { class: "ed-entry-tools" },
            tool(
              "↑",
              `Move ${name} ${String(at + 1)} up`,
              () => {
                move(at, at - 1);
              },
              at === 0,
            ),
            tool(
              "↓",
              `Move ${name} ${String(at + 1)} down`,
              () => {
                move(at, at + 1);
              },
              at === items.length - 1,
            ),
            tool("Remove", `Remove ${name} ${String(at + 1)}`, () => {
              items.splice(at, 1);
              touch();
              redraw({ focus: at > 0 ? `${id}-${String(at - 1)}` : `${id}-add` });
            }),
          ),
        );
      }),
    ),
    (() => {
      add.id = `${id}-add`;
      return add;
    })(),
  );
}

/** A single input for a text, number or date. */
function scalarInput(
  kind: Property["kind"],
  id: string,
  value: string,
  set: (text: string) => void,
  describedBy: string | null,
  aria?: string,
): HTMLElement {
  const input =
    kind === "text"
      ? h("textarea", {
          id,
          class: "ed-text",
          rows: 2,
          "aria-describedby": describedBy,
          "aria-label": aria ?? null,
        })
      : h("input", {
          id,
          class: "ed-input",
          type: kind === "number" ? "number" : "date",
          step: kind === "number" ? "any" : null,
          "aria-describedby": describedBy,
          "aria-label": aria ?? null,
        });
  input.value = value;
  input.addEventListener("input", () => {
    set(input.value);
    touch();
  });
  return input;
}

/** What every field of a property needs. */
interface Field {
  readonly d: Draft;
  readonly key: string;
  readonly p: Property | undefined;
  readonly name: string;
  readonly id: string;
  readonly required: boolean;
  readonly help: string | null;
  /** The control under its label and help. */
  readonly wrap: (control: Child, labelFor?: string, more?: Child) => HTMLElement;
  /** Controls under a heading of the group: a list has no one control to label. */
  readonly group: (control: Child, more?: Child) => HTMLElement;
}

const legend = (f: Field): HTMLElement =>
  h("legend", { class: "ed-label" }, f.name, f.required ? h("span", { class: "ed-req" }, "required") : null);

/** A choice: a list of options, or a box per choice when the property takes several. */
function choiceField(f: Field): HTMLElement {
  const { d, key, id } = f;
  const choices = f.p?.choices ?? [];
  if (f.p?.many === true) {
    const chosen = d.values[key] as string[];
    return h(
      "fieldset",
      { class: "ed-field ed-choices", "data-key": key, "aria-describedby": f.help },
      legend(f),
      describe(key),
      choices.map((c) => {
        const box = h("input", {
          type: "checkbox",
          value: c.key,
          checked: chosen.includes(c.key),
          id: `${id}-${c.key}`,
        });
        box.addEventListener("change", () => {
          const now = d.values[key] as string[];
          d.values[key] = box.checked ? [...now, c.key] : now.filter((x) => x !== c.key);
          touch();
        });
        return h("label", { class: "ed-check" }, box, c.name);
      }),
    );
  }
  const select = h(
    "select",
    { id, class: "ed-input", "aria-describedby": f.help },
    h("option", { value: "" }, "None"),
    choices.map((c) => h("option", { value: c.key, selected: c.key === d.values[key] }, c.name)),
  );
  select.addEventListener("change", () => {
    d.values[key] = select.value;
    touch();
  });
  return f.wrap(select);
}

/** The note on acceptance criteria without a criterion key, with the button that gives them keys. */
function keylessNote(d: Draft): HTMLElement {
  const give = h(
    "button",
    { class: "btn sm", type: "button", id: "ed-give-keys", disabled: isDirty(d) || d.busy },
    "Give keys",
  );
  give.addEventListener("click", () => {
    void giveKeys(d);
  });
  return h(
    "div",
    { class: "notice ed-keys" },
    `${String(d.keyless)} ${d.keyless === 1 ? "criterion has" : "criteria have"} no criterion key yet; tests name a criterion by its key. `,
    h("span", { class: "ed-keys-wait", hidden: !isDirty(d) }, "Save or leave your changes first. "),
    give,
  );
}

/** A list of texts: each a Markdown field where the metamodel marks it so; criteria show their keys. */
function textListField(f: Field): HTMLElement {
  const { d, id, name, help } = f;
  const items = d.values[f.key] as Item[];
  const criteria = f.p?.meaning === "acceptance-criteria";
  return f.group(
    listField(
      id,
      name,
      items,
      (): Item => ({ text: "" }),
      (item, at, entryId) => {
        const set = (text: string): void => {
          item.text = text;
        };
        return f.p?.markdown === true
          ? markdownField(d, entryId, `${name} ${String(at + 1)}`, () => item.text, set, help, 3)
          : scalarInput("text", entryId, item.text, set, help, `${name} ${String(at + 1)}`);
      },
      (item) => item.key,
    ),
    criteria && d.mode === "edit" && d.keyless > 0 ? keylessNote(d) : null,
  );
}

/** A list of numbers or dates. */
function scalarListField(f: Field): HTMLElement {
  const items = f.d.values[f.key] as string[];
  return f.group(
    listField(
      f.id,
      f.name,
      items,
      () => "",
      (item, at, entryId) =>
        scalarInput(
          f.p?.kind ?? "text",
          entryId,
          item,
          (text) => {
            items[at] = text;
          },
          f.help,
          `${f.name} ${String(at + 1)}`,
        ),
    ),
  );
}

/** One text, number or date. */
function singleField(f: Field): HTMLElement {
  const { d, key, id } = f;
  const set = (text: string): void => {
    d.values[key] = text;
  };
  if (f.p?.kind === "text" && f.p.markdown === true) {
    return f.wrap(markdownField(d, id, f.name, () => d.values[key] as string, set, f.help, 4));
  }
  // A text that is not Markdown is a text box too: an imported text can hold line breaks, which a line field drops.
  return f.wrap(scalarInput(f.p?.kind ?? "text", id, d.values[key] as string, set, f.help));
}

/** The field of property `key`, by its kind. */
function propertyField(d: Draft, key: string): HTMLElement {
  const p = propDef(store.mm, key);
  const name = sentence(p?.name ?? key);
  const id = fieldId(key);
  const required = requiredOf(d.type).includes(key);
  d.values[key] ??= emptyValue(key);
  const f: Field = {
    d,
    key,
    p,
    name,
    id,
    required,
    help: helpOf(key),
    wrap: (control, labelFor = id, more = null) =>
      h(
        "div",
        { class: "ed-field", "data-key": key },
        label(name, labelFor, required),
        describe(key),
        more,
        control,
      ),
    group: (control, more = null) =>
      h(
        "div",
        { class: "ed-field", "data-key": key, role: "group", "aria-labelledby": `${id}-label` },
        h(
          "span",
          { class: "ed-label", id: `${id}-label` },
          name,
          required ? h("span", { class: "ed-req" }, "required") : null,
        ),
        describe(key),
        more,
        control,
      ),
  };
  if (p?.kind === "relation") {
    const types = allowedTypes(store.mm, p["target-types"]);
    return f.wrap(
      targetsField(id, name, () => d.values[key] as Target[], types, p.many === true, f.help),
      `${id}-search`,
    );
  }
  if (p?.kind === "choice") {
    return choiceField(f);
  }
  if (p?.many === true) {
    return p.kind === "text" ? textListField(f) : scalarListField(f);
  }
  if (p?.meaning === "identifier" && d.mode === "create") {
    return identifierField(d, key, name, required);
  }
  return singleField(f);
}

let idAsked = 0;
/** The pending ask of the identifier preview; a redraw replaces it. */
let idTimer: ReturnType<typeof setTimeout> | undefined;

/** The identifier of a new element: the next one of its type (shown by a dry run), or one typed. */
function identifierField(d: Draft, key: string, name: string, required: boolean): HTMLElement {
  const id = fieldId(key);
  const next = h("input", { type: "radio", name: "ed-idmode", id: `${id}-next`, checked: d.nextId });
  const own = h("input", { type: "radio", name: "ed-idmode", id: `${id}-own`, checked: !d.nextId });
  const preview = h("span", { class: "ed-idnext", "aria-live": "polite" });
  const prefix = h("input", {
    id: `${id}-prefix`,
    class: "ed-input ed-short",
    type: "text",
    placeholder: "As the type's identifiers",
    "aria-label": "Identifier prefix",
  });
  prefix.value = d.prefix;
  const typed = h("input", { id, class: "ed-input ed-short", type: "text", "aria-label": name });
  typed.value = (d.values[key] as string | undefined) ?? "";
  const mode = (nextId: boolean): void => {
    d.nextId = nextId;
    touch();
    redraw();
  };
  next.addEventListener("change", () => {
    mode(true);
  });
  own.addEventListener("change", () => {
    mode(false);
  });
  typed.addEventListener("input", () => {
    d.values[key] = typed.value;
    touch();
  });
  const ask = (): void => {
    clearTimeout(idTimer);
    const mine = ++idAsked;
    preview.textContent = "…";
    void call("element.create", {
      type: d.type,
      title: d.title,
      nextIdentifier: true,
      ...(d.prefix.trim() === "" ? {} : { identifierPrefix: d.prefix.trim() }),
      dryRun: true,
    })
      .then((out) => {
        if (mine === idAsked) {
          preview.textContent = out.element.identifier === undefined ? "" : `Gets ${out.element.identifier}`;
        }
      })
      .catch((error: unknown) => {
        if (mine === idAsked) {
          preview.textContent = explain(error).todo;
        }
      });
  };
  prefix.addEventListener("input", () => {
    d.prefix = prefix.value;
    touch();
    clearTimeout(idTimer);
    idTimer = setTimeout(ask, 300);
  });
  if (d.nextId) {
    ask();
  }
  return h(
    "fieldset",
    { class: "ed-field ed-id", "data-key": key },
    h("legend", { class: "ed-label" }, name, required ? h("span", { class: "ed-req" }, "required") : null),
    describe(key),
    h(
      "div",
      { class: "ed-idrow" },
      h("label", { class: "ed-check" }, next, "Next free"),
      d.nextId ? [h("label", { class: "ed-sub", for: `${id}-prefix` }, "Prefix"), prefix, preview] : null,
    ),
    h("div", { class: "ed-idrow" }, h("label", { class: "ed-check" }, own, "Own"), d.nextId ? null : typed),
  );
}

/** Gives the acceptance criteria without a key their keys; the form is then opened again on the new file. */
async function giveKeys(d: Draft): Promise<void> {
  if (d.id === undefined || isDirty(d)) {
    return;
  }
  d.busy = true;
  redraw();
  try {
    const out = await call("element.assignCriterionKeys", { selection: { ids: [d.id] } });
    if (draft === d) {
      draft = undefined;
      announce(out.answer);
      await rerender();
      reread();
    }
  } catch (error) {
    d.busy = false;
    d.note = failed(error);
    redraw();
  }
}

/** The relations of the element, one field per kind the form offers. */
function relationFields(d: Draft): Child {
  const kinds = offered(d.kinds);
  if (kinds.length === 0) {
    return null;
  }
  return h(
    "fieldset",
    { class: "ed-group" },
    h("legend", null, "Relations"),
    kinds.map((k) => {
      const id = `r-${k.kind}`;
      d.relations[k.kind] ??= [];
      return h(
        "div",
        { class: "ed-field", "data-kind": k.kind },
        h("label", { class: "ed-label", for: `${id}-search` }, k.name),
        targetsField(id, k.name, () => d.relations[k.kind] ?? [], k.targetTypes, true, null),
      );
    }),
  );
}

/** The type of a new element; changing it keeps what was typed in the fields both types have. */
function typeField(d: Draft): HTMLElement {
  const select = h(
    "select",
    { id: "f-type", class: "ed-input" },
    creatable(store.mm).map((key) =>
      h("option", { value: key, selected: key === d.type }, typeName(store.mm, key)),
    ),
  );
  select.addEventListener("change", () => {
    d.type = select.value;
    d.kinds = kindsForType(store.mm, d.type);
    d.nextId = propOfType(store.mm, d.type, "identifier") !== undefined;
    touch();
    redraw({ focus: "f-type" });
  });
  return h("div", { class: "ed-field" }, label("Type", "f-type", true), select);
}

/** The note that the file changed on disk after the form was opened, with the way to load it. */
function elsewhereNote(d: Draft): HTMLElement {
  const reload = h("button", { class: "btn sm", type: "button" }, "Load the saved version");
  reload.addEventListener("click", () => {
    void (async () => {
      if (!isDirty(d) || (await askLeave())) {
        draft = undefined;
        await rerender();
      }
    })();
  });
  return h(
    "div",
    { class: "notice bad ed-elsewhere", role: "alert" },
    h("strong", null, "This element was changed outside this form."),
    " ReqSeq refuses to save over that change. Copy what you typed, then load the saved version. ",
    reload,
  );
}

/** Where an imported element came from, read only. */
const originList = (d: Draft): Child =>
  d.origin.length === 0
    ? null
    : h(
        "div",
        { class: "ed-field" },
        h("span", { class: "ed-label" }, "Imported from"),
        h("p", { class: "ed-help" }, "Only an import changes these."),
        h(
          "dl",
          { class: "ed-origin" },
          d.origin.map((x) => h("div", null, h("dt", null, x.name), h("dd", null, x.value))),
        ),
      );

function form(d: Draft): HTMLElement {
  const title = h("input", { id: "f-title", class: "ed-input ed-title", type: "text", autocomplete: "off" });
  title.value = d.title;
  title.addEventListener("input", () => {
    d.title = title.value;
    touch();
  });
  const titleKey = propKey(store.mm, "title");
  const saveButton = h(
    "button",
    {
      class: "btn ed-primary",
      id: "ed-save",
      type: "submit",
      "data-save": true,
      disabled: d.busy || (d.mode === "edit" && !isDirty(d)),
    },
    d.mode === "create" ? "Create" : "Save",
  );
  const checkButton = h(
    "button",
    { class: "btn", type: "button", id: "ed-check", disabled: d.busy },
    "Check",
  );
  checkButton.addEventListener("click", () => {
    void check(d);
  });
  const el = h(
    "form",
    { class: "form ed-form", novalidate: true, "aria-labelledby": "ed-h" },
    h(
      "div",
      { class: "ed-head" },
      h(
        "h1",
        { id: "ed-h" },
        d.mode === "create" ? "New element" : `Edit ${d.title === "" ? "element" : d.title}`,
      ),
      d.mode === "edit"
        ? h(
            "p",
            { class: "ed-kick" },
            typeName(store.mm, d.type),
            statusPill(d.status),
            h("span", { class: "ed-help" }, "The status is not changed here."),
          )
        : null,
    ),
    d.elsewhere ? elsewhereNote(d) : null,
    d.mode === "create" ? typeField(d) : null,
    h(
      "div",
      { class: "ed-field" },
      label(
        titleKey === undefined ? "Title" : sentence(propDef(store.mm, titleKey)?.name ?? "Title"),
        "f-title",
        titleKey !== undefined && requiredOf(d.type).includes(titleKey),
      ),
      title,
    ),
    h(
      "div",
      { class: "ed-field" },
      label("Text", "f-text", false),
      markdownField(
        d,
        "f-text",
        "Text",
        () => d.text,
        (text) => {
          d.text = text;
        },
        null,
        8,
      ),
    ),
    fieldsOf(d.type).map((key) => propertyField(d, key)),
    originList(d),
    relationFields(d),
    h(
      "div",
      { class: "ed-bar" },
      d.note === undefined
        ? null
        : h(
            "div",
            { class: `notice ed-note${d.note.kind === "bad" ? " bad" : ""}`, role: "status" },
            d.note.body(),
          ),
      h(
        "div",
        { class: "ed-actions" },
        saveButton,
        checkButton,
        h("a", { class: "btn", href: `#${d.back}` }, "Cancel"),
        h("span", { class: "ed-dirty", hidden: !isDirty(d) }, "Unsaved changes"),
      ),
    ),
  );
  el.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!d.busy) {
      void save(d);
    }
  });
  return el;
}

/** Where focus and caret are in the form, to put them back after a redraw. */
function focusOf(focus: string | undefined): { id?: string; start: number | null; end: number | null } {
  const active = document.activeElement;
  if (focus !== undefined) {
    return { id: focus, start: null, end: null };
  }
  if (!(active instanceof HTMLElement) || host?.contains(active) !== true || active.id === "") {
    return { start: null, end: null };
  }
  const typed = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  return typed
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
    : { id: active.id, start: null, end: null };
}

/** Draws the form of the draft again, keeping focus, caret and scroll. */
function redraw({ focus }: { focus?: string } = {}): void {
  const d = draft;
  if (d === undefined || host === undefined) {
    return;
  }
  const kept = focusOf(focus);
  const scroll = window.scrollY;
  host.replaceChildren(form(d));
  window.scrollTo({ top: scroll });
  if (kept.id === undefined) {
    return;
  }
  const next = host.querySelector<HTMLElement>(`#${CSS.escape(kept.id)}`);
  next?.focus({ preventScroll: true });
  const typed =
    next instanceof HTMLTextAreaElement || (next instanceof HTMLInputElement && next.type === "text");
  if (typed && kept.start !== null && kept.end !== null) {
    next.setSelectionRange(kept.start, kept.end);
  }
}

let rerender: () => Promise<void> = () => Promise.resolve();

/**
 * The draft of the edit form at `route`: the one kept, while it has typed text or the file is unchanged, else one
 * of the element as it is now; undefined when the element cannot be read (the page then says why).
 */
async function editDraftOf(
  root: HTMLElement,
  route: Route,
  kept: Draft | undefined,
): Promise<Draft | undefined> {
  let got: ElementGetOutput;
  let kinds: readonly Kind[];
  try {
    got = await call("element.get", { ref: route.parts[1] ?? "" });
    kinds = (await call("relation.options", { ref: got.element.id })).kinds;
  } catch (error) {
    if (isCurrent(route)) {
      root.replaceChildren(page(route, null, h("div", { class: "form" }, errorBox(error))));
      host = undefined;
      document.title = "Edit · ReqSeq";
    }
    return undefined;
  }
  if (kept === undefined || (!isDirty(kept) && kept.sha !== got.fileSha256)) {
    return editDraft(route, got, kinds);
  }
  kept.elsewhere ||= kept.sha !== got.fileSha256;
  return kept;
}

async function render(root: HTMLElement, route: Route): Promise<void> {
  const kept = draft?.route === route.hash ? draft : undefined;
  const d =
    route.parts[0] === "new"
      ? kept !== undefined && creatable(store.mm).includes(kept.type)
        ? kept
        : newDraft(route)
      : await editDraftOf(root, route, kept);
  if (d === undefined || !isCurrent(route)) {
    return;
  }
  draft = d;
  rerender = async () => {
    await render(root, route);
  };
  // A redraw of the same form keeps the frame, so focus and caret stay; another route draws it new.
  if (host !== undefined && root.contains(host) && host.dataset["route"] === route.hash) {
    redraw();
  } else {
    host = h("div", { class: "ed-host", "data-route": route.hash });
    root.replaceChildren(page(route, d, host));
    host.replaceChildren(form(d));
  }
  document.title = `${d.mode === "create" ? "New element" : `Edit ${d.title}`} · ReqSeq`;
}

/** The page around the form: the way back in the top bar. */
function page(route: Route, d: Draft | undefined | null, body: HTMLElement): HTMLElement {
  const back = d?.back ?? backOf(route, HOME);
  return h(
    "div",
    { class: "page-bg" },
    h(
      "header",
      { class: "topbar" },
      h("a", { class: "back", href: `#${back}` }, icon.back(), h("span", null, "Back")),
      h("span", { class: "crumb" }, route.parts[0] === "new" ? "New element" : "Edit"),
    ),
    h("main", { id: "main", class: "form-wrap", tabindex: -1 }, body),
  );
}

addRoute("new", render);
addRoute("edit", render);

addRailSection({
  order: 90,
  title: "Write",
  links: () => [{ href: hashOf("new"), key: "new", name: "New element" }],
});
