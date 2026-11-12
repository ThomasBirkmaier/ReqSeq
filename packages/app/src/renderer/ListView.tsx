// The list buffer and the search buffer: rows of elements as `element.list` and `element.search` give
// them, in pages. The next page is asked for when the selection or the scroll reaches the end, so a
// workspace of 50,000 elements is never loaded at once (N-036). A row whose element changed outside the
// app is highlighted briefly (SR-116), and a change keeps the rows, the selection and the scroll. As a
// buffer of its own, the list stands like the elements of a package page: in the centred column, under a
// heading that says what it shows and how many (SR-148, D-062), and under it the line of coverage and
// verification degree of its elements, as a package page has it (`SummaryLine`). A grouped list (SR-149)
// shows each group of `element.list` under a heading with its name and
// count, below that line; the rows are those of the grouped list, so an element in several groups is a row
// in each, and rows are keyed by their position. A search hit shows the title with the words core marked
// (`titleMarks`) and, under it, where it was found and the snippet core gives (SR-174), marked the same way.
// Right of its status each row shows what the element's node in the graph shows of its verification: a
// requirement's verification status and the progress ring of a requirement or need (SR-137, `NodeVerification`
// of SR-136). It is asked for each page once its rows stand (`withVerification`, `fetchVerification`), so the
// rows come first in a large workspace, as the summary line does.
// Elements in the statuses the user folds (SR-201, `fold-statuses.ts`) stand after the other rows, under a
// row that names their count and is collapsed whenever the list opens: core is asked once for the
// selection without them and once for only them, each in its own pages. The section row is an option of the
// listbox like the others, so the selection reaches it; click, Enter and Tab toggle it, Right opens and Left
// closes it (SR-193 AK1, AK2). A tree (SR-075) folds nothing.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ElementListOutput,
  ElementSelection,
  FilterCondition,
  FilterSortKeyWithDefaults,
} from "@reqseq/core";
import { useIdScope } from "./area-scope.js";
import { folds, foldedSelections, useFoldCondition } from "./fold-statuses.js";
import type { BufferAction, ListBuffer, SearchBuffer } from "./buffers.js";
import { bufferName, listHeading, listSort } from "./buffers.js";
import type { Call } from "./call.js";
import { highlightRanges, trimLead } from "./highlight.js";
import type { ListGroup } from "./list-groups.js";
import { groupCount, groupName, groupSections } from "./list-groups.js";
import type { Part } from "./highlight.js";
import { leavesPart, rowTarget } from "./keys.js";
import type { BufferData } from "./modeline.js";
import type { OutsideChanges } from "./outside-marks.js";
import { memberSummary } from "./package-page.js";
import { NodeVerification } from "./GraphRing.js";
import { SummaryLine } from "./PackageSummary.js";
import { rowClass, useOutsideMarks } from "./use-outside-marks.js";
import { FoldHead } from "./FoldSection.js";
import { GROUPED } from "./list-menu.js";
import { useResetOnAsk } from "./use-reset-on-ask.js";
import type { Row, Snippet } from "./rows.js";
import {
  LIST_MAX,
  LIST_PAGE,
  SEARCH_MAX,
  SEARCH_PAGE,
  activeRow,
  firstLimit,
  labelMarks,
  listRows,
  searchRows,
} from "./rows.js";

export interface ListViewProps {
  readonly call: Call;
  readonly buffer: ListBuffer | SearchBuffer;
  /** Counts up when the workspace changed: the rows are asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline. */
  /**
   * `undefined` while the buffer asks for another list (a filter, a sort), so the modeline never shows the
   * count of another list; asked again for a change of the workspace, it keeps the old count until the answer.
   */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** The changes from outside (SR-116): a row of an element that changed is highlighted when it is shown. */
  readonly outside?: OutsideChanges;
  /**
   * The list is a part of another buffer, below its text (the package page, SR-112): the enclosing buffer
   * scrolls, a list without rows shows nothing, a workspace change keeps the rows until the new answer is
   * there, and the selected row is shown only while the part has the focus.
   */
  readonly part?: boolean;
  /** Part only: the reader leaves the part with Escape, or with Up on the first row. */
  readonly onLeave?: () => void;
  /**
   * Part only: the part takes the focus when its rows have arrived, if the focus is still on the enclosing
   * buffer. Set when the reader comes back to a page whose elements they used before.
   */
  readonly focusOnLoad?: boolean;
}

/**
 * `total` counts the elements, `size` the rows to page over: more than `total` in a grouped list whose
 * elements are in several groups. `groups` only for a grouped list, every group of the whole list.
 */
interface Loaded {
  readonly rows: readonly Row[];
  readonly total: number;
  readonly size: number;
  readonly incomplete: boolean;
  readonly groups?: readonly ListGroup[];
}

type Page = ({ readonly ok: true } & Loaded) | { readonly ok: false; readonly message: string };

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | ({ readonly status: "ok" } & Omit<Loaded, "rows"> & {
        readonly rows: readonly Row[];
        /** The folded section (SR-201): the elements in folded statuses, loaded as far as shown. */
        readonly folded?: Loaded;
      });

/** The selections a list asks for: the rows in place and, when statuses fold, the section at the end. */
interface Asked {
  readonly shown: ElementSelection | undefined;
  readonly folded?: ElementSelection;
}

/** Rows moved by Page Up and Page Down. */
const SCREEN = 10;
/** The next page is asked for when the selection is this close to the last loaded row. */
const NEAR_END = 5;

const fetchPage = async (
  call: Call,
  buffer: ListBuffer | SearchBuffer,
  offset: number,
  limit: number,
  selection: ElementSelection | undefined = buffer.selection,
): Promise<Page> => {
  if (buffer.kind === "list") {
    const sort = listSort(buffer);
    const answer = await call("element.list", {
      ...(selection === undefined ? {} : { selection }),
      ...(sort === undefined ? {} : { sort }),
      ...(buffer.group === undefined ? {} : { group: buffer.group }),
      limit,
      offset,
    });
    if (!answer.ok) {
      return answer;
    }
    const { groups, rows, total } = answer.output;
    return {
      ok: true,
      rows: listRows(answer.output),
      total,
      size: rows ?? total,
      incomplete: answer.output.incomplete === true,
      ...(groups === undefined ? {} : { groups }),
    };
  }
  // The hits within the steps, grouped as a list (SR-124 AK4, SR-149 AK6), in the order of the search.
  const answer = await call("element.search", {
    query: buffer.query,
    ...(selection === undefined ? {} : { selection }),
    ...(buffer.group === undefined ? {} : { group: buffer.group }),
    limit,
    offset,
  });
  if (!answer.ok) {
    return answer;
  }
  const { groups, rows, total } = answer.output;
  return {
    ok: true,
    rows: searchRows(answer.output),
    total,
    size: rows ?? total,
    incomplete: answer.output.incomplete,
    ...(groups === undefined ? {} : { groups }),
  };
};

/** What a row shows of its element's verification (SR-137), as core gives it. */
type RowVerification = NonNullable<ElementListOutput["rowVerification"]>[number];

/** What a row shows of its verification, with the element it was given for. */
interface Verified {
  readonly id: string;
  readonly repository: string;
  readonly entry: RowVerification;
}

/**
 * What the rows `offset` to `offset + limit` show of their verification (SR-137): the same page asked again
 * with `withVerification`, a list with as few fields as it takes, each entry with the element of its row;
 * none when core refuses it.
 */
const fetchVerification = async (
  call: Call,
  buffer: ListBuffer | SearchBuffer,
  offset: number,
  limit: number,
  selection: ElementSelection | undefined,
): Promise<readonly Verified[] | undefined> => {
  const common = {
    ...(selection === undefined ? {} : { selection }),
    ...(buffer.group === undefined ? {} : { group: buffer.group }),
    withVerification: true,
    limit,
    offset,
  };
  const paired = (
    rows: readonly { readonly id: string; readonly repository: string }[] | undefined,
    entries: readonly RowVerification[] | undefined,
  ): Verified[] | undefined =>
    rows === undefined || entries === undefined
      ? undefined
      : rows.flatMap(({ id, repository }, at) => {
          const entry = entries[at];
          return entry === undefined ? [] : [{ id, repository, entry }];
        });
  if (buffer.kind === "list") {
    const sort = listSort(buffer);
    const answer = await call("element.list", {
      ...common,
      ...(sort === undefined ? {} : { sort }),
      fields: ["identifier"],
    });
    return answer.ok ? paired(answer.output.partial, answer.output.rowVerification) : undefined;
  }
  const answer = await call("element.search", { ...common, query: buffer.query });
  return answer.ok ? paired(answer.output.hits, answer.output.rowVerification) : undefined;
};

/** The entry of `row` among `verified` at its position, only when it was given for the row's element. */
const verificationAt = (
  verified: readonly (Verified | undefined)[],
  row: Row,
  at: number,
): RowVerification | undefined => {
  const found = verified[at];
  return found?.id === row.open.id && found.repository === row.open.repository ? found.entry : undefined;
};

/** What a list or a search is grouped by (SR-149). */
const groupBy = (buffer: ListBuffer | SearchBuffer): string | undefined => buffer.group;

/** The place of the context menu outside the rows (SR-198); a grouped list offers to ungroup there. */
const listMark = (buffer: ListBuffer | SearchBuffer): Record<string, string> => ({
  "data-menu": "list",
  ...(groupBy(buffer) === undefined ? {} : { [GROUPED]: "" }),
});

/** The groups of a grouped list once it is loaded; none for any other list. */
const groupsOf = (view: View): readonly ListGroup[] | undefined =>
  view.status === "ok" ? view.groups : undefined;

/** The loaded rows, each laid out by `rowAt`; in a grouped list under the heading of its group (SR-149). */
const listed = (
  scope: string,
  groups: readonly ListGroup[] | undefined,
  rows: readonly Row[],
  rowAt: (row: Row, at: number) => React.JSX.Element,
): React.JSX.Element[] =>
  groups === undefined
    ? rows.map(rowAt)
    : groupSections(groups, rows.length).map(({ group, from, to }) => (
        <div key={from} className="group" role="group" aria-labelledby={`${scope}group-${String(from)}`}>
          <h2 id={`${scope}group-${String(from)}`}>
            {groupName(group)} <span className="count">{groupCount(group)}</span>
          </h2>
          {rows.slice(from, to).map((row, index) => rowAt(row, from + index))}
        </div>
      ));

/** What the head of the folded section says it holds. */
export const FOLDED_LABEL = "Folded statuses";

/**
 * Where the row of the folded section stands (SR-201): after the rows in place, once all of them are
 * loaded, and only when some element folds; undefined otherwise.
 */
const sectionStart = (
  shown: Pick<Loaded, "size"> & { readonly rows: readonly Row[] },
  folded: Loaded | undefined,
): number | undefined =>
  folded !== undefined && folded.total > 0 && shown.rows.length >= shown.size ? shown.rows.length : undefined;

/** What the list asks for: its selection, split in two when statuses fold (SR-201; never in a tree). */
const askedOf = (
  selection: ElementSelection | undefined,
  condition: FilterCondition | undefined,
  sort: readonly FilterSortKeyWithDefaults[] | undefined,
): Asked =>
  condition === undefined || !folds(sort) ? { shown: selection } : foldedSelections(selection, condition);

/** Why a load failed: the rows in place, else the folded ones. */
const failure = (shown: Page, folded: Page | undefined): string => {
  if (!shown.ok) {
    return shown.message;
  }
  return folded?.ok === false ? folded.message : "";
};

/** The rows of a loaded list by position: the rows in place, the section row, and its rows while it is open. */
const layoutOf = (view: View, open: boolean) => {
  const rows = view.status === "ok" ? view.rows : [];
  const folded = view.status === "ok" ? view.folded : undefined;
  const sectionAt = view.status === "ok" ? sectionStart(view, folded) : undefined;
  const foldedRows = sectionAt !== undefined && open && folded !== undefined ? folded.rows : [];
  return {
    rows,
    folded,
    sectionAt,
    foldedRows,
    length: rows.length + (sectionAt === undefined ? 0 : 1) + foldedRows.length,
    /** The row at a position: a row in place or a folded row; none at the section row. */
    rowAtPosition: (at: number): Row | undefined =>
      sectionAt === undefined || at < sectionAt ? rows[at] : foldedRows[at - sectionAt - 1],
  };
};

/** The folded section at the end of a list (SR-201): its row, an option of the list, and its rows under it. */
const FoldedSection = ({
  scope,
  at,
  folded,
  open,
  selected,
  onToggle,
  children,
}: {
  readonly scope: string;
  readonly at: number;
  readonly folded: Loaded;
  readonly open: boolean;
  readonly selected: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element => (
  <div className="folded" role="group" aria-labelledby={`${scope}row-${String(at)}`}>
    <div
      id={`${scope}row-${String(at)}`}
      className="row fold-row"
      role="option"
      aria-selected={selected}
      aria-expanded={open}
      onClick={onToggle}
    >
      <FoldHead label={FOLDED_LABEL} count={folded.total} open={open} />
    </div>
    {children}
  </div>
);

/** The part takes the focus when it has rows and the focus is on nothing or on the buffer around it. */
const takesFocus = (list: HTMLElement | null, rows: number): boolean => {
  const active = document.activeElement;
  return rows > 0 && (active === null || active === document.body || active === list?.closest(".buffer"));
};

/** The scroll position is within a screen of the end: the next page is due. */
const nearEnd = ({ scrollHeight, scrollTop, clientHeight }: HTMLElement): boolean =>
  scrollHeight - scrollTop - clientHeight < clientHeight;

const Marked = ({ parts }: { readonly parts: readonly Part[] }): React.JSX.Element => (
  <>
    {parts.map((part, index) =>
      part.mark ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
    )}
  </>
);

/** Characters kept before the first marked word, tried in turn while the line hides it. */
const LEADS = [60, 40, 24, 12, 0];

/**
 * The snippet of a search hit (SR-174): where it was found and core's line, its marked words heavier. Core
 * gives up to 120 characters, more than the column holds: while the line hides its first marked word, the
 * words before it are left out, so the match stays in view (`trimLead`); the whole line is its tooltip.
 */
export const SnippetLine = ({
  id,
  snippet,
}: {
  readonly id: string;
  readonly snippet: Snippet;
}): React.JSX.Element => {
  const line = useRef<HTMLSpanElement>(null);
  // Which entry of LEADS is shown; undefined: the whole line.
  const [lead, setLead] = useState<number | undefined>(undefined);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const box = line.current?.getBoundingClientRect();
    const mark = line.current?.querySelector("mark")?.getBoundingClientRect();
    const next = lead === undefined ? 0 : lead + 1;
    if (box !== undefined && mark !== undefined && mark.right > box.right + 0.5 && next < LEADS.length) {
      setLead(next);
    }
  }, [lead, width]);
  useEffect(() => {
    // Another width measures again from the whole line.
    const resized = (): void => {
      setLead(undefined);
      setWidth(window.innerWidth);
    };
    window.addEventListener("resize", resized);
    return () => {
      window.removeEventListener("resize", resized);
    };
  }, []);
  const keep = lead === undefined ? undefined : LEADS[lead];
  const shown =
    keep === undefined
      ? { text: snippet.text, ranges: snippet.marks }
      : trimLead(snippet.text, snippet.marks, keep);
  return (
    <span ref={line} id={id} className="snippet" title={`${snippet.where}: ${snippet.text}`}>
      <span className="where">{snippet.where}:</span>{" "}
      <Marked parts={highlightRanges(shown.text, shown.ranges)} />
    </span>
  );
};

/** The heading of a list of its own (SR-148): what it shows and, once loaded, how many, as a package page says it. */
const ListHeading = ({
  buffer,
  view,
}: {
  readonly buffer: ListBuffer | SearchBuffer;
  readonly view: View;
}): React.JSX.Element => (
  <h1>
    {listHeading(buffer)}{" "}
    {view.status === "ok" ? (
      <span className="count">
        {memberSummary(
          {
            total: view.total + (view.folded?.total ?? 0),
            incomplete: view.incomplete || view.folded?.incomplete === true,
          },
          buffer.kind === "list" ? listSort(buffer) : undefined,
        )}
      </span>
    ) : null}
  </h1>
);

/**
 * The top of a list of its own: the heading (SR-148) and, for a list, the line of coverage of its elements
 * (a list shows the line a package page has). The line is asked only once
 * the first page stands, so the rows come first in a large workspace; keyed by the selection, so a line from
 * the list before never stands over another one. It follows `revision` only: a list reads again on a change
 * of the workspace, not on an outside change of one element.
 */
const ListTop = ({
  buffer,
  view,
  call,
  revision,
  onEcho,
  dispatch,
}: {
  readonly buffer: ListBuffer | SearchBuffer;
  readonly view: View;
  readonly call: Call;
  readonly revision: number;
  readonly onEcho: (message: string) => void;
  readonly dispatch: (action: BufferAction) => void;
}): React.JSX.Element => {
  const selection = buffer.kind === "list" ? (buffer.selection ?? {}) : undefined;
  const key = JSON.stringify(selection);
  // The selection whose first page stood once: a new sort or a reload of the same selection keeps the line,
  // since its numbers do not change with the order of the rows.
  const [ready, setReady] = useState<string | undefined>(undefined);
  const loaded = view.status === "ok";
  useEffect(() => {
    if (loaded) {
      setReady(key);
    }
  }, [loaded, key]);
  return (
    <>
      <ListHeading buffer={buffer} view={view} />
      {buffer.kind === "list" && selection !== undefined && (loaded || ready === key) ? (
        <SummaryLine
          key={key}
          call={call}
          selection={selection}
          name={bufferName(buffer)}
          revision={revision}
          onEcho={onEcho}
          onOpenResult={(result) => {
            dispatch({ type: "open", buffer: result });
          }}
        />
      ) : null}
    </>
  );
};

export const ListView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
  outside,
  part = false,
  onLeave,
  focusOnLoad = false,
}: ListViewProps): React.JSX.Element => {
  const scope = useIdScope();
  const [view, setView] = useState<View>({ status: "loading" });
  // What each loaded row shows of its verification (SR-137), by position with the element it was given
  // for, so an entry never stands at another element's row while new rows wait for theirs; filled in after
  // the rows, each page in place whatever order the answers come in. The folded rows have their own.
  const [verified, setVerified] = useState<readonly (Verified | undefined)[]>([]);
  const [verifiedFolded, setVerifiedFolded] = useState<readonly (Verified | undefined)[]>([]);
  // The folded section is open (SR-201 AK3): collapsed whenever another list is asked for.
  const [open, setOpen] = useState(false);
  // The open state for the answers of a load: a reload (a save, a change from outside) keeps it.
  const opened = useRef(open);
  opened.current = open;
  const { marked, mark } = useOutsideMarks();
  // The list the rows were asked for last: when only the workspace changed since, the rows stay until
  // the new ones are there, so the selection and the scroll stay too (a change from outside, a save).
  const asked = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);
  // Counts the loads: an answer of an older one (another filter, a later change) is dropped.
  const generation = useRef(0);
  const loadingMore = useRef(false);
  // A part keeps its old rows while it is asked again (a sort, a change of the workspace); until the
  // answer is there they must not be opened or paged on. A list keeps its rows only for a change of the
  // workspace (SR-116): they are of the same list, and Enter opens them meanwhile, as a click does.
  const reloading = useRef(false);
  // The focus is taken once, when the first answer is there.
  const focusTaken = useRef(false);
  const kind = buffer.kind;
  const page = kind === "list" ? LIST_PAGE : SEARCH_PAGE;
  // The key holds the query of a search.
  const selection = buffer.selection;
  const sort = buffer.kind === "list" ? listSort(buffer) : undefined;
  const group = groupBy(buffer);
  // What folds (SR-201): nothing in a tree.
  const selections = askedOf(selection, useFoldCondition(), sort);
  const foldKey = JSON.stringify(selections.folded);
  const list = JSON.stringify([buffer.key, kind, selection, sort, group, foldKey]);
  // Another list (another buffer, filter or sort) starts empty in the same render, not in the effect: its
  // name never stands over the rows of the list before, and no key acts on them.
  useResetOnAsk([list], () => {
    setOpen(false);
    if (!part) {
      setView({ status: "loading" });
      setVerified([]);
      setVerifiedFolded([]);
    }
  });

  /**
   * Asks what the rows from `offset` show of their verification and puts it in place, while the load is
   * `mine`; of the folded rows when `folded`.
   */
  const verify = (mine: number, offset: number, limit: number, folded = false): void => {
    if (limit === 0) {
      return;
    }
    const from = folded ? selections.folded : selections.shown;
    void fetchVerification(call, buffer, offset, limit, from).then((rows) => {
      if (mine === generation.current && rows !== undefined) {
        (folded ? setVerifiedFolded : setVerified)((before) => {
          const next = [...before];
          rows.forEach((row, at) => {
            next[offset + at] = row;
          });
          return next;
        });
      }
    });
  };

  /**
   * What the list loaded, for the modeline: the rows by position, the folded section's row as none, and
   * every element of the list counted.
   */
  const report = (shown: Loaded, section: Loaded | undefined, opened: boolean): void => {
    const at = sectionStart(shown, section);
    const positions: (Row | undefined)[] =
      at === undefined || section === undefined
        ? [...shown.rows]
        : [...shown.rows, undefined, ...(opened ? section.rows : [])];
    onData(buffer.key, {
      kind,
      total: shown.total + (section?.total ?? 0),
      incomplete: shown.incomplete || section?.incomplete === true,
      rows: positions.map((row) => row?.open),
    });
  };

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    loadingMore.current = false;
    reloading.current = true;
    // A part keeps what it shows until the answer replaces it: the page does not jump when the
    // workspace changes, for example with every save. So does a list that is asked again for a change.
    const same = asked.current === list;
    asked.current = list;
    if (!part && !same) {
      onData(buffer.key, undefined);
    }
    const limit = firstLimit(buffer.cursor, page, kind === "list" ? LIST_MAX : SEARCH_MAX);
    const folding = selections.folded;
    void Promise.all([
      fetchPage(call, buffer, 0, limit, selections.shown),
      folding === undefined ? undefined : fetchPage(call, buffer, 0, page, folding),
    ]).then(([loaded, folded]) => {
      if (mine !== generation.current) {
        return;
      }
      reloading.current = false;
      if (loaded.ok && folded?.ok !== false) {
        const { ok: _ok, ...shown } = loaded;
        const section = folded === undefined ? undefined : (({ ok: _done, ...rest }) => rest)(folded);
        setView({ status: "ok", ...shown, ...(section === undefined ? {} : { folded: section }) });
        verify(mine, 0, loaded.rows.length);
        if (section !== undefined) {
          verify(mine, 0, section.rows.length, true);
        }
        if (outside !== undefined) {
          mark(loaded.rows.map((row) => row.open.id).filter(outside.fresh));
        }
        report(shown, section, opened.current);
      } else {
        const message = failure(loaded, folded);
        setView({ status: "error", message });
        onEcho(message);
      }
    });
    return () => {
      generation.current += 1;
    };
    // The cursor is read when the rows are asked for again; moving it must not ask again.
  }, [call, buffer.key, kind, selection, sort, group, foldKey, revision]);

  const { rows, folded, sectionAt, foldedRows, length, rowAtPosition } = layoutOf(view, open);
  const cursor = Math.min(buffer.cursor, Math.max(0, length - 1));

  useEffect(() => {
    const list = root.current;
    if (part && view.status === "ok" && focusOnLoad && !focusTaken.current) {
      focusTaken.current = true;
      if (takesFocus(list, length)) {
        list?.focus({ preventScroll: true });
      }
    }
    // A part scrolls to its row only while the reader is in it: opening a package must not scroll
    // away from its text.
    if (!part || list?.contains(document.activeElement) === true) {
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
  }, [cursor, view.status]);

  /** The next page of the folded section, once it is open and every row in place stands. */
  const loadMoreFolded = (): void => {
    if (view.status !== "ok" || folded === undefined || !open || folded.rows.length >= folded.size) {
      return;
    }
    loadingMore.current = true;
    const mine = generation.current;
    void fetchPage(call, buffer, folded.rows.length, page, selections.folded).then((loaded) => {
      loadingMore.current = false;
      if (mine !== generation.current) {
        return;
      }
      if (loaded.ok) {
        const foldedNow = [...folded.rows, ...loaded.rows];
        verify(mine, folded.rows.length, loaded.rows.length, true);
        setView({
          ...view,
          folded: {
            ...folded,
            rows: foldedNow,
            total: loaded.total,
            size: loaded.size,
            ...(loaded.groups === undefined ? {} : { groups: loaded.groups }),
          },
        });
        report(view, { ...folded, rows: foldedNow, total: loaded.total, size: loaded.size }, true);
      } else {
        onEcho(loaded.message);
      }
    });
  };

  const loadMore = (): void => {
    if (view.status !== "ok" || loadingMore.current || reloading.current) {
      return;
    }
    if (view.rows.length >= view.size) {
      loadMoreFolded();
      return;
    }
    loadingMore.current = true;
    const mine = generation.current;
    void fetchPage(call, buffer, view.rows.length, page, selections.shown).then((loaded) => {
      loadingMore.current = false;
      if (mine !== generation.current) {
        return;
      }
      if (loaded.ok) {
        const rows = [...view.rows, ...loaded.rows];
        verify(mine, view.rows.length, loaded.rows.length);
        setView({
          ...view,
          rows,
          total: loaded.total,
          size: loaded.size,
          ...(loaded.groups === undefined ? {} : { groups: loaded.groups }),
        });
        report({ ...view, rows, total: loaded.total, size: loaded.size }, view.folded, open);
      } else {
        onEcho(loaded.message);
      }
    });
  };

  // A part has no scroll of its own: the next page is due when the enclosing buffer is near its end.
  const due = useRef(loadMore);
  due.current = loadMore;
  useEffect(() => {
    const scroller = part ? root.current?.closest<HTMLElement>(".buffer") : null;
    if (scroller === null || scroller === undefined) {
      return undefined;
    }
    const onScroll = (): void => {
      if (nearEnd(scroller)) {
        due.current();
      }
    };
    scroller.addEventListener("scroll", onScroll);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [part]);

  const moveTo = (to: number): void => {
    const next = Math.max(0, Math.min(length - 1, to));
    dispatch({ type: "cursor", key: buffer.key, cursor: next });
    if (next >= length - NEAR_END) {
      loadMore();
    }
  };

  const openRow = (row: Row): void => {
    dispatch({ type: "open", buffer: row.open });
  };

  /**
   * Opens or closes the folded section (SR-201 AK3) and selects its row. Opened, it shows the rows loaded
   * with the list; closed, a selection in it goes to the section row, and the modeline counts its rows no more.
   */
  const toggle = (next: boolean): void => {
    if (sectionAt === undefined || view.status !== "ok") {
      return;
    }
    setOpen(next);
    dispatch({ type: "cursor", key: buffer.key, cursor: sectionAt });
    report(view, folded, next);
  };

  /** A key on the section row: Enter and Tab toggle it, Right opens and Left closes it (SR-193 AK1, AK2). */
  const sectionKey = (event: React.KeyboardEvent): boolean => {
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (!plain || sectionAt === undefined || Math.max(0, cursor) < sectionAt) {
      return false;
    }
    // On a folded row only Left acts: it closes the section, as Left goes to the parent row in a tree.
    const keys: Readonly<Record<string, boolean | undefined>> =
      Math.max(0, cursor) === sectionAt
        ? { Enter: !open, Tab: !open, ArrowRight: true, ArrowLeft: false }
        : { ArrowLeft: false };
    const next = keys[event.key];
    if (next === undefined) {
      return false;
    }
    event.preventDefault();
    toggle(next);
    return true;
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    if (part && leavesPart(event, cursor)) {
      event.preventDefault();
      onLeave?.();
      return;
    }
    if (sectionKey(event)) {
      return;
    }
    const to = rowTarget(event, cursor, length, SCREEN);
    if (to !== undefined) {
      event.preventDefault();
      moveTo(to);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // With no row selected, Enter opens the first one.
      const at = Math.max(0, cursor);
      const row = rowAtPosition(at);
      if (row !== undefined && !(part && reloading.current)) {
        // The row is kept as the cursor, as a click keeps it: Ctrl+P Enter comes back to it.
        dispatch({ type: "cursor", key: buffer.key, cursor: at });
        openRow(row);
      }
    }
  };

  const groups = groupsOf(view);
  const rowAt = (
    row: Row,
    at: number,
    verification: RowVerification | undefined,
    keyed: boolean,
  ): React.JSX.Element => {
    const id = `${scope}row-${String(at)}`;
    // A row with a snippet is named by its ID, title and status; the snippet describes it (SR-174).
    const named =
      row.snippet === undefined
        ? {}
        : {
            "aria-labelledby": `${id}-id ${id}-title ${id}-status ${id}-verification`,
            "aria-describedby": `${id}-snippet`,
          };
    return (
      <div
        // A grouped list can show an element in several groups: its rows are told apart by position.
        key={keyed ? row.open.key : at}
        id={id}
        className={rowClass("row", marked, row.open.id)}
        role="option"
        aria-selected={at === cursor}
        {...named}
        data-menu="element-entry"
        onClick={() => {
          dispatch({ type: "cursor", key: buffer.key, cursor: at });
          openRow(row);
        }}
        // A right-click selects the row before the context menu opens (SR-194 AK5).
        onContextMenu={() => {
          dispatch({ type: "cursor", key: buffer.key, cursor: at });
        }}
      >
        <span className="id" id={`${id}-id`} title={row.label}>
          <Marked
            parts={highlightRanges(row.label, labelMarks(row, buffer.kind === "search" ? buffer.query : ""))}
          />
        </span>
        <span className="title" id={`${id}-title`} style={{ paddingLeft: `${String(row.depth * 1.25)}rem` }}>
          <Marked parts={highlightRanges(row.title, row.titleMarks)} />
        </span>
        <span className="status" id={`${id}-status`}>
          {row.status}
        </span>
        <span className="verification" id={`${id}-verification`}>
          {verification === undefined ? null : <NodeVerification node={verification} named />}
        </span>
        {row.snippet === undefined ? null : (
          <SnippetLine key={row.snippet.text} id={`${id}-snippet`} snippet={row.snippet} />
        )}
      </div>
    );
  };

  // The folded section (SR-201): its row, and under it, while open, its rows, grouped as the list is.
  const section =
    sectionAt === undefined || folded === undefined ? null : (
      <FoldedSection
        scope={scope}
        at={sectionAt}
        folded={folded}
        open={open}
        selected={cursor === sectionAt}
        onToggle={() => {
          toggle(!open);
        }}
      >
        {listed(`${scope}folded-`, folded.groups, foldedRows, (row, at) =>
          rowAt(
            row,
            sectionAt + 1 + at,
            verificationAt(verifiedFolded, row, at),
            folded.groups === undefined,
          ),
        )}
      </FoldedSection>
    );

  // The rows share one grid (`.rows`, its rows a subgrid of it), so the status and the verification stand
  // in one line in every row, however wide their text is (#1275).
  const rowsAndNotes = (
    <div className="rows">
      {listed(scope, groups, rows, (row, at) =>
        rowAt(row, at, verificationAt(verified, row, at), groups === undefined),
      )}
      {section}
      {view.status === "ok" && length === 0 && !part ? (
        <p className="quiet">{buffer.kind === "list" ? "No elements" : `No hits for ${buffer.query}`}</p>
      ) : null}
      {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
    </div>
  );

  return (
    <div
      ref={root}
      className={part ? "list part" : "buffer list"}
      role="listbox"
      aria-label={bufferName(buffer)}
      aria-activedescendant={activeRow(`${scope}row`, cursor, length)}
      {...(part ? {} : { "data-buffer": "" })}
      tabIndex={0}
      onKeyDown={keyDown}
      onScroll={(event) => {
        if (nearEnd(event.currentTarget)) {
          loadMore();
        }
      }}
    >
      {part ? (
        rowsAndNotes
      ) : (
        // Outside its rows the list has its own context menu (SR-198); a grouped one offers to ungroup.
        <div className="column" {...listMark(buffer)}>
          <ListTop
            buffer={buffer}
            view={view}
            call={call}
            revision={revision}
            onEcho={onEcho}
            dispatch={dispatch}
          />
          {rowsAndNotes}
        </div>
      )}
    </div>
  );
};
