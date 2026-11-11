// Level 2 of the status model (#1396, epic #1389): a generated workspace written to disk (no Git) and read through
// the command catalog (`evidence.status`, `element.get`, `evidence.degree`, `element.list` with the conditions
// `verification` and `validation`), in a generated call order, against the reference model of
// `@reqseq/testkit/status-model`. No test here names an [SR/AK] token: they are no evidence of the tool.
//
// Over level 1 it checks what only files have: the metamodel meanings, the reader (Markdown and JUnit, records it
// refuses: SR-172 AK1, AK3, SR-038 AK4, a date it cannot read), relation resolution and twins in the trace block, the
// view rule index, real version hashes in both forms (an older version is one the file no longer has; without Git
// its criteria are not known), the same instant in two offsets, CRLF files, the files of one UUID with their own
// criteria and version, and the index order behind the reason of an inconclusive tie (A6). It does not check a
// variant UUID in two repositories, repositories missing here (`incomplete`), Git history, the degree of a subset
// selection (`ids`, `where`, a package), that a refused validation record with a variant (SR-038 AK4) counts for no
// status apart from the reader (the status functions ignore such a record anyway), or the adapters (SR-080,
// cross-access).
//
// The second block checks invariants on the core's output alone (one entry per view, degree counts, verified only on
// passed newest records, the same output in another call order) and metamorphic properties over a changed workspace
// (D-007; an added record reaches only its element and its ancestors; an older-version record). Each run also shows
// that no read changes a file.
//
// Runs: STATUS_MODEL_FILE_RUNS (default 30) and STATUS_MODEL_SEED; one temp folder, emptied before each run.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CORE_VIEW,
  CURRENT,
  type ModelEntry,
  type ModelFileRecord,
  type ModelFileWorkspace,
  type ModelRecord,
  type ModelWorkspace,
  type ModelWorkspaceElement,
  countsForCriterion,
  degreeOf,
  entriesInView,
  elementFilesOf,
  elementPlaceOf,
  fileParameters,
  forAllFileWorkspaces,
  isCurrent,
  modelOfFiles,
  newestOf,
  recordFilesOf,
  recordsInView,
  renderDate,
  resolveRef,
  shownValidationOf,
  uuidOf,
  validationMatches,
  variantPlaceOf,
  verificationMatches,
  workspaceStatusOf as modelWorkspaceStatusOf,
} from "@reqseq/testkit/status-model";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentVersions } from "../model/current-versions.js";
import { elementStoreState } from "../model/store.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";

const parameters = fileParameters(process.env);
// Own timeouts that grow with the runs: about 0.1 s a workspace on Linux, several times that on a Windows runner.
const TIMEOUT = 60_000 + parameters.numRuns * 3_000;
let root = "";

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-status-model-")));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** Empties the reused folder and writes `files` (paths with `/`). */
async function writeAll(files: ReadonlyMap<string, string>): Promise<void> {
  for (const [relative, text] of files) {
    const target = path.join(root, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text);
  }
}

async function emptyRoot(): Promise<void> {
  for (const entry of await fs.readdir(root)) {
    await fs.rm(path.join(root, entry), { recursive: true, force: true });
  }
}

/** Every file below the root with its bytes, to show that no read changed one. */
async function snapshot(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await fs.readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const full = path.join(entry.parentPath, entry.name);
      out.set(path.relative(root, full), (await fs.readFile(full)).toString("base64"));
    }
  }
  return out;
}

/** Writes the files of `files` and returns both version forms of each element file, by key (ADR-0005). */
async function writeWorkspace(files: ModelFileWorkspace): Promise<void> {
  await emptyRoot();
  await writeAll(elementFilesOf(files));
  const reader = new Workspace(root);
  try {
    const store = await reader.get(elementStoreState);
    const versions = await currentVersions(reader);
    const forms = new Map<string, { n1: string; n2: string }>();
    for (const element of files.base.elements) {
      const place = elementPlaceOf(element);
      const record = store.elements.find((r) => r.repository === place.repository && r.file === place.file);
      const entry = record === undefined ? undefined : versions.byRecord.get(record);
      expect(entry?.kind, `version of ${element.key}`).toBe("version");
      if (entry?.kind === "version") {
        forms.set(element.key, { n1: entry.forms.n1, n2: entry.forms.n2 });
      }
    }
    await writeAll(recordFilesOf(files, (key) => forms.get(key) ?? { n1: "", n2: "" }));
  } finally {
    await reader.close();
  }
}

const viewIdOf = (view: string): string => (view === CORE_VIEW ? "core" : uuidOf(view));

interface ShownEntry {
  readonly view: string;
  readonly status: string;
  readonly missingChildren?: readonly string[];
  readonly criteria?: { readonly verified: number; readonly total: number };
}

/** The model's entries as the core shows them: views by UUID, missing children by UUID, sorted by view. */
function expectedEntries(ws: ModelWorkspace, entries: readonly ModelEntry[]): ShownEntry[] {
  const idOf = new Map(ws.elements.map((element) => [element.key, element.id]));
  return entries
    .map(({ view, status, missingChildren, verified, total }) => ({
      view: viewIdOf(view),
      status,
      ...(missingChildren === undefined
        ? {}
        : {
            missingChildren: [...new Set(missingChildren.map((key) => uuidOf(idOf.get(key) ?? "")))].sort(),
          }),
      ...(total === undefined || verified === undefined ? {} : { criteria: { verified, total } }),
    }))
    .sort((a, b) => a.view.localeCompare(b.view));
}

interface ShownElement {
  readonly repository: string;
  readonly file: string;
  readonly verification?: readonly {
    readonly view: string;
    readonly status: string;
    readonly missingChildren?: readonly string[];
    readonly criteria?: { readonly verified: number; readonly total: number };
  }[];
  readonly validation?: string;
  readonly validationReason?: string;
}

/** The core's element in the same shape; missing children sorted after checking they hold no duplicate. */
function shown(element: ShownElement) {
  const verification = element.verification?.map(({ view, status, missingChildren, criteria }) => {
    if (missingChildren !== undefined) {
      expect(new Set(missingChildren).size).toBe(missingChildren.length);
    }
    return {
      view,
      status,
      ...(missingChildren === undefined ? {} : { missingChildren: [...missingChildren].sort() }),
      ...(criteria === undefined ? {} : { criteria: { verified: criteria.verified, total: criteria.total } }),
    };
  });
  return {
    ...(verification === undefined
      ? {}
      : { verification: verification.sort((a, b) => a.view.localeCompare(b.view)) }),
    ...(element.validation === undefined ? {} : { validation: element.validation }),
    ...(element.validationReason === undefined ? {} : { validationReason: element.validationReason }),
  };
}

/** What the model says the core shows of `element`. */
function expectedShown(
  ws: ModelWorkspace,
  status: Map<string, ModelEntry[]>,
  element: ModelWorkspaceElement,
) {
  const validation = shownValidationOf(element);
  return {
    ...(element.type === "requirement"
      ? { verification: expectedEntries(ws, status.get(element.key) ?? []) }
      : {}),
    ...(validation === undefined ? {} : { validation: validation.status }),
    ...(validation?.reason === undefined ? {} : { validationReason: validation.reason }),
  };
}

/** The key of the element file at `repository` and `file`. */
function keyIn(ws: ModelWorkspace, repository: string, file: string): string | undefined {
  return ws.elements.find((element) => {
    const place = elementPlaceOf(element);
    return place.repository === repository && place.file === file;
  })?.key;
}

const VERIFICATION_SETS = [["verified", "indirect"], ["open", "failed", "outdated"], ["failed"]] as const;
const VALIDATION_SETS = [
  ["validated", "inconclusive"],
  ["open", "failed", "outdated"],
] as const;

/** One read through the catalog and its comparison with the model; `at` is its place in the generated order. */
interface Call {
  readonly at: number;
  readonly name: string;
  readonly run: (workspace: Workspace) => Promise<void>;
}

function callsOf(files: ModelFileWorkspace): Call[] {
  const ws = modelOfFiles(files);
  const status = modelWorkspaceStatusOf(ws);
  const keyOf = (repository: string, file: string) => keyIn(ws, repository, file);
  const views = [CORE_VIEW, ...ws.variants.map((variant) => variant.id)];
  const all = new Set(ws.elements.map((element) => element.key));
  const calls: Omit<Call, "at">[] = [
    {
      name: "evidence.status",
      run: async (workspace) => {
        const output = (await invoke("evidence.status", {}, { workspace })) as { elements: ShownElement[] };
        // Every element and variant once, no other file: an element the model does not know would show.
        const variantOf = (repository: string, file: string) =>
          ws.variants.find((variant) => {
            const place = variantPlaceOf(variant);
            return place.repository === repository && place.file === file;
          })?.id;
        expect(
          output.elements
            .map(
              (element) =>
                keyOf(element.repository, element.file) ?? variantOf(element.repository, element.file),
            )
            .sort(),
        ).toEqual(
          [...ws.elements.map((element) => element.key), ...ws.variants.map((variant) => variant.id)].sort(),
        );
        const byKey = new Map(
          output.elements.map((element) => [keyOf(element.repository, element.file), element]),
        );
        for (const element of ws.elements) {
          const actual = byKey.get(element.key);
          expect({ key: element.key, shown: actual === undefined ? undefined : shown(actual) }).toEqual({
            key: element.key,
            shown: expectedShown(ws, status, element),
          });
        }
      },
    },
    ...ws.elements.map((element) => ({
      name: `element.get ${element.key}`,
      run: async (workspace: Workspace) => {
        const place = elementPlaceOf(element);
        const output = (await invoke(
          "element.get",
          { ref: uuidOf(element.id), repository: place.repository, file: place.file },
          { workspace },
        )) as { element: ShownElement };
        expect({ key: element.key, shown: shown(output.element) }).toEqual({
          key: element.key,
          shown: expectedShown(ws, status, element),
        });
      },
    })),
    ...views.map((view) => ({
      name: `evidence.degree ${view}`,
      run: async (workspace: Workspace) => {
        const output = (await invoke(
          "evidence.degree",
          { selection: { view: viewIdOf(view) } },
          { workspace },
        )) as {
          degree: unknown;
        };
        expect({ view, degree: output.degree }).toEqual({ view, degree: degreeOf(ws, view, all) });
      },
    })),
    {
      // D2: a selection without view is the core.
      name: "evidence.degree without view",
      run: async (workspace: Workspace) => {
        const output = (await invoke("evidence.degree", { selection: {} }, { workspace })) as {
          degree: unknown;
        };
        expect({ view: "none", degree: output.degree }).toEqual({
          view: "none",
          degree: degreeOf(ws, CORE_VIEW, all),
        });
      },
    },
    ...views.flatMap((view) =>
      VERIFICATION_SETS.map((statuses) => ({
        name: `element.list verification ${view} ${statuses.join(",")}`,
        run: async (workspace: Workspace) => {
          const output = (await invoke(
            "element.list",
            { selection: { where: { verification: [...statuses], variant: viewIdOf(view) } } },
            { workspace },
          )) as { elements: ShownElement[] };
          const keys = output.elements
            .map((element) => keyOf(element.repository, element.file) ?? "?")
            .sort();
          expect({ view, statuses, keys }).toEqual({
            view,
            statuses,
            keys: [...verificationMatches(ws, view, statuses)].sort(),
          });
        },
      })),
    ),
    ...VALIDATION_SETS.map((statuses) => ({
      name: `element.list validation ${statuses.join(",")}`,
      run: async (workspace: Workspace) => {
        const output = (await invoke(
          "element.list",
          { selection: { where: { validation: [...statuses] } } },
          { workspace },
        )) as { elements: ShownElement[] };
        const keys = output.elements.map((element) => keyOf(element.repository, element.file) ?? "?").sort();
        expect({ statuses, keys }).toEqual({ statuses, keys: [...validationMatches(ws, statuses)].sort() });
      },
    })),
  ];
  // The generated order (sort keys of `order`), so the states of the workspace fill in a different order each run.
  return calls
    .map((call, index) => ({ ...call, at: index }))
    .sort(
      (a, b) =>
        (ws.order[a.at % ws.order.length] ?? 0) - (ws.order[b.at % ws.order.length] ?? 0) || a.at - b.at,
    );
}

describe("status model level 2: a workspace on disk against the reference model", () => {
  it(
    "shows the model's statuses, degree and filter results through the commands, in any call order",
    async ({ annotate }) => {
      const started = performance.now();
      await forAllFileWorkspaces(async (files) => {
        await writeWorkspace(files);
        const before = await snapshot();
        const workspace = new Workspace(root);
        try {
          for (const call of callsOf(files)) {
            await call.run(workspace);
          }
        } finally {
          await workspace.close();
        }
        // No read changes a file, the person-set status included (D-030).
        expect(await snapshot()).toEqual(before);
      }, parameters);
      // Measured (#1396): the time of the whole property with its run count, in the report and the JUnit file.
      await annotate(
        `status model level 2: ${String(parameters.numRuns)} runs in ${String(Math.round(performance.now() - started))} ms`,
      );
    },
    TIMEOUT,
  );
});

type Shown = ReturnType<typeof shown>;

/** Writes `files` and gives what `evidence.status` shows of each element, by key. */
async function statusOf(files: ModelFileWorkspace): Promise<Map<string, Shown>> {
  await writeWorkspace(files);
  const workspace = new Workspace(root);
  try {
    const output = (await invoke("evidence.status", {}, { workspace })) as { elements: ShownElement[] };
    return new Map(
      output.elements.map((element) => [
        keyIn(files.base, element.repository, element.file) ?? "?",
        shown(element),
      ]),
    );
  } finally {
    await workspace.close();
  }
}

/** `files` with only the records `keep` holds for. */
function keeping(files: ModelFileWorkspace, keep: (file: ModelFileRecord) => boolean): ModelFileWorkspace {
  return {
    ...files,
    records: Object.fromEntries(
      Object.entries(files.records).map(([id, records]) => [id, records.filter(keep)]),
    ),
  };
}

/** `files` with `added` as the last record of the UUID `id`. */
function adding(files: ModelFileWorkspace, id: string, added: ModelRecord): ModelFileWorkspace {
  const file: ModelFileRecord = {
    record: added,
    pin: 0,
    form: "n2",
    format: "markdown",
    location: 0,
    crlf: false,
  };
  return { ...files, records: { ...files.records, [id]: [...(files.records[id] ?? []), file] } };
}

/** The files of `id` and every element above them through derivation items (W1), whatever the view. */
function selfAndAncestors(ws: ModelWorkspace, id: string): Set<string> {
  const found = new Set(ws.elements.filter((element) => element.id === id).map((element) => element.key));
  let grown = true;
  while (grown) {
    grown = false;
    for (const child of ws.elements.filter((element) => found.has(element.key))) {
      for (const ref of child.derivesFrom) {
        const parent = resolveRef(ws, ref, child.repository);
        if (parent !== undefined && !found.has(parent.key)) {
          found.add(parent.key);
          grown = true;
        }
      }
    }
  }
  return found;
}

/** The verification entries of a shown element by view. */
function entriesByView(element: Shown | undefined): Map<string, NonNullable<Shown["verification"]>[number]> {
  return new Map((element?.verification ?? []).map((entry) => [entry.view, entry]));
}

/** Status changes an older-version record may cause: an own record makes open or indirect outdated, and a parent
 * whose indirect child turns outdated is open (I3, I4). */
const OLDER_RECORD_CHANGES = new Set(["open>outdated", "indirect>outdated", "indirect>open"]);

describe("status model level 2: invariants and metamorphic properties", () => {
  it(
    "gives one entry per view, counts that add up, verified only on passed newest records, in any order",
    async ({ annotate }) => {
      const started = performance.now();
      await forAllFileWorkspaces(async (files) => {
        const ws = modelOfFiles(files);
        await writeWorkspace(files);
        const first = new Workspace(root);
        const second = new Workspace(root);
        try {
          const status = (await invoke("evidence.status", {}, { workspace: first })) as {
            elements: ShownElement[];
          };
          // Order independence: a second workspace asked element by element, in reverse, then as a whole.
          for (const element of [...ws.elements].reverse()) {
            const place = elementPlaceOf(element);
            await invoke(
              "element.get",
              { ref: uuidOf(element.id), repository: place.repository, file: place.file },
              { workspace: second },
            );
          }
          expect(await invoke("evidence.status", {}, { workspace: second })).toEqual(status);
          expectOneEntryPerView(ws, status.elements);
          await expectDegreesAddUp(ws, first);
        } finally {
          await first.close();
          await second.close();
        }
      }, parameters);
      await annotate(
        `invariants: ${String(parameters.numRuns)} runs in ${String(Math.round(performance.now() - started))} ms`,
      );
    },
    TIMEOUT,
  );

  it(
    "keeps verification and validation apart and changes only what an added record reaches",
    async ({ annotate }) => {
      const started = performance.now();
      const changes = new Map<string, number>();
      await forAllFileWorkspaces(async (files) => {
        const ws = modelOfFiles(files);
        const before = await statusOf(files);
        const verificationOnly = (map: Map<string, Shown>) =>
          new Map([...map].map(([key, value]) => [key, value.verification]));
        const validationOnly = (map: Map<string, Shown>) =>
          new Map([...map].map(([key, value]) => [key, [value.validation, value.validationReason]]));
        // D-007: validation records never change the verification status, and verification records never the validation.
        expect(
          verificationOnly(await statusOf(keeping(files, (file) => file.record.kind !== "validation"))),
        ).toEqual(verificationOnly(before));
        expect(
          validationOnly(await statusOf(keeping(files, (file) => file.record.kind !== "verification"))),
        ).toEqual(validationOnly(before));
        // The UUID a record is added to: one indirect in the core when there is one (the case the plan's wording
        // misses), else one in the generated order.
        const core = entriesInView(ws, CORE_VIEW);
        const target =
          ws.elements.find((element) => core.get(element.key)?.status === "indirect")?.id ??
          ws.elements[(ws.order[0] ?? 0) % ws.elements.length]?.id ??
          "";
        const reached = selfAndAncestors(ws, target);
        // A passed current record changes the verification of its element's files and their ancestors only.
        const passed = await statusOf(
          adding(files, target, {
            kind: "verification",
            version: CURRENT,
            date: renderDate(9, "Z"),
            result: "passed",
          }),
        );
        for (const [key, value] of passed) {
          if (!reached.has(key)) {
            expect({ key, verification: value.verification }).toEqual({
              key,
              verification: before.get(key)?.verification,
            });
          }
        }
        expect(validationOnly(passed)).toEqual(validationOnly(before));
        // A record of an older version turns open into outdated, and touches indirect entries only through the record.
        const older = await statusOf(
          adding(files, target, {
            kind: "verification",
            version: "v1",
            date: renderDate(9, "Z"),
            result: "passed",
          }),
        );
        expectOlderRecordChanges(before, older, changes);
        expect(validationOnly(older)).toEqual(validationOnly(before));
      }, parameters);
      await annotate(
        `metamorphic: ${String(parameters.numRuns)} runs in ${String(Math.round(performance.now() - started))} ms; ` +
          `changes by an older record: ${JSON.stringify(Object.fromEntries(changes))}`,
      );
    },
    2 * TIMEOUT,
  );
});

/** One entry per view, none for an invalid variant, none for an element that is no requirement (W8); verified only
 * on passed newest records. */
function expectOneEntryPerView(ws: ModelWorkspace, elements: readonly ShownElement[]): void {
  const invalid = new Set(
    ws.variants.filter((variant) => variant.invalid).map((variant) => uuidOf(variant.id)),
  );
  for (const shownElement of elements) {
    const element = ws.elements.find(
      (candidate) => candidate.key === keyIn(ws, shownElement.repository, shownElement.file),
    );
    const views = (shownElement.verification ?? []).map((entry) => entry.view);
    expect(new Set(views).size).toBe(views.length);
    expect(views.filter((view) => invalid.has(view))).toEqual([]);
    if (element?.type !== "requirement") {
      expect(shownElement.verification).toBeUndefined();
      continue;
    }
    for (const entry of shownElement.verification ?? []) {
      if (entry.status === "verified") {
        expectPassedNewest(ws, element, entry.view);
      }
    }
  }
}

/** The degree of every view: the counts add up to the total, the share is (verified + indirect) / total, none at 0. */
async function expectDegreesAddUp(ws: ModelWorkspace, workspace: Workspace): Promise<void> {
  for (const view of ["core", ...ws.variants.map((variant) => uuidOf(variant.id))]) {
    const { degree } = (await invoke("evidence.degree", { selection: { view } }, { workspace })) as {
      degree: { total: number; share?: number; counts: Record<string, number> };
    };
    const { open = 0, verified = 0, indirect = 0, failed = 0, outdated = 0 } = degree.counts;
    expect(open + verified + indirect + failed + outdated).toBe(degree.total);
    expect(degree.share).toBe(degree.total === 0 ? undefined : (verified + indirect) / degree.total);
  }
}

/** After an older-version record: the same views, only the changes of OLDER_RECORD_CHANGES, the same counts. */
function expectOlderRecordChanges(
  before: Map<string, Shown>,
  after: Map<string, Shown>,
  changes: Map<string, number>,
): void {
  for (const [key, value] of after) {
    const was = entriesByView(before.get(key));
    const now = entriesByView(value);
    expect({ key, views: [...now.keys()] }).toEqual({ key, views: [...was.keys()] });
    for (const [view, entry] of now) {
      const old = was.get(view);
      const change = `${old?.status ?? ""}>${entry.status}`;
      if (old?.status !== entry.status) {
        changes.set(change, (changes.get(change) ?? 0) + 1);
        expect({ key, view, change, allowed: OLDER_RECORD_CHANGES.has(change) }).toEqual({
          key,
          view,
          change,
          allowed: true,
        });
      }
      if (old?.criteria !== undefined && entry.criteria !== undefined) {
        expect({ key, view, verified: entry.criteria.verified }).toEqual({
          key,
          view,
          verified: old.criteria.verified,
        });
      }
    }
  }
}

/**
 * Verified in a view: each criterion (or, without criteria, the requirement) has a record of the current version that
 * counts for it in the view, and the newest of them all passed (V4, V9, V14; R1 to R3 with the pooling of SR-173).
 */
function expectPassedNewest(ws: ModelWorkspace, element: ModelWorkspaceElement, view: string): void {
  const viewId =
    view === "core" ? CORE_VIEW : (ws.variants.find((variant) => uuidOf(variant.id) === view)?.id ?? view);
  const records = recordsInView(ws, element, viewId);
  const own = { ...element.own, records };
  const groups =
    element.own.criteria.length === 0
      ? [records]
      : element.own.criteria.map((criterion, index) =>
          records.filter((record) => countsForCriterion(record, own, criterion, index)),
        );
  for (const group of groups) {
    const current = group.filter(isCurrent);
    expect({ key: element.key, view, current: current.length > 0 }).toEqual({
      key: element.key,
      view,
      current: true,
    });
    expect(newestOf(current).every((record) => record.result === "passed")).toBe(true);
  }
}
