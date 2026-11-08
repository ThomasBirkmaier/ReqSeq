// The list buffer and the search buffer: rows of elements as `element.list` and `element.search` give
// them, in pages. The next page is asked for when the selection or the scroll reaches the end, so a
// workspace of 50,000 elements is never loaded at once (N-036). A row whose element changed outside the
// app is highlighted briefly (SR-116), and a change keeps the rows, the selection and the scroll. As a
// buffer of its own, the list stands like the elements of a package page: in the centred column, under a
// heading that says what it shows and how many (SR-148, D-062), and under it the line of coverage and
// verification degree of its elements, as a package page has it (`SummaryLine`, product owner decision,
// 2026-11-06). A grouped list (SR-149) shows each group of `element.list` under a heading with its name and
// count, below that line; the rows are those of the grouped list, so an element in several groups is a row
// in each, and rows are keyed by their position. A search hit shows the title with the words core marked
// (`titleMarks`) and, under it, where it was found and the snippet core gives (SR-174), marked the same way.
// Right of its status each row shows what the element's node in the graph shows of its verification: a
// requirement's verification status and the progress ring of a requirement or need (SR-137, `NodeVerification`
// of SR-136). It is asked for each page once its rows stand (`withVerification`, `fetchVerification`), so the
// rows come first in a large workspace, as the summary line does.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ElementListOutput } from "@reqseq/core";
import { useIdScope } from "./area-scope.js";
import type { BufferAction, ListBuffer, SearchBuffer } from "./buffers.js";
import { bufferName, listHeading, listSort } from "./buffers.js";
import type { Call } from "./call.js";
import { highlightRanges, highlightTerms, trimLead } from "./highlight.js";
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
import { useResetOnAsk } from "./use-reset-on-ask.js";
import type { Row, Snippet } from "./rows.js";
import {
  LIST_MAX,
  LIST_PAGE,
  SEARCH_MAX,
  SEARCH_PAGE,
  activeRow,
  firstLimit,
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
  readonly rows: Row[];
  readonly total: number;
  readonly size: number;
  readonly incomplete: boolean;
  readonly groups?: readonly ListGroup[];
}

type Page = ({ readonly ok: true } & Loaded) | { readonly ok: false; readonly message: string };

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | ({ readonly status: "ok" } & Omit<Loaded, "rows"> & { readonly rows: readonly Row[] });

/** Rows moved by Page Up and Page Down. */
const SCREEN = 10;
/** The next page is asked for when the selection is this close to the last loaded row. */
const NEAR_END = 5;

const fetchPage = async (
  call: Call,
  buffer: ListBuffer | SearchBuffer,
  offset: number,
  limit: number,
): Promise<Page> => {
  if (buffer.kind === "list") {
    const sort = listSort(buffer);
    const answer = await call("element.list", {
      ...(buffer.selection === undefined ? {} : { selection: buffer.selection }),
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
    ...(buffer.selection === undefined ? {} : { selection: buffer.selection }),
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
): Promise<readonly Verified[] | undefined> => {
  const common = {
    ...(buffer.selection === undefined ? {} : { selection: buffer.selection }),
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
          { total: view.total, incomplete: view.incomplete },
          buffer.kind === "list" ? listSort(buffer) : undefined,
        )}
      </span>
    ) : null}
  </h1>
);

/**
 * The top of a list of its own: the heading (SR-148) and, for a list, the line of coverage of its elements
 * (product owner decision, 2026-11-06: a list shows the line a package page has). The line is asked only once
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
  // the rows, each page in place whatever order the answers come in.
  const [verified, setVerified] = useState<readonly (Verified | undefined)[]>([]);
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
  const list = JSON.stringify([buffer.key, kind, selection, sort, group]);
  // Another list (another buffer, filter or sort) starts empty in the same render, not in the effect: its
  // name never stands over the rows of the list before, and no key acts on them.
  useResetOnAsk([list], () => {
    if (!part) {
      setView({ status: "loading" });
      setVerified([]);
    }
  });

  /** Asks what the rows from `offset` show of their verification and puts it in place, while the load is `mine`. */
  const verify = (mine: number, offset: number, limit: number): void => {
    if (limit === 0) {
      return;
    }
    void fetchVerification(call, buffer, offset, limit).then((rows) => {
      if (mine === generation.current && rows !== undefined) {
        setVerified((before) => {
          const next = [...before];
          rows.forEach((row, at) => {
            next[offset + at] = row;
          });
          return next;
        });
      }
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
    void fetchPage(call, buffer, 0, limit).then((loaded) => {
      if (mine !== generation.current) {
        return;
      }
      reloading.current = false;
      if (loaded.ok) {
        const { ok: _ok, ...shown } = loaded;
        setView({ status: "ok", ...shown });
        verify(mine, 0, loaded.rows.length);
        if (outside !== undefined) {
          mark(loaded.rows.map((row) => row.open.id).filter(outside.fresh));
        }
        onData(buffer.key, {
          kind,
          total: loaded.total,
          incomplete: loaded.incomplete,
          rows: loaded.rows.map((row) => row.open),
        });
      } else {
        setView({ status: "error", message: loaded.message });
        onEcho(loaded.message);
      }
    });
    return () => {
      generation.current += 1;
    };
    // The cursor is read when the rows are asked for again; moving it must not ask again.
  }, [call, buffer.key, kind, selection, sort, group, revision]);

  const rows = view.status === "ok" ? view.rows : [];
  const cursor = Math.min(buffer.cursor, Math.max(0, rows.length - 1));

  useEffect(() => {
    const list = root.current;
    if (part && view.status === "ok" && focusOnLoad && !focusTaken.current) {
      focusTaken.current = true;
      if (takesFocus(list, rows.length)) {
        list?.focus({ preventScroll: true });
      }
    }
    // A part scrolls to its row only while the reader is in it: opening a package must not scroll
    // away from its text.
    if (!part || list?.contains(document.activeElement) === true) {
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    }
  }, [cursor, view.status]);

  const loadMore = (): void => {
    if (view.status !== "ok" || loadingMore.current || reloading.current || view.rows.length >= view.size) {
      return;
    }
    loadingMore.current = true;
    const mine = generation.current;
    void fetchPage(call, buffer, view.rows.length, page).then((loaded) => {
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
        onData(buffer.key, {
          kind,
          total: loaded.total,
          incomplete: loaded.incomplete,
          rows: rows.map((row) => row.open),
        });
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
    const next = Math.max(0, Math.min(rows.length - 1, to));
    dispatch({ type: "cursor", key: buffer.key, cursor: next });
    if (next >= rows.length - NEAR_END) {
      loadMore();
    }
  };

  const openRow = (row: Row): void => {
    dispatch({ type: "open", buffer: row.open });
  };

  const keyDown = (event: React.KeyboardEvent): void => {
    if (part && leavesPart(event, cursor)) {
      event.preventDefault();
      onLeave?.();
      return;
    }
    const to = rowTarget(event, cursor, rows.length, SCREEN);
    if (to !== undefined) {
      event.preventDefault();
      moveTo(to);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // With no row selected, Enter opens the first one.
      const at = Math.max(0, cursor);
      const row = rows[at];
      if (row !== undefined && !(part && reloading.current)) {
        // The row is kept as the cursor, as a click keeps it: Ctrl+P Enter comes back to it.
        dispatch({ type: "cursor", key: buffer.key, cursor: at });
        openRow(row);
      }
    }
  };

  const groups = groupsOf(view);
  const rowAt = (row: Row, at: number): React.JSX.Element => {
    const id = `${scope}row-${String(at)}`;
    // A row with a snippet is named by its ID, title and status; the snippet describes it (SR-174).
    const named =
      row.snippet === undefined
        ? {}
        : {
            "aria-labelledby": `${id}-id ${id}-title ${id}-status ${id}-verification`,
            "aria-describedby": `${id}-snippet`,
          };
    const verification = verificationAt(verified, row, at);
    return (
      <div
        // A grouped list can show an element in several groups: its rows are told apart by position.
        key={groups === undefined ? row.open.key : at}
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
        <span className="id" id={`${id}-id`}>
          <Marked parts={highlightTerms(row.label, row.markLabel ? [row.label.toLowerCase()] : [])} />
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

  const rowsAndNotes = (
    <>
      {listed(scope, groups, rows, rowAt)}
      {view.status === "ok" && rows.length === 0 && !part ? (
        <p className="quiet">{buffer.kind === "list" ? "No elements" : `No hits for ${buffer.query}`}</p>
      ) : null}
      {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
    </>
  );

  return (
    <div
      ref={root}
      className={part ? "list part" : "buffer list"}
      role="listbox"
      aria-label={bufferName(buffer)}
      aria-activedescendant={activeRow(`${scope}row`, cursor, rows.length)}
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
        <div className="column">
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
