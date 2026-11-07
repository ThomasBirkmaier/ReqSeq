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
// - `fields` restricts what is searched: the `[[` search of SR-066 asks for the title and the IDs.
// - Each hit of the page has its snippet (SR-174, `query/search-snippet.ts`): its file is read again,
//   in the same turn, only when a word was found in its text; the title marks come from the title.
//   So a page costs the search and the files of its hits (SR-098: measured for 50 and 500 hits in
//   test/perf/search-speed.test.ts). The Markdown parser comes with it, so the command is imported
//   on its first call (`lazyCommand`, #178).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { ElementSearchOutput } from "../../generated/types.js";
import { identifierField, titleKeyOf } from "../../model/index.js";
import type { SearchHit } from "../../query/index.js";
import { resolveSelection, searchElements, searchIndex } from "../../query/index.js";
import { searchSnippet, titleMarks } from "../../query/search-snippet.js";

type Hit = ElementSearchOutput["hits"][number];

export default defineCommand({
  name: "element.search",
  run: async (ctx, input): Promise<CommandOutput<"element.search">> => {
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, "element.search");
    const index = await searchIndex(ctx.workspace);
    // Every element of the index's store selected: no restriction to pass (it costs a set of 50,000
    // keys). A store swapped meanwhile may hold elements the selection never saw: restricted then.
    const restricted =
      index.store !== selected.store || selected.elements.length < selected.store.elements.length;
    const results = searchElements(index, input.query, {
      ...(input.fields === undefined ? {} : { fields: input.fields }),
      ...(restricted ? { within: selected.elements } : {}),
      offset: input.offset,
      limit: input.limit,
    });
    // Without the meaning `title` (SR-013 AK3) no key is the title: the title is empty, as in element.get.
    const titleKey = titleKeyOf(selected.metamodel);
    const hitOf = (hit: SearchHit): Hit => {
      const { element, score, fields, terms } = hit;
      const title = titleKey === undefined ? undefined : element.data[titleKey];
      const status = element.data["status"];
      const shown = typeof title === "string" ? title : "";
      const marks = fields.includes("title") ? titleMarks(shown, terms) : [];
      const snippet = searchSnippet(index, hit);
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
    return { hits: results.hits.map(hitOf), total: results.total, incomplete: selected.incomplete };
  },
});
