// An area of the window (SR-115 AK3, D-062): the view of one buffer. The window has one area, or two side
// by side after "Split window" (`window-layout.ts`). An area has no heading, label or tab (AK2): the
// modeline names the buffer of the active one. A press or a focus in the inactive area makes it active.
import type { ElementBuffer, GraphBuffer, MetamodelBuffer, OverviewBuffer } from "./buffers.js";
import type { Buffer, BufferAction } from "./buffers.js";
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
import type { RecentRow } from "./overview.js";
import { ResultView } from "./ResultView.js";
import type { Area } from "./window-layout.js";

type LoadingBuffer = Exclude<Buffer, ElementBuffer | OverviewBuffer | GraphBuffer | MetamodelBuffer>;

/**
 * The view of such a buffer: a list or a search result as rows, or (a list in matrix mode, SR-125) as the
 * traceability matrix; a neighbourhood (SR-107); the output of a catalog command (SR-073 AK2).
 */
export const LoadingView = ({
  buffer,
  ...props
}: Omit<ListViewProps, "buffer"> & { readonly buffer: LoadingBuffer }): React.JSX.Element => {
  const shared = {
    call: props.call,
    revision: props.revision,
    dispatch: props.dispatch,
    onData: props.onData,
    onEcho: props.onEcho,
  };
  // The rows that changed outside are highlighted (SR-116).
  const marking = props.outside === undefined ? {} : { outside: props.outside };
  if (buffer.kind === "result") {
    return <ResultView key={buffer.key} buffer={buffer} {...shared} />;
  }
  if (buffer.kind === "neighbourhood") {
    return <NeighbourhoodView key={buffer.key} buffer={buffer} {...shared} {...marking} />;
  }
  return inMatrix(buffer) ? (
    <MatrixView buffer={buffer} {...shared} {...marking} />
  ) : (
    <ListView buffer={buffer} {...props} />
  );
};

/** The props of an element view that the app gives for its buffer, besides those every view gets. */
export type ElementProps = Omit<
  ElementViewProps,
  "buffer" | "active" | "call" | "revision" | "outside" | "onData" | "onEcho" | "dispatch"
>;

/** What every view of an area gets from the app. */
export interface AreaViews {
  readonly call: Call;
  /** Counts up when the workspace changed. */
  readonly revision: number;
  /** Counts up also on every change from outside: what views of several elements read again on. */
  readonly seen: number;
  readonly outside: OutsideChanges;
  readonly dispatch: (action: BufferAction) => void;
  readonly onData: (key: string, data: BufferData | undefined) => void;
  readonly onEcho: (message: string) => void;
  /** The names of the types by their key, from the metamodel. */
  readonly typeNames: ReadonlyMap<string, string>;
  /** What the overview shows (`useOverview`), read while an area shows it. */
  readonly overview: { readonly data: OverviewData | undefined; readonly recents: readonly RecentRow[] };
  /** The props of the view of an element buffer. */
  readonly element: (buffer: ElementBuffer) => ElementProps;
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
  const { call, revision, seen, outside, dispatch, onData, onEcho } = views;
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
        recents={views.overview.recents}
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
        typeNames={views.typeNames}
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
    />
  );
};

export interface BufferAreaProps {
  readonly area: Area;
  /** The window shows two areas. */
  readonly split: boolean;
  /** Makes this area the active one (a press or a focus in the inactive area). */
  readonly onActivate: () => void;
  readonly views: AreaViews;
}

export const BufferArea = ({ area, split, onActivate, views }: BufferAreaProps): React.JSX.Element => {
  const activate = area.active ? undefined : onActivate;
  return (
    <div
      className="area"
      data-area={area.side}
      data-active={area.active ? "" : undefined}
      onPointerDown={activate}
      onFocus={activate}
    >
      {/* The right area of a split prefixes the ids of its view, so no id is in both areas. */}
      <IdScope.Provider value={split && area.side === "right" ? "r-" : ""}>
        <BufferView buffer={area.buffer} active={area.active} split={split} views={views} />
      </IdScope.Provider>
    </div>
  );
};
