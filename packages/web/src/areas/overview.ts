// The overview and the queues (`#/q/overview`, `#/q/<queue>`): what needs a look or a decision, as ReqSeq reports
// it. The overview lists the head of each queue next to the verification degree of the workspace; a queue lists
// all its elements. A row opens the element page.
import "../css/overview.css";
import type { DataExportVerificationDegree } from "@reqseq/core";
import { call } from "../api.js";
import type { Child } from "../dom.js";
import { h } from "../dom.js";
import { addRailSection, frame, prepareRail } from "../layout.js";
import { VERIFICATION } from "../marks.js";
import { isInvalid, needWords, packageWord, propKey, reqWords, typesWith } from "../meaning.js";
import { animateValues, swap } from "../motion.js";
import type { Queue, QueueRow } from "../queues.js";
import { allQueues, countOf, degreeOf, queueData, queueOf, rowsOf } from "../queues.js";
import type { Route } from "../router.js";
import { HOME, addRoute, hashOf, isCurrent, withFrom } from "../router.js";
import { el, hasVariants, refOf, shownId, store, variantName, viewSelection } from "../store.js";

const OVERVIEW = "overview";

/** Where a row leads: the element page, with the way back to this list. */
const rowHref = (row: QueueRow, from: string): string => {
  const e = el(row.id) ?? row.fallback;
  return withFrom(hashOf("e", e === undefined ? row.id : refOf(e)), "q", from);
};

const item = (row: QueueRow, from: string): HTMLElement => {
  const e = el(row.id);
  const shown = e ?? row.fallback;
  const label = shown === undefined ? row.id : refOf(shown);
  return h(
    "div",
    { role: "listitem" },
    h(
      "a",
      { href: rowHref(row, from), "data-id": row.id, class: "it" },
      h("span", { class: "id" }, shownId(shown)),
      h("span", { class: "t", "data-vt": label }, shown?.title ?? row.id),
      h("span", null),
      row.meta === undefined || row.meta === "" ? null : h("span", { class: "m" }, row.meta),
    ),
  );
};

const listHead = (title: string, sub: string, extra?: Child): HTMLElement =>
  h("div", { class: "lh" }, h("h1", { id: "list-h" }, title), sub === "" ? null : h("p", null, sub), extra);

const empty = (text: string): HTMLElement => h("div", { class: "empty" }, h("strong", null, text));

/** The list of the overview: the head of each queue with something in it. */
function overviewList(degree: DataExportVerificationDegree): HTMLElement {
  const from = OVERVIEW;
  const groups = allQueues()
    .map((queue) => ({ queue, rows: rowsOf(queue) }))
    .filter(({ rows }) => rows.length > 0);
  const noId = groups.every(({ rows }) => rows.every((r) => shownId(el(r.id) ?? r.fallback) === ""));
  return h(
    "section",
    { class: `list${noId ? " noid" : ""}`, "aria-labelledby": "list-h" },
    listHead(
      "Overview",
      "What needs a look or a decision, as ReqSeq reports it.",
      h("p", { class: "ov-mini" }, verifiedSentence(degree)),
    ),
    h(
      "div",
      { class: "lscroll" },
      groups.length === 0 ? empty("Nothing needs a look or a decision.") : null,
      groups.map(({ queue, rows }) => [
        h(
          "h2",
          { class: "group" },
          h("a", { href: hashOf("q", queue.key) }, queue.title()),
          h("b", null, rows.length),
        ),
        h(
          "div",
          { role: "list" },
          rows.slice(0, queue.head ?? 3).map((r) => item(r, from)),
        ),
        rows.length > (queue.head ?? 3)
          ? h("a", { class: "more", href: hashOf("q", queue.key) }, `Show all ${String(rows.length)}`)
          : null,
      ]),
    ),
  );
}

const verifiedSentence = (d: DataExportVerificationDegree): string =>
  `${String(d.counts.verified + d.counts.indirect)} of ${String(d.total)} ${reqWords(store.mm)} are verified.`;

interface PackageDegree {
  readonly id: string;
  readonly title: string;
  readonly degree: DataExportVerificationDegree;
}

let packageDegrees:
  { readonly epoch: number; readonly view: string; readonly rows: readonly PackageDegree[] } | undefined;

/** The verification degree of each package that is not retired, as ReqSeq gives it per package. */
async function packagesDegree(): Promise<readonly PackageDegree[]> {
  if (packageDegrees?.epoch === store.epoch && packageDegrees.view === store.view) {
    return packageDegrees.rows;
  }
  const packages = [...store.byId.values()].filter(
    (e) => typesWith(store.mm, "package").includes(e.type ?? "") && !isInvalid(store.mm, e.status),
  );
  const rows = await Promise.all(
    packages.map(async (p) => ({
      id: p.id,
      title: p.title ?? p.shortId,
      degree: (await call("evidence.degree", { selection: { package: p.id, ...viewSelection() } })).degree,
    })),
  );
  const shown = rows.filter((r) => r.degree.total > 0);
  packageDegrees = { epoch: store.epoch, view: store.view, rows: shown };
  return shown;
}

const SEGMENTS = [
  ["verified", "var(--ok)"],
  ["indirect", "var(--ok-soft)"],
  ["outdated", "var(--warn-line)"],
  ["failed", "var(--bad)"],
  ["open", "var(--line-strong)"],
] as const;

const segmentWord = (status: string): string =>
  status === "indirect" ? "verified through children" : (VERIFICATION[status] ?? status).toLowerCase();

const swatch = (colour: string, cls: string): HTMLElement => {
  const i = h("i", { class: cls, "aria-hidden": "true" });
  i.style.setProperty("background", colour);
  return i;
};

/** The panel of the overview: the verification degree in one sentence, as a bar, and by package. */
function overviewPanel(
  degree: DataExportVerificationDegree,
  packages: readonly PackageDegree[],
): HTMLElement {
  const c = degree.counts;
  const segments = SEGMENTS.map(([status, colour]) => ({ status, colour, n: c[status] })).filter(
    (x) => x.n > 0,
  );
  const bar = h(
    "div",
    {
      class: "bar",
      role: "img",
      "aria-label": segments.map((x) => `${String(x.n)} ${segmentWord(x.status)}`).join(", "),
    },
    segments.map((x) => {
      const i = swatch(x.colour, "");
      i.dataset["bar"] = `deg:${x.status}`;
      i.dataset["prop"] = "flex-grow";
      i.style.setProperty("flex-grow", String(x.n));
      return i;
    }),
  );
  const drafts = queueOf("drafts");
  const draftCount = drafts === undefined ? 0 : countOf(drafts);
  const needTypes = typesWith(store.mm, "need");
  const needCount = [...store.byId.values()].filter((e) => needTypes.includes(e.type ?? "")).length;
  return h(
    "div",
    { class: "ov" },
    h(
      "div",
      { class: "ov-main" },
      h(
        "h2",
        { class: "headline" },
        h("span", { "data-num": "deg:v" }, c.verified + c.indirect),
        " of ",
        h("span", { "data-num": "deg:t" }, degree.total),
        ` ${reqWords(store.mm)} are verified.`,
      ),
      bar,
      h(
        "div",
        { class: "legend" },
        segments.map((x) =>
          h(
            "span",
            null,
            swatch(x.colour, ""),
            h("b", { "data-num": `leg:${x.status}` }, x.n),
            segmentWord(x.status),
          ),
        ),
      ),
      h(
        "div",
        { class: "facts" },
        draftCount > 0 && drafts !== undefined
          ? h(
              "a",
              { href: hashOf("q", "drafts") },
              h("b", { "data-num": "f:drafts" }, draftCount),
              drafts.title().toLowerCase(),
            )
          : null,
        needTypes.length > 0
          ? h("div", null, h("b", null, needCount), `${needWords(store.mm)} in the specification`)
          : null,
      ),
      hasVariants() && store.variants.length > 0
        ? h(
            "p",
            { class: "note" },
            `Counted for ${variantName(store.view)}. Choose another one under View to count it there.`,
          )
        : null,
    ),
    packages.length === 0
      ? null
      : h(
          "aside",
          { class: "ov-pk", "aria-labelledby": "pk-h" },
          h("h3", { id: "pk-h" }, `Verified, by ${packageWord(store.mm).toLowerCase()}`),
          h(
            "ul",
            null,
            packages.map((p) => {
              const share = p.degree.share ?? 0;
              const fillBar = h("i", { "data-bar": `pk:${p.id}` });
              fillBar.style.setProperty("width", `${(share * 100).toFixed(1)}%`);
              return h(
                "li",
                { "data-id": p.id },
                h("span", { class: "pn" }, p.title),
                h(
                  "span",
                  { class: "pv num" },
                  h("span", { "data-num": `pkv:${p.id}` }, Math.round(share * 100)),
                  " %",
                ),
                h("span", { class: "pb", "aria-hidden": "true" }, fillBar),
                h(
                  "span",
                  { class: "sr" },
                  `${String(p.degree.counts.verified + p.degree.counts.indirect)} of ${String(p.degree.total)} ${reqWords(store.mm)} verified`,
                ),
              );
            }),
          ),
          h(
            "p",
            { class: "note" },
            `Share of ${reqWords(store.mm)} in each ${packageWord(store.mm).toLowerCase()} that are verified, directly or through their children.`,
          ),
        ),
  );
}

/** The page of one queue: all its elements, in groups where it has them. */
function queueList(queue: Queue): HTMLElement {
  const from = queue.key;
  const groups = queue.groups().filter((g) => g.rows.length > 0);
  const flat = groups.flatMap((g) => g.rows);
  const noId = flat.length > 0 && flat.every((r) => shownId(el(r.id) ?? r.fallback) === "");
  return h(
    "section",
    { class: `list${noId ? " noid" : ""}`, "aria-labelledby": "list-h" },
    listHead(queue.title(), queue.sub()),
    h(
      "div",
      { class: "lscroll" },
      flat.length === 0 ? empty("Nothing here right now.") : null,
      groups.map((g) => [
        g.title === null ? null : h("h2", { class: "group" }, g.title, h("b", null, g.rows.length)),
        h(
          "div",
          { role: "list" },
          g.rows.map((r) => item(r, from)),
        ),
      ]),
    ),
  );
}

async function render(root: HTMLElement, route: Route): Promise<void> {
  const key = route.parts[1] ?? OVERVIEW;
  const queue = key === OVERVIEW ? undefined : queueOf(key);
  if (key !== OVERVIEW && queue === undefined) {
    location.replace(`#${HOME}`);
    return;
  }
  await prepareRail();
  if (queue === undefined) {
    const degree = degreeOf();
    const packages = propKey(store.mm, "packages") === undefined ? [] : await packagesDegree();
    // A page that finishes after the person moved on must not draw over the new one.
    if (!isCurrent(route)) {
      return;
    }
    await swap(root, frame(OVERVIEW, [overviewList(degree), overviewPanel(degree, packages)]));
    document.title = "Overview · ReqSeq";
  } else {
    if (!isCurrent(route)) {
      return;
    }
    await swap(root, frame(queue.key, queueList(queue), { wide: true }));
    document.title = `${queue.title()} · ReqSeq`;
  }
  animateValues(root);
}

addRoute("q", render);

addRailSection({
  order: 10,
  title: "Inbox",
  prepare: async () => {
    await queueData();
  },
  links: () => [
    { href: hashOf("q", OVERVIEW), key: OVERVIEW, name: "Overview" },
    ...allQueues()
      .map((queue) => ({ queue, count: countOf(queue) }))
      .filter(({ count }) => count > 0)
      .map(({ queue, count }) => ({
        href: hashOf("q", queue.key),
        key: queue.key,
        name: (queue.short ?? queue.title)(),
        count,
        warn: queue.warn === true,
      })),
  ],
});
