// The evidence of an element (`#/evidence/<ref>`): what was checked, per acceptance criterion, test case and
// view, as `evidence.list` lays it out (`display`), the older runs below, and a form to record a check that is
// not an automated test (`evidence.record`). Requirements have verification records, needs validation records.
import "../css/evidence.css";
import type {
  DataExportEvidenceRecord,
  ElementGetOutput,
  EvidenceListOutput,
  EvidenceRecordInput,
} from "@reqseq/core";
import { call } from "../api.js";
import type { Child } from "../dom.js";
import { announce, h } from "../dom.js";
import { addElementTab, elementPage } from "../element-tabs.js";
import { errorBox } from "../layout.js";
import { statusPill, verificationMark } from "../marks.js";
import { cap, isNeed, isReq, propOfType, typeName } from "../meaning.js";
import type { Route } from "../router.js";
import { addRoute, isCurrent } from "../router.js";
import { el, hasVariants, shownId, store, variantName } from "../store.js";

const ROUTE = "evidence";

type Display = NonNullable<EvidenceListOutput["display"]>;
type Row = Display["rows"][number];
type Case = Row["cases"][number];
type Kind = EvidenceRecordInput["kind"];

/** The statuses of a row of the evidence section in words: verification ones as everywhere, validation ones here. */
const ROW_WORDS: Readonly<Record<string, string>> = {
  verified: "Verified",
  open: "No evidence yet",
  outdated: "Evidence outdated",
  failed: "Failed",
  validated: "Validated",
  inconclusive: "Inconclusive",
};
/** The colour of a status mark (`marks.ts` knows the verification statuses). */
const MARK_CLASS: Readonly<Record<string, string>> = { validated: "verified", inconclusive: "outdated" };

const mark = (status: string, text?: string): HTMLElement =>
  h("span", { class: `st ${MARK_CLASS[status] ?? status}` }, text ?? ROW_WORDS[status] ?? status);

const RESULT_WORDS: Readonly<Record<string, string>> = {
  passed: "Passed",
  failed: "Failed",
  inconclusive: "Inconclusive",
};
const resultMark = (result: string): HTMLElement =>
  h("span", { class: `res ${result}` }, RESULT_WORDS[result] ?? result);

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
/** A date of a record as people read it; the value as written where it is no date. */
export const dateText = (value: string | undefined): string => {
  if (value === undefined) {
    return "";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DATE.format(date);
};

const viewWord = (view: string): string => (view === "core" ? "Core" : variantName(view));

/** The records of `positions`, one table row each. */
function recordTable(
  records: readonly DataExportEvidenceRecord[],
  positions: readonly number[],
): HTMLElement {
  const shown = positions.flatMap((at) => (records[at] === undefined ? [] : [records[at]]));
  const views = hasVariants() && shown.some((r) => r.variant !== undefined);
  return h(
    "table",
    { class: "recs" },
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        h("th", { scope: "col" }, "Date"),
        h("th", { scope: "col" }, "Result"),
        h("th", { scope: "col" }, "Method"),
        h("th", { scope: "col" }, "Item"),
        views ? h("th", { scope: "col" }, "View") : null,
        h("th", { scope: "col" }, "Version"),
        h("th", { scope: "col" }, "Evidence"),
      ),
    ),
    h(
      "tbody",
      null,
      shown.map((r) =>
        h(
          "tr",
          null,
          h("td", null, dateText(r.date)),
          h(
            "td",
            null,
            resultMark(r.result),
            r.reason === undefined ? null : h("span", { class: "why" }, r.reason),
          ),
          h("td", null, r.kind === "validation" ? "Validation" : cap(r.method ?? "")),
          h("td", null, r.item ?? ""),
          views ? h("td", null, viewWord(r.variant ?? "core")) : null,
          h("td", { class: "num" }, r.version),
          h(
            "td",
            { class: "src" },
            r.evidenceSource ?? "",
            (r.baselines ?? []).length === 0
              ? null
              : h("span", { class: "bl" }, `In ${(r.baselines ?? []).join(", ")}`),
          ),
        ),
      ),
    ),
  );
}

/** One test case of a row: its name, its result and views, and its records. */
const caseLine = (c: Case, records: readonly DataExportEvidenceRecord[]): HTMLElement =>
  h(
    "details",
    { class: "case" },
    h(
      "summary",
      null,
      h("span", { class: "cn" }, c.testCase ?? "Record without test case"),
      c.className === undefined ? null : h("span", { class: "cc" }, c.className),
      resultMark(c.result),
      hasVariants() ? h("span", { class: "cv" }, c.views.map(viewWord).join(", ")) : null,
      h("span", { class: "cr" }, c.records.length === 1 ? "1 record" : `${String(c.records.length)} records`),
    ),
    recordTable(records, c.records),
  );

/** A row of the section: an acceptance criterion (or the requirement, or its validation) with its test cases. */
function rowBlock(row: Row, records: readonly DataExportEvidenceRecord[]): HTMLElement {
  const name =
    row.kind === "validation"
      ? "Validation"
      : row.criterion === undefined
        ? "Verification"
        : `Criterion ${String(row.criterion)}`;
  const views = (row.views ?? []).filter(() => hasVariants());
  const tests = row.cases.length === 1 ? "1 test case" : `${String(row.cases.length)} test cases`;
  return h(
    "section",
    { class: `erow ${row.status}`, "data-criterion": row.criterion ?? "" },
    h("div", { class: "eh" }, h("h3", null, name), mark(row.status), h("span", { class: "cr" }, tests)),
    row.text === undefined ? null : h("p", { class: "et" }, row.text),
    views.length > 1
      ? h(
          "ul",
          { class: "eviews", "aria-label": "By view" },
          views.map((v) => h("li", null, h("span", null, viewWord(v.view)), mark(v.status))),
        )
      : null,
    row.cases.length === 0
      ? h("p", { class: "none" }, "No test case or record covers it yet.")
      : row.cases.map((c) => caseLine(c, records)),
  );
}

/** What every shown record has in common, once. */
const sharedLine = (shared: Display["shared"]): HTMLElement | null => {
  const parts = [
    shared.date === undefined ? null : `Checked ${dateText(shared.date)}`,
    shared.item === undefined ? null : `item ${shared.item}`,
    shared.version === undefined ? null : `version ${shared.version}`,
    shared.baselines === undefined || shared.baselines.length === 0
      ? null
      : `in ${shared.baselines.join(", ")}`,
  ].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : h("p", { class: "shared" }, `${parts.join(" · ")}.`);
};

/** The evidence section: the rows, then the older runs. */
function evidenceSection(list: EvidenceListOutput): Child {
  const display = list.display;
  if (list.records.length === 0) {
    return h(
      "div",
      { class: "empty" },
      h("strong", null, "No evidence yet."),
      h("p", null, "Test results that name this element, and checks recorded here, show up here."),
    );
  }
  return [
    sharedLine(display.shared),
    display.rows.map((row) => rowBlock(row, list.records)),
    display.older.length === 0
      ? null
      : h(
          "section",
          { class: "older" },
          h("h2", { class: "sect" }, "Older runs"),
          display.older.map((run) =>
            h(
              "details",
              { class: "case" },
              h(
                "summary",
                null,
                h("span", { class: "cn" }, dateText(run.date)),
                h("span", { class: "cc" }, `version ${run.version}`),
                h(
                  "span",
                  { class: "cr" },
                  run.records.length === 1 ? "1 record" : `${String(run.records.length)} records`,
                ),
              ),
              recordTable(list.records, run.records),
            ),
          ),
        ),
  ];
}

/** What the person typed into the form, kept across a redraw of the page (another change of the workspace). */
let draft: { readonly id: string; readonly values: Readonly<Record<string, string>> } | undefined;
/** What the last record wrote, shown once on the page of its element. */
let recorded: { readonly id: string; readonly text: string } | undefined;

const field = (label: string, control: HTMLElement, hint?: string, cls = ""): HTMLElement =>
  h(
    "label",
    { class: `fld${cls === "" ? "" : ` ${cls}`}` },
    h("span", { class: "fl" }, label),
    control,
    hint === undefined ? null : h("span", { class: "fh" }, hint),
  );

const select = (name: string, options: readonly (readonly [string, string])[]): HTMLSelectElement =>
  h(
    "select",
    { name },
    options.map(([value, text]) => h("option", { value }, text)),
  );

/** The criteria of the element's current version, for the form: number and text. */
const criteriaOf = (got: ElementGetOutput): { readonly n: number; readonly text: string }[] => {
  const key = propOfType(store.mm, got.element.type, "acceptance-criteria");
  const value = key === undefined ? undefined : got.element.properties[key];
  return (Array.isArray(value) ? (value as unknown[]) : []).map((item, at) => ({
    n: at + 1,
    text:
      typeof item === "string"
        ? item
        : typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : "",
  }));
};

/** The text of the field `name`, or undefined when it is empty. */
const textOf = (data: FormData, name: string): string | undefined => {
  const value = data.get(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
};

/** The optional text fields of the form, each left out when empty, so ReqSeq takes its default. */
const OPTIONAL = ["item", "evidence", "testCase", "folder"] as const;

/** The input of `evidence.record` from the form; empty fields are left out, so ReqSeq takes its defaults. */
function inputOf(form: HTMLFormElement, id: string): EvidenceRecordInput {
  const data = new FormData(form);
  const kind = (textOf(data, "kind") ?? "verification") as Kind;
  const result = (textOf(data, "result") ?? "passed") as EvidenceRecordInput["result"];
  const date = textOf(data, "date");
  const reason = result === "inconclusive" ? textOf(data, "reason") : undefined;
  const optional = Object.fromEntries(
    OPTIONAL.flatMap((name) => {
      const value = textOf(data, name);
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const base: EvidenceRecordInput = {
    ref: id,
    kind,
    result,
    ...optional,
    ...(reason === undefined ? {} : { reason }),
    ...(date === undefined ? {} : { date: new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z") }),
  };
  return kind === "verification" ? { ...base, ...verificationOf(data) } : base;
}

/** The fields only a verification record has: method, variant and criteria. */
function verificationOf(data: FormData): Pick<EvidenceRecordInput, "method" | "variant" | "criteria"> {
  const variant = textOf(data, "variant");
  const criteria = data.getAll("criteria").map((v) => Number(v));
  return {
    method: (textOf(data, "method") ?? "test") as NonNullable<EvidenceRecordInput["method"]>,
    ...(variant === undefined || variant === "core" ? {} : { variant }),
    ...(criteria.length > 0 ? { criteria } : {}),
  };
}

/** Shows the fields the kind and result of the form ask for, and gives what the form holds by field name. */
function syncForm(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const verification = (data.get("kind") ?? "verification") === "verification";
  const inconclusive = data.get("result") === "inconclusive";
  form.querySelectorAll<HTMLElement>(".v-only").forEach((x) => {
    x.hidden = !verification;
  });
  form.querySelectorAll<HTMLElement>(".r-only").forEach((x) => {
    x.hidden = !inconclusive;
  });
  const values: Record<string, string> = {};
  for (const [name, value] of data) {
    if (typeof value === "string") {
      values[name] = name in values ? `${values[name] ?? ""}\n${value}` : value;
    }
  }
  return values;
}

/** Puts `values` (as `syncForm` gives them) back into the form. */
function restore(form: HTMLFormElement, values: Readonly<Record<string, string>>): void {
  for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "[name]",
  )) {
    const value = values[control.name];
    if (control instanceof HTMLInputElement && (control.type === "radio" || control.type === "checkbox")) {
      if (value !== undefined || control.type === "checkbox") {
        control.checked = (value ?? "").split("\n").includes(control.value);
      }
    } else if (value !== undefined && control.type !== "hidden") {
      control.value = value;
    }
  }
}

/** The form to record a check that is not an automated test. */
function recordForm(got: ElementGetOutput, rerender: () => void): HTMLElement {
  const e = got.element;
  const kinds: (readonly [Kind, string])[] = [
    ...(isReq(store.mm, e.type)
      ? [["verification", "Verification: does it meet the requirement?"] as const]
      : []),
    ["validation", "Validation: is it what is needed?"],
  ];
  const criteria = criteriaOf(got);
  const status = h("div", { class: "rec-status", role: "status" });
  const form = h(
    "form",
    { class: "rec", "aria-labelledby": "rec-h", novalidate: true },
    h("h2", { class: "sect", id: "rec-h" }, "Record a check"),
    h(
      "p",
      { class: "fh" },
      "For a check that is not an automated test: an inspection, an analysis, a demonstration or a review with the people who need it. ReqSeq writes a record file with the element's current version.",
    ),
    kinds.length > 1
      ? h(
          "fieldset",
          { class: "kinds" },
          h("legend", null, "What was checked"),
          kinds.map(([value, text], at) =>
            h(
              "label",
              { class: "radio" },
              h("input", { type: "radio", name: "kind", value, checked: at === 0 }),
              text,
            ),
          ),
        )
      : h("input", { type: "hidden", name: "kind", value: kinds[0]?.[0] ?? "validation" }),
    h(
      "div",
      { class: "grid" },
      field(
        "Result",
        select("result", [
          ["passed", "Passed"],
          ["failed", "Failed"],
          ["inconclusive", "Inconclusive"],
        ]),
      ),
      field(
        "Method",
        select("method", [
          ["inspection", "Inspection"],
          ["analysis", "Analysis"],
          ["demonstration", "Demonstration"],
          ["test", "Test"],
        ]),
        undefined,
        "v-only",
      ),
      field(
        "Item under test",
        h("input", { name: "item", type: "text", autocomplete: "off" }),
        "The build, sample or document that was checked.",
        "v-only",
      ),
      hasVariants() && store.variants.length > 0
        ? field(
            "Holds for",
            select("variant", [
              ["core", "Core"],
              ...store.variants.map((v) => [v.id, v.title ?? v.shortId] as const),
            ]),
            undefined,
            "v-only",
          )
        : null,
      field("Date of the check", h("input", { name: "date", type: "datetime-local" }), "Empty: now."),
      field(
        "Test case",
        h("input", { name: "testCase", type: "text", autocomplete: "off" }),
        "Optional: a name or ID of the check.",
      ),
      field(
        "Evidence document",
        h("input", { name: "evidence", type: "text", autocomplete: "off" }),
        "Optional: a path or address of the protocol. ReqSeq writes it as given and never opens it.",
        "wide",
      ),
      field(
        "Reason",
        h("textarea", { name: "reason", rows: 2 }),
        "Why the validation was inconclusive.",
        "wide r-only",
      ),
      field(
        "Folder",
        h("input", { name: "folder", type: "text", autocomplete: "off" }),
        "Optional: an evidence folder of the workspace or one below it. Empty: the first evidence folder.",
        "wide",
      ),
    ),
    criteria.length === 0
      ? null
      : h(
          "fieldset",
          { class: "crits v-only" },
          h("legend", null, "Criteria it covers"),
          h("p", { class: "fh" }, "None chosen: every criterion."),
          criteria.map((c) =>
            h(
              "label",
              { class: "check" },
              h("input", { type: "checkbox", name: "criteria", value: c.n }),
              h("b", null, String(c.n)),
              h("span", null, c.text),
            ),
          ),
        ),
    status,
    h("div", { class: "actions" }, h("button", { class: "btn primary", type: "submit" }, "Record the check")),
  );
  const sync = (): void => {
    draft = { id: e.id, values: syncForm(form) };
  };
  // A redraw keeps what the person typed.
  if (draft?.id === e.id) {
    restore(form, draft.values);
  }
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button?.setAttribute("disabled", "");
    status.replaceChildren();
    void call("evidence.record", inputOf(form, e.id))
      .then((out) => {
        draft = undefined;
        recorded = {
          id: e.id,
          text: `Recorded. ReqSeq wrote ${out.files.join(", ")}.`,
        };
        announce(recorded.text);
        rerender();
      })
      .catch((error: unknown) => {
        status.replaceChildren(errorBox(error));
        button?.removeAttribute("disabled");
      });
  });
  sync();
  return form;
}

/** The head of the page: ID, type, status and the verification in the chosen view, then the title. */
function head(got: ElementGetOutput): HTMLElement {
  const e = got.element;
  const entry = e.verification?.find((v) => v.view === store.view);
  return h(
    "div",
    { class: "sub-head" },
    h(
      "div",
      { class: "kick" },
      shownId(e) === "" ? null : h("b", null, shownId(e)),
      h("span", null, typeName(store.mm, e.type)),
      statusPill(e.status),
      entry === undefined
        ? null
        : verificationMark(
            entry.status,
            entry.criteria === undefined
              ? undefined
              : `${ROW_WORDS[entry.status] ?? entry.status}, ${String(entry.criteria.verified)} of ${String(entry.criteria.total)} criteria verified`,
          ),
      hasVariants() && store.view !== "core" ? h("span", null, `in ${variantName(store.view)}`) : null,
    ),
    h("h1", null, "Evidence: ", e.title),
  );
}

async function render(root: HTMLElement, route: Route): Promise<void> {
  const ref = route.parts[1] ?? "";
  let got: ElementGetOutput;
  let list: EvidenceListOutput;
  try {
    [got, list] = await Promise.all([call("element.get", { ref }), call("evidence.list", { ref })]);
  } catch (error) {
    if (isCurrent(route)) {
      root.replaceChildren(
        elementPage(el(ref), ROUTE, route, h("h1", { class: "sr" }, "Evidence"), errorBox(error)),
      );
    }
    return;
  }
  if (!isCurrent(route)) {
    return;
  }
  const e = got.element;
  const note = recorded?.id === e.id ? recorded.text : undefined;
  recorded = undefined;
  const rerender = (): void => {
    if (isCurrent(route)) {
      void render(root, route);
    }
  };
  root.replaceChildren(
    elementPage(
      e,
      ROUTE,
      route,
      head(got),
      note === undefined ? null : h("div", { class: "notice ok", role: "status" }, note),
      evidenceSection(list),
      list.problems.map((p) => h("p", { class: "note" }, p.message)),
      list.incomplete
        ? h(
            "p",
            { class: "note" },
            "Some evidence folders or baselines lie in a repository that is not on this machine; their records are not shown.",
          )
        : null,
      recordForm(got, rerender),
    ),
  );
  document.title = `Evidence · ${shownId(e) === "" ? "" : `${shownId(e)} `}${e.title} · ReqSeq`;
}

addRoute(ROUTE, render);
addElementTab({
  route: ROUTE,
  name: "Evidence",
  order: 10,
  applies: (type) => isReq(store.mm, type) || isNeed(store.mm, type),
});
