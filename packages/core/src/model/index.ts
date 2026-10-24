// The `model` block (ADR-0008, SR-003): the element store of a workspace. Core blocks and commands
// import it relatively; it is not part of the package's public API.
export { ELEMENT_FILE_EXTENSION, listMarkdownFiles, listsFile } from "./discover.js";
export type { DiscoveredFiles } from "./discover.js";
export { classifyFile } from "./elements.js";
export { FILE_NAME_DIGITS, fileNameFor } from "./file-name.js";
export type { FileNameParts } from "./file-name.js";
export type { Classified, ElementMatch, ElementRecord } from "./elements.js";
export { duplicateIdFindings, duplicateIdProblemsState, resolveId } from "./duplicates.js";
export { compileGlob, ignoreMatcher } from "./ignore.js";
export { findingLine, locateFindings } from "./locate.js";
export type { LocatableFinding, LocateOptions } from "./locate.js";
export {
  applyStoreChange,
  elementStoreState,
  ignoredBy,
  loadElements,
  updateElements,
  recordWrites,
  StoreFallback,
  withWrittenFiles,
} from "./store.js";
export type {
  Contribution,
  ElementStore,
  RepositoryChanges,
  RepositoryContents,
  RepositoryFile,
  WrittenFile,
} from "./store.js";
export { allRequiredFindings, requiredFindings, requiredProblemsState } from "./required.js";
export type { RequiredFinding } from "./required.js";
export { valueFindings, valueKindFindings, valueKindProblemsState } from "./values.js";
export type { ValueFinding, ValueKind, ValuePath } from "./values.js";
export {
  allRelationTypeFindings,
  relationTypeFindings,
  relationTypeProblemsState,
} from "./relation-types.js";
export type { RelationTypeContext, RelationTypeFinding } from "./relation-types.js";
export { allUnknownFindings, unknownFindings, unknownProblemsState } from "./unknown.js";
export type { UnknownFinding } from "./unknown.js";
export { isRelationTarget, resolveTarget } from "./relations.js";
export { markdownLinks } from "./markdown-links.js";
export type { MarkdownLink } from "./markdown-links.js";
export { currentTarget, inlineReferences, setInlineReferences, setRelationTargets } from "./targets.js";
export type { InlineReference, TargetContext } from "./targets.js";
export { SHORT_ID_MIN_LENGTH, UNKNOWN_TYPE_PREFIX, buildShortIds, shortIdState } from "./short-id.js";
export type { ShortIdMatch, ShortIds } from "./short-id.js";
export { resolveRef } from "./resolve.js";
export { elementVersion, elementView, titleKeyOf } from "./view.js";
export type { ElementViewInput } from "./view.js";
export { setElementStatus, statusValues } from "./status.js";
export type { SetStatusInput, SetStatusResult } from "./status.js";
export { supersedeElement } from "./supersede.js";
export type { SupersedeInput, SupersedeResult } from "./supersede.js";
export {
  invalidStatuses,
  supersededTargetFindings,
  supersededTargetProblems,
  supersededTargetProblemsState,
} from "./superseded.js";
export type { SupersededContext } from "./superseded.js";
export { startWatcher, watchWorkspace, watcherProblems } from "./watch.js";
export { FolderTree } from "./watch-tree.js";
export type { FolderTreeOptions } from "./watch-tree.js";
export type { WatchFunction, WatcherOptions, WorkspaceWatcher } from "./watch.js";
export { assertElementWritable, createElement, updateElement, writtenElement } from "./write.js";
export type { CreateElementInput, ElementWriteResult, ReadElement, UpdateElementInput } from "./write.js";
