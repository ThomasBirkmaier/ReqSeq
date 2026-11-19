// The HTML export of a workspace (SR-231, SR-235; packages/core/docs/html-export.md): the pages of
// every element without an invalid status (D-044) and a start page, written through the export folder
// of the files block (`openExportFolder`), which replaces only what the earlier export wrote. Element
// fields, lists and search come with #1964–#1969.
//
// - Look (SR-231 AK4, `page.ts`): the docs' frame and stylesheet, the theme and page scripts, and, once in
//   the folder, KaTeX's stylesheet and the Mermaid bundle when a page needs them (`vendor.ts`, missing:
//   `internal` before anything is written), and the notices of what the folder holds.
// - References (AK6): an element with a page is a link to it; a target with an invalid status, a missing
//   one and one whose UUID several files share is its link text (the stub page of AK8 comes with #1964);
//   a target in a repository that is not on this machine is its link text and `UNKNOWN-<tail>` with the
//   repository and "not accessible", as SR-006 AK1 shows it.
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
import type { ExportFolder } from "../files/index.js";
import { imageExtension, openExportFolder, readElementText, readFileSnapshot } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, markdownKeysOf, metamodelState } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ImageLink, ShortIds, StateReader } from "../model/index.js";
import {
  UNKNOWN_TYPE_PREFIX,
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
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import {
  DEFAULT_FOLDERS,
  locate,
  refuseGitAt,
  settingLocation,
  workspaceLayoutState,
} from "../workspace/index.js";
import type { ImageOutcome, ReferenceOutcome, TextFinding } from "./markdown.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";
import { NOTICES_FILE, noticesText } from "./notices.js";
import { ASSETS, DOCS_CSS, OWN_CSS, page } from "./page.js";
import type { PageScriptSettings } from "./page-script.js";
import { pageScript, scriptOf, themeScript } from "./page-script.js";
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
  readonly problems: readonly Problem[];
}

/** The page of the element with the UUID `id`, relative to the export folder. */
export const elementPage = (id: string): string => `elements/${id}.html`;

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
  readonly metamodel: Metamodel;
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
  const add = (findings: readonly TextFinding[], where: string): void => {
    for (const finding of findings) {
      context.problems.push({
        code: finding.code,
        severity: "warning",
        message: `${where}: ${finding.message}`,
        repository: record.repository,
        file: record.file,
        elementId: record.id,
      });
    }
  };
  const sections: string[] = [];
  const body = await renderMarkdown(text, textContext);
  needs.formulas ||= body.formulas;
  needs.diagrams ||= body.diagrams;
  add(body.findings, "Text");
  sections.push(`<section class="rq-text">${body.html}</section>`);
  const markdown = markdownKeysOf(context.metamodel);
  for (const { key, name } of context.metamodel.properties.filter((p) => markdown.has(p.key))) {
    const value = record.data[key];
    if (typeof value !== "string") {
      continue;
    }
    const rendered = await renderMarkdown(value, textContext);
    needs.formulas ||= rendered.formulas;
    needs.diagrams ||= rendered.diagrams;
    add(rendered.findings, name);
    sections.push(`<section><h2>${escapeHtml(name)}</h2>${rendered.html}</section>`);
  }
  const type = findType(context.metamodel, record.type)?.name ?? record.type;
  const status = record.data["status"];
  const facts = [type, ...(typeof status === "string" ? [status] : [])].map(escapeHtml).join(" · ");
  return { html: `<p class="rq-facts">${facts}</p>${sections.join("")}`, needs };
};

/** The outcome of each reference of `record`'s texts (see the file comment). */
const referenceResolver =
  (layout: WorkspaceLayout, store: ElementStore, shortIds: ShortIds, paged: ReadonlySet<ElementRecord>) =>
  (record: ElementRecord): TextContext["reference"] =>
  (target): ReferenceOutcome => {
    const state = referenceTargetState(layout, store, record.repository, target);
    if (state.kind === "available" && paged.has(state.element)) {
      return { href: `../${elementPage(state.element.id)}` };
    }
    if (state.kind === "inaccessible") {
      return {
        note: `${UNKNOWN_TYPE_PREFIX}-${shortIds.tail(target.id)}, repository ${state.repository}, not accessible`,
      };
    }
    return { text: true };
  };

/** The footer of every page (see the file comment). */
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
  return `<span class="rq-footer">${escapeHtml(`${named} · exported ${date} with ReqSeq ${PRODUCT_VERSION}`)}</span>`;
};

/** The heading of the page of `record`: its identifier, then its title when it has one. */
const headingOf = (record: ElementRecord, titleKey: string, shortIds: ShortIds): string => {
  const title = record.data[titleKey];
  const name = identifierField(shortIds, record).identifier ?? shortIds.of(record);
  return typeof title === "string" && title !== "" ? `${name} ${title}` : name;
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
  const footer = await footerOf(workspace, layout, store, options);
  const invalid = invalidStatuses(metamodel);
  const titleKey = titleKeyOrEmpty(metamodel);
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const record of store.elements) {
    (seen.has(record.id) ? shared : seen).add(record.id);
  }
  // The elements that get a page; a reference to any other is its link text.
  const paged = new Set(
    store.elements.filter((r) => !invalid.has(String(r.data["status"])) && !shared.has(r.id)),
  );
  const folder = await openExportFolder(target, MARKER);
  const problems: Problem[] = [...store.problems.filter((p) => p.severity === "error")];
  const reference = referenceResolver(layout, store, shortIds, paged);
  const context: PageContext = { folder, layout, metamodel, problems, reference };
  const needs: Needs = { formulas: false, diagrams: false };
  const exported: { id: string; shortId: string; repository: string }[] = [];
  try {
    for (const record of store.elements) {
      if (invalid.has(String(record.data["status"]))) {
        continue;
      }
      if (shared.has(record.id)) {
        problems.push({
          code: "element.duplicate-id",
          severity: "error",
          message: `No page: several element files have the UUID ${record.id}; give the copy a new UUID`,
          repository: record.repository,
          file: record.file,
          elementId: record.id,
        });
        continue;
      }
      const heading = headingOf(record, titleKey, shortIds);
      const { html, needs: own } = await elementHtml(context, record);
      needs.formulas ||= own.formulas;
      needs.diagrams ||= own.diagrams;
      await folder.write(
        elementPage(record.id),
        page({ title: heading, siteTitle: layout.name, depth: 1, body: html, footer, ...own }),
      );
      exported.push({ id: record.id, shortId: shortIds.of(record), repository: record.repository });
    }
    await folder.write(
      "index.html",
      page({
        title: layout.name,
        siteTitle: layout.name,
        depth: 0,
        body: `<p>Element pages: ${String(exported.length)}</p>`,
        footer,
        formulas: false,
        diagrams: false,
      }),
    );
    await folder.write(ASSETS.docs, DOCS_CSS);
    await folder.write(ASSETS.own, OWN_CSS);
    await folder.write(ASSETS.theme, scriptOf(themeScript));
    await folder.write(ASSETS.page, scriptOf(pageScript, PAGE_SCRIPT_SETTINGS));
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
  return { folder: folder.folder, pages: exported.length, exported, removed, problems };
};
