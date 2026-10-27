// The list buffer and the search buffer: rows of elements as `element.list` and `element.search` give
// them, in pages. The next page is asked for when the selection or the scroll reaches the end, so a
// workspace of 50,000 elements is never loaded at once (N-036).
import { useEffect, useRef, useState } from "react";
import type { BufferAction, ListBuffer, SearchBuffer } from "./buffers.js";
import { bufferName, listSort } from "./buffers.js";
import type { Call } from "./call.js";
import { highlightTerms } from "./highlight.js";
import type { Part } from "./highlight.js";
import type { BufferData } from "./modeline.js";
import type { Row } from "./rows.js";
import { LIST_MAX, LIST_PAGE, SEARCH_MAX, SEARCH_PAGE, firstLimit, listRows, searchRows } from "./rows.js";

export interface ListViewProps {
  readonly call: Call;
  readonly buffer: ListBuffer | SearchBuffer;
  /** Counts up when the workspace changed: the rows are asked for again. */
  readonly revision: number;
  readonly dispatch: (action: BufferAction) => void;
  /** What the buffer has loaded, for the modeline. */
  /** `undefined` while the buffer asks again, so the modeline never shows an old count. */
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
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

type Page =
  | { readonly ok: true; readonly rows: Row[]; readonly total: number; readonly incomplete: boolean }
  | { readonly ok: false; readonly message: string };

type View =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ok";
      readonly rows: readonly Row[];
      readonly total: number;
      readonly incomplete: boolean;
    };

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
      limit,
      offset,
    });
    return answer.ok
      ? {
          ok: true,
          rows: listRows(answer.output),
          total: answer.output.total,
          incomplete: answer.output.incomplete === true,
        }
      : answer;
  }
  const answer = await call("element.search", { query: buffer.query, limit, offset });
  return answer.ok
    ? {
        ok: true,
        rows: searchRows(answer.output),
        total: answer.output.total,
        incomplete: answer.output.incomplete,
      }
    : answer;
};

/** The part takes the focus when it has rows and the focus is on nothing or on the buffer around it. */
const takesFocus = (list: HTMLElement | null, rows: number): boolean => {
  const active = document.activeElement;
  return rows > 0 && (active === null || active === document.body || active === list?.closest(".buffer"));
};

/** A part is left with Escape, or with Up on its first row. */
const leaves = (key: string, cursor: number): boolean =>
  key === "Escape" || (key === "ArrowUp" && cursor === 0);

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

export const ListView = ({
  call,
  buffer,
  revision,
  dispatch,
  onData,
  onEcho,
  part = false,
  onLeave,
  focusOnLoad = false,
}: ListViewProps): React.JSX.Element => {
  const [view, setView] = useState<View>({ status: "loading" });
  const root = useRef<HTMLDivElement>(null);
  // Counts the loads: an answer of an older one (another filter, a later change) is dropped.
  const generation = useRef(0);
  const loadingMore = useRef(false);
  // A part keeps its old rows while it is asked again (a sort, a change of the workspace); until the
  // answer is there they must not be opened or paged on.
  const reloading = useRef(false);
  // The focus is taken once, when the first answer is there.
  const focusTaken = useRef(false);
  const kind = buffer.kind;
  const page = kind === "list" ? LIST_PAGE : SEARCH_PAGE;
  const selection = buffer.kind === "list" ? buffer.selection : buffer.query;
  const sort = buffer.kind === "list" ? listSort(buffer) : undefined;

  useEffect(() => {
    generation.current += 1;
    const mine = generation.current;
    loadingMore.current = false;
    reloading.current = true;
    // A part keeps what it shows until the answer replaces it: the page does not jump when the
    // workspace changes, for example with every save.
    if (!part) {
      setView({ status: "loading" });
      onData(buffer.key, undefined);
    }
    const limit = firstLimit(buffer.cursor, page, kind === "list" ? LIST_MAX : SEARCH_MAX);
    void fetchPage(call, buffer, 0, limit).then((loaded) => {
      if (mine !== generation.current) {
        return;
      }
      reloading.current = false;
      if (loaded.ok) {
        setView({ status: "ok", rows: loaded.rows, total: loaded.total, incomplete: loaded.incomplete });
        onData(buffer.key, { kind, total: loaded.total, incomplete: loaded.incomplete });
      } else {
        setView({ status: "error", message: loaded.message });
        onEcho(loaded.message);
      }
    });
    return () => {
      generation.current += 1;
    };
    // The cursor is read when the rows are asked for again; moving it must not ask again.
  }, [call, buffer.key, kind, selection, sort, revision]);

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
    if (view.status !== "ok" || loadingMore.current || reloading.current || view.rows.length >= view.total) {
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
        setView({ ...view, rows: [...view.rows, ...loaded.rows], total: loaded.total });
        onData(buffer.key, { kind, total: loaded.total, incomplete: loaded.incomplete });
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
    if (part && leaves(event.key, cursor)) {
      event.preventDefault();
      onLeave?.();
      return;
    }
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: cursor + 1,
      ArrowUp: cursor - 1,
      PageDown: cursor + SCREEN,
      PageUp: cursor - SCREEN,
      Home: 0,
      End: rows.length - 1,
    };
    const to = moves[event.key];
    if (to !== undefined) {
      event.preventDefault();
      moveTo(to);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const row = rows[cursor];
      if (row !== undefined && !reloading.current) {
        // The row is kept as the cursor, as a click keeps it: Ctrl+P Enter comes back to it.
        dispatch({ type: "cursor", key: buffer.key, cursor });
        openRow(row);
      }
    }
  };

  return (
    <div
      ref={root}
      className={part ? "list part" : "buffer list"}
      role="listbox"
      aria-label={bufferName(buffer)}
      aria-activedescendant={rows.length === 0 ? undefined : `row-${String(cursor)}`}
      {...(part ? {} : { "data-buffer": "" })}
      tabIndex={0}
      onKeyDown={keyDown}
      onScroll={(event) => {
        if (nearEnd(event.currentTarget)) {
          loadMore();
        }
      }}
    >
      {rows.map((row, at) => (
        <div
          key={row.open.key}
          id={`row-${String(at)}`}
          className="row"
          role="option"
          aria-selected={at === cursor}
          onClick={() => {
            dispatch({ type: "cursor", key: buffer.key, cursor: at });
            openRow(row);
          }}
        >
          <span className="id">
            <Marked parts={highlightTerms(row.label, row.markLabel ? [row.label.toLowerCase()] : [])} />
          </span>
          <span className="title" style={{ paddingLeft: `${String(row.depth * 1.25)}rem` }}>
            <Marked parts={highlightTerms(row.title, row.terms)} />
          </span>
          <span className="status">{row.status}</span>
        </div>
      ))}
      {view.status === "ok" && rows.length === 0 && !part ? (
        <p className="quiet">{buffer.kind === "list" ? "No elements" : `No hits for ${buffer.query}`}</p>
      ) : null}
      {view.status === "error" ? <p className="quiet">{view.message}</p> : null}
    </div>
  );
};
