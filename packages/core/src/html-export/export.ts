// The HTML export of a workspace (SR-231, SR-235; packages/core/docs/html-export.md): the pages of
// every element without an invalid status (D-044) and a start page, written through the export folder
// of the files block (`openExportFolder`), which replaces only what the earlier export wrote. Each element page
// is built by `element-page.ts` from the data of `element-data.ts` (SR-232); an element with an invalid status
// whose page the earlier export wrote gets the short page of SR-231 AK8 (`stub-page.ts`) at the same address. The search (AK7) is `search.ts`.
//
// - Look (SR-231 AK4, `page.ts`): the docs' frame and stylesheet, the theme and page scripts, and, once in
//   the folder, KaTeX's stylesheet and the Mermaid bundle when a page needs them (`vendor.ts`, missing:
//   `internal` before anything is written), and the notices of what the folder holds.
// - References (AK6), in the text and in every Markdown property, each item of a list (acceptance criteria)
//   too: an element with a page or a short page (AK8) is a link to it; a target with an invalid status and
//   no short page, a missing one, one whose UUID several files share and one in a repository the
//   workspace file does not name is its link text; a target in a repository that is not on this machine
//   is its link text and `UNKNOWN-<tail>` with the repository and "not accessible", as SR-006 AK1 shows it.
// - Footer (AK9): the commit of the main repository (12 characters, `-dirty` unless every available
//   repository is known clean, as `data.store` names its file, SR-062 AK1; "no commit" without one), the
//   date of the export (UTC) and the version of ReqSeq.
//
// - Names (SR-231 AK3): `elements/<uuid>.html`, since the UUID never changes (D-017); the copies of the
//   images of one element `images/<uuid>-<n><extension of the type the bytes are>`, `n` counting the
//   image files of its texts in the order they first appear.
// - No page and a finding: an element whose UUID several files share (`element.duplicate-id`). Each
//   faulty file the store reports (severity error) is a finding as the store gives it.
// - Refused before anything is written (`input.invalid`): a target in a `.git` folder, also through
//   links (D-036, SR-083 AK4), and a folder ReqSeq reads YAML files from (metamodel, filters,
//   perspectives, baselines, mappings), where the marker file would be read as one of them.
// - An error while writing leaves the target as it was (SR-235 AK6, `ExportFolder.abort`).
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { OverviewDisplay } from "../displays/index.js";
import { overviewDisplay, typeCounts } from "../displays/index.js";
import type { ExportFolder } from "../files/index.js";
import { imageExtension, openExportFolder, readElementText, readFileSnapshot } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState, propertyWithMeaning } from "../metamodel/index.js";
import { selectionDegree } from "../evidence/index.js";
import { listHints } from "../hints/index.js";
import { NO_RANKS, compareSortValues, sortElements, sortValueOf } from "../query/index.js";
import type {
  ElementRecord,
  ElementStore,
  FilesAtCommit,
  ImageLink,
  ShortIds,
  StateReader,
} from "../model/index.js";
import {
  fieldDifference,
  filesAtCommit,
  UNKNOWN_TYPE_PREFIX,
  currentFormsOf,
  currentVersions,
  elementStoreState,
  embedsOf,
  identifierField,
  ignoredBy,
  invalidStatuses,
  referenceTargetState,
  repositoryState,
  shortIdState,
  stateRules,
  titleKeyOrEmpty,
} from "../model/index.js";
import { PRODUCT_VERSION } from "../product.js";
import { traceContext } from "../trace/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { viewRuleIn, viewRuleIndexOf, variantsOf } from "../variants/index.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import {
  DEFAULT_FOLDERS,
  locate,
  refuseGitAt,
  settingLocation,
  workspaceLayoutState,
} from "../workspace/index.js";
import type { ImageOutcome, ReferenceOutcome } from "./markdown.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";
import { NOTICES_FILE, noticesText } from "./notices.js";
import type { Navigation } from "./page.js";
import { ASSETS, DOCS_CSS, OWN_CSS, page } from "./page.js";
import type { ListCompare, ListContext, ListEntry, ListPage } from "./list-page.js";
import { LIST_SCRIPT, listPageOf, listsOf, sortedByIdentifier } from "./list-page.js";
import { listScript } from "./list-script.js";
import type { NewestBaseline } from "./start-page.js";
import { startPageBody } from "./start-page.js";
import { COPY_SCRIPT, copyScript } from "./copy-script.js";
import type { ElementData } from "./element-data.js";
import { elementDataOf } from "./element-data.js";
import type { ElementPageContext } from "./element-page.js";
import { elementPageBody } from "./element-page.js";
import { elementPage, pageLinks } from "./links.js";
import { neighbourhoodSource } from "./section-neighbourhood.js";
import { stubPageBody } from "./stub-page.js";
import type { BaselineRow, ExportBaseline, RowElement } from "./baselines.js";
import {
  BASELINES_PAGE,
  baselinePage,
  baselinePageBody,
  baselinesPageBody,
  dayOf,
  rowElementOf,
} from "./baselines.js";
import type { Difference, SinceBaseline } from "./section-baselines.js";
import type { VariantView } from "./variants.js";
import { VARIANTS_PAGE, isRequirementEntry, variantsPageBody } from "./variants.js";
import { CHANGE_VALUES } from "./list-page.js";
import type { PageScriptSettings } from "./page-script.js";
import { pageScript, scriptOf, themeScript } from "./page-script.js";
import {
  SEARCH_INDEX,
  SEARCH_SCRIPT_SETTINGS,
  searchEntries,
  searchIndexScript,
  searchScript,
} from "./search.js";
import { DIAGRAM_COLOURS, MERMAID_SETTINGS, SECURE_KEYS } from "./render-options.js";
import { svgRisk } from "./svg.js";
import type { VendorFiles } from "./vendor.js";
import { readVendor } from "./vendor.js";

/** The marker file of an HTML export (`html-export-marker.schema.json`). */
export const MARKER = {
  file: "reqseq-html-export.yaml",
  key: "reqseq-html-export",
  comment: "Written by ReqSeq html.export; lists the files of this export. Do not edit.",
} as const;

export interface HtmlExportResult {
  /** The real path of the folder written. */
  readonly folder: string;
  readonly pages: number;
  /** The elements that got a page, in the order of the store (SR-224 AK4). */
  readonly exported: readonly {
    readonly id: string;
    readonly shortId: string;
    readonly repository: string;
  }[];
  readonly removed: number;
  /** A repository of the workspace file is not on this machine, as the start page says (SR-006 AK2). */
  readonly incomplete: boolean;
  readonly problems: readonly Problem[];
}

/** Refuses a target ReqSeq reads YAML files from (see the file comment). */
const refuseDataFolder = async (layout: WorkspaceLayout, target: string): Promise<void> => {
  const real = await fs.realpath(target).catch(() => path.resolve(target));
  const settings = (Object.keys(DEFAULT_FOLDERS) as (keyof typeof DEFAULT_FOLDERS)[]).map((s) =>
    settingLocation(layout, s),
  );
  const folders = [layout.metamodel, ...settings]
    .map((location) => ({ location, folder: locate(layout, location).folder }))
    .filter((f): f is { location: typeof f.location; folder: string } => f.folder !== undefined);
  for (const { location, folder } of folders) {
    const realFolder = await fs.realpath(folder).catch(() => folder);
    if (realFolder === real || path.resolve(folder) === path.resolve(target)) {
      throw new CommandError(
        "input.invalid",
        `output: ReqSeq reads the YAML files of ${location.path}, so an HTML export cannot go there; choose another folder`,
        { fields: ["output"] },
      );
    }
  }
};

/** What the core function takes besides the workspace and the target; tests set them. */
export interface HtmlExportOptions {
  /** The clock of the footer's date; default now. */
  readonly now?: () => Date;
  /** Reads Git and the disk for `-dirty`; default `DEFAULT_STATE_READER`. */
  readonly state?: StateReader;
  /** The vendor folder (`vendor.ts`); default the one of this installation. */
  readonly vendor?: string;
  /** The newest baseline and what changed since (`html.export` gives it); none: the workspace has no baseline. */
  readonly newestBaseline?: NewestBaseline;
  /** Every baseline as `baseline.get` gives it with all its rows, newest first (`html.export` gives them). */
  readonly baselines?: readonly ExportBaseline[];
}

/** The docs' token that gives each colour role of a diagram (`DIAGRAM_COLOURS`). */
const DIAGRAM_TOKENS: Readonly<Record<string, string>> = {
  text: "--sl-color-white",
  muted: "--sl-color-gray-3",
  rule: "--sl-color-gray-5",
  edge: "--sl-color-gray-4",
  sheet: "--sl-color-black",
  raised: "--sl-color-gray-6",
};

/** The settings `assets/reqseq.js` draws diagrams with. */
export const PAGE_SCRIPT_SETTINGS: PageScriptSettings = {
  mermaid: MERMAID_SETTINGS,
  secure: SECURE_KEYS,
  colours: DIAGRAM_COLOURS,
  tokens: DIAGRAM_TOKENS,
};

interface PageContext {
  readonly folder: ExportFolder;
  readonly layout: WorkspaceLayout;
  readonly page: ElementPageContext;
  readonly problems: Problem[];
  readonly reference: (record: ElementRecord) => TextContext["reference"];
}

type TextContext = Parameters<typeof renderMarkdown>[1];

/** What the pages of the export need: KaTeX's stylesheet, the Mermaid bundle. */
interface Needs {
  formulas: boolean;
  diagrams: boolean;
}

/** The images of one element: copies into the export, each file once (see the file comment). */
const imageCopier = (context: PageContext, repository: RepositoryLocation, record: ElementRecord) => {
  const copies = new Map<string, Promise<ImageOutcome>>();
  const copy = async (link: ImageLink, index: number): Promise<ImageOutcome> => {
    if (link.missing) {
      return { code: "html.image-not-copied", reason: "is not in the repository" };
    }
    const read = await readFileSnapshot(repository.folder, link.names.join("/"));
    if (read.kind !== "read") {
      return {
        code: "html.image-not-copied",
        reason: read.missing ? "is not in the repository" : "is no regular file (a link is never followed)",
      };
    }
    const extension = imageExtension(read.bytes);
    if (extension === undefined) {
      return { code: "html.image-not-copied", reason: "is no image by its content" };
    }
    const risk = extension === ".svg" ? svgRisk(read.bytes) : undefined;
    if (risk !== undefined) {
      return { code: "html.unsafe-content", reason: `is an SVG image with ${risk}` };
    }
    const name = `images/${record.id}-${String(index)}${extension}`;
    await context.folder.write(name, read.bytes);
    return { src: `../${name}` };
  };
  return (link: ImageLink): Promise<ImageOutcome> => {
    const key = link.names.join("/");
    let outcome = copies.get(key);
    if (outcome === undefined) {
      outcome = copy(link, copies.size);
      copies.set(key, outcome);
    }
    return outcome;
  };
};

/** The HTML of one element's page and what it needs, its findings added to `context.problems`. */
const elementHtml = async (
  context: PageContext,
  record: ElementRecord,
  data: ElementData,
): Promise<{ html: string; needs: Needs }> => {
  // The store holds elements of available repositories only, so a missing one is a bug.
  const repository = context.layout.repositories.find((r) => r.name === record.repository);
  if (repository === undefined) {
    throw new CommandError(
      "internal",
      `Repository ${record.repository} of ${record.file} is not in the workspace`,
    );
  }
  const text = await readElementText(repository.folder, record.file, record.snapshot);
  if (text === undefined) {
    throw new CommandError(
      "file.changed-on-disk",
      `Not exported: ${record.file} in repository ${record.repository} changed since it was read; run the export again`,
      { file: record.file, repository: record.repository },
    );
  }
  const textContext: TextContext = {
    elementFile: record.file,
    ignored: ignoredBy(context.layout),
    image: imageCopier(context, repository, record),
    reference: context.reference(record),
  };
  const needs: Needs = { formulas: false, diagrams: false };
  const markdown = async (source: string, where: string): Promise<string> => {
    const rendered = await renderMarkdown(source, textContext);
    needs.formulas ||= rendered.formulas;
    needs.diagrams ||= rendered.diagrams;
    for (const finding of rendered.findings) {
      context.problems.push({
        code: finding.code,
        severity: "warning",
        message: `${where}: ${finding.message}`,
        repository: record.repository,
        file: record.file,
        elementId: record.id,
      });
    }
    return rendered.html;
  };
  const html = await elementPageBody(context.page, { record, data, text, markdown });
  return { html, needs };
};

/** The outcome of each reference of `record`'s texts (see the file comment). */
const referenceResolver =
  (layout: WorkspaceLayout, store: ElementStore, shortIds: ShortIds, withPage: ReadonlySet<ElementRecord>) =>
  (record: ElementRecord): TextContext["reference"] =>
  (target): ReferenceOutcome => {
    const state = referenceTargetState(layout, store, record.repository, target);
    if (state.kind === "available" && withPage.has(state.element)) {
      return { href: `../${elementPage(state.element.id)}` };
    }
    if (state.kind === "inaccessible") {
      return {
        note: `${UNKNOWN_TYPE_PREFIX}-${shortIds.tail(target.id)}, repository ${state.repository}, not accessible`,
      };
    }
    return { text: true };
  };

/** The text of the footer of every page (see the file comment). */
const footerOf = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  store: ElementStore,
  options: HtmlExportOptions,
): Promise<string> => {
  const embeds = embedsOf(await currentVersions(workspace));
  const states = await Promise.all(
    layout.repositories
      .filter((repository) => repository.available)
      .map(async (repository) => ({
        main: repository.main,
        state: await repositoryState(
          stateRules(layout, repository, embeds.get(repository.name) ?? new Set()),
          store.elements.filter((r) => r.repository === repository.name).map((r) => r.file),
          options.state,
        ),
      })),
  );
  const commit = states.find((s) => s.main)?.state.commit;
  const clean = states.every((s) => s.state.commit !== undefined && s.state.dirty === false);
  const date = (options.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const named = commit === undefined ? "no commit" : `Commit ${commit.slice(0, 12)}${clean ? "" : "-dirty"}`;
  return `${named} · exported ${date} with ReqSeq ${PRODUCT_VERSION}`;
};

/**
 * The heading of the page of `record`: its identifier, then its title when it has one; a package (a type with the
 * meaning package) by its title alone, as the sidebar names it (SR-233 AK4, #2139).
 */
const headingOf = (
  metamodel: Metamodel,
  record: ElementRecord,
  titleKey: string,
  shortIds: ShortIds,
): string => {
  const title = record.data[titleKey];
  const name = identifierField(shortIds, record).identifier ?? shortIds.of(record);
  if (typeof title !== "string" || title === "") {
    return name;
  }
  return findType(metamodel, record.type)?.meaning === "package" ? title : `${name} ${title}`;
};

/** KaTeX's stylesheet and the Mermaid bundle, each only when a page needs it. */
const writeVendorAssets = async (folder: ExportFolder, vendor: VendorFiles, needs: Needs): Promise<void> => {
  if (needs.formulas) {
    await folder.write(ASSETS.katex, vendor.katex);
  }
  if (needs.diagrams) {
    await folder.write(ASSETS.mermaid, vendor.mermaid);
  }
};

const NO_NEEDS: Needs = { formulas: false, diagrams: false };

/** The key of the hints of an element copy. */
const hintKey = (id: string, repository: string | undefined): string => `${id}\n${String(repository)}`;

/** The number of open hints (`hint.list`) of each element copy, by `hintKey`. */
const hintCounts = async (workspace: Workspace): Promise<ReadonlyMap<string, number>> => {
  const { hints } = await listHints(workspace, { limit: Number.MAX_SAFE_INTEGER, offset: 0 });
  const counts = new Map<string, number>();
  for (const hint of hints) {
    // A hint on an evidence record names the element's own repository apart from the record's (`problemElement`).
    const key = hintKey(String(hint.elementId), hint.elementRepository ?? hint.repository);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

/** A package as the sidebar names it: its title, else its short ID. */
const packageLabel = ({ element }: ListEntry): string =>
  element.title === "" ? element.shortId : element.title;

/**
 * The packages with a page (elements of a type with the meaning package), by title, each with the elements of
 * `entries` whose property with the meaning `packages` names it, in the order of `entries` (SR-233 AK4).
 */
const packagesWithMembers = (
  metamodel: Metamodel,
  entries: readonly ListEntry[],
): Map<ListEntry, ListEntry[]> => {
  const key = propertyWithMeaning(metamodel, "packages")?.key;
  const packages = entries
    .filter(({ record }) => findType(metamodel, record.type)?.meaning === "package")
    .map((entry) => ({ entry, sort: sortValueOf(packageLabel(entry), NO_RANKS) }))
    .sort((a, b) => compareSortValues(a.sort, b.sort));
  const byId = new Map(packages.map(({ entry }) => [entry.element.id, entry]));
  const members = new Map<ListEntry, ListEntry[]>(packages.map(({ entry }) => [entry, []]));
  for (const entry of entries) {
    const named = entry.element.relations.filter((r) => r.property === true && r.kind === key);
    for (const id of new Set(named.map((r) => r.id))) {
      const owner = byId.get(id);
      if (owner !== undefined) {
        members.get(owner)?.push(entry);
      }
    }
  }
  return members;
};

/**
 * What the pages of the export share besides the element pages: the elements with a page (`paged`) as the lists show
 * them, by identifier; the type lines of the start page; the lists in their order; the sidebar; and the elements of
 * each package by its UUID.
 */
export const siteOf = async (
  workspace: Workspace,
  context: ListContext,
  data: readonly ElementData[],
  paged: ReadonlySet<ElementRecord>,
  compare: ListCompare,
  more: Navigation,
): Promise<{
  readonly entries: readonly ListEntry[];
  readonly overview: OverviewDisplay;
  readonly lists: readonly ListPage[];
  readonly navigation: Navigation;
  readonly members: ReadonlyMap<string, readonly ListEntry[]>;
}> => {
  const { metamodel } = context;
  const hints = await hintCounts(workspace);
  const entries = sortedByIdentifier(
    context,
    data
      .filter(({ record }) => paged.has(record))
      .map(({ record, element }) => ({
        record,
        element,
        hints: hints.get(hintKey(record.id, record.repository)) ?? 0,
      })),
  );
  // The type lines count the elements the lists hold, in the order `element.facets` gives them (ADR-0019 point 9(a));
  // the lists follow that order.
  const shown = data.filter(({ record }) => paged.has(record)).map(({ element }) => element);
  const overview = overviewDisplay({ types: typeCounts(shown, metamodel) });
  const lists = listsOf(context, entries, overview.types).map(({ type, entries: listed }) =>
    listPageOf(context, type, listed, compare),
  );
  const packages = packagesWithMembers(metamodel, entries);
  const navigation: Navigation = [
    { label: "Lists", links: lists.map((list) => ({ path: list.path, label: list.title })) },
    {
      label: "Packages",
      links: [...packages.keys()].map((entry) => ({
        path: elementPage(entry.element.id),
        label: packageLabel(entry),
      })),
    },
    ...more,
  ];
  const members = new Map([...packages].map(([entry, listed]) => [entry.element.id, listed]));
  return { entries, overview, lists, navigation, members };
};

/** The key of an element copy in the rows of a baseline. */
const copyKey = (id: string, repository: string | undefined): string => `${id}\n${String(repository)}`;

/** The changes an element page names for a baseline: those of a baseline that lists the element or adds it. */
const SHOWN_CHANGES: ReadonlySet<string> = new Set(["changed", "added", "removed", "unchanged"]);

/** Whether a row's version differs from the one in the baseline, so its page shows the field difference (SR-232 AK7). */
const differs = (row: BaselineRow): boolean =>
  row.state === "changed" || (row.state === "removed" && row.current !== undefined);

/** The differing rows of `baseline` with the copy of the store each names, by repository. */
const differingRows = (
  store: ElementStore,
  baseline: ExportBaseline,
): Map<string, { row: BaselineRow; record: ElementRecord }[]> => {
  const byRepository = new Map<string, { row: BaselineRow; record: ElementRecord }[]>();
  for (const row of baseline.elements) {
    // A differing row names a copy of the store, in its repository.
    const record = differs(row)
      ? store.byId.get(row.id)?.find((r) => r.repository === row.repository)
      : undefined;
    if (record !== undefined) {
      const rows = byRepository.get(record.repository) ?? [];
      rows.push({ row, record });
      byRepository.set(record.repository, rows);
    }
  }
  return byRepository;
};

/** Why an element of repository `name` has no file at `commit` (`found`: what `filesAtCommit` gave, if asked). */
const whyNone = (name: string, commit: string, found: FilesAtCommit | undefined): string =>
  found === undefined
    ? `the baseline names no commit of repository ${name}`
    : !found.known
      ? `Git cannot read repository ${name} (${found.detail})`
      : found.kind === "no-commit"
        ? `the commit ${commit.slice(0, 12)} of the baseline is not in the local Git history of repository ${name}`
        : `no file of repository ${name} held the element at the commit ${commit.slice(0, 12)} of the baseline`;

/**
 * The field difference of the element of each differing row since its baseline: its file at the baseline's commit in
 * its repository (`filesAtCommit`, one pass per baseline and repository) against its file now, or why it is not
 * available. Only the difference is kept, not the files (N-036). It has the shape and the rule of the difference
 * `baseline.compare` gives for one element (D-080, ADR-0019 point 2), which export-baselines.test.ts checks.
 */
export const differencesOf = async (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  store: ElementStore,
  baselines: readonly ExportBaseline[],
): Promise<Map<BaselineRow, Difference>> => {
  const differences = new Map<BaselineRow, Difference>();
  for (const baseline of baselines) {
    const byRepository = differingRows(store, baseline);
    for (const { name, folder } of layout.repositories) {
      const rows = byRepository.get(name) ?? [];
      const commit = baseline.repositories.find((r) => r.name === name)?.commit;
      const found =
        commit === undefined || rows.length === 0
          ? undefined
          : await filesAtCommit(
              folder,
              commit,
              rows.map(({ record }) => ({ file: record.file, id: record.id })),
            );
      const files = found?.known === true && found.kind === "found" ? found.files : [];
      for (const [index, { row, record }] of rows.entries()) {
        const file = files[index];
        const text =
          file === undefined ? undefined : await readElementText(folder, record.file, record.snapshot);
        differences.set(
          row,
          file === undefined
            ? { unavailable: whyNone(name, String(commit), found) }
            : text === undefined
              ? { unavailable: `the file ${record.file} changed since it was read` }
              : fieldDifference(metamodel, file, { type: record.type, data: record.data, text }),
        );
      }
    }
  }
  return differences;
};

/**
 * What each variant with a page adds, replaces and excludes, and its verification degree (SR-234 AK4), in the order of
 * their identifier, as the sidebar lists them.
 */
const variantViews = async (
  workspace: Workspace,
  context: ListContext,
  paged: ReadonlySet<ElementRecord>,
): Promise<Map<ElementRecord, VariantView>> => {
  const { metamodel, store, shortIds } = context;
  const views = new Map<ElementRecord, VariantView>();
  const variants = sortElements(
    { command: "html.export", metamodel, store, shortIds },
    variantsOf(store, metamodel).filter((r) => paged.has(r)),
    [{ by: "identifier", order: "asc" }],
  ).elements;
  const index = viewRuleIndexOf(workspace, store, metamodel);
  for (const variant of variants) {
    const view = { kind: "variant", variant } as const;
    const rule = viewRuleIn(index, view);
    views.set(variant, {
      added: rule.addedOf(),
      replaced: rule.replacedOf(),
      excluded: rule.excludedOf(),
      degree: await selectionDegree(workspace, store.elements, view),
    });
  }
  return views;
};

/**
 * What the pages take from the baselines (SR-232 AK7, SR-233 AK2, SR-234 AK1): the rows of an element in each, newest
 * first, with the field difference since a differing baseline; the change of a list row since each; and how a baseline's
 * page names the element of a row.
 */
const baselineSite = async (
  context: {
    readonly layout: WorkspaceLayout;
    readonly metamodel: Metamodel;
    readonly store: ElementStore;
    readonly shortIds: ShortIds;
    readonly titleKey: string;
    readonly withPage: ReadonlySet<ElementRecord>;
  },
  given: readonly ExportBaseline[] | undefined,
): Promise<{
  readonly baselines: readonly ExportBaseline[];
  readonly since: (record: ElementRecord) => SinceBaseline[];
  readonly compare: ListCompare;
  readonly rowElement: (row: BaselineRow) => RowElement;
}> => {
  const { layout, metamodel, store } = context;
  const baselines = given ?? [];
  const rowsBy = baselines.map(
    (b) => new Map(b.elements.map((row) => [copyKey(row.id, row.repository), row])),
  );
  const differences = await differencesOf(layout, metamodel, store, baselines);
  const since = (record: ElementRecord): SinceBaseline[] =>
    baselines.flatMap((baseline, index) => {
      const row = rowsBy[index]?.get(copyKey(record.id, record.repository));
      const difference = row === undefined ? undefined : differences.get(row);
      return row === undefined || !SHOWN_CHANGES.has(row.state)
        ? []
        : [{ baseline, row, ...(difference === undefined ? {} : { difference }) }];
    });
  const compare: ListCompare = {
    baselines: baselines.map((b) => `${b.name} (${dayOf(b.date)})`),
    changeOf: (record) =>
      rowsBy.map((rows) => {
        const at = (CHANGE_VALUES as readonly string[]).indexOf(
          String(rows.get(copyKey(record.id, record.repository))?.state),
        );
        return at < 0 ? CHANGE_VALUES.length - 1 : at;
      }),
  };
  return { baselines, since, compare, rowElement: rowElementOf(context) };
};

/** The page of all baselines, a page per baseline and the variant comparison, each where there is one (SR-234). */
const writeOverviews = async (
  folder: ExportFolder,
  framed: (path: string, title: string, body: string, own: Needs) => string,
  site: {
    readonly baselines: readonly ExportBaseline[];
    readonly rowElement: (row: BaselineRow) => RowElement;
    readonly views: ReadonlyMap<ElementRecord, VariantView>;
    readonly entries: readonly ListEntry[];
    readonly degree: Awaited<ReturnType<typeof selectionDegree>>;
  },
): Promise<void> => {
  const { baselines, rowElement, views, entries, degree } = site;
  if (baselines.length > 0) {
    await folder.write(
      BASELINES_PAGE,
      framed(BASELINES_PAGE, "Baselines", baselinesPageBody(baselines), NO_NEEDS),
    );
  }
  for (const baseline of baselines) {
    const at = baselinePage(baseline);
    await folder.write(
      at,
      framed(at, `Baseline ${baseline.name}`, baselinePageBody(baseline, rowElement), NO_NEEDS),
    );
  }
  if (views.size > 0) {
    const variants = entries.flatMap((entry) => {
      const view = views.get(entry.record);
      return view === undefined ? [] : [{ entry, degree: view.degree }];
    });
    const requirements = entries.filter(isRequirementEntry);
    await folder.write(
      VARIANTS_PAGE,
      framed(VARIANTS_PAGE, "Variant comparison", variantsPageBody(degree, variants, requirements), NO_NEEDS),
    );
  }
};

/** Writes the HTML export of `workspace` into the absolute folder `target` (see the file comment). */
export const writeHtmlExport = async (
  workspace: Workspace,
  target: string,
  options: HtmlExportOptions = {},
): Promise<HtmlExportResult> => {
  const [layout, metamodel, store, shortIds] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  await refuseGitAt(target, target);
  await refuseDataFolder(layout, target);
  const vendor = await readVendor(options.vendor);
  const made = await footerOf(workspace, layout, store, options);
  const footer = `<span class="rq-footer">${escapeHtml(made)}</span>`;
  const [versions, trace] = await Promise.all([currentVersions(workspace), traceContext(workspace)]);
  const invalid = invalidStatuses(metamodel);
  const titleKey = titleKeyOrEmpty(metamodel);
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const record of store.elements) {
    (seen.has(record.id) ? shared : seen).add(record.id);
  }
  const isInvalid = (record: ElementRecord): boolean => invalid.has(String(record.data["status"]));
  // The elements that get a page; a reference to any other is its link text.
  const paged = new Set(store.elements.filter((r) => !isInvalid(r) && !shared.has(r.id)));
  const folder = await openExportFolder(target, MARKER);
  // The elements with an invalid status whose page the earlier export wrote get the short page (AK8).
  const stubbed = new Set(
    store.elements.filter((r) => isInvalid(r) && !shared.has(r.id) && folder.earlier.has(elementPage(r.id))),
  );
  const withPage = new Set([...paged, ...stubbed]);
  const { baselines, since, compare, rowElement } = await baselineSite(
    { layout, metamodel, store, shortIds, titleKey, withPage },
    options.baselines,
  );
  const problems: Problem[] = [...store.problems.filter((p) => p.severity === "error")];
  const reference = referenceResolver(layout, store, shortIds, withPage);
  const pageContext: Omit<ElementPageContext, "members"> = {
    metamodel,
    store,
    shortIds,
    layout,
    links: pageLinks(new Set([...withPage].map((r) => r.id))),
    neighbourhood: neighbourhoodSource(trace, (record) => currentFormsOf(versions, record)),
  };
  const needs: Needs = { formulas: false, diagrams: false };
  const exported: { id: string; shortId: string; repository: string }[] = [];
  // The repositories of the workspace file not on this machine: the start page names them (SR-006 AK2).
  const missing = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  try {
    problems.push(
      ...store.elements
        .filter((record) => !isInvalid(record) && shared.has(record.id))
        .map((record): Problem => ({
          code: "element.duplicate-id",
          severity: "error",
          message: `No page: several element files have the UUID ${record.id}; give the copy a new UUID`,
          repository: record.repository,
          file: record.file,
          elementId: record.id,
        })),
    );
    const shown = store.elements.filter((r) => withPage.has(r));
    const data = await elementDataOf(workspace, { layout, metamodel, store, shortIds }, shown);
    const views = await variantViews(workspace, { metamodel, store, shortIds }, paged);
    const more: Navigation = [
      {
        label: "Baselines",
        links:
          baselines.length === 0
            ? []
            : [
                { path: BASELINES_PAGE, label: "All baselines" },
                ...baselines.map((b) => ({ path: baselinePage(b), label: b.name })),
              ],
      },
      {
        label: "Variants",
        links:
          views.size === 0
            ? []
            : [
                { path: VARIANTS_PAGE, label: "Variant comparison" },
                ...[...views.keys()].map((variant) => ({
                  path: elementPage(variant.id),
                  label: headingOf(metamodel, variant, titleKeyOrEmpty(metamodel), shortIds),
                })),
              ],
      },
    ];
    const { entries, overview, lists, navigation, members } = await siteOf(
      workspace,
      { metamodel, store, shortIds },
      data,
      paged,
      compare,
      more,
    );
    const context: PageContext = {
      folder,
      layout,
      page: { ...pageContext, members, since, variants: views },
      problems,
      reference,
    };
    const framed = (
      path: string,
      title: string,
      body: string,
      own: Needs,
      scripts: readonly string[] = [],
    ): string => page({ title, siteTitle: layout.name, path, navigation, body, footer, ...own, scripts });
    for (const { record, ...rest } of data) {
      const title = headingOf(metamodel, record, titleKey, shortIds);
      if (stubbed.has(record)) {
        const body = stubPageBody(context.page, { record, ...rest });
        await folder.write(elementPage(record.id), framed(elementPage(record.id), title, body, NO_NEEDS));
        continue;
      }
      const { html, needs: own } = await elementHtml(context, record, { record, ...rest });
      needs.formulas ||= own.formulas;
      needs.diagrams ||= own.diagrams;
      await folder.write(
        elementPage(record.id),
        framed(elementPage(record.id), title, html, own, [COPY_SCRIPT]),
      );
      exported.push({ id: record.id, shortId: shortIds.of(record), repository: record.repository });
    }
    for (const list of lists) {
      await folder.write(list.path, framed(list.path, list.title, list.body, NO_NEEDS, [LIST_SCRIPT]));
    }
    const degree = await selectionDegree(workspace, store.elements, { kind: "core" });
    await writeOverviews(folder, framed, { baselines, rowElement, views, entries, degree });
    const start = startPageBody({
      made,
      missing,
      degree,
      entries,
      overview,
      lists,
      baseline: options.newestBaseline,
    });
    await folder.write("index.html", framed("index.html", layout.name, start, NO_NEEDS));
    await folder.write(ASSETS.docs, DOCS_CSS);
    await folder.write(ASSETS.own, OWN_CSS);
    await folder.write(ASSETS.theme, scriptOf(themeScript));
    await folder.write(
      ASSETS.page,
      scriptOf(pageScript, PAGE_SCRIPT_SETTINGS) + scriptOf(searchScript, SEARCH_SCRIPT_SETTINGS),
    );
    await folder.write(SEARCH_INDEX, searchIndexScript(searchEntries(paged, metamodel, shortIds, titleKey)));
    await folder.write(COPY_SCRIPT, scriptOf(copyScript));
    await folder.write(LIST_SCRIPT, scriptOf(listScript));
    await writeVendorAssets(folder, vendor, needs);
    await folder.write(NOTICES_FILE, noticesText());
  } catch (error) {
    await folder.abort();
    throw error;
  }
  const { removed, cleanupFailed } = await folder.commit();
  for (const entry of folder.ignored) {
    problems.push({
      code: "html.marker-entry-ignored",
      severity: "warning",
      message: `The marker file entry ${entry.entry} is neither replaced nor removed: ${entry.reason}`,
    });
  }
  for (const file of folder.foreign) {
    problems.push({
      code: "html.foreign-file",
      severity: "info",
      message: `${file} was not written by the earlier export and is left as it is`,
    });
  }
  if (cleanupFailed) {
    problems.push({
      code: "html.cleanup-failed",
      severity: "warning",
      message: "The staging folder .reqseq-export-staging could not be removed; remove it by hand",
    });
  }
  return {
    folder: folder.folder,
    pages: exported.length,
    exported,
    removed,
    incomplete: missing.length > 0,
    problems,
  };
};
