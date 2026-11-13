// element.search (SR-068): full-text search over the title, the text, the property values (with the
// names of type and status) and the IDs (UUID, short ID, identifier) of the elements of a selection
// (AK3: a view, a filter, a package or IDs; query/selection.ts), typo tolerant and in any case (AK2),
// the best first (query/search-index.ts, ADR-0008 "Search"). One page of hits (`offset`, `limit`,
// ADR-0009); `total` counts every hit and `incomplete` follows SR-006 AK2.
//
// - The selection is resolved first, then the index is awaited and searched in the same turn
//   (`searchIndex`, never the state itself: a command that awaited the state would pause the build it
//   waits for). A search before the index is ready waits for its build (about 7 s at N-036), so every
//   access gives the same result; there is no partial result (SR-098 in that window: ThomasBirkmaier/ReqSeq-archive#388).
// - The hits are records of the index's store, which may be newer than the selection's when the
//   store was swapped meanwhile (a save, the watcher): the selection then restricts them by
//   repository and file (a changed file counts with its new content, a new file not, since the
//   selection never saw it), and the short IDs of the selection's store name them (`ShortIds.of`
//   names any record). Scores are rounded to 6 significant digits (`searchElements`).
// - `fields` restricts what is searched (SR-216): fixed fields and single properties
//   (`query/search-fields.ts`), checked against the selection's metamodel before the index is
//   awaited and against the index's after; the `[[` search of SR-066 asks for the title and the IDs.
//   The snippet comes only from the chosen fields (SR-216 AK5): a chosen property, not an earlier one.
// - Each hit of the page has its snippet (SR-174, `query/search-snippet.ts`): its file is read again,
//   in the same turn, only when a word was found in its text; the title marks come from the title.
//   So a page costs the search and the files of its hits (SR-098: measured for 50 and 500 hits in
//   test/perf/search-speed.test.ts). The Markdown parser comes with it, so the command is imported
//   on its first call (`lazyCommand`, #178).
// - With `group` (SR-149 AK6) every hit is put in order (`rankedHits`, one sort) and dealt into the
//   groups of `groupingOf` over the hit records, keeping that order inside each group; the page is
//   then the rows of the groups in turn, as element.list gives them, and only its distinct hits are
//   described and get a snippet. The records are the index's, so a file changed since the selection
//   groups by its new content, while targets (packages) are looked up in the selection's store: one
//   only in the newer store counts as not available until the next search. The key is checked by
//   `groupingOf` whatever the query finds. Cost: the search, one sort of every hit and one pass over
//   them (SR-098 with grouping: test/perf/search-speed.test.ts).
// - With `withVerification` (SR-137) `rowVerification` gives for each row what its node in trace.graph
//   shows of its verification (`rowsVerification`), from the hit's record.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { rowsVerification } from "../../evidence/index.js";
import type { ElementSearchInput, ElementSearchOutput } from "../../generated/types.js";
import type { ElementRecord } from "../../model/index.js";
import { identifierField, titleKeyOf } from "../../model/index.js";
import type { RankedHit, SearchHit, SearchIndex, Selected } from "../../query/index.js";
import {
  describeHit,
  groupingOf,
  rankedHits,
  resolveSelection,
  searchElements,
  searchIndex,
} from "../../query/index.js";
import { searchFieldsOf } from "../../query/search-fields.js";
import { searchSnippet, titleMarks } from "../../query/search-snippet.js";
import type { Workspace } from "../../runtime/workspace.js";

type Hit = ElementSearchOutput["hits"][number];

type Group = NonNullable<ElementSearchOutput["groups"]>[number];

/** How the hits of a search are described: the output of one hit. */
const describerOf = (
  selected: Selected,
  index: SearchIndex,
  propertyKeys: readonly string[] | undefined,
): ((hit: SearchHit) => Hit) => {
  // Without the meaning `title` (SR-013 AK3) no key is the title: the title is empty, as in element.get.
  const titleKey = titleKeyOf(selected.metamodel);
  return (hit) => {
    const { element, score, fields, terms } = hit;
    const title = titleKey === undefined ? undefined : element.data[titleKey];
    const status = element.data["status"];
    const shown = typeof title === "string" ? title : "";
    const marks = fields.includes("title") ? titleMarks(shown, terms) : [];
    const snippet = searchSnippet(index, hit, propertyKeys);
    return {
      id: element.id,
      repository: element.repository,
      shortId: selected.shortIds.of(element),
      ...identifierField(selected.shortIds, element),
      type: element.type,
      ...(typeof status === "string" ? { status } : {}),
      title: shown,
      score,
      fields,
      terms,
      ...(marks.length === 0 ? {} : { titleMarks: marks }),
      ...(snippet === undefined ? {} : { snippet }),
    };
  };
};

/** The grouped hits (see the file comment): the page of their rows, every group and the count of rows. */
const grouped = (
  selected: Selected,
  index: SearchIndex,
  ranked: readonly RankedHit[],
  input: { readonly group: string; readonly offset: number; readonly limit: number },
  propertyKeys: readonly string[] | undefined,
): {
  readonly output: Pick<ElementSearchOutput, "hits" | "groups" | "offset" | "rows">;
  readonly records: readonly ElementRecord[];
} => {
  const { heads, groupsOf } = groupingOf(
    { ...selected, elements: ranked.map((hit) => hit.element) },
    "element.search",
    input.group,
  );
  const members = heads.map((): RankedHit[] => []);
  for (const hit of ranked) {
    for (const at of groupsOf(hit.element)) {
      members[at]?.push(hit);
    }
  }
  const rows: RankedHit[] = [];
  const groups: Group[] = [];
  members.forEach((hits, at) => {
    if (hits.length > 0) {
      groups.push({ ...heads[at], count: hits.length, offset: rows.length });
      // Loops, not spreads: a group can hold every hit of N-036 (a spread of so many arguments throws).
      for (const hit of hits) {
        rows.push(hit);
      }
    }
  });
  const describe = describerOf(selected, index, propertyKeys);
  // A hit in several groups of the page is described once.
  const described = new Map<RankedHit, Hit>();
  const page = rows.slice(input.offset, input.offset + input.limit);
  const hits = page.map((row) => {
    const known = described.get(row) ?? describe(describeHit(row));
    described.set(row, known);
    return known;
  });
  return {
    output: { hits, groups, offset: input.offset, rows: rows.length },
    records: page.map((row) => row.element),
  };
};

/** `rowVerification` of the output for the rows of `records` (see the file comment); nothing without `withVerification`. */
const verificationOf = async (
  selected: Selected,
  input: ElementSearchInput,
  records: readonly ElementRecord[],
  workspace: Workspace,
): Promise<Pick<ElementSearchOutput, "rowVerification">> =>
  input.withVerification === true
    ? { rowVerification: await rowsVerification(workspace, records, selected.views) }
    : {};

export default defineCommand({
  name: "element.search",
  run: async (ctx, input): Promise<CommandOutput<"element.search">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "element.search");
    const checked = searchFieldsOf("element.search", selected.metamodel, input.fields);
    const index = await searchIndex(ctx.workspace);
    // A metamodel changed meanwhile resets the index (a new build): checked again against its own.
    const chosen =
      index.metamodel === selected.metamodel
        ? checked
        : searchFieldsOf("element.search", index.metamodel, input.fields);
    // The single properties the snippet may come from: undefined for every property.
    const { propertyKeys } = chosen;
    // Every element of the index's store selected: no restriction to pass (it costs a set of 50,000
    // keys). A store swapped meanwhile may hold elements the selection never saw: restricted then.
    const restricted =
      index.store !== selected.store || selected.elements.length < selected.store.elements.length;
    const options = {
      ...chosen,
      ...(restricted ? { within: selected.elements } : {}),
    };
    if (input.group !== undefined) {
      const ranked = rankedHits(index, input.query, options);
      const { output, records } = grouped(
        selected,
        index,
        ranked,
        { ...input, group: input.group },
        propertyKeys,
      );
      return {
        ...output,
        ...(await verificationOf(selected, input, records, ctx.workspace)),
        total: ranked.length,
        incomplete: selected.incomplete,
      };
    }
    const results = searchElements(index, input.query, {
      ...options,
      offset: input.offset,
      limit: input.limit,
    });
    const describe = describerOf(selected, index, propertyKeys);
    return {
      hits: results.hits.map(describe),
      ...(await verificationOf(
        selected,
        input,
        results.hits.map((hit) => hit.element),
        ctx.workspace,
      )),
      total: results.total,
      incomplete: selected.incomplete,
    };
  },
});
