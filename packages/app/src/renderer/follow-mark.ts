// When the inactive area follows the element marked in the active one (SR-150 AK4). Only a change of the
// selection in the same buffer counts (`markToken`), so splitting, switching areas, opening a buffer or
// reading it again moves nothing. The marked element can come a render after the selection (a graph
// reports it when it drew the node), so a follow waits until the element differs from the one marked
// before the change. Pure, no React; `App.tsx` keeps the state between renders.
/** What one render showed: the shown buffer, its selection, its marked element and the inactive buffer. */
export interface MarkState {
  readonly buffer: string | undefined;
  readonly token: string | undefined;
  readonly marked: string | undefined;
  readonly other: string | undefined;
}

export const NO_MARK: MarkState = {
  buffer: undefined,
  token: undefined,
  marked: undefined,
  other: undefined,
};

/** A selection changed and waits for its element: the element marked before the change. */
export interface PendingMark {
  readonly marked: string | undefined;
}

/** The step from one render to the next: what still waits, and whether to follow now. */
export const markStep = (
  before: MarkState,
  now: MarkState,
  pending: PendingMark | undefined,
): { readonly pending: PendingMark | undefined; readonly follow: boolean } => {
  // Another buffer, no split, or a split made or changed without a new selection: nothing to follow.
  if (
    before.buffer !== now.buffer ||
    now.other === undefined ||
    (before.other !== now.other && before.token === now.token)
  ) {
    return { pending: undefined, follow: false };
  }
  const waiting = before.token === now.token ? pending : { marked: before.marked };
  if (waiting === undefined || now.marked === undefined || now.marked === waiting.marked) {
    return { pending: waiting, follow: false };
  }
  return { pending: undefined, follow: true };
};
