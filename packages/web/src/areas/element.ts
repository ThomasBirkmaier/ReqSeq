// The element page (`#/e/<identifier or short ID>`): the element in its trace, its problems, the verification status
// of each acceptance criterion, and the decisions on its status.
// What it points to on the left, the element in the centre, what points to it on the right. The way back to the
// list it was opened from stays in the top bar (`?from=<route>`).
import "../css/element.css";
import type {
  DataExportElement,
  DataExportRelation,
  ElementGetOutput,
  TraceNeighbourhoodOutput,
} from "@reqseq/core";
import type { ProblemGroupDisplay } from "@reqseq/core/displays";
import {
  boundNote,
  criterionStatuses,
  elementPageDisplay,
  elementProblemGroups,
  relationGroupLabel,
} from "@reqseq/core/displays";
import { call } from "../api.js";
import type { Child } from "../dom.js";
import { h, icon, s } from "../dom.js";
import { errorBox } from "../layout.js";
import { statusPill, verificationMark, verificationWord } from "../marks.js";
import type { Metamodel } from "../meaning.js";
import {
  cap,
  choiceName,
  isInvalid,
  isNeed,
  isReq,
  kindProps,
  listProps,
  needWords,
  noteProps,
  propDef,
  propKey,
  propOfType,
  relKind,
  sentence,
  statusName,
  typeName,
} from "../meaning.js";
import { markdown } from "../markdown.js";
import { swap } from "../motion.js";
import type { Route } from "../router.js";
import { addRoute, fromOf, hashOf, isCurrent, withFrom } from "../router.js";
import { el, refOf, shownId, store, verificationOf, viewSelection } from "../store.js";
import { backOf, elementTabs } from "../element-tabs.js";
import { decisions, flashBox } from "./changes.js";

type Neighbourhood = Pick<TraceNeighbourhoodOutput, "nodes" | "edges" | "total">;

/** The most elements the right column reads of what points to the element; more are named as left out. */
const INCOMING = 500;

/**
 * What points to the element, one step down, in the chosen view: every relation kind, every relation property but
 * the packages (a package page has its own list) and the inline references, filtered by the server.
 */
const incomingOf = (id: string): Promise<Neighbourhood> => {
  const packages = propKey(store.mm, "packages");
  const kinds = [
    ...store.mm.relations.map((k) => k.key),
    ...store.mm.properties.filter((p) => p.kind === "relation" && p.key !== packages).map((p) => p.key),
  ];
  return call("trace.neighbourhood", {
    ref: id,
    direction: "down",
    maxDepth: 1,
    kinds,
    meanings: ["reference"],
    limit: INCOMING + 1,
    offset: 0,
    ...viewSelection(),
  });
};

/** The kind label of an element: its type, then the values of the choices its type requires. */
const kindLabel = (mm: Metamodel, e: DataExportElement): string =>
  [
    typeName(mm, e.type),
    ...kindProps(mm, e.type)
      .filter((key) => e.properties[key] !== undefined && e.properties[key] !== "")
      .map((key) => choiceName(mm, key, e.properties[key])),
  ].join(" · ");

/** A text as plain paragraphs: every string goes in as text. */
const paragraphs = (text: string | undefined): HTMLElement[] =>
  (text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => h("p", null, p));

const itemText = (item: unknown): string =>
  typeof item === "string"
    ? item
    : typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string"
      ? (item as { text: string }).text
      : "";

/** The value of a property as people read it. */
function valueText(mm: Metamodel, key: string, value: unknown): string {
  const d = propDef(mm, key);
  const values: readonly unknown[] = Array.isArray(value) ? value : [value];
  return values
    .map((v) => {
      if (d?.kind === "choice") {
        return choiceName(mm, key, v);
      }
      if (d?.kind === "relation" && typeof v === "object" && v !== null) {
        const target = v as { id?: unknown; title?: unknown };
        const id = typeof target.id === "string" ? target.id : "";
        return el(id)?.title ?? (typeof target.title === "string" ? target.title : id);
      }
      return typeof v === "object" && v !== null ? itemText(v) : String(v);
    })
    .join(", ");
}

/** The properties the card does not show elsewhere, named and valued as the metamodel defines them. */
function propEntries(mm: Metamodel, e: DataExportElement): { name: string; value: string }[] {
  const elsewhere = new Set([
    ...kindProps(mm, e.type),
    ...noteProps(mm, e.type),
    ...listProps(mm, e.type),
    propKey(mm, "verification-method"),
  ]);
  const shownMeanings = new Set(["title", "identifier", "acceptance-criteria", "packages", "statement"]);
  return (mm.types.find((t) => t.key === e.type)?.properties ?? [])
    .filter((key) => !elsewhere.has(key))
    .flatMap((key) => {
      const d = propDef(mm, key);
      const value = e.properties[key];
      if (d === undefined || (d.meaning !== undefined && shownMeanings.has(d.meaning))) {
        return [];
      }
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
        return [];
      }
      return [
        {
          name: d.meaning === "validity" ? "Applies to" : sentence(d.name),
          value: valueText(mm, key, value),
        },
      ];
    });
}

/** Where a relation leads, and how its target is named. */
const targetOf = (relation: DataExportRelation): { href: string; shown: string; title: string } => {
  const target = el(relation.id);
  const ref = target === undefined ? (relation.identifier ?? relation.shortId ?? relation.id) : refOf(target);
  return {
    href: hashOf("e", ref),
    shown: target?.identifier ?? relation.identifier ?? "",
    title: target?.title ?? relation.title ?? relation.id,
  };
};

/** A link to another element that leads back here. */
const via = (href: string, from: DataExportElement): string => withFrom(href, "e", refOf(from));

const nodeOut = (relation: DataExportRelation, from: DataExportElement): HTMLElement => {
  const target = el(relation.id);
  const { href, shown, title } = targetOf(relation);
  const invalid = isInvalid(store.mm, target?.status);
  const outdated = relation.outdated === true;
  return h(
    "a",
    {
      class: `node${outdated ? " warn" : ""}${invalid ? " obs" : ""}`,
      href: via(href, from),
      "data-link": relation.id,
      "data-id": relation.id,
      "data-warn": outdated,
    },
    h(
      "span",
      { class: "nk" },
      `${shown} ${typeName(store.mm, target?.type)}`.trim(),
      invalid ? h("span", { class: "tt-obs" }, statusName(store.mm, target?.status)) : null,
      outdated ? h("span", { class: "why" }, "changed since linked") : null,
    ),
    title,
  );
};

/** The left column: the outgoing relations by kind, as the display model of the element page groups them. */
function leftColumn(got: ElementGetOutput): HTMLElement {
  const { element } = got;
  const groups = elementPageDisplay(
    { element, metamodel: store.mm },
    { relations: "outgoing" },
  ).relationGroups;
  const traced = isReq(store.mm, element.type) || isNeed(store.mm, element.type);
  return h(
    "div",
    { class: "col-left" },
    groups.length > 0
      ? groups.map((g) => [
          h("h2", { class: "col-h" }, g.label),
          h(
            "div",
            { class: "nodes" },
            g.relations.map((r) => nodeOut(r, element)),
          ),
        ])
      : traced
        ? [
            h("h2", { class: "col-h" }, "Traces to"),
            h(
              "p",
              { class: "none" },
              isReq(store.mm, element.type)
                ? "Nothing yet."
                : `Nothing. ${cap(needWords(store.mm))} are where the trace starts.`,
            ),
          ]
        : null,
  );
}

/** The right column: what points to the element, derivations first, one group per kind. */
function rightColumn(element: DataExportElement, nb: Neighbourhood | undefined): HTMLElement | null {
  const nodes = new Map((nb?.nodes ?? []).map((n) => [n.id, n]));
  const packages = propKey(store.mm, "packages");
  const incoming = (nb?.edges ?? []).filter(
    (x) =>
      x.target === element.id && x.source !== element.id && !(x.property === true && x.kind === packages),
  );
  const groups = new Map<string, { label: string; derivation: boolean; ids: string[] }>();
  for (const x of incoming) {
    const key = `${x.link}:${x.kind ?? ""}`;
    const group = groups.get(key) ?? {
      label: relationGroupLabel(
        { kind: x.link === "reference" ? undefined : x.kind, property: x.property === true, direction: "in" },
        store.mm,
      ),
      derivation: relKind(store.mm, x.kind ?? "")?.meaning === "derivation",
      ids: [],
    };
    if (!group.ids.includes(x.source)) {
      group.ids.push(x.source);
    }
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => Number(b.derivation) - Number(a.derivation));
  if (ordered.length === 0) {
    return null;
  }
  // The answer names the element itself as its first node; `total` counts every element the walk reached.
  const cut = nb !== undefined && nb.total > nb.nodes.length;
  return h(
    "div",
    { class: "col-right" },
    cut ? h("p", { class: "none cut" }, boundNote(nb.nodes.length - 1)) : null,
    ordered.map((g) => [
      h("h2", { class: "col-h" }, g.label, " ", h("b", null, g.ids.length)),
      h(
        "div",
        { class: "nodes" },
        g.ids.map((id) => {
          const n = nodes.get(id) ?? el(id);
          const label = n === undefined ? id : refOf(n);
          return h(
            "a",
            {
              class: "node",
              href: via(hashOf("e", label), element),
              "data-link": id,
              "data-id": id,
              "data-right": true,
            },
            h(
              "span",
              { class: "nk" },
              `${shownId(n)} ${typeName(store.mm, n?.type)}`.trim(),
              g.derivation ? verificationMark(verificationOf(id)?.status) : null,
            ),
            n?.title ?? id,
          );
        }),
      ),
    ]),
  );
}

/** The kick line of the card: ID, kind, status and verification in the chosen view. */
function kick(e: DataExportElement): HTMLElement {
  const entry = e.verification?.find((v) => v.view === store.view);
  const words =
    entry?.criteria === undefined
      ? undefined
      : `${verificationWord(entry.status)}, ${String(entry.criteria.verified)} of ${String(entry.criteria.total)} criteria verified`;
  return h(
    "div",
    { class: "kick" },
    shownId(e) === "" ? null : h("b", null, shownId(e)),
    h("span", null, kindLabel(store.mm, e)),
    statusPill(e.status),
    entry === undefined ? null : verificationMark(entry.status, words),
  );
}

const nameOfProp = (key: string): string => sentence(propDef(store.mm, key)?.name ?? key);

/** A text of the element: Markdown where the metamodel marks the property so, else plain paragraphs. */
const textBlock = (
  e: DataExportElement,
  text: string,
  key: string | undefined,
  cls: string,
): Promise<HTMLElement> =>
  key === undefined || propDef(store.mm, key)?.markdown === true
    ? markdown(text, e, fromOf("e", refOf(e)), cls)
    : Promise.resolve(h("div", { class: `${cls} plain` }, paragraphs(text)));

/**
 * One row of a numbered list: its number, its text, and at its end what belongs to that entry alone (of an
 * acceptance criterion its verification status), each part a child of `.crit-end`.
 */
const listRow = (n: number, text: HTMLElement, end: readonly Child[]): HTMLElement =>
  h(
    "div",
    { class: "crit", "data-n": n },
    h("span", { class: "n" }, n),
    text,
    end.some((part) => part !== null && part !== undefined && part !== false)
      ? h("div", { class: "crit-end" }, end)
      : null,
  );

/**
 * A numbered list under its heading: the acceptance criteria, or a text list of the type. With `statusSlots`, each
 * row has a place for its verification status, which `fillCriterionStatuses` fills once the page is drawn.
 */
const numbered = async (
  e: DataExportElement,
  key: string,
  items: readonly unknown[],
  statusSlots = false,
): Promise<Child> => [
  h("h2", { class: "sect" }, nameOfProp(key)),
  items.length === 0
    ? h("p", { class: "none" }, "None yet.")
    : await Promise.all(
        items.map(async (item, at) =>
          listRow(
            at + 1,
            await textBlock(e, itemText(item), key, "ct"),
            statusSlots ? [h("span", { class: "crit-st" })] : [],
          ),
        ),
      ),
];

/**
 * Fills the status place of each acceptance criterion with its verification status in the chosen view
 * (`criterionStatuses` of `evidence.list`). It runs after the card is drawn, so opening an element waits for no
 * further command; without an answer the criteria stay without a status.
 */
async function fillCriterionStatuses(cardEl: HTMLElement, e: DataExportElement, route: Route): Promise<void> {
  const slots = [...cardEl.querySelectorAll(".crit-st")];
  if (slots.length === 0) {
    return;
  }
  const out = await call("evidence.list", {
    ref: e.id,
    repository: e.repository,
    file: e.file,
    ...viewSelection(),
  }).catch(() => undefined);
  if (out === undefined || !isCurrent(route) || !cardEl.isConnected) {
    return;
  }
  criterionStatuses(out.display.rows, slots.length).forEach((status, at) => {
    const mark = verificationMark(status);
    if (mark !== null) {
      slots[at]?.replaceWith(mark);
    }
  });
}

/** The text properties of the card: notes, the acceptance criteria and the numbered lists. */
async function texts(e: DataExportElement): Promise<Child> {
  const mm = store.mm;
  const criteriaKey = propOfType(mm, e.type, "acceptance-criteria");
  const listOf = (key: string): readonly unknown[] => {
    const value = e.properties[key];
    return Array.isArray(value) ? value : [];
  };
  const notes = await Promise.all(
    noteProps(mm, e.type).map(async (key) => {
      const value = e.properties[key];
      return typeof value === "string" && value.trim() !== ""
        ? h(
            "div",
            { class: "rationale" },
            h("b", null, `${nameOfProp(key)}.`),
            await textBlock(e, value, key, "rt"),
          )
        : null;
    }),
  );
  return [
    notes,
    criteriaKey === undefined
      ? null
      : await numbered(e, criteriaKey, listOf(criteriaKey), e.verification !== undefined),
    await Promise.all(
      listProps(mm, e.type)
        .filter((key) => listOf(key).length > 0)
        .map((key) => numbered(e, key, listOf(key))),
    ),
  ];
}

/** The last line of the card: packages, verification method and version. */
function meta(e: DataExportElement): HTMLElement {
  const mm = store.mm;
  const methodKey = propOfType(mm, e.type, "verification-method");
  const method = methodKey === undefined ? undefined : e.properties[methodKey];
  const packagesKey = propKey(mm, "packages");
  const packages = e.relations.filter((r) => r.kind === packagesKey && r.direction === "out");
  return h(
    "div",
    { class: "meta" },
    packages.length === 0 || packagesKey === undefined
      ? null
      : h(
          "span",
          null,
          `${nameOfProp(packagesKey)} `,
          h("b", null, packages.map((p) => targetOf(p).title).join(", ")),
        ),
    methodKey === undefined || method === undefined
      ? null
      : h(
          "span",
          null,
          `${nameOfProp(methodKey)} `,
          h("b", null, choiceName(mm, methodKey, method).toLowerCase()),
        ),
    e.version === undefined ? null : h("span", null, "Version ", h("b", { class: "num" }, e.version)),
  );
}

const SEVERITY_WORDS: Readonly<Record<ProblemGroupDisplay["severity"], string>> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

const severityMark = (severity: ProblemGroupDisplay["severity"]): HTMLElement =>
  h("span", { class: "sev" }, SEVERITY_WORDS[severity]);

/**
 * The problems of the element, errors first (`elementProblemGroups`): a kind with one problem as that problem, a
 * kind with several as one row headed by the kind and their count that opens on click or with the keyboard.
 */
function problemsOf(e: DataExportElement): HTMLElement | null {
  const groups = elementProblemGroups(e.problems);
  if (groups.length === 0) {
    return null;
  }
  const count = groups.reduce((n, g) => n + g.problems.length, 0);
  return h(
    "section",
    { class: "probs", "aria-labelledby": "el-probs" },
    h("h2", { class: "sect", id: "el-probs" }, "Problems ", h("b", null, count)),
    h(
      "ul",
      null,
      groups.map((g) =>
        h(
          "li",
          { "data-severity": g.severity, "data-code": g.code },
          g.problems.length === 1
            ? [severityMark(g.severity), h("span", { class: "pm" }, g.problems[0]?.message)]
            : h(
                "details",
                null,
                h(
                  "summary",
                  null,
                  severityMark(g.severity),
                  h("span", { class: "pm" }, g.title),
                  h("b", null, g.problems.length),
                ),
                h(
                  "ul",
                  null,
                  g.problems.map((p) => h("li", null, p.message)),
                ),
              ),
        ),
      ),
    ),
  );
}

/** The card: the element itself. */
async function card(got: ElementGetOutput): Promise<HTMLElement> {
  const e = got.element;
  const entries = propEntries(store.mm, e);
  const [prose, more] = await Promise.all([markdown(e.text, e, fromOf("e", refOf(e)), "prose"), texts(e)]);
  return h(
    "article",
    { class: "card", id: "card", "aria-labelledby": "el-title", "data-id": e.id },
    kick(e),
    h("h1", { id: "el-title", "data-vt": refOf(e) }, e.title),
    problemsOf(e),
    prose,
    more,
    entries.length === 0
      ? null
      : h(
          "dl",
          { class: "pdl" },
          entries.map((x) => h("div", null, h("dt", null, x.name), h("dd", null, x.value))),
        ),
    meta(e),
  );
}

/** Connectors: one trunk in each gutter, short stubs to each node, joined to the card. Outdated links are dashed. */
function drawLinks(trace: Element, svg: SVGElement): void {
  const cardEl = trace.querySelector("#card");
  if (cardEl === null || getComputedStyle(svg).display === "none") {
    return;
  }
  const box = trace.getBoundingClientRect();
  const c = cardEl.getBoundingClientRect();
  const y0 = c.top - box.top + 46;
  const paths: SVGElement[] = [];
  const side = (nodes: readonly Element[], toLeft: boolean): void => {
    if (nodes.length === 0) {
      return;
    }
    const edge = toLeft ? c.left - box.left : c.right - box.left;
    const nodeEdge = (n: Element): number =>
      (toLeft ? n.getBoundingClientRect().right : n.getBoundingClientRect().left) - box.left;
    const xs = nodes.map(nodeEdge);
    const trunk0 = toLeft ? (Math.max(...xs) + edge) / 2 : (Math.min(...xs) + edge) / 2;
    for (const n of nodes) {
      const warn = n.hasAttribute("data-warn");
      const trunk = trunk0 + (warn ? (toLeft ? -10 : 10) : 0);
      const r = n.getBoundingClientRect();
      const y = r.top - box.top + Math.min(r.height / 2, 26);
      const x = nodeEdge(n);
      const dir = y > y0 ? 1 : -1;
      const rr = Math.min(6, Math.abs(y - y0) / 2);
      const d =
        Math.abs(y - y0) < 1
          ? `M${String(x)} ${String(y)} L${String(edge)} ${String(y0)}`
          : toLeft
            ? `M${String(x)} ${String(y)} L${String(trunk - rr)} ${String(y)} Q${String(trunk)} ${String(y)} ${String(trunk)} ${String(y - dir * rr)} L${String(trunk)} ${String(y0 + dir * rr)} Q${String(trunk)} ${String(y0)} ${String(trunk + rr)} ${String(y0)} L${String(edge)} ${String(y0)}`
            : `M${String(edge)} ${String(y0)} L${String(trunk - rr)} ${String(y0)} Q${String(trunk)} ${String(y0)} ${String(trunk)} ${String(y0 + dir * rr)} L${String(trunk)} ${String(y - dir * rr)} Q${String(trunk)} ${String(y)} ${String(trunk + rr)} ${String(y)} L${String(x)} ${String(y)}`;
      paths.push(s("path", { class: warn ? "warn" : null, d }));
    }
  };
  side([...trace.querySelectorAll(".col-left [data-link]")], true);
  side([...trace.querySelectorAll(".col-right [data-right]")], false);
  // Dashed paths last, so a broken link is never hidden under a grey one.
  paths.sort((a, b) => Number(a.classList.contains("warn")) - Number(b.classList.contains("warn")));
  svg.replaceChildren(...paths);
}

let observer: ResizeObserver | undefined;

async function render(root: HTMLElement, route: Route): Promise<void> {
  const ref = route.parts[1] ?? "";
  const back = backOf(route.params.get("from"));
  const topbar = (crumb: Child, tabs: Child = null): HTMLElement =>
    h(
      "header",
      { class: "topbar" },
      h("a", { class: "back", href: back.href }, icon.back(), h("span", null, `Back to ${back.title}`)),
      crumb,
      tabs,
    );
  let got: ElementGetOutput;
  let nb: Neighbourhood | undefined;
  try {
    got = await call("element.get", { ref });
    nb = await incomingOf(got.element.id).catch(() => undefined);
  } catch (error) {
    if (isCurrent(route)) {
      root.replaceChildren(
        h(
          "div",
          { class: "page-bg" },
          topbar(null),
          h(
            "main",
            { id: "main", class: "form-wrap", tabindex: -1 },
            h("div", { class: "form" }, errorBox(error)),
          ),
        ),
      );
    }
    return;
  }
  const cardEl = await card(got);
  // A page that finishes after the person moved on must not draw over the new one.
  if (!isCurrent(route)) {
    return;
  }
  const e = got.element;
  const packagesKey = propKey(store.mm, "packages");
  const firstPackage = e.relations.find((r) => r.kind === packagesKey && r.direction === "out");
  const left = leftColumn(got);
  const right = rightColumn(e, nb);
  const svg = s("svg", { class: "links", "aria-hidden": "true" });
  const trace = h(
    "div",
    { class: `trace${right === null ? " noright" : ""}${left.childElementCount === 0 ? " noleft" : ""}` },
    svg,
    left,
    cardEl,
    right,
  );
  await swap(
    root,
    h(
      "div",
      { class: "page-bg" },
      topbar(
        firstPackage === undefined
          ? null
          : h("span", { class: "crumb" }, el(firstPackage.id)?.title ?? firstPackage.title ?? ""),
        [
          elementTabs(e, "e", route.params.get("from")),
          // The decisions on its status, each after its confirmation as on the changes since a baseline, and the
          // form of the edit area, whose way back leads here.
          h(
            "span",
            { class: "el-acts" },
            decisions(el(e.id)),
            h(
              "a",
              {
                class: "btn sm edit-link",
                href: `${hashOf("edit", refOf(e))}?from=${encodeURIComponent(route.hash)}`,
              },
              "Edit",
            ),
          ),
        ],
      ),
      h("main", { id: "main", class: "trace-wrap", tabindex: -1 }, flashBox(route), trace),
    ),
    refOf(e),
  );
  document.title = `${shownId(e) === "" ? "" : `${shownId(e)} `}${e.title} · ReqSeq`;
  void fillCriterionStatuses(cardEl, e, route);
  observer?.disconnect();
  observer = new ResizeObserver(() => {
    drawLinks(trace, svg);
  });
  observer.observe(trace);
}

addRoute("e", render);

// The connectors are drawn again only while the element page is shown.
window.addEventListener("hashchange", () => {
  observer?.disconnect();
  observer = undefined;
});
