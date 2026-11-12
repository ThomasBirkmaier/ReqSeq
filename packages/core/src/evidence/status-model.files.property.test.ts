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
// Runs: STATUS_MODEL_FILE_RUNS (default 30) and STATUS_MODEL_SEED; one temp folder, emptied before each run.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CORE_VIEW,
  type ModelEntry,
  type ModelFileWorkspace,
  type ModelWorkspace,
  type ModelWorkspaceElement,
  degreeOf,
  elementFilesOf,
  elementPlaceOf,
  fileParameters,
  forAllFileWorkspaces,
  modelOfFiles,
  recordFilesOf,
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
  const keyOf = (repository: string, file: string) =>
    ws.elements.find((element) => {
      const place = elementPlaceOf(element);
      return place.repository === repository && place.file === file;
    })?.key;
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
  it("shows the model's statuses, degree and filter results through the commands, in any call order", async ({
    annotate,
  }) => {
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
  }, 300_000);
});
