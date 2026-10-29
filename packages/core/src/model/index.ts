// The `model` block (ADR-0008, SR-003): the element store of a workspace. Core blocks and commands
// import it relatively; it is not part of the package's public API.
export type { DiscoveredFiles, ListedKind } from "./discover.js";
export {
  ELEMENT_FILE_EXTENSION,
  SKIPPED_NAMES,
  listFiles,
  listMarkdownFiles,
  listsFile,
} from "./discover.js";
export { classifyFile, isUuid, keyLinesOf } from "./elements.js";
export { FILE_NAME_DIGITS, fileNameFor } from "./file-name.js";
export type { FileNameParts } from "./file-name.js";
export type { Classified, ElementMatch, ElementRecord } from "./elements.js";
export { duplicateIdFindings, duplicateIdProblemsState, resolveId } from "./duplicates.js";
export {
  allDuplicateIdentifierFindings,
  duplicateIdentifierFindings,
  duplicateIdentifierProblemsState,
} from "./identifiers.js";
export type { IdentifierContext } from "./identifiers.js";
export { identifierKeyOf } from "./identifier-index.js";
export { emergentKeyOf, isEmergent } from "./emergent.js";
export { compileGlob, ignoreMatcher } from "./ignore.js";
export { findingLine, locateFindings } from "./locate.js";
export type { LocatableFinding, LocateOptions } from "./locate.js";
export {
  applyStoreChange,
  carryStoreUpdate,
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
  StoreUpdate,
  WrittenFile,
} from "./store.js";
export { allRequiredFindings, requiredFindings, requiredProblemsState } from "./required.js";
export type { RequiredFinding } from "./required.js";
export { allStatusFindings, statusFindings, statusProblemsState } from "./status-findings.js";
export type { StatusFinding } from "./status-findings.js";
export { valueFindings, valueKindFindings, valueKindProblemsState } from "./values.js";
export type { ValueFinding, ValueKind, ValuePath } from "./values.js";
export {
  allRelationTypeFindings,
  relationTypeFindings,
  relationTypeProblemsState,
} from "./relation-types.js";
export type { RelationTypeContext, RelationTypeFinding } from "./relation-types.js";
export {
  allMissingReferenceFindings,
  allMissingTargetFindings,
  missingReferenceFindings,
  missingTargetFindings,
  missingTargetProblemsState,
} from "./missing-targets.js";
export { hasId, relationItems, relationKey } from "./relation-keys.js";
export type { RelationKey, TargetItem } from "./relation-keys.js";
export type {
  MissingReferenceFinding,
  MissingTargetContext,
  MissingTargetFinding,
} from "./missing-targets.js";
export { allUnknownFindings, unknownFindings, unknownProblemsState } from "./unknown.js";
export type { UnknownFinding } from "./unknown.js";
export {
  followTargets,
  isRelationTarget,
  isUnavailableRepository,
  resolveTarget,
  targetState,
} from "./relations.js";
export type { FollowedTargets, TargetState } from "./relations.js";
export { embeddedImages, imageLinks, imageMemo } from "./images.js";
export type { EmbeddedImage, ImageLink, ImageMemo, ImageSource } from "./images.js";
export {
  buildCurrentVersions,
  carryCurrentVersions,
  checkImages,
  currentVersions,
  currentVersionsIfBuilt,
  currentVersionsOf,
  currentVersionsState,
  currentVersionOf,
} from "./current-versions.js";
export type { CurrentVersion, CurrentVersions } from "./current-versions.js";
export { markdownImages, markdownLinks } from "./markdown-links.js";
export type { MarkdownLink } from "./markdown-links.js";
export { currentTarget, setInlineReferences, setMarkdownReferences, setRelationTargets } from "./targets.js";
export type { TargetContext } from "./targets.js";
export {
  inlineReferences,
  placeOfReference,
  propertyReferences,
  referenceTargetState,
  referencesOf,
  resolveReference,
  textReferences,
  unavailableRepositoryHint,
} from "./references.js";
export type {
  InlineReference,
  LinkedReference,
  PropertyReference,
  ReferenceTargetState,
  TextReference,
} from "./references.js";
export {
  SHORT_ID_MIN_LENGTH,
  UNKNOWN_TYPE_PREFIX,
  buildShortIds,
  identifierField,
  problemElement,
  shortIdState,
  shortIdsBuiltFrom,
} from "./short-id.js";
export type { ShortIdMatch, ShortIds } from "./short-id.js";
export { resolveRef } from "./resolve.js";
export type { ElementCopy } from "./resolve.js";
export { isN1Version, isOutdatedVersion, isVersion } from "./is-version.js";
export {
  elementVersion,
  elementView,
  listedElement,
  relationLink,
  sourceLink,
  titleKeyOf,
  titleKeyOrEmpty,
} from "./view.js";
export type { ElementViewInput, LinkInput, ListedElementInput } from "./view.js";
export { listElements } from "./list.js";
export { namesField, namesOf, namesOfRecords } from "./names.js";
export type { NameContext } from "./names.js";
export { setElementStatus, statusValues } from "./status.js";
export type { SetStatusInput, SetStatusResult } from "./status.js";
export { supersedeElement } from "./supersede.js";
export type { SupersedeInput, SupersedeResult } from "./supersede.js";
export { getElement, showElement } from "./get.js";
export type { ElementHints, ShowContext, ShownElement } from "./get.js";
export {
  elementLabel,
  invalidStatuses,
  supersededFindingsOf,
  supersededTargetFindings,
  supersededTargetProblems,
  supersededTargetProblemsState,
} from "./superseded.js";
export type { SupersededContext } from "./superseded.js";
export { buildSuccessionIndex, successionIndexState, successionsFor, successionsOf } from "./successors.js";
export type { Succession, SuccessionIndex } from "./successors.js";
export {
  CARRY_LIMIT,
  buildIncomingIndex,
  incomingFor,
  incomingIn,
  incomingState,
  incomingTo,
  outgoingLinks,
  relationKeysOf,
  relationPath,
} from "./incoming.js";
export { changedFiles, restrictTo, treeAt } from "./changed.js";
export { repositoryCommit } from "./repository-commit.js";
export type { NoCommitReason, RepositoryCommit } from "./repository-commit.js";
export {
  DEFAULT_STATE_READER,
  gitBlobId,
  isStateFile,
  repositoryState,
  stateFiles,
  stateRules,
  uncommittedStateFiles,
} from "./uncommitted.js";
export type { RepositoryState, StateReader, StateRules } from "./uncommitted.js";
export type { ChangedFiles, ChangedInput, Changes, Restriction, RestrictionContext } from "./changed.js";
export type { IncomingIndex, IncomingLink, IncomingReference, IncomingRelation } from "./incoming.js";
export { directLinks, directlyAffectedCount } from "./affected.js";
export { startWatcher, watchWorkspace, watcherProblems } from "./watch.js";
export { MODEL_CACHE_FILE, RACY_MS, changeStamp } from "./model-cache.js";
export { warmModel } from "./warm.js";
export { FolderTree } from "./watch-tree.js";
export type { FolderTreeOptions } from "./watch-tree.js";
export type {
  ChangedElements,
  WatchFunction,
  WatcherOptions,
  WorkspaceChange,
  WorkspaceChangeListener,
  WorkspaceWatcher,
} from "./watch.js";
export { addRelation, removeRelation } from "./relation-write.js";
export type { AddedRelation, RelationInput, RemovedRelation, RemoveRelationInput } from "./relation-write.js";
export { addAttachment, clashKey, IMAGE_EXTENSIONS, portableName } from "./attachment.js";
export {
  assertElementWritable,
  createElement,
  refuseUnlisted,
  updateElement,
  workspacePath,
  writtenElement,
} from "./write.js";
export { bulkUpdateElements } from "./bulk-update.js";
export type {
  BulkOperation,
  BulkSelection,
  BulkUpdateInput,
  BulkUpdateResult,
  NamedElement,
  SkippedElement,
} from "./bulk-update.js";
export type {
  CreateElementInput,
  ElementWriteResult,
  ReadElement,
  UpdateElementInput,
  UpdateElementResult,
} from "./write.js";
