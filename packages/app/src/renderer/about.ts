// The window "About ReqSeq" (SR-161): the output of `tool.info` laid out as groups of labelled rows, and
// the text "Copy all" puts on the clipboard as one block (AK3). Each row's value is what its own copy puts
// there. Layout only: the values are core's, as every access gives them (AK5, ADR-0002).
import type { CommandTypes } from "@reqseq/core";

/** The command the window shows. */
export const ABOUT_COMMAND = "tool.info";

export type AboutInfo = CommandTypes[typeof ABOUT_COMMAND]["output"];

/** One row: a label and its value, which can span lines (the licence notice). */
export interface AboutRow {
  readonly label: string;
  readonly value: string;
}

export interface AboutGroup {
  readonly heading: string;
  readonly rows: readonly AboutRow[];
}

const row = (label: string, value: string | undefined): AboutRow[] =>
  value === undefined || value === "" ? [] : [{ label, value }];

/**
 * The lines of the licence notice as paragraphs: the lines of a paragraph joined, so they wrap with the
 * window; a blank line parts two paragraphs.
 */
const paragraphs = (lines: readonly string[]): string =>
  lines
    .join("\n")
    .split(/\n\s*\n/u)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .join(" "),
    )
    .join("\n\n");

/** The groups of the window, in the order of the output; a value the output leaves out has no row. */
export const aboutGroups = (info: AboutInfo): AboutGroup[] => [
  {
    heading: "ReqSeq version",
    rows: [
      ...row("App", info.versions.app),
      ...row("Command line", info.versions.cli),
      ...row("MCP server", info.versions.mcp),
    ],
  },
  {
    heading: "Build",
    rows: [
      ...(info.build.development === true ? row("Build", "from a checkout, not a release") : []),
      ...row("Commit", info.build.commit),
      ...row("Build date", info.build.date),
      ...row("Platform", info.build.platform),
      ...row("Architecture", info.build.arch),
    ],
  },
  {
    heading: "Runtime",
    rows: [
      ...row("Electron", info.runtime.electron),
      ...row("Node", info.runtime.node),
      ...row("Chromium", info.runtime.chromium),
    ],
  },
  {
    heading: "Workspace",
    rows: [
      ...row("Name", info.workspace.name),
      ...row("Path", info.workspace.path),
      ...row("Repositories", info.workspace.repositories.join(", ")),
      ...row("Elements", String(info.workspace.elements)),
    ],
  },
  {
    heading: "Licence",
    rows: [
      ...row("Licence", paragraphs(info.license.notice)),
      ...row("Third-party licences", info.license.thirdParty),
    ],
  },
  {
    heading: "Documentation",
    rows: [
      ...row("Bundled", info.documentation.bundled),
      ...row("Online", info.documentation.online),
      ...row("Releases", info.documentation.releases),
    ],
  },
];

/** The whole content as one block: the title, then each group with its rows indented, `label: value`. */
export const aboutText = (groups: readonly AboutGroup[]): string =>
  [
    "About ReqSeq",
    ...groups.flatMap((group) => [
      group.heading,
      ...group.rows.map(
        (line) =>
          `  ${line.label}: ${line.value
            .split("\n")
            .map((text, at) => (at === 0 || text === "" ? text : `    ${text}`))
            .join("\n")}`,
      ),
    ]),
  ].join("\n");
