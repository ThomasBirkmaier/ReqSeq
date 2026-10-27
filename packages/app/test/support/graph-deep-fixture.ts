// A generated workspace for the deep timing of SR-111 AK6 (a graph of 500 nodes is laid out within a
// second), on top of fixtures/SR-111/graph (its metamodel and workspace file). It has three needs, each
// the root of a whole chain of exactly 500 nodes that depth 2 already reaches, with the link profile of
// the whole chain over every kind of the first need of the N-036 workspace (#500):
// - level -1: 2 decisions the need is based on;
// - level -2: 14 decisions, 8 by `based-on` and 6 by inline references from level -1;
// - level 1: 50 system requirements with 53 links to the need (10 `derives-from`, 16 `refines`, 27
//   inline references);
// - level 2: 433 system requirements with 505 links to level 1 (97 `derives-from`, 198 `refines`, 210
//   inline references);
// - links within a level: 21 on level 1 and 242 on level 2 (8 `derives-from`, the rest `refines` and
//   inline references; N-036's 4 `based-on` among them are `refines` here, since only decisions are
//   based on);
// - links against the levels: 42 from level 1 to level 2, 3 from level -2 to level 2;
// - long links: 4 `based-on` from level 2 to levels -1 and -2;
// 886 links in all. The types are simplified to needs, decisions and system requirements; the link
// profile is what costs the layout. Every link stores the current version of its target: the files are
// written with an old version, and `logreq hint confirm` writes the current ones (SR-027).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./graph-fixture.js";

const FIXTURE = fileURLToPath(new URL("../../../../fixtures/SR-111/graph/", import.meta.url));

const OLD = "n1:0000000000000000";
/** Titles no other title contains, so that Ctrl+P finds the need first. */
const ROOT_TITLES = ["Barometer", "Hygrometer", "Pyranometer"];
const ABOVE = 2;
const TOP = 14;
const MEMBERS = 50;
const LEAVES = 433;

export interface GraphDeepFixture {
  /** The workspace folder (launchApp copies it). */
  readonly folder: string;
  /** The three needs: UUID and title. */
  readonly roots: readonly { readonly id: string; readonly title: string }[];
  cleanup(): Promise<void>;
}

type Kind = "derives-from" | "refines" | "based-on" | "reference";

/** One element of a chain: `part` 0 the need, 1 level -1, 2 level -2, 3 level 1, 4 level 2. */
interface Element {
  readonly part: number;
  readonly index: number;
}

const uuid = (root: number, { part, index }: Element): string =>
  `5e111a7d-2b4f-4c61-9d08-d${String(root)}${String(part)}${index.toString(16).padStart(9, "0")}`;

const NEED: Element = { part: 0, index: 0 };
const decision = (index: number): Element => ({ part: 1, index });
const basis = (index: number): Element => ({ part: 2, index });
const requirement = (index: number): Element => ({ part: 3, index });
const detail = (index: number): Element => ({ part: 4, index });

const titleOf = (root: number, element: Element): string => {
  const chain = String(root);
  switch (element.part) {
    case 0:
      return ROOT_TITLES[root - 1] ?? "";
    case 1:
      return `Decision ${String(element.index)} of chain ${chain}`;
    case 2:
      return `Basis ${String(element.index)} of chain ${chain}`;
    case 3:
      return `Requirement ${String(element.index)} of chain ${chain}`;
    default:
      return `Detail ${String(element.index)} of chain ${chain}`;
  }
};

type Link = [Element, Kind, Element];

/** `count` links, the `index`-th from `source(index)` with `kind(index)` to `target(index)`. */
const series = (
  count: number,
  source: (index: number) => Element,
  kind: (index: number) => Kind,
  target: (index: number) => Element,
): Link[] => Array.from({ length: count }, (_, index): Link => [source(index), kind(index), target(index)]);

/** The kind of the `index`-th link: the kind of the first bound it is below, else `rest`. */
const by =
  (bounds: readonly (readonly [number, Kind])[], rest: Kind) =>
  (index: number): Kind =>
    bounds.find(([bound]) => index < bound)?.[1] ?? rest;

/** A link to another element of level 2 (no link to itself: index 70 would be one). */
const sibling = (index: number): Element => {
  const other = (index * 7 + 13) % LEAVES;
  return detail(other === index ? other + 1 : other);
};

/** The links of one chain. */
const linksOf = (): Link[] => [
  // Level -1 and -2.
  ...series(
    ABOVE,
    () => NEED,
    () => "based-on",
    decision,
  ),
  ...series(
    TOP,
    (index) => decision(index < 4 || (index >= 8 && index < 11) ? 0 : 1),
    by([[8, "based-on"]], "reference"),
    basis,
  ),
  // Level 1: 53 links to the need.
  ...series(
    MEMBERS,
    requirement,
    by(
      [
        [10, "derives-from"],
        [26, "refines"],
      ],
      "reference",
    ),
    () => NEED,
  ),
  ...series(
    3,
    requirement,
    () => "reference",
    () => NEED,
  ),
  // Level 2: 505 links to level 1.
  ...series(
    LEAVES,
    detail,
    by(
      [
        [97, "derives-from"],
        [295, "refines"],
      ],
      "reference",
    ),
    (index) => requirement(index % MEMBERS),
  ),
  ...series(
    72,
    detail,
    () => "reference",
    (index) => requirement((index + 7) % MEMBERS),
  ),
  // Within a level: 21 on level 1, 242 on level 2.
  ...series(
    21,
    requirement,
    by(
      [
        [4, "derives-from"],
        [13, "refines"],
      ],
      "reference",
    ),
    (index) => requirement(index + 1),
  ),
  ...series(
    242,
    detail,
    (index) => (index < 4 ? "derives-from" : index % 2 === 0 ? "refines" : "reference"),
    sibling,
  ),
  // Against the levels: 42 from level 1 to level 2, 3 from level -2 to level 2.
  ...series(
    42,
    (index) => requirement(index % MEMBERS),
    (index) => (index % 2 === 0 ? "refines" : "reference"),
    (index) => detail((index * 10 + 5) % LEAVES),
  ),
  ...series(
    3,
    basis,
    () => "reference",
    (index) => detail((index + 1) * 100),
  ),
  // Long: 4 from level 2 to levels -1 and -2.
  [detail(400), "based-on", decision(0)],
  [detail(401), "based-on", decision(1)],
  [detail(402), "based-on", basis(0)],
  [detail(403), "based-on", basis(8)],
];

const typeOf = (element: Element): string =>
  element.part === 0 ? "need" : element.part < 3 ? "decision" : "system-requirement";

const fileOf = (root: number, element: Element, links: readonly Link[]): string => {
  const own = links.filter(([source]) => source.part === element.part && source.index === element.index);
  const relations = (["derives-from", "refines", "based-on"] as const).flatMap((kind) => {
    const targets = own.filter(([, linkKind]) => linkKind === kind).map(([, , target]) => target);
    return targets.length === 0
      ? []
      : [
          `${kind}:`,
          ...targets.map(
            (target) => `  - { id: ${uuid(root, target)}, version: ${OLD}, title: ${titleOf(root, target)} }`,
          ),
        ];
  });
  const references = own
    .filter(([, kind]) => kind === "reference")
    .map(([, , target]) => `See [${titleOf(root, target)}](logreq:${uuid(root, target)}?version=${OLD}).`);
  return [
    "---",
    `id: ${uuid(root, element)}`,
    `type: ${typeOf(element)}`,
    `status: ${element.part === 0 || element.part > 2 ? "draft" : "approved"}`,
    `title: ${titleOf(root, element)}`,
    ...(element.part > 2
      ? ["requirement-type: functional", "acceptance-criteria:", "  - Given the station runs, then it works."]
      : []),
    ...relations,
    "---",
    "",
    ...references,
    "",
  ].join("\n");
};

/** Writes the workspace and stores the current versions in its links. */
export const writeGraphDeepFixture = async (): Promise<GraphDeepFixture> => {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-graph-deep-fixture-")));
  const folder = path.join(base, "workspace");
  await fs.mkdir(folder);
  await fs.cp(path.join(FIXTURE, "metamodel"), path.join(folder, "metamodel"), { recursive: true });
  await fs.copyFile(path.join(FIXTURE, "logreq-workspace.yaml"), path.join(folder, "logreq-workspace.yaml"));
  const links = linksOf();
  const elements = [
    NEED,
    ...Array.from({ length: ABOVE }, (_, index) => decision(index)),
    ...Array.from({ length: TOP }, (_, index) => basis(index)),
    ...Array.from({ length: MEMBERS }, (_, index) => requirement(index)),
    ...Array.from({ length: LEAVES }, (_, index) => detail(index)),
  ];
  const roots = [1, 2, 3].map((root) => ({ id: uuid(root, NEED), title: titleOf(root, NEED) }));
  for (const root of [1, 2, 3]) {
    const dir = path.join(folder, "chains", String(root));
    await fs.mkdir(dir, { recursive: true });
    for (const element of elements) {
      await fs.writeFile(
        path.join(dir, `E-${String(element.part)}-${String(element.index)}.md`),
        fileOf(root, element, links),
      );
    }
  }
  const hints = JSON.parse(
    await cli(folder, ["hint", "list", "--input", '{"kind":["relation.outdated"]}']),
  ) as {
    readonly hints: readonly { readonly hintId?: string }[];
  };
  const hintIds = hints.hints.flatMap((hint) => (hint.hintId === undefined ? [] : [hint.hintId]));
  // Too long for a command line: the input goes in a file next to the workspace.
  const input = path.join(base, "confirm.json");
  await fs.writeFile(input, JSON.stringify({ hintIds }));
  await cli(folder, ["hint", "confirm", "--input", `@${input}`]);
  return { folder, roots, cleanup: () => fs.rm(base, { recursive: true, force: true, maxRetries: 3 }) };
};
