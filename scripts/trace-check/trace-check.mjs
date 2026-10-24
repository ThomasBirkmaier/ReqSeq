#!/usr/bin/env node
// Checks the chain SR -> test -> verification record (D-050).
// Usage: node scripts/trace-check/trace-check.mjs [--require SR-001,SR-002] [--stage 1]
//        [--pr-body <file>] [--enabler] [--report <file>]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = process.cwd();
const errors = [];
const warnings = [];

// Frontmatter as written by spec-export: `key: "json"` and `  - "json"` list items.
function readFrontmatter(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  const data = {};
  if (!m) {
    return data;
  }
  let listKey = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^ {2}- (.*)$/);
    if (item && listKey) {
      data[listKey].push(JSON.parse(item[1]));
      continue;
    }
    const kv = line.match(/^([a-z0-9_äöüß]+):\s*(.*)$/);
    if (!kv) {
      continue;
    }
    if (kv[2] === "") {
      listKey = kv[1];
      data[listKey] = [];
    } else {
      listKey = null;
      data[kv[1]] = JSON.parse(kv[2]);
    }
  }
  return data;
}

const srDir = path.join(root, "spec", "system-requirements");
const srs = new Map();
if (fs.existsSync(srDir)) {
  for (const f of fs.readdirSync(srDir).filter((f) => f.endsWith(".md"))) {
    const fm = readFrontmatter(path.join(srDir, f));
    if (fm.id) {
      srs.set(fm.id, fm);
    }
  }
}

// Collect test references [SR-xxx/AKn] from test files.
const testRefs = new Map(); // "SR-036/2" -> [file:line]
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|mjs)$|^test_.*\.py$|_test\.py$/;
const SKIP = new Set(["node_modules", ".git", "dist", "out", "coverage", "spec"]);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) {
      continue;
    }
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(p);
    } else if (TEST_FILE.test(entry.name)) {
      fs.readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(/\[(SR-\d{3})\/AK(\d+)\]/g)) {
            const k = `${m[1]}/${m[2]}`;
            if (!testRefs.has(k)) {
              testRefs.set(k, []);
            }
            testRefs.get(k).push(`${path.relative(root, p)}:${i + 1}`);
          }
        });
    }
  }
}
walk(root);

for (const [k, where] of testRefs) {
  const [id, ak] = k.split("/");
  const sr = srs.get(id);
  if (!sr) {
    errors.push(`${where[0]}: test refers to unknown ${id}`);
  } else if (Number(ak) < 1 || Number(ak) > (sr.akzeptanzkriterien ?? []).length) {
    errors.push(`${where[0]}: ${id} has no acceptance criterion AK${ak}`);
  } else if (sr.re_status === "Obsolete") {
    warnings.push(`${where[0]}: ${id} is Obsolete`);
  }
}

// Required SRs: explicit list or stage list from spec/stages.json ({"1": ["SR-001", ...]}).
let required = (opt("--require") ?? "").split(",").filter(Boolean);
const stage = opt("--stage");
if (stage) {
  const stages = JSON.parse(fs.readFileSync(path.join(root, "spec", "stages.json"), "utf8"));
  required = required.concat(stages[stage] ?? []);
}
const rows = [];
for (const id of required) {
  const sr = srs.get(id);
  if (!sr) {
    errors.push(`required ${id} not found in spec/`);
    continue;
  }
  const method = sr.nachweismethode;
  const aks = sr.akzeptanzkriterien ?? [];
  if (method === "Test") {
    aks.forEach((_, i) => {
      const covered = testRefs.has(`${id}/${i + 1}`);
      if (!covered) {
        errors.push(`${id} AK${i + 1} has no test`);
      }
      rows.push(
        `| ${id} | AK${i + 1} | Test | ${covered ? testRefs.get(`${id}/${i + 1}`).join("<br>") : "missing"} |`,
      );
    });
  } else {
    const rec = path.join(root, "verification", `${id}.md`);
    const ok = fs.existsSync(rec);
    if (!ok) {
      errors.push(`${id} (${method}) has no record verification/${id}.md`);
    }
    rows.push(`| ${id} | all | ${method} | ${ok ? `verification/${id}.md` : "missing"} |`);
  }
}

// PR body must name an SR unless the PR is an enabler.
const prBodyFile = opt("--pr-body");
if (prBodyFile && !args.includes("--enabler")) {
  const body = fs.readFileSync(prBodyFile, "utf8");
  const named = [...body.matchAll(/\bSR-\d{3}\b/g)].map((m) => m[0]);
  if (named.length === 0) {
    errors.push("PR names no system requirement (add SR-xxx or label enabler)");
  }
  for (const id of named) {
    if (!srs.has(id)) {
      errors.push(`PR names unknown ${id}`);
    }
  }
}

const report = [
  `# Trace check`,
  ``,
  `${srs.size} system requirements in spec/, ${testRefs.size} referenced acceptance criteria in tests.`,
  ``,
  ...(rows.length ? ["| SR | AK | Method | Evidence |", "|---|---|---|---|", ...rows, ""] : []),
  ...(errors.length ? ["## Errors", ...errors.map((e) => `- ${e}`), ""] : []),
  ...(warnings.length ? ["## Warnings", ...warnings.map((w) => `- ${w}`), ""] : []),
].join("\n");
const reportFile = opt("--report");
if (reportFile) {
  fs.writeFileSync(reportFile, report);
}
console.log(report);
process.exit(errors.length ? 1 : 0);
