// The window: an empty white sheet, the modeline (the open workspace) and the one-line minibuffer
// below it (D-061..D-063, pending). The sheet stays empty in the shell; the editor and the main view
// come with SR-065 and SR-100.
import { useEffect, useState } from "react";
import type { LogReqBridge } from "../shared/protocol.js";
import type { WorkspaceView } from "./modeline.js";
import { workspaceView } from "./modeline.js";

const MESSAGES: Readonly<Record<string, string>> = {
  restarted: "The core process stopped and was started again.",
  stopped: "The core process keeps stopping. Open the workspace again with File > Open Workspace.",
};

export const App = ({ bridge }: { readonly bridge: LogReqBridge }): React.JSX.Element => {
  const [view, setView] = useState<WorkspaceView | undefined>(undefined);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let mounted = true;
    const refresh = async (): Promise<void> => {
      const next = workspaceView(await bridge.invoke("workspace.status", {}));
      if (mounted) {
        setView(next);
        document.title = next.name === undefined ? "LogReq" : `${next.name} - LogReq`;
      }
    };
    void refresh();
    const unsubscribe = bridge.on("workspace-changed", (change) => {
      setNotice(MESSAGES[change.reason] ?? "");
      void refresh();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  return (
    <div className="shell">
      <main className="sheet" aria-label="Sheet" />
      <footer className="modeline" aria-label="Modeline">
        {view === undefined ? null : (
          <>
            <span className="name">{view.name ?? "No workspace"}</span>
            {view.marks.map((mark) => (
              <span key={mark}>{mark}</span>
            ))}
          </>
        )}
      </footer>
      <div className="minibuffer" aria-label="Minibuffer" aria-live="polite">
        {notice === "" ? (view?.message ?? "") : notice}
      </div>
    </div>
  );
};
