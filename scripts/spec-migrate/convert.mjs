#!/usr/bin/env node
// Migration of the spec from the Logseq export into a ReqSeq workspace (enabler #326).
//
// Usage: pnpm build && node scripts/spec-migrate/convert.mjs <export-dir> <workspace-dir>
//
// <export-dir> holds the preliminary export of the `spec-export` skill (needs/, system-requirements/,
// decisions/, glossary/, stages.json: one Markdown file per element, frontmatter `key: "json"`). The
// last one is in Git: `git archive decba1a spec | tar -x -C <dir>` gives it as <dir>/spec.
// <workspace-dir> must be empty or missing; the script never deletes or overwrites a file. To redo the
// migration in this repository, convert into an empty folder and move its content to spec/ in a PR.
//
// Step 1 writes the files: the workspace file, the metamodel of the spec (the standard model, D-037,
// with the spec's own additions, D-060), one element file per element, named by D-056, in a folder named
// like its type key (so `element create` puts new elements next to them), and one package per stage of
// stages.json (D-035, D-040). Element IDs are the Logseq UUIDs (all are UUID v4). The spec IDs (SR-036,
// D-047, N-001) go into the property `spec-id` with the meaning `identifier` (#305). Statuses follow the
// statuses of each type (#306): needs and system requirements draft, approved, obsolete; decisions draft,
// accepted, superseded; glossary terms only obsolete, so a current term has no status (#344). Statuses
// are copied from the export as people set them; the packages are new elements and get what
// element.create gives a new package, the initial status draft (D-030). Texts, titles and acceptance
// criteria are copied byte for byte. Relation targets are written as { id, title } without version.
//
// Step 2 lets ReqSeq itself (packages/core, built) fill in what only ReqSeq can compute (ADR-0005):
// it turns the inline mentions in the texts (`(SR-101)`) into `reqseq:` links with element.update, the
// linked elements before the elements that link to them, so every link gets the final version of its
// target (hint.confirm then finds nothing to confirm); then it gives every relation target its current
// version with relation.add (#302) and the packages with element.update. Mentions stay plain text where
// a link is not possible: in acceptance criteria and other properties (they are not Markdown text,
// ADR-0004, #379), within a ring of mentions (`ringPartners`, #378), a mention of the element itself,
// a mention of an ID the export does not have, and a test-name example such as `[SR-036/AK2]`. The
// script ends with a check that every text, without the link markup, is still the exported text, and
// prints the counts.
import fs from "node:fs";
import path from "node:path";
import { URL, pathToFileURL } from "node:url";

/** Folders of the preliminary export by type. */
const EXPORT_FOLDERS = {
  need: "needs",
  "system-requirement": "system-requirements",
  decision: "decisions",
  "glossary-term": "glossary",
};

/** Short-ID prefix of each type (metamodel below), used for the file name (D-056). */
const PREFIX = {
  need: "N",
  "system-requirement": "SR",
  decision: "D",
  "glossary-term": "GL",
  package: "PKG",
};

/**
 * The stage packages (D-035, D-040). The UUIDs were drawn once at random (D-017) and are fixed here,
 * so that a second run gives the same workspace.
 */
export const STAGES = [
  { key: "1", id: "46610a27-2866-47fb-bb8f-293faae4885f", title: "Stufe 1: Fundament" },
  { key: "2", id: "76455508-8047-4fdc-ba94-495751bd880b", title: "Stufe 2: Traceability" },
  { key: "3", id: "cf800f25-d03d-4092-8783-334263089f89", title: "Stufe 3: Oberfläche" },
  { key: "4", id: "5e69295a-2847-469f-9bd4-a11e20ceba9f", title: "Stufe 4: Nachweise" },
  { key: "5", id: "c44d8f37-ca09-4e36-8bcb-772f426a3e1a", title: "Stufe 5: Pakete, Baselines und Varianten" },
  { key: "6", id: "7755a224-01c9-4710-869a-7b1477fbd624", title: "Stufe 6: Austausch per ReqIF und Schutz" },
  { key: "querschnitt", id: "7a12a8c7-43e7-4349-9453-0ac2b6d5157d", title: "Querschnitt" },
];

/** The identifier of a stage package: `Stufe-3`, `Querschnitt` (trace-check and sr-issues use it). */
export const stageIdentifier = (key) =>
  /^\d+$/.test(key) ? `Stufe-${key}` : key[0].toUpperCase() + key.slice(1);

const stageText = (key) =>
  /^\d+$/.test(key)
    ? `System Requirements der Stufe ${key} der Umsetzung (D-035).\n`
    : "System Requirements, die für jede Funktion gelten. Jede Stufe prüft sie; abgeschlossen werden sie erst mit Stufe 6.\n";

const STATUS = {
  need: { Draft: "draft", Obsolete: "obsolete" },
  "system-requirement": { Draft: "draft", Obsolete: "obsolete" },
  decision: { Accepted: "accepted", Superseded: "superseded" },
};
const METHOD = {
  Test: "test",
  Inspektion: "inspection",
  Demonstration: "demonstration",
  Analyse: "analysis",
};
const AREA = { Fachlich: "fachlich", "Tool-Entwicklung": "tool-entwicklung" };
/** Logseq checkbox (`nicht_verwenden: true`) to the yes/no choice keys, as for `emergent`. */
const YES_NO = new Map([
  [true, "yes"],
  [false, "no"],
]);

/** Keys of the export that this script maps; any other key is a problem. */
const KNOWN = new Set([
  "id",
  "uuid",
  "type",
  "title",
  "re_status",
  "decision_status",
  "thema",
  "rationale",
  "akzeptanzkriterien",
  "based_on",
  "derives_from",
  "nachweismethode",
  "requirement_type",
  "supersedes",
  "abgrenzung",
  "bereich",
  "oberbegriff",
  "siehe_auch",
  "synonyme",
  "nicht_verwenden",
]);

// ---------- step 1: read the export ----------

/** One file of the preliminary export: `key: "json"` lines and `  - "json"` list items. */
export function parseExportFile(raw, file) {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) {
    throw new Error(`no frontmatter: ${file}`);
  }
  const props = {};
  let listKey = null;
  for (const line of m[1].split("\n")) {
    const item = /^ {2}- (.*)$/.exec(line);
    const kv = /^([a-z_]+):(?: (.*))?$/.exec(line);
    if (item && listKey) {
      props[listKey].push(JSON.parse(item[1]));
    } else if (kv && kv[2] === undefined) {
      listKey = kv[1];
      props[listKey] = [];
    } else if (kv) {
      listKey = null;
      props[kv[1]] = JSON.parse(kv[2]);
    } else if (line.trim() !== "") {
      throw new Error(`cannot read line in ${file}: ${line}`);
    }
  }
  // The export writes one blank line after the frontmatter; it separates and is not text (ADR-0004).
  return { props, text: m[2].replace(/^\n/, ""), file };
}

/** All elements and the stages of an export folder. */
export function readExport(dir) {
  const elements = [];
  for (const [type, folder] of Object.entries(EXPORT_FOLDERS)) {
    for (const f of fs.readdirSync(path.join(dir, folder)).sort()) {
      if (!f.endsWith(".md")) {
        continue;
      }
      const e = parseExportFile(fs.readFileSync(path.join(dir, folder, f), "utf8"), `${folder}/${f}`);
      if (e.props.type !== type) {
        throw new Error(`type ${e.props.type} in ${e.file}, expected ${type}`);
      }
      elements.push(e);
    }
  }
  const stages = JSON.parse(fs.readFileSync(path.join(dir, "stages.json"), "utf8"));
  return { elements, stages };
}

// ---------- step 1: write the workspace ----------

/** A JSON string is a valid YAML double-quoted scalar. */
const q = (s) => JSON.stringify(String(s));

/** File name by D-056: type prefix and the last 12 hex digits of the UUID. */
export const fileNameFor = (type, uuid) => `${PREFIX[type]}-${uuid.replace(/-/g, "").slice(-12)}.md`;

/** Path of an element file in the workspace: the folder is the type key. */
export const elementPath = (type, uuid) => `${type}/${fileNameFor(type, uuid)}`;

const MENTION = /\b(?:SR|D|N)-\d{3}\b/g;
// Code spans and Markdown links are kept as they are; mentions are looked for only between them.
const KEEP = /(`+)[\s\S]*?\1|\[[^\]\n]*\]\([^)\n]*\)/g;

/**
 * The text with each mention of a spec ID turned into `[SR-101](reqseq:<uuid>)`; counts go to `stats`.
 * The label stays the mention, so the text read without link markup is unchanged. `skip(id)` keeps a
 * mention as text (a ring, see `ringPartners`).
 */
export function linkMentions(text, selfId, uuidOf, stats, skip = () => false) {
  const linkPart = (part) =>
    part.replace(MENTION, (id, offset, whole) => {
      if (id === selfId) {
        stats.self += 1;
        return id;
      }
      if (whole.startsWith("/AK", offset + id.length)) {
        stats.example += 1;
        return id;
      }
      const uuid = uuidOf.get(id);
      if (uuid === undefined) {
        stats.unknown.push(`${selfId ?? "?"}: ${id}`);
        return id;
      }
      if (skip(id)) {
        stats.ring.push(`${selfId} -> ${id}`);
        return id;
      }
      stats.linked += 1;
      return `[${id}](reqseq:${uuid})`;
    });
  let out = "";
  let inFence = false;
  for (const line of text.split(/(?<=\n)/)) {
    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    if (inFence || /^ {0,3}(```|~~~)/.test(line)) {
      out += line;
      continue;
    }
    let last = 0;
    for (const keep of line.matchAll(KEEP)) {
      out += linkPart(line.slice(last, keep.index)) + keep[0];
      last = keep.index + keep[0].length;
    }
    out += linkPart(line.slice(last));
  }
  return out;
}

/** The spec IDs a text would link to, each once. */
export function mentionedIds(text, selfId, uuidOf) {
  const stats = { linked: 0, self: 0, example: 0, unknown: [], ring: [] };
  const linked = linkMentions(text, selfId, uuidOf, stats);
  return new Set([...linked.matchAll(/\[([^\]\n]*)\]\(reqseq:/g)].map((m) => m[1]));
}

/**
 * The strongly connected components of the mention graph (Tarjan), as a map from each ID in a ring
 * to the set of IDs of its ring. An inline reference stores the version of its target in the text,
 * and the text counts to the version (ADR-0005; the decision on #281 to leave it out is not
 * implemented yet, #378), so references that form a ring can never all be current: confirming one makes
 * the next one outdated. Mentions within a ring therefore stay text.
 */
export function ringPartners(graph) {
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const rings = new Map();
  let next = 0;
  const visit = (v) => {
    index.set(v, next);
    low.set(v, next);
    next += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) !== index.get(v)) {
      return;
    }
    const component = new Set();
    let w;
    do {
      w = stack.pop();
      onStack.delete(w);
      component.add(w);
    } while (w !== v);
    if (component.size > 1) {
      for (const member of component) {
        rings.set(member, component);
      }
    }
  };
  for (const v of graph.keys()) {
    if (!index.has(v)) {
      visit(v);
    }
  }
  return rings;
}

/**
 * The order to write the linked texts in: every element after the elements its text links to, so each
 * link gets the final version of its target and nothing needs confirming (the graph has no ring left).
 */
export function targetsFirst(graph) {
  const order = [];
  const seen = new Set();
  const visit = (v) => {
    seen.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!seen.has(w)) {
        visit(w);
      }
    }
    order.push(v);
  };
  for (const v of graph.keys()) {
    if (!seen.has(v)) {
      visit(v);
    }
  }
  return order;
}

/** Undo `linkMentions`: every `[label](reqseq:...)` becomes its label. */
export const unlink = (text) => text.replace(/\[([^\]\n]*)\]\(reqseq:[^)\n]*\)/g, "$1");

function statusLine(e, problems) {
  const p = e.props;
  if (p.type === "glossary-term") {
    return [];
  }
  const written = p.re_status ?? p.decision_status;
  const status = STATUS[p.type][written];
  if (status === undefined) {
    problems.push(`${p.id}: status ${written} has no key for ${p.type}`);
    return [];
  }
  return [`status: ${status}`];
}

function choiceLine(key, map, value, owner, problems) {
  if (value === undefined) {
    return [];
  }
  // A Map compares by value and type (only the booleans true and false are a checkbox); an object by key.
  const choice = map instanceof Map ? map.get(value) : Object.hasOwn(map, value) ? map[value] : undefined;
  if (choice === undefined) {
    problems.push(`${owner}: ${key} ${value} has no choice key`);
    return [`${key}: ${q(value)}`];
  }
  // `yes` and `no` are quoted, as ReqSeq writes them (YAML 1.1 reads them as booleans).
  return [`${key}: ${/^(yes|no)$/.test(choice) ? q(choice) : choice}`];
}

const listLines = (key, values) => (values.length ? [`${key}:`, ...values.map((v) => `  - ${v}`)] : []);
const textList = (key, value) => listLines(key, value === undefined ? [] : [].concat(value).map(q));

function propertyLines(e, problems) {
  const p = e.props;
  const owner = p.id ?? p.title;
  const requirementType = p.requirement_type === undefined ? undefined : p.requirement_type.toLowerCase();
  return [
    `title: ${q(p.title)}`,
    ...(p.id === undefined ? [] : [`spec-id: ${q(p.id)}`]),
    ...(p.rationale === undefined ? [] : [`rationale: ${q(p.rationale)}`]),
    ...(requirementType === undefined ? [] : [`requirement-type: ${requirementType}`]),
    ...textList("acceptance-criteria", p.akzeptanzkriterien),
    ...choiceLine("verification-method", METHOD, p.nachweismethode, owner, problems),
    ...(p.thema === undefined ? [] : [`topic: ${q(p.thema)}`]),
    ...choiceLine("area", AREA, p.bereich, owner, problems),
    ...textList("synonyms", p.synonyme),
    ...choiceLine("do-not-use", YES_NO, p.nicht_verwenden, owner, problems),
  ];
}

/** The lookups of the conversion: elements by spec ID and glossary terms by title. */
function indexElements(elements) {
  const bySpecId = new Map();
  const byTitle = new Map();
  for (const e of elements) {
    if (e.props.id !== undefined) {
      bySpecId.set(e.props.id, e);
    }
    if (e.props.type === "glossary-term") {
      byTitle.set(e.props.title, e);
    }
  }
  const uuidOf = new Map([...bySpecId].map(([id, e]) => [id, e.props.uuid]));
  for (const s of STAGES) {
    uuidOf.set(stageIdentifier(s.key), s.id);
  }
  return { bySpecId, byTitle, uuidOf };
}

/** The stage package of each spec ID in stages.json. */
function stagePackages(stages, problems) {
  const stageOf = new Map();
  for (const [key, ids] of Object.entries(stages)) {
    const stage = STAGES.find((s) => s.key === key);
    if (stage === undefined) {
      problems.push(`stages.json: stage ${key} has no package`);
      continue;
    }
    for (const id of ids) {
      stageOf.set(id, stage);
    }
  }
  return stageOf;
}

/** Relation lines without version; each target also goes into `ctx.relations` for step 2. */
function targetLines(e, kind, refs, lookup, ctx) {
  const out = [];
  for (const ref of refs) {
    const t = lookup.get(ref);
    if (t === undefined) {
      ctx.problems.push(`${e.props.id ?? e.props.title}: ${kind} target ${ref} not found`);
      continue;
    }
    out.push(`{ id: ${t.props.uuid}, title: ${q(t.props.title)} }`);
    ctx.relations.push({ source: e.props.uuid, kind, target: t.props.uuid });
  }
  return listLines(kind, out);
}

function packageLines(e, ctx) {
  const p = e.props;
  const stage = ctx.stageOf.get(p.id);
  if (stage === undefined) {
    if (p.type === "system-requirement") {
      ctx.problems.push(`${p.id}: no stage in stages.json`);
    }
    return [];
  }
  ctx.relations.push({ source: p.uuid, kind: "packages", target: stage.id });
  return listLines("packages", [`{ id: ${stage.id}, title: ${q(stage.title)} }`]);
}

/** The element file of one exported element. */
function elementFile(e, ctx) {
  const p = e.props;
  for (const k of Object.keys(p)) {
    if (!KNOWN.has(k)) {
      ctx.problems.push(`${p.id ?? p.title}: key ${k} is not mapped`);
    }
  }
  for (const ak of p.akzeptanzkriterien ?? []) {
    ctx.stats.inProperties += [...ak.matchAll(MENTION)].length;
  }
  const lines = [
    "---",
    `id: ${p.uuid}`,
    `type: ${p.type}`,
    ...statusLine(e, ctx.problems),
    ...propertyLines(e, ctx.problems),
    ...packageLines(e, ctx),
    ...targetLines(e, "derives-from", p.derives_from ?? [], ctx.bySpecId, ctx),
    ...targetLines(e, "based-on", p.based_on ?? [], ctx.bySpecId, ctx),
    ...targetLines(e, "supersedes", p.supersedes ?? [], ctx.bySpecId, ctx),
    ...targetLines(e, "broader-term", [].concat(p.oberbegriff ?? []), ctx.byTitle, ctx),
    ...targetLines(e, "distinct-from", p.abgrenzung ?? [], ctx.byTitle, ctx),
    ...targetLines(e, "see-also", p.siehe_auch ?? [], ctx.byTitle, ctx),
    "---",
  ];
  const text = withFinalNewline(e.text);
  return { content: `${lines.join("\n")}\n${text === "" ? "" : `\n${text}`}`, text };
}

const withFinalNewline = (text) => (text.endsWith("\n") || text === "" ? text : `${text}\n`);

/**
 * The linked texts of step 2, targets first. The mention graph is built by UUID; mentions within a
 * ring stay text (`ringPartners`).
 */
function planLinks(sources, uuidOf, stats) {
  const graph = new Map(
    sources.map((s) => [
      s.id,
      new Set([...mentionedIds(s.text, s.specId, uuidOf)].map((id) => uuidOf.get(id))),
    ]),
  );
  const rings = ringPartners(graph);
  const inRing = (id, target) => rings.get(id)?.has(target) ?? false;
  const acyclic = new Map(
    [...graph].map(([id, out]) => [id, new Set([...out].filter((t) => !inRing(id, t)))]),
  );
  const bySource = new Map(sources.map((s) => [s.id, s]));
  const texts = [];
  for (const id of targetsFirst(acyclic)) {
    const s = bySource.get(id);
    const linked = linkMentions(s.text, s.specId, uuidOf, stats, (specId) => inRing(id, uuidOf.get(specId)));
    if (linked !== s.text) {
      texts.push({ id, text: linked });
    }
  }
  return texts;
}

/** Builds every file of the workspace and the plan of step 2, without touching the disk. */
export function buildWorkspace({ elements, stages }) {
  const problems = [];
  const ctx = {
    ...indexElements(elements),
    stageOf: stagePackages(stages, problems),
    problems,
    relations: [],
    stats: { linked: 0, self: 0, example: 0, unknown: [], ring: [], inProperties: 0 },
  };
  const files = new Map();
  const sources = [];
  for (const e of elements) {
    const { content, text } = elementFile(e, ctx);
    files.set(elementPath(e.props.type, e.props.uuid), content);
    sources.push({ id: e.props.uuid, specId: e.props.id, text });
  }
  for (const s of STAGES) {
    const text = stageText(s.key);
    files.set(
      elementPath("package", s.id),
      `---\nid: ${s.id}\ntype: package\nstatus: draft\ntitle: ${q(s.title)}\nspec-id: ${q(stageIdentifier(s.key))}\n---\n\n${text}`,
    );
    sources.push({ id: s.id, specId: stageIdentifier(s.key), text });
  }
  const texts = planLinks(sources, ctx.uuidOf, ctx.stats);
  files.set("reqseq-workspace.yaml", WORKSPACE_FILE);
  files.set("metamodel/spec-model.yaml", METAMODEL);
  return { files, relations: ctx.relations, texts, stats: ctx.stats, problems };
}

/** Writes the files into an empty or missing folder; refuses to overwrite anything. */
export function writeFiles(dir, files) {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`${dir} is not empty; convert into an empty folder`);
  }
  for (const [rel, content] of files) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, { flag: "wx" });
  }
}

// ---------- step 2: ReqSeq fills in versions and links ----------

/**
 * Runs the plan of step 2 with ReqSeq's core (`core` is the module `@reqseq/core`): links, then the
 * versions of the inline references, then the versions of the relation targets, so that every stored
 * version is the one of the final content (a later text change would make an earlier one outdated).
 */
export async function fillWithReqSeq(dir, plan, core) {
  const workspace = new core.Workspace(path.resolve(dir));
  const run = (name, input) => core.invoke(name, input, { workspace });
  try {
    for (const { id, text } of plan.texts) {
      await run("element.update", { ref: id, text });
    }
    const outdated = (await run("hint.list", { kind: ["relation.outdated"] })).hints;
    const hintIds = outdated.flatMap((h) => (h.hintId === undefined ? [] : [h.hintId]));
    const confirmed = hintIds.length === 0 ? [] : (await run("hint.confirm", { hintIds })).confirmed;
    const added = [];
    for (const r of plan.relations) {
      if (r.kind === "packages") {
        // A relation-valued property is set with element.update, which fills in the version (#182).
        await run("element.update", { ref: r.source, set: { packages: [{ id: r.target }] } });
        added.push(r);
        continue;
      }
      const out = await run("relation.add", r);
      added.push(...(out.problems ?? []).filter((p) => p.code === "relation.version-added"));
    }
    const check = await run("workspace.check", {});
    return { confirmed: confirmed.length, versionsAdded: added.length, check };
  } finally {
    await workspace.close();
  }
}

/** Texts, titles and acceptance criteria of the workspace, compared with the export after step 2. */
export function verifyVerbatim(dir, exp) {
  const differences = [];
  for (const e of exp.elements) {
    const raw = fs.readFileSync(path.join(dir, elementPath(e.props.type, e.props.uuid)), "utf8");
    const body = raw.slice(raw.indexOf("\n---\n") + 5).replace(/^\n/, "");
    const text = withFinalNewline(e.text);
    if (unlink(body) !== text) {
      differences.push(`${e.props.id ?? e.props.title}: text differs`);
    }
    const head = raw.slice(0, raw.indexOf("\n---\n"));
    for (const value of [e.props.title, ...(e.props.akzeptanzkriterien ?? [])]) {
      if (!head.includes(q(value))) {
        differences.push(`${e.props.id ?? e.props.title}: ${value.slice(0, 40)}... not found verbatim`);
      }
    }
  }
  return differences;
}

const WORKSPACE_FILE = `reqseq-workspace: 1
name: ReqSeq specification
repositories:
  - name: spec
    url: ""
    main: true
metamodel:
  repository: spec
  path: metamodel
`;

const METAMODEL = `# Metamodel of the ReqSeq specification (enabler #326). It is the standard model (D-037,
# schemas/examples/metamodel/standard-model.yaml) with the spec's own additions (D-060: the glossary
# term and the decision statuses are not part of the standard model):
# - property spec-id with the meaning identifier (#305): SR-036, D-047, N-001, Stufe-3;
# - statuses per type (#306): decisions draft, accepted, superseded; glossary terms only obsolete, so a
#   term without status is current and element.supersede retires it (#344);
# - type glossary-term with its properties and relation kinds (from the Logseq graph ReqSeq).
# ReqSeq has no command that changes a metamodel: this file is changed by hand in a pull request.
reqseq-metamodel: 1

types:
  - key: need
    name: Need
    prefix: N
    meaning: need
    properties: [title, spec-id, rationale, topic]
    required: [title]
    statuses: [draft, approved, obsolete]
  - key: use-case
    name: Use Case
    prefix: UC
    properties: [title, spec-id, rationale]
    required: [title]
    statuses: [draft, approved, obsolete]
  - key: system-requirement
    name: System Requirement
    prefix: SR
    meaning: requirement
    properties:
      [
        title,
        spec-id,
        rationale,
        requirement-type,
        acceptance-criteria,
        validity,
        packages,
        emergent,
        verification-method,
        statement,
        source,
        source-identifier,
        import-date,
        delivery,
        topic,
      ]
    required: [title, requirement-type, acceptance-criteria]
    statuses: [draft, approved, obsolete]
  - key: decision
    name: Decision
    prefix: D
    properties: [title, spec-id, rationale]
    required: [title]
    statuses: [draft, accepted, superseded]
  - key: variant
    name: Variant
    prefix: VAR
    meaning: variant
    properties: [title, spec-id]
    required: [title]
    statuses: [draft, approved, obsolete]
  - key: package
    name: Package
    prefix: PKG
    meaning: package
    properties: [title, spec-id]
    required: [title]
    statuses: [draft, approved, obsolete]
  - key: glossary-term
    name: Glossary Term
    prefix: GL
    properties: [title, area, synonyms, do-not-use]
    required: [title]
    statuses: [obsolete]

properties:
  - key: title
    name: Title
    kind: text
    meaning: title
  - key: spec-id
    name: Spec ID
    kind: text
    meaning: identifier
  - key: rationale
    name: Rationale
    kind: text
  - key: requirement-type
    name: Requirement Type
    kind: choice
    content: true
    choices:
      - { key: functional, name: Functional }
      - { key: quality, name: Quality }
      - { key: performance, name: Performance }
      - { key: interface, name: Interface }
      - { key: constraint, name: Constraint }
  - key: acceptance-criteria
    name: Acceptance Criteria
    kind: text
    many: true
    content: true
  - key: validity
    name: Validity
    kind: relation
    many: true
    target-types: [variant]
    content: true
    meaning: validity
  - key: packages
    name: Package
    kind: relation
    many: true
    target-types: [package]
    meaning: packages
  - key: emergent
    name: Emergent
    kind: choice
    content: true
    meaning: emergent
    choices:
      - { key: "yes", name: "Yes" }
      - { key: "no", name: "No" }
  - key: verification-method
    name: Verification Method
    kind: choice
    content: true
    meaning: verification-method
    choices:
      - { key: test, name: Test }
      - { key: analysis, name: Analysis }
      - { key: inspection, name: Inspection }
      - { key: demonstration, name: Demonstration }
  - { key: statement, name: Statement, kind: text, meaning: statement }
  - { key: source, name: Source, kind: text, meaning: source }
  - { key: source-identifier, name: Source Identifier, kind: text, meaning: source-identifier }
  - { key: import-date, name: Import Date, kind: date, meaning: import-date }
  - { key: delivery, name: Delivery, kind: text, meaning: delivery }
  - { key: topic, name: Topic, kind: text }
  - key: area
    name: Area
    kind: choice
    choices:
      - { key: fachlich, name: Fachlich }
      - { key: tool-entwicklung, name: Tool-Entwicklung }
  - { key: synonyms, name: Synonyms, kind: text, many: true }
  - key: do-not-use
    name: Do not use
    kind: choice
    choices:
      - { key: "yes", name: "Yes" }
      - { key: "no", name: "No" }

relations:
  - key: refines
    name: Refines
    inverse-name: Refined by
    meaning: derivation
  - key: derives-from
    name: Derives from
    inverse-name: Derived by
    source-types: [system-requirement]
    target-types: [need, use-case, system-requirement]
    meaning: derivation
  - key: based-on
    name: Based on
    inverse-name: Basis for
    target-types: [decision]
  - key: supersedes
    name: Supersedes
    inverse-name: Superseded by
    meaning: replacement
  - key: replaces
    name: Replaces
    inverse-name: Replaced by
    source-types: [system-requirement]
    target-types: [system-requirement]
    meaning: replacement
  - key: excludes
    name: Excludes
    inverse-name: Excluded by
    source-types: [variant]
    target-types: [system-requirement]
    meaning: exclusion
  # Glossary relations (Logseq: Oberbegriff, Abgrenzung, Siehe auch). ReqSeq has no symmetric relation
  # kinds; each is stored in the direction the graph had it.
  - key: broader-term
    name: Broader term
    inverse-name: Narrower term
    source-types: [glossary-term]
    target-types: [glossary-term]
  - key: distinct-from
    name: Distinct from
    inverse-name: Distinct from
    source-types: [glossary-term]
    target-types: [glossary-term]
  - key: see-also
    name: See also
    inverse-name: See also
    source-types: [glossary-term]
    target-types: [glossary-term]

statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: approved, name: Approved }
  - { key: accepted, name: Accepted }
  - { key: obsolete, name: Obsolete, invalid: true }
  - { key: superseded, name: Superseded, invalid: true }
`;

// ---------- command line ----------

async function main([exportDir, workspaceDir]) {
  if (exportDir === undefined || workspaceDir === undefined) {
    console.error("usage: node scripts/spec-migrate/convert.mjs <export-dir> <workspace-dir>");
    return 2;
  }
  const exp = readExport(exportDir);
  const plan = buildWorkspace(exp);
  if (plan.problems.length > 0) {
    console.error(`${plan.problems.length} problems, nothing written:\n  ${plan.problems.join("\n  ")}`);
    return 1;
  }
  writeFiles(workspaceDir, plan.files);
  const coreEntry = new URL("../../packages/core/dist/index.js", import.meta.url);
  const result = await fillWithReqSeq(workspaceDir, plan, await import(coreEntry.href));
  const differences = verifyVerbatim(workspaceDir, exp);
  const { stats } = plan;
  console.log(
    [
      `${plan.files.size - 2} element files written to ${workspaceDir}`,
      `${stats.linked} mentions linked in ${plan.texts.length} texts; kept as text: ${stats.self} of the element itself, ${stats.example} test-name examples, ${stats.unknown.length} unknown IDs${stats.unknown.length ? ` (${stats.unknown.join(", ")})` : ""}, ${stats.ring.length} in rings, ${stats.inProperties} in acceptance criteria`,
      `${result.confirmed} inline references confirmed, ${result.versionsAdded} relation versions added`,
      `workspace check: ok ${result.check.ok}, ${result.check.problems.length} problems`,
      ...result.check.problems.map((p) => `  ${p.severity} ${p.code} ${p.file ?? ""}: ${p.message}`),
    ].join("\n"),
  );
  if (differences.length > 0) {
    console.error(`${differences.length} differences to the export:\n  ${differences.join("\n  ")}`);
    return 1;
  }
  return result.check.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
