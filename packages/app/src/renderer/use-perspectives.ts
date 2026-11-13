// What the window keeps of perspectives (SR-214): the order in which they were opened, per workspace in the
// app's storage (`perspective-recent.ts`), and the warning of a perspective buffer that came back at a
// restart without its grouping (SR-213 AK7), said when the buffer is first shown.
import { useEffect, useRef } from "react";
import type { InvokeResult } from "../shared/protocol.js";
import type { PerspectiveUse } from "./actions.js";
import type { Buffer, BufferAction } from "./buffers.js";
import type { PerspectiveStorage } from "./perspective-recent.js";
import {
  loadPerspectiveUse,
  perspectiveUseKey,
  rememberPerspective,
  savePerspectiveUse,
} from "./perspective-recent.js";

/** The order of use of the perspectives, for the actions, and how it follows the open workspace. */
export interface PerspectiveUseState {
  /** The workspace `status` names is open: its order of use is read, when it is another one. */
  readonly follow: (status: InvokeResult) => void;
  readonly controls: PerspectiveUse;
}

export const usePerspectiveUse = (storage: () => PerspectiveStorage): PerspectiveUseState => {
  const kept = useRef<{ readonly key: string | undefined; readonly used: readonly string[] }>({
    key: undefined,
    used: [],
  });
  return {
    follow: (status) => {
      const key = perspectiveUseKey(status);
      if (key !== kept.current.key) {
        kept.current = { key, used: key === undefined ? [] : loadPerspectiveUse(storage, key) };
      }
    },
    controls: {
      used: () => kept.current.used,
      opened: (name) => {
        const { key, used } = kept.current;
        if (key !== undefined) {
          kept.current = { key, used: rememberPerspective(used, name) };
          savePerspectiveUse(storage, key, kept.current.used);
        }
      },
    },
  };
};

/**
 * Says the warning a perspective buffer brought back from a restart (SR-213 AK7) when it is first shown,
 * and drops it from the buffer, so it is said once.
 */
export const useRestoredWarning = (
  current: Buffer | undefined,
  echo: (message: string) => void,
  dispatch: (action: BufferAction) => void,
): void => {
  useEffect(() => {
    if (current?.kind !== "list" || current.perspective?.warning === undefined) {
      return;
    }
    const { warning, ...perspective } = current.perspective;
    echo(warning);
    dispatch({ type: "update", buffer: { ...current, perspective } });
  }, [current?.key]);
};
