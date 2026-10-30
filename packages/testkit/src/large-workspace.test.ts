import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import type {
  GeneratedElement,
  GeneratedWorkspace,
  LargeFixtureWorkspace,
  VariantRulesOptions,
  VersionSubject,
} from "./index.js";
import {
  DEFAULT_ELEMENTS,
  DEFAULT_RELATIONS,
  SPEC_ID_KEY,
  defaultStandardModelFile,
  withSpecIdProperty,
  generateLargeWorkspace,
  writeLargeWorkspace,
} from "./index.js";

/** Stands in for core's version (the testkit cannot import core); core's tests use the real one. */
const fakeVersion = (subject: VersionSubject): string =>
  `n1:${createHash("sha256").update(JSON.stringify(subject)).digest("hex").slice(0, 16)}`;

const small = (seed = 7, elements = 400, relations = 1600): GeneratedWorkspace =>
  generateLargeWorkspace({ version: fakeVersion, seed, elements, relations });

interface Relation {
  readonly source: GeneratedElement;
  readonly key: string;
  readonly target: Readonly<Record<string, string>>;
}

/** The relation lines of every element file (one flow mapping per line, ADR-0004). */
const relationsOf = (generated: GeneratedWorkspace): Relation[] => {
  const relations: Relation[] = [];
  for (const source of generated.elements) {
    const content = generated.files.get(`${source.repository}/${source.file}`) ?? "";
    let key = "";
    for (const line of content.split("\n")) {
      key = /^([a-z-]+):$/.exec(line)?.[1] ?? key;
      const mapping = /^ {2}- \{ (.*) \}$/.exec(line)?.[1];
      if (mapping !== undefined) {
        const target = Object.fromEntries(
          mapping.split(", ").map((pair) => pair.split(": ") as [string, string]),
        );
        relations.push({ source, key, target });
      }
    }
  }
  return relations;
};

/** A temporary parent folder, removed when the test finishes (after the workspaces in it). */
const tempFolder = (): string => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "reqseq-large-"));
  onTestFinished(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });
  return folder;
};

const created: LargeFixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((ws) => ws.cleanup()));
});

describe("generateLargeWorkspace", () => {
  it("gives the same files for the same seed and other files for another seed", () => {
    const a = small();
    const b = small();
    expect(b.digest).toBe(a.digest);
    expect([...b.files]).toEqual([...a.files]);
    expect(small(8).digest).not.toBe(a.digest);
    expect(a.seed).toBe(7);
  });

  it("writes exactly the requested elements and relations, of every type, in every repository", () => {
    const generated = small();
    expect(generated.elements).toHaveLength(400);
    expect(generated.relations).toBe(1600);
    expect(relationsOf(generated)).toHaveLength(1600);
    expect(new Set(generated.elements.map((e) => e.type))).toEqual(
      new Set(["need", "use-case", "decision", "variant", "package", "system-requirement"]),
    );
    expect(new Set(generated.elements.map((e) => e.repository))).toEqual(
      new Set(generated.repositories.map((r) => r.name)),
    );
    expect(generated.repositories.map((r) => r.folder)).toEqual(["system", "product", "sensor", "display"]);
    expect(generated.main).toBe("system");
    // Workspace file, metamodel and one file per element.
    expect(generated.files.size).toBe(402);
    expect([...generated.files.keys()]).toEqual([...generated.files.keys()].sort());
  });

  it("names files by type prefix and UUID end, with distinct UUIDs (D-056)", () => {
    const generated = small();
    const prefixes: Record<string, string> = {
      need: "N",
      "use-case": "UC",
      decision: "D",
      variant: "VAR",
      package: "PKG",
      "system-requirement": "SR",
    };
    expect(new Set(generated.elements.map((e) => e.id)).size).toBe(400);
    for (const element of generated.elements) {
      expect(element.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(element.file).toBe(
        `${element.type}/000/${prefixes[element.type] ?? "?"}-${element.id.slice(-12)}.md`,
      );
      const content = generated.files.get(`${element.repository}/${element.file}`) ?? "";
      expect(content).toMatch(
        new RegExp(`^---\\nid: ${element.id}\\ntype: ${element.type}\\nstatus: (draft|approved)\\n`),
      );
      expect(content).toContain(`\ntitle: ${element.title}\n`);
    }
  });

  it("puts at most 1,000 elements in a folder", () => {
    const generated = generateLargeWorkspace({ version: fakeVersion, elements: 2500, relations: 100 });
    const folders = new Set(generated.elements.map((e) => e.file.split("/")[1]));
    expect(folders).toEqual(new Set(["000", "001", "002"]));
  });

  it("stores each target with the version given for it, its title within a repository and its repository across", () => {
    const generated = small();
    const byId = new Map(generated.elements.map((e) => [e.id, e]));
    let across = 0;
    for (const { source, target } of relationsOf(generated)) {
      const element = byId.get(target["id"] ?? "");
      expect(target["version"]).toBe(element?.version);
      if (element?.repository === source.repository) {
        expect(target).toEqual({ id: element.id, version: element.version, title: element.title });
      } else {
        across++;
        expect(target).toEqual({
          id: element?.id,
          version: element?.version,
          repository: element?.repository,
        });
      }
    }
    expect(across).toBeGreaterThan(100);
  });

  it("writes about two inline references per element to earlier elements, with repository only across repositories (#240)", () => {
    const generated = small();
    const byId = new Map(generated.elements.map((e) => [e.id, e]));
    const order = new Map(generated.elements.map((e, i) => [e.id, i]));
    let count = 0;
    let across = 0;
    for (const source of generated.elements) {
      const content = generated.files.get(`${source.repository}/${source.file}`) ?? "";
      for (const [, label, id, version, repository] of content.matchAll(
        /\[([^\]]+)\]\(reqseq:([0-9a-f-]{36})\?version=([^&)]+)(?:&repository=([a-z]+))?\)/g,
      )) {
        count++;
        const target = byId.get(id ?? "");
        expect(order.get(id ?? "")).toBeLessThan(order.get(source.id) ?? 0);
        expect(version).toBe(target?.version);
        if (target?.repository === source.repository) {
          expect([label, repository]).toEqual([target.title, undefined]);
        } else {
          across++;
          expect(repository).toBe(target?.repository);
          expect(label).toMatch(new RegExp(`^[A-Z]+-${(id ?? "").slice(-6)}$`));
        }
      }
    }
    // The references in acceptance criteria (SR-127) are counted apart.
    expect(count).toBe(generated.references + generated.criterionReferences);
    expect(count).toBeGreaterThan(generated.elements.length * 1.5);
    expect(count).toBeLessThan(generated.elements.length * 2.5);
    expect(across).toBeGreaterThan(100);
  });

  it("writes one inline reference into an acceptance criterion of every tenth system requirement, to an earlier element, and the same for the same seed (SR-127)", () => {
    const generated = small();
    const byId = new Map(generated.elements.map((e, i) => [e.id, { ...e, order: i }]));
    let found = 0;
    let requirements = 0;
    let changed = 0;
    for (const source of generated.elements) {
      const content = generated.files.get(`${source.repository}/${source.file}`) ?? "";
      const frontmatter = content.split("\n---\n")[0] ?? "";
      const links = [...frontmatter.matchAll(/\(reqseq:([0-9a-f-]{36})\?version=([^&)]+)/g)];
      if (source.type === "system-requirement") {
        requirements++;
      }
      // Relation items are flow mappings, so a `(reqseq:` in the frontmatter is in a criterion.
      expect(links.length).toBeLessThanOrEqual(1);
      for (const [, id, version] of links) {
        found++;
        const target = byId.get(id ?? "");
        expect(target?.order).toBeLessThan(byId.get(source.id)?.order ?? 0);
        expect(version).toBe(target?.version);
        changed += (target?.order ?? 1) % 100 === 0 ? 1 : 0;
        expect(frontmatter).toMatch(/\n {2}- Given the station runs, [^\n]*, see \[[^\]]+\]\(reqseq:/u);
      }
    }
    expect(found).toBe(generated.criterionReferences);
    expect(found).toBeGreaterThan(requirements / 10 - 3);
    expect(found).toBeLessThanOrEqual(Math.ceil(requirements / 10));
    // Every third points at an element the outdated-relations suite changes (every 100th).
    expect(changed).toBeGreaterThan(found / 6);
    expect(small().criterionReferences).toBe(found);
  });

  it("follows the source and target types of the standard model, without derivation cycles or duplicate targets", () => {
    const generated = small();
    const index = new Map(generated.elements.map((e, i) => [e.id, i]));
    const typeOf = new Map(generated.elements.map((e) => [e.id, e.type]));
    const allowed: Record<string, readonly [readonly string[], readonly string[]]> = {
      "derives-from": [["system-requirement"], ["need", "use-case", "system-requirement"]],
      refines: [["need", "use-case"], ["need"]],
      "based-on": [["need", "use-case", "decision", "package", "system-requirement"], ["decision"]],
      excludes: [["variant"], ["system-requirement"]],
      validity: [["system-requirement"], ["variant"]],
      packages: [["system-requirement"], ["package"]],
    };
    const seen = new Set<string>();
    const keys = new Set<string>();
    for (const { source, key, target } of relationsOf(generated)) {
      keys.add(key);
      const [sources, targets] = allowed[key] ?? [[], []];
      expect(sources).toContain(source.type);
      expect(targets).toContain(typeOf.get(target["id"] ?? ""));
      if (key === "derives-from" || key === "refines" || (key === "based-on" && source.type === "decision")) {
        expect(index.get(target["id"] ?? "")).toBeLessThan(index.get(source.id) ?? 0);
      }
      const pair = `${source.id} ${key} ${target["id"] ?? ""}`;
      expect(seen.has(pair)).toBe(false);
      seen.add(pair);
    }
    expect(keys).toEqual(new Set(Object.keys(allowed)));
  });

  it("lets variants exclude only core requirements, those without validity (SR-042, D-020)", () => {
    const relations = relationsOf(small(7, 5000, 20_000));
    const withValidity = new Set(relations.filter((r) => r.key === "validity").map((r) => r.source.id));
    const excluded = relations.filter((r) => r.key === "excludes").map((r) => r.target["id"] ?? "");
    expect(withValidity.size).toBeGreaterThan(10);
    expect(excluded.length).toBeGreaterThan(20);
    expect(excluded.filter((id) => withValidity.has(id))).toEqual([]);
  });

  describe("variantRules (stage 5 plan, VR-S6)", () => {
    const base = (): GeneratedWorkspace => small(7, 5000, 20_000);
    const withRules = (rules: VariantRulesOptions): GeneratedWorkspace =>
      generateLargeWorkspace({
        version: fakeVersion,
        seed: 7,
        elements: 5000,
        relations: 20_000,
        variantRules: rules,
      });

    it("adds exclusions and replacements onto core requirements in a pass of its own, changing only the files of their sources", () => {
      const plain = base();
      const generated = withRules({ exclusions: 300, replacements: 200 });
      const relations = relationsOf(generated);
      const withValidity = new Set(relations.filter((r) => r.key === "validity").map((r) => r.source.id));
      const replaces = relations.filter((r) => r.key === "replaces");
      const excludes = relations.filter((r) => r.key === "excludes");
      expect([generated.exclusions, generated.replacements]).toEqual([300, 200]);
      expect([excludes.length, replaces.length]).toEqual([300, 200]);
      expect(plain.replacements).toBe(0);
      expect(generated.relations).toBe(plain.relations + 300 - plain.exclusions + 200);
      // Sources: requirements with a validity, at most two items each; targets: core requirements.
      expect(replaces.every((r) => withValidity.has(r.source.id))).toBe(true);
      const perSource = new Map<string, number>();
      for (const r of replaces) {
        perSource.set(r.source.id, (perSource.get(r.source.id) ?? 0) + 1);
      }
      expect(Math.max(...perSource.values())).toBeLessThanOrEqual(2);
      const targets = [...replaces, ...excludes].map((r) => r.target["id"] ?? "");
      expect(targets.filter((id) => withValidity.has(id))).toEqual([]);
      // Versions and every other file stay as they were; the sources keep their text.
      expect(generated.elements).toEqual(plain.elements);
      const sources = new Set(
        [...replaces, ...excludes].map((r) => `${r.source.repository}/${r.source.file}`),
      );
      for (const [file, content] of generated.files) {
        if (!sources.has(file)) {
          expect(content).toBe(plain.files.get(file));
        }
      }
      expect(withRules({ exclusions: 300, replacements: 200 }).digest).toBe(generated.digest);
      expect(withRules({ seed: 8, exclusions: 300, replacements: 200 }).digest).not.toBe(generated.digest);
    });

    it("throws at once when the items do not fit, and fills exactly the room it names", () => {
      const room = (rules: VariantRulesOptions): number => {
        try {
          withRules(rules);
        } catch (error) {
          return Number(/room for (\d+) from/.exec(String(error))?.[1]);
        }
        return -1;
      };
      // 5,000 by default fit N-036 only: more than two each from the requirements with a validity here.
      const replacements = room({ exclusions: 0 });
      expect(replacements).toBeGreaterThan(100);
      expect(replacements).toBeLessThan(5000);
      expect(withRules({ exclusions: 0, replacements }).replacements).toBe(replacements);
      expect(room({ exclusions: 0, replacements: 1_000_000 })).toBe(replacements);
      expect(() =>
        generateLargeWorkspace({ version: fakeVersion, elements: 6, relations: 0, variantRules: {} }),
      ).toThrow(/^cannot place 5000 excludes items: room for \d from 1 sources onto \d core requirements/);
    });
  });

  it("passes the text and every value but the relation kinds to the version function (ADR-0005)", () => {
    const subjects: VersionSubject[] = [];
    const generated = generateLargeWorkspace({
      version: (subject) => {
        subjects.push(subject);
        return fakeVersion(subject);
      },
      elements: 400,
      relations: 1600,
    });
    expect(subjects).toHaveLength(400);
    for (const [i, subject] of subjects.entries()) {
      const element = generated.elements[i];
      const content = generated.files.get(`${element?.repository ?? ""}/${element?.file ?? ""}`) ?? "";
      expect(subject.type).toBe(element?.type);
      expect(content.endsWith(`\n---\n${subject.text}`)).toBe(true);
      expect(subject.properties).toMatchObject({
        id: element?.id,
        type: element?.type,
        title: element?.title,
      });
      for (const kind of ["derives-from", "refines", "based-on", "excludes"]) {
        expect(subject.properties).not.toHaveProperty(kind);
      }
    }
    const requirements = subjects.filter((s) => s.type === "system-requirement");
    const withValidity = requirements.find((s) => Array.isArray(s.properties["validity"]));
    expect(withValidity?.properties["validity"]).toEqual([
      expect.objectContaining({ version: expect.stringMatching(/^n1:/) as unknown }) as unknown,
    ]);
    expect(requirements.some((s) => Array.isArray(s.properties["packages"]))).toBe(true);
    for (const key of ["requirement-type", "acceptance-criteria", "verification-method"]) {
      expect(requirements.every((s) => key in s.properties)).toBe(true);
    }
    expect(requirements.some((s) => "emergent" in s.properties)).toBe(true);
    expect(subjects.some((s) => "rationale" in s.properties)).toBe(true);
  });

  it("writes the workspace file and the standard model, or the metamodel given", () => {
    const generated = small();
    expect(generated.files.get("system/metamodel/standard-model.yaml")).toBe(
      withSpecIdProperty(fs.readFileSync(defaultStandardModelFile, "utf8")),
    );
    const workspace = generated.files.get("system/reqseq-workspace.yaml") ?? "";
    expect(workspace).toContain("main: true");
    for (const name of ["product", "sensor", "display"]) {
      expect(workspace).toContain(`path: ../${name} }`);
    }
    expect(workspace).toContain("metamodel: { repository: system, path: metamodel }");
    const own = generateLargeWorkspace({
      version: fakeVersion,
      elements: 10,
      relations: 5,
      metamodel: "x: 1\n",
    });
    expect(own.files.get("system/metamodel/standard-model.yaml")).toBe("x: 1\n");
    expect([...own.files.values()].some((text) => text.includes(`\n${SPEC_ID_KEY}: `))).toBe(false);
  });

  it("adds a spec ID property to the metamodel and a spec ID unique per type to every element (#305)", () => {
    const model = withSpecIdProperty(fs.readFileSync(defaultStandardModelFile, "utf8"));
    expect(model).toContain(
      "\nproperties:\n  - { key: spec-id, name: Spec ID, kind: text, meaning: identifier }\n",
    );
    expect(model).toContain("properties: [spec-id, title, rationale, topic]");
    expect(model).toContain("[\n        spec-id, title,");
    expect(withSpecIdProperty(model)).toBe(model);
    const generated = small();
    const ids = [...generated.files]
      .filter(([file]) => file.endsWith(".md"))
      .map(([, text]) => /\ntype: (\S+)\n[\s\S]*?\nspec-id: (\S+)\n/.exec(text)?.slice(1, 3).join(" "));
    expect(ids.every((id) => id !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("need N-001");
  });

  it("quotes emergent values and writes choices and lists as plain YAML", () => {
    const generated = small();
    const texts = [...generated.files.values()].join("\n");
    expect(texts).toMatch(/\nemergent: "(yes|no)"\n/);
    expect(texts).toMatch(/\nacceptance-criteria:\n {2}- Given /);
    expect(texts).not.toMatch(/\ntitle: [^\n]*[,:#{}[\]]/);
  });

  it("refuses fewer than one element of each type and relations that do not fit", () => {
    expect(() => generateLargeWorkspace({ version: fakeVersion, elements: 5 })).toThrow(
      /at least 6 elements/,
    );
    expect(() => generateLargeWorkspace({ version: fakeVersion, elements: 6.5 })).toThrow(
      /at least 6 elements/,
    );
    expect(() => generateLargeWorkspace({ version: fakeVersion, elements: 6, relations: 100 })).toThrow(
      /cannot place 100 distinct relations among 6 elements/,
    );
    expect(generateLargeWorkspace({ version: fakeVersion, elements: 6, relations: 0 }).relations).toBe(0);
  });

  // Generating 50,000 elements takes about 2 s on 4 cores alone, more in the parallel suite with
  // coverage; the test checks the default counts, not time (that is the perf suite, ADR-0011).
  it("generates 50,000 elements with 200,000 relations by default (N-036)", () => {
    const generated = generateLargeWorkspace({ version: fakeVersion });
    expect(generated.elements).toHaveLength(DEFAULT_ELEMENTS);
    expect(generated.relations).toBe(DEFAULT_RELATIONS);
    expect(generated.seed).toBe(36);
    expect(new Set(generated.elements.map((e) => e.id)).size).toBe(DEFAULT_ELEMENTS);
    const sixDigits = new Map<string, number>();
    for (const { id } of generated.elements) {
      sixDigits.set(id.slice(-6), (sixDigits.get(id.slice(-6)) ?? 0) + 1);
    }
    // Like random UUIDs, some short IDs need more than 6 digits (about 75 at 50,000, D-056).
    expect([...sixDigits.values()].filter((n) => n > 1).length).toBeGreaterThan(40);
  }, 60_000);
});

describe("writeLargeWorkspace", () => {
  const write = async (...args: Parameters<typeof writeLargeWorkspace>): Promise<LargeFixtureWorkspace> => {
    const ws = await writeLargeWorkspace(...args);
    created.push(ws);
    return ws;
  };

  it("writes every file into a temporary folder, the main repository as workspace root", async () => {
    const generated = small();
    const ws = await write(generated);
    expect(ws.generated).toBe(generated);
    expect(ws.workspaceRoot).toBe(path.join(ws.root, "system"));
    expect(fs.readFileSync(path.join(ws.workspaceRoot, "reqseq-workspace.yaml"), "utf8")).toBe(
      generated.files.get("system/reqseq-workspace.yaml"),
    );
    for (const [file, content] of generated.files) {
      expect(fs.readFileSync(ws.path(file), "utf8")).toBe(content);
    }
    expect(fs.existsSync(path.join(ws.workspaceRoot, ".git"))).toBe(false);
  });

  it("makes each repository a Git repository with one commit when asked, below the folder given", async () => {
    const tempDir = tempFolder();
    const ws = await write(small(7, 40, 80), { git: true, tempDir });
    // `<tempDir>/reqseq-fixture-*/workspace`. The root is a native realpath; so must the folder be:
    // on Windows `fs.realpathSync` keeps 8.3 short names (RUNNER~1) that the native one expands.
    expect(path.dirname(path.dirname(ws.root))).toBe(fs.realpathSync.native(tempDir));
    for (const repository of ws.generated.repositories) {
      expect(await ws.head(repository.folder)).toMatch(/^[0-9a-f]{40}$/);
      expect(await ws.git(["status", "--porcelain"], repository.folder)).toBe("");
    }
  });

  it("removes the temporary folder when a file cannot be written", async () => {
    const tempDir = tempFolder();
    const broken: GeneratedWorkspace = { ...small(7, 10, 5), files: new Map([["../outside.md", "x"]]) };
    await expect(writeLargeWorkspace(broken, { tempDir })).rejects.toThrow(/relative/);
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });
});
