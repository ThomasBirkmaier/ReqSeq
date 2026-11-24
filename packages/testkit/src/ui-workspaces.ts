// Workspaces for the tests of the web UI (ADR-0020, Tests): each one is written into a fresh temporary
// folder, so the tests may change it and never touch the checkout. The test kit cannot import
// `@reqseq/core` (core's tests import the test kit), so the caller passes `run`, which runs a catalog
// command in a workspace (core's `invoke`, or the CLI). Elements, baselines and evidence records are
// made through those commands, so their versions are the ones ReqSeq computes. Git is written here
// only, in the test kit; ReqSeq itself never writes Git (D-036).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FileContent, FixtureWorkspace } from "./fixture-workspace.js";
import { createFixtureWorkspace, initRepository } from "./fixture-workspace.js";

/** `spec/` of this repository (same depth from `src/` and `dist/`). */
export const defaultSpecDir: string = fileURLToPath(new URL("../../../spec/", import.meta.url));

/** Runs the catalog command `command` (such as `element.create`) in the workspace at `root` and resolves with its output. */
export type RunCommand = (
  root: string,
  command: string,
  input: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export interface UiWorkspaceOptions {
  readonly run: RunCommand;
  /** Parent of the temporary folder. Default: the OS temp folder. */
  readonly tempDir?: string;
}

export interface SpecCopyOptions extends UiWorkspaceOptions {
  /** The specification to copy. Default: `spec/` of this repository. */
  readonly specDir?: string;
}

/** The baseline the generated history of the spec copy holds. */
export const SPEC_COPY_BASELINE = "Generated";

/** Elements of the spec copy whose text changed after the baseline, by spec ID. */
export const SPEC_COPY_CHANGED: readonly string[] = ["N-001", "SR-001", "SR-036"];

/** The paragraph the earlier state of each changed element ends with. */
export const EARLIER_DRAFT = "Earlier draft of this element (generated history).";

export interface SpecCopyWorkspace extends FixtureWorkspace {
  /** Spec ID of the system requirement that was added after the baseline. */
  readonly added: string;
  /** Commit IDs of the history, oldest first: earlier state, baseline, current state. */
  readonly commits: readonly string[];
}

const WORKSPACE_FILE = "reqseq-workspace.yaml";

const execFileAsync = promisify(execFile);

/** The spec ID the frontmatter of an element file gives, if any. */
const specIdOf = (content: string): string | undefined =>
  /^spec-id: "?([A-Z]+-\d+)"?\r?$/m.exec(content)?.[1];

/** The UUID the frontmatter of an element file gives (every element file has one). */
const uuidOf = (content: string): string => String(/^id: (\S+)\r?$/m.exec(content)?.[1]);

/**
 * Every file Git tracks below `dir`, by path relative to it with forward slashes, as it is in the
 * working tree: untracked and ignored files (`.DS_Store`, editor backups) are left out. Inherited
 * GIT_* variables (for example GIT_DIR inside a Git hook) would redirect the command.
 */
const readTree = async (dir: string): Promise<Map<string, Buffer>> => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")),
  );
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--cached", "--", "."], {
    cwd: dir,
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = new Map<string, Buffer>();
  for (const file of stdout.split("\0").filter((f) => f !== "")) {
    files.set(file, await fs.readFile(path.join(dir, ...file.split("/"))));
  }
  return files;
};

/** A catalog command run in the workspace being generated. */
export type BoundCommand = (command: string, input: Readonly<Record<string, unknown>>) => Promise<unknown>;

/** Makes a fixture workspace with `files`, builds it with `build`, and removes it again when that fails. */
const generate = async <T>(
  options: UiWorkspaceOptions,
  files: Readonly<Record<string, FileContent>>,
  build: (workspace: FixtureWorkspace, run: BoundCommand) => Promise<T>,
): Promise<T> => {
  const workspace = await createFixtureWorkspace({
    files,
    ...(options.tempDir === undefined ? {} : { tempDir: options.tempDir }),
  });
  try {
    return await build(workspace, (command, input) => options.run(workspace.root, command, input));
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
};

/**
 * A copy of the specification with a generated Git history of three commits: an earlier state, in
 * which the elements of `SPEC_COPY_CHANGED` end with the paragraph `EARLIER_DRAFT` and the newest
 * system requirement no other file outside `baselines/` names is missing; the baseline `SPEC_COPY_BASELINE` of that
 * state; and the specification as it is. So `baseline.compare` finds three changed elements and one
 * added one, and the version dates of these four differ from the others. The baselines the
 * specification brings name commits of this repository, which the copy does not have.
 */
export async function createSpecCopyWorkspace(options: SpecCopyOptions): Promise<SpecCopyWorkspace> {
  const files = await readTree(options.specDir ?? defaultSpecDir);
  const elements = [...files]
    .filter(([file]) => file.endsWith(".md") && !file.startsWith("evidence/"))
    .map(([file, bytes]) => ({ file, content: bytes.toString("utf8") }))
    .filter(({ content }) => /^---\r?\n/.test(content));
  const fileOf = (specId: string): string => {
    const element = elements.find(({ content }) => specIdOf(content) === specId);
    if (element === undefined) {
      throw new Error(`the specification has no element ${specId}`);
    }
    return element.file;
  };
  const changed = SPEC_COPY_CHANGED.map(fileOf);
  // A baseline names every element it holds, so only the other files decide which one no file names.
  const others = [...files]
    .filter(([file]) => !file.startsWith("evidence/") && !file.startsWith("baselines/"))
    .map(([file, bytes]) => ({ file, content: bytes.toString("utf8") }));
  const number = (specId: string): number => Number(specId.slice(specId.indexOf("-") + 1));
  const added = elements
    .flatMap(({ file, content }) => {
      const specId = specIdOf(content);
      return specId?.startsWith("SR-") === true ? [{ file, specId, uuid: uuidOf(content) }] : [];
    })
    .filter(({ file, uuid }) => others.every((o) => o.file === file || !o.content.includes(uuid)))
    .sort((a, b) => number(b.specId) - number(a.specId))[0];
  if (added === undefined) {
    throw new Error("the specification has no system requirement that no other file names");
  }
  const earlier: Record<string, FileContent> = Object.fromEntries(
    [...files]
      .filter(([file]) => file !== added.file)
      .map(([file, bytes]) => [
        file,
        changed.includes(file) ? `${bytes.toString("utf8")}\n${EARLIER_DRAFT}\n` : bytes,
      ]),
  );

  return generate(options, {}, async (workspace, run) => {
    await initRepository(workspace);
    await workspace.commitHistory([{ name: "earlier", files: earlier, message: "Earlier state" }], {
      branch: "main",
    });
    await workspace.git(["-c", "checkout.workers=0", "reset", "--hard", "--quiet"]);
    await run("baseline.create", { name: SPEC_COPY_BASELINE, selection: {} });
    await workspace.commit(".", `Baseline ${SPEC_COPY_BASELINE}`);
    const restored = [...changed, added.file];
    for (const [file, bytes] of [...files].filter(([file]) => restored.includes(file))) {
      await workspace.write(file, bytes);
    }
    await workspace.commit(".", "Current state");
    const commits = (await workspace.git(["rev-list", "--reverse", "HEAD"])).trim().split("\n");
    return { ...workspace, added: added.specId, commits };
  });
}

/** A workspace file with one repository, the workspace root, and its evidence folder. */
const workspaceFile = (name: string, repository: string): string =>
  [
    "reqseq-workspace: 1",
    `name: ${name}`,
    "repositories:",
    `  - name: ${repository}`,
    '    url: ""',
    "    main: true",
    "metamodel:",
    `  repository: ${repository}`,
    "  path: metamodel",
    "evidence:",
    `  - { repository: ${repository}, path: evidence }`,
    "",
  ].join("\n");

export interface Seeder {
  /** The UUID of the element created under `key`. */
  readonly id: (key: string) => string;
  /** Creates an element with relations to the elements of the given keys and returns its file. */
  readonly create: (
    key: string,
    type: string,
    title: string,
    text: string,
    properties?: Readonly<Record<string, unknown>>,
    relations?: Readonly<Record<string, string>>,
  ) => Promise<string>;
}

/** Creates elements through `run` and keeps their UUIDs by a local key, which `id` gives back. */
export const createSeeder = (run: BoundCommand): Seeder => {
  const ids = new Map<string, string>();
  const id = (key: string): string => {
    const value = ids.get(key);
    if (value === undefined) {
      throw new Error(`unknown seed key ${key}`);
    }
    return value;
  };
  const create = async (
    key: string,
    type: string,
    title: string,
    text: string,
    properties: Readonly<Record<string, unknown>> = {},
    relations: Readonly<Record<string, string>> = {},
  ): Promise<string> => {
    const output = (await run("element.create", {
      type,
      title,
      text,
      properties,
      relations: Object.fromEntries(Object.entries(relations).map(([kind, key]) => [kind, [id(key)]])),
    })) as { readonly element: { readonly id: string }; readonly files: readonly string[] };
    ids.set(key, output.element.id);
    return String(output.files[0]);
  };
  return { id, create };
};

/**
 * The metamodel of the Orbit Lab workspace: other type names and keys than the standard model, an
 * abstract requirement type with two subtypes, the statuses Proposed, Agreed, Shipped and Withdrawn,
 * no glossary, and an identifier property `ref-code`.
 */
export const ORBIT_MODEL = `reqseq-metamodel: 1
types:
  - { key: goal, name: Goal, description: "Something a customer wants to achieve.", prefix: G, meaning: need, properties: [title, ref-code, motivation, success-signs, belongs-to, horizon], required: [title] }
  - { key: commitment, name: Commitment, description: "What the product promises, in general.", prefix: CM, abstract: true, meaning: requirement, properties: [title, ref-code, motivation, checks, applies-in, belongs-to, proof, effort], required: [title, checks] }
  - { key: capability, name: Capability, description: "Something the product can do.", prefix: CAP, extends: commitment, properties: [surface], required: [surface] }
  - { key: constraint, name: Constraint, description: "A limit the product keeps.", prefix: CON, extends: commitment }
  - { key: risk, name: Risk, description: "Something that could go wrong.", prefix: RSK, properties: [title, ref-code, motivation, impact, due-date, belongs-to], required: [title, impact] }
  - { key: persona, name: Persona, description: "A kind of person who uses the product.", prefix: P, properties: [title, motivation], required: [title] }
  - { key: edition, name: Edition, description: "A product edition built on the shared core.", prefix: ED, meaning: variant, properties: [title, ref-code], required: [title] }
  - { key: area, name: Area, description: "A part of the product that groups elements.", prefix: AR, meaning: package, properties: [title, ref-code], required: [title] }
properties:
  - { key: title, name: Name, kind: text, meaning: title }
  - { key: ref-code, name: Ref, kind: text, meaning: identifier, description: "The code people use for it." }
  - { key: motivation, name: Why, kind: text, markdown: true, description: "Why it matters." }
  - { key: success-signs, name: Success Signs, kind: text, many: true, content: true, description: "How we will know the goal is reached." }
  - { key: checks, name: Checks, kind: text, many: true, content: true, markdown: true, meaning: acceptance-criteria, description: "Each check shows the commitment is kept." }
  - { key: surface, name: Surface, kind: choice, content: true, choices: [ { key: app, name: App }, { key: api, name: API }, { key: backend, name: Back end } ] }
  - { key: impact, name: Impact, kind: choice, choices: [ { key: severe, name: Severe }, { key: moderate, name: Moderate }, { key: minor, name: Minor } ] }
  - { key: effort, name: Effort Points, kind: number }
  - { key: due-date, name: Review By, kind: date }
  - { key: horizon, name: Horizon, kind: choice, choices: [ { key: now, name: Now }, { key: next, name: Next }, { key: later, name: Later } ] }
  - { key: applies-in, name: Editions, kind: relation, many: true, target-types: [edition], content: true, meaning: validity }
  - { key: belongs-to, name: Areas, kind: relation, many: true, target-types: [area], meaning: packages }
  - { key: proof, name: Proof, kind: choice, meaning: verification-method, choices: [ { key: test, name: Test }, { key: analysis, name: Analysis }, { key: inspection, name: Inspection }, { key: demonstration, name: Demonstration } ] }
relations:
  - { key: serves, name: Serves, inverse-name: Served by, source-types: [commitment], target-types: [goal], meaning: derivation, limits: [ { source-type: capability, target-type: goal, min: 1 } ] }
  - { key: details, name: Details, inverse-name: Detailed by, source-types: [commitment], target-types: [commitment], meaning: derivation }
  - { key: guards-against, name: Guards against, inverse-name: Guarded by, source-types: [constraint], target-types: [risk] }
  - { key: wanted-by, name: Wanted by, inverse-name: Wants, source-types: [goal], target-types: [persona] }
  - { key: follows-up, name: Follows up, inverse-name: Followed up by, meaning: succession }
  - { key: overrides, name: Overrides, inverse-name: Overridden by, source-types: [commitment], target-types: [commitment], meaning: replacement }
  - { key: leaves-out, name: Leaves out, inverse-name: Left out by, source-types: [edition], target-types: [commitment], meaning: exclusion }
statuses:
  - { key: proposed, name: Proposed, initial: true }
  - { key: agreed, name: Agreed }
  - { key: shipped, name: Shipped }
  - { key: withdrawn, name: Withdrawn, invalid: true }
`;

/** The baseline of the Orbit Lab workspace, made after its first commit. */
export const ORBIT_BASELINE = "Beta 1";

/**
 * The Orbit Lab workspace: a workspace with the unusual metamodel `ORBIT_MODEL`, two editions (one
 * excludes a capability, the constraint CON-3 of one overrides the capability CAP-100 of the core), statuses set, evidence
 * records, and the constraint CON-2 with acceptance criteria without keys, as a hand-written or
 * imported file has them. Its Git history has three commits: the first state, the baseline
 * `ORBIT_BASELINE`, and a change of CAP-101 and the new constraint CON-4 after it.
 */
export async function createOrbitLabWorkspace(options: UiWorkspaceOptions): Promise<FixtureWorkspace> {
  return generate(
    options,
    {
      [WORKSPACE_FILE]: workspaceFile("Orbit Lab", "orbit"),
      "metamodel/orbit-model.yaml": ORBIT_MODEL,
    },
    async (workspace, run) => {
      await fs.mkdir(workspace.path("evidence"));
      const { id, create } = createSeeder(run);
      const areas = (key: string): Readonly<Record<string, unknown>> => ({ "belongs-to": [id(key)] });
      await create("core", "area", "Mission planning", "", { "ref-code": "AR-1" });
      await create("ops", "area", "Ground operations", "", { "ref-code": "AR-2" });
      await create("pro", "edition", "Professional", "The edition for agencies.", { "ref-code": "ED-PRO" });
      await create("edu", "edition", "Classroom", "The edition for schools.", { "ref-code": "ED-EDU" });
      await create("p1", "persona", "Flight director", "Leads a mission from launch to landing.", {
        motivation: "Owns every go/no-go decision.",
      });
      await create("p2", "persona", "Teacher", "Uses simulated missions in class.");
      await create(
        "g1",
        "goal",
        "Plan a mission in an afternoon",
        "A flight director can plan a complete orbit mission without a specialist.",
        {
          "ref-code": "G-01",
          horizon: "now",
          "success-signs": ["A new user plans a mission in under four hours.", "No spreadsheet is needed."],
          ...areas("core"),
        },
        { "wanted-by": "p1" },
      );
      await create(
        "g2",
        "goal",
        "See the spacecraft at all times",
        "Ground staff always know where the spacecraft is.",
        { "ref-code": "G-02", horizon: "next", ...areas("ops") },
        { "wanted-by": "p1" },
      );
      await create(
        "g3",
        "goal",
        "Teach orbital mechanics",
        "Pupils understand why orbits work, by trying them.",
        { "ref-code": "G-03", horizon: "later" },
        { "wanted-by": "p2" },
      );
      await create(
        "g4",
        "goal",
        "Share a plan with partners",
        "A plan can go to partner agencies in a form they read.",
        {
          "ref-code": "G-04",
        },
      );
      await create(
        "r1",
        "risk",
        "Wrong time zone in the timeline",
        "Events shown in local time are read as UTC.",
        {
          "ref-code": "RSK-1",
          impact: "severe",
          "due-date": "2026-12-15",
          ...areas("ops"),
        },
      );
      await create(
        "r2",
        "risk",
        "Lost connection during a pass",
        "A ground station drops out while the spacecraft is overhead.",
        {
          "ref-code": "RSK-2",
          impact: "moderate",
        },
      );
      const capability = (
        key: string,
        ref: string,
        title: string,
        text: string,
        surface: string,
        checks: readonly string[],
        relations: Readonly<Record<string, string>>,
        extra: Readonly<Record<string, unknown>> = {},
      ): Promise<string> =>
        create(key, "capability", title, text, { "ref-code": ref, surface, checks, ...extra }, relations);
      await capability(
        "c1",
        "CAP-100",
        "Draw the orbit",
        "The app draws the planned orbit over a map of the Earth.",
        "app",
        ["The orbit appears within two seconds of a change.", "Day and night are shaded."],
        { serves: "g1" },
        { proof: "test", effort: 5, ...areas("core") },
      );
      await capability(
        "c2",
        "CAP-101",
        "Warn about conflicts",
        "The app warns when two planned events overlap.",
        "app",
        [
          "Overlapping events are marked in the timeline.",
          "The warning names both events.",
          "A warning can be dismissed.",
        ],
        { serves: "g1", details: "c1" },
        { proof: "test", ...areas("core") },
      );
      await capability(
        "c3",
        "CAP-102",
        "Track live position",
        "The back end streams the current position to every open client.",
        "backend",
        ["The position is at most five seconds old."],
        { serves: "g2" },
        { proof: "demonstration", ...areas("ops") },
      );
      await capability(
        "c4",
        "CAP-103",
        "Export a plan",
        "A plan can be exported as a document partners can open.",
        "api",
        ["The export opens in a browser without this product."],
        { serves: "g4" },
        { proof: "inspection" },
      );
      await capability(
        "c5",
        "CAP-104",
        "Guided lessons",
        "Lessons walk pupils through one manoeuvre each.",
        "app",
        ["Each lesson ends with a short quiz."],
        { serves: "g3" },
        { "applies-in": [id("edu")] },
      );
      await capability(
        "c6",
        "CAP-105",
        "Fleet view",
        "Several spacecraft are shown at once.",
        "app",
        ["Up to twenty spacecraft are shown without slowing down."],
        {},
        { proof: "test", "applies-in": [id("pro")] },
      );
      await create(
        "k1",
        "constraint",
        "Times in UTC",
        "Every time shown carries its zone, and UTC is the default.",
        {
          "ref-code": "CON-1",
          checks: ["No time is shown without its zone."],
          proof: "inspection",
          ...areas("ops"),
        },
        { serves: "g2", "guards-against": "r1" },
      );
      const keyless = await create(
        "k2",
        "constraint",
        "Works offline for a pass",
        "Planning stays possible for 20 minutes without a connection.",
        {
          "ref-code": "CON-2",
          checks: ["Edits made offline are kept.", "The user is told when the connection returns."],
        },
        { serves: "g2", "guards-against": "r2" },
      );
      await create(
        "k3",
        "constraint",
        "Simple maths in Classroom",
        "The Classroom edition shows rounded values only.",
        { "ref-code": "CON-3", checks: ["Values are rounded to two digits."], "applies-in": [id("edu")] },
        { serves: "g3", overrides: "c1" },
      );
      await run("variant.exclude", { variant: id("edu"), refs: [id("c3")] });
      // Statuses are set by people (D-030); here they are test data.
      await run("element.setStatus", {
        refs: ["g1", "g2", "c1", "c2", "c3", "k1", "p1"].map(id),
        status: "agreed",
      });
      await run("element.setStatus", { refs: [id("c4")], status: "shipped" });
      const item = "build 2.4.0";
      await run("evidence.record", {
        ref: id("c1"),
        kind: "verification",
        result: "passed",
        method: "test",
        item,
        testCase: "orbit drawing",
      });
      await run("evidence.record", {
        ref: id("c2"),
        kind: "verification",
        result: "failed",
        method: "test",
        item,
        criteria: [2],
      });
      await run("evidence.record", {
        ref: id("k1"),
        kind: "verification",
        result: "passed",
        method: "inspection",
        item,
      });
      await run("evidence.record", { ref: id("g1"), kind: "validation", result: "passed" });
      // CON-2 as a hand-written or imported file has it: acceptance criteria without keys.
      const file = workspace.path(keyless);
      await fs.writeFile(
        file,
        (await fs.readFile(file, "utf8")).replace(/ {2}- key: [a-z0-9]+\r?\n {4}text: /g, "  - "),
      );

      await initRepository(workspace);
      await workspace.commit(".", "Orbit Lab: first state");
      await run("baseline.create", { name: ORBIT_BASELINE, selection: {} });
      await workspace.commit(".", `Baseline ${ORBIT_BASELINE}`);
      const { fileSha256 } = (await run("element.get", { ref: "CAP-101" })) as {
        readonly fileSha256: string;
      };
      await run("element.update", {
        ref: "CAP-101",
        expectedFileSha256: fileSha256,
        set: { effort: 8 },
        text: "The app warns when two planned events overlap, and suggests a new time.",
      });
      await create(
        "k4",
        "constraint",
        "Readable in sunlight",
        "Screens stay readable outdoors.",
        { "ref-code": "CON-4", checks: ["Contrast stays above 7:1."] },
        { serves: "g2" },
      );
      await workspace.commit(".", `After ${ORBIT_BASELINE}`);
      return workspace;
    },
  );
}

/**
 * The metamodel of the safety workspace: stakeholders, needs, hazards and system requirements, and no
 * property with the meaning identifier, so elements are known by their short IDs only.
 */
export const SAFETY_MODEL = `reqseq-metamodel: 1
types:
  - { key: stakeholder, name: Stakeholder, description: "A person or group with a stake in the system.", prefix: STK, properties: [title, role], required: [title] }
  - { key: need, name: Need, description: "What a stakeholder needs, in their own words.", prefix: N, meaning: need, properties: [title, rationale, packages], required: [title] }
  - { key: hazard, name: Hazard, description: "A state of the system that can lead to harm.", prefix: HAZ, properties: [title, severity, packages], required: [title, severity] }
  - { key: system-requirement, name: System Requirement, description: "What the system must do or be.", prefix: SR, meaning: requirement, properties: [title, rationale, acceptance-criteria, verification-method, packages], required: [title, acceptance-criteria] }
  - { key: package, name: Package, description: "A set of elements that belong together.", prefix: PKG, meaning: package, properties: [title], required: [title] }
properties:
  - { key: title, name: Title, kind: text, meaning: title }
  - { key: role, name: Role, kind: text }
  - { key: rationale, name: Rationale, kind: text, markdown: true }
  - { key: severity, name: Severity, kind: choice, choices: [ { key: catastrophic, name: Catastrophic }, { key: major, name: Major }, { key: minor, name: Minor } ] }
  - { key: acceptance-criteria, name: Acceptance Criteria, kind: text, many: true, content: true, markdown: true, meaning: acceptance-criteria }
  - { key: verification-method, name: Verification Method, kind: choice, meaning: verification-method, choices: [ { key: test, name: Test }, { key: analysis, name: Analysis }, { key: inspection, name: Inspection }, { key: demonstration, name: Demonstration } ] }
  - { key: packages, name: Package, kind: relation, many: true, target-types: [package], meaning: packages }
relations:
  - { key: raised-by, name: Raised by, inverse-name: Raises, source-types: [need, hazard], target-types: [stakeholder] }
  - { key: derives-from, name: Derives from, inverse-name: Derived by, source-types: [system-requirement], target-types: [need, system-requirement], meaning: derivation }
  - { key: mitigates, name: Mitigates, inverse-name: Mitigated by, source-types: [system-requirement], target-types: [hazard] }
  - { key: supersedes, name: Supersedes, inverse-name: Superseded by, meaning: succession }
statuses:
  - { key: draft, name: Draft, initial: true }
  - { key: approved, name: Approved }
  - { key: obsolete, name: Obsolete, invalid: true }
`;

/**
 * A small safety workspace without identifiers (`SAFETY_MODEL`): stakeholders, needs raised by
 * them, hazards with their severity, and system requirements that derive from the needs and
 * mitigate the hazards, with statuses set and evidence records, in one Git commit.
 */
export async function createNoIdentifierWorkspace(options: UiWorkspaceOptions): Promise<FixtureWorkspace> {
  return generate(
    options,
    {
      [WORKSPACE_FILE]: workspaceFile("Cargo Drone", "drone"),
      "metamodel/safety-model.yaml": SAFETY_MODEL,
    },
    async (workspace, run) => {
      await fs.mkdir(workspace.path("evidence"));
      const { id, create } = createSeeder(run);
      const pkg = (key: string): Readonly<Record<string, unknown>> => ({ packages: [id(key)] });
      await create("flight", "package", "Flight", "");
      await create("cargo", "package", "Cargo handling", "");
      await create("operator", "stakeholder", "Drone operator", "Plans and watches each delivery flight.", {
        role: "Operations",
      });
      await create("recipient", "stakeholder", "Recipient", "Receives the parcel at the drop point.");
      await create(
        "authority",
        "stakeholder",
        "Aviation authority",
        "Approves flights over populated areas.",
        {
          role: "Regulator",
        },
      );
      await create(
        "n1",
        "need",
        "Deliver parcels on time",
        "A parcel arrives within the promised time window.",
        pkg("cargo"),
        {
          "raised-by": "recipient",
        },
      );
      await create(
        "n2",
        "need",
        "Know where the drone is",
        "The operator always sees the position and state of the drone.",
        pkg("flight"),
        {
          "raised-by": "operator",
        },
      );
      await create(
        "n3",
        "need",
        "Fly safely over people",
        "Flights over people meet the rules of the authority.",
        pkg("flight"),
        {
          "raised-by": "authority",
        },
      );
      await create(
        "h1",
        "hazard",
        "Loss of the control link",
        "The drone no longer receives commands from the ground station.",
        { severity: "major", ...pkg("flight") },
        { "raised-by": "operator" },
      );
      await create(
        "h2",
        "hazard",
        "Parcel drops during flight",
        "The parcel comes loose before the drop point.",
        { severity: "catastrophic", ...pkg("cargo") },
        { "raised-by": "authority" },
      );
      await create("h3", "hazard", "Battery runs out", "The battery is empty before the drone has landed.", {
        severity: "major",
        ...pkg("flight"),
      });
      const requirement = (
        key: string,
        title: string,
        text: string,
        criteria: readonly string[],
        relations: Readonly<Record<string, string>>,
        extra: Readonly<Record<string, unknown>> = {},
      ): Promise<string> =>
        create(
          key,
          "system-requirement",
          title,
          text,
          { "acceptance-criteria": criteria, ...extra },
          relations,
        );
      await requirement(
        "s1",
        "Return home on link loss",
        "When the control link is lost for more than 5 seconds, the drone must fly back to its start point.",
        [
          "Given a flight, when the link is cut for 6 seconds, then the drone turns back.",
          "The operator is told why.",
        ],
        { "derives-from": "n3", mitigates: "h1" },
        { "verification-method": "test", ...pkg("flight") },
      );
      await requirement(
        "s2",
        "Show the position live",
        "The ground station must show the position of the drone at most 2 seconds late.",
        ["The shown position is at most 2 seconds old."],
        { "derives-from": "n2" },
        { "verification-method": "demonstration", ...pkg("flight") },
      );
      await requirement(
        "s3",
        "Lock the parcel",
        "The cargo hook must stay locked until the drone hovers over the drop point.",
        ["A pull of 50 N does not open the locked hook.", "The hook opens only over the drop point."],
        { "derives-from": "n1", mitigates: "h2" },
        { "verification-method": "test", ...pkg("cargo") },
      );
      await requirement(
        "s4",
        "Keep a battery reserve",
        "A flight must be planned so that 20 % of the battery is left at landing.",
        ["The planner refuses a route that leaves less than 20 %."],
        { "derives-from": "n3", mitigates: "h3" },
        { "verification-method": "analysis" },
      );
      await requirement(
        "s5",
        "Warn before the reserve",
        "The ground station must warn the operator when the battery reaches 30 %.",
        ["The warning appears at 30 % and names the time left."],
        { "derives-from": "s4", mitigates: "h3" },
        { ...pkg("flight") },
      );
      await run("element.setStatus", {
        refs: ["n1", "n2", "n3", "h1", "h2", "s1", "s3"].map(id),
        status: "approved",
      });
      const item = "firmware 0.9.1";
      await run("evidence.record", {
        ref: id("s1"),
        kind: "verification",
        result: "passed",
        method: "test",
        item,
      });
      await run("evidence.record", {
        ref: id("s3"),
        kind: "verification",
        result: "failed",
        method: "test",
        item,
      });
      await run("evidence.record", {
        ref: id("s4"),
        kind: "verification",
        result: "passed",
        method: "analysis",
        item,
      });
      await initRepository(workspace);
      await workspace.commit(".", "Cargo Drone: first state");
      return workspace;
    },
  );
}
