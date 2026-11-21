// The topic groups of the how-to guides in the sidebar (#2191), read by packages/docs/site/astro.config.mjs. The
// pages stay in the one folder how-to/, so their addresses do not change; a group lists its pages by file name, in
// the order of the sidebar. A label names a glossary term only by its english-term (CLAUDE.md, #1428). The file
// imports nothing, since the site's configuration loads it.

/** The folder of the how-to pages, as HOW_TO_FOLDER of how-to.ts. */
const HOW_TO_FOLDER = "how-to";

/** A topic group: its label and its pages, by file name in docs/guide/how-to/ without its extension, in order. */
export interface HowToGroup {
  readonly label: string;
  readonly pages: readonly string[];
}

/** The groups in the order of the sidebar. Every how-to page is in exactly one of them. */
export const HOW_TO_GROUPS: readonly HowToGroup[] = [
  {
    label: "Set up",
    pages: ["install-reqseq", "open-a-workspace", "connect-an-ai-agent", "check-a-workspace-in-ci"],
  },
  {
    label: "Elements",
    pages: [
      "write-the-text-of-an-element",
      "trace-a-requirement",
      "find-and-filter-elements",
      "review-and-approve-a-requirement",
      "give-acceptance-criteria-their-keys",
      "remove-a-draft",
    ],
  },
  {
    label: "Tests and verification",
    pages: [
      "record-test-evidence",
      "name-the-requirement-in-a-test",
      "record-test-results-in-ci",
      "record-evidence-for-a-variant",
    ],
  },
  {
    label: "Baselines and variants",
    pages: ["take-a-baseline", "prepare-a-baseline", "manage-a-product-variant"],
  },
  {
    label: "Metamodel",
    pages: ["extend-the-metamodel", "choose-what-counts-to-the-version", "limit-relations-and-list-entries"],
  },
  {
    label: "Exchange and publish",
    pages: ["exchange-requirements-with-reqif", "publish-the-workspace-as-html"],
  },
];

/** A page's name without its extension: `install-reqseq.md` → `install-reqseq`. */
const pageName = (file: string): string => file.replace(/\.mdx?$/, "");

/**
 * The rank of a page of the content folder (`how-to/<file>`) in the sidebar's order of the how-to guides, or
 * `undefined` for a page that no group lists.
 */
export function howToRank(path: string): number | undefined {
  const rank = HOW_TO_GROUPS.flatMap((group) =>
    group.pages.map((page) => `${HOW_TO_FOLDER}/${page}`),
  ).indexOf(pageName(path));
  return rank === -1 ? undefined : rank;
}

/** A group of the Starlight sidebar whose entries are pages by their slug. */
export interface SidebarGroup {
  readonly label: string;
  readonly items: readonly string[];
}

/**
 * The sidebar groups of the how-to pages `files` (file names in the folder, `.md` or `.mdx`). Fails on a page in no
 * group or in two, and on a page of a group that is not there, so no guide is missing from the sidebar unnoticed.
 */
export function howToSidebar(
  files: readonly string[],
  groups: readonly HowToGroup[] = HOW_TO_GROUPS,
): SidebarGroup[] {
  const pages = files.filter((file) => /\.mdx?$/.test(file)).map(pageName);
  const listed = groups.flatMap((group) => group.pages);
  const twice = listed.filter((page, index) => listed.indexOf(page) !== index);
  const outside = pages.filter((page) => !listed.includes(page));
  const missing = listed.filter((page) => !pages.includes(page));
  const faults = [
    ...(outside.length > 0 ? [`${outside.join(", ")} in no group`] : []),
    ...(twice.length > 0 ? [`${twice.join(", ")} in two groups`] : []),
    ...(missing.length > 0 ? [`${missing.join(", ")} listed but not there`] : []),
  ];
  if (faults.length > 0) {
    throw new Error(`sidebar of ${HOW_TO_FOLDER}/: ${faults.join("; ")} (packages/docs/src/sidebar.ts)`);
  }
  return groups.map((group) => ({
    label: group.label,
    items: group.pages.map((page) => `${HOW_TO_FOLDER}/${page}`),
  }));
}
