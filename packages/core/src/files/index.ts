// The `files` block (ADR-0007): reading and writing element and YAML files, and scanning XML files
// (ADR-0012). The only module that writes to disk. Core blocks import it relatively; it is not part
// of the package's public API.
export { findConflictMarker } from "./conflict-markers.js";
export { createFolder } from "./folder.js";
export { resolveInRoot } from "./paths.js";
export { splitFrontmatter } from "./frontmatter.js";
export type { FrontmatterSplit, LineEnding } from "./frontmatter.js";
export { parseFileBytes, parseYamlFileBytes } from "./parse.js";
export type { ParsedContent, ParsedYaml, ParseOutcome, YamlParseOutcome } from "./parse.js";
export {
  readElementBodySync,
  readElementFile,
  readElementFrontmatterSync,
  readElementFileSync,
  readElementTextSync,
  readElementFiles,
  readFileSha256,
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
  YamlFile,
  YamlReadResult,
} from "./read.js";
export { sha256 } from "./snapshot.js";
export type { FileSnapshot } from "./snapshot.js";
export { LOCK_STALE_MS, lockPrivateFile, processRuns } from "./lock.js";
export type { PrivateLock } from "./lock.js";
export { createPrivateFolder, removePrivateFile, writePrivateFile } from "./private.js";
export { isTempFile, TEMP_FILE_PATTERN, writeFileAtomic } from "./write.js";
export type { FileKind, WriteOptions } from "./write.js";
export { editElementFile } from "./edit.js";
export { editYamlDocument, renderYamlDocument } from "./yaml-document.js";
export type { EditableYaml, YamlEditResult, YamlKeyEdit } from "./yaml-document.js";
export { bodyForText, elementText } from "./text.js";
export type { EditableFile, FileEditRequest, FileEditResult, FrontmatterEdit } from "./edit.js";
export type { FlowMappingValue, ItemValue, PropertyValue, ScalarValue } from "./yaml-text.js";
export { scanXml, xmlAttribute } from "./xml-scan.js";
export type { XmlAttribute, XmlDocument, XmlElement, XmlRefusalReason, XmlScanOutcome } from "./xml-scan.js";
