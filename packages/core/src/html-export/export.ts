// The HTML export of a workspace (SR-231, SR-235; packages/core/docs/html-export.md): the pages of
// every element without an invalid status (D-044) and a start page, written through the export folder
// of the files block (`openExportFolder`), which replaces only what the earlier export wrote. The
// pages are a skeleton here; look, lists and search come with #1963–#1969.
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
import type { ElementRecord, ImageLink } from "../model/index.js";
import {
  elementStoreState,
  identifierField,
  ignoredBy,
  invalidStatuses,
  shortIdState,
  titleKeyOrEmpty,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import {
  DEFAULT_FOLDERS,
  locate,
  refuseGitAt,
  settingLocation,
  workspaceLayoutState,
} from "../workspace/index.js";
import type { ImageOutcome, TextFinding } from "./markdown.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";
import { page, STYLESHEET, STYLESHEET_FILE } from "./page.js";
import { svgRisk } from "./svg.js";

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

interface PageContext {
  readonly folder: ExportFolder;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly problems: Problem[];
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

/** The HTML of one element's page, its findings added to `context.problems`. */
const elementHtml = async (context: PageContext, record: ElementRecord, heading: string): Promise<string> => {
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
  const textContext = {
    elementFile: record.file,
    ignored: ignoredBy(context.layout),
    image: imageCopier(context, repository, record),
  };
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
  add(body.findings, "Text");
  sections.push(`<section class="rq-text">${body.html}</section>`);
  const markdown = markdownKeysOf(context.metamodel);
  for (const { key, name } of context.metamodel.properties.filter((p) => markdown.has(p.key))) {
    const value = record.data[key];
    if (typeof value !== "string") {
      continue;
    }
    const rendered = await renderMarkdown(value, textContext);
    add(rendered.findings, name);
    sections.push(`<section><h2>${escapeHtml(name)}</h2>${rendered.html}</section>`);
  }
  const type = findType(context.metamodel, record.type)?.name ?? record.type;
  const status = record.data["status"];
  const facts = [type, ...(typeof status === "string" ? [status] : [])].map(escapeHtml).join(" · ");
  return `<h1>${escapeHtml(heading)}</h1><p class="rq-facts">${facts}</p>${sections.join("")}`;
};

/** Writes the HTML export of `workspace` into the absolute folder `target` (see the file comment). */
export const writeHtmlExport = async (workspace: Workspace, target: string): Promise<HtmlExportResult> => {
  const [layout, metamodel, store, shortIds] = await Promise.all([
    workspace.get(workspaceLayoutState),
    workspace.get(metamodelState),
    workspace.get(elementStoreState),
    workspace.get(shortIdState),
  ]);
  await refuseGitAt(target, target);
  await refuseDataFolder(layout, target);
  const folder = await openExportFolder(target, MARKER);
  const problems: Problem[] = [...store.problems.filter((p) => p.severity === "error")];
  const context: PageContext = { folder, layout, metamodel, problems };
  const invalid = invalidStatuses(metamodel);
  const titleKey = titleKeyOrEmpty(metamodel);
  const seen = new Set<string>();
  const shared = new Set<string>();
  for (const record of store.elements) {
    (seen.has(record.id) ? shared : seen).add(record.id);
  }
  let pages = 0;
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
      const title = record.data[titleKey];
      const name = identifierField(shortIds, record).identifier ?? shortIds.of(record);
      const heading = typeof title === "string" && title !== "" ? `${name} ${title}` : name;
      const html = await elementHtml(context, record, heading);
      await folder.write(elementPage(record.id), page({ title: heading, depth: 1, body: html }));
      pages++;
    }
    await folder.write(STYLESHEET_FILE, STYLESHEET);
    await folder.write(
      "index.html",
      page({
        title: layout.name,
        depth: 0,
        body: `<h1>${escapeHtml(layout.name)}</h1><p>Element pages: ${String(pages)}</p>`,
      }),
    );
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
  return { folder: folder.folder, pages, removed, problems };
};
