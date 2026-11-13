// An area of the window (SR-115 AK3, D-062): the view of one buffer. The window has one area, or two side
// by side after "Split window" (`window-layout.ts`). An area has no heading, label or tab (AK2): the
// modeline names the buffer of the active one. A press or a focus in the inactive area makes it active.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { touchedSince } from "./outside-marks.js";
import type { PerspectiveRow, RecentRow } from "./overview.js";
import { ResultView } from "./ResultView.js";
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
    /** Opens a perspective of the overview (SR-118 AK7). */
    readonly openPerspective: (name: string) => void;
  };
  /** The props of the view of an element buffer. */
  readonly element: (buffer: ElementBuffer) => ElementProps;
  /** When the reads of the views drawn in advance may go (SR-212 AK5). */
  readonly gate: ReadGate;
  /**
   * The hidden view `mount` of `key` is drawn with no read pending, in the generation `seen` of the workspace
   * (`generation`), or no longer (undefined): a switch to it slides at once (SR-212 AK5).
   */
  readonly ready: (key: string, mount: number, generation: number | undefined) => void;
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
}

/** The buffers of an area's views that are drawn in advance: an element and a neighbourhood (`neighbours.ts`). */
const ownLayer = (buffer: Buffer): boolean => buffer.kind === "element" || buffer.kind === "neighbourhood";

/**
 * The layers of an area: the shown buffer, then the buffers drawn hidden beside it (SR-212 AK5) in the order
 * they were mounted. The view of an element or a neighbourhood has a layer of its
 * own per mount: shown, then left, it is mounted again hidden, as a fresh view, after the save of leaving
 * (SR-105 AK1); a hidden element named by a change from outside is mounted again too, so its read is a first
 * load. Any other view shares the layer `main`, where a list shown after another one updates in place.
 */
const useSlots = (
  shown: Buffer,
  hidden: readonly Buffer[],
  outside: OutsideChanges,
): readonly SlotEntry[] => {
  const state = useRef({
    mounts: new Map<string, number>(),
    order: [] as string[],
    shown: undefined as string | undefined,
    seq: outside.seq,
  });
  const now = state.current;
  const kept = new Set([shown.key, ...hidden.map((buffer) => buffer.key)]);
  const bump = (key: string): void => {
    now.mounts.set(key, (now.mounts.get(key) ?? 0) + 1);
  };
  for (const buffer of hidden) {
    if (buffer.key === now.shown) {
      // The buffer just left: a fresh hidden view.
      bump(buffer.key);
    } else if (
      outside.seq !== now.seq &&
      buffer.kind === "element" &&
      now.order.includes(buffer.key) &&
      touchedSince(outside, buffer.id, now.seq)
    ) {
      bump(buffer.key);
    }
  }
  now.seq = outside.seq;
  now.shown = shown.key;
  const all = [shown, ...hidden];
  const slotKey = (buffer: Buffer): string => (ownLayer(buffer) ? buffer.key : "main");
  const keys = new Set(all.map(slotKey));
  // The shown layer first, so a lookup in the document finds the shown view before a hidden one; React then
  // moves only hidden layers, never the shown one.
  const order = [slotKey(shown), ...now.order.filter((key) => keys.has(key) && key !== slotKey(shown))];
  for (const key of keys) {
    if (!order.includes(key)) {
      order.push(key);
    }
  }
  now.order = order;
  for (const key of [...now.mounts.keys()]) {
    if (!kept.has(key)) {
      now.mounts.delete(key);
    }
  }
  const byKey = new Map(all.map((buffer) => [slotKey(buffer), buffer]));
  return order.flatMap((key) => {
    const buffer = byKey.get(key);
    if (buffer === undefined) {
      return [];
    }
    const mount = now.mounts.get(buffer.key) ?? 0;
    return [{ id: `${key}#${String(mount)}`, buffer, mount, shown: buffer.key === shown.key }];
  });
};

/**
 * The views of one layer: those of the area, with the callbacks of a hidden view held (`HeldCalls`) and its
 * reads behind the gate, counted, so the layer knows when its view is drawn with no read pending.
 */
const useLayerViews = (
  views: AreaViews,
  shown: boolean,
  drawn: (key?: string) => void,
): {
  readonly views: AreaViews;
  readonly pending: () => number;
  readonly reveal: () => void;
  readonly flush: () => void;
} => {
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const ever = useRef(shown);
  const latest = useRef(views);
  latest.current = views;
  const pending = useRef(0);
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
  const settled = useRef(drawn);
  settled.current = drawn;
  const call = useMemo((): Call => {
    const inner = views.call;
    return async (name, input) => {
      pending.current += 1;
      try {
        if (!shownNow.current) {
          await Promise.race([latest.current.gate.pass(), revealed.promise]);
          if (!alive.current) {
            return { ok: false, code: "LAYER_GONE", message: "The view drawn in advance is gone." };
          }
        }
        return await inner(name, input);
      } finally {
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
    views: { ...views, call, ...callbacks, element },
    pending: () => pending.current,
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
  active,
  split,
  views,
}: SlotEntry & {
  readonly active: boolean;
  readonly split: boolean;
  readonly views: AreaViews;
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
  const layer = useLayerViews(views, shown, (key?: string) => {
    if (key !== undefined && key === lastKey.current) {
      reported.current = key;
      views.gate.drawn(key);
    }
    setTick((count) => count + 1);
  });
  const hidden = !shown;
  const context = useMemo(() => ({ hidden }), [hidden]);
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
  // After the commit that follows the last answer of a read (the views' effects of the commit ran before this
  // one, so a read they started counts), and on every change of the workspace: drawn with no read pending.
  useEffect(() => {
    if (!hidden) {
      return;
    }
    views.ready(
      buffer.key,
      mount,
      reported.current === buffer.key && layer.pending() === 0 ? views.seen : undefined,
    );
  }, [tick, views.seen, hidden]);
  useEffect(
    () => () => {
      views.ready(buffer.key, mount, undefined);
    },
    [],
  );
  return (
    <div
      className="slide-layer"
      data-layer={shown ? "main" : "neighbour"}
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

export interface BufferAreaProps {
  readonly area: Area;
  /** The window shows two areas. */
  readonly split: boolean;
  /** Makes this area the active one (a press or a focus in the inactive area). */
  readonly onActivate: () => void;
  readonly views: AreaViews;
  /** The buffers drawn hidden beside the shown one (SR-212 AK5, `neighbours.ts`); none by default. */
  readonly hidden?: readonly Buffer[];
}

const NO_BUFFERS: readonly Buffer[] = [];

export const BufferArea = ({
  area,
  split,
  onActivate,
  views,
  hidden = NO_BUFFERS,
}: BufferAreaProps): React.JSX.Element => {
  const activate = area.active ? undefined : onActivate;
  const slots = useSlots(area.buffer, hidden, views.outside);
  return (
    <div
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
        <Slot key={slot.id} {...slot} active={area.active} split={split} views={views} />
      ))}
      <div className="slide-layer" data-layer="side" hidden />
    </div>
  );
};
