// The `model` block (ADR-0008, SR-003): the element store of a workspace. Core blocks and commands
// import it relatively; it is not part of the package's public API.
export { ELEMENT_FILE_EXTENSION, listMarkdownFiles } from "./discover.js";
export type { DiscoveredFiles } from "./discover.js";
export { classifyFile } from "./elements.js";
export { FILE_NAME_DIGITS, fileNameFor } from "./file-name.js";
export type { FileNameParts } from "./file-name.js";
export type { Classified, ElementMatch, ElementRecord } from "./elements.js";
export { duplicateIdFindings, duplicateIdProblemsState, resolveId } from "./duplicates.js";
export { compileGlob, ignoreMatcher } from "./ignore.js";
export { locateFindings } from "./locate.js";
export type { LocatableFinding, LocateOptions } from "./locate.js";
export { applyStoreChange, elementStoreState, ignoredBy, loadElements, updateElements } from "./store.js";
export type {
  Contribution,
  ElementStore,
  RepositoryChanges,
  RepositoryContents,
  RepositoryFile,
} from "./store.js";
export { valueFindings, valueKindFindings, valueKindProblemsState } from "./values.js";
export type { ValueFinding, ValueKind, ValuePath } from "./values.js";
export {
  allRelationTypeFindings,
  relationTypeFindings,
  relationTypeProblemsState,
} from "./relation-types.js";
export type { RelationTypeContext, RelationTypeFinding } from "./relation-types.js";
export { isRelationTarget, resolveTarget } from "./relations.js";
export { SHORT_ID_MIN_LENGTH, UNKNOWN_TYPE_PREFIX, buildShortIds, shortIdState } from "./short-id.js";
export type { ShortIdMatch, ShortIds } from "./short-id.js";
export { resolveRef } from "./resolve.js";
export { elementView, titleKeyOf } from "./view.js";
export type { ElementViewInput } from "./view.js";
export { startWatcher, watchWorkspace, watcherProblems } from "./watch.js";
export { FolderTree } from "./watch-tree.js";
export type { FolderTreeOptions } from "./watch-tree.js";
export type { WatchFunction, WatcherOptions, WorkspaceWatcher } from "./watch.js";
export { createElement, updateElement, writtenElement } from "./write.js";
export type { CreateElementInput, ElementWriteResult, ReadElement, UpdateElementInput } from "./write.js";
