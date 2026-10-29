// The verification state carried over a change of the element store (#698, plan §3.3; ADR-0008
// file-watching "carry"): after a save or a watcher batch `verificationState` keeps the versions it
// read, the walks of `prepare` and the results of the evaluator for every element the change cannot
// reach. Whatever the change, the carried state must give what a fresh workspace builds from the
// files, for every element in every view (the ADR-0008 obligation), and the old value must stay as
// it was. The workspace is generated on disk from a seed: a derivation tree below a need, three
// variants, validities, emergent and invalid elements, a twin, an embedded image, and records in the
// core and per variant against current and older versions.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import type { ElementStore } from "../model/index.js";
import {
  applyStoreChange,
  currentVersionsOf,
  elementStoreState,
  incomingFor,
  incomingState,
  updateElements,
} from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import type * as CurrentVersionsModule from "../model/current-versions.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { evidenceIndexState } from "./by-element.js";
import { carriedEvaluator, verificationEvaluator } from "./indirect.js";
import type { EvidenceRecord } from "./record.js";
import { evidenceReadState, evidenceRecordsState, readEvidence, registerInsertion } from "./state.js";
import { withRecord } from "./write-record.js";
import { statusSource } from "./status.js";
import type { StateStatus } from "./verification.js";
import { verificationOf, verificationState } from "./verification.js";

/** Holds every read of current versions while set (the case of a `prepare` that is still reading). */
const gate = vi.hoisted(() => ({ hold: undefined as Promise<void> | undefined }));

vi.mock("../model/current-versions.js", async (importOriginal) => {
  const original = await importOriginal<typeof CurrentVersionsModule>();
  return {
    ...original,
    currentVersionsOf: async (...args: Parameters<typeof original.currentVersionsOf>) => {
      await gate.hold;
      return original.currentVersionsOf(...args);
    },
  };
});

const PREFIX = "c0c0c0c0-0000-4000-8000-";
const uuid = (n: number): string => `${PREFIX}${n.toString(16).padStart(12, "0")}`;
const STALE = "n1:0000000000000000";
const VARIANTS = [uuid(0xa1), uuid(0xa2), uuid(0xa3)] as const;
const NEED = uuid(0xe0);

/** A small seeded random generator (mulberry32), so a failure can be run again. */
const randomOf = (seed: number) => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    below: (n: number): number => Math.floor(next() * n),
    pick: <T>(list: readonly T[]): T => {
      const item = list[Math.floor(next() * list.length)];
      if (item === undefined) {
        throw new Error("pick from an empty list");
      }
      return item;
    },
  };
};
type Random = ReturnType<typeof randomOf>;

/** One element file of the generated workspace. */
interface Spec {
  readonly file: string;
  id: string;
  type: "system-requirement" | "use-case" | "need" | "variant";
  status: "draft" | "approved" | "obsolete";
  title: string;
  parents: string[];
  /** The variants it is valid for; `wrong`: one mapping where a list belongs. */
  validity: readonly string[] | "wrong";
  emergent: boolean;
  /** Toggled by a text change, so a version can come back. */
  changed: boolean;
  image?: string;
}

const render = (spec: Spec): string => {
  const lines = [
    "---",
    `id: ${spec.id}`,
    `type: ${spec.type}`,
    `status: ${spec.status}`,
    `title: ${spec.title}`,
  ];
  if (spec.type === "system-requirement") {
    lines.push("requirement-type: functional", "acceptance-criteria:", "  - Given it runs, then it works.");
  }
  if (spec.parents.length > 0) {
    // `!text`: an item that is no mapping with an id (it names nothing).
    lines.push(
      "derives-from:",
      ...spec.parents.map((id) => (id.startsWith("!") ? `  - ${id.slice(1)}` : `  - { id: ${id} }`)),
    );
  }
  if (spec.validity === "wrong") {
    lines.push(`validity: { id: ${VARIANTS[0]} }`);
  } else if (spec.validity.length > 0) {
    lines.push("validity:", ...spec.validity.map((id) => `  - { id: ${id} }`));
  }
  if (spec.emergent) {
    lines.push('emergent: "yes"');
  }
  lines.push("---", "", spec.changed ? "Changed text." : "Text.");
  if (spec.image !== undefined) {
    lines.push("", `![plot](${spec.image})`);
  }
  return `${lines.join("\n")}\n`;
};

const record = (id: string, version: string, more: { variant?: string; failed?: boolean } = {}): string =>
  [
    "---",
    "logreq-record: 1",
    "kind: verification",
    `element: ${id}`,
    `version: ${version}`,
    "method: test",
    "item: build-1",
    `result: ${more.failed === true ? "failed" : "passed"}`,
    "date: 2026-10-27T10:00:00Z",
    ...(more.variant === undefined ? [] : [`variant: ${more.variant}`]),
    "---",
    "",
    "Generated.",
    "",
  ].join("\n");

/** The generated workspace: its element files by path, and the roles the named cases change. */
interface Generated {
  readonly specs: Map<string, Spec>;
  /** Requirements (file), top first: no ancestor but the need. */
  readonly requirements: readonly string[];
  /** The requirement with the most ancestors. */
  readonly deep: string;
  /** The requirement that embeds the image. */
  readonly pictured: string;
}

const ancestorsOf = (specs: ReadonlyMap<string, Spec>, file: string): Set<string> => {
  const byId = new Map([...specs.values()].map((s) => [s.id, s]));
  const found = new Set<string>();
  const stack = [...(specs.get(file)?.parents ?? [])];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (!found.has(id)) {
      found.add(id);
      stack.push(...(byId.get(id)?.parents ?? []));
    }
  }
  return found;
};

/** The parents of a new requirement: often the one before (a deep chain), else one or two earlier ones. */
const parentsAt = (random: Random, ids: readonly string[]): string[] =>
  random.next() < 0.5
    ? [ids.at(-1) ?? NEED]
    : [...new Set([random.pick(ids), ...(random.next() < 0.3 ? [random.pick(ids)] : [])])];

const generate = (random: Random, count: number, image: boolean): Generated => {
  const specs = new Map<string, Spec>();
  const add = (spec: Spec): void => {
    specs.set(spec.file, spec);
  };
  VARIANTS.forEach((id, i) => {
    add({
      file: `variants/VAR-${String(i)}.md`,
      id,
      type: "variant",
      status: "draft",
      title: `Variant ${String(i)}`,
      parents: [],
      validity: [],
      emergent: false,
      changed: false,
    });
  });
  add({
    file: "gen/N-0.md",
    id: NEED,
    type: "need",
    status: "draft",
    title: "A need",
    parents: [],
    validity: [],
    emergent: false,
    changed: false,
  });
  const requirements: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const ids = requirements.map((file) => specs.get(file)?.id ?? "");
    const parents = i < 3 ? [NEED] : parentsAt(random, ids);
    const roll = random.next();
    const file = `gen/SR-${String(i)}.md`;
    add({
      file,
      id: uuid(0x100 + i),
      type: "system-requirement",
      status: random.next() < 0.06 ? "obsolete" : "approved",
      title: `Requirement ${String(i)}`,
      parents,
      validity: roll < 0.12 ? [random.pick(VARIANTS)] : roll < 0.18 ? [VARIANTS[0], VARIANTS[2]] : [],
      emergent: random.next() < 0.05,
      changed: false,
    });
    requirements.push(file);
  }
  // A twin of one requirement in its repository (SR-088).
  const twinOf = specs.get(requirements[5] ?? "");
  if (twinOf !== undefined) {
    add({ ...twinOf, file: "gen/SR-5-twin.md", parents: [...twinOf.parents] });
  }
  const pictured = requirements.at(-1) ?? "";
  const picturedSpec = specs.get(pictured);
  if (picturedSpec !== undefined) {
    // Verified in the core by its own record.
    Object.assign(picturedSpec, { validity: [], emergent: false, status: "approved" });
    if (image) {
      picturedSpec.image = "img/plot.png";
    }
  }
  let deep = pictured;
  let most = -1;
  for (const file of requirements) {
    const size = ancestorsOf(specs, file).size;
    if (size > most) {
      most = size;
      deep = file;
    }
  }
  return { specs, requirements, deep, pictured };
};

/** Records of the generated requirements: about two thirds, in the core and per variant. */
const recordsOf = (
  random: Random,
  generated: Generated,
  versionOf: (file: string) => string | undefined,
  variants: readonly string[],
): Record<string, string> => {
  const files: Record<string, string> = {};
  const children = new Set([...generated.specs.values()].flatMap((s) => s.parents));
  let n = 0;
  for (const file of generated.requirements) {
    const spec = generated.specs.get(file);
    if (
      spec === undefined ||
      file === generated.pictured ||
      file === generated.deep ||
      (children.has(spec.id) && random.next() < 0.7) ||
      random.next() < 0.3
    ) {
      continue;
    }
    const version = random.next() < 0.8 ? (versionOf(file) ?? STALE) : STALE;
    const variant = random.next() < 0.35 ? random.pick(variants) : undefined;
    n += 1;
    files[`evidence/gen-${String(n)}.md`] = record(spec.id, version, {
      ...(variant === undefined ? {} : { variant }),
      failed: random.next() < 0.15,
    });
  }
  // The deep one and the one with the image: a record of their current version in the core.
  for (const [name, file] of [
    ["deep", generated.deep],
    ["pictured", generated.pictured],
  ] as const) {
    const spec = generated.specs.get(file);
    if (spec !== undefined) {
      files[`evidence/gen-${name}.md`] = record(spec.id, versionOf(file) ?? STALE);
    }
  }
  return files;
};

interface Opened {
  readonly fixture: FixtureWorkspace;
  readonly workspace: Workspace;
  readonly generated: Generated;
  readonly random: Random;
}

/**
 * Writes the generated workspace (on the SR-034 fixture, whose elements and records stay), computes
 * the current versions of its elements in a workspace of its own and writes the records against
 * them, then opens the workspace of the test.
 */
const open = async (
  seed: number,
  options: {
    count?: number;
    image?: boolean;
    files?: Readonly<Record<string, string>>;
    /** The variants records are written for (default all). */
    recordVariants?: readonly string[];
    /** Changes the generated elements before they are written. */
    adjust?: (generated: Generated) => void;
  } = {},
): Promise<Opened> => {
  const random = randomOf(seed);
  const generated = generate(random, options.count ?? 40, options.image ?? true);
  options.adjust?.(generated);
  const files: Record<string, string | Uint8Array> = {
    "gen/img/plot.png": new Uint8Array([1, 2, 3]),
    ...options.files,
  };
  for (const spec of generated.specs.values()) {
    files[spec.file] = render(spec);
  }
  const fixture = await createFixtureWorkspace({ fixture: "SR-034/indirect", files });
  onTestFinished(() => fixture.cleanup());
  const versions = new Map<string, string>();
  const first = new Workspace(fixture.root);
  try {
    const store = await first.get(elementStoreState);
    for (const [element, entry] of await currentVersionsOf(first, store.elements)) {
      if (entry.kind === "version") {
        versions.set(element.file, entry.version);
      }
    }
  } finally {
    await first.close();
  }
  for (const [file, text] of Object.entries(
    recordsOf(random, generated, (f) => versions.get(f), options.recordVariants ?? VARIANTS),
  )) {
    await fixture.write(file, text);
  }
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace, generated, random };
};

/** What callers see of the state, by repository and file: `verificationOf` and `validate` of each element. */
const table = async (
  status: StateStatus,
  store: ElementStore,
  only?: ReadonlySet<string>,
): Promise<Record<string, unknown>> => {
  const elements = store.elements.filter((e) => only?.has(e.file) ?? true);
  await status.prepare(elements, { own: true });
  const rows: Record<string, unknown> = {};
  for (const element of elements) {
    rows[`${element.repository}/${element.file}`] = {
      verification: verificationOf(status, element),
      validation: status.validate(element),
    };
  }
  return rows;
};

const stateOf = async (workspace: Workspace) => ({
  status: await workspace.get(verificationState),
  store: await workspace.get(elementStoreState),
});

/** The table of a fresh workspace on the same files. */
const freshTable = async (
  fixture: FixtureWorkspace,
  only?: ReadonlySet<string>,
): Promise<Record<string, unknown>> => {
  const fresh = new Workspace(fixture.root);
  try {
    const { status, store } = await stateOf(fresh);
    return await table(status, store, only);
  } finally {
    await fresh.close();
  }
};

/** The state of `workspace` equals a fresh build for every element and view (or those in `only`). */
const expectFresh = async (opened: Opened, only?: ReadonlySet<string>): Promise<void> => {
  const { status, store } = await stateOf(opened.workspace);
  expect(await table(status, store, only)).toEqual(await freshTable(opened.fixture, only));
};

/** Writes the files (undefined deletes one) and applies them as the watcher does (SR-007). */
const external = async (
  opened: Pick<Opened, "fixture" | "workspace">,
  files: Readonly<Record<string, string | undefined>>,
): Promise<void> => {
  const { fixture, workspace } = opened;
  for (const [file, text] of Object.entries(files)) {
    if (text === undefined) {
      await fs.rm(fixture.path(file));
    } else {
      await fixture.write(file, text);
    }
  }
  const layout = await workspace.get(workspaceLayoutState);
  const changed = await applyStoreChange(workspace, (store) =>
    updateElements(store, layout, new Map([["system", { paths: Object.keys(files) }]])),
  );
  expect(changed).toBeDefined();
};

/** Changes the spec of `file` and writes it as the watcher sees it. */
const edit = async (opened: Opened, file: string, change: (spec: Spec) => void): Promise<void> => {
  const spec = opened.generated.specs.get(file);
  if (spec === undefined) {
    throw new Error(`no spec ${file}`);
  }
  change(spec);
  await external(opened, { [file]: render(spec) });
};

const specOf = (opened: Opened, file: string): Spec => {
  const spec = opened.generated.specs.get(file);
  if (spec === undefined) {
    throw new Error(`no spec ${file}`);
  }
  return spec;
};

/** Builds the state and evaluates every element in every view, so every cache is filled. */
const built = async (opened: Opened): Promise<StateStatus> => {
  const { status, store } = await stateOf(opened.workspace);
  await table(status, store);
  return status;
};

/** The state was carried over the last change: there right after it, and another object. */
const expectCarried = (workspace: Workspace, before: Promise<StateStatus> | undefined): void => {
  const now = workspace.peek(verificationState);
  expect(now).toBeDefined();
  expect(now).not.toBe(before);
};

describe("verificationState carried over a change of the store (#698, ADR-0008)", () => {
  const cases: readonly {
    readonly name: string;
    readonly change: (opened: Opened) => Promise<void>;
  }[] = [
    {
      name: "the text of a recorded requirement deep in the tree",
      change: (o) => edit(o, o.generated.deep, (s) => (s.changed = true)),
    },
    {
      name: "a derivation added to a requirement",
      change: (o) =>
        edit(o, o.generated.deep, (s) => s.parents.push(specOf(o, o.generated.requirements[1] ?? "").id)),
    },
    {
      name: "a derivation removed",
      change: (o) => edit(o, o.generated.deep, (s) => (s.parents = s.parents.slice(1))),
    },
    {
      name: "a derivation pointed elsewhere",
      change: (o) =>
        edit(o, o.generated.deep, (s) => (s.parents = [specOf(o, o.generated.requirements[2] ?? "").id])),
    },
    {
      name: "a validity added to the top (no ancestors but the need) and removed again",
      change: async (o) => {
        const top = o.generated.requirements[0] ?? "";
        await edit(o, top, (s) => (s.validity = [VARIANTS[1]]));
        await expectFresh(o);
        await edit(o, top, (s) => (s.validity = []));
      },
    },
    {
      name: "a validity added deep in the tree and removed again",
      change: async (o) => {
        await edit(o, o.generated.deep, (s) => (s.validity = [VARIANTS[2]]));
        await expectFresh(o);
        await edit(o, o.generated.deep, (s) => (s.validity = "wrong"));
        await expectFresh(o);
        await edit(o, o.generated.deep, (s) => (s.validity = []));
      },
    },
    {
      name: "a derivation item that names nothing (no mapping with an id)",
      change: (o) => edit(o, o.generated.deep, (s) => s.parents.push("!just text")),
    },
    {
      name: "a status set to an invalid one",
      change: (o) => edit(o, o.generated.deep, (s) => (s.status = "obsolete")),
    },
    {
      name: "a requirement marked emergent",
      change: (o) => edit(o, o.generated.requirements[3] ?? "", (s) => (s.emergent = true)),
    },
    {
      name: "a twin added and removed (SR-088)",
      change: async (o) => {
        const deep = specOf(o, o.generated.deep);
        await external(o, { "gen/twin-deep.md": render({ ...deep, file: "gen/twin-deep.md" }) });
        await expectFresh(o);
        await external(o, { "gen/twin-deep.md": undefined });
      },
    },
    {
      name: "a parent that gets a twin in its repository (its children are unresolved)",
      change: async (o) => {
        const parent = specOf(o, o.generated.requirements[1] ?? "");
        await external(o, { "gen/twin-parent.md": render({ ...parent, file: "gen/twin-parent.md" }) });
      },
    },
    {
      name: "a file deleted and created again",
      change: async (o) => {
        const file = o.generated.requirements[4] ?? "";
        await external(o, { [file]: undefined });
        await expectFresh(o);
        await external(o, { [file]: render(specOf(o, file)) });
      },
    },
    {
      name: "a type changed away from a requirement and back",
      change: async (o) => {
        await edit(o, o.generated.requirements[2] ?? "", (s) => (s.type = "use-case"));
        await expectFresh(o);
        await edit(o, o.generated.requirements[2] ?? "", (s) => (s.type = "system-requirement"));
      },
    },
    {
      name: "a relation target that was missing comes with the change",
      change: async (o) => {
        const missing = uuid(0xfff);
        await edit(o, o.generated.deep, (s) => s.parents.push(missing));
        await expectFresh(o);
        const spec: Spec = {
          ...specOf(o, o.generated.requirements[0] ?? ""),
          file: "gen/SR-new.md",
          id: missing,
        };
        o.generated.specs.set(spec.file, spec);
        await external(o, { [spec.file]: render(spec) });
      },
    },
  ];

  it.each(cases)("equals a fresh build after $name", async ({ change }) => {
    const opened = await open(698);
    await built(opened);
    const before = opened.workspace.peek(verificationState);
    await change(opened);
    expectCarried(opened.workspace, before);
    await expectFresh(opened);
  });

  it("equals a fresh build over seeded random changes, with only some elements evaluated in between", async () => {
    for (const seed of [1, 2, 3]) {
      const opened = await open(seed, { count: 50 });
      const { random, generated } = opened;
      await built(opened);
      for (let round = 0; round < 12; round += 1) {
        const file = random.pick(generated.requirements);
        const spec = specOf(opened, file);
        const other = specOf(opened, random.pick(generated.requirements)).id;
        const kind = random.below(9);
        const before = opened.workspace.peek(verificationState);
        if (kind === 0) {
          await edit(opened, file, (s) => (s.changed = !s.changed));
        } else if (kind === 1) {
          // May close a cycle (#526 Q5).
          await edit(opened, file, (s) => s.parents.push(other));
        } else if (kind === 2) {
          await edit(opened, file, (s) => (s.parents = s.parents.slice(1)));
        } else if (kind === 3) {
          await edit(opened, file, (s) => (s.validity = random.next() < 0.5 ? [random.pick(VARIANTS)] : []));
        } else if (kind === 4) {
          await edit(opened, file, (s) => (s.status = s.status === "obsolete" ? "approved" : "obsolete"));
        } else if (kind === 5) {
          await edit(opened, file, (s) => (s.emergent = !s.emergent));
        } else if (kind === 6) {
          const twin = `gen/twin-${String(round)}.md`;
          await external(opened, { [twin]: render({ ...spec, file: twin }) });
        } else if (kind === 7) {
          await edit(
            opened,
            file,
            (s) => (s.type = s.type === "use-case" ? "system-requirement" : "use-case"),
          );
        } else {
          // Two files in one batch.
          const second = random.pick(generated.requirements);
          specOf(opened, second).changed = !specOf(opened, second).changed;
          spec.parents = [other];
          await external(opened, { [file]: render(spec), [second]: render(specOf(opened, second)) });
        }
        expectCarried(opened.workspace, before);
        // Only some elements, so the next change finds caches that are partly filled.
        const some = new Set(generated.requirements.filter(() => random.next() < 0.3));
        await expectFresh(opened, some);
      }
      await expectFresh(opened);
    }
  });

  it("reads again only the versions of the changed records (versionBatches grows by that batch)", async () => {
    const opened = await open(698, { image: false });
    const status = await built(opened);
    const batches = status.versionBatches();
    expect(batches).toBeGreaterThan(0);
    // An element without records: no version to read.
    await edit(opened, "gen/N-0.md", (s) => (s.title = "Another need"));
    const second = await built(opened);
    expect(second).not.toBe(status);
    expect(second.versionBatches()).toBe(batches);
    // A recorded requirement: one batch, its own version.
    await edit(opened, opened.generated.deep, (s) => (s.changed = true));
    const third = await built(opened);
    expect(third.versionBatches()).toBe(batches + 1);
    await expectFresh(opened);
  });

  it("leaves the old value as it was: a command that still holds it sees the store before the change", async () => {
    // The deep requirement is the only seed of the second variant (its validity; no record names
    // it), so the change below makes its ancestors clean there in the new store only.
    const opened = await open(698, {
      recordVariants: [VARIANTS[0], VARIANTS[2]],
      adjust: (generated) => {
        for (const spec of generated.specs.values()) {
          if (spec.validity !== "wrong" && spec.validity.includes(VARIANTS[1])) {
            spec.validity = spec.validity.filter((id) => id !== VARIANTS[1]);
          }
        }
        const deep = generated.specs.get(generated.deep);
        if (deep !== undefined) {
          deep.validity = [VARIANTS[1]];
        }
      },
    });
    const old = await built(opened);
    const { store } = await stateOf(opened.workspace);
    const before = await table(old, store);
    const { versions, walked } = old.caches;
    const sizes = [versions.size, walked.size];
    await edit(opened, opened.generated.deep, (s) => {
      s.changed = true;
      s.validity = [];
    });
    const carried = await opened.workspace.get(verificationState);
    expect(carried).not.toBe(old);
    await expectFresh(opened);
    // The old caches are the same objects with the same entries; the new ones are copies.
    expect(old.caches.versions).toBe(versions);
    expect(old.caches.walked).toBe(walked);
    expect([versions.size, walked.size]).toEqual(sizes);
    expect(carried.caches.versions).not.toBe(versions);
    expect(carried.caches.walked).not.toBe(walked);
    expect(await table(old, store)).toEqual(before);
    expect([versions.size, walked.size]).toEqual(sizes);
    expect(old.inputs.store).toBe(store);
  });

  it("keeps no record of an earlier store over a chain of changes (nothing of the old states is retained)", async () => {
    const opened = await open(698);
    await built(opened);
    for (const file of [
      opened.generated.deep,
      opened.generated.requirements[1] ?? "",
      opened.generated.pictured,
    ]) {
      await edit(opened, file, (s) => (s.changed = !s.changed));
      const carried = await built(opened);
      const records = new Set(carried.inputs.store.elements);
      expect([...carried.caches.versions.keys()].every((record) => records.has(record))).toBe(true);
      expect([...carried.caches.volatile].every((record) => records.has(record))).toBe(true);
      expect(carried.inputs.store).toBe(await opened.workspace.get(elementStoreState));
    }
  });

  it("equals a fresh build when only one element is prepared and a recorded leaf comes below it", async () => {
    // The leaf (verified by its own record) derives from a UUID no element has yet.
    const missing = uuid(0x3000);
    const opened = await open(698, {
      image: false,
      adjust: (generated) => {
        const leaf = generated.specs.get(generated.pictured);
        if (leaf !== undefined) {
          leaf.parents = [missing];
        }
      },
    });
    const { workspace, generated } = opened;
    const { status, store } = await stateOf(workspace);
    // A parent without records of its own, so its status comes from its children.
    const parent = store.elements.find(
      (e) =>
        generated.requirements.includes(e.file) &&
        e.file !== generated.pictured &&
        status.source.recordsOf(e.id).length === 0 &&
        !status.source.emergent(e) &&
        e.data["status"] !== "obsolete" &&
        e.data["validity"] === undefined,
    );
    if (parent === undefined) {
      throw new Error("no parent without records");
    }
    // As element.get prepares: the element shown only, its walk kept for the state.
    const rowOf = async (on: Awaited<ReturnType<typeof stateOf>>) => {
      const element = on.store.elements.find((e) => e.file === parent.file);
      if (element === undefined) {
        throw new Error("no parent");
      }
      await on.status.prepare([element]);
      return verificationOf(on.status, element);
    };
    await rowOf({ status, store });
    // The missing UUID comes, below the parent: the leaf is below the parent for the first time.
    const spec: Spec = {
      ...specOf(opened, parent.file),
      file: "gen/SR-missing.md",
      id: missing,
      parents: [parent.id],
    };
    opened.generated.specs.set(spec.file, spec);
    await external(opened, { [spec.file]: render(spec) });
    const fresh = new Workspace(opened.fixture.root);
    onTestFinished(() => fresh.close());
    const carried = await rowOf(await stateOf(workspace));
    expect(carried).toEqual(await rowOf(await stateOf(fresh)));
    expect(carried?.[0]).toMatchObject({ view: "core" });
  });

  it("carries each of two changes applied back to back with its own store and index (plan review B5)", async () => {
    const opened = await open(698);
    const { workspace } = opened;
    const old = await built(opened);
    // The status value not yet resolved while both changes are applied.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const from = workspace.peek(verificationState);
    expect(
      await workspace.replace(
        verificationState,
        from,
        held.then(() => old),
      ),
    ).toBe(true);
    await edit(
      opened,
      opened.generated.deep,
      (s) => (s.parents = [specOf(opened, opened.generated.requirements[1] ?? "").id]),
    );
    const first = workspace.peek(verificationState);
    const middle = await workspace.get(elementStoreState);
    await edit(
      opened,
      opened.generated.requirements[1] ?? "",
      (s) => (s.parents = [specOf(opened, opened.generated.requirements[2] ?? "").id]),
    );
    const last = await workspace.get(elementStoreState);
    release();
    expect((await first)?.inputs.store).toBe(middle);
    const memo = workspace.get(incomingState);
    expect((await first)?.inputs.incoming).toBe(memo.get(middle));
    expect((await workspace.get(verificationState)).inputs.store).toBe(last);
    expect((await workspace.get(verificationState)).inputs.incoming).toBe(memo.get(last));
    await expectFresh(opened);
  });

  it("equals a fresh build when a prepare of the old state is still reading versions during the change", async () => {
    const opened = await open(698);
    await built(opened);
    // Carried once, so the state's versions and walks are partly filled: the deep one is read again.
    await edit(opened, opened.generated.requirements[3] ?? "", (s) => (s.changed = true));
    const old = await opened.workspace.get(verificationState);
    expect(old.caches.versions.size).toBeGreaterThan(0);
    const { store } = await stateOf(opened.workspace);
    let release: () => void = () => undefined;
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    onTestFinished(() => {
      gate.hold = undefined;
    });
    const reading = table(old, store);
    await edit(opened, opened.generated.deep, (s) => (s.parents = [NEED]));
    expectCarried(opened.workspace, Promise.resolve(old));
    gate.hold = undefined;
    release();
    await reading;
    await expectFresh(opened);
  });

  it("reads an embedded image again at the next change of any file (review S4)", async () => {
    const opened = await open(698);
    const { fixture, generated } = opened;
    const status = await built(opened);
    const { store } = await stateOf(opened.workspace);
    const pictured = store.elements.find((e) => e.file === generated.pictured);
    expect(pictured).toBeDefined();
    if (pictured === undefined) {
      return;
    }
    expect(verificationOf(status, pictured)?.[0]).toEqual({ view: "core", status: "verified" });
    // The watcher does not report images: the element file is unchanged.
    await fs.writeFile(fixture.path("gen/img/plot.png"), new Uint8Array([4, 5, 6, 7]));
    await edit(opened, "gen/N-0.md", (s) => (s.title = "Another need"));
    const carried = await built(opened);
    const now = (await stateOf(opened.workspace)).store.elements.find((e) => e.file === generated.pictured);
    expect(now).toBe(pictured);
    expect(verificationOf(carried, pictured)?.[0]).toEqual({ view: "core", status: "outdated" });
    await expectFresh(opened);
  });

  it("reads again a version that could not be read, at the next change of any file", async () => {
    const opened = await open(698);
    const { fixture, generated } = opened;
    // Gone while the state reads it, back before the next change (neither reported).
    const text = await fs.readFile(fixture.path(generated.pictured), "utf8");
    await opened.workspace.get(elementStoreState);
    await fs.rm(fixture.path(generated.pictured));
    const status = await built(opened);
    const { store } = await stateOf(opened.workspace);
    const pictured = store.elements.find((e) => e.file === generated.pictured);
    if (pictured === undefined) {
      throw new Error("no pictured element");
    }
    expect(verificationOf(status, pictured)?.[0]).toEqual({ view: "core", status: "outdated" });
    await fixture.write(generated.pictured, text);
    await edit(opened, "gen/N-0.md", (s) => (s.title = "Another need"));
    expect(verificationOf(await built(opened), pictured)?.[0]).toEqual({ view: "core", status: "verified" });
    await expectFresh(opened);
  });
});

describe("verificationState built afresh or reset over a change of the store (#698)", () => {
  it("is built afresh from the change when a variant changes or comes (the views change)", async () => {
    const opened = await open(698);
    await built(opened);
    await edit(opened, "variants/VAR-1.md", (s) => (s.title = "Renamed"));
    expectCarried(opened.workspace, undefined);
    expect((await opened.workspace.get(verificationState)).versionBatches()).toBe(0);
    await expectFresh(opened);
    await built(opened);
    const added: Spec = { ...specOf(opened, "variants/VAR-1.md"), file: "variants/VAR-9.md", id: uuid(0xa9) };
    await external(opened, { [added.file]: render(added) });
    expect((await opened.workspace.get(verificationState)).versionBatches()).toBe(0);
    await expectFresh(opened);
  });

  it("is reset when the change names more than CARRY_LIMIT UUIDs (the incoming index is not carried)", async () => {
    const opened = await open(698, { count: 10 });
    await built(opened);
    const files: Record<string, string> = {};
    for (let i = 0; i < 1001; i += 1) {
      const spec: Spec = {
        ...specOf(opened, "gen/N-0.md"),
        file: `many/N-${String(i)}.md`,
        id: uuid(0x10000 + i),
      };
      files[spec.file] = render(spec);
    }
    await external(opened, files);
    expect(opened.workspace.peek(verificationState)).toBeUndefined();
    await expectFresh(opened);
  });

  it("is built afresh when the status put in place is of another store than the one changed", async () => {
    const opened = await open(698);
    const { workspace } = opened;
    const old = await built(opened);
    await edit(opened, opened.generated.deep, (s) => (s.changed = true));
    // A status of the store before that change, put in place by hand.
    expect(
      await workspace.replace(verificationState, workspace.peek(verificationState), Promise.resolve(old)),
    ).toBe(true);
    await edit(opened, opened.generated.requirements[1] ?? "", (s) => (s.changed = true));
    const now = await workspace.get(verificationState);
    expect(now.inputs.store).toBe(await workspace.get(elementStoreState));
    expect(now.versionBatches()).toBe(0);
    await expectFresh(opened);
  });

  it("is reset when the store before the change had no incoming index in the memo", async () => {
    const opened = await open(698);
    await built(opened);
    opened.workspace.get(incomingState).delete(await opened.workspace.get(elementStoreState));
    await edit(opened, opened.generated.deep, (s) => (s.changed = true));
    expect(opened.workspace.peek(verificationState)).toBeUndefined();
    await expectFresh(opened);
  });

  it("is reset when the store is replaced without an update (nothing tells what changed)", async () => {
    const opened = await open(698);
    await built(opened);
    const { workspace } = opened;
    const current = workspace.peek(elementStoreState);
    const store = await workspace.get(elementStoreState);
    expect(await workspace.replace(elementStoreState, current, Promise.resolve({ ...store }))).toBe(true);
    expect(workspace.peek(verificationState)).toBeUndefined();
  });

  it("is built afresh from the change while the metamodel is not valid (no records, no children)", async () => {
    const opened = await open(698, {
      files: {
        "metamodel/standard-model.yaml": `${await fs.readFile(
          new URL("../../../../fixtures/SR-034/indirect/metamodel/standard-model.yaml", import.meta.url),
          "utf8",
        )}  - { key: broken }\n`,
      },
    });
    const { workspace } = opened;
    const metamodel = await workspace.get(metamodelState);
    expect(metamodel.valid).toBe(false);
    await built(opened);
    // A chain would have built it; the status state builds none while the metamodel is not valid.
    incomingFor(workspace, await workspace.get(elementStoreState), metamodel);
    await edit(opened, opened.generated.deep, (s) => (s.changed = true));
    expectCarried(workspace, undefined);
    expect((await workspace.get(verificationState)).inputs.incoming).toBeUndefined();
    await expectFresh(opened);
  });

  it("is built afresh from the change when no relation kind has the meaning derivation (no children)", async () => {
    const model = await fs.readFile(
      new URL("../../../../fixtures/SR-034/indirect/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    );
    const opened = await open(698, {
      files: { "metamodel/standard-model.yaml": model.replaceAll("    meaning: derivation\n", "") },
    });
    const { workspace } = opened;
    expect((await workspace.get(metamodelState)).valid).toBe(true);
    const old = await built(opened);
    expect(old.children).toBeUndefined();
    await edit(opened, opened.generated.deep, (s) => (s.changed = true));
    expectCarried(workspace, undefined);
    const carried = await workspace.get(verificationState);
    expect(carried.inputs.incoming).toBe(workspace.get(incomingState).get(carried.inputs.store));
    await expectFresh(opened);
  });
});

describe("verificationState carried over changes across two repositories (#698, review S1)", () => {
  const P = uuid(0x2001);
  const Q = uuid(0x2002);
  const C1 = uuid(0x2011);
  const C2 = uuid(0x2012);
  const D = uuid(0x2021);
  const E = uuid(0x2022);
  const V = uuid(0x2030);
  const requirement = (id: string, parents: readonly string[], more = "", text = "Text."): string =>
    [
      "---",
      `id: ${id}`,
      "type: system-requirement",
      "status: approved",
      `title: Requirement ${id.slice(-4)}`,
      "requirement-type: functional",
      "acceptance-criteria:",
      "  - Given it runs, then it works.",
      ...(parents.length === 0 ? [] : ["derives-from:", ...parents.map((p) => `  - ${p}`)]),
      ...(more === "" ? [] : [more]),
      "---",
      "",
      text,
      "",
    ].join("\n");
  const inSystem = `{ id: ${NEED}, repository: system }`;
  const inProduct = (id: string): string => `{ id: ${id}, repository: product }`;

  it("equals a fresh build after changes of parents in another repository, a UUID in both and a move", async () => {
    const model = await fs.readFile(
      new URL("../../../../fixtures/SR-034/indirect/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    );
    const files: Record<string, string> = {
      "system/logreq-workspace.yaml": [
        "logreq-workspace: 1",
        "name: Two repositories",
        "repositories:",
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
        '  - { name: product, url: "git@git.example.com:ws/product.git" }',
        "metamodel: { repository: system, path: metamodel }",
        "evidence:",
        "  - { repository: system, path: evidence }",
        "",
      ].join("\n"),
      "system/metamodel/standard-model.yaml": model,
      "system/N-0.md": `---\nid: ${NEED}\ntype: need\nstatus: draft\ntitle: A need\n---\n\nText.\n`,
      "system/VAR-0.md": `---\nid: ${V}\ntype: variant\nstatus: draft\ntitle: A variant\n---\n\nText.\n`,
      "product/SR-P.md": requirement(P, [inSystem]),
      "product/SR-Q.md": requirement(Q, [inSystem]),
      "system/SR-C1.md": requirement(C1, [inProduct(P)]),
      "system/SR-C2.md": requirement(C2, [inProduct(P)], `validity:\n  - { id: ${V} }`),
      // One UUID in both repositories; E names the one of its own repository.
      "system/SR-D.md": requirement(D, [inProduct(P)]),
      "product/SR-D.md": requirement(D, [inProduct(Q)]),
      "system/SR-E.md": requirement(E, [`{ id: ${D} }`]),
    };
    const fixture = await createFixtureWorkspace({ files });
    onTestFinished(() => fixture.cleanup());
    const root = fixture.path("system");
    const versions = new Map<string, string>();
    const first = new Workspace(root);
    try {
      const store = await first.get(elementStoreState);
      for (const [element, entry] of await currentVersionsOf(first, store.elements)) {
        if (entry.kind === "version") {
          versions.set(element.id, entry.version);
        }
      }
    } finally {
      await first.close();
    }
    const records: Record<string, string> = {
      "system/evidence/c1.md": record(C1, versions.get(C1) ?? STALE),
      "system/evidence/c2.md": record(C2, versions.get(C2) ?? STALE, { variant: V }),
      "system/evidence/e.md": record(E, versions.get(E) ?? STALE),
    };
    for (const [file, text] of Object.entries(records)) {
      await fixture.write(file, text);
    }
    const workspace = new Workspace(root);
    onTestFinished(() => workspace.close());
    const all = async (on: Workspace): Promise<Record<string, unknown>> => {
      const { status, store } = await stateOf(on);
      return table(status, store);
    };
    const expectSame = async (): Promise<void> => {
      const fresh = new Workspace(root);
      try {
        expect(await all(workspace)).toEqual(await all(fresh));
      } finally {
        await fresh.close();
      }
    };
    /** Writes (undefined deletes) and applies the files of both repositories in one batch. */
    const change = async (changed: Readonly<Record<string, string | undefined>>): Promise<void> => {
      const paths = new Map<string, string[]>();
      for (const [file, text] of Object.entries(changed)) {
        if (text === undefined) {
          await fs.rm(fixture.path(file));
        } else {
          await fixture.write(file, text);
        }
        const [repository = "", ...rest] = file.split("/");
        paths.set(repository, [...(paths.get(repository) ?? []), rest.join("/")]);
      }
      const before = workspace.peek(verificationState);
      const layout = await workspace.get(workspaceLayoutState);
      const applied = await applyStoreChange(workspace, (store) =>
        updateElements(store, layout, new Map([...paths].map(([name, list]) => [name, { paths: list }]))),
      );
      expect(applied).toBeDefined();
      expectCarried(workspace, before);
      await expectSame();
    };
    const loaded = await workspace.get(elementStoreState);
    expect(
      loaded.byId
        .get(D)
        ?.map((e) => e.repository)
        .sort(),
    ).toEqual(["product", "system"]);
    await all(workspace);
    // The child in system: its text, then its parent in product pointed elsewhere.
    await change({ "system/SR-C1.md": requirement(C1, [inProduct(P)], "", "Changed text.") });
    await change({ "system/SR-C1.md": requirement(C1, [inProduct(Q)], "", "Changed text.") });
    // The parent in product changes; its children live in system.
    await change({ "product/SR-P.md": requirement(P, [inSystem], 'emergent: "yes"') });
    await change({ "product/SR-P.md": requirement(P, [inSystem]) });
    // The UUID in both repositories goes from one of them.
    await change({ "product/SR-D.md": undefined });
    // A requirement moved from system to product in one batch.
    await change({
      "system/SR-C2.md": undefined,
      "product/SR-C2.md": requirement(
        C2,
        [`{ id: ${P} }`],
        `validity:\n  - { id: ${V}, repository: system }`,
      ),
    });
  });
});

describe("carriedEvaluator (#698)", () => {
  it("builds a new evaluator when it is given a function that is no evaluator of this module", async () => {
    const opened = await open(698, { count: 5 });
    const store = await opened.workspace.get(elementStoreState);
    const source = statusSource(await opened.workspace.get(metamodelState), undefined);
    const fresh = verificationEvaluator(source, undefined, () => undefined);
    const carried = carriedEvaluator(
      () => undefined,
      source,
      undefined,
      () => undefined,
      new Set(),
    );
    for (const element of store.elements) {
      expect(carried(element, { kind: "core" })).toEqual(fresh(element, { kind: "core" }));
    }
  });
});

describe("the evidence index and verificationState carried over evidence.record (#278, plan §3.4)", () => {
  const DATE = "2026-10-28T10:00:00Z";
  /** Writes a record through the command, as every access does. */
  const recorded = async (
    opened: Opened,
    file: string,
    more: Readonly<Record<string, unknown>> = {},
  ): Promise<void> => {
    await invoke(
      "evidence.record",
      {
        ref: specOf(opened, file).id,
        kind: "verification",
        result: "passed",
        method: "inspection",
        item: "unit 1",
        date: DATE,
        ...more,
      },
      { workspace: opened.workspace },
    );
  };

  /** Everything the index tells, by element of the store (keys in any order). */
  const indexSeen = async (workspace: Workspace) => {
    const index: EvidenceIndex = await workspace.get(evidenceIndexState);
    const records = await workspace.get(evidenceRecordsState);
    const store = await workspace.get(elementStoreState);
    return {
      byElement: store.elements.map((e) => index.byElement.get(e.id)),
      testCases: [...index.testCases],
      testCasesOf: store.elements.map((e) => index.testCasesOf(e.id)),
      positions: records.map((r) => index.positionOf(r)),
      records,
    };
  };

  /** The index and the status equal a fresh build; both were carried. */
  const expectCarriedFresh = async (
    opened: Opened,
    before: { status: unknown; index: unknown },
  ): Promise<void> => {
    const { workspace } = opened;
    expect(workspace.peek(evidenceIndexState)).toBeDefined();
    expect(workspace.peek(evidenceIndexState)).not.toBe(before.index);
    expectCarried(workspace, before.status as Promise<StateStatus>);
    const seenHere = await indexSeen(workspace);
    expect(seenHere.positions).toEqual(seenHere.records.map((_, i) => i));
    const fresh = new Workspace(opened.fixture.root);
    try {
      expect(seenHere).toEqual(await indexSeen(fresh));
    } finally {
      await fresh.close();
    }
    await expectFresh(opened);
  };

  const peeked = (workspace: Workspace) => ({
    status: workspace.peek(verificationState),
    index: workspace.peek(evidenceIndexState),
  });

  /** A requirement without records or children that applies in every view: a leaf seen from its parent. */
  const bareLeaf = async (opened: Opened): Promise<string> => {
    const status = await opened.workspace.get(verificationState);
    const parents = new Set([...opened.generated.specs.values()].flatMap((s) => s.parents));
    const leaf = opened.generated.requirements.find((file) => {
      const spec = specOf(opened, file);
      return (
        !parents.has(spec.id) &&
        status.source.recordsOf(spec.id).length === 0 &&
        spec.validity.length === 0 &&
        !spec.emergent &&
        spec.status !== "obsolete" &&
        spec.parents.length > 0
      );
    });
    if (leaf === undefined) {
      throw new Error("no bare leaf");
    }
    return leaf;
  };

  it("equals a fresh build after records in the core, for a variant, with test cases and on a parent", async () => {
    const opened = await open(698);
    await built(opened);
    const steps: readonly (() => Promise<void>)[] = [
      () => recorded(opened, opened.generated.deep),
      () => recorded(opened, opened.generated.deep, { result: "failed", testCase: "TC-new" }),
      () =>
        recorded(opened, opened.generated.requirements[1] ?? "", {
          testCase: "TC-new",
          variant: VARIANTS[0],
        }),
      // A parent: its own record decides now (rule 1).
      () => recorded(opened, opened.generated.requirements[0] ?? ""),
      () => recorded(opened, "gen/N-0.md", { kind: "validation", method: undefined, item: undefined }),
    ];
    for (const step of steps) {
      const before = peeked(opened.workspace);
      await step();
      await expectCarriedFresh(opened, before);
    }
  });

  it("shows the first record for a variant on a leaf at its parent, which was evaluated before (review S1 of #714)", async () => {
    const opened = await open(698);
    await built(opened);
    const leaf = await bareLeaf(opened);
    const before = peeked(opened.workspace);
    await recorded(opened, leaf, { variant: VARIANTS[1] });
    await expectCarriedFresh(opened, before);
    const status = await opened.workspace.get(verificationState);
    const store = await opened.workspace.get(elementStoreState);
    const element = store.elements.find((e) => e.file === leaf);
    if (element === undefined) {
      throw new Error("no leaf");
    }
    expect(verificationOf(status, element)?.find((e) => e.view === VARIANTS[1])?.status).toBe("verified");
  });

  it("carries each of two records written back to back with its own index (plan review B5)", async () => {
    const opened = await open(698);
    const { workspace } = opened;
    const old = await built(opened);
    const leaf = await bareLeaf(opened);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    expect(
      await workspace.replace(
        verificationState,
        workspace.peek(verificationState),
        held.then(() => old),
      ),
    ).toBe(true);
    const before = peeked(workspace);
    await recorded(opened, opened.generated.deep);
    const first = workspace.peek(verificationState);
    const middle = workspace.peek(evidenceIndexState);
    await recorded(opened, leaf, { variant: VARIANTS[2] });
    release();
    expect((await first)?.inputs.index).toBe(await middle);
    expect((await workspace.get(verificationState)).inputs.index).toBe(
      await workspace.get(evidenceIndexState),
    );
    await expectCarriedFresh(opened, before);
  });

  it("keeps the versions read: the open after a record reads no version batch but those of the record", async () => {
    const opened = await open(698, { image: false });
    const status = await built(opened);
    await recorded(opened, opened.generated.deep);
    const carried = await built(opened);
    expect(carried.versionBatches()).toBe(status.versionBatches());
  });

  it("equals a fresh build after a record on a UUID with a twin (SR-088), and leaves the old status as it was", async () => {
    const opened = await open(698);
    const old = await built(opened);
    const { store } = await stateOf(opened.workspace);
    const before = await table(old, store);
    const peekedBefore = peeked(opened.workspace);
    // `gen/SR-5-twin.md` shares the UUID of `gen/SR-5.md`: evidence.record refuses the ambiguous
    // reference, so the record is written and put in as `updateEvidence` does.
    const { workspace, fixture } = opened;
    await fixture.write(
      "evidence/zz-twin.md",
      record(specOf(opened, "gen/SR-5-twin.md").id, STALE, { variant: VARIANTS[2] }),
    );
    const layout = await workspace.get(workspaceLayoutState);
    const added = (await readEvidence(layout)).records.find((r) => r.file === "evidence/zz-twin.md");
    if (added?.file === undefined || added.repository === undefined) {
      throw new Error("no record read back");
    }
    const placed = { ...added, repository: added.repository, file: added.file };
    const next = Promise.resolve(withRecord(layout, await workspace.get(evidenceReadState), placed));
    registerInsertion(next, placed);
    expect(await workspace.replace(evidenceReadState, workspace.peek(evidenceReadState), next)).toBe(true);
    await expectCarriedFresh(opened, peekedBefore);
    expect(await table(old, store)).toEqual(before);
  });

  it("equals a fresh build after a record that follows records put in place through the seam of #127", async () => {
    const opened = await open(698);
    const { workspace } = opened;
    await built(opened);
    const records = await workspace.get(evidenceRecordsState);
    expect(
      await workspace.replace(
        evidenceRecordsState,
        workspace.peek(evidenceRecordsState),
        Promise.resolve(records.slice(1)),
      ),
    ).toBe(true);
    await built(opened);
    await recorded(opened, opened.generated.deep);
    // Not carried from the injected records: built again from the read with the new record.
    expect(workspace.peek(evidenceIndexState)).toBeUndefined();
    expect(workspace.peek(verificationState)).toBeUndefined();
    const fresh = new Workspace(opened.fixture.root);
    try {
      expect(await indexSeen(workspace)).toEqual(await indexSeen(fresh));
    } finally {
      await fresh.close();
    }
    await expectFresh(opened);
  });

  it("resets the index and the status when the records are replaced by hand (the seam of #127)", async () => {
    const opened = await open(698);
    const { workspace } = opened;
    await built(opened);
    const records = await workspace.get(evidenceRecordsState);
    expect(
      await workspace.replace(
        evidenceRecordsState,
        workspace.peek(evidenceRecordsState),
        Promise.resolve([...records]),
      ),
    ).toBe(true);
    expect(workspace.peek(evidenceIndexState)).toBeUndefined();
    expect(workspace.peek(verificationState)).toBeUndefined();
  });

  it("resets the index and the status when the read is replaced without a registered record", async () => {
    const opened = await open(698);
    const { workspace } = opened;
    await built(opened);
    const read = await workspace.get(evidenceReadState);
    expect(
      await workspace.replace(
        evidenceReadState,
        workspace.peek(evidenceReadState),
        Promise.resolve({ ...read }),
      ),
    ).toBe(true);
    // The records follow the new read; the index and the status are built again.
    expect(await workspace.get(evidenceRecordsState)).toBe(read.records);
    expect(workspace.peek(evidenceIndexState)).toBeUndefined();
    expect(workspace.peek(verificationState)).toBeUndefined();
  });

  it("resets the status over a replace of another state it depends on", async () => {
    const opened = await open(698);
    const { workspace } = opened;
    await built(opened);
    expect(await workspace.replace(incomingState, workspace.peek(incomingState), new WeakMap())).toBe(true);
    expect(workspace.peek(verificationState)).toBeUndefined();
  });

  it("keeps the status as it is while the metamodel is not valid (the records are not compared)", async () => {
    const opened = await open(698, {
      files: {
        "metamodel/standard-model.yaml": `${await fs.readFile(
          new URL("../../../../fixtures/SR-034/indirect/metamodel/standard-model.yaml", import.meta.url),
          "utf8",
        )}  - { key: broken }\n`,
      },
    });
    const { workspace } = opened;
    expect((await workspace.get(metamodelState)).valid).toBe(false);
    const old = await built(opened);
    await workspace.get(evidenceIndexState);
    const read = await workspace.get(evidenceReadState);
    const [first] = read.records;
    if (first === undefined) {
      throw new Error("no record");
    }
    const added: EvidenceRecord = { ...first, file: "evidence/zz-added.md" };
    const next = Promise.resolve({ ...read, records: [...read.records, added] });
    registerInsertion(next, added);
    expect(await workspace.replace(evidenceReadState, workspace.peek(evidenceReadState), next)).toBe(true);
    expect(await workspace.get(verificationState)).toBe(old);
    expect((await workspace.get(evidenceIndexState)).byElement.get(added.element)).toContain(added);
  });

  it("is built afresh from the record when no relation kind has the meaning derivation", async () => {
    const model = await fs.readFile(
      new URL("../../../../fixtures/SR-034/indirect/metamodel/standard-model.yaml", import.meta.url),
      "utf8",
    );
    const opened = await open(698, {
      files: { "metamodel/standard-model.yaml": model.replaceAll("    meaning: derivation\n", "") },
    });
    const old = await built(opened);
    expect(old.children).toBeUndefined();
    const before = peeked(opened.workspace);
    await recorded(opened, opened.generated.deep);
    await expectCarriedFresh(opened, before);
    expect((await opened.workspace.get(verificationState)).versionBatches()).toBe(1);
  });
});
