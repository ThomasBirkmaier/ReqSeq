// html.export, the neighbourhood on an element's page (SR-232 AK5, AK6): parents up to the top, children as a tree with
// repetitions, incoming relations and references by kind, outdated links marked, and elements with an invalid status
// without a link while the chain goes on through them.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const METAMODEL = `reqseq-metamodel: 1
types:
  - { key: need, name: Need, prefix: N, meaning: need, properties: [title, spec-id], required: [title] }
  - { key: system-requirement, name: System Requirement, prefix: SR, meaning: requirement, properties: [title, spec-id, related], required: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }
  - { key: related, name: Related, kind: relation, many: true }
relations:
  - { key: derives-from, name: Derives from, meaning: derivation }
  - { key: based-on, name: Based on, inverse-name: Basis for }
  - { key: relates-to, name: Relates to }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: approved, name: Approved }
  - { key: obsolete, name: Obsolete, invalid: true }
`;

const uuid = (n: number): string => `aaaa1111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const ROOT = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const TOP = uuid(1);
const SUB = uuid(2);
const OLD = uuid(3);
const BASE = uuid(4);
const ONE = "3f2a9c1e-5b7d-4e8a-9c0b-1d2e3f4a5b6c";
const BOTH = uuid(6);
const DEEP = uuid(7);
const GONE = uuid(8);
const AFTER = uuid(9);
const USER = uuid(10);
/** A stored version the current one never is: the relation that stores it is outdated. */
const STALE = "version: n1:0000000000000000";

const element = (id: string, type: string, front: string, body = "Text."): string =>
  `---\nid: ${id}\ntype: ${type}\n${front}---\n\n${body}\n`;
const derives = (...targets: string[]): string =>
  `derives-from:\n${targets.map((t) => `  - { id: ${t} }\n`).join("")}`;

/** The files of the neighbourhood of ROOT; `oldStatus` is the status of the parent OLD. */
const files = (oldStatus: string): Record<string, string> => ({
  "metamodel/standard-model.yaml": METAMODEL,
  "needs/N-1.md": element(TOP, "need", "status: approved\ntitle: Weather\nspec-id: N-1\n"),
  "needs/N-2.md": element(SUB, "need", `status: approved\ntitle: Wind\nspec-id: N-2\n${derives(TOP)}`),
  "needs/N-3.md": element(
    OLD,
    "need",
    `status: ${oldStatus}\ntitle: Old wind\nspec-id: N-3\n${derives(BASE)}`,
  ),
  "needs/N-4.md": element(BASE, "need", ""),
  "requirements/SR-6328cee88fb3.md": element(
    ROOT,
    "system-requirement",
    `status: approved\ntitle: Show wind speed\nspec-id: SR-1\nderives-from:\n  - { id: ${SUB}, ${STALE} }\n  - { id: ${OLD} }\n`,
  ),
  "requirements/SR-1d2e3f4a5b6c.md": element(
    ONE,
    "system-requirement",
    `status: approved\ntitle: Show gusts\nspec-id: SR-2\n${derives(ROOT)}`,
  ),
  "requirements/SR-6.md": element(
    BOTH,
    "system-requirement",
    `status: draft\ntitle: Show both\nderives-from:\n  - { id: ${ROOT} }\n  - { id: ${ONE}, ${STALE} }\n`,
  ),
  "requirements/SR-7.md": element(
    DEEP,
    "system-requirement",
    `status: draft\ntitle: Show peaks\n${derives(ONE)}`,
  ),
  "requirements/SR-8.md": element(
    GONE,
    "system-requirement",
    `status: obsolete\ntitle: Show rain\n${derives(ROOT)}`,
  ),
  "requirements/SR-9.md": element(
    AFTER,
    "system-requirement",
    `status: draft\ntitle: Show hail\n${derives(GONE)}`,
  ),
  "requirements/SR-10.md": element(
    USER,
    "system-requirement",
    `status: draft\ntitle: Log wind\nbased-on:\n  - { id: ${ROOT}, ${STALE} }\nrelates-to:\n  - { id: ${ROOT} }\nrelated:\n  - { id: ${ROOT} }\n`,
    `Uses [wind](reqseq:${ROOT}?${STALE.replace(": ", "=")}).`,
  ),
});

const open = async (oldStatus = "approved") => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files: files(oldStatus) });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace) =>
  invoke("html.export", { output: "site" }, { workspace }) as Promise<InvokedOutput<"html.export">>;

/** The neighbourhood section of the page of `id`. */
const sectionOf = async (fixture: { path: (relative: string) => string }, id: string): Promise<string> => {
  const page = await fs.readFile(fixture.path(`site/elements/${id}.html`), "utf8");
  const start = page.indexOf('<section class="rq-neighbourhood">');
  return page.slice(start, page.indexOf("</section>", start) + 10);
};

/** A row with a link to the page of `id`. */
const linked = (
  id: string,
  level: number,
  shown: string,
  title: string,
  status: string,
  marks = "",
): string =>
  `<li${level === 0 ? "" : ` style="--rq-level:${String(level)}"`}><a href="../elements/${id}.html"><span>${shown}</span><span>${title}${marks}</span><span>${status}</span></a></li>`;

/** A row without a link. */
const plain = (level: number, shown: string, title: string, status: string, marks = ""): string =>
  `<li${level === 0 ? "" : ` style="--rq-level:${String(level)}"`}><span><span>${shown}</span><span>${title}${marks}</span><span>${status}</span></span></li>`;

const outdated = (note: string): string => ` <span class="rq-outdated" title="${note}">link outdated</span>`;
const REPEATED = ' <span class="rq-repeated">repeated</span>';

describe("html.export shows the neighbourhood of an element (SR-232 AK5)", () => {
  it("[SR-232/AK-r9s3] shows the parents up to the top indented per level, the children as a tree with repetitions, then the incoming relations and references by kind, each row a link and outdated links marked", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    expect(await sectionOf(fixture, ROOT)).toBe(
      [
        '<section class="rq-neighbourhood"><h2 id="neighbourhood">Neighbourhood</h2>',
        // The topmost parents first; the direct parents last, one level further in. The element's own derivation
        // of N-2 stores an older version.
        '<h3>Parents</h3><ul class="rq-nb">',
        linked(TOP, 0, "N-000001 (N-1)", "Weather", "approved"),
        linked(BASE, 0, "N-000004", "", "–"),
        linked(
          SUB,
          1,
          "N-000002 (N-2)",
          "Wind",
          "approved",
          outdated("SR-e88fb3 (SR-1) points to an older version of N-000002 (N-2) (derives-from)"),
        ),
        linked(OLD, 1, "N-000003 (N-3)", "Old wind", "approved"),
        "</ul>",
        // A child of two parents stands under both; the place farther from the element is the repetition.
        '<h3>Children</h3><ul class="rq-nb">',
        linked(ONE, 0, "SR-4a5b6c (SR-2)", "Show gusts", "approved"),
        linked(
          BOTH,
          1,
          "SR-000006",
          "Show both",
          "draft",
          REPEATED + outdated("SR-000006 points to an older version of SR-4a5b6c (SR-2) (derives-from)"),
        ),
        linked(DEEP, 1, "SR-000007", "Show peaks", "draft"),
        linked(BOTH, 0, "SR-000006", "Show both", "draft"),
        plain(0, "SR-000008", "Show rain", "obsolete"),
        linked(AFTER, 1, "SR-000009", "Show hail", "draft"),
        "</ul>",
        '<h3>← Basis for</h3><ul class="rq-nb">',
        linked(
          USER,
          0,
          "SR-000010",
          "Log wind",
          "draft",
          outdated("SR-000010 points to an older version of SR-e88fb3 (SR-1) (based-on)"),
        ),
        "</ul>",
        '<h3>← Relates to</h3><ul class="rq-nb">',
        linked(USER, 0, "SR-000010", "Log wind", "draft"),
        "</ul>",
        '<h3>← Related</h3><ul class="rq-nb">',
        linked(USER, 0, "SR-000010", "Log wind", "draft"),
        "</ul>",
        '<h3>← inline reference</h3><ul class="rq-nb">',
        linked(
          USER,
          0,
          "SR-000010",
          "Log wind",
          "draft",
          outdated("SR-000010 points to an older version of SR-e88fb3 (SR-1) (inline reference)"),
        ),
        "</ul></section>",
      ].join(""),
    );
  });

  it("[SR-232/AK-r9s3] says when an element has no parents and no children, and shows no group of incoming links without one", async () => {
    const { fixture, workspace } = await open();
    await exported(workspace);
    const base = await sectionOf(fixture, BASE);
    expect(base).toContain(
      '<h3>Parents</h3><p class="rq-nb-none">No parents</p><h3>Children</h3><ul class="rq-nb">',
    );
    expect(base).not.toContain("←");
    expect(await sectionOf(fixture, USER)).toContain(
      '<h3>Parents</h3><p class="rq-nb-none">No parents</p><h3>Children</h3><p class="rq-nb-none">No children</p></section>',
    );
  });
});

/** The neighbourhood section of ROOT in a workspace of ROOT, `parents` needs above it and `children` leaves below. */
const boundedSection = async (count: number): Promise<{ parents: string; children: string }> => {
  const many = Array.from({ length: count }, (_, n) => n + 100);
  const extra = Object.fromEntries<string>([
    ...many.map((n): [string, string] => [
      `needs/N-${String(n)}.md`,
      element(uuid(n), "need", `title: Need ${String(n)}\n`),
    ]),
    ...many.map((n): [string, string] => [
      `requirements/SR-${String(n)}.md`,
      element(uuid(n + 1000), "system-requirement", `title: Child ${String(n)}\n${derives(ROOT)}`),
    ]),
    [
      "requirements/SR-6328cee88fb3.md",
      element(ROOT, "system-requirement", `title: Show wind speed\n${derives(...many.map(uuid))}`),
    ],
    ["requirements/SR-1d2e3f4a5b6c.md", element(ONE, "system-requirement", "title: Alone\n")],
  ]);
  const fixture = await createFixtureWorkspace({
    fixture: "SR-001/two-elements",
    files: { "metamodel/standard-model.yaml": METAMODEL, ...extra },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  await exported(workspace);
  const section = await sectionOf(fixture, ROOT);
  return {
    parents: section.slice(section.indexOf("<h3>Parents</h3>"), section.indexOf("<h3>Children</h3>")),
    children: section.slice(section.indexOf("<h3>Children</h3>")),
  };
};

const rowsIn = (part: string): number => part.split("<li").length - 1;
const MORE = '</ul><p class="rq-nb-none">Only the nearest 100 are shown.</p>';

describe("html.export bounds the parents and children of a page (SR-232 AK5)", () => {
  it("[SR-232/AK-r9s3] shows the nearest 100 parents and 100 children and says that there are more", async () => {
    const { parents, children } = await boundedSection(101);
    expect(rowsIn(parents)).toBe(100);
    expect(parents).toContain(MORE);
    expect(rowsIn(children)).toBe(100);
    expect(children).toContain(MORE);
  });

  it("[SR-232/AK-r9s3] shows exactly 100 parents and 100 children without saying that there are more", async () => {
    const { parents, children } = await boundedSection(100);
    expect(rowsIn(parents)).toBe(100);
    expect(rowsIn(children)).toBe(100);
    expect(parents + children).not.toContain("are shown");
  });

  it("[SR-232/AK-r9s3] shows every direct child when repetitions below one of them make the tree long", async () => {
    // ROOT -> A, B; C1..C50 under A and under D, D under A: 103 rows of 53 elements, B last.
    const A = uuid(201);
    const B = uuid(202);
    const D = uuid(203);
    const cs = Array.from({ length: 50 }, (_, n) => uuid(300 + n));
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: {
        "metamodel/standard-model.yaml": METAMODEL,
        "requirements/SR-6328cee88fb3.md": element(ROOT, "system-requirement", "title: Show wind speed\n"),
        "requirements/SR-1d2e3f4a5b6c.md": element(ONE, "system-requirement", "title: Alone\n"),
        "requirements/A.md": element(A, "system-requirement", `title: A\n${derives(ROOT)}`),
        "requirements/B.md": element(B, "system-requirement", `title: B\n${derives(ROOT)}`),
        "requirements/D.md": element(D, "system-requirement", `title: D\n${derives(A)}`),
        ...Object.fromEntries(
          cs.map((id, n): [string, string] => [
            `requirements/C${String(n)}.md`,
            element(id, "system-requirement", `title: C${String(n)}\n${derives(A, D)}`),
          ]),
        ),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    await exported(workspace);
    const section = await sectionOf(fixture, ROOT);
    expect(rowsIn(section)).toBe(103);
    expect(section.split(REPEATED).length - 1).toBe(50);
    expect(section).toContain(`${linked(B, 0, "SR-000202", "B", "–")}</ul></section>`);
    expect(section).not.toContain("are shown");
  });
});

describe("html.export keeps elements with an invalid status in the neighbourhood (SR-232 AK6)", () => {
  it("[SR-232/AK-kycg] shows a parent and a child with an invalid status with identifier, title and status without a link, and their parents and children after them", async () => {
    // OLD had a page in the earlier export, so it has a short page now (SR-231 AK8): still no link.
    const { fixture, workspace } = await open();
    await exported(workspace);
    await fixture.write("needs/N-3.md", String(files("obsolete")["needs/N-3.md"]));
    const again = new Workspace(fixture.root);
    onTestFinished(() => again.close());
    await exported(again);
    await expect(fs.readFile(fixture.path(`site/elements/${OLD}.html`), "utf8")).resolves.toContain(
      "obsolete",
    );
    const section = await sectionOf(fixture, ROOT);
    // The parent: no link, and its own parent (BASE) still among the topmost.
    expect(section).toContain(
      linked(BASE, 0, "N-000004", "", "–") +
        linked(
          SUB,
          1,
          "N-000002 (N-2)",
          "Wind",
          "approved",
          outdated("SR-e88fb3 (SR-1) points to an older version of N-000002 (N-2) (derives-from)"),
        ) +
        plain(1, "N-000003 (N-3)", "Old wind", "obsolete"),
    );
    // The child: no link, and its child below it.
    expect(section).toContain(
      plain(0, "SR-000008", "Show rain", "obsolete") + linked(AFTER, 1, "SR-000009", "Show hail", "draft"),
    );
    expect(section).not.toContain(`href="../elements/${OLD}.html"`);
    expect(section).not.toContain(`href="../elements/${GONE}.html"`);
  });
});

/** The rows of one part: level, title (without marks), whether it links, and whether it is marked repeated. */
const rowsOf = (part: string) =>
  [
    ...part.matchAll(
      /<li(?: style="--rq-level:(\d+)")?>(<a [^>]*>|<span>)<span>[^<]*<\/span><span>([^<]*)(.*?)<\/li>/g,
    ),
  ].map(([, level, open, title, rest]) => ({
    level: Number(level ?? 0),
    title: String(title).trim(),
    linked: String(open).startsWith("<a"),
    repeated: String(rest).includes("rq-repeated"),
  }));

/** The files of a workspace whose element is ROOT, for the bound over two levels. */
const twoLevelFiles = (): Record<string, string> => {
  const range = (from: number, to: number): number[] =>
    Array.from({ length: to - from + 1 }, (_, n) => n + from);
  const status = (n: number): string => (n === 1 ? "status: obsolete\n" : "");
  // Parents: P1..P59 and X above ROOT (P1 obsolete), Q_i above P_i, Q60 and X above P2: X lies on both levels.
  const X = uuid(500);
  // Children: C1..C59 and Y below ROOT (C1 obsolete), D_i below C_i, D60 below Y, Y also below C2.
  const Y = uuid(800);
  return {
    "metamodel/standard-model.yaml": METAMODEL,
    "requirements/SR-6328cee88fb3.md": element(
      ROOT,
      "system-requirement",
      `title: Show wind speed\n${derives(...range(1, 59).map((n) => uuid(400 + n)), X)}`,
    ),
    "requirements/SR-1d2e3f4a5b6c.md": element(ONE, "system-requirement", "title: Alone\n"),
    "needs/X.md": element(X, "need", "title: X\n"),
    ...Object.fromEntries(
      range(1, 59).map((n): [string, string] => [
        `needs/P${String(n)}.md`,
        element(
          uuid(400 + n),
          "need",
          `${status(n)}title: P${String(n)}\n${derives(uuid(600 + n), ...(n === 2 ? [uuid(660), X] : []))}`,
        ),
      ]),
    ),
    ...Object.fromEntries(
      range(1, 60).map((n): [string, string] => [
        `needs/Q${String(n)}.md`,
        element(uuid(600 + n), "need", `title: Q${String(n)}\n`),
      ]),
    ),
    "requirements/Y.md": element(Y, "system-requirement", `title: Y\n${derives(ROOT, uuid(702))}`),
    ...Object.fromEntries(
      range(1, 59).map((n): [string, string] => [
        `requirements/C${String(n)}.md`,
        element(uuid(700 + n), "system-requirement", `${status(n)}title: C${String(n)}\n${derives(ROOT)}`),
      ]),
    ),
    ...Object.fromEntries(
      range(1, 60).map((n): [string, string] => [
        `requirements/D${String(n)}.md`,
        element(
          uuid(900 + n),
          "system-requirement",
          `title: D${String(n)}\n${derives(n === 60 ? Y : uuid(700 + n))}`,
        ),
      ]),
    ),
  };
};

describe("html.export bounds the parents and children of a page by level (SR-232 AK5)", () => {
  it("[SR-232/AK-r9s3] shows every element of the first level and leaves out only elements of the second, an element of both levels counted once on the first and one with an invalid status counted", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements", files: twoLevelFiles() });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    await exported(workspace);
    const section = await sectionOf(fixture, ROOT);
    const parentsPart = section.slice(
      section.indexOf("<h3>Parents</h3>"),
      section.indexOf("<h3>Children</h3>"),
    );
    const childrenPart = section.slice(section.indexOf("<h3>Children</h3>"));
    const firstParents = [...Array.from({ length: 59 }, (_, n) => `P${String(n + 1)}`), "X"];
    const firstChildren = [...Array.from({ length: 59 }, (_, n) => `C${String(n + 1)}`), "Y"];

    // Parents: the topmost shown level (Q) at 0, the direct parents at 1. 60 + 60 elements, X once on level 1;
    // 100 shown: all 60 direct parents (the obsolete P1 among them, without a link) and 40 of the second level.
    const parents = rowsOf(parentsPart);
    expect(parents).toHaveLength(100);
    expect(new Set(parents.map((r) => r.title)).size).toBe(100);
    expect(parents.filter((r) => r.level === 1).map((r) => r.title)).toEqual(firstParents);
    expect(parents.filter((r) => r.level === 0)).toHaveLength(40);
    expect(parents.filter((r) => r.level === 0).every((r) => r.title.startsWith("Q"))).toBe(true);
    expect(parents.find((r) => r.title === "P1")).toMatchObject({ linked: false });
    expect(parentsPart).toContain(MORE);

    // Children (in the walk's order, not by number): 60 + 60 elements, Y once on level 0 (its place under C2 is a repetition); 100 shown: all 60 direct
    // children (the obsolete C1 among them, without a link) and 40 of the second level.
    const children = rowsOf(childrenPart);
    const placed = children.filter((r) => !r.repeated);
    expect(placed).toHaveLength(100);
    expect(new Set(placed.map((r) => r.title)).size).toBe(100);
    expect(placed.filter((r) => r.level === 0).map((r) => r.title)).toEqual(
      expect.arrayContaining(firstChildren),
    );
    expect(placed.filter((r) => r.level === 0)).toHaveLength(60);
    expect(placed.filter((r) => r.level === 1)).toHaveLength(40);
    expect(placed.filter((r) => r.level === 1).every((r) => r.title.startsWith("D"))).toBe(true);
    expect(children.filter((r) => r.repeated).map((r) => r.title)).toEqual(["Y"]);
    expect(children.find((r) => r.title === "C1")).toMatchObject({ linked: false });
    expect(childrenPart).toContain(MORE);
  });

  it("[SR-232/AK-r9s3] shows every incoming relation, also more than 100", async () => {
    const users = Array.from({ length: 120 }, (_, n) => uuid(2000 + n));
    const fixture = await createFixtureWorkspace({
      fixture: "SR-001/two-elements",
      files: {
        "metamodel/standard-model.yaml": METAMODEL,
        "requirements/SR-6328cee88fb3.md": element(ROOT, "system-requirement", "title: Show wind speed\n"),
        "requirements/SR-1d2e3f4a5b6c.md": element(ONE, "system-requirement", "title: Alone\n"),
        ...Object.fromEntries(
          users.map((id, n): [string, string] => [
            `requirements/U${String(n)}.md`,
            element(id, "system-requirement", `title: U${String(n)}\nbased-on:\n  - { id: ${ROOT} }\n`),
          ]),
        ),
      },
    });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    await exported(workspace);
    const section = await sectionOf(fixture, ROOT);
    const incoming = section.slice(section.indexOf("<h3>← Basis for</h3>"));
    expect(new Set(rowsOf(incoming).map((r) => r.title))).toEqual(
      new Set(users.map((_, n) => `U${String(n)}`)),
    );
    expect(rowsOf(incoming)).toHaveLength(120);
    expect(section).not.toContain("are shown");
  });
});
