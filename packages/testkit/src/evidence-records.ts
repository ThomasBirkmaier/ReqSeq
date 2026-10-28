// Evidence records for a generated large workspace (E4, #583; ADR-0011, ADR-0012, N-036): the
// verification and validation records a project of 50,000 elements keeps, as JUnit XML of its CI
// runs (SR-093, enriched as `evidence.enrichJunit` writes them) and as Markdown records (SR-028, as
// `evidence.record` writes them; validation records of SR-038). The same seed always gives the same
// files. `generateLargeWorkspace` is not changed: the records are added to its tree with their own
// random sequence, so every element file stays as it was.
import path from "node:path";
import type { GeneratedElement, GeneratedWorkspace } from "./large-workspace.js";
import { Random, sortedTree } from "./large-workspace.js";

/** The evidence location the records are written to: this folder of the main repository. */
export const EVIDENCE_FOLDER = "evidence";

export interface EvidenceRecordsOptions {
  /** Default: the seed of the generated workspace. */
  readonly seed?: number;
  /**
   * CI runs of the test suite, one folder of JUnit files each, at least 1. Default 3: each
   * automated requirement has 1 to 3 executions, its test case runs in the newest of them.
   */
  readonly runs?: number;
  /** Test cases per JUnit file of a CI run. Default 500. */
  readonly testCasesPerFile?: number;
  /**
   * Older CI runs written as one large JUnit file each, with every automated test case (many large
   * JUnit files, review of #561, N4), in `archive/`. Default 0.
   */
  readonly history?: number;
}

export interface EvidenceCounts {
  /** Test cases of the suite: one per automated requirement, some naming 2 to 5 requirements. */
  readonly testCases: number;
  /** JUnit files and their bytes (UTF-8). */
  readonly junitFiles: number;
  readonly junitBytes: number;
  /** Executions marked `<skipped/>`: no record (SR-093 AK3). */
  readonly skipped: number;
  /** Records the JUnit reader gives: one per element a test case names, per execution. */
  readonly junitRecords: number;
  /** Markdown records (one file each): verification and validation. */
  readonly markdownVerification: number;
  readonly markdownValidation: number;
}

export interface GeneratedEvidence {
  /** The generated tree with the evidence location in the workspace file and the record files. */
  readonly workspace: GeneratedWorkspace;
  /** UUIDs of the system requirements without own record: the first 2 % (the top of the tree, SR-034). */
  readonly parents: readonly string[];
  /** UUIDs of the system requirements a test case is written for (JUnit). */
  readonly automated: readonly string[];
  /** UUIDs of the system requirements with a Markdown verification record. */
  readonly manual: readonly string[];
  /** UUIDs of the needs and system requirements with validation records (SR-038). */
  readonly validated: readonly string[];
  readonly counts: EvidenceCounts;
}

/** Share of the system requirements, first in generation order, that get no own record. */
const PARENT_SHARE = 0.02;
/** Shares of the other system requirements: automated (JUnit), else a Markdown verification record. */
const AUTOMATED_SHARE = 0.7;
const MANUAL_SHARE = 0.1;
/** Test cases that name 2 to 5 requirements (SR-033 plan review S1c). */
const MULTI_SHARE = 0.1;
/** Executions skipped and failed. */
const SKIPPED_SHARE = 0.05;
const FAILED_SHARE = 0.05;
/**
 * Automated requirements changed after one of the runs: the executions up to that run store one older
 * version (outdated), the later ones the current version. Manual records: of an older version.
 */
const OUTDATED_SHARE = 0.15;
/** Test cases run for a variant (`logreq:variant`), so the status walk meets variant records. */
const VARIANT_SHARE = 0.02;
/** Validation records (SR-038): about 10,000 of the 50,000 elements. */
const VALIDATED_NEEDS = 0.6;
const VALIDATED_REQUIREMENTS = 0.18;
const VALIDATION_FAILED = 0.1;
const VALIDATION_OUTDATED = 0.2;
/** At most this many record files per folder. */
const FOLDER_SIZE = 1000;
/** The folder of the large JUnit files of `history`: it sorts before `ci`, so its files are read first, 16 at a time. */
const HISTORY_FOLDER = "archive";
const MANUAL_METHODS = ["inspection", "analysis", "demonstration"];

/** The short ID of a generated element (SR-084): type prefix and the last 6 digits of its UUID. */
export const shortIdOf = (element: GeneratedElement): string => {
  const name = path.posix.basename(element.file);
  return `${name.slice(0, name.indexOf("-"))}-${element.id.slice(-6)}`;
};

/** A version other than every current one (D-013 format). */
const otherVersion = (random: Random): string =>
  `n1:${Array.from({ length: 16 }, () => random.below(16).toString(16)).join("")}`;

/** `n` days after 2026-09-01 at `hour`:00 UTC, whole seconds (`dateTime`). */
const dayOf = (n: number, hour = 10): string =>
  new Date(Date.UTC(2026, 8, 1 + n, hour)).toISOString().replace(/\.\d{3}Z$/, "Z");

/** A Markdown record as `evidence.record` writes it: the frontmatter in schema order, no body. */
const recordFile = (fields: readonly (readonly [string, string | number])[]): string =>
  `---\n${fields.map(([key, value]) => `${key}: ${String(value)}\n`).join("")}---\n`;

interface TestCaseSpec {
  readonly classname: string;
  readonly name: string;
  /** The requirements it names, the one it is written for first. */
  readonly elements: readonly GeneratedElement[];
  /** Executions: it runs in the newest `executions` CI runs. */
  readonly executions: number;
  /** The variant it runs for (`logreq:variant`); none: the core. */
  readonly variant?: string;
}

/**
 * The version an execution stores: per element, the run after which it changed (a position on the
 * time line of all runs, history first) and the version it had until then; elements without one
 * always store their current version.
 */
type VersionAt = (element: GeneratedElement, time: number) => string;

/** One `<testcase>` of a run, with its outcome drawn; adds its records and skips to `counts`. */
const testCaseXml = (
  spec: TestCaseSpec,
  run: { readonly day: number; readonly time: number; readonly item: string },
  versionAt: VersionAt,
  random: Random,
  counts: { junitRecords: number; skipped: number },
): string => {
  const date = dayOf(run.day);
  const versions = spec.elements.map((e) => versionAt(e, run.time));
  const roll = random.next();
  const outcome =
    roll < SKIPPED_SHARE
      ? "      <skipped/>\n"
      : roll < SKIPPED_SHARE + FAILED_SHARE
        ? '      <failure message="expected 1 to be 2" type="AssertionError">AssertionError: expected 1 to be 2</failure>\n'
        : "";
  if (roll < SKIPPED_SHARE) {
    counts.skipped++;
  } else {
    counts.junitRecords += spec.elements.length;
  }
  // Names, titles and IDs hold no character XML must escape (the generator's words, digits, `-`).
  return [
    `    <testcase classname="${spec.classname}" name="${spec.name}" time="0.012">\n`,
    "      <properties>\n",
    ...spec.elements.map((e) => `        <property name="logreq:element" value="${e.id}"/>\n`),
    ...versions.map((v) => `        <property name="logreq:version" value="${v}"/>\n`),
    `        <property name="logreq:item" value="${run.item}"/>\n`,
    ...(spec.variant === undefined
      ? []
      : [`        <property name="logreq:variant" value="${spec.variant}"/>\n`]),
    `        <property name="logreq:date" value="${date}"/>\n`,
    "      </properties>\n",
    outcome,
    "    </testcase>\n",
  ].join("");
};

/** A JUnit file of one run (vitest's layout: one suite per file). */
const junitFile = (suite: string, run: number, testCases: readonly string[]): string =>
  [
    '<?xml version="1.0" encoding="UTF-8" ?>\n',
    `<testsuites name="generated tests" tests="${String(testCases.length)}">\n`,
    `  <testsuite name="${suite}" timestamp="${dayOf(run)}" tests="${String(testCases.length)}">\n`,
    ...testCases,
    "  </testsuite>\n",
    "</testsuites>\n",
  ].join("");

/** Writes a record file below the evidence folder. */
type AddFile = (file: string, content: string) => void;

/** One test case per automated requirement; about 10 % name 2 to 5 requirements. */
const testCaseSpecs = (
  automated: readonly GeneratedElement[],
  variants: readonly GeneratedElement[],
  perFile: number,
  runs: number,
  random: Random,
): TestCaseSpec[] =>
  automated.map((requirement, index) => {
    const others =
      random.next() < MULTI_SHARE
        ? Array.from({ length: 1 + random.below(4) }, () => random.pick(automated)).filter(
            (other, at, all) => other !== requirement && all.indexOf(other) === at,
          )
        : [];
    const elements = [requirement, ...others];
    return {
      classname: `${requirement.repository}/test/module-${String(Math.floor(index / perFile)).padStart(3, "0")}.test.ts`,
      name: `${elements.map((e) => `[${shortIdOf(e)}]`).join(" ")} ${requirement.title.toLowerCase()}`,
      elements,
      executions: 1 + random.below(runs),
      ...(random.next() < VARIANT_SHARE ? { variant: random.pick(variants).id } : {}),
    };
  });

/** The JUnit files of the CI runs and of the history; gives what the counts say about them. */
const junitRuns = (
  specs: readonly TestCaseSpec[],
  { runs, perFile, history }: { readonly runs: number; readonly perFile: number; readonly history: number },
  random: Random,
  add: AddFile,
): Pick<EvidenceCounts, "junitFiles" | "junitBytes" | "skipped" | "junitRecords"> => {
  const counts = { junitRecords: 0, skipped: 0 };
  // History first on the time line, then the CI runs.
  const changes = new Map<GeneratedElement, { readonly after: number; readonly version: string }>();
  for (const element of new Set(specs.flatMap((spec) => spec.elements))) {
    if (random.next() < OUTDATED_SHARE) {
      changes.set(element, { after: random.below(history + runs), version: otherVersion(random) });
    }
  }
  const versionAt: VersionAt = (element, time) => {
    const change = changes.get(element);
    return change !== undefined && time <= change.after ? change.version : element.version;
  };
  let junitFiles = 0;
  let junitBytes = 0;
  const addJunit = (file: string, content: string): void => {
    add(file, content);
    junitFiles++;
    junitBytes += Buffer.byteLength(content);
  };
  for (let run = 0; run < runs; run++) {
    for (let start = 0; start < specs.length; start += perFile) {
      const chunk = specs
        .slice(start, start + perFile)
        .filter((spec) => run >= runs - spec.executions)
        .map((spec) =>
          testCaseXml(
            spec,
            { day: run, time: history + run, item: `build-${String(run + 1)}` },
            versionAt,
            random,
            counts,
          ),
        );
      if (chunk.length > 0) {
        const name = `junit-${String(start / perFile).padStart(3, "0")}`;
        addJunit(`ci/run-${String(run + 1)}/${name}.xml`, junitFile(name, run, chunk));
      }
    }
  }
  for (let run = 0; run < history; run++) {
    // Older than the CI runs: the history before them.
    const day = run - history;
    const item = `history-${String(run + 1)}`;
    addJunit(
      `${HISTORY_FOLDER}/run-${String(run + 1).padStart(2, "0")}.xml`,
      junitFile(
        item,
        day,
        specs.map((spec) => testCaseXml(spec, { day, time: run, item }, versionAt, random, counts)),
      ),
    );
  }
  return { junitFiles, junitBytes, ...counts };
};

/** One Markdown verification record per requirement of `manual`; gives how many. */
const manualRecords = (manual: readonly GeneratedElement[], random: Random, add: AddFile): number => {
  manual.forEach((requirement, index) => {
    const method = random.pick(MANUAL_METHODS);
    const date = dayOf(-30 + random.below(30));
    add(
      `manual/${String(Math.floor(index / FOLDER_SIZE)).padStart(3, "0")}/${date.slice(0, 10)}-${shortIdOf(requirement)}-${method}.md`,
      recordFile([
        ["logreq-record", 1],
        ["kind", "verification"],
        ["element", requirement.id],
        ["version", random.next() < OUTDATED_SHARE ? otherVersion(random) : requirement.version],
        ["method", method],
        ["item", `sample-${String(1 + random.below(20))}`],
        ["result", random.next() < FAILED_SHARE ? "failed" : "passed"],
        ["date", date],
      ]),
    );
  });
  return manual.length;
};

/** One or two Markdown validation records per element of `validated`; gives how many. */
const validationRecords = (validated: readonly GeneratedElement[], random: Random, add: AddFile): number => {
  let written = 0;
  validated.forEach((element) => {
    const records = 1 + random.below(2);
    for (let n = 0; n < records; n++) {
      // The second record is older and, more often, of an older version.
      const date = dayOf(-60 - 30 * n + random.below(30), 14);
      const outdated = random.next() < VALIDATION_OUTDATED * (1 + n);
      add(
        `validation/${String(Math.floor(written / FOLDER_SIZE)).padStart(3, "0")}/${date.slice(0, 10)}-${shortIdOf(element)}-validation${n === 0 ? "" : "-2"}.md`,
        recordFile([
          ["logreq-record", 1],
          ["kind", "validation"],
          ["element", element.id],
          ["version", outdated ? otherVersion(random) : element.version],
          ["result", random.next() < VALIDATION_FAILED ? "failed" : "passed"],
          ["date", date],
        ]),
      );
      written++;
    }
  });
  return written;
};

/**
 * Adds an evidence location (`evidence` in the main repository) and records to a generated
 * workspace (E4, #583):
 *
 * - System requirements: the first 2 % in generation order get no own record (their status comes
 *   from their children, SR-034); of the others about 70 % are automated and about 10 % have one
 *   Markdown verification record (inspection, analysis or demonstration), the rest none.
 * - Each automated requirement has one test case; about 10 % of them name 2 to 5 requirements
 *   (other automated ones). A test case runs in the newest 1 to `runs` CI runs, so it has 1 to 3
 *   executions by default; per execution about 5 % are skipped and 5 % fail. About 15 % of the
 *   named elements changed after one of the runs: up to it their executions store one older version
 *   (outdated), later ones the current version. About 2 % of the test cases run for a variant.
 *   Every test case is enriched. `ci/run-<n>/junit-<nnn>.xml`, `testCasesPerFile` per file;
 *   `history` adds older runs as large files `archive/run-<nn>.xml` with every test case, which
 *   sort before `ci` and so are read first (16 at a time, `readEvidence`).
 * - Validation records (SR-038): about 60 % of the needs and 18 % of the system requirements, one
 *   or two each (about 10,000 elements of 50,000), about 10 % failed and 20 % of an older version.
 */
export function withEvidenceRecords(
  generated: GeneratedWorkspace,
  options: EvidenceRecordsOptions = {},
): GeneratedEvidence {
  const runs = options.runs ?? 3;
  const perFile = options.testCasesPerFile ?? 500;
  const history = options.history ?? 0;
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(perFile) || perFile < 1) {
    throw new Error(
      `runs and testCasesPerFile must be whole numbers from 1: ${String(runs)}, ${String(perFile)}`,
    );
  }
  const random = new Random((options.seed ?? generated.seed) ^ 0x583);
  const root = `${generated.main}/${EVIDENCE_FOLDER}`;
  const files = new Map(generated.files);
  const workspaceFile = `${generated.main}/logreq-workspace.yaml`;
  files.set(
    workspaceFile,
    `${String(files.get(workspaceFile))}evidence:\n  - { repository: ${generated.main}, path: ${EVIDENCE_FOLDER} }\n`,
  );

  const requirements = generated.elements.filter((e) => e.type === "system-requirement");
  const parentCount = Math.max(1, Math.floor(requirements.length * PARENT_SHARE));
  const parents = requirements.slice(0, parentCount);
  const automated: GeneratedElement[] = [];
  const manual: GeneratedElement[] = [];
  for (const requirement of requirements.slice(parentCount)) {
    const roll = random.next();
    if (roll < AUTOMATED_SHARE) {
      automated.push(requirement);
    } else if (roll < AUTOMATED_SHARE + MANUAL_SHARE) {
      manual.push(requirement);
    }
  }

  const add = (file: string, content: string): void => {
    files.set(`${root}/${file}`, content);
  };
  const variants = generated.elements.filter((e) => e.type === "variant");
  const specs = testCaseSpecs(automated, variants, perFile, runs, random);
  const junit = junitRuns(specs, { runs, perFile, history }, random, add);
  const markdownVerification = manualRecords(manual, random, add);
  const validated = generated.elements.filter(
    (e) =>
      (e.type === "need" && random.next() < VALIDATED_NEEDS) ||
      (e.type === "system-requirement" && random.next() < VALIDATED_REQUIREMENTS),
  );
  const markdownValidation = validationRecords(validated, random, add);

  const tree = sortedTree(files);
  return {
    workspace: { ...generated, files: tree.files, digest: tree.digest },
    parents: parents.map((e) => e.id),
    automated: automated.map((e) => e.id),
    manual: manual.map((e) => e.id),
    validated: validated.map((e) => e.id),
    counts: { testCases: specs.length, ...junit, markdownVerification, markdownValidation },
  };
}

/**
 * One JUnit file as pytest writes it (one line, no properties), not enriched, of at least `bytes`
 * bytes, for `evidence.enrichJunit` (SR-029): each test case names one system requirement by its
 * short ID in brackets (`test_check_7[SR-a1b2c3]`), cycling through the system requirements whose
 * last 6 UUID digits no other element shares, so every reference names exactly one element.
 */
export function pytestJunit(
  generated: GeneratedWorkspace,
  bytes: number,
): { readonly content: string; readonly testCases: number } {
  const tails = new Map<string, number>();
  for (const element of generated.elements) {
    const tail = element.id.slice(-6);
    tails.set(tail, (tails.get(tail) ?? 0) + 1);
  }
  const named = generated.elements.filter(
    (e) => e.type === "system-requirement" && tails.get(e.id.slice(-6)) === 1,
  );
  if (named.length === 0) {
    throw new Error("the generated workspace has no system requirement with a unique short ID");
  }
  const head =
    '<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite name="pytest" timestamp="2026-10-27T23:08:35.647847+00:00" hostname="ci">';
  const tail = "</testsuite></testsuites>\n";
  const parts = [head];
  let size = head.length + tail.length;
  let testCases = 0;
  while (size < bytes) {
    for (const element of named) {
      if (size < bytes) {
        const part = `<testcase classname="tests.test_module_${String(Math.floor(testCases / 1000))}" name="test_check_${String(testCases)}[${shortIdOf(element)}]" time="0.001" />`;
        parts.push(part);
        size += part.length;
        testCases++;
      }
    }
  }
  parts.push(tail);
  return { content: parts.join(""), testCases };
}
