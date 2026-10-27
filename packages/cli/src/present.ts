// The default output of the CLI for people (ADR-0009, #310): compact lines instead of the whole output
// object. Pure layout (ADR-0002 rule 3: no logic, no command named here): the form follows only the
// shape of the output, and whether the command reads or writes (its catalog `effect`), so every
// command of the catalog is covered. `--json` prints the output unchanged, `--yaml` all of it.
//
// - An element (an object with `shortId` and `title`) is one line, `SHORT-ID  status  title`, with its
//   identifier next to the short ID when it has one (`SR-3c90b0 (SR-036)`, #305) and its verification
//   status per view at the end, apart from its own status (`[verification: core verified]`, SR-031,
//   D-030; the children missing for SR-034 as `core open (missing SR-0000b2)`), then its validation
//   status (`[validation: validated]`, SR-038); a list of them one
//   such line per element. A read command (element.get) shows the element's details below its line,
//   a write command only the line.
// - A chain (`nodes` with `depth`, and `edges`) is an indented tree per direction with the depth in
//   front, its gaps, cycles and the edges to an element listed elsewhere marked.
// - A list of elements with a `tree` of their places (`depth`, `parent`; one per element, element.list
//   by hierarchy, SR-075 AK2) is indented two spaces per level; an element whose parent is not shown
//   before it (on an earlier page) names it, `[under X]`.
// - A list of findings other than `problems` (the hints of hint.list) is one line per finding: the
//   element's short ID, the kind, the message and the hint ID when it has one.
// - Every other value stays YAML. Problems come last, each once: those of the output and the hints
//   at an element it shows; then `No problems.`, or how many findings the output left out (`hidden`).
import { stringify } from "yaml";
import { hiddenOf, problemsEnd, renderProblem } from "./render.js";

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The parts that are not empty, two spaces apart. */
const join = (...parts: readonly string[]): string => parts.filter((part) => part !== "").join("  ");

const yamlOf = (value: unknown): string => stringify(value, { lineWidth: 0 });

const indent = (lines: readonly string[], by = "  "): string[] => lines.map((line) => `${by}${line}`);

/** `value` when it is a list, else an empty one. */
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

/** `value` as YAML lines. */
const yamlLines = (value: unknown): string[] => yamlOf(value).replace(/\n$/, "").split("\n");

/** An element as outputs name it: at least its short ID and title. */
const isElement = (value: unknown): value is Rec & { readonly shortId: string; readonly title: string } =>
  isRecord(value) && typeof value["shortId"] === "string" && typeof value["title"] === "string";

/** A finding: `common.schema.json#/$defs/problem`. */
const isProblem = (value: unknown): value is Rec =>
  isRecord(value) &&
  typeof value["code"] === "string" &&
  typeof value["severity"] === "string" &&
  typeof value["message"] === "string";

/**
 * A short ID with the identifier next to it when there is one (#305): `SR-3c90b0 (SR-036)`; the
 * short ID alone otherwise.
 */
const withIdentifier = (shortId: string, identifier: unknown): string =>
  text(identifier) === "" ? shortId : `${shortId} (${text(identifier)})`;

/** Names an element by repository and UUID: its short ID when the list has it, else its UUID. */
type Namer = (repository: string, id: string) => string;

/** A namer from the elements of a list. */
const namerOf =
  (elements: readonly Rec[]): Namer =>
  (repository, id) =>
    text(elements.find((e) => e["id"] === id && e["repository"] === repository)?.["shortId"]) || id;

/**
 * How an element points at the one before it on its path (trace.affected `via`, `path`, SR-024 AK1
 * "mit Weg und Abstand"): `[via derives-from from SR-00b002]`; without `from` when the one before
 * is the element asked for, the start of the path.
 */
const viaText = (element: Rec, name: Namer): string => {
  const via = element["via"];
  if (!isRecord(via)) {
    return "";
  }
  const how = via["kind"] === "reference" ? "reference" : text(via["key"]);
  const path = listOf(element["path"]).filter(isRecord);
  const before = path.length > 2 ? path[path.length - 2] : undefined;
  const from = before === undefined ? "" : ` from ${name(text(before["repository"]), text(before["id"]))}`;
  return `[via ${how}${from}]`;
};

/** Names a view of `verification` (`core` or a variant's UUID): the variant's short ID when the list has it. */
type ViewNamer = (view: string) => string;

/** A view namer from the elements of a list. */
const viewNamerOf =
  (elements: readonly Rec[]): ViewNamer =>
  (view) =>
    text(elements.find((e) => e["id"] === view)?.["shortId"]) || view;

/**
 * The verification status of an element per view (SR-031), apart from its own status:
 * `[verification: core verified, VAR-0000c1 open (missing SR-0000b2, SR-0000b3)]`; nothing for an
 * element without one. The children that are missing for an indirect verification (SR-034 AK2) follow
 * their view. A variant or child is named by its short ID from the list, else from the element's own
 * relations (its validity, its incoming relations), else by its UUID: the output gives UUIDs only
 * (`missingChildren`, the open export format), so a child that neither lists is shown as its UUID.
 */
const verificationText = (element: Rec, view: ViewNamer): string => {
  const entries = listOf(element["verification"]).filter(isRecord);
  const own = viewNamerOf(listOf(element["relations"]).filter(isRecord));
  const named = (id: string): string => {
    const listed = view(id);
    return listed === id ? own(id) : listed;
  };
  const entryText = (e: Rec): string => {
    const missing = listOf(e["missingChildren"]).map((id) => named(text(id)));
    return `${named(text(e["view"]))} ${text(e["status"])}${missing.length === 0 ? "" : ` (missing ${missing.join(", ")})`}`;
  };
  return entries.length === 0 ? "" : `[verification: ${entries.map(entryText).join(", ")}]`;
};

/** The validation status of an element (SR-038), apart from its verification status: `[validation: validated]`. */
const validationText = (element: Rec): string => {
  const validation = text(element["validation"]);
  return validation === "" ? "" : `[validation: ${validation}]`;
};

/**
 * `SHORT-ID  status  title`; an element with a distance has it in front, how it points behind and
 * its verification status per view last.
 */
const elementLine = (
  element: Rec & { readonly shortId: string; readonly title: string },
  name: Namer = namerOf([]),
  view: ViewNamer = viewNamerOf([]),
): string => {
  const distance = element["distance"];
  return join(
    typeof distance === "number" ? String(distance) : "",
    withIdentifier(element.shortId, element["identifier"]),
    text(element["status"]),
    element.title,
    viaText(element, name),
    verificationText(element, view),
    validationText(element),
  );
};

/** One relation of an element: `-> kind  SHORT-ID  title`, the target state when it is not available. */
const relationLine = (r: Rec): string => {
  const state = text(r["targetState"]);
  return join(
    `${r["direction"] === "in" ? "<-" : "->"} ${text(r["kind"])}`,
    text(r["shortId"]) === "" ? text(r["id"]) : withIdentifier(text(r["shortId"]), r["identifier"]),
    text(r["title"]),
    state === "available" || state === "" ? "" : `[${state}]`,
  );
};

/**
 * The details of an element below its line: what the line does not show, type and file first, the
 * relations one line each, the text last.
 */
const elementDetails = (element: Rec): string[] => {
  const {
    id,
    shortId: _shortId,
    identifier: _identifier,
    status: _status,
    title: _title,
    problems: _problems,
    verification: _verification,
    validation: _validation,
    repository,
    file,
    relations,
    text: body,
    ...rest
  } = element;
  const details: Record<string, unknown> = {
    id,
    type: rest["type"],
    file: `${text(repository)}:${text(file)}`,
    ...rest,
    relations: (Array.isArray(relations) ? relations : []).filter(isRecord).map(relationLine),
    text: body,
  };
  return indent(yamlLines(details));
};

/**
 * A hint of a list: the element's short ID with its identifier (else its file), the kind, the
 * message and the hint ID.
 */
const findingLine = (finding: Rec): string => {
  const shortId = text(finding["elementShortId"]);
  const element = shortId === "" ? "" : withIdentifier(shortId, finding["elementIdentifier"]);
  const hintId = text(finding["hintId"]);
  return join(
    element === "" ? text(finding["file"]) : element,
    text(finding["code"]),
    text(finding["message"]),
    hintId === "" ? "" : `hint: ${hintId}`,
  );
};

/** One output value, by its shape; the problems of an element it shows go to `lifted`. */
const valueLines = (key: string, value: unknown, details: boolean, lifted: unknown[]): string[] => {
  if (key === "incomplete" && typeof value === "boolean") {
    return value ? ["incomplete: true (a repository of the workspace is not on this machine)"] : [];
  }
  if (isElement(value)) {
    lifted.push(...listOf(value["problems"]));
    return [elementLine(value), ...(details ? elementDetails(value) : [])];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${key}: none`];
    }
    if (value.every(isElement)) {
      const name = namerOf(value);
      const view = viewNamerOf(value);
      return [`${key}:`, ...indent(value.map((element) => elementLine(element, name, view)))];
    }
    if (value.every(isProblem)) {
      return [`${key}:`, ...indent(value.map(findingLine))];
    }
    if (value.every((item) => typeof item === "string")) {
      return [`${key}:`, ...indent(value)];
    }
  }
  return yamlLines({ [key]: value });
};

/** A node of a chain (trace.chain `nodes`), as far as the tree reads it. */
interface ChainNode extends Rec {
  readonly id: string;
  readonly repository: string;
  readonly shortId: string;
  readonly title: string;
  readonly depth: number;
}

/** An edge of a chain: from the child that stores it (`source`) to its parent (`target`). */
interface ChainEdge extends Rec {
  readonly source: string;
  readonly sourceRepository: string;
  readonly target: string;
  readonly targetRepository: string;
  readonly direction: string;
  readonly cyclic: boolean;
}

/** What the tree of a chain reads (`trace.chain`); gaps and unresolved derivations are read loosely. */
interface Chain extends Rec {
  readonly nodes: readonly ChainNode[];
  readonly edges: readonly ChainEdge[];
}

const isChainNode = (value: unknown): value is ChainNode =>
  isElement(value) &&
  typeof value["id"] === "string" &&
  typeof value["repository"] === "string" &&
  typeof value["depth"] === "number";

const isChainEdge = (value: unknown): value is ChainEdge =>
  isRecord(value) &&
  ["source", "sourceRepository", "target", "targetRepository", "direction"].every(
    (key) => typeof value[key] === "string",
  ) &&
  typeof value["cyclic"] === "boolean";

/** A chain: nodes with an ID, repository and depth, and edges between them. */
const isChain = (output: Rec): output is Chain =>
  Array.isArray(output["nodes"]) &&
  Array.isArray(output["edges"]) &&
  output["nodes"].every(isChainNode) &&
  output["edges"].every(isChainEdge);

const nodeKey = (direction: string, repository: string, id: string): string =>
  JSON.stringify([direction, repository, id]);

/** The short ID of an element of the chain, its UUID when it is not on this page. */
const shortIdIn = (chain: Chain, repository: string, id: string): string =>
  chain.nodes.find((n) => n.id === id && n.repository === repository)?.shortId ?? id;

/**
 * A derivation the chain could not follow: `up from SHORT-ID  kind  SHORT-ID  title  [state]`, the
 * other end by short ID when it has one, else by UUID.
 */
const unresolvedLine = (item: Rec, chain: Chain): string => {
  const other = text(item["shortId"]);
  return join(
    `${text(item["direction"])} from ${shortIdIn(chain, text(item["fromRepository"]), text(item["from"]))}`,
    text(item["kind"]),
    other === "" ? text(item["id"]) : withIdentifier(other, item["identifier"]),
    text(item["title"]),
    `[${text(item["targetState"])}]`,
  );
};

/** A place in a tree list: its depth, and the element it is shown below. */
interface Place extends Rec {
  readonly depth: number;
}

const isPlace = (value: unknown): value is Place => isRecord(value) && typeof value["depth"] === "number";

type Placed = readonly [Rec & { readonly shortId: string; readonly title: string }, Place];

/** The elements of a tree list with their places, in order; undefined when `tree` does not fit them. */
const treeListOf = (
  elements: readonly unknown[],
  tree: readonly unknown[],
): readonly Placed[] | undefined => {
  if (elements.length !== tree.length) {
    return undefined;
  }
  const placed: Placed[] = [];
  for (const [index, place] of tree.entries()) {
    const element = elements[index];
    if (!isElement(element) || !isPlace(place)) {
      return undefined;
    }
    placed.push([element, place]);
  }
  return placed;
};

/** A tree list (see the file comment). */
const treeListLines = (placed: readonly Placed[]): string[] => {
  if (placed.length === 0) {
    return ["elements: none"];
  }
  const name = namerOf(placed.map(([element]) => element));
  const keyOf = (repository: unknown, id: unknown): string => JSON.stringify([text(repository), text(id)]);
  const before = new Set<string>();
  const lines = ["elements:"];
  for (const [element, place] of placed) {
    const parent = place["parent"];
    const away = isRecord(parent) && !before.has(keyOf(parent["repository"], parent["id"]));
    const under = away ? `[under ${name(text(parent["repository"]), text(parent["id"]))}]` : "";
    lines.push(`  ${"  ".repeat(place.depth)}${join(elementLine(element, name), under)}`);
    before.add(keyOf(element["repository"], element["id"]));
  }
  return lines;
};

/** The key of the root among the nodes; `root/up` and `root/down` hold its parents and children. */
const ROOT = "root";

/** Marks by node key: `JSON` of `[direction, repository, id]`, or `root`. */
type Marks = Map<string, string[]>;

const mark = (marks: Marks, key: string, text: string): void => {
  marks.set(key, [...(marks.get(key) ?? []), text]);
};

/** The marks of the gaps of each element of the chain, by `nodeKey("", repository, id)`. */
const gapMarks = (chain: Chain): Marks => {
  const gaps: Marks = new Map();
  for (const gap of listOf(chain["gaps"]).filter(isRecord)) {
    mark(
      gaps,
      nodeKey("", text(gap["repository"]), text(gap["id"])),
      `[gap: ${text(gap["kind"]).replace("-", " ")}]`,
    );
  }
  return gaps;
};

/**
 * The mark of an edge from another page on the node it leads to: `[under X]` for the edge the node
 * was reached by (`first`; never the root, which no edge reaches: an edge into it closes a cycle),
 * else `[cycle from X]` or `[also under X]`.
 */
const offPageMark = (first: boolean, cyclic: boolean, from: string): string =>
  first ? `[under ${from}]` : cyclic ? `[cycle from ${from}]` : `[also under ${from}]`;

/** The tree of a chain (see `treeOf`). */
interface Tree {
  readonly children: ReadonlyMap<string, readonly { readonly key: string; readonly node: ChainNode }[]>;
  /** References printed below the node an edge starts at (that node is on the page). */
  readonly references: ReadonlyMap<string, readonly string[]>;
  /** Marks on the node an edge leads to, for edges that start on another page. */
  readonly marks: Marks;
  readonly placed: ReadonlySet<string>;
}

/**
 * Tree edges: the first edge that reaches a node from a node of this page one level nearer the root.
 * Every other edge to it is a reference: below the node it starts at (`SHORT-ID  [cycle]`,
 * `SHORT-ID  [listed elsewhere]`), or, when that node is on another page, a mark on the node it leads
 * to: `[under X]` for the first edge to it (the one it was reached by), then `[cycle from X]` or
 * `[also under X]`.
 */
const treeOf = (chain: Chain, nodes: ReadonlyMap<string, ChainNode>, root: ChainNode | undefined): Tree => {
  const children = new Map<string, { readonly key: string; readonly node: ChainNode }[]>();
  const references: Marks = new Map();
  const marks: Marks = new Map();
  const placed = new Set<string>();
  const isRoot = (repository: string, id: string): boolean =>
    root?.repository === repository && root.id === id;
  for (const edge of chain.edges) {
    const [nearRepository, near, farRepository, far] =
      edge.direction === "up"
        ? [edge.sourceRepository, edge.source, edge.targetRepository, edge.target]
        : [edge.targetRepository, edge.target, edge.sourceRepository, edge.source];
    const nearKey = isRoot(nearRepository, near)
      ? `${ROOT}/${edge.direction}`
      : nodeKey(edge.direction, nearRepository, near);
    const nearNode = isRoot(nearRepository, near) ? root : nodes.get(nearKey);
    const farKey = isRoot(farRepository, far) ? ROOT : nodeKey(edge.direction, farRepository, far);
    const farNode = nodes.get(farKey);
    const farLabel = shortIdIn(chain, farRepository, far);
    const nearLabel = shortIdIn(chain, nearRepository, near);
    if (nearNode === undefined) {
      // The edge starts on another page: shown at the node it leads to.
      const first = farKey !== ROOT && !placed.has(farKey) && !marks.has(farKey);
      mark(marks, farKey, offPageMark(first, edge.cyclic, nearLabel));
    } else if (farNode !== undefined && !placed.has(farKey) && nearNode.depth === farNode.depth - 1) {
      placed.add(farKey);
      children.set(nearKey, [...(children.get(nearKey) ?? []), { key: farKey, node: farNode }]);
    } else {
      mark(references, nearKey, join(farLabel, edge.cyclic ? "[cycle]" : "[listed elsewhere]"));
    }
  }
  return { children, references, marks, placed };
};

/** The chain as a tree per direction: the root, then `parents:` and `children:` (see the file comment). */
const chainLines = (chain: Chain): string[] => {
  const width = String(Math.max(...chain.nodes.map((n) => n.depth), 0)).length;
  const gaps = gapMarks(chain);
  const keyOf = (node: ChainNode): string =>
    node.depth === 0 ? ROOT : nodeKey(text(node["direction"]), node.repository, node.id);
  const nodes = new Map(chain.nodes.map((node) => [keyOf(node), node]));
  const root = nodes.get(ROOT);
  const { children, references, marks, placed } = treeOf(chain, nodes, root);
  const line = (node: ChainNode): string =>
    join(
      elementLine(node),
      ...(gaps.get(nodeKey("", node.repository, node.id)) ?? []),
      node["expanded"] === false ? "[not expanded]" : "",
      ...(marks.get(keyOf(node)) ?? []),
    );
  // The depth in front, then two spaces per level of the tree below the first.
  const prefix = (depth: number, level: number): string =>
    `  ${String(depth).padStart(width)}  ${"  ".repeat(level - 1)}`;
  const lines: string[] = root === undefined ? [] : [line(root)];
  const walk = (key: string, depth: number, level: number): void => {
    for (const child of children.get(key) ?? []) {
      lines.push(`${prefix(child.node.depth, level + 1)}${line(child.node)}`);
      walk(child.key, child.node.depth, level + 1);
    }
    for (const reference of references.get(key) ?? []) {
      lines.push(`${prefix(depth + 1, level + 1)}${reference}`);
    }
  };
  for (const [direction, label] of [
    ["up", "parents:"],
    ["down", "children:"],
  ] as const) {
    const section = chain.nodes.filter((node) => node["direction"] === direction);
    if (section.length > 0) {
      lines.push(label);
      walk(`${ROOT}/${direction}`, 0, 0);
      // Nodes whose parent is on another page: not nested, the parent named by `[under X]`.
      for (const node of section) {
        const key = keyOf(node);
        if (!placed.has(key)) {
          lines.push(`${prefix(node.depth, 1)}${line(node)}`);
          walk(key, node.depth, 1);
        }
      }
    }
  }
  const unresolved = listOf(chain["unresolved"])
    .filter(isRecord)
    .map((item) => `  ${unresolvedLine(item, chain)}`);
  return [...lines, ...(unresolved.length === 0 ? [] : ["unresolved:", ...unresolved])];
};

/**
 * The output for people (see the file comment). `details`: show an element's details below its line
 * (commands that read).
 */
export function renderHuman(output: unknown, details = true): string {
  if (!isRecord(output)) {
    return output === undefined ? "" : yamlOf(output);
  }
  const { problems, ...rest } = output;
  const lines: string[] = [];
  const lifted: unknown[] = [];
  const chain = isChain(rest);
  if (chain) {
    lines.push(...chainLines(rest));
  }
  const shown = chain ? new Set(["root", "nodes", "edges", "gaps", "unresolved"]) : new Set<string>();
  const tree = rest["tree"];
  const treeList = Array.isArray(tree) ? treeListOf(listOf(rest["elements"]), tree) : undefined;
  if (treeList !== undefined) {
    lines.push(...treeListLines(treeList));
    shown.add("elements");
    shown.add("tree");
  }
  // The findings left out are said after the problems (`problemsEnd`).
  if (hiddenOf(rest) !== undefined) {
    shown.add("hidden");
  }
  for (const [key, value] of Object.entries(rest)) {
    if (!shown.has(key)) {
      lines.push(...valueLines(key, value, details, lifted));
    }
  }
  const total = rest["total"];
  // The page is the list of elements: the nodes of a chain, the elements of a list.
  const page = Object.values(rest).find(
    (value): value is unknown[] => Array.isArray(value) && value.length > 0 && value.every(isElement),
  );
  if (typeof total === "number" && page !== undefined && page.length < total) {
    lines.push(`Showing ${String(page.length)} of ${String(total)}; ask for more with --offset and --limit.`);
  }
  const seen = new Set<string>();
  const all = [...listOf(problems), ...lifted].filter((problem) => {
    const key = JSON.stringify(problem);
    const first = !seen.has(key);
    seen.add(key);
    return first;
  });
  const out = lines.map((line) => `${line}\n`).join("");
  const end = Array.isArray(problems) ? problemsEnd(rest, all.length) : "";
  return `${out}${all.map(renderProblem).join("")}${end}`;
}
