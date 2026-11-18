// Enriching a JUnit XML file (SR-029, ADR-0012 "JUnit XML", "Enriching"): `evidence.enrichJunit` adds
// to each test case that names a requirement the UUID, the current version, the item (Prüfling) and
// the date, so that the JUnit reader (SR-093) assigns it without further input (AK3).
//
// - References: every `reqseq:element` property in file order, then the name tokens of the test case
//   (`elementRefsOf`). A property is an explicit statement: one that names no element or more than
//   one is reported. A name token of the form of a short ID or UUID is reported the same way; one
//   glued to a word as pytest writes a parameter (`test_get[<UUID>]`, #358) only when it is a short
//   ID with a type prefix of the metamodel (a typo in a pytest ID); any other name token (an
//   identifier such as `[SR-036]`, a pytest parameter list) counts only when it names exactly one
//   element. Elements named twice count once.
// - With a name pattern (`namePattern`, AK5, `name-pattern.ts`) the short IDs it finds in the name are
//   name tokens of the form of a short ID too, so one that names no element or several is reported.
// - Acceptance criteria (SR-029 AK10, D-072): a name token `[<ref>/AK-<key>]` and a name pattern
//   match whose `{ak}` is a criterion key give a `reqseq:criterion` `<UUID>:<key>` for the element the
//   reference names (`criterionRefsOf`). An element the name also names without a criterion
//   (`[SR-x] [SR-x/AK-k7f3]`) gets none from the name: the test holds for all its criteria; another
//   suffix (`/slow`) names the whole requirement too. A name that names a criterion by its number
//   (`[<ref>/AK<n>]`, `{ak}` = n), by a key that no criterion or more than one carries in the current
//   version of its element, or with a suffix `AK` that is neither (`AK0`, `AK`, `AK2a`, `AK-x`, and
//   `{ak}` that is none) leaves the test case unchanged as `evidence.invalid-criterion-name` (AK13),
//   with the key to write where the number names a criterion that has one; enriched without it, the
//   test would hold for every criterion, and a number points to another criterion once one is
//   inserted (D-072). This holds for every element the name names, also one left out (AK11). A
//   hand-written `reqseq:criterion` `<ref>:<key>` or `<ref>:<n>` (short ID,
//   UUID or identifier) is kept, with its reference replaced by the UUID in place; the criteria of
//   the name that no property names yet are appended, each once. One that is malformed, or names no
//   element of the test case, leaves the test case unchanged and is `evidence.invalid-record`. The
//   read-back compares the criteria per element.
// - A test case that names no element (no property, no token that names one) counts in
//   `withoutReference` (AK4); kept, reported and refused test cases do not.
// - A test case with a reported reference stays unchanged and is listed (AK2, spec question ThomasBirkmaier/ReqSeq-archive#529 Q1);
//   the others are enriched and the file is written.
// - A test case enriched by this call or kept that names an element of a type without the meaning
//   `requirement` (a need, say) gives `evidence.kind-mismatch` (warning), as `workspace.check` reports
//   its record afterwards (D-012, #628): the record counts for no status (#843). It is enriched all the
//   same: the file says what the test names, and a validation may still be recorded by hand.
// - A test case that already has a `reqseq:version` is never changed: its version is the one it was
//   tested against (D-026, spec question ThomasBirkmaier/ReqSeq-archive#529 Q5, assumption "keep"). A kept version that is no longer
//   current gives `evidence.outdated` (warning); one the reader rejects `evidence.invalid-record`.
//   It may name several views (`reqseq:variant` with variants and `core`, SR-093 AK5); with given
//   views it fits only when each of its views is among them, and each of its views must hold its
//   elements (AK8, AK9; with `skipNotInView` one of them, AK11).
// - Views (AK6 to AK9, AK11): the given views (`variant`: variants and `core`) go into each test case
//   enriched, one `reqseq:variant` per view (none for the core alone); a test case's own views must be
//   among them (AK8). Each view must hold each element (AK9); with `skipNotInView`, an element that no
//   given view holds is left out of the test case instead (`notInView`), and the others are enriched.
// - Marks (AK12, SR-093 AK6): a test case left out whole, as every element it names applies in none of
//   the given views, gets one `reqseq:not-in-view` per given view, in the given order, and no element,
//   version or criterion; its name and hand-written properties stay. A mark that names the same set of
//   views (`notInViewOf`, any order or case) is left as it is, so a re-run changes nothing; another set
//   is rewritten in place, the extra marks removed and the missing ones added after the last. Every
//   test case that is enriched loses its marks; one that is reported, refused or names nothing keeps
//   them until a run enriches it or leaves it out again.
// - The bytes are spliced at the offsets of the JUnit model, so every other byte stays (BOM, CRLF,
//   comments, CDATA, layout). The result is read back with the reader's checks before it is written
//   (ADR-0007 pattern): a difference is `internal`, and nothing is written.
// - Writing (ADR-0002 rule 5): the input in place, or `output`; an existing `output` only when it is a
//   JUnit file; never below a `.git` folder (D-036); through `writeFileAtomic` with the `xml` guard.
// - When it ends, also without a write, an enriched file the evidence walk does not read gives
//   `evidence.outside-location` (warning, SR-230 AK3, `enrich-location.ts`): its results do not count yet.
//
// This file puts the plans of a file together, enriches its bytes and writes it. The parts: the
// options, results and plans (`enrich-model.ts`), the plan of one test case (`enrich-plan.ts`), its
// views (`enrich-views.ts`) and criteria (`enrich-criteria.ts`), the splices (`enrich-splice.ts`), the
// read-back (`enrich-read-back.ts`) and the lookups of the command (`enrich-lookups.ts`).

import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readFileSnapshot, shown, writeFileAtomic, zip } from "../files/index.js";
import type { FileSnapshot } from "../files/index.js";
import type { EvidenceEnrichJunitInput, EvidenceEnrichJunitOutput } from "../generated/types.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import {
  acceptanceCriteriaKeyOf,
  criteriaItemsOf,
  currentVersionsOf,
  elementStoreState,
  NORMAL_FORM,
  ownEvidenceWrite,
  resolveRef,
  sameVersion,
  shortIdState,
} from "../model/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { Workspace } from "../runtime/workspace.js";
import { refuseGit, shownPath, variantIndependentOf, workspaceLayoutState } from "../workspace/index.js";
import type { JunitTestCase } from "./junit-model.js";
import { junitTestCases } from "./junit-model.js";
import { outsideLocationProblems } from "./enrich-location.js";
import { nameMatcher, parseNamePattern } from "./name-pattern.js";
import { recordViewContext } from "./in-variant.js";
import { evidenceReadState } from "./state.js";
import type {
  EnrichOptions,
  EnrichResult,
  Plan,
  RefResolution,
  Reported,
  UnknownRef,
  VersionLookup,
} from "./enrich-model.js";
import { COMMAND, DATE, ELEMENT, nameOf, testCaseText, valuesOf } from "./enrich-model.js";
import { planOf } from "./enrich-plan.js";
import type { Intended } from "./enrich-read-back.js";
import { checkReadBack, unmarkedOf } from "./enrich-read-back.js";
import type { Splice } from "./enrich-splice.js";
import { applySplices, markSplices, splicesOf } from "./enrich-splice.js";
import { keptVariantProblem } from "./enrich-views.js";
import {
  givenViews,
  incompleteNote,
  outOfVariantOf,
  resolverOf,
  variantResolverOf,
} from "./enrich-lookups.js";

const isDateTime = (value: string): boolean =>
  fileSchemaValidator("common.schema.json#/$defs/dateTime")(value);

/** The message of a reported reference (N2: the test case, its line, the reference). */
const reportedMessage = (
  testCase: JunitTestCase,
  { ref, resolution, matched }: Reported,
  note: string,
): string => {
  const pattern = matched === undefined ? "" : ` (read as "${shown(matched)}" by the name pattern)`;
  const what = ref === "" ? `an empty ${ELEMENT} property` : `"${shown(ref)}"${pattern}`;
  return resolution.kind === "ambiguous"
    ? `${testCaseText(testCase)}: ${what} names more than one element (${resolution.candidates.join(", ")}); give the full UUID`
    : `${testCaseText(testCase)}: no element has the reference ${what}${note}`;
};

/** The date a test case gets: given, else its own valid one, else the suite's with time zone, else now. */
const dateFor = (testCase: JunitTestCase, options: EnrichOptions): string => {
  if (options.date !== undefined) {
    return options.date;
  }
  const own = valuesOf(testCase, DATE);
  const [first] = own;
  if (first !== undefined && own.every((d) => d === first) && isDateTime(first)) {
    return first;
  }
  const suite = testCase.timestamp?.trim();
  return suite !== undefined && isDateTime(suite) ? suite : options.now().toISOString();
};

/** A problem of a test case: it has the line of the `<testcase>`. */
type LinedProblem = Problem & { readonly line: number };

/** What the test cases of a file give, put together. */
interface Outcome {
  readonly unknown: UnknownRef[];
  readonly problems: LinedProblem[];
  readonly splices: Splice[];
  readonly intended: Intended[];
  count: number;
  withoutReference: number;
  notInView: number;
}

/** What the plans need: the lookups and the values, for `addPlan`. */
interface Context {
  readonly bytes: Uint8Array;
  readonly options: EnrichOptions;
  readonly resolutions: ReadonlyMap<string, RefResolution>;
  readonly versions: ReadonlyMap<string, VersionLookup>;
  readonly where: { readonly file: string };
}

/** The elements a plan names: those to enrich, or the UUIDs a kept test case gives. */
const idsOf = (plan: Extract<Plan, { kind: "enrich" | "kept" }>): readonly string[] =>
  plan.kind === "enrich" ? [...plan.named.map((n) => n.id), ...plan.added] : [...plan.pairs.keys()];

/**
 * `evidence.kind-mismatch` (warning) for each of the elements `ids` of `testCase` that a verification
 * record cannot name, as `workspace.check` gives it for the record (`recordKindProblems`, #843).
 */
const kindProblems = (testCase: JunitTestCase, ids: readonly string[], context: Context): LinedProblem[] =>
  ids.flatMap((id): LinedProblem[] => {
    const other = context.options.notRequirement?.(id);
    return other === undefined
      ? []
      : [
          {
            code: "evidence.kind-mismatch",
            severity: "warning",
            ...context.where,
            line: testCase.line,
            targetId: id,
            targetRepository: other.repository,
            message: `${testCaseText(testCase)} names element ${id} of type ${other.type}, so its record counts for no status: a verification record names a requirement (D-012)`,
          },
        ];
  });

/** Adds what enriching one planned test case gives to `outcome`. */
const addEnriched = (outcome: Outcome, plan: Extract<Plan, { kind: "enrich" }>, context: Context): void => {
  const ids = idsOf(plan);
  const lookups = ids.map((id) => ({ id, entry: context.versions.get(id) }));
  const current = lookups.flatMap(({ entry }) => (entry?.kind === "version" ? [entry.version] : []));
  if (current.length < ids.length) {
    for (const { id, entry } of lookups) {
      if (entry?.kind !== "version") {
        outcome.problems.push({
          code: "file.faulty",
          severity: "error",
          ...context.where,
          line: plan.testCase.line,
          elementId: id,
          message: `${testCaseText(plan.testCase)} is not enriched: element ${id} has no current version (${entry?.message ?? "it is not in the workspace"})`,
        });
      }
    }
    return;
  }
  const { options } = context;
  const date = dateFor(plan.testCase, options);
  const own = splicesOf(context.bytes, plan, current, options.item, date);
  const base = outcome.splices.length;
  outcome.splices.push(...own.map((s) => ({ ...s, seq: base + s.seq })));
  const { name, className, start, end } = plan.testCase;
  outcome.intended.push({
    name,
    className,
    outcome: plan.testCase.outcome,
    start,
    end,
    pairs: new Map(zip(ids, current)),
    item: options.item,
    date,
    views: plan.variant.views,
    criteria: plan.criteria.text,
  });
  outcome.count += 1;
  outcome.notInView += plan.notInView;
  outcome.problems.push(...kindProblems(plan.testCase, ids, context));
};

/** Adds what a test case left out gives to `outcome`: its count, and its marks unless they are there (AK12). */
const addLeftOut = (outcome: Outcome, plan: Extract<Plan, { kind: "outside" }>, context: Context): void => {
  outcome.notInView += plan.notInView;
  const { testCase, marks } = plan;
  const own = markSplices(context.bytes, testCase, marks);
  if (own.length === 0) {
    return;
  }
  const base = outcome.splices.length;
  outcome.splices.push(...own.map((s) => ({ ...s, seq: base + s.seq })));
  const { name, className, start, end, outcome: result } = testCase;
  outcome.intended.push({
    kind: "left-out",
    name,
    className,
    outcome: result,
    start,
    end,
    marks,
    properties: unmarkedOf(testCase),
  });
};

/** Adds what one planned test case gives to `outcome`. */
const addPlan = (outcome: Outcome, plan: Plan, context: Context): void => {
  const { where, options } = context;
  switch (plan.kind) {
    case "none":
      outcome.withoutReference += 1;
      return;
    case "outside":
      addLeftOut(outcome, plan, context);
      return;
    case "invalid":
    case "criterion":
      outcome.problems.push({
        code: plan.kind === "invalid" ? "evidence.invalid-record" : "evidence.invalid-criterion-name",
        severity: "error",
        ...where,
        line: plan.testCase.line,
        message: `${testCaseText(plan.testCase)} is not enriched: ${plan.reason}`,
      });
      return;
    case "reported":
      for (const reported of plan.refs) {
        outcome.unknown.push({ ...nameOf(plan.testCase), ref: reported.ref });
        outcome.problems.push({
          code:
            reported.resolution.kind === "ambiguous"
              ? "evidence.ambiguous-element"
              : "evidence.unknown-element",
          severity: "error",
          ...where,
          line: plan.testCase.line,
          message: reportedMessage(plan.testCase, reported, options.unknownNote ?? ""),
        });
      }
      return;
    case "kept": {
      const ids = [...plan.pairs.keys()].flatMap((uuid) => {
        const resolution = context.resolutions.get(uuid);
        return resolution?.kind === "found" ? [resolution.id] : [];
      });
      const variant = keptVariantProblem(plan, ids, options);
      if (variant !== undefined) {
        outcome.problems.push({
          code: "evidence.invalid-record",
          severity: "error",
          ...where,
          line: plan.testCase.line,
          message: `${testCaseText(plan.testCase)} does not fit: ${variant}`,
        });
        return;
      }
      outcome.count += 1;
      outcome.problems.push(...keptProblems(plan, context), ...kindProblems(plan.testCase, ids, context));
      return;
    }
    case "enrich":
      addEnriched(outcome, plan, context);
  }
};

/** Problems by line, stable (problems of one test case keep their order). */
const byLine = (problems: readonly LinedProblem[]): Problem[] =>
  [...problems].sort((a, b) => a.line - b.line);

/** What planning a file gives: the result, the splices, and what the read-back checks. */
interface Planned {
  readonly result: Omit<EnrichResult, "bytes" | "changed">;
  readonly splices: readonly Splice[];
  readonly intended: readonly Intended[];
}

/**
 * Reads and plans the file. Its JUnit model lives only in this call, so it can be freed before the
 * result is read back (S1 of the PR review).
 */
const planFile = async (bytes: Uint8Array, options: EnrichOptions): Promise<Planned> => {
  const read = junitTestCases(bytes);
  if (read.kind === "invalid") {
    throw new CommandError(
      "file.faulty",
      `Not enriched: ${options.name} is no readable XML (line ${String(read.line)}): ${read.message}`,
      { file: options.name, line: read.line },
    );
  }
  if (read.kind === "not-junit") {
    throw new CommandError(
      "input.invalid",
      `${options.name} is not a JUnit XML file: its root is <${shown(read.root)}>, not <testsuites> or <testsuite>`,
      { file: options.name, reason: "not-junit" },
    );
  }
  const testCases = read.file.testCases;
  const plans = testCases.map((testCase) => planOf(testCase, options));
  // The UUIDs of kept test cases are looked up too, to tell whether their versions are current.
  const resolutions = new Map<string, RefResolution>();
  for (const plan of plans.filter((p) => p.kind === "kept")) {
    for (const id of idsOf(plan)) {
      resolutions.set(id, resolutions.get(id) ?? options.resolve(id));
    }
  }
  const wanted = new Set(plans.filter((p) => p.kind === "enrich").flatMap(idsOf));
  for (const resolution of resolutions.values()) {
    if (resolution.kind === "found") {
      wanted.add(resolution.id);
    }
  }
  const versions =
    wanted.size === 0 ? new Map<string, VersionLookup>() : await options.versionsOf([...wanted]);
  const context: Context = { bytes, options, resolutions, versions, where: { file: options.file } };
  const outcome: Outcome = {
    unknown: [],
    problems: [],
    splices: [],
    intended: [],
    count: 0,
    withoutReference: 0,
    notInView: 0,
  };
  for (const plan of plans) {
    addPlan(outcome, plan, context);
  }
  return {
    result: {
      testCases: outcome.count,
      withoutReference: outcome.withoutReference,
      notInView: outcome.notInView,
      unknown: outcome.unknown,
      problems: byLine(outcome.problems),
    },
    splices: outcome.splices,
    intended: outcome.intended,
  };
};

/**
 * Enriches the bytes of a JUnit XML file (see the file comment). Pure apart from the injected
 * lookups: reads and writes no file. Throws `file.faulty` for a file the XML scanner refuses,
 * `input.invalid` for XML that is no JUnit file, `internal` when the result does not read back.
 */
export const enrichJunitBytes = async (bytes: Uint8Array, options: EnrichOptions): Promise<EnrichResult> => {
  const { result, splices, intended } = await planFile(bytes, options);
  if (splices.length === 0) {
    return { bytes, changed: false, ...result };
  }
  const out = applySplices(bytes, splices);
  checkReadBack(bytes, out.bytes, out.moved, intended);
  return { bytes: out.bytes, changed: true, ...result };
};

/**
 * What a kept test case gives (B1): `evidence.outdated` (warning) for a kept version that is no
 * longer current, `evidence.unknown-element` or `evidence.ambiguous-element` (warning) for a UUID
 * that names no element or several, as `workspace.check` reports them.
 */
const keptProblems = (
  plan: Extract<Plan, { kind: "kept" }>,
  { resolutions, versions, where }: Context,
): LinedProblem[] =>
  [...plan.pairs].flatMap(([uuid, stored]): LinedProblem[] => {
    const resolution = resolutions.get(uuid);
    const line = plan.testCase.line;
    if (resolution?.kind !== "found") {
      return [
        {
          code: resolution?.kind === "ambiguous" ? "evidence.ambiguous-element" : "evidence.unknown-element",
          severity: "warning",
          ...where,
          line,
          targetId: uuid,
          message: `${testCaseText(plan.testCase)} is enriched already and names element ${uuid}, which ${resolution?.kind === "ambiguous" ? "several files share" : "the workspace does not have"}; it is kept as it is`,
        },
      ];
    }
    const current = versions.get(resolution.id);
    return current?.kind === "version" && !sameVersion(stored, current.forms)
      ? [
          {
            code: "evidence.outdated",
            severity: "warning",
            ...where,
            line,
            elementId: resolution.id,
            storedVersion: stored,
            currentVersion: current.version,
            message: `${testCaseText(plan.testCase)} is enriched already with version ${stored}, which is no longer current; it is kept (D-026: the version it was tested against)`,
          },
        ]
      : [];
  });

/** The real folder of `file`; `file.folder-missing` when it does not exist. */
const realFolder = async (file: string): Promise<string> => {
  try {
    return await fs.realpath(path.dirname(file));
  } catch {
    throw new CommandError(
      "file.folder-missing",
      `Not written: the folder of ${path.basename(file)} does not exist`,
      { file: path.basename(file) },
    );
  }
};

/** The input file: its bytes and snapshot, or `input.invalid` naming only its base name. */
const readInput = async (file: string): Promise<{ bytes: Uint8Array; snapshot: FileSnapshot }> => {
  const name = path.basename(file);
  const read = await readFileSnapshot(path.dirname(file), name);
  if (read.kind === "read") {
    return read;
  }
  throw read.missing
    ? new CommandError("input.invalid", `The file ${name} does not exist`, {
        file: name,
        reason: "source-missing",
      })
    : new CommandError("input.invalid", `Cannot enrich ${name}: ${read.problem.message}`, {
        file: name,
        reason: "source-unreadable",
      });
};

/**
 * The snapshot an existing `output` is replaced under, or null to create it (B2): only a JUnit file
 * is replaced; anything else is `file.faulty` and stays untouched.
 */
const outputSnapshot = async (
  file: string,
): Promise<{ readonly snapshot: FileSnapshot; readonly bytes: Uint8Array } | null> => {
  const name = path.basename(file);
  const read = await readFileSnapshot(path.dirname(file), name);
  if (read.kind === "problem") {
    if (read.missing) {
      return null;
    }
    throw new CommandError(
      "file.faulty",
      `Not written: ${name} cannot be replaced: ${read.problem.message}`,
      {
        file: name,
      },
    );
  }
  if (junitTestCases(read.bytes).kind !== "junit") {
    throw new CommandError(
      "file.faulty",
      `Not written: ${name} is not a JUnit XML file; ReqSeq replaces only JUnit files`,
      { file: name },
    );
  }
  return read;
};

/**
 * `evidence.enrichJunit` (SR-029): enriches the JUnit file `input.file` (a local path, relative to
 * the workspace root or absolute) and writes it in place or to `input.output` (see the file comment).
 */
export const enrichJunitFile = async (
  workspace: Workspace,
  input: EvidenceEnrichJunitInput,
): Promise<EvidenceEnrichJunitOutput> => {
  // The pattern's syntax first: a refusal touches no file.
  const pattern = input.namePattern === undefined ? undefined : parseNamePattern(input.namePattern);
  if (input.skipNotInView === true && input.variant === undefined) {
    throw new CommandError(
      "input.invalid",
      "skipNotInView applies only to the views given in variant: give them for the whole file",
      { command: COMMAND, fields: ["skipNotInView"], reason: "skip-without-views" },
    );
  }
  const layout = await workspace.get(workspaceLayoutState);
  const main = await fs.realpath(layout.root);
  const source = path.resolve(workspace.root, input.file);
  const target = input.output === undefined ? source : path.resolve(workspace.root, input.output);
  const { bytes, snapshot } = await readInput(source);
  const sourceFolder = await realFolder(source);
  const targetFolder = await realFolder(target);
  refuseGit(targetFolder, target);
  const inPlace =
    path.join(targetFolder, path.basename(target)) === path.join(sourceFolder, path.basename(source));
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const metamodel = await workspace.get(metamodelState);
  const found = new Map<string, ElementRecord>();
  const views = recordViewContext({ workspace, metamodel, store, shortIds }, variantIndependentOf(layout));
  const variants = new Map<string, ElementRecord>();
  const given = givenViews(views, input.variant, variants);
  // The metamodel is valid here: a write is refused while it is not (`workspace.read-only`).
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  const typePrefixes = metamodel.effectiveTypes.map((t) => t.prefix);
  const result = await enrichJunitBytes(bytes, {
    typePrefixes,
    resolve: resolverOf((ref) => resolveRef(store, shortIds, ref), found),
    versionsOf: async (ids) => {
      const wanted = new Set(ids);
      const records = [...found.values()].filter((record) => wanted.has(record.id));
      const entries = await currentVersionsOf(workspace, records);
      return new Map(
        [...entries].map(([record, entry]): [string, VersionLookup] => [
          record.id,
          entry.kind === "version"
            ? { kind: "version", version: entry.forms[NORMAL_FORM], forms: entry.forms }
            : entry,
        ]),
      );
    },
    item: input.item,
    date: input.date,
    now: () => new Date(),
    name: path.basename(source),
    file: shownPath(layout, main, sourceFolder, source),
    unknownNote: incompleteNote(layout),
    views: given,
    skipNotInView: input.skipNotInView,
    resolveVariant: variantResolverOf(views, variants, incompleteNote(layout)),
    outOfVariant: outOfVariantOf(views, found, variants),
    notRequirement: (id) => {
      const record = found.get(id);
      return record === undefined || requirements.has(record.type)
        ? undefined
        : { type: record.type, repository: record.repository };
    },
    namePattern: pattern === undefined ? undefined : nameMatcher(pattern, typePrefixes),
    // Asked only for an element `resolve` found, which `resolverOf` put into `found`.
    criteriaOf: (id) => criteriaItemsOf(found.get(id)?.data, acceptanceCriteriaKeyOf(metamodel)),
  });
  const shownTarget = shownPath(layout, main, targetFolder, target);
  // SR-230 AK3: asked once the file is there, so a new output is looked for after it is written.
  const ended = async (files: string[]): Promise<EvidenceEnrichJunitOutput> => ({
    testCases: result.testCases,
    withoutReference: result.withoutReference,
    notInView: result.notInView,
    unknown: [...result.unknown],
    problems: [
      ...result.problems,
      ...(await outsideLocationProblems(layout, path.join(targetFolder, path.basename(target)), shownTarget)),
    ],
    files,
  });
  // Nothing to change: the input is not rewritten, but a given output is still written (it is the file
  // the caller asked for), unless it holds these bytes already.
  if (inPlace && !result.changed) {
    return ended([]);
  }
  const existing = inPlace ? { snapshot, bytes } : await outputSnapshot(target);
  if (!inPlace && existing !== null && Buffer.from(existing.bytes).equals(result.bytes)) {
    return ended([]);
  }
  const written = await writeFileAtomic(
    path.dirname(target),
    path.basename(target),
    result.bytes,
    existing?.snapshot ?? null,
    {
      kind: "xml",
    },
  );
  // The written file may lie in an evidence folder: read the records again, so app, API and MCP see
  // it at once. Unconditional for any written path: cheap. The watcher then leaves this read alone
  // for the file while it holds these bytes (#785).
  ownEvidenceWrite(workspace, target, written.sha256);
  await workspace.reset(evidenceReadState);
  return ended([shownTarget]);
};
