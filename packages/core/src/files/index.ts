// The `files` block (ADR-0007): reading and writing element and YAML files, scanning XML files
// (ADR-0012), and JSON text larger than one string (`jsonChunks`, #277). The only module that writes
// to disk. Core blocks import it relatively; it is not part of the package's public API, except
// `isTempFile` and the JSON text functions the adapters stream with (`src/index.ts`).
export { findConflictMarker } from "./conflict-markers.js";
export { createFolder } from "./folder.js";
export { resolveInRoot } from "./paths.js";
export { splitFrontmatter } from "./frontmatter.js";
export type { FrontmatterSplit, LineEnding } from "./frontmatter.js";
export { FRONTMATTER_FIRST_LINE, parseFileBytes, parseYamlFileBytes } from "./parse.js";
export type { ParsedContent, ParsedYaml, ParseOutcome, YamlParseOutcome } from "./parse.js";
export {
  readElementBodySync,
  readElementFile,
  readElementFrontmatterSync,
  readElementFileSync,
  readElementTextSync,
  readElementFiles,
  readFileSha256,
  readFileSnapshot,
  readFileStat,
  readYamlFile,
} from "./read.js";
export type {
  BodyReadResult,
  FileHash,
  FileReadResult,
  FileStat,
  ParsedFile,
  ReadFilesOptions,
  ReadFilesResult,
  SnapshotReadResult,
  YamlFile,
  YamlReadResult,
} from "./read.js";
export { sha256 } from "./snapshot.js";
export type { FileSnapshot } from "./snapshot.js";
export { LOCK_STALE_MS, lockPrivateFile, processRuns } from "./lock.js";
export type { PrivateLock } from "./lock.js";
export { createPrivateFolder, removePrivateFile, writePrivateFile } from "./private.js";
export { isTempFile, TEMP_FILE_PATTERN, writeFileAtomic } from "./write.js";
export type { FileContent, FileKind, WriteOptions } from "./write.js";
export { JSON_CHUNK_LENGTH, jsonByteLength, jsonChunks } from "./json-text.js";
export type { JsonChunkOptions } from "./json-text.js";
export { jsonLines } from "./json-lines.js";
export type { JsonLinesSpec } from "./json-lines.js";
export { JSON_FULL_PARSE_BYTES, jsonDataKind } from "./json-data.js";
export type { JsonDataKind } from "./json-data.js";
export { editElementFile, zip } from "./edit.js";
export { editYamlDocument, renderYamlDocument } from "./yaml-document.js";
export { yamlPointerLine } from "./yaml-pointer.js";
export { listFolderFiles } from "./list-folder.js";
export type { FolderListing } from "./list-folder.js";
export type { EditableYaml, YamlEditResult, YamlKeyEdit } from "./yaml-document.js";
export { bodyForText, elementText } from "./text.js";
export type { EditableFile, FileEditRequest, FileEditResult, FrontmatterEdit } from "./edit.js";
export type { FlowMappingValue, ItemValue, PropertyValue, ScalarValue } from "./yaml-text.js";
export { scanXml, shown, xmlAttribute } from "./xml-scan.js";
export type { XmlAttribute, XmlDocument, XmlElement, XmlRefusalReason, XmlScanOutcome } from "./xml-scan.js";
