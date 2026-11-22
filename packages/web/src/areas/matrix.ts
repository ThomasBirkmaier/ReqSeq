// The trace matrix (`#/matrix?type=<key>&package=<id>&offset=<n>`): one row per element of a type, one column
// per relation kind and direction, each cell the elements at the other end, as `trace.matrix` gives them; with
// evidence, the verification status and the test cases of each requirement. Gaps (fewer relations than the
// metamodel asks for), outdated links and missing targets are marked.
import "../css/matrix.css";
import type { TraceMatrixOutput } from "@reqseq/core";
import { call } from "../api.js";
import type { Child } from "../dom.js";
import { h } from "../dom.js";
import { addPlace } from "../element-tabs.js";
import { addRailSection, errorBox, frame, prepareRail } from "../layout.js";
import { verificationMark } from "../marks.js";
import { isInvalid, packageWord, typeName, typePlural, typesWith } from "../meaning.js";
import type { Route } from "../router.js";
import { addRoute, fromOf, hashOf, isCurrent } from "../router.js";
import { el, refOf, shownId, store, variantName, viewSelection } from "../store.js";

const MATRIX = "matrix";
/** Rows of one page. */
const ROWS = 200;

type Row = TraceMatrixOutput["rows"][number];
type Relation = Row["cells"][number][number];

/** The types a matrix can show: requirements first, then needs, then every other type that can have elements. */
const matrixTypes = (): string[] => {
  const req = typesWith(store.mm, "requirement");
  const need = typesWith(store.mm, "need");
  const rest = store.mm.types
    .filter((t) => !t.abstract && !req.includes(t.key) && !need.includes(t.key))
    .map((t) => t.key);
  return [...req, ...need, ...rest];
};

const packagesOf = (): { id: string; title: string }[] => {
  const types = typesWith(store.mm, "package");
  return [...store.byId.values()]
    .filter((e) => types.includes(e.type ?? "") && !isInvalid(store.mm, e.status))
    .map((e) => ({ id: e.id, title: e.title ?? e.shortId }));
};

interface Choice {
  readonly type: string;
  readonly pkg: string;
  readonly offset: number;
}

const choiceOf = (route: Route): Choice => {
  const types = matrixTypes();
  const type = route.params.get("type") ?? "";
  return {
    type: types.includes(type) ? type : (types[0] ?? ""),
    pkg: route.params.get("package") ?? "",
    offset: Math.max(0, Math.floor(Number(route.params.get("offset") ?? "0")) || 0),
  };
};

const hrefOf = (c: Choice): string => {
  const query = new URLSearchParams({ type: c.type });
  if (c.pkg !== "") {
    query.set("package", c.pkg);
  }
  if (c.offset > 0) {
    query.set("offset", String(c.offset));
  }
  return `${hashOf(MATRIX)}?${query.toString()}`;
};

/** Where the other end of a relation is, when it is not available here. */
const TARGET_WORDS: Readonly<Record<string, string>> = {
  missing: "not found",
  inaccessible: "not on this machine",
  ambiguous: "more than one match",
  "unknown-repository": "unknown repository",
};

/** How a relation's other end is named in a cell. */
const labelOf = (relation: Relation): string =>
  el(relation.id)?.identifier ?? relation.identifier ?? relation.title ?? relation.shortId ?? relation.id;

/** One element at the other end of a relation: a link, marked when the link is outdated or its target missing. */
function chip(relation: Relation, from: string): HTMLElement {
  const target = el(relation.id);
  const missing = relation.targetState !== "available";
  const title = target?.title ?? relation.title ?? "";
  const cls = `chip${relation.outdated === true ? " warn" : ""}${missing ? " bad" : ""}`;
  const extra =
    relation.outdated === true ? "changed since linked" : missing ? TARGET_WORDS[relation.targetState] : null;
  const why = extra === null ? null : h("span", { class: "why" }, extra);
  return missing || target === undefined
    ? h("span", { class: cls, title }, labelOf(relation), why)
    : h(
        "a",
        { class: cls, href: `${hashOf("e", refOf(target))}?from=${encodeURIComponent(from)}`, title },
        labelOf(relation),
        why,
      );
}

const TEST_MARKS: Readonly<Record<string, string>> = {
  failed: "failed",
  outdated: "outdated",
  "not-executed": "not run",
};

/** The test cases of a requirement in one cell: their count and the marked ones by name. */
const testsCell = (row: Row): Child => {
  const cases = row.testCases ?? [];
  if (cases.length === 0) {
    return h("span", { class: "none" }, "–");
  }
  const marked = cases.filter((c) => c.mark !== undefined);
  return [
    h("span", null, cases.length === 1 ? "1 test case" : `${String(cases.length)} test cases`),
    marked.map((c) =>
      h("span", { class: `tc ${c.mark ?? ""}` }, `${c.name}: ${TEST_MARKS[c.mark ?? ""] ?? c.mark ?? ""}`),
    ),
  ];
};

function table(out: TraceMatrixOutput, from: string): HTMLElement {
  const evidence = out.evidence !== undefined;
  const noId = out.rows.every((r) => shownId(r) === "");
  return h(
    "div",
    { class: "mscroll", tabindex: 0, role: "region", "aria-label": "Trace matrix" },
    h(
      "table",
      { class: `matrix${noId ? " noid" : ""}` },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", { scope: "col", class: "rowh" }, "Element"),
          out.columns.map((c) =>
            h(
              "th",
              { scope: "col" },
              h("span", { class: "cn" }, c.name),
              h(
                "span",
                { class: "cs" },
                c.expected === undefined
                  ? `${String(c.count)} of ${String(out.total)} have one`
                  : `${String(c.met ?? 0)} of ${String(c.expected)} meet the minimum`,
              ),
            ),
          ),
          evidence ? h("th", { scope: "col" }, h("span", { class: "cn" }, "Verification")) : null,
          evidence ? h("th", { scope: "col" }, h("span", { class: "cn" }, "Test cases")) : null,
        ),
      ),
      h(
        "tbody",
        null,
        out.rows.map((row) => {
          const gaps = new Map((row.gaps ?? []).map((g) => [g.column, g]));
          const entry = row.verification?.[0];
          return h(
            "tr",
            { "data-id": row.id, class: isInvalid(store.mm, row.status) ? "obs" : null },
            h(
              "th",
              { scope: "row", class: "rowh" },
              h(
                "a",
                { href: `${hashOf("e", refOf(row))}?from=${encodeURIComponent(from)}` },
                shownId(row) === "" ? null : h("span", { class: "id" }, shownId(row)),
                h("span", { class: "t" }, row.title === "" ? row.shortId : row.title),
              ),
            ),
            row.cells.map((cell, at) => {
              const gap = gaps.get(at);
              return h(
                "td",
                { class: gap === undefined ? null : "gap" },
                cell.map((r) => chip(r, from)),
                gap === undefined
                  ? null
                  : h(
                      "span",
                      { class: "gapw" },
                      `${String(gap.count)} of at least ${String(gap.min)} ${gap.targetName}`,
                    ),
              );
            }),
            evidence ? h("td", null, entry === undefined ? null : verificationMark(entry.status)) : null,
            evidence ? h("td", { class: "tcs" }, testsCell(row)) : null,
          );
        }),
      ),
    ),
  );
}

function controls(choice: Choice): HTMLElement {
  const types = h(
    "select",
    { name: "type" },
    matrixTypes().map((key) =>
      h("option", { value: key, selected: key === choice.type }, typePlural(store.mm, key)),
    ),
  );
  types.addEventListener("change", () => {
    location.hash = hrefOf({ ...choice, type: types.value, offset: 0 });
  });
  const pkgs = packagesOf();
  const pkg = h(
    "select",
    { name: "package" },
    h("option", { value: "", selected: choice.pkg === "" }, "All"),
    pkgs.map((p) => h("option", { value: p.id, selected: p.id === choice.pkg }, p.title)),
  );
  pkg.addEventListener("change", () => {
    location.hash = hrefOf({ ...choice, pkg: pkg.value, offset: 0 });
  });
  return h(
    "div",
    { class: "mctl" },
    h("label", { class: "fld inline" }, h("span", { class: "fl" }, "Rows"), types),
    pkgs.length === 0
      ? null
      : h("label", { class: "fld inline" }, h("span", { class: "fl" }, packageWord(store.mm)), pkg),
  );
}

async function render(root: HTMLElement, route: Route): Promise<void> {
  const choice = choiceOf(route);
  await prepareRail();
  let body: Child;
  try {
    const out = await call("trace.matrix", {
      selection: {
        ...viewSelection(),
        ...(choice.pkg === "" ? {} : { package: choice.pkg }),
        where: { type: [choice.type] },
      },
      limit: ROWS,
      offset: choice.offset,
    });
    const from =
      fromOf(...route.parts) + (route.hash.includes("?") ? route.hash.slice(route.hash.indexOf("?")) : "");
    const degree = out.evidence?.degree;
    body = [
      out.total === 0
        ? h(
            "div",
            { class: "empty" },
            h("strong", null, `No ${typePlural(store.mm, choice.type).toLowerCase()} here.`),
          )
        : [
            degree === undefined
              ? null
              : h(
                  "p",
                  { class: "lead" },
                  `${String(degree.counts.verified + degree.counts.indirect)} of ${String(degree.total)} verified in ${variantName(out.evidence?.view ?? "core")}.`,
                ),
            table(out, from),
            out.total > ROWS
              ? h(
                  "div",
                  { class: "pager" },
                  choice.offset > 0
                    ? h(
                        "a",
                        {
                          class: "btn sm",
                          href: hrefOf({ ...choice, offset: Math.max(0, choice.offset - ROWS) }),
                        },
                        "Previous",
                      )
                    : null,
                  h(
                    "span",
                    null,
                    `Rows ${String(choice.offset + 1)}–${String(Math.min(out.total, choice.offset + ROWS))} of ${String(out.total)}`,
                  ),
                  choice.offset + ROWS < out.total
                    ? h(
                        "a",
                        { class: "btn sm", href: hrefOf({ ...choice, offset: choice.offset + ROWS }) },
                        "Next",
                      )
                    : null,
                )
              : null,
          ],
      out.incomplete
        ? h(
            "p",
            { class: "note" },
            "A repository of the workspace is not on this machine; relations stored there are missing.",
          )
        : null,
    ];
  } catch (error) {
    body = errorBox(error);
  }
  if (!isCurrent(route)) {
    return;
  }
  root.replaceChildren(
    frame(
      MATRIX,
      h(
        "section",
        { class: "mpage", "aria-labelledby": "list-h" },
        h(
          "div",
          { class: "lh" },
          h("h1", { id: "list-h" }, "Trace matrix"),
          h(
            "p",
            null,
            `What each of the ${typePlural(store.mm, choice.type).toLowerCase()} is linked to, by relation.`,
          ),
          controls(choice),
        ),
        body,
      ),
      { wide: true },
    ),
  );
  document.title = `Trace matrix · ${typeName(store.mm, choice.type)} · ReqSeq`;
}

addRoute(MATRIX, render);
addPlace(MATRIX, () => "Trace matrix");
addRailSection({
  order: 30,
  title: "Trace",
  links: () => [{ href: hashOf(MATRIX), key: MATRIX, name: "Trace matrix" }],
});
