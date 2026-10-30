// The default output of the CLI for people (ADR-0009, #310): compact lines instead of the whole output
// object. Pure layout (ADR-0002 rule 3: no logic, no command named here): the form follows only the
// shape of the output, and whether the command reads or writes (its catalog `effect`), so every
// command of the catalog is covered. `--json` prints the output unchanged, `--yaml` all of it.
//
// - An element (an object with `shortId` and `title`) is one line, `SHORT-ID  status  title`, with its
//   identifier next to the short ID when it has one (`SR-3c90b0 (SR-036)`, #305), `[emergent]` when it
//   is marked emergent (SR-035), and its verification status per view at the end, apart from its own
//   status (`[verification: core verified]`, SR-031, D-030; the children missing for SR-034 as
//   `core open (missing SR-0000b2)`), then its validation status (`[validation: validated]`, SR-038);
//   a list of them one such line per element. A read command (element.get) shows the element's details
//   below its line, a write command only the line.
// - A chain (`nodes` with `depth`, and `edges`) is an indented tree per direction with the depth in
//   front, its gaps, cycles and the edges to an element listed elsewhere marked. Its `evidence` is
//   indented below the element it belongs to (`evidenceLines`).
// - A list of elements with a `tree` of their places (`depth`, `parent`; one per element, element.list
//   by hierarchy, SR-075 AK2) is indented two spaces per level; an element whose parent is not shown
//   before it (on an earlier page) names it, `[under X]`.
// - A list of findings other than `problems` (the hints of hint.list) is one line per finding: the
//   element's short ID, the kind, the message and the hint ID when it has one.
// - A verification degree (`share` next to `counts`, SR-037), at any depth of a value printed as YAML,
//   shows its share as a percentage rounded down to one decimal (`degreePercent` of core, the rule of
//   every access, spec question #592 Q3): `share: 60 %`.
// - `names` (the elements an output gives elsewhere by UUID only, `common.schema.json#/$defs/elementName`,
//   #588) is not printed: those UUIDs print as the element instead, `SHORT-ID (IDENTIFIER)  title` in a
//   value printed as YAML (the lists of evidence.coverage, a variant `view`, the details of an element), `SHORT-ID (IDENTIFIER)` in
//   the verification status of an element line. A UUID that `names` leaves out stays as it is.
// - Every other value stays YAML. Problems come last, each once: those of the output and the hints
//   at an element it shows; then `No problems.`, or how many findings the output left out (`hidden`).
import { degreePercent, degreeShareOf } from "@reqseq/core";
import { stringify } from "yaml";
import { hiddenOf, problemsEnd, renderProblem } from "./render.js";

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The parts that are not empty, two spaces apart. */
const join = (...parts: readonly string[]): string => parts.filter((part) => part !== "").join("  ");

// No anchors and aliases: a record that is both an execution and `last` of a test case reads in full twice.
const yamlOf = (value: unknown): string => stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });

const indent = (lines: readonly string[], by = "  "): string[] => lines.map((line) => `${by}${line}`);

/** `value` when it is a list, else an empty one. */
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

/** `value` as YAML lines. */
const yamlLines = (value: unknown): string[] => yamlOf(value).replace(/\n$/, "").split("\n");

/** `value` with the share of every verification degree in it, in objects and lists, as its percentage (SR-037). */
const withPercent = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(withPercent);
  }
  if (!isRecord(value)) {
    return value;
  }
  const share = degreeShareOf(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "share" && share !== undefined ? degreePercent(share) : withPercent(item),
    ]),
  );
};

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

/** An element as `names` gives it (`common.schema.json#/$defs/elementName`, #588). */
const isElementName = (value: unknown): value is Rec & { readonly shortId: string; readonly title: string } =>
  isElement(value) && typeof value["id"] === "string" && typeof value["repository"] === "string";

/** The elements of `names` by UUID (the first of a UUID), when the output has them (#588). */
type Names = ReadonlyMap<string, Rec & { readonly shortId: string; readonly title: string }>;

/** `names` of an output by UUID (core gives each UUID once); empty when it has none or it is not a list of names. */
const namesIn = (output: Rec): Names => {
  const names = output["names"];
  if (!Array.isArray(names) || !names.every(isElementName)) {
    return new Map();
  }
  return new Map(names.map((name) => [text(name["id"]), name] as const));
};

/** A named element in a line: `SHORT-ID (IDENTIFIER)  title`. */
const nameText = (name: Rec & { readonly shortId: string; readonly title: string }): string =>
  join(withIdentifier(name.shortId, name["identifier"]), name.title);

/** `value` with every string that is a UUID of `names` as the element it names (`nameText`), in objects and lists. */
const withNames = (value: unknown, names: Names): unknown => {
  if (names.size === 0) {
    return value;
  }
  if (typeof value === "string") {
    const name = names.get(value);
    return name === undefined ? value : nameText(name);
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => withNames(item, names));
  }
  return isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withNames(item, names)]))
    : value;
};

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

/**
 * A view namer from the elements of a list; the elements of `names` first, with their identifier
 * (`SR-3c90b0 (SR-036)`, #588).
 */
const viewNamerOf =
  (elements: readonly Rec[], names: Names = new Map()): ViewNamer =>
  (view) => {
    const name = names.get(view);
    return name === undefined
      ? text(elements.find((e) => e["id"] === view)?.["shortId"]) || view
      : withIdentifier(name.shortId, name["identifier"]);
  };

/**
 * The verification status of an element per view (SR-031), apart from its own status:
 * `[verification: core verified, VAR-0000c1 open (missing SR-0000b2, SR-0000b3)]`; nothing for an
 * element without one. The children that are missing for an indirect verification (SR-034 AK2) follow
 * their view. A variant or child is named by its short ID from the list, else from the element's own
 * relations (its validity, its incoming relations), else by its UUID: the output gives UUIDs only
 * (`missingChildren`, the open export format), so a child that neither lists is shown as its UUID. An
 * output that names them in `names` (#588) gives them all (`view` takes those first).
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

/** `[emergent]` for an element marked emergent (SR-035), next to the `open` it explains; else nothing. */
const emergentText = (element: Rec): string => (element["emergent"] === true ? "[emergent]" : "");

/**
 * `SHORT-ID  status  title`; an element with a distance has it in front, how it points behind, its
 * mark emergent and its verification status per view last.
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
    emergentText(element),
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
 * relations one line each, the text last. The UUIDs of `names` in the values other than the
 * properties (shown as stored) print as the elements they name (`replacedBy`, `excludedBy`, SR-046 AK3).
 */
const elementDetails = (element: Rec, names: Names): string[] => {
  const {
    id,
    shortId: _shortId,
    identifier: _identifier,
    status: _status,
    title: _title,
    problems: _problems,
    verification: _verification,
    validation: _validation,
    emergent: _emergent,
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
    ...Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [
        key,
        key === "properties" ? value : withNames(value, names),
      ]),
    ),
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

/**
 * One output value, by its shape; the problems of an element it shows go to `lifted`. The UUIDs of
 * `names` print as the elements they name.
 */
const valueLines = (
  key: string,
  value: unknown,
  details: boolean,
  lifted: unknown[],
  names: Names = new Map(),
): string[] => {
  if (key === "incomplete" && typeof value === "boolean") {
    return value ? ["incomplete: true (a repository of the workspace is not on this machine)"] : [];
  }
  if (isElement(value)) {
    lifted.push(...listOf(value["problems"]));
    return [
      elementLine(value, namerOf([]), viewNamerOf([], names)),
      ...(details ? elementDetails(value, names) : []),
    ];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${key}: none`];
    }
    if (value.every(isElement)) {
      const name = namerOf(value);
      const view = viewNamerOf(value, names);
      return [`${key}:`, ...indent(value.map((element) => elementLine(element, name, view)))];
    }
    if (value.every(isProblem)) {
      return [`${key}:`, ...indent(value.map(findingLine))];
    }
    if (value.every((item) => typeof item === "string")) {
      return [`${key}:`, ...indent(value)];
    }
  }
  return yamlLines({ [key]: withNames(withPercent(value), names) });
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

/** The evidence items of a chain (`evidence`) by `nodeKey("", repository, id)`, read loosely. */
const evidenceByNode = (chain: Chain): ReadonlyMap<string, Rec> =>
  new Map(
    listOf(chain["evidence"])
      .filter(isRecord)
      .map((item) => [nodeKey("", text(item["repository"]), text(item["id"])), item]),
  );

/** Where the Beleg of a record is: its `evidence`, else its record file and line (a JUnit execution). */
const belegOf = (record: Rec): string => {
  const evidence = text(record["evidence"]);
  if (evidence !== "" || text(record["file"]) === "") {
    return evidence;
  }
  const line = record["line"];
  return `${text(record["repository"])}/${text(record["file"])}${typeof line === "number" ? `:${String(line)}` : ""}`;
};

/** A record as one line: date, method (`withMethod`), result, item, Beleg and variant. */
const recordLine = (record: Rec, withMethod: boolean): string =>
  join(
    text(record["date"]),
    withMethod ? text(record["method"]) : "",
    text(record["result"]),
    text(record["item"]),
    belegOf(record),
    text(record["variant"]) === "" ? "" : `[variant ${text(record["variant"])}]`,
  );

/**
 * The evidence below an element of a chain (SR-033): per test case `test case  CLASS › NAME`, marked
 * `[not executed]` when it has no execution, with one line per execution below it (date, result,
 * item, Beleg); then one line per record without a test case, `record  DATE  METHOD  RESULT  ITEM
 * BELEG`. `item` gives the lines of the test cases and records, `under` those of the executions.
 */
const evidenceLines = (item: Rec, at: string, under: string): string[] => {
  const lines: string[] = [];
  for (const test of listOf(item["testCases"]).filter(isRecord)) {
    const className = text(test["className"]);
    const name = className === "" ? text(test["name"]) : `${className} › ${text(test["name"])}`;
    lines.push(`${at}${join("test case", name, test["executed"] === false ? "[not executed]" : "")}`);
    for (const execution of listOf(test["executions"]).filter(isRecord)) {
      lines.push(`${under}${recordLine(execution, false)}`);
    }
  }
  for (const record of listOf(item["records"]).filter(isRecord)) {
    lines.push(`${at}${join("record", recordLine(record, true))}`);
  }
  return lines;
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
  const evidence = evidenceByNode(chain);
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
  // The evidence of a node of the downward chain (or the root) one level below it.
  const evidenceOf = (node: ChainNode, level: number): void => {
    const item = node["direction"] === "up" ? undefined : evidence.get(nodeKey("", node.repository, node.id));
    if (item !== undefined) {
      const at = prefix(node.depth + 1, level + 1);
      lines.push(...evidenceLines(item, at, `${" ".repeat(at.length)}  `));
    }
  };
  if (root !== undefined) {
    evidenceOf(root, 0);
  }
  const walk = (key: string, depth: number, level: number): void => {
    for (const child of children.get(key) ?? []) {
      lines.push(`${prefix(child.node.depth, level + 1)}${line(child.node)}`);
      evidenceOf(child.node, level + 1);
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
          evidenceOf(node, 1);
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
 * The note on a page shorter than `total`. The page is the list of elements: the nodes of a chain, the
 * elements of a list (never `names`).
 */
const pageNote = (output: Rec): string[] => {
  const total = output["total"];
  const page = Object.entries(output).find(
    (entry): entry is [string, unknown[]] =>
      entry[0] !== "names" && Array.isArray(entry[1]) && entry[1].length > 0 && entry[1].every(isElement),
  )?.[1];
  return typeof total === "number" && page !== undefined && page.length < total
    ? [`Showing ${String(page.length)} of ${String(total)}; ask for more with --offset and --limit.`]
    : [];
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
  const shown = chain
    ? new Set(["root", "nodes", "edges", "gaps", "evidence", "unresolved"])
    : new Set<string>();
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
  // The elements named by UUID elsewhere name those UUIDs instead of being printed (#588).
  const names = namesIn(rest);
  if (names.size > 0) {
    shown.add("names");
  }
  for (const [key, value] of Object.entries(rest)) {
    if (!shown.has(key)) {
      lines.push(...valueLines(key, value, details, lifted, names));
    }
  }
  lines.push(...pageNote(rest));
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
