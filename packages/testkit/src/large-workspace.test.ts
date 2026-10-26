import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import type { GeneratedElement, GeneratedWorkspace, LargeFixtureWorkspace, VersionSubject } from "./index.js";
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
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-large-"));
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
        /\[([^\]]+)\]\(logreq:([0-9a-f-]{36})\?version=([^&)]+)(?:&repository=([a-z]+))?\)/g,
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
    expect(count).toBe(generated.references);
    expect(count).toBeGreaterThan(generated.elements.length * 1.5);
    expect(count).toBeLessThan(generated.elements.length * 2.5);
    expect(across).toBeGreaterThan(100);
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
    const workspace = generated.files.get("system/logreq-workspace.yaml") ?? "";
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
    expect(fs.readFileSync(path.join(ws.workspaceRoot, "logreq-workspace.yaml"), "utf8")).toBe(
      generated.files.get("system/logreq-workspace.yaml"),
    );
    for (const [file, content] of generated.files) {
      expect(fs.readFileSync(ws.path(file), "utf8")).toBe(content);
    }
    expect(fs.existsSync(path.join(ws.workspaceRoot, ".git"))).toBe(false);
  });

  it("makes each repository a Git repository with one commit when asked, below the folder given", async () => {
    const tempDir = tempFolder();
    const ws = await write(small(7, 40, 80), { git: true, tempDir });
    // `<tempDir>/logreq-fixture-*/workspace`. The root is a native realpath; so must the folder be:
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
