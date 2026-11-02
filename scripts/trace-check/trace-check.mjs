#!/usr/bin/env node
// Checks the chain SR -> test -> verification record (D-050).
// Usage: node scripts/trace-check/trace-check.mjs [--require SR-001,SR-002] [--stage 1]
//        [--pr-body <file>] [--enabler] [--report <file>]
//
// The spec is the ReqSeq workspace in spec/ (D-064, #326). A system requirement is an element file of
// type `system-requirement`, found anywhere below spec/ by its frontmatter (ADR-0004); its spec ID
// (SR-036) is the property with the meaning `identifier` of the metamodel in spec/metamodel/. A
// stage is the package whose identifier is `Stufe-<n>` (or the identifier given, e.g. `Querschnitt`);
// its system requirements are those that name it in `packages`. Statuses marked invalid in the
// metamodel (obsolete) give a warning when a test still names the SR.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";

const SKIP = new Set(["node_modules", ".git", "dist", "out", "coverage", "spec", ".reqseq"]);
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|mjs)$|^test_.*\.py$|_test\.py$/;
// The cross-access scenarios of each command, in the modules that cross-access.test.ts loads with its
// glob `./cross-access/scenarios/*/*.ts`: exactly one folder deep (#527).
const SCENARIO_MODULE = /(^|\/)test\/cross-access\/scenarios\/[^/]+\/[^/]+\.ts$/;

/** The frontmatter of a Markdown file as an object, or undefined when it has none that parses. */
export function frontmatter(text) {
  const m = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) {
    return undefined;
  }
  try {
    const data = YAML.parse(m[1]);
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      entry.name !== ".git" &&
      entry.name !== ".reqseq" &&
      entry.name !== "node_modules"
    ) {
      out.push(...markdownFiles(p));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

/** The metamodel facts trace-check needs: the identifier key and the invalid statuses. */
/**
 * The metamodel folder the workspace file names (`metamodel: { repository, path }`), resolved like ReqSeq
 * does: the main repository is the folder of the workspace file, another one lies at its `path`
 * (default `../<name>`) relative to it.
 */
export function metamodelFolder(specDir) {
  const ws = YAML.parse(fs.readFileSync(path.join(specDir, "reqseq-workspace.yaml"), "utf8")) ?? {};
  const repos = Array.isArray(ws.repositories) ? ws.repositories : [];
  const repo = repos.find((r) => r?.name === ws.metamodel?.repository);
  if (repo === undefined || typeof ws.metamodel?.path !== "string") {
    throw new Error(`the workspace file in ${specDir} names no metamodel folder in one of its repositories`);
  }
  const main = repo.main === true || repos.length === 1;
  return path.join(specDir, main ? "." : (repo.path ?? `../${repo.name}`), ws.metamodel.path);
}

export function readMetamodel(specDir) {
  const dir = metamodelFolder(specDir);
  let identifier;
  const invalid = new Set();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!f.endsWith(".yaml")) {
      continue;
    }
    const model = YAML.parse(fs.readFileSync(path.join(dir, f), "utf8")) ?? {};
    identifier = (model.properties ?? []).find((p) => p.meaning === "identifier")?.key ?? identifier;
    for (const s of model.statuses ?? []) {
      if (s.invalid === true) {
        invalid.add(s.key);
      }
    }
  }
  if (identifier === undefined) {
    throw new Error(`no property with the meaning identifier in ${dir}`);
  }
  return { identifier, invalid };
}

/**
 * The system requirements of the workspace by spec ID, and the packages by identifier (lower case).
 * An SR: { id, uuid, status, invalid, criteria, method, packages: [uuid], file }.
 */
export function readSpec(specDir) {
  const { identifier, invalid } = readMetamodel(specDir);
  const srs = new Map();
  const packages = new Map();
  const duplicates = [];
  const seen = new Set();
  for (const file of markdownFiles(specDir)) {
    const fm = frontmatter(fs.readFileSync(file, "utf8"));
    const id = fm?.[identifier];
    if (fm === undefined || typeof id !== "string") {
      continue;
    }
    if (fm.type === "package") {
      packages.set(id.toLowerCase(), String(fm.id));
    } else if (fm.type === "system-requirement") {
      // Identifiers compare in any case (#305).
      if (seen.has(id.toLowerCase())) {
        duplicates.push(id);
      }
      seen.add(id.toLowerCase());
      srs.set(id, {
        id,
        uuid: String(fm.id),
        status: fm.status,
        invalid: invalid.has(fm.status),
        criteria: Array.isArray(fm["acceptance-criteria"]) ? fm["acceptance-criteria"] : [],
        method: fm["verification-method"],
        packages: (Array.isArray(fm.packages) ? fm.packages : []).map((p) => String(p?.id)),
        file: repoPath(specDir, file),
      });
    }
  }
  return { srs, packages, duplicates };
}

/** A path relative to base with `/` on every system, as the report and the errors name it. */
function repoPath(base, file) {
  return path.relative(base, file).split(path.sep).join("/");
}

/** The system requirements of a stage: `--stage 3` is the package `Stufe-3`, any other value its identifier. */
export function stageMembers(spec, stage) {
  const pkg =
    spec.packages.get(`stufe-${stage}`.toLowerCase()) ?? spec.packages.get(String(stage).toLowerCase());
  if (pkg === undefined) {
    return undefined;
  }
  return [...spec.srs.values()]
    .filter((sr) => sr.packages.includes(pkg))
    .map((sr) => sr.id)
    .sort();
}

const TAG = /\[(SR-\d{3})\/AK(\d+)\]/g;
// Cross-access scenarios carry their test name's tag in a `tag:` field (#689).
const SCENARIO_FILE = /^packages\/cli\/test\/cross-access(\.test\.ts$|\/scenarios\/)/;
// A call that names a test: `it(`, `test(`, or one of them through a call such as `.each(...)(`.
const DIRECT_TEST = /(?:^|[^\w$.])(?:it|test)\s*$/;
const CALLED_TEST = /(?:^|[^\w$.])(?:it|test)\s*\.\s*(?:each|skipIf|runIf)\s*$/;
// A `/` after one of these starts a regular expression literal, not a division.
const REGEX_BEFORE = /(?:^|[(,=:[!&|?{};+\-*%~^]|\breturn|\btypeof)$/;
// Blocks whose tests do not run: `describe.skip(`, `test.describe.fixme(`, `suite.todo(` and the like.
const SKIPPED_BLOCK = /(?:^|[^\w$.])(?:test\s*\.\s*)?(?:describe|suite)\s*\.\s*(?:skip|todo|fixme)\s*\(/g;

/**
 * The source with comments blanked and the string literals listed, so that offsets and lines stay
 * those of the source. In `code`, string contents are blanked as well, so brackets in strings are
 * not counted. A template literal is one string, with its `${...}` parts.
 */
export function scanSource(text) {
  const out = text.split("");
  const strings = [];
  const blank = (from, to) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== "\n" && out[k] !== "\r") {
        out[k] = " ";
      }
    }
  };
  // The offset after the comment, string or regular expression that starts at i, or -1.
  const literal = (i) => {
    const c = text[i];
    if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
      const line = text[i + 1] === "/";
      const found = text.indexOf(line ? "\n" : "*/", i + 2);
      const end = found < 0 ? text.length : found + (line ? 0 : 2);
      blank(i, end);
      return end;
    }
    if (c === '"' || c === "'" || c === "`") {
      return string(i);
    }
    const before = text.slice(Math.max(0, i - 200), i).trimEnd();
    return c === "/" && REGEX_BEFORE.test(before.slice(-6)) ? regex(i) : -1;
  };
  // Scans code from start until an unmatched `}` (for a template part) or the end; returns its offset.
  const code = (start, inTemplate) => {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const next = literal(i);
      if (next >= 0) {
        i = next;
        continue;
      }
      if (text[i] === "{") {
        depth++;
      } else if (text[i] === "}" && depth-- === 0 && inTemplate) {
        return i;
      }
      i++;
    }
    return i;
  };
  // Skips the regular expression literal that starts at i; returns the offset after it.
  const regex = (start) => {
    let i = start + 1;
    let inClass = false;
    while (i < text.length && text[i] !== "\n" && (inClass || text[i] !== "/")) {
      if (text[i] === "\\") {
        i++;
      } else if (text[i] === "[" || text[i] === "]") {
        inClass = text[i] === "[";
      }
      i++;
    }
    return i + 1;
  };
  // Scans the string literal that starts at i; returns the offset after it.
  const string = (start) => {
    const q = text[start];
    let i = start + 1;
    while (i < text.length && text[i] !== q && (q === "`" || text[i] !== "\n")) {
      if (text[i] === "\\") {
        i++;
      } else if (q === "`" && text[i] === "$" && text[i + 1] === "{") {
        i = code(i + 2, true);
      }
      i++;
    }
    const end = Math.min(i + 1, text.length);
    strings.push({ start, end, value: text.slice(start, end) });
    return end;
  };
  code(0, false);
  for (const s of strings) {
    blank(s.start + 1, s.end - 1);
  }
  return { code: out.join(""), strings };
}

/** The offset of the bracket that opens the one closing at `close` in code, or -1. */
function openingBracket(code, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === ")" || code[i] === "]" || code[i] === "}") {
      depth++;
    } else if ((code[i] === "(" || code[i] === "[" || code[i] === "{") && --depth === 0) {
      return i;
    }
  }
  return -1;
}

/** The offset after the bracket that closes the one opening at `open` in code. */
function closingBracket(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(" || code[i] === "[" || code[i] === "{") {
      depth++;
    } else if ((code[i] === ")" || code[i] === "]" || code[i] === "}") && --depth === 0) {
      return i + 1;
    }
  }
  return code.length;
}

/**
 * The tags [SR-xxx/AKn] that name an active test in a test file: those in the name (the first
 * argument) of an `it(`/`test(` call, plain or through `.each(...)`, `.skipIf(...)` or `.runIf(...)`,
 * outside a skipped `describe`; in a cross-access scenario file also those in a `tag:` field. Tags in
 * comments, in other strings and in `.skip`, `.todo`, `.fails` or `.only` tests do not count (#689).
 * Returns [{ id, ak, line }].
 */
export function activeTags(text, file = "") {
  const { code, strings } = scanSource(text);
  const skipped = [...code.matchAll(SKIPPED_BLOCK)].map((m) => {
    const open = m.index + m[0].length - 1;
    return [open, closingBracket(code, open)];
  });
  const scenario = SCENARIO_FILE.test(file);
  // The code up to and including the last character before `end` that is not white space.
  const upTo = (end) => {
    let i = end - 1;
    while (i >= 0 && /\s/.test(code[i])) {
      i--;
    }
    return { i, tail: code.slice(Math.max(0, i - 40), i + 1) };
  };
  const named = (s) => {
    const before = upTo(s.start);
    if (scenario && /(?:^|[{,\s])tag\s*:$/.test(before.tail)) {
      return true;
    }
    if (code[before.i] !== "(") {
      return false;
    }
    const callee = upTo(before.i);
    if (DIRECT_TEST.test(callee.tail)) {
      return true;
    }
    if (code[callee.i] !== ")") {
      return false;
    }
    const open = openingBracket(code, callee.i);
    return open >= 0 && CALLED_TEST.test(upTo(open).tail);
  };
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  };
  const tags = [];
  for (const s of strings) {
    if (!named(s) || skipped.some(([from, to]) => s.start > from && s.start < to)) {
      continue;
    }
    for (const m of s.value.matchAll(TAG)) {
      tags.push({ id: m[1], ak: m[2], line: lineOf(s.start + m.index) });
    }
  }
  return tags;
}

/** Test references [SR-xxx/AKn] of active tests below root (activeTags): "SR-036/2" -> [file:line]. */
export function testReferences(root) {
  const refs = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) {
        continue;
      }
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (TEST_FILE.test(entry.name) || SCENARIO_MODULE.test(repoPath(root, p))) {
        const file = repoPath(root, p);
        for (const { id, ak, line } of activeTags(fs.readFileSync(p, "utf8"), file)) {
          const k = `${id}/${ak}`;
          refs.set(k, [...(refs.get(k) ?? []), `${file}:${line}`]);
        }
      }
    }
  };
  walk(root);
  return refs;
}

function checkTestRefs(spec, testRefs, errors, warnings) {
  for (const [k, where] of testRefs) {
    const [id, ak] = k.split("/");
    const sr = spec.srs.get(id);
    if (!sr) {
      errors.push(`${where[0]}: test refers to unknown ${id}`);
    } else if (Number(ak) < 1 || Number(ak) > sr.criteria.length) {
      errors.push(`${where[0]}: ${id} has no acceptance criterion AK${ak}`);
    } else if (sr.invalid) {
      warnings.push(`${where[0]}: ${id} is ${sr.status}`);
    }
  }
}

function checkRequired(root, spec, required, testRefs, errors) {
  const rows = [];
  for (const id of required) {
    const sr = spec.srs.get(id);
    if (!sr) {
      errors.push(`required ${id} not found in spec/`);
      continue;
    }
    if (sr.method === "test") {
      sr.criteria.forEach((_, i) => {
        const where = testRefs.get(`${id}/${i + 1}`);
        if (!where) {
          errors.push(`${id} AK${i + 1} has no test`);
        }
        rows.push(`| ${id} | AK${i + 1} | test | ${where ? where.join("<br>") : "missing"} |`);
      });
      continue;
    }
    const ok = fs.existsSync(path.join(root, "verification", `${id}.md`));
    if (!ok) {
      errors.push(`${id} (${sr.method}) has no record verification/${id}.md`);
    }
    rows.push(`| ${id} | all | ${sr.method} | ${ok ? `verification/${id}.md` : "missing"} |`);
  }
  return rows;
}

function checkPrBody(spec, body, errors) {
  const named = [...body.matchAll(/\bSR-\d{3}\b/g)].map((m) => m[0]);
  if (named.length === 0) {
    errors.push("PR names no system requirement (add SR-xxx or label enabler)");
  }
  for (const id of new Set(named)) {
    if (!spec.srs.has(id)) {
      errors.push(`PR names unknown ${id}`);
    }
  }
}

/**
 * The system requirements a PR closes (#394): the SR IDs at the start of its title (the first line of the PR text),
 * when the body has `Closes #<issue>`. A PR of an SR that does not close its issue requires nothing.
 */
export function closedSrs(text) {
  const [title = "", ...rest] = text.split(/\r?\n/);
  if (!/\bCloses #\d+/i.test(rest.join("\n"))) {
    return [];
  }
  const lead = /^(?:SR-\d{3}\b[\s,/+&]*)+/.exec(title)?.[0] ?? "";
  return [...new Set([...lead.matchAll(/SR-\d{3}\b/g)].map((m) => m[0]))];
}

/** Runs the check in `root` with the command-line `args`; returns the report and the exit code. */
export function traceCheck(root, args) {
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const errors = [];
  const warnings = [];
  const spec = readSpec(path.join(root, "spec"));
  for (const id of spec.duplicates) {
    errors.push(`${id} is the spec ID of more than one system requirement`);
  }
  const testRefs = testReferences(root);
  checkTestRefs(spec, testRefs, errors, warnings);

  let required = (opt("--require") ?? "").split(",").filter(Boolean);
  const stage = opt("--stage");
  if (stage !== undefined) {
    const members = stageMembers(spec, stage);
    if (members === undefined) {
      errors.push(`no package for stage ${stage} in spec/ (identifier Stufe-${stage} or ${stage})`);
    }
    required = required.concat(members ?? []);
  }
  const prBodyFile = opt("--pr-body");
  if (prBodyFile && !args.includes("--enabler")) {
    const text = fs.readFileSync(prBodyFile, "utf8");
    checkPrBody(spec, text, errors);
    // An unknown SR is already reported as named by the PR.
    required = required.concat(closedSrs(text).filter((id) => spec.srs.has(id) && !required.includes(id)));
  }
  const rows = checkRequired(root, spec, required, testRefs, errors);

  const report = [
    `# Trace check`,
    ``,
    `${spec.srs.size} system requirements in spec/, ${testRefs.size} referenced acceptance criteria in tests.`,
    ``,
    ...(rows.length ? ["| SR | AK | Method | Evidence |", "|---|---|---|---|", ...rows, ""] : []),
    ...(errors.length ? ["## Errors", ...errors.map((e) => `- ${e}`), ""] : []),
    ...(warnings.length ? ["## Warnings", ...warnings.map((w) => `- ${w}`), ""] : []),
  ].join("\n");
  return { report, errors, warnings, code: errors.length ? 1 : 0 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const { report, code } = traceCheck(process.cwd(), args);
  const i = args.indexOf("--report");
  if (i >= 0 && args[i + 1] !== undefined) {
    fs.writeFileSync(args[i + 1], report);
  }
  console.log(report);
  process.exit(code);
}
