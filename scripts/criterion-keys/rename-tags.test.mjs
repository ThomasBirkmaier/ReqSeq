import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renameTags } from "./rename-tags.mjs";

const roots = [];
afterEach(() => {
  for (const r of roots.splice(0)) {
    fs.rmSync(r, { recursive: true, force: true });
  }
});

// Built at run time, so that trace-check and the script itself do not read them as tags of real SRs.
const num = (id, n) => `[${id}/AK${n}]`;
const key = (id, k) => `[${id}/AK-${k}]`;

const SR = [
  "---",
  "id: 00000000-0000-4000-8000-000000000001",
  "type: system-requirement",
  "title: Eins",
  "spec-id: SR-001",
  "acceptance-criteria:",
  "  - key: kaaa",
  "    text: Gegeben a, dann b.",
  "  - key: kbbb",
  "    text: Gegeben c, dann d.",
  "  - Gegeben e, dann f.",
  "  - key: kdup",
  "    text: Gegeben g, dann h.",
  "  - key: kdup",
  "    text: Gegeben i, dann j.",
  "---",
  "",
].join("\n");

/** A repository with spec/ (SR-001: two keys, a criterion without key, a double key) and `files`. */
function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-rename-tags-"));
  roots.push(root);
  const all = {
    "spec/reqseq-workspace.yaml":
      "reqseq-workspace: 1\nrepositories:\n  - { name: spec, main: true }\nmetamodel: { repository: spec, path: metamodel }\n",
    "spec/metamodel/m.yaml": "properties:\n  - { key: spec-id, meaning: identifier }\n",
    "spec/system-requirement/SR-1.md": SR,
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), "utf8");

describe("rename-tags (#1419)", () => {
  it("renames number tags in test names, comments and docs to the key from spec/, and leaves data and unknown ones", () => {
    const test = [
      `// ${num("SR-001", 2)} in a comment`,
      `it("${num("SR-001", 1)} ${num("SR-001", 2)} a", () => {`,
      `  expect("${num("SR-001", 1)} data").toBe("");`,
      `});`,
      `it.skip("${num("SR-001", 1)} skipped", () => {});`,
      `it(\`\${x ?? "${num("SR-001", 1)}"} b\`, () => {});`,
      `it("${num("SR-001", 3)} ${num("SR-001", 4)} ${num("SR-001", 9)} ${num("SR-404", 1)} c", () => {});`,
      `it("${key("SR-001", "kaaa")} d", () => {});`,
      "",
    ].join("\r\n");
    const root = repo({
      "packages/x/src/a.test.ts": test,
      "packages/x/src/b.ts": `// ${num("SR-001", 1)}\nconst s = "${num("SR-001", 1)}";\n`,
      "packages/cli/test/cross-access/scenarios/c/d.ts": `export default [{ tag: "${num("SR-001", 2)}" }];\n`,
      "verification/SR-001.md": `- AK1: the \`${num("SR-001", 1)} ...\` tests.\n`,
      // Its strings build test names at run time (RUN_TIME_NAMES).
      "packages/core/src/commands/no-status-change.test.ts": `const tag = "${num("SR-001", 2)}";\n`,
      "CLAUDE.md": `a test named \`${num("SR-001", 1)} ...\`\n`,
      "packages/x/dist/a.test.ts": `it("${num("SR-001", 1)} built");\n`,
    });

    const checked = renameTags(root, { check: true });
    expect(checked.count).toBe(8);
    expect(read(root, "packages/x/src/a.test.ts")).toBe(test);

    const { lines, count, distinct, files } = renameTags(root);
    expect({ count, distinct, files }).toEqual({ count: 8, distinct: 2, files: 5 });
    expect(read(root, "packages/x/src/a.test.ts")).toBe(
      [
        `// ${key("SR-001", "kbbb")} in a comment`,
        `it("${key("SR-001", "kaaa")} ${key("SR-001", "kbbb")} a", () => {`,
        `  expect("${num("SR-001", 1)} data").toBe("");`,
        `});`,
        `it.skip("${num("SR-001", 1)} skipped", () => {});`,
        `it(\`\${x ?? "${key("SR-001", "kaaa")}"} b\`, () => {});`,
        `it("${num("SR-001", 3)} ${num("SR-001", 4)} ${num("SR-001", 9)} ${num("SR-404", 1)} c", () => {});`,
        `it("${key("SR-001", "kaaa")} d", () => {});`,
        "",
      ].join("\r\n"),
    );
    expect(read(root, "packages/x/src/b.ts")).toBe(
      `// ${key("SR-001", "kaaa")}\nconst s = "${num("SR-001", 1)}";\n`,
    );
    expect(read(root, "packages/cli/test/cross-access/scenarios/c/d.ts")).toContain(key("SR-001", "kbbb"));
    expect(read(root, "verification/SR-001.md")).toContain(key("SR-001", "kaaa"));
    expect(read(root, "packages/core/src/commands/no-status-change.test.ts")).toContain(
      key("SR-001", "kbbb"),
    );
    expect(read(root, "CLAUDE.md")).toContain(num("SR-001", 1));
    expect(read(root, "packages/x/dist/a.test.ts")).toContain(num("SR-001", 1));
    expect(lines).toEqual([
      `left packages/x/src/a.test.ts:3 ${num("SR-001", 1)}: in a string that is no name of an active test`,
      `left packages/x/src/a.test.ts:5 ${num("SR-001", 1)}: in a string that is no name of an active test`,
      `left packages/x/src/a.test.ts:7 ${num("SR-001", 3)}: SR-001 has no acceptance criterion AK3 with a criterion key`,
      `left packages/x/src/a.test.ts:7 ${num("SR-001", 4)}: SR-001 has more than one acceptance criterion with the key kdup`,
      `left packages/x/src/a.test.ts:7 ${num("SR-001", 9)}: SR-001 has no acceptance criterion AK9 with a criterion key`,
      `left packages/x/src/a.test.ts:7 ${num("SR-404", 1)}: SR-404 is not in spec/`,
      `left packages/x/src/b.ts:2 ${num("SR-001", 1)}: in a string that is no name of an active test`,
      "renamed 8 tags (2 distinct) in 5 files",
    ]);

    // A second run renames nothing.
    expect(renameTags(root).count).toBe(0);
  });
});
