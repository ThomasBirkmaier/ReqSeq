// An area of the window (SR-115 AK3, D-062): the view of one buffer. The window has one area, or two side
// by side after "Split window" (`window-layout.ts`). An area has no heading, label or tab (AK2): the
// modeline names the buffer of the active one. A press or a focus in the inactive area makes it active.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RecordTag } from "./area-record.js";
import { AreaRecords } from "./area-record.js";
import type { ReadGate } from "./area-slot.js";
import { HeldCalls, SlotContext, drawnBy } from "./area-slot.js";
import type { ElementBuffer, GraphBuffer, MetamodelBuffer, OverviewBuffer } from "./buffers.js";
import type { Buffer } from "./buffers.js";
import { inMatrix } from "./buffers.js";
import type { Call } from "./call.js";
import type { ElementViewProps } from "./ElementView.js";
import { ElementView } from "./ElementView.js";
import { GraphView } from "./GraphView.js";
import { IdScope } from "./area-scope.js";
import type { ListViewProps } from "./ListView.js";
import { ListView } from "./ListView.js";
import { MatrixView } from "./MatrixView.js";
import { MetamodelView } from "./MetamodelView.js";
import type { BufferData } from "./modeline.js";
import { NeighbourhoodView } from "./NeighbourhoodView.js";
import type { OverviewData } from "./OverviewView.js";
import { OverviewView } from "./OverviewView.js";
import type { OutsideChanges } from "./outside-marks.js";
import type { PerspectiveRow, RecentRow } from "./overview.js";
import type { RecentEntry } from "./recent.js";
import { ResultView } from "./ResultView.js";
import type { DrawnBy, Neighbour } from "./neighbours.js";
import type { Area, WindowAction } from "./window-layout.js";

type LoadingBuffer = Exclude<Buffer, ElementBuffer | OverviewBuffer | GraphBuffer | MetamodelBuffer>;

/**
 * The view of such a buffer: a list or a search result as rows, or (a list in matrix mode, SR-125) as the
 * traceability matrix; a neighbourhood (SR-107); the output of a catalog command (SR-073 AK2).
 */
export const LoadingView = ({
  buffer,
  ...props
}: Omit<ListViewProps, "buffer" | "dispatch"> & {
  readonly buffer: LoadingBuffer;
  /** Also the window's actions: a pair line of a result opens two elements side by side (SR-044 AK2). */
  readonly dispatch: (action: WindowAction) => void;
}): React.JSX.Element => {
  const shared = {
    call: props.call,
    revision: props.revision,
    dispatch: props.dispatch,
    onData: props.onData,
    onEcho: props.onEcho,
  };
  const drawn = props.onDrawn === undefined ? {} : { onDrawn: props.onDrawn };
  // The rows that changed outside are highlighted (SR-116).
  const marking = props.outside === undefined ? {} : { outside: props.outside };
  if (buffer.kind === "result") {
    return <ResultView key={buffer.key} buffer={buffer} {...shared} />;
  }
  if (buffer.kind === "neighbourhood") {
    return <NeighbourhoodView key={buffer.key} buffer={buffer} {...shared} {...drawn} {...marking} />;
  }
  return inMatrix(buffer) ? (
    <MatrixView buffer={buffer} {...shared} {...drawn} {...marking} />
  ) : (
    <ListView buffer={buffer} {...props} />
  );
};

/** The props of an element view that the app gives for its buffer, besides those every view gets. */
export type ElementProps = Omit<
  ElementViewProps,
  "buffer" | "active" | "call" | "revision" | "outside" | "onData" | "onEcho" | "onDrawn" | "dispatch"
>;

/** What every view of an area gets from the app. */
export interface AreaViews {
  readonly call: Call;
  /** Counts up when the workspace changed. */
  readonly revision: number;
  /** Counts up also on every change from outside: what views of several elements read again on. */
  readonly seen: number;
  readonly outside: OutsideChanges;
  readonly dispatch: (action: WindowAction) => void;
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** A view cannot draw its buffer: a switch in motion to it starts (SR-212, `buffer-slide.ts`). */
  readonly onDrawn: (key: string) => void;
  /** The names of the types by their key, from the metamodel. */
  readonly typeNames: ReadonlyMap<string, string>;
  /** The names of the relation kinds and relation properties by their key, from the metamodel (SR-154). */
  readonly kindNames: ReadonlyMap<string, string>;
  /** What the overview shows (`useOverview`), read while an area shows it. */
  readonly overview: {
    readonly data: OverviewData | undefined;
    readonly perspectives: readonly PerspectiveRow[];
    readonly recents: readonly RecentRow[];
    /** The elements opened last, as the window keeps them, also those not read yet (SR-118 AK1). */
    readonly recent: readonly RecentEntry[];
    /** Opens a perspective of the overview (SR-118 AK7). */
    readonly openPerspective: (name: string) => void;
  };
  /** The props of the view of an element buffer. */
  readonly element: (buffer: ElementBuffer) => ElementProps;
  /** When the reads of the views drawn in advance may go (SR-212 AK5). */
  readonly gate: ReadGate;
  /**
   * The hidden view `mount` of `key` is drawn with no read pending, in the generation `seen` of the workspace
   * (`generation`), or no longer (undefined): a switch to it slides at once (SR-212 AK5). `recorded`: it was
   * drawn from its record (`area-record.ts`).
   */
  readonly ready: (key: string, mount: number, generation: number | undefined, recorded: boolean) => void;
  /**
   * Leaving the buffer `key` changes nothing: it has no input to save and no save of the window is in flight.
   * Only then does a buffer drawn from its record show what a fresh view at the switch shows (SR-212 AK5).
   */
  readonly clean: (key: string) => boolean;
  /** The core process stopped: a fresh view would show its error, so nothing is drawn from a record. */
  readonly stopped: boolean;
  /**
   * The hidden view of `key` read in an older generation of the workspace: it is not read again in the
   * background but dropped from the buffers drawn in advance until the next switch (SR-212 AK5).
   */
  readonly drop: (key: string) => void;
  /**
   * Counts the changes that were a save of leaving an element (SR-105 AK1): they belong to the switch, so a
   * hidden view that read before one reads once more, and is not dropped (SR-212 AK5).
   */
  readonly switchSaves: number;
}

const BufferView = ({
  buffer,
  active,
  split,
  views,
}: {
  readonly buffer: Buffer;
  readonly active: boolean;
  readonly split: boolean;
  readonly views: AreaViews;
}): React.JSX.Element => {
  const { call, revision, seen, outside, dispatch, onData, onEcho, onDrawn } = views;
  if (buffer.kind === "element") {
    return (
      <ElementView
        key={buffer.key}
        {...views.element(buffer)}
        call={call}
        buffer={buffer}
        revision={revision}
        outside={outside}
        onData={onData}
        onEcho={onEcho}
        onDrawn={onDrawn}
        dispatch={dispatch}
        active={active}
      />
    );
  }
  if (buffer.kind === "overview") {
    return (
      <OverviewView
        buffer={buffer}
        data={views.overview.data}
        perspectives={views.overview.perspectives}
        recents={views.overview.recents}
        onPerspective={views.overview.openPerspective}
        outside={outside}
        dispatch={dispatch}
        onData={onData}
      />
    );
  }
  if (buffer.kind === "graph") {
    return (
      <GraphView
        key={buffer.key}
        call={call}
        buffer={buffer}
        revision={seen}
        dispatch={dispatch}
        onData={onData}
        onEcho={onEcho}
        onDrawn={onDrawn}
        typeNames={views.typeNames}
        kindNames={views.kindNames}
        split={split}
      />
    );
  }
  if (buffer.kind === "metamodel") {
    return (
      <MetamodelView
        call={call}
        buffer={buffer}
        revision={revision}
        dispatch={dispatch}
        onData={onData}
        onEcho={onEcho}
        onDrawn={onDrawn}
        split={split}
      />
    );
  }
  return (
    <LoadingView
      call={call}
      buffer={buffer}
      revision={seen}
      outside={outside}
      dispatch={dispatch}
      onData={onData}
      onEcho={onEcho}
      onDrawn={onDrawn}
    />
  );
};

/** The key of a layer of an area in React: one per mount of a view, so a remount is a fresh view (SR-212 AK5). */
interface SlotEntry {
  /** The React key of the layer. */
  readonly id: string;
  readonly buffer: Buffer;
  /** Counts the mounts of the buffer's view in this area; part of the React key. */
  readonly mount: number;
  readonly shown: boolean;
  /** How a hidden view is drawn (`neighbours.ts`); none for the shown one. */
  readonly by: DrawnBy | undefined;
}

/**
 * What a view shows besides its reads, which a record of it holds with its answers (`area-record.ts`): the
 * names of the metamodel, the size of its area (the graph and the metamodel lay out from it), whether the core
 * process stopped, and for the overview what the window read for it (`useOverview`).
 */
const inputsOf = (buffer: Buffer, views: AreaViews, size: string): string =>
  JSON.stringify([
    [...views.typeNames],
    [...views.kindNames],
    size,
    views.stopped,
    buffer.kind === "overview"
      ? [views.overview.data, views.overview.perspectives, views.overview.recents, views.overview.recent]
      : null,
  ]);

/**
 * The layers of an area: the shown buffer, then the buffers drawn hidden beside it (SR-212 AK5) in the order
 * they were mounted, each in a layer of its own per mount. The buffer just left mounts again hidden, as a fresh
 * view: an element or a neighbourhood after the save of leaving (SR-105 AK1), any other buffer only when its
 * record (`records`) holds what its shown view read, in the current generation and with the same inputs.
 * One drawn from its record stays while it stays beside the shown buffer; it is never mounted again from a
 * record until it was shown. A buffer shown again while leaving the one before changes something (`clean`)
 * is mounted fresh, as a view at the switch is. A list shown after another one with the same key updates in
 * place.
 */
const useSlots = (
  shown: Buffer,
  hidden: readonly Neighbour[],
  records: AreaRecords,
  tag: RecordTag,
  inputs: (buffer: Buffer) => string,
  clean: (key: string) => boolean,
): readonly SlotEntry[] => {
  const state = useRef({
    mounts: new Map<string, number>(),
    order: [] as string[],
    shown: undefined as string | undefined,
    /** The keys of the layers of the last render. */
    live: new Set<string>(),
    /** How the hidden layers of the last render were drawn. */
    drawn: new Map<string, DrawnBy | undefined>(),
  });
  const now = state.current;
  const bump = (key: string): void => {
    now.mounts.set(key, (now.mounts.get(key) ?? 0) + 1);
  };
  const left = now.shown !== shown.key ? now.shown : undefined;
  const placed = hidden.filter(({ buffer, by }) => {
    if (by !== "record") {
      return true;
    }
    if (buffer.key === left) {
      return records.get(buffer.key, tag, inputs(buffer)) !== undefined;
    }
    return now.live.has(buffer.key);
  });
  for (const { buffer } of placed) {
    if (buffer.key === left) {
      // The buffer just left: a fresh hidden view.
      bump(buffer.key);
    }
  }
  if (left !== undefined && now.drawn.get(shown.key) === "record" && !clean(left)) {
    // Its hidden view may show what leaving the buffer before changes: a fresh view, as at a switch.
    bump(shown.key);
  }
  now.shown = shown.key;
  const all = [shown, ...placed.map(({ buffer }) => buffer)];
  const by = new Map(placed.map((entry) => [entry.buffer.key, entry.by]));
  const keys = new Set(all.map((buffer) => buffer.key));
  // The shown layer first, so a lookup in the document finds the shown view before a hidden one; React then
  // moves only hidden layers, never the shown one.
  const order = [shown.key, ...now.order.filter((key) => keys.has(key) && key !== shown.key)];
  for (const key of keys) {
    if (!order.includes(key)) {
      order.push(key);
    }
  }
  now.order = order;
  now.live = keys;
  now.drawn = by;
  for (const key of [...now.mounts.keys()]) {
    if (!keys.has(key)) {
      now.mounts.delete(key);
    }
  }
  const byKey = new Map(all.map((buffer) => [buffer.key, buffer]));
  return order.flatMap((key) => {
    const buffer = byKey.get(key);
    if (buffer === undefined) {
      return [];
    }
    const mount = now.mounts.get(key) ?? 0;
    const isShown = key === shown.key;
    return [
      { id: `${key}#${String(mount)}`, buffer, mount, shown: isShown, by: isShown ? undefined : by.get(key) },
    ];
  });
};

/** A read the layer did not send, as the view gets it. */
const notSent = (code: string, message: string): Awaited<ReturnType<Call>> => ({ ok: false, code, message });

/**
 * The views of one layer: those of the area, with the callbacks of a hidden view held (`HeldCalls`) and its
 * reads behind the gate, counted, so the layer knows when its view is drawn with no read pending. A shown view
 * writes what it reads into the record of its buffer; a hidden view drawn from a record reads only from it.
 */
/** What a view held for a swipe keeps (SR-212 AK5): the generation and the changes from outside it drew in. */
interface HeldAt {
  readonly seen: number;
  readonly revision: number;
  readonly outside: OutsideChanges;
}

const useLayerViews = (
  views: AreaViews,
  key: string,
  shown: boolean,
  by: DrawnBy | undefined,
  records: AreaRecords,
  inputs: string,
  holding: boolean,
  drawn: (key?: string) => void,
): {
  readonly views: AreaViews;
  readonly pending: () => number;
  /** The view is out of date: it would read in another generation or call than it drew in. */
  readonly stale: () => boolean;
  /** A read of the hidden view was not in its record. */
  readonly missed: () => boolean;
  readonly reveal: () => void;
  readonly flush: () => void;
  /** The view reported itself drawn in the generation `seen` (and `revision`): a hold keeps that one. */
  readonly readyIn: (at: HeldAt) => void;
} => {
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const byNow = useRef(by);
  byNow.current = by;
  const inputsNow = useRef(inputs);
  inputsNow.current = inputs;
  const ever = useRef(shown);
  const latest = useRef(views);
  latest.current = views;
  const pending = useRef(0);
  const missed = useRef(false);
  // The generation of the workspace (`seen`), the count of switch saves and the view-bound call (the view of the
  // window, SR-043) the view was mounted, shown or last read in: another call, or a change since then that is
  // not a save of leaving, makes it out of date, so a read is not sent; after a save of leaving alone it reads
  // once more. A view drawn from its record reads in the record's generation and call only.
  const readAt = useRef({
    seen: views.seen,
    revision: views.revision,
    saves: views.switchSaves,
    call: views.call,
  });
  // Held for a swipe (SR-212 AK5): the view keeps the generation and the changes from outside it drew in, those
  // it reported ready in, so a change between that report and the hold does not slip through; it reads again
  // once the hold ends.
  const heldAt = useRef<HeldAt | undefined>(undefined);
  // The generation the view last reported itself drawn in, with no read pending (`ready`).
  const readyIn = useRef<HeldAt | undefined>(undefined);
  // The changes from outside the view last read on as a shown one: an element view reads again on them.
  const outsideAt = useRef(views.outside);
  if (!holding) {
    heldAt.current = undefined;
  } else {
    if (heldAt.current === undefined) {
      const at = readyIn.current ?? {
        seen: readAt.current.seen,
        revision: readAt.current.revision,
        outside: outsideAt.current,
      };
      // Nothing it shows is new while held: what changed just now is highlighted once it reads again (SR-116).
      heldAt.current = { ...at, outside: { ...at.outside, fresh: () => false } };
    }
  }
  if ((shown || by === "swipe") && !holding) {
    outsideAt.current = views.outside;
    readAt.current = {
      seen: views.seen,
      revision: views.revision,
      saves: views.switchSaves,
      call: views.call,
    };
  }
  const tagNow = (): RecordTag => ({ seen: latest.current.seen, call: latest.current.call });
  // The record a hidden view draws from, taken when it starts to draw from it.
  const source = useRef<ReturnType<AreaRecords["get"]>>(undefined);
  if (by === "record" && source.current === undefined) {
    source.current = records.get(key, tagNow(), inputs);
  } else if (by !== "record") {
    source.current = undefined;
  }
  const stale = (): boolean => {
    const at = readAt.current;
    const now = latest.current;
    if (byNow.current === "record") {
      const record = source.current;
      return record === undefined || !record.holds(tagNow()) || record.inputs !== inputsNow.current;
    }
    return now.call !== at.call || now.seen - at.seen > now.switchSaves - at.saves;
  };
  // The layer is mounted: a read that waited at the gate for a layer gone meanwhile is not sent.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const held = useMemo(() => new HeldCalls(), []);
  // Resolved when the layer is shown: the reads of the view waiting at the gate go then.
  const revealed = useMemo(() => {
    let open = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { promise, open };
  }, []);
  // Resolves the reads waiting at the gate when a swipe begins toward this layer: it then reads as a shown view
  // does, and the gate, closed while the swipe drags, holds it no longer (SR-211 AK3).
  const swiping = useMemo(() => {
    const waiting = new Set<() => void>();
    return {
      wait: (): { readonly promise: Promise<undefined>; readonly done: () => void } => {
        let resolve = (): void => undefined;
        const promise = new Promise<undefined>((done) => {
          resolve = () => {
            done(undefined);
          };
        });
        waiting.add(resolve);
        return {
          promise,
          done: () => {
            waiting.delete(resolve);
          },
        };
      },
      open: () => {
        for (const resolve of waiting) {
          resolve();
        }
        waiting.clear();
      },
    };
  }, []);
  useLayoutEffect(() => {
    if (by === "swipe") {
      swiping.open();
    }
  }, [by, swiping]);
  const settled = useRef(drawn);
  settled.current = drawn;
  // The view reads as a shown one: shown, or drawn for a swipe that waits for it (SR-211 AK3).
  const asShown = (): boolean => shownNow.current || byNow.current === "swipe";
  // The answer of a view drawn from its record: the one kept, or a miss, which sends nothing.
  const fromRecord = (name: string, input: Readonly<Record<string, unknown>>): Awaited<ReturnType<Call>> => {
    const answer = source.current?.answer(name, input);
    if (answer === undefined) {
      missed.current = true;
      return notSent("LAYER_MISSED", "The view drawn in advance would read the workspace.");
    }
    return answer;
  };
  const call = useMemo((): Call => {
    const inner = views.call;
    return async (name, input) => {
      pending.current += 1;
      // Ends this read's turn in the queue of the reads drawn in advance, or its count as a shown request.
      let end = (): void => undefined;
      try {
        if (!asShown()) {
          // One hidden read (or answer from a record) at a time, and none while a shown buffer's request is in
          // flight (`ReadGate.turn`); shown meanwhile, or swiped to, it leaves the queue.
          const queued = latest.current.gate.turn();
          const swiped = swiping.wait();
          const given = await Promise.race([
            queued.turn,
            revealed.promise.then(() => undefined),
            swiped.promise,
          ]);
          swiped.done();
          if (given === undefined) {
            queued.cancel();
          } else {
            end = given;
          }
          if (!alive.current) {
            return notSent("LAYER_GONE", "The view drawn in advance is gone.");
          }
          // Shown meanwhile, it reads as a shown view does.
          if (!asShown()) {
            if (stale()) {
              return notSent("LAYER_STALE", "The view drawn in advance is out of date.");
            }
            if (byNow.current === "record") {
              return fromRecord(name, input);
            }
            readAt.current = {
              seen: latest.current.seen,
              revision: latest.current.revision,
              saves: latest.current.switchSaves,
              call: inner,
            };
          }
        }
        if (asShown()) {
          end();
          end = latest.current.gate.request();
        }
        const sent = tagNow();
        const answer = await inner(name, input);
        // What a shown view read in this generation goes into its record, so the fresh view mounted hidden after
        // the reader leaves it draws from it; an answer that comes after it was left does not.
        const tag = tagNow();
        if (alive.current && asShown() && sent.seen === tag.seen && sent.call === tag.call) {
          records.take(key, tag, inputsNow.current).add(name, input, answer);
        }
        return answer;
      } finally {
        end();
        pending.current -= 1;
        if (pending.current === 0) {
          settled.current();
        }
      }
    };
  }, [views.call]);
  const callbacks = useMemo(
    () => ({
      dispatch: (action: WindowAction): void => {
        if (shownNow.current) {
          latest.current.dispatch(action);
        } else {
          held.hold(() => {
            latest.current.dispatch(action);
          });
        }
      },
      onEcho: (message: string): void => {
        if (shownNow.current) {
          latest.current.onEcho(message);
        } else {
          held.say(message);
        }
      },
      onData: (key: string, data: BufferData | undefined): void => {
        latest.current.onData(key, data);
        if (drawnBy(data)) {
          settled.current(key);
        }
      },
      onDrawn: (key: string): void => {
        latest.current.onDrawn(key);
        settled.current(key);
      },
    }),
    [],
  );
  const element = (of: ElementBuffer): ElementProps => {
    const props = views.element(of);
    const { onGone, keep } = props;
    return {
      ...props,
      ...(onGone === undefined
        ? {}
        : {
            onGone: (key: string): void => {
              if (shownNow.current) {
                onGone(key);
              } else {
                held.hold(() => {
                  onGone(key);
                });
              }
            },
          }),
      // A view that was never shown leaves nothing to save: drawing in advance starts no save.
      ...(keep === undefined
        ? {}
        : {
            keep: {
              ...keep,
              left: (save: boolean): void => {
                if (ever.current) {
                  keep.left(save);
                }
              },
            },
          }),
    };
  };
  return {
    views: {
      ...views,
      ...(heldAt.current ?? {}),
      call,
      ...callbacks,
      element,
    },
    readyIn: (at: HeldAt) => {
      readyIn.current = at;
    },
    pending: () => pending.current,
    stale,
    missed: () => missed.current,
    reveal: () => {
      ever.current = true;
      revealed.open();
    },
    flush: () => {
      held.flush(latest.current.onEcho);
    },
  };
};

/**
 * The layer of an area that holds a view. It gives the view its own id prefix, unique in the window, so no id
 * is in two views: not in the two areas of a split, nor in a view drawn in advance beside the shown one
 * (SR-212 AK5). A hidden layer is inert, hidden from assistive technology and not painted, and its view is
 * not active; showing it only flips these attributes.
 */
const Slot = ({
  buffer,
  mount,
  shown,
  by,
  active,
  split,
  views,
  records,
  inputs,
  holding,
}: SlotEntry & {
  readonly active: boolean;
  readonly split: boolean;
  readonly views: AreaViews;
  readonly records: AreaRecords;
  readonly inputs: string;
  readonly holding: boolean;
}): React.JSX.Element => {
  const scope = useId();
  // The buffer whose view reported its drawing in this layer since it was shown or mounted.
  const reported = useRef<string | undefined>(undefined);
  const lastKey = useRef(buffer.key);
  if (lastKey.current !== buffer.key) {
    lastKey.current = buffer.key;
    reported.current = undefined;
  }
  const [tick, setTick] = useState(0);
  const layer = useLayerViews(views, buffer.key, shown, by, records, inputs, holding, (key?: string) => {
    if (key !== undefined && key === lastKey.current) {
      reported.current = key;
      views.gate.drawn(key);
    }
    setTick((count) => count + 1);
  });
  const hidden = !shown;
  const context = useMemo(() => ({ hidden, whole: !hidden || by !== "read" }), [hidden, by]);
  // Shown in the active area: the gate waits for this view's drawing, unless it was drawn in advance.
  useLayoutEffect(() => {
    if (shown && active) {
      views.gate.show(buffer.key, reported.current === buffer.key);
    }
  }, [shown, active, buffer.key]);
  const wasHidden = useRef(hidden);
  useLayoutEffect(() => {
    if (wasHidden.current && !hidden) {
      layer.reveal();
    }
    wasHidden.current = hidden;
  }, [hidden]);
  // What the view did while hidden acts after the commit that shows it, as the reads of a fresh view at the
  // switch answer after it: what the action that showed it said is said first.
  useEffect(() => {
    if (hidden) {
      return undefined;
    }
    const later = setTimeout(layer.flush, 0);
    return () => {
      clearTimeout(later);
    };
  }, [hidden]);
  // The shown view keeps the record of its buffer, also before (or without) a read: the overview reads nothing
  // itself, and the record holds what else it shows.
  useEffect(() => {
    if (shown && !holding) {
      records.take(buffer.key, { seen: views.seen, call: views.call }, inputs);
    }
  });
  // A change since the hidden view was mounted or read, other than a save of leaving, another view of the
  // window, or for a view drawn from its record any change of what it shows: it is dropped, not read again
  // (SR-212 AK5). A view that missed its record is dropped too, and the record forgotten.
  const swiped = by === "swipe";
  useEffect(() => {
    if (hidden && !swiped && (layer.stale() || layer.missed())) {
      if (by === "record") {
        records.forget(buffer.key);
      }
      views.drop(buffer.key);
    }
  }, [views.seen, views.call, inputs, hidden, swiped, tick]);
  // After the commit that follows the last answer of a read (the views' effects of the commit ran before this
  // one, so a read they started counts), and on every change of the workspace: drawn with no read pending.
  useEffect(() => {
    if (!hidden) {
      return;
    }
    const ready =
      reported.current === buffer.key &&
      layer.pending() === 0 &&
      !layer.missed() &&
      (swiped || !layer.stale());
    // A held view reports the generation it holds (SR-212 AK5); the slide counts it as drawn, as the drag
    // showed it (`SlideSpec.peeked`).
    const seen = layer.views.seen;
    if (ready) {
      layer.readyIn({ seen, revision: layer.views.revision, outside: layer.views.outside });
    }
    views.ready(buffer.key, mount, ready ? seen : undefined, by === "record");
  }, [tick, views.seen, views.call, inputs, hidden, by, holding]);
  useEffect(
    () => () => {
      views.ready(buffer.key, mount, undefined, false);
    },
    [],
  );
  return (
    <div
      className="slide-layer"
      data-layer={shown ? "main" : "neighbour"}
      // By which a swipe finds the layer of its target, to move it beside the shown one (`swipe-drag.ts`).
      data-key={buffer.key}
      inert={hidden}
      aria-hidden={hidden ? "true" : undefined}
    >
      <SlotContext.Provider value={context}>
        <IdScope.Provider value={scope}>
          <BufferView buffer={buffer} active={active && shown} split={split} views={layer.views} />
        </IdScope.Provider>
      </SlotContext.Provider>
    </div>
  );
};

/** The size of `element` in whole pixels, "width×height", while it is mounted; empty before it was measured. */
const useSize = (element: React.RefObject<HTMLElement | null>): string => {
  const [size, setSize] = useState("");
  useEffect(() => {
    const target = element.current;
    if (target === null || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box !== undefined) {
        setSize(`${String(Math.round(box.width))}×${String(Math.round(box.height))}`);
      }
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, []);
  return size;
};

export interface BufferAreaProps {
  readonly area: Area;
  /** The window shows two areas. */
  readonly split: boolean;
  /** Makes this area the active one (a press or a focus in the inactive area). */
  readonly onActivate: () => void;
  readonly views: AreaViews;
  /** The buffers drawn hidden beside the shown one (SR-212 AK5, `neighbours.ts`); none by default. */
  readonly hidden?: readonly Neighbour[];
  /**
   * The buffer a swipe in this area shows beside the shown one, held as it is drawn until the swipe and its
   * switch ended (SR-212 AK5): its view reads nothing new meanwhile.
   */
  readonly held?: string | undefined;
}

const NO_BUFFERS: readonly Neighbour[] = [];

export const BufferArea = ({
  area,
  split,
  onActivate,
  views,
  hidden = NO_BUFFERS,
  held,
}: BufferAreaProps): React.JSX.Element => {
  const activate = area.active ? undefined : onActivate;
  const root = useRef<HTMLDivElement>(null);
  const size = useSize(root);
  const records = useMemo(() => new AreaRecords(), []);
  const tag = { seen: views.seen, call: views.call };
  const inputs = (buffer: Buffer): string => inputsOf(buffer, views, size);
  const slots = useSlots(area.buffer, hidden, records, tag, inputs, views.clean);
  // Only the records of the buffers shown or beside the shown one, of this generation and call: one that left
  // the side of the shown buffer is not drawn from its record again until it was shown.
  records.prune(new Set(slots.map((slot) => slot.buffer.key)), tag);
  return (
    <div
      ref={root}
      className="area"
      data-area={area.side}
      data-active={area.active ? "" : undefined}
      // Not the mouse buttons Back and Forward (3 and 4): they switch the buffer of the active area as Alt+P
      // and Alt+N do (SR-163), and an activation would close an open prompt first.
      onPointerDown={
        activate === undefined
          ? undefined
          : (event: React.PointerEvent): void => {
              if (event.button !== 3 && event.button !== 4) {
                activate();
              }
            }
      }
      onFocus={activate}
    >
      {/* The track of a switch in motion (SR-212, `buffer-slide.ts`): the live view, the views drawn hidden in
          advance (AK5), and beside them, only while a slide runs, the picture of the view that was left. A
          lookup of the live view goes through its layer (`shownLayer`), not to the first match in the area. */}
      {slots.map((slot) => (
        <Slot
          key={slot.id}
          {...slot}
          active={area.active}
          split={split}
          views={views}
          records={records}
          inputs={inputs(slot.buffer)}
          holding={held === slot.buffer.key}
        />
      ))}
      <div className="slide-layer" data-layer="side" hidden />
    </div>
  );
};
