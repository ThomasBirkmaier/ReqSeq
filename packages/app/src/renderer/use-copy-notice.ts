// The confirmation of a copy in the modeline (SR-128 AK2) and the copy itself: the main process writes the
// clipboard, the modeline says what was copied for a few seconds.
import { useCallback, useEffect, useState } from "react";
import type { LogReqBridge } from "../shared/protocol.js";
import { NOTICE_MS, copyNotice } from "./copy.js";

export const useCopyNotice = (
  bridge: LogReqBridge,
): { readonly notice: string; readonly copy: (label: string, text: string) => void } => {
  // The serial restarts the time of a copy that follows another.
  const [notice, setNotice] = useState({ serial: 0, text: "" });
  useEffect(() => {
    if (notice.text === "") {
      return undefined;
    }
    const timer = setTimeout(() => {
      setNotice((now) => ({ serial: now.serial, text: "" }));
    }, NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [notice.serial]);
  const copy = useCallback(
    (label: string, text: string): void => {
      void bridge.copyText(text).then((copied) => {
        setNotice((now) => ({ serial: now.serial + 1, text: copyNotice(label, copied) }));
      });
    },
    [bridge],
  );
  return { notice: notice.text, copy };
};
