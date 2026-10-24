#!/usr/bin/env node
// Converts raw Logseq MCP dumps (see SKILL.md of spec-export) into spec/ files.
// Usage: node scripts/spec-export/convert.mjs <raw-dir> <spec-dir>
import fs from "node:fs";
import path from "node:path";

// Logseq tag -> [folder in spec/, type in frontmatter]
const KINDS = {
  Need: ["needs", "need"],
  "System Requirement": ["system-requirements", "system-requirement"],
  Decision: ["decisions", "decision"],
  "Glossary Term": ["glossary", "glossary-term"],
};

const [rawDir, specDir] = process.argv.slice(2);
if (!rawDir || !specDir) {
  console.error("usage: convert.mjs <raw-dir> <spec-dir>");
  process.exit(2);
}

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(rawDir, f), "utf8"));
const files = fs.readdirSync(rawDir);

const pageTitles = new Map(readJson("pages.json").rows.map(([uuid, title]) => [uuid, title]));

const objects = [];
for (const f of files.filter((f) => f.startsWith("objects-") && f.endsWith(".json"))) {
  objects.push(...readJson(f).objects);
}

const blocksByPage = new Map();
for (const f of files.filter((f) => f.startsWith("blocks-") && f.endsWith(".json"))) {
  for (const [pageUuid, uuid, parent, order, title] of readJson(f).rows) {
    if (!blocksByPage.has(pageUuid)) {
      blocksByPage.set(pageUuid, []);
    }
    blocksByPage.get(pageUuid).push({ uuid, parent, order, title });
  }
}

// [label]([[uuid]]) -> label, [[uuid]] -> page title
const resolveLinks = (text) =>
  text
    .replace(/\[([^\]]+)\]\(\[\[[0-9a-f-]{36}\]\]\)/g, "$1")
    .replace(/\[\[([0-9a-f-]{36})\]\]/g, (m, uuid) => pageTitles.get(uuid) ?? m);

const key = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "_")
    .replace(/^_|_$/g, "");
const refValue = (v) => (v && typeof v === "object" ? (v.id ?? v.title) : v);
const yamlScalar = (v) =>
  typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(String(v));

function frontmatter(obj, kind) {
  const lines = ["---"];
  const put = (k, v) => {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        return;
      }
      lines.push(`${k}:`);
      for (const item of v) {
        lines.push(`  - ${yamlScalar(item)}`);
      }
    } else if (v !== undefined && v !== null && v !== "") {
      lines.push(`${k}: ${yamlScalar(v)}`);
    }
  };
  const props = obj.properties ?? {};
  put("id", props.ID);
  put("uuid", obj.uuid);
  put("type", KINDS[kind][1]);
  put("title", obj.title);
  for (const [name, value] of Object.entries(props).sort(([a], [b]) => a.localeCompare(b))) {
    if (name === "ID") {
      continue;
    }
    const v = Array.isArray(value)
      ? value.map(refValue).map(resolveLinks)
      : typeof value === "boolean" || typeof value === "number"
        ? value
        : resolveLinks(String(refValue(value)));
    put(key(name), v);
  }
  lines.push("---");
  return lines.join("\n");
}

function body(pageUuid) {
  const blocks = blocksByPage.get(pageUuid) ?? [];
  const children = (parent) =>
    blocks
      .filter((b) => b.parent === parent)
      .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const out = [];
  const walk = (parent, depth) => {
    for (const b of children(parent)) {
      const text = resolveLinks(b.title).trim();
      if (depth === 0) {
        out.push(text, "");
      } else {
        out.push(`${"  ".repeat(depth - 1)}- ${text}`);
      }
      walk(b.uuid, depth + 1);
      if (depth === 0 && out.at(-1) !== "") {
        out.push("");
      }
    }
  };
  walk(pageUuid, 0);
  return out.join("\n").trim() + "\n";
}

const fileName = (obj) =>
  obj.properties?.ID ??
  obj.title
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-|-$/g, "");

let count = 0;
for (const [folder] of Object.values(KINDS)) {
  fs.rmSync(path.join(specDir, folder), { recursive: true, force: true });
}
for (const obj of objects) {
  const kind = obj.tags.map((t) => t.title).find((t) => KINDS[t]);
  if (!kind) {
    continue;
  }
  const dir = path.join(specDir, KINDS[kind][0]);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${fileName(obj)}.md`),
    `${frontmatter(obj, kind)}\n${body(obj.uuid).trim() ? "\n" + body(obj.uuid) : ""}`,
  );
  count++;
}
console.log(`wrote ${count} files to ${specDir}`);
